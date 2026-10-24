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

function clean(list) {
  const seen = new Set();
  const out = [];
  for (const r of list) {
    if (!r || !r.city) continue;
    const k = norm(r.city.name) + '|' + Number(r.city.lat).toFixed(1);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.sort((a, b) => b.score - a.score || (b.conf === '高' ? 1 : 0) - (a.conf === '高' ? 1 : 0));
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
  stats: { global: counts(g), china: counts(c) },
  global: g.slice(0, 10),
  china: c.slice(0, 10)
};
fs.writeFileSync(outPath + '.tmp', JSON.stringify(payload));
fs.renameSync(outPath + '.tmp', outPath);
fs.writeFileSync(allPath + '.tmp', JSON.stringify({ ...all, global: g, china: c }));
fs.renameSync(allPath + '.tmp', allPath);
console.log(`去重后 全球 ${g.length} / 中国 ${c.length}`);
console.log('全球 #1', payload.global[0].city.name, payload.global[0].score, ' 中国 #1', payload.china[0].city.name, payload.china[0].score);
