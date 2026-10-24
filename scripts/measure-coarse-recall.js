#!/usr/bin/env node
/* ============================================================
 * 粗筛召回率回放：粗排前 K 里，漏掉了多少「精算后真的该上榜」的城市
 *
 * 背景：霞榜是两段式——粗筛（跳过空气质量、不用 15 分钟窗口）挑前 K，
 *       再对这 K 个做精算。如果粗筛把真正的高分城筛掉了，榜单就会漏城，
 *       而这种漏是「看不见的」，必须单独量。
 *
 * 用法：
 *   node scripts/measure-coarse-recall.js --scope china --n 60 --k 10,20
 *   node scripts/measure-coarse-recall.js --scope global --n 40 --k 5,10
 *
 * 成本：n 城粗筛 ≈ n/6×4 次请求；n 城精算 ≈ n×11 次。默认节流 70/分。
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
require(path.join(__dirname, '..', 'algo.js'));
const API = require(path.join(__dirname, '..', 'api.js'));
const { scoreCities } = require('./lib/score-batch.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const SCOPE = arg('scope', 'china');
const N = parseInt(arg('n', '60'), 10);
const KS = String(arg('k', '5,10,20')).split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0);

function pool() {
  if (SCOPE === 'global') return API.GLOBAL_CITIES.slice();
  // 与 build-rankings-v3 一致：精选城市 + world-cities 里的中国城市
  let world = [];
  try {
    world = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'world-cities.json'), 'utf8'));
  } catch (e) { world = []; }
  const cn = world.filter((c) => c.cc === 'CN').map((c) => ({ name: c.zh || c.en, country: '中国', lat: c.lat, lon: c.lon }));
  return API.CHINA_CITIES.concat(cn);
}

// 等距抽样：可复现，不随机
function sample(list, n) {
  if (list.length <= n) return list.slice();
  const step = list.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.floor(i * step)]);
  return out;
}

const topK = (rows, k) => rows.slice().sort((a, b) => b.score - a.score).slice(0, k);

(async () => {
  const cities = sample(pool(), N);
  console.error(`${new Date().toISOString()} 回放开始：${SCOPE} 抽样 ${cities.length} 城，K=${KS.join('/')}`);

  // 1) 粗筛：和榜单脚本同一条路径
  const t0 = Date.now();
  const coarse = (await scoreCities(cities, { chunkCities: 6, concurrency: 1 })).filter((r) => !r.failed);
  console.error(`粗筛完成 ${coarse.length}/${cities.length} 城，用时 ${Math.round((Date.now() - t0) / 1000)}s`);

  // 2) 精算：逐城走完整链路（含空气质量、15 分钟窗口、多模式集合）
  const fine = [];
  for (const c of cities) {
    await new Promise((r) => setTimeout(r, 1500));   // 约 440 次/分，低于免费额度
    try {
      const r = await API.evaluateNextSunset({ name: c.name, country: c.country, lat: c.lat, lon: c.lon });
      fine.push({ name: c.name, score: r.score, level: r.level, grade: r.grade });
    } catch (e) {
      fine.push({ name: c.name, failed: true, error: String(e.message || e) });
    }
  }
  const fineOk = fine.filter((r) => !r.failed);
  console.error(`精算完成 ${fineOk.length}/${cities.length} 城`);

  // 3) 召回率：粗排前 K 覆盖了多少精算前 K
  const report = { scope: SCOPE, n: cities.length, coarseOk: coarse.length, fineOk: fineOk.length, at: new Date().toISOString(), k: {} };
  KS.forEach((k) => {
    const cTop = topK(coarse.map((r) => ({ name: r.city.name, score: r.score })), k);
    const fTop = topK(fineOk.map((r) => ({ name: r.name, score: r.score })), k);
    const cSet = new Set(cTop.map((x) => x.name));
    const hit = fTop.filter((x) => cSet.has(x.name));
    report.k[k] = {
      recall: +(hit.length / Math.max(1, fTop.length)).toFixed(3),
      hit: hit.length,
      of: fTop.length,
      missed: fTop.filter((x) => !cSet.has(x.name)).map((x) => x.name + ' ' + x.score)
    };
  });

  // 4) 整体秩相关：粗排顺序能不能代表精排顺序
  const byName = new Map(coarse.map((r) => [r.city.name, r.score]));
  const pairs = fineOk.filter((r) => byName.has(r.name)).map((r) => [byName.get(r.name), r.score]);
  const nP = pairs.length;
  let d2 = 0;
  const rankOf = (vals) => {
    const sorted = vals.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const m = new Map();
    sorted.forEach(([, i], r) => m.set(i, r + 1));
    return m;
  };
  const r1 = rankOf(pairs.map((p) => p[0])), r2 = rankOf(pairs.map((p) => p[1]));
  for (let i = 0; i < nP; i++) d2 += Math.pow((r1.get(i) || 0) - (r2.get(i) || 0), 2);
  report.spearman = nP > 2 ? +(1 - (6 * d2) / (nP * (nP * nP - 1))).toFixed(3) : null;

  const outFile = path.join(__dirname, '..', 'data', `coarse-recall-${SCOPE}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ report, coarse, fine }, null, 1));

  console.log(JSON.stringify(report, null, 1));
  console.error(`明细已写入 ${outFile}`);
})().catch((e) => { console.error('回放失败：', e); process.exit(1); });
