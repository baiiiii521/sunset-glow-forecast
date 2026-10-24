/* ============================================================
 * scripts/lib/score-batch.js — 一次请求多坐标的批量打分
 * 用途：霞榜扩容（上千城）与每小时热门城市快照
 * 与网页同口径：A.evaluate + 上游 5 个点，只是把「每城一次请求」换成「一次请求多城」
 * ============================================================ */
'use strict';
require('../../algo.js');
const API = require('../../api.js');
const A = globalThis.SunsetAlgo;

const UP = [50, 150, 300];                 // 粗筛只用 3 个上游点，省 40% 调用额度
const COORDS_PER_CITY = 1 + UP.length;     // 本点 + 3 个上游
const CLOUD = API.CLOUD_VARS.join(',');

// Open-Meteo 免费额度按「坐标数」计调用：一次 24 坐标 = 24 次调用。
// 免费档约 600 次/分钟，这里压到 420 次/分钟留余量。
const RATE_PER_MIN = Number(process.env.GLOW_RATE_PER_MIN || 70);   // 免费档小时上限 5,000 ≈ 83/分钟，压到 70
const _calls = [];
async function throttle(nCalls) {
  for (;;) {
    const now = Date.now();
    while (_calls.length && now - _calls[0] > 60000) _calls.shift();
    const used = _calls.reduce((a, b) => a + b, 0);
    if (used + nCalls <= RATE_PER_MIN) { _calls.push(nCalls); return; }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function doyUTC(epoch) {
  const d = new Date(epoch);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
    Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
}

// 每个城市展开成 6 个坐标；返回 {coords, map:[{city, idx, bearing}]}
function expand(cities, epoch) {
  const coords = [];
  const map = [];
  const doy = doyUTC(epoch || Date.now());
  for (const city of cities) {
    const bearing = A.sunsetBearing(city.lat, doy);
    const base = coords.length;
    coords.push({ lat: city.lat, lon: city.lon });
    for (const km of UP) coords.push(A.destination(city.lat, city.lon, bearing, km));
    map.push({ city, base, bearing });
  }
  return { coords, map };
}

async function fetchBatchForecast(coords, days) {
  const url = API.FC_URL +
    '?latitude=' + coords.map((p) => p.lat.toFixed(4)).join(',') +
    '&longitude=' + coords.map((p) => p.lon.toFixed(4)).join(',') +
    '&hourly=' + API.HOURLY_VARS +
    '&minutely_15=' + CLOUD +
    '&daily=sunrise,sunset&timezone=auto&forecast_days=' + (days || 2);
  const j = await API.fetchJSON(url);
  return Array.isArray(j) ? j : [j];
}

async function fetchBatchAQ(coords, days) {
  const url = API.AQ_URL +
    '?latitude=' + coords.map((p) => p.lat.toFixed(4)).join(',') +
    '&longitude=' + coords.map((p) => p.lon.toFixed(4)).join(',') +
    '&hourly=aerosol_optical_depth,pm2_5,pm10,dust&timezone=auto&forecast_days=' + (days || 2);
  try {
    const j = await API.fetchJSON(url);
    return Array.isArray(j) ? j : [j];
  } catch (e) {
    return [];
  }
}

function nextSunset(fc, city, epochHint) {
  const offset = fc.utc_offset_seconds || 0;
  const daily = fc.daily || {};
  const idx = {};
  (daily.time || []).forEach((d, k) => { idx[d] = k; });
  const todayStr = API.zonedParts(epochHint || Date.now(), offset).dateStr;
  const tomorrowStr = API.zonedParts((epochHint || Date.now()) + 86400000, offset).dateStr;
  const today = daily.sunset && idx[todayStr] !== undefined ? daily.sunset[idx[todayStr]] : null;
  const useToday = today && A.toEpoch(today, offset) > Date.now();
  const s = useToday ? today : (daily.sunset ? daily.sunset[idx[tomorrowStr]] : null);
  if (!s) return null;
  return { epoch: A.toEpoch(s, offset), offset, tzName: fc.timezone || 'UTC', day: useToday ? 'today' : 'tomorrow' };
}

/**
 * 批量打分（单模式，无集合）。用于「先粗筛」。
 * @param cities [{name, lat, lon, country}]
 * @param opts {chunkCities=8, days=2, concurrency=2}
 * @returns [{city, score, grade, level, epoch, offsetSec, ...}]
 */
async function scoreCities(cities, opts = {}) {
  const perChunk = opts.chunkCities || 6;          // 6 城 × 6 点 = 36 坐标/请求
  const conc = opts.concurrency || 1;
  const delayMs = opts.delayMs == null ? 350 : opts.delayMs;
  const groups = chunk(cities, perChunk);
  const results = [];
  let qi = 0;

  async function worker() {
    while (qi < groups.length) {
      const g = groups[qi++];
      const { coords, map } = expand(g);
      let fc, aq;
      try {
        // 粗筛默认跳过空气质量：省一半调用，A.evaluate 对 aq=null 会按中性处理
        const wantAQ = opts.skipAQ === false;
        await throttle(coords.length * (wantAQ ? 2 : 1));
        const [f0, a0] = await Promise.all([
          fetchBatchForecast(coords, opts.days),
          wantAQ ? fetchBatchAQ(coords, opts.days) : Promise.resolve([])
        ]);
        fc = f0; aq = a0;
      } catch (e) {
        for (const m of map) results.push({ city: m.city, failed: true, error: String(e.message || e) });
        continue;
      }
      for (const m of map) {
        try {
          const f = fc[m.base];
          const a = aq.length ? aq[m.base] : null;
          if (!f) throw new Error('no forecast');
          const ev = nextSunset(f, m.city);
          if (!ev) throw new Error('no sunset');
          const ups = [];
          for (let k = 1; k < COORDS_PER_CITY; k++) {
            const u = fc[m.base + k];
            if (u && u.hourly) ups.push({ hourly: u.hourly, utc_offset_seconds: u.utc_offset_seconds || ev.offset });
          }
          const ov = null;   // 粗筛不用 15 分钟窗口（精算阶段才用）
          const res = A.evaluate(f, a, ups, ev.epoch, m.bearing, ev.offset, ov, UP);
          results.push({
            city: m.city, score: res.score, grade: res.grade, level: res.level,
            conf: res.conf, clarity: res.clarity || null, inputs: res.inputs,
            epoch: ev.epoch, offsetSec: ev.offset, tzName: ev.tzName, day: ev.day,
            bearing: m.bearing, singleModel: true
          });
        } catch (e) {
          results.push({ city: m.city, failed: true, error: String(e.message || e) });
        }
      }
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (opts.onProgress) opts.onProgress(results.length, cities.length);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));

  // 失败的城市串行重试一次（多为 429 / 超时）
  const depth = opts._depth || 0;
  const failed = results.filter((r) => r.failed);
  if (failed.length && depth < 1) {
    const retry = await scoreCities(failed.map((r) => r.city), { chunkCities: 3, concurrency: 1, delayMs: 1200, days: opts.days, _depth: depth + 1 });
    const fixed = new Map(retry.map((r) => [r.city.name, r]));
    for (let i = 0; i < results.length; i++) {
      if (results[i].failed && fixed.has(results[i].city.name)) {
        const f = fixed.get(results[i].city.name);
        if (!f.failed) results[i] = f;
      }
    }
  }
  return results;
}

module.exports = { scoreCities, expand, chunk };
