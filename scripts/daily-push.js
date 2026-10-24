#!/usr/bin/env node
/**
 * 晚霞预报 CLI（v2 霞分）—— 直接用页面同一套算法（algo.js v2 + api.js 多模式集合）出文字版。
 *
 * 供 Hermes 每日推送 / 手动查看用，不参与网页构建。
 *
 * 用法：
 *   node scripts/daily-push.js                       # 胡志明市 La Astoria，今天起 7 天
 *   node scripts/daily-push.js --offset 1            # 从明天开始报（今天日落已过时用）
 *   node scripts/daily-push.js --lat 10.79 --lon 106.75 --name 家
 *   node scripts/daily-push.js --json                # 机器可读
 *
 * 与页面口径一致：霞分 v2（几何门控 ×0.7–1.0 调制）、六档、通透度独立评、
 * 云量四模式集合（综合 ×3）、缺口按「上游低云 + 0.5×中云」计。
 */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const algo = require(path.join(ROOT, 'algo.js'));
global.SunsetAlgo = algo;
const api = require(path.join(ROOT, 'api.js'));
const jev = require('./jev.js');

const DEFAULTS = { lat: 10.79, lon: 106.75, name: '胡志明市 · La Astoria (Thủ Đức)', tz: 'auto' };

function parseArgs(argv) {
  const out = { days: 7, offset: 0, json: false, lat: DEFAULTS.lat, lon: DEFAULTS.lon, name: DEFAULTS.name, tz: DEFAULTS.tz };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--lat') out.lat = parseFloat(next());
    else if (a === '--lon') out.lon = parseFloat(next());
    else if (a === '--name') out.name = next();
    else if (a === '--tz') out.tz = next();
    else if (a === '--days') out.days = parseInt(next(), 10);
    else if (a === '--offset') { out.offset = parseInt(next(), 10); out.offsetSet = true; }
    else if (a === '--place') out.place = next();
    else if (a === '--json') out.json = true;
    else if (a === '--no-verify') out.noVerify = true;
    else if (a === '--help' || a === '-h') { console.log('node scripts/daily-push.js [--lat L --lon L --name N --tz TZ --days 7 --offset 0 --json]'); process.exit(0); }
  }
  out.days = Math.max(1, Math.min(10, out.days || 7));
  out.offset = Math.max(0, Math.min(5, out.offset || 0));
  return out;
}

/* ---------------- 太阳高度角（NOAA 简化式，精度 ~0.01°，用于金蓝时刻） ---------------- */
const RAD = Math.PI / 180;
function sunAltitude(epochMs, lat, lon) {
  const n = (epochMs - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86400000;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const sinDec = Math.sin(eps) * Math.sin(lambda);
  const dec = Math.asin(sinDec);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD; // 度
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;                          // 小时
  const ha = (gmst * 15 + lon - ra) * RAD;
  const phi = lat * RAD;
  const s = Math.sin(phi) * sinDec + Math.cos(phi) * Math.cos(dec) * Math.cos(ha);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

// 在 [from, to] 区间里找太阳高度角等于 target 的时刻（单调区间，二分 40 次 ≈ 亚秒）
function findAltTime(lat, lon, fromMs, toMs, target) {
  let lo = fromMs, hi = toMs;
  const a = sunAltitude(lo, lat, lon) - target;
  const b = sunAltitude(hi, lat, lon) - target;
  if (a === 0) return lo;
  if (b === 0) return hi;
  if (a * b > 0) return null;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const m = sunAltitude(mid, lat, lon) - target;
    if (a * m <= 0) hi = mid; else lo = mid;
  }
  return Math.round((lo + hi) / 2 / 60000) * 60000;
}

/* ---------------- 光谱 / 云底受光（移植自 Skyglow，物理可解释） ----------------
 * 参考 couletian/Skyglow core/spectrum.py + core/solar.py：
 *   - 云底进入地球阴影的太阳高度角 illumination_limit = -deg(sqrt(2h/R))：
 *     高云(8.6km)≈-2.9°，中云(5.2km)≈-2.3°，低云≈0 —— 云底越高、日落后亮得越久。
 *   - 光路消光：瑞利 τ∝λ^-4.1（空气分子）+ 米 τ∝λ^-1.3（气溶胶），
 *     长波红光穿透力强 → 红度 = 620nm/470nm 透过率之比，AOD 越高、光路越长越红。 */
const R_EARTH = 6371.0, RAYLEIGH_TAU_550 = 0.098, AEROSOL_ANGSTROM = 1.3,
  RAYLEIGH_SCALE_H = 7.5, AEROSOL_SCALE_H = 1.4, AEROSOL_AIRMASS_GAIN = 12.0;
const DECK_BASE = { high: 8.6, mid: 5.2, low: 1.2 };

function illuminationLimit(baseKm) {
  return -(Math.sqrt(2 * baseKm / R_EARTH) / RAD);
}

function airmass(sunElevDeg, baseKm) {
  const tanRay = 38 * Math.exp(-baseKm / RAYLEIGH_SCALE_H);
  const tanAer = AEROSOL_AIRMASS_GAIN * Math.exp(-baseKm / AEROSOL_SCALE_H);
  if (sunElevDeg >= 0) {
    const s = Math.max(Math.sin(sunElevDeg * RAD), 0.005);
    return [Math.min(tanRay, 1 / s), Math.min(tanAer, 0.75 / s), baseKm];
  }
  const alpha = -sunElevDeg * RAD;
  const ht = Math.max(0, baseKm - R_EARTH * alpha * alpha / 2);
  return [38 * Math.exp(-ht / RAYLEIGH_SCALE_H), AEROSOL_AIRMASS_GAIN * Math.exp(-ht / AEROSOL_SCALE_H), ht];
}

// 红度 = 620nm/470nm 透过率之比；>1 偏红，越大越"血橙/绯红"
function redness(aod, mRay, mAer) {
  const tau = (lam) => RAYLEIGH_TAU_550 * Math.pow(550 / lam, 4.1) * mRay
    + (aod || 0) * Math.pow(550 / lam, AEROSOL_ANGSTROM) * mAer;
  return Math.exp(tau(470) - tau(620));
}

function colorName(red) {
  if (red >= 2.6) return '血橙/绯红';
  if (red >= 2.1) return '橘红';
  if (red >= 1.7) return '橘黄';
  return '金黄';
}

/* 完整光谱 → 亮度 + RGB（移植 Skyglow core/spectrum.py，Wyman 2013 CIE 拟合） */
const _g = (x, mu, s1, s2) => Math.exp(-0.5 * Math.pow((x - mu) / (x < mu ? s1 : s2), 2));
function _cie(x, y, z) {
  const r = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const g = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const b = 0.0557 * x - 0.2040 * y + 1.0570 * z;
  return [r, g, b];
}
function _gamma(c) { c = Math.max(0, Math.min(1, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
const _LAM = Array.from({ length: 61 }, (_, i) => 400 + 5 * i);
const _PLANCK = (() => { const m = {}; for (const l of _LAM) { const lm = l * 1e-9, c = 2.99792458e8, h = 6.62607015e-34, k = 1.380649e-23; m[l] = (2 * h * c * c / Math.pow(lm, 5)) / (Math.exp(h * c / (lm * k * 5778)) - 1); } const mx = Math.max(...Object.values(m)); for (const l of _LAM) m[l] /= mx; return m; })();
function _cmf(l) {
  return [
    1.056 * _g(l, 599.8, 37.9, 31.0) + 0.362 * _g(l, 442.0, 16.0, 26.7) - 0.065 * _g(l, 501.1, 20.4, 26.2),
    0.821 * _g(l, 568.8, 46.9, 40.5) + 0.286 * _g(l, 530.9, 16.3, 31.1),
    1.217 * _g(l, 437.0, 11.8, 36.0) + 0.681 * _g(l, 459.0, 26.0, 13.8)
  ];
}
function deckLight(baseKm, sunElevDeg, aod) {
  const [mRay, mAer] = airmass(sunElevDeg, baseKm);
  aod = Math.max(0, aod === null || aod === undefined ? 0.15 : aod);
  let X = 0, Y = 0, Z = 0, Xw = 0, Yw = 0, Zw = 0;
  for (const l of _LAM) {
    const tau = RAYLEIGH_TAU_550 * Math.pow(550 / l, 4.1) * mRay + aod * Math.pow(550 / l, AEROSOL_ANGSTROM) * mAer;
    const spec = _PLANCK[l] * Math.exp(-tau);
    const [cx, cy, cz] = _cmf(l);
    X += spec * cx; Y += spec * cy; Z += spec * cz;
    Xw += _PLANCK[l] * cx; Yw += _PLANCK[l] * cy; Zw += _PLANCK[l] * cz;
  }
  const lum = Y / Math.max(Yw, 1e-9);
  if (lum <= 1e-9) return { lum: 0, rgb: [120, 90, 80] };
  const den = Math.max(X + Y + Z, 1e-12);
  const cx = X / den, cy = Y / den;
  const Yn = Math.max(lum, 1e-6);
  const Xn = cx / Math.max(cy, 1e-6) * Yn;
  const Zn = (1 - cx - cy) / Math.max(cy, 1e-6) * Yn;
  let [r, g, b] = _cie(Xn, Yn, Zn);
  r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b);
  const mx = Math.max(r, g, b, 1e-9);
  r /= mx; g /= mx; b /= mx;
  const shade = 0.55 + 0.45 * Math.min(1, Math.pow(lum / 0.25, 0.35));
  return { lum, rgb: [Math.round(255 * _gamma(r) * shade), Math.round(255 * _gamma(g) * shade), Math.round(255 * _gamma(b) * shade)] };
}
function colorNameRgb(rgb, lum) {
  if (lum < 0.004) return '暗红余晖';
  const [r, g, b] = rgb;
  if (r > 200 && g > 150 && b < 120) return '金黄';
  if (r > 210 && g > 110) return '橘黄';
  if (r > 190 && g > 60) return '橘红';
  if (r > 150 && b < 110) return '绯红';
  return '玫瑰红';
}

/* ---------------- 取数 + 评分（复用 api 内部构件，口径与页面完全一致） ---------------- */
async function build(opt) {
  const span = Math.min(16, opt.offset + opt.days + 1);
  const fc = await api.fetchJSON(api.forecastURL(opt.lat, opt.lon, opt.tz, span));
  const offsetSec = fc.utc_offset_seconds || 0;
  const tzName = fc.timezone || 'UTC';
  const daily = fc.daily || {};
  const todayStr = api.zonedParts(Date.now(), offsetSec).dateStr;
  const dayIdx = {};
  (daily.time || []).forEach((d, k) => { dayIdx[d] = k; });

  // 目标日期：今天起 offset 偏移，取 days 天
  const allDates = (daily.time || []).filter(d => d >= todayStr);
  let startIdx = Math.min(opt.offset, Math.max(0, allDates.length - 1));
  // 没显式指定 offset 时：今天的日落已经过去 15 分钟以上，就自动从明天开始报
  if (!opt.offsetSet) {
    const ds0 = allDates[startIdx];
    const s0 = ds0 && (daily.sunset || [])[dayIdx[ds0]];
    if (s0 && algo.toEpoch(s0, offsetSec) < Date.now() - 15 * 60000) {
      startIdx = Math.min(startIdx + 1, Math.max(0, allDates.length - 1));
    }
  }
  const dates = allDates.slice(startIdx, startIdx + opt.days);
  if (!dates.length) throw new Error('预报数据不含目标日期');

  const specs = dates.map(ds => {
    const sunsetStr = (daily.sunset || [])[dayIdx[ds]];
    const sunriseStr = (daily.sunrise || [])[dayIdx[ds]];
    const out = { dateStr: ds };
    if (sunsetStr) {
      out.sunsetEpoch = algo.toEpoch(sunsetStr, offsetSec);
      const p = api.zonedParts(out.sunsetEpoch, offsetSec);
      out.sunsetBearing = algo.sunsetBearing(opt.lat, api.dayOfYear(p.y, p.m, p.day));
    }
    if (sunriseStr) {
      out.sunriseEpoch = algo.toEpoch(sunriseStr, offsetSec);
      const p = api.zonedParts(out.sunriseEpoch, offsetSec);
      out.sunriseBearing = algo.sunriseBearing(opt.lat, api.dayOfYear(p.y, p.m, p.day));
    }
    return out;
  }).filter(s => s.sunsetEpoch);

  const aq = await api.fetchJSON(api.aqURL(opt.lat, opt.lon, tzName, Math.min(span, 7))).catch(() => null);

  // 一次请求拿下上游点：晚霞用第一天的方位（7 天方位差 <0.5°），朝霞同理
  const epSet = api.ensemblePoints(opt.lat, opt.lon, [specs[0].sunsetBearing]);
  const epRise = specs[0].sunriseBearing !== undefined
    ? api.ensemblePoints(opt.lat, opt.lon, [specs[0].sunriseBearing]) : null;
  const [ensSet, ensRise] = await Promise.all([
    api.fetchEnsemble(epSet.points, tzName, span),
    epRise ? api.fetchEnsemble(epRise.points, tzName, span) : Promise.resolve(null)
  ]);

  specs.forEach(s => {
    s.sunset = api.scoreEvent(fc, aq, s.sunsetEpoch, s.sunsetBearing, offsetSec, ensSet, epSet.upIdx[0], epSet.dist);
    s.sunset.day = 'sunset';
    if (s.sunriseEpoch !== undefined && ensRise) {
      s.sunrise = api.scoreEvent(fc, aq, s.sunriseEpoch, s.sunriseBearing, offsetSec, ensRise, epRise.upIdx[0], epRise.dist);
      s.sunrise.day = 'sunrise';
    }
  });

  return { tzName, offsetSec, span, specs, fetchedAt: Date.now(), fc, aq, epSet, opt };
}

/* ---------------- 集合预报概率（P0-1）----------------
 * 对 ECMWF IFS ENS 51 个成员各跑一遍 v2 glow()，得到霞分的真实分布。
 * 注意：GFS ENS(31) / ICON EPS(40) 在 Ensemble API 里只有**总云量**逐成员（
 * cloud_cover_memberXX），分层云量 cloud_cover_low/mid/high_memberXX 全是 null，
 * 所以没法拿它们跑 glow()。目前只接 ECMWF（分层云量最完整），别被「122 成员」误导。 */
const ENS_MODELS = ['ecmwf_ifs025'];

async function ensembleDistribution(opt, fc, aq, epSet, head) {
  try {
    const lats = epSet.points.map(p => p.lat.toFixed(4)).join(',');
    const lons = epSet.points.map(p => p.lon.toFixed(4)).join(',');
    const off = fc.utc_offset_seconds || 0;
    const epoch = head.sunsetEpoch;
    const baseTimes = (fc.hourly.time || []);
    const allScores = [];

    for (const model of ENS_MODELS) {
      const url = 'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=' + lats +
        '&longitude=' + lons + '&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high' +
        '&models=' + model + '&forecast_days=' + Math.min(15, opt.days) + '&timezone=auto';
      const data = await api.fetchJSON(url);
      const list = Array.isArray(data) ? data : [data];
      if (!list.length || !list[0].hourly) continue;
      const mOff = list[0].utc_offset_seconds || off;

      const valAt = (p, varName, member) => {
        const h = p.hourly || {};
        const col = member ? varName + '_' + member : varName;
        const times = (h.time || []).map(t => algo.toEpoch(t, mOff));
        const i = algo.idxFloor(times, epoch);
        // GFS ENS / ICON EPS 是 3 小时步长，hourly 网格上有 null；就近找非空值（±3 步）
        for (let d = 0; d <= 3; d++) {
          for (const k of (d === 0 ? [i] : [i - d, i + d])) {
            if (k >= 0 && k < times.length) {
              const v = h[col] ? h[col][k] : null;
              if (v !== null && v !== undefined) return v;
            }
          }
        }
        return null;
      };

      const memberSuffixes = [''];
      Object.keys(list[0].hourly || {}).forEach(k => {
        const m = k.match(/^cloud_cover_low_member(\d+)$/);
        if (m) memberSuffixes.push('member' + m[1]);
      });
      if (memberSuffixes.length < 5) continue;

      for (const member of memberSuffixes) {
        const loc = {
          low: valAt(list[0], 'cloud_cover_low', member),
          mid: valAt(list[0], 'cloud_cover_mid', member),
          high: valAt(list[0], 'cloud_cover_high', member)
        };
        if (loc.low === null && loc.mid === null && loc.high === null) continue;
        const ups = [];
        for (let k = 1; k < list.length; k++) {
          const l = valAt(list[k], 'cloud_cover_low', member);
          const m = valAt(list[k], 'cloud_cover_mid', member);
          if (l === null && m === null) { ups.push(null); continue; }
          ups.push({
            hourly: {
              time: baseTimes,
              cloud_cover_low: baseTimes.map(() => l),
              cloud_cover_mid: baseTimes.map(() => m),
              cloud_cover: baseTimes.map(() => (l || 0) + (m || 0))
            },
            utc_offset_seconds: mOff
          });
        }
        if (ups.filter(x => x).length === 0) continue;
        const r = algo.evaluate(fc, aq, ups, epoch, head.sunsetBearing, off, loc, epSet.dist);
        allScores.push(r.rawScore);
      }
    }

    if (allScores.length < 20) return null;
    allScores.sort((a, b) => a - b);
    const q = p => allScores[Math.min(allScores.length - 1, Math.floor(p * allScores.length))];
    const frac = th => allScores.filter(s => s >= th).length / allScores.length;
    return {
      n: allScores.length, p10: q(0.10), p50: q(0.50), p90: q(0.90),
      p_burn: frac(35), p_big: frac(65), p_huge: frac(80),   // 小的分档线是 35（>=35 小烧）
      spread: Math.round(q(0.90) - q(0.10))
    };
  } catch (e) {
    return null;
  }
}

/* ---------------- 文案 ---------------- */
const VERDICT = ['基本没有', '大概率没有，云边可能泛点色', '有一点机会', '有机会，顺路看一眼', '有，大概率烧起来，值得去看', '有大烧，非常壮观'];
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function mdTime(epoch, offsetSec, tzName) { return api.fmtTime(epoch, offsetSec, tzName); }

function render(res, opt, ens) {
  const { offsetSec } = res;
  const tzName = res.tzName || null;   // 展示按真实时区换算（跨夏令时的 7 日表才不会差 1 小时）
  const head = res.specs[0];
  const ev = head.sunset;
  const inp = ev.inputs || {};
  const lines = [];

  lines.push(`**🌅 晚霞预报** · ${opt.name}`);
  const hp = api.tzParts(tzName, head.sunsetEpoch) || api.zonedParts(head.sunsetEpoch, offsetSec);
  lines.push(`${head.dateStr}（${WEEKDAY[hp.wd !== undefined ? hp.wd : new Date(head.sunsetEpoch + offsetSec * 1000).getUTCDay()]}）`);
  lines.push('');
  lines.push(`**${ev.gradeEmoji || ''} ${ev.grade}** ｜ 霞分 ${ev.score}/100（置信度${ev.conf}）`);
  if (ev.probability !== undefined && ev.probability !== null) {
    lines.push(`- 标定概率：${Math.round(ev.probability * 100)}%（历史同类分数的烧率）`);
  }
  lines.push(`- 结论：${VERDICT[ev.level] || '看不准'}`);
  if (ev.reasonsV2 && ev.reasonsV2.length) lines.push(`- 主因：${ev.reasonsV2.slice(0, 2).join('；')}`);
  if (ev.clarity) lines.push(`- 通透度：${ev.clarity.name}（${ev.clarity.score}/100）`);
  if (ens) lines.push(`- 集合预报 ${ens.n} 成员：中位 ${Math.round(ens.p50)}（${Math.round(ens.p10)}–${Math.round(ens.p90)}）｜ P(小烧以上) ${Math.round(ens.p_burn * 100)}%｜ P(中到大烧) ${Math.round(ens.p_big * 100)}%`);
  lines.push('');

  // 关键时间
  const sunsetStr = mdTime(head.sunsetEpoch, offsetSec, tzName);
  const goldStart = findAltTime(opt.lat, opt.lon, head.sunsetEpoch - 90 * 60000, head.sunsetEpoch, 6);
  const blueEnd = findAltTime(opt.lat, opt.lon, head.sunsetEpoch, head.sunsetEpoch + 60 * 60000, -6);
  lines.push('**⏱️ 关键时间**');
  lines.push(`- 日落 ${sunsetStr}（方位 ${Math.round(head.sunsetBearing)}°）`);
  lines.push(`- 最佳观赏 ${api.viewingWindow(head.sunsetEpoch, true, offsetSec, tzName)}`);
  if (goldStart && blueEnd) {
    lines.push(`- 金色时刻 ${mdTime(goldStart, offsetSec, tzName)}–${sunsetStr} ｜ 蓝调时刻 ${sunsetStr}–${mdTime(blueEnd, offsetSec, tzName)}`);
  }
  lines.push('');

  // 颜色与最红时刻（Skyglow 光谱模型：瑞利+米散射，云底越高受光越久）
  const aodV = (inp.aod === null || inp.aod === undefined) ? 0.15 : inp.aod;
  const dk = deckLight(DECK_BASE.mid, -1.0, aodV);
  const tPeak = findAltTime(opt.lat, opt.lon, head.sunsetEpoch, head.sunsetEpoch + 90 * 60000, -1.0);
  const tEnd = findAltTime(opt.lat, opt.lon, head.sunsetEpoch, head.sunsetEpoch + 90 * 60000, illuminationLimit(DECK_BASE.high));
  lines.push('**🎨 颜色与最红时刻**');
  lines.push(`- 预计颜色：${colorNameRgb(dk.rgb, dk.lum)}（亮度 ${(dk.lum * 100).toFixed(0)}%）`);
  if (tPeak && tEnd) {
    const p = Math.max(0, Math.round((tPeak - head.sunsetEpoch) / 60000));
    const e = Math.max(p + 1, Math.round((tEnd - head.sunsetEpoch) / 60000));
    lines.push(`- 最红约在日落后 ${p}–${e} 分钟（高云 8.6km 受光到太阳 −${Math.round(-illuminationLimit(DECK_BASE.high))}°）`);
  }
  lines.push('');

  // 天空条件
  const n = (v) => (v === null || v === undefined || isNaN(v)) ? '—' : Math.round(v);
  const f1 = (v) => (v === null || v === undefined || isNaN(v)) ? '—' : Number(v).toFixed(1);
  const f2 = (v) => (v === null || v === undefined || isNaN(v)) ? '—' : Number(v).toFixed(2);
  lines.push('**☁️ 天空条件**（云量取 4 模式集合）');
  lines.push(`- 高云 ${n(inp.high)}% ｜ 中云 ${n(inp.mid)}% ｜ 低云 ${n(inp.low)}%`);
  lines.push(`- 降水概率 ${n(inp.prob)}%（${inp.precip === undefined || inp.precip === null ? '—' : inp.precip}mm）｜ 能见度 ${f1(inp.visKm)}km`);
  lines.push(`- 上游挡光云 低 ${n(inp.upLowAvg)}% / 中 ${n(inp.upMidAvg)}% ｜ AOD ${f2(inp.aod)}`);
  if (ev.ensemble) {
    const members = ev.ensemble.members.map(m => `${m.label} ${m.score}`).join(' · ');
    lines.push(`- 模式一致度 ${ev.ensemble.n} 家：${members}（极差 ${ev.ensemble.spread}）`);
  }
  lines.push('');

  lines.push(`**💬 建议**：${advice(ev)}`);
  lines.push('');

  // 明早朝霞
  const next = res.specs[1];
  if (next && next.sunrise) {
    const sr = next.sunrise;
    lines.push(`**🌄 明早朝霞**：${sr.gradeEmoji || ''} ${sr.grade} ｜ ${sr.score}/100（日出 ${mdTime(next.sunriseEpoch, offsetSec, tzName)}）`);
    lines.push('');
  }

  // 7 天表
  lines.push(`**📅 未来 ${res.specs.length} 天**`);
  lines.push('| 日期 | 霞分 | 等级 | 日落 |');
  lines.push('| --- | --- | --- | --- |');
  res.specs.forEach(s => {
    const tp = api.tzParts(tzName, s.sunsetEpoch) || api.zonedParts(s.sunsetEpoch, offsetSec);
    const mmdd = String(tp.m).padStart(2, '0') + '-' + String(tp.day).padStart(2, '0');
    const wd = WEEKDAY[tp.wd !== undefined ? tp.wd : new Date(s.sunsetEpoch + offsetSec * 1000).getUTCDay()];
    lines.push(`| ${mmdd} ${wd} | ${s.sunset.score} | ${s.sunset.gradeEmoji || ''} ${s.sunset.grade} | ${mdTime(s.sunsetEpoch, offsetSec, tzName)} |`);
  });
  lines.push('');

  const best = res.specs.slice().sort((a, b) => b.sunset.rawScore - a.sunset.rawScore)[0];
  if (best && best !== head) {
    const bp = api.tzParts(tzName, best.sunsetEpoch) || api.zonedParts(best.sunsetEpoch, offsetSec);
    const wd = WEEKDAY[bp.wd !== undefined ? bp.wd : new Date(best.sunsetEpoch + offsetSec * 1000).getUTCDay()];
    lines.push(`**🔎 本周最有机会**：${String(bp.m).padStart(2, '0')}-${String(bp.day).padStart(2, '0')} ${wd} ｜ ${best.sunset.score}/100（${best.sunset.grade}）`);
    lines.push('');
  }

  lines.push('**📖 怎么看**');
  lines.push('- 霞分 ≥65 值得专门跑；50–64 顺路看；<35 别跑');
  lines.push('- 要同时满足：中高云幕布 40–80%、太阳方向上游少云（缺口）、低云少——缺一项就基本没戏');
  lines.push('- AOD <0.3 通透；>0.6 发灰压暗');
  lines.push('');
  lines.push(`_数据：Open-Meteo 四模式集合 + CAMS 气溶胶 ｜ 算法：sunset-glow 霞分 v2 ｜ 每天 15:00 推送_`);

  return lines.join('\n');
}

function advice(ev) {
  if (ev.level >= 4) return '条件很好，值得专门跑一趟，提前 20 分钟到位';
  if (ev.level === 3) return '有机会，顺路看一眼就行，别为它改行程';
  if (ev.level === 2) return '概率偏低，正常路过可以抬头看看';
  if (ev.clarity && ev.clarity.level <= 2) return '云和天都不配合（还发灰），不用等';
  return '基本没有，别等';
}

/* ---------------- Jev 独立复核：把「数据」和「分析」交给另一套系统判是否自洽 ----------------
 * 只做增强，不阻断：超时/无 key/接口挂了都照常推送。p<0.5 时在文末加一行存疑提示。 */
async function verifyHead(res, ens) {
  const head = res.specs[0];
  const ev = head && head.sunset;
  if (!ev) return { ok: false, error: 'no-event' };
  const inp = ev.inputs || {};
  const conditions = {
    grade: ev.grade,
    score: ev.score,
    high_cloud_pct: inp.high,
    mid_cloud_pct: inp.mid,
    low_cloud_pct: inp.low,
    precip_mm: inp.precip,
    precip_prob_pct: inp.prob,
    aod: inp.aod,
    visibility_km: inp.visKm,
    ensemble_median: ens ? Math.round(ens.p50) : null
  };
  return jev.verifyEvent(conditions);
}

/* ---------------- main ---------------- */
(async () => {
  const opt = parseArgs(process.argv);
  if (opt.place) {
    const list = await api.searchPlaces(opt.place);
    if (!list || !list.length) throw new Error('找不到地名：' + opt.place);
    const p = list[0];
    opt.lat = p.lat; opt.lon = p.lon; opt.tz = p.timezone || 'auto';
    opt.name = p.name + (p.country ? ' · ' + p.country : '');
  }
  const res = await build(opt);
  const ens = await ensembleDistribution(opt, res.fc, res.aq, res.epSet, res.specs[0]);
  let verify = null;
  if (!opt.noVerify && jev.hasKey()) {
    verify = await verifyHead(res, ens).catch(() => ({ ok: false, error: 'exception' }));
  }
  if (opt.json) {
    const slim = {
      tz: res.tzName, offsetSec: res.offsetSec, fetchedAt: res.fetchedAt,
      place: { name: opt.name, lat: opt.lat, lon: opt.lon },
      ensemble51: ens,
      verify: verify,
      days: res.specs.map(s => ({
        date: s.dateStr,
        sunset: s.sunset && { score: s.sunset.score, grade: s.sunset.grade, level: s.sunset.level, conf: s.sunset.conf, epoch: s.sunsetEpoch, bearing: s.sunsetBearing, clarity: s.sunset.clarity, reasons: s.sunset.reasonsV2, inputs: s.sunset.inputs, ensemble: s.sunset.ensemble },
        sunrise: s.sunrise && { score: s.sunrise.score, grade: s.sunrise.grade, level: s.sunrise.level, conf: s.sunrise.conf, epoch: s.sunriseEpoch }
      }))
    };
    console.log(JSON.stringify(slim, null, 1));
  } else {
    let text = render(res, opt, ens);
    if (verify && verify.ok && verify.p < 0.5) {
      text += `\n\n⚠️ 复核存疑（Jev ${verify.p.toFixed(2)}）：结论与输入可能不一致，本次仅供参考。`;
    }
    console.log(text);
  }
})().catch(e => {
  console.error('晚霞预报取数失败：' + (e && e.message ? e.message : e));
  process.exit(1);
});
