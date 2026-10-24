#!/usr/bin/env node
/* ============================================================
 * 每小时热门城市快照：给「首屏秒开 + 429 降级」用。
 * 只算「下一场日落」的摘要，不含七日明细（七日仍由浏览器实时拉）。
 *
 * 用法：node scripts/build-snapshots.js [城市数，默认 200]
 * 输出：data/snapshots.json
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
require('../algo.js');
const API = require('../api.js');
const { scoreCities } = require('./lib/score-batch.js');

const ROOT = path.join(__dirname, '..');
const LIMIT = Number(process.argv[2] || 20);   // 免费额度下建议 20，付费档可到 200
const OUT = path.join(ROOT, 'data', 'snapshots.json');

const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'world-cities.json'), 'utf8'));

function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => {
    const k = c.name + '|' + Number(c.lat).toFixed(2);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function fromRankings() {
  const rk = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'rankings.json'), 'utf8'));
  const all = (rk.global || []).concat(rk.china || []);
  const cities = {};
  all.forEach((r) => {
    if (!r || !r.city) return;
    // 方位角现场算（榜单里没存），零 API 成本；epoch/lat 不合法时存 null，前端显示 —
    let bearing = null;
    const d = new Date(r.epoch);
    if (r.epoch && isFinite(d.getTime()) && typeof r.city.lat === 'number') {
      const doy = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
        Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
      const b = globalThis.SunsetAlgo.sunsetBearing(r.city.lat, doy);
      bearing = isFinite(b) ? b : null;
    }
    cities[r.city.name + '|' + Number(r.city.lat).toFixed(2) + '|' + Number(r.city.lon).toFixed(2)] = {
      score: r.score, grade: r.grade, level: r.level, conf: r.conf,
      clarity: r.clarity || null, epoch: r.epoch, offsetSec: r.offsetSec,
      tzName: r.tzName, bearing: bearing, day: r.day
    };
  });
  const payload = { version: 1, computedAt: rk.computedAt, count: Object.keys(cities).length, source: 'rankings', cities };
  fs.writeFileSync(OUT + '.tmp', JSON.stringify(payload));
  fs.renameSync(OUT + '.tmp', OUT);
  console.error(`快照（来自榜单）${payload.count} 城  ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
}

(async () => {
  if (process.argv.includes('--from-rankings')) { fromRankings(); return; }
  const t0 = Date.now();
  const pool = dedupe(
    API.CHINA_CITIES
      .concat(API.GLOBAL_CITIES)
      .concat(world.slice(0, LIMIT).map((c) => ({ name: c.zh || c.en, country: c.cc, lat: c.lat, lon: c.lon })))
  ).slice(0, LIMIT);

  const rows = await scoreCities(pool, { chunkCities: 6, concurrency: 1, delayMs: 350 });
  const ok = rows.filter((r) => !r.failed);
  if (ok.length < 20) throw new Error(`快照有效城市太少（${ok.length}）`);

  const cities = {};
  ok.forEach((r) => {
    cities[r.city.name + '|' + Number(r.city.lat).toFixed(2) + '|' + Number(r.city.lon).toFixed(2)] = {
      score: r.score, grade: r.grade, level: r.level, conf: r.conf,
      clarity: r.clarity || null, epoch: r.epoch, offsetSec: r.offsetSec,
      tzName: r.tzName, bearing: r.bearing, day: r.day
    };
  });

  const payload = { version: 1, computedAt: Date.now(), count: Object.keys(cities).length, cities };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT + '.tmp', JSON.stringify(payload));
  fs.renameSync(OUT + '.tmp', OUT);
  console.error(`${new Date().toISOString()} 快照 ${payload.count} 城  ${((Date.now() - t0) / 1000).toFixed(0)}s  ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
})().catch((e) => { console.error('FAILED', e && e.message); process.exit(1); });
