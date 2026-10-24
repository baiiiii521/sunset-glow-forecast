#!/usr/bin/env node
/* ============================================================
 * 离线回放：对 capture-replay.js 采集的原始数据，对比四种口径的霞分：
 *   A 旧口径（gapV2 + 旧时间窗挑最大值）= 线上现状
 *   B 只开时间对齐（FLAGS.windowAlign：全员同刻插值，去掉 best_match 挑最大）
 *   C 只开缺口几何（FLAGS.gapV3：光路几何透射）
 *   D 两者都开
 * 不联网、不耗额度。这是打开影子开关前的决策依据（HANDOFF「该做」#1/#2）。
 *
 * 用法：node scripts/replay-gap.js [目录]
 *   默认 data/replay/；test/fixtures/replay/ 里有入库的样例可直接复演。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
require('../algo.js');
const A = globalThis.SunsetAlgo;
const API = require('../api.js');

const DIR = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, '..', 'data', 'replay');

const COMBOS = [
  { name: 'A旧口径', w: false, g: false },
  { name: 'B时间对齐', w: true, g: false },
  { name: 'C缺口几何', w: false, g: true },
  { name: 'D两者', w: true, g: true }
];

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
if (!files.length) {
  console.error('没有回放数据。先跑：node scripts/capture-replay.js --n 8（或用 test/fixtures/replay/）');
  process.exit(1);
}

const rows = [];
for (const f of files) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); }
  catch (e) { console.error('跳过损坏文件', f); continue; }
  const row = { city: (rec.city && rec.city.name) || f, scores: {}, gaps: {}, members: {} };
  for (const c of COMBOS) {
    A.FLAGS.windowAlign = c.w;
    A.FLAGS.gapV3 = c.g;
    try {
      const res = API.scoreEvent(rec.fc, rec.aq, rec.spec.epoch, rec.spec.bearing,
        rec.spec.offsetSec, rec.ens, rec.spec.upIdx, rec.spec.dist);
      row.scores[c.name] = res ? res.score : null;
      row.gaps[c.name] = res && res.comps && res.comps.gapV3 && res.comps.gapV3[0] != null
        ? Math.round(res.comps.gapV3[0]) : null;
      row.members[c.name] = res && res.ensemble ? res.ensemble.n : 0;
    } catch (e) {
      row.scores[c.name] = null;
    }
  }
  rows.push(row);
}
A.FLAGS.windowAlign = false;
A.FLAGS.gapV3 = false;

// 任何一口径算不出分数都算失败（CI 里这步要能真的报警，不能吞错）
const broken = rows.filter((r) => COMBOS.some((c) => typeof r.scores[c.name] !== 'number'));

console.log('');
console.log('城市'.padEnd(8) + COMBOS.map((c) => c.name.padEnd(10)).join('') + '| gapV3(影子)  成员数');
console.log('-'.repeat(64));
rows.forEach((r) => {
  console.log(r.city.padEnd(8) +
    COMBOS.map((c) => String(r.scores[c.name] == null ? '—' : r.scores[c.name]).padEnd(10)).join('') +
    '| ' + String(r.gaps['C缺口几何'] == null ? '—' : r.gaps['C缺口几何']).padEnd(8) +
    String(r.members['A旧口径']));
});
const mean = (key) => {
  const v = rows.map((r) => r.scores[key]).filter((x) => typeof x === 'number');
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const mA = mean('A旧口径');
['B时间对齐', 'C缺口几何', 'D两者'].forEach((k) => {
  const m = mean(k);
  console.log(`平均 ${k}: ${m == null ? '—' : m.toFixed(1)}（相对 A ${mA == null || m == null ? '—' : (m - mA >= 0 ? '+' : '') + (m - mA).toFixed(1)}）`);
});
console.log(`\n样本 ${rows.length} 城。提示：这是输入冻结的口径对比，不是准确率验证——` +
  `准确率要等标注数据（见 docs/algo-review-2026-10-24.md §D）。正式打开前建议连续数天、≥30 城采样。`);
if (broken.length) {
  console.error(`✗ ${broken.length} 城有口径算分失败：` + broken.map((r) => r.city).join('、'));
  process.exit(1);
}
