#!/usr/bin/env node
/* ============================================================
 * 采集回放数据：每城 3 个请求（预报 / 空气质量 / 多模式集合），原始返回落盘。
 * 用途：冻结输入，让 scripts/replay-gap.js 离线对比新旧算法口径——
 *       零额度、输入零漂移，这是打开 algo.js FLAGS 影子开关前的必要证据。
 *
 * 用法：
 *   node scripts/capture-replay.js --n 8              # 默认采 8 城（约 24 次调用）
 *   node scripts/capture-replay.js --n 8 --trim 2     # 另存 2 份样例到 test/fixtures/replay/（入库，供 CI / 本地复演）
 *
 * 原始数据写 data/replay/（data/ 已 gitignore，不入库）。
 * 正式打开新口径前，建议连续几天采 ≥30 城（每天约 100 次调用）。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
require('../algo.js');
const A = globalThis.SunsetAlgo;
const API = require('../api.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const N = Number(arg('n', 8));
const TRIM = Number(arg('trim', 0));
const DIR = path.join(__dirname, '..', 'data', 'replay');

const POOL = []
  .concat(API.GLOBAL_CITIES.slice(0, Math.ceil(N / 2)))
  .concat(API.CHINA_CITIES.slice(0, N - Math.ceil(N / 2)))
  .slice(0, N);

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const saved = [];
  for (const city of POOL) {
    try {
      const fc = await API.fetchJSON(API.forecastURL(city.lat, city.lon, 'auto', 3));
      const offset = fc.utc_offset_seconds || 0;
      const tzName = fc.timezone || 'UTC';
      const daily = fc.daily || {};
      const idx = {};
      (daily.time || []).forEach((d, k) => { idx[d] = k; });
      const todayStr = API.zonedParts(Date.now(), offset).dateStr;
      const tmrStr = API.zonedParts(Date.now() + 86400000, offset).dateStr;
      const todayS = daily.sunset && idx[todayStr] !== undefined ? daily.sunset[idx[todayStr]] : null;
      const useToday = todayS && A.toEpoch(todayS, offset) > Date.now();
      const sStr = useToday ? todayS : (daily.sunset ? daily.sunset[idx[tmrStr]] : null);
      if (!sStr) throw new Error('no sunset');
      const epoch = A.toEpoch(sStr, offset);
      const parts = API.zonedParts(epoch, offset);
      const doy = API.dayOfYear(parts.y, parts.m, parts.day);
      const bearing = A.sunsetBearing(city.lat, doy);
      const ep = API.ensemblePoints(city.lat, city.lon, [bearing]);
      const [aq, ens] = await Promise.all([
        API.fetchJSON(API.aqURL(city.lat, city.lon, tzName, 3)).catch(() => null),
        API.fetchEnsemble(ep.points, tzName, 3)
      ]);
      const rec = {
        city: { name: city.name, country: city.country || '' },
        lat: city.lat, lon: city.lon, capturedAt: Date.now(),
        fc, aq, ens,
        spec: { epoch, bearing, offsetSec: offset, tzName, day: useToday ? 'today' : 'tomorrow', upIdx: ep.upIdx[0], dist: ep.dist }
      };
      const file = path.join(DIR, city.name + '.json');
      fs.writeFileSync(file, JSON.stringify(rec));
      saved.push(rec);
      console.error(`已采集 ${city.name}（${useToday ? '今天' : '明天'}日落，霞分影子见 replay-gap）`);
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      console.error(`跳过 ${city.name}: ${e.message}`);
    }
  }
  if (TRIM > 0 && saved.length) {
    const trimDir = path.join(__dirname, '..', 'test', 'fixtures', 'replay');
    fs.mkdirSync(trimDir, { recursive: true });
    saved.slice(0, TRIM).forEach((rec) => {
      fs.writeFileSync(path.join(trimDir, rec.city.name + '.json'), JSON.stringify(rec));
    });
    console.error(`另存 ${Math.min(TRIM, saved.length)} 份样例到 test/fixtures/replay/（入库）`);
  }
  console.error(`完成：${saved.length}/${POOL.length} 城已写入 ${DIR}`);
})().catch((e) => { console.error('FAILED', e && e.message); process.exit(1); });
