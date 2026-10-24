#!/usr/bin/env node
/* ============================================================
 * 霞榜 v3：先把城市池扩到上千座粗筛，再对头部跑完整集合算法取前十。
 *
 * 两段式：
 *   1) 粗筛 scoreCities()：一次请求 6 城 × 4 坐标（本点 + 3 个上游点）（本点 + 上游 5 点），单模式
 *   2) 精算 API.evaluateNextSunset()：4 模式集合 + 上游 + 15 分钟窗口，与网页同口径
 *
 * 用法：
 *   node scripts/build-rankings-v3.js --global 600 --china 400 --top 60
 * 输出：
 *   data/rankings.json      前十 + 统计（网页读这份）
 *   data/rankings-all.json  精算过的全部城市（霞榜页「全部城市」用）
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
require('../algo.js');
const API = require('../api.js');
const { scoreCities } = require('./lib/score-batch.js');
const { validateRankings } = require('./lib/validate-rankings.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  if (i < 0) return def;
  const v = args[i + 1];
  return typeof def === 'string' ? v : Number(v);
}
const N_GLOBAL = arg('global', 600);
const N_CHINA = arg('china', 400);
const TOP_K = arg('top', 60);
// 粗筛是「过滤器」不是「排名」：只筛出和最终名额一样多的城市，等于零余量。
// 实测（scripts/measure-coarse-recall.js，60 城抽样）：粗筛前 5 只覆盖精算前 5 的 60%，
// 前 10 覆盖 80%，前 20 覆盖 90%。所以这里按倍数放量，再靠精算收敛。
const HEAD_MULT = arg('head-mult', 3);
const REFRESH = arg('refresh', 0);   // >0：只重算现有榜单前 N 名（15:00 轻量刷新）
const OUT = arg('out', '') || path.join(ROOT, 'data', 'rankings.json');

function readWorld() {
  const p = path.join(ROOT, 'data', 'world-cities.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// 「海口」和「海口市」是同一座城：比较前先去掉行政区后缀
function normName(n) {
  return String(n || '').replace(/[市区县镇]$/, '').trim();
}

// 世界城市表里少数城市没有中文名（如 Zhuanghe），用 points-china 里最近的点补上
let _cnPts = null;
function cnPoints() {
  if (_cnPts) return _cnPts;
  try {
    _cnPts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'points-china.json'), 'utf8')).points || [];
  } catch (e) { _cnPts = []; }
  return _cnPts;
}
function zhNear(lat, lon) {
  let best = null, bd = 1e9;
  for (const p of cnPoints()) {
    const d = haversine({ lat, lon }, p);
    if (d < bd) { bd = d; best = p; }
  }
  return bd <= 25 && best ? best.name : null;
}

function dedupe(list) {
  const kept = [];
  for (const c of list) {
    const dup = kept.find((k) => normName(k.name) === normName(c.name) && haversine(k, c) < 20);
    if (!dup) kept.push(c);
  }
  return kept;
}

// 人口表（用于识别卫星城）：名字归一化后取最大人口
const norm = (n) => String(n || '').replace(/[市区县镇]$/, '').trim();
let POP = null;
function buildPop(worldList) {
  POP = new Map();
  worldList.forEach((c) => {
    const k = norm(c.zh || c.en);
    if (k && (!POP.has(k) || POP.get(k) < c.pop)) POP.set(k, c.pop);
  });
}
const popOf = (city) => (POP ? POP.get(norm(city.name)) : 0) || 0;

function haversine(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 卫星城并入母城：60km 内、人口不到母城 90% 的直接丢掉
function mergeSatellites(list) {
  const arr = list.map((r) => ({ r, pop: popOf(r.city) })).sort((a, b) => b.pop - a.pop);
  const kept = [];
  for (const it of arr) {
    const near = kept.find((k) => haversine(k.r.city, it.r.city) < 60);
    if (near && it.pop < near.pop * 0.9) continue;
    kept.push(it);
  }
  return kept.map((x) => x.r);
}

function counts(list) {
  const c = [0, 0, 0, 0, 0, 0];
  list.forEach((r) => { if (r && r.level != null) c[r.level] += 1; });
  return c;
}

(async () => {
  const t0 = Date.now();
  // 预检额度：Open-Meteo 免费层按天/小时限流，额度用光时整轮会全是 429。
  // 先打一发探针，早失败比跑一小时才发现好。
  try {
    const probeURL = 'https://api.open-meteo.com/v1/forecast?latitude=21.27&longitude=110.36&hourly=cloud_cover&forecast_days=1';
    const probe = await fetch(probeURL);
    if (probe.status === 429) {
      // 本机额度用尽：若配了备用出口（GLOW_OM_BASE，如华为云 relay 隧道），先探它，
      // 通了就继续跑（api.js 的 fetchJSON 会在直连 429 时自动切到备用出口）。
      const relay = process.env.GLOW_OM_BASE;
      let viaRelay = false;
      if (relay) {
        try {
          viaRelay = (await fetch(relay + '/v1/forecast?latitude=21.27&longitude=110.36&hourly=cloud_cover&forecast_days=1')).status === 200;
        } catch (_) { /* 备用出口不可达，视为没配 */ }
      }
      if (viaRelay) {
        console.error(`${new Date().toISOString()} 本机额度已用尽（429），自动切换备用出口 ${relay} 继续本轮`);
      } else {
        console.error(`${new Date().toISOString()} 额度已用尽（429）且无可用备用出口，本轮跳过，保留旧榜单不动`);
        process.exit(2);
      }
    }
  } catch (e) {
    console.error(`${new Date().toISOString()} 预检请求失败：${e.message}，继续尝试`);
  }
  const world = readWorld();
  buildPop(world);

  // ---- 15:00 轻量刷新：只重算已在榜的前 N 名（约 N×11 次调用） ----
  if (REFRESH > 0) {
    const cur = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const picks = (cur.global || []).slice(0, REFRESH).concat((cur.china || []).slice(0, REFRESH));
    const fresh = [];
    for (const r of picks) {
      try {
        const full = await API.evaluateNextSunset({ name: r.city.name, country: r.city.country, lat: r.city.lat, lon: r.city.lon });
        fresh.push(full);
      } catch (e) {
        fresh.push(null);
      }
    }
    const byName = new Map(fresh.filter(Boolean).filter((r) => r.ensemble).map((r) => [r.city.name, r]));
    // 分档计数按差量调整：重算的条目旧档 -1、新档 +1（写盘前的契约校验要求
    // 每档 counts ≥ 榜内条数；直接沿用全量 stats，某城刷新后升档会被拦下导致整轮不落盘）
    const statsAdj = JSON.parse(JSON.stringify(
      cur.stats && cur.stats.global && cur.stats.china
        ? cur.stats : { global: { counts: [0, 0, 0, 0, 0, 0] }, china: { counts: [0, 0, 0, 0, 0, 0] } }
    ));
    const apply = (list, scope) => list.map((r) => {
      const f = byName.get(r.city.name);
      // 没刷新到、或刷新时集合请求失败（单模式回退不带 models，契约不收）：保留旧分并标 stale
      if (!f || f.coarseOnly) return { ...r, stale: true };
      const c = statsAdj[scope] && statsAdj[scope].counts;
      if (c && typeof r.level === 'number' && c[r.level] > 0) c[r.level] -= 1;   // 旧档
      if (c && typeof f.level === 'number') c[f.level] += 1;                     // 新档
      return { city: f.city, score: f.score, grade: f.grade, level: f.level, conf: f.conf,
        clarity: f.clarity || null, models: f.ensemble ? f.ensemble.members.map((m) => [m.label, m.score]) : null,
        epoch: f.epoch, offsetSec: f.offsetSec, tzName: f.tzName, day: f.day, stale: false };
    });
    const okN = byName.size;   // 真正入了榜的重算数（单模式拒收不算）
    if (okN === 0) {
      console.error(`${new Date().toISOString()} 轻量刷新全部失败（或全部被拒收），保留原榜单不动`);
      return;
    }
    const out = {
      ...cur,
      refreshedAt: Date.now(),   // 不动 computedAt：避免把旧分数伪装成新榜单
      refresh: { ok: okN, total: picks.length, at: Date.now(), partial: okN < picks.length },
      stats: statsAdj,           // 参评池没变，分布按差量调整而不是重算
      global: apply(cur.global || [], 'global').sort((a, b) => b.score - a.score),
      china: apply(cur.china || [], 'china').sort((a, b) => b.score - a.score)
    };
    // 写盘前在内存里过契约（与 test-rankings-schema 同一套规则）：违约不落盘，退出码 3
    const refreshErrs = validateRankings(out, null);
    if (refreshErrs.length) {
      console.error(`${new Date().toISOString()} 刷新结果契约校验不通过（${refreshErrs.length} 项），不落盘、保留旧榜单：`);
      refreshErrs.slice(0, 10).forEach((e) => console.error('  - ' + e));
      process.exit(3);
    }
    fs.writeFileSync(OUT + '.tmp', JSON.stringify(out));
    fs.renameSync(OUT + '.tmp', OUT);
    console.error(`${new Date().toISOString()} 轻量刷新完成：${okN}/${picks.length} 城重算`);
    console.log(`全球 #1 ${out.global[0].city.name} ${out.global[0].score}  中国 #1 ${out.china[0].city.name} ${out.china[0].score}`);
    return;
  }



  // ---- 城市池 ----
  // 世界榜只保留精选大城市（N_GLOBAL<=60 时完全用精选表，避免出现卫星城/郊区）
  const globalPool = dedupe(
    N_GLOBAL <= 60
      ? API.GLOBAL_CITIES.slice(0, N_GLOBAL)
      : API.GLOBAL_CITIES.concat(world.filter((c) => c.cc !== 'CN').slice(0, N_GLOBAL).map((c) => ({ name: c.zh || c.en, country: c.cc, lat: c.lat, lon: c.lon })))
  );
  const chinaPool = dedupe(
    API.CHINA_CITIES
      .concat(world.filter((c) => c.cc === 'CN').slice(0, N_CHINA).map((c) => ({ name: c.zh || c.en, country: '中国', lat: c.lat, lon: c.lon })))
  ).map((c) => {
    // 中国榜必须是中文名：没有中日韩字符的，用最近的中国行政区名替换
    if (/[\u4e00-\u9fa5]/.test(c.name)) return c;
    const zh = zhNear(c.lat, c.lon);
    return zh ? { ...c, name: zh } : c;
  });

  console.error(`${new Date().toISOString()} 城市池：全球 ${globalPool.length} / 中国 ${chinaPool.length}`);

  // ---- 第一段：粗筛 ----
  const [roughG, roughC] = await Promise.all([
    scoreCities(globalPool, { chunkCities: 8, concurrency: 2 }),
    scoreCities(chinaPool, { chunkCities: 8, concurrency: 2 })
  ]);
  const okG = roughG.filter((r) => !r.failed);
  const okC = roughC.filter((r) => !r.failed);
  console.error(`${new Date().toISOString()} 粗筛完成：全球 ${okG.length} / 中国 ${okC.length}（失败 ${roughG.length - okG.length + roughC.length - okC.length}）`);

  // ---- 第二段：头部精算（完整集合） ----
  const headG = API.sortBoard(okG).slice(0, TOP_K * HEAD_MULT);
  const headC = API.sortBoard(okC).slice(0, TOP_K * HEAD_MULT);
  const refine = async (list) => {
    const out = [];
    let dropped = 0;
    for (const r of list) {
      try {
        const full = await API.evaluateNextSunset({ name: r.city.name, country: r.city.country, lat: r.city.lat, lon: r.city.lon });
        // 集合请求失败的单模式回退不带 4 模式分数（models 为 null 违反契约），
        // 且缺上游数据的单模式本身已被封顶 34——不参与排名，只保留但不入选
        if (!full.ensemble) { dropped++; out.push({ ...r, coarseOnly: true }); continue; }
        out.push(full);
      } catch (e) {
        // 精算失败：不把粗分混进榜单参与排名，只保留但不入选
        out.push({ ...r, coarseOnly: true });
      }
    }
    if (dropped) console.error(`${new Date().toISOString()} 精算因集合缺失拒收 ${dropped} 城（单模式回退不入榜）`);
    return out;
  };
  const [fineG, fineC] = await Promise.all([refine(headG), refine(headC)]);
  console.error(`${new Date().toISOString()} 精算完成：全球 ${fineG.length} / 中国 ${fineC.length}（粗筛放量 ×${HEAD_MULT}）`);

  const byScore = (list) => list
    .sort((a, b) => b.score - a.score);
  // 先剔除粗分（精算失败 / 集合缺失的单模式回退），再做卫星城合并——
  // 否则一个被拒收的大城市会把 60km 内正常精算过的卫星城也一起挤掉
  const boardG = byScore(mergeSatellites(fineG.filter((r) => !r.coarseOnly)));
  const boardC = byScore(mergeSatellites(fineC.filter((r) => !r.coarseOnly)));
  if (boardG.length < 5 || boardC.length < 5) {
    throw new Error(`有效城市太少（全球 ${boardG.length}、中国 ${boardC.length}），保留旧榜单`);
  }

  const slim = (r) => ({
    city: r.city, score: r.score, grade: r.grade, level: r.level, conf: r.conf,
    clarity: r.clarity || null,
    models: r.ensemble ? r.ensemble.members.map((m) => [m.label, m.score]) : null,
    epoch: r.epoch, offsetSec: r.offsetSec, tzName: r.tzName, day: r.day
  });

  const payload = {
    version: 3,
    computedAt: Date.now(),
    universe: { global: globalPool.length, china: chinaPool.length, refined: fineG.length + fineC.length },
    stats: { global: { counts: counts(boardG) }, china: { counts: counts(boardC) } },
    global: boardG.slice(0, TOP_K).map(slim),
    china: boardC.slice(0, TOP_K).map(slim)
  };
  const all = {
    version: 3,
    computedAt: payload.computedAt,
    global: boardG.map(slim),
    china: boardC.map(slim)
  };

  // 写盘前在内存里过一遍契约（与 test-rankings-schema 同一套规则）：
  // 违约不落盘、退出码 3（与额度用尽的 2 区分），旧榜单原样保留
  const writeErrs = validateRankings(payload, all);
  if (writeErrs.length) {
    console.error(`${new Date().toISOString()} 榜单契约校验不通过（${writeErrs.length} 项），不落盘、保留旧榜单：`);
    writeErrs.slice(0, 10).forEach((e) => console.error('  - ' + e));
    process.exit(3);
  }

  // 落盘顺序固定：先 all、后 rankings——前端只读 rankings，
  // 任何时刻它读到的都是已通过完整校验的一版
  const tmp = OUT + '.tmp';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const allPath = path.join(path.dirname(OUT), 'rankings-all.json');
  fs.writeFileSync(allPath + '.tmp', JSON.stringify(all));
  fs.renameSync(allPath + '.tmp', allPath);
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, OUT);

  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.error(`${new Date().toISOString()} 完成 ${secs}s  池 ${payload.universe.global}+${payload.universe.china}  精算 ${payload.universe.refined}`);
  console.log(`全球 #1 ${payload.global[0].city.name} ${payload.global[0].score}  中国 #1 ${payload.china[0].city.name} ${payload.china[0].score}`);
})().catch((e) => {
  console.error('FAILED', e && e.message);
  process.exit(1);
});
