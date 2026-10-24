#!/usr/bin/env node
/* ============================================================
 * 霞榜 v3：先把城市池扩到上千座粗筛，再对头部跑完整集合算法取前十。
 *
 * 两段式：
 *   1) 粗筛 scoreCities()：一次请求 8 城 × 6 坐标（本点 + 上游 5 点），单模式
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
const OUT = arg('out', '') || path.join(ROOT, 'data', 'rankings.json');

function readWorld() {
  const p = path.join(ROOT, 'data', 'world-cities.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// 「海口」和「海口市」是同一座城：比较前先去掉行政区后缀
function normName(n) {
  return String(n || '').replace(/[市区县镇]$/, '').trim();
}
function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => {
    const k = normName(c.name) + '|' + Number(c.lat).toFixed(1);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function counts(list) {
  const c = [0, 0, 0, 0, 0, 0];
  list.forEach((r) => { if (r && r.level != null) c[r.level] += 1; });
  return c;
}

(async () => {
  const t0 = Date.now();
  const world = readWorld();

  // ---- 城市池 ----
  const globalPool = dedupe(
    API.GLOBAL_CITIES
      .concat(world.filter((c) => c.cc !== 'CN').slice(0, N_GLOBAL).map((c) => ({ name: c.zh || c.en, country: c.cc, lat: c.lat, lon: c.lon })))
  );
  const chinaPool = dedupe(
    API.CHINA_CITIES
      .concat(world.filter((c) => c.cc === 'CN').slice(0, N_CHINA).map((c) => ({ name: c.zh || c.en, country: '中国', lat: c.lat, lon: c.lon })))
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
        out.push(r);   // 精算失败就退回粗筛结果，不丢城市
      }
    }
    return out;
  };
  const [fineG, fineC] = await Promise.all([refine(headG), refine(headC)]);
  console.error(`${new Date().toISOString()} 精算完成：全球 ${fineG.length} / 中国 ${fineC.length}`);

  const boardG = API.sortBoard(fineG);
  const boardC = API.sortBoard(fineC);
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
    stats: { global: counts(boardG), china: counts(boardC) },
    global: boardG.slice(0, 10).map(slim),
    china: boardC.slice(0, 10).map(slim)
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
