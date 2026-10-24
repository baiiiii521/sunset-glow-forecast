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
    const byName = new Map(fresh.filter(Boolean).map((r) => [r.city.name, r]));
    const apply = (list) => list.map((r) => {
      const f = byName.get(r.city.name);
      if (!f) return r;
      // 精算失败回退的粗分不替换（口径不同，会让排序失真）
      if (f.coarseOnly) return r;
      return { city: f.city, score: f.score, grade: f.grade, level: f.level, conf: f.conf,
        clarity: f.clarity || null, models: f.ensemble ? f.ensemble.members.map((m) => [m.label, m.score]) : null,
        epoch: f.epoch, offsetSec: f.offsetSec, tzName: f.tzName, day: f.day };
    });
    const okN0 = fresh.filter(Boolean).length;
    if (okN0 === 0) {
      console.error(`${new Date().toISOString()} 轻量刷新全部失败，保留原榜单不动`);
      return;
    }
    const out = {
      ...cur,
      refreshedAt: Date.now(),   // 不动 computedAt：避免把旧分数伪装成新榜单
      stats: cur.stats || { global: { counts: [] }, china: { counts: [] } },   // 参评池没变，分布沿用上一次全量
      global: apply(cur.global || []).sort((a, b) => b.score - a.score),
      china: apply(cur.china || []).sort((a, b) => b.score - a.score)
    };
    fs.writeFileSync(OUT + '.tmp', JSON.stringify(out));
    fs.renameSync(OUT + '.tmp', OUT);
    const okN = okN0;
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
      .concat(world.filter((c) => c.cc === 'CN').slice(0, N_CHINA).map((c) => ({ name: c.zh || zhNear(c.lat, c.lon) || c.en, country: '中国', lat: c.lat, lon: c.lon })))
  );

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
  const headG = API.sortBoard(okG).slice(0, TOP_K);
  const headC = API.sortBoard(okC).slice(0, TOP_K);
  const refine = async (list) => {
    const out = [];
    for (const r of list) {
      try {
        const full = await API.evaluateNextSunset({ name: r.city.name, country: r.city.country, lat: r.city.lat, lon: r.city.lon });
        out.push(full);
      } catch (e) {
        // 精算失败：不把粗分混进榜单参与排名，只保留但不入选
        out.push({ ...r, coarseOnly: true });
      }
    }
    return out;
  };
  const [fineG, fineC] = await Promise.all([refine(headG), refine(headC)]);
  console.error(`${new Date().toISOString()} 精算完成：全球 ${fineG.length} / 中国 ${fineC.length}`);

  const byScore = (list) => list
    .filter((r) => !r.coarseOnly)                       // 粗分不参与排名
    // 只排除精算失败回退的粗分；ensemble 缺失只影响置信度，不该把城市整座剔除
    .sort((a, b) => b.score - a.score);
  const boardG = byScore(mergeSatellites(fineG));
  const boardC = byScore(mergeSatellites(fineC));
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

  const tmp = OUT + '.tmp';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, OUT);
  const allPath = path.join(path.dirname(OUT), 'rankings-all.json');
  fs.writeFileSync(allPath + '.tmp', JSON.stringify(all));
  fs.renameSync(allPath + '.tmp', allPath);

  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.error(`${new Date().toISOString()} 完成 ${secs}s  池 ${payload.universe.global}+${payload.universe.china}  精算 ${payload.universe.refined}`);
  console.log(`全球 #1 ${payload.global[0].city.name} ${payload.global[0].score}  中国 #1 ${payload.china[0].city.name} ${payload.china[0].score}`);
})().catch((e) => {
  console.error('FAILED', e && e.message);
  process.exit(1);
});
