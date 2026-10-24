#!/usr/bin/env node
/* 对已有 rankings-all.json 去重并重排，不消耗任何 API 额度。
 * 用法：node scripts/dedupe-rankings.js <all.json> <out.json>
 */
'use strict';
const fs = require('fs');
const [, , allPath, outPath] = process.argv;
if (!allPath || !outPath) { console.error('用法：node scripts/dedupe-rankings.js <all> <out>'); process.exit(2); }

const norm = (n) => String(n || '').replace(/[市区县镇]$/, '').trim();
const all = JSON.parse(fs.readFileSync(allPath, 'utf8'));

const haversine = (a, b) => {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

function clean(list) {
  const out = [];
  for (const r of list) {
    if (!r || !r.city) continue;
    // 粗分/单模式（精算失败回退的）不进榜：口径不同，会系统性偏高
    if (!r.models || !r.models.length) continue;
    // 与 build-rankings-v3 同规则：同名且 20km 内视为同一城
    if (out.some((k) => norm(k.city.name) === norm(r.city.name) && haversine(k.city, r.city) < 20)) continue;
    out.push(r);
  }
  // 只做同名去重；卫星城合并是 build-rankings-v3 的职责（它有人口数据），这里不重复实现
  return out.sort((a, b) => b.score - a.score);
}

const g = clean(all.global || []);
const c = clean(all.china || []);
const counts = (list) => {
  const arr = [0, 0, 0, 0, 0, 0];
  list.forEach((r) => { if (r.level != null) arr[r.level] += 1; });
  return arr;
};

const payload = {
  version: 3,
  computedAt: all.computedAt,
  universe: { global: g.length, china: c.length, refined: g.length + c.length },
  stats: { global: { counts: counts(g) }, china: { counts: counts(c) } },
  global: g.slice(0, 10),
  china: c.slice(0, 10)
};
fs.writeFileSync(outPath + '.tmp', JSON.stringify(payload));
fs.renameSync(outPath + '.tmp', outPath);
fs.writeFileSync(allPath + '.tmp', JSON.stringify({ ...all, global: g, china: c }));
fs.renameSync(allPath + '.tmp', allPath);
console.log(`去重后 全球 ${g.length} / 中国 ${c.length}`);
console.log('全球 #1', payload.global[0].city.name, payload.global[0].score, ' 中国 #1', payload.china[0].city.name, payload.china[0].score);
