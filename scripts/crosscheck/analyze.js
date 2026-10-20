'use strict';
// node scripts/crosscheck/analyze.js <article.json> <ours.json>
// article.json 格式：{sections: {'today|sunset': {top10: [[地点名, 等级, 蓝天质量]...], counts: [六档计数], review?: true}, ...}}
// 每段：对方前 10 vs 其余点，在我们各种分数下的 AUC（0.5 = 无关，1 = 完全一致）；并列出对方前 10 的我们的输入。
const art = require(require('path').resolve(process.argv[2]));
const ours = require(require('path').resolve(process.argv[3])).points;
function auc(pos, neg) {
  let w = 0, n = 0;
  for (const a of pos) for (const b of neg) { if (a == null || b == null) continue; n++; w += a > b ? 1 : a === b ? 0.5 : 0; }
  return n ? (w / n).toFixed(2) : '-';
}
const f = (x) => (x == null ? '  -' : String(Math.round(x)).padStart(3));
for (const [key, sec] of Object.entries(art.sections)) {
  const top = new Set(sec.top10.map((t) => t[0]));
  const P = ours.filter((p) => top.has(p.name)), N = ours.filter((p) => !top.has(p.name));
  const score = (fn) => auc(P.map(fn), N.map(fn));
  const models = ['综合', 'ECMWF', 'GFS', 'ICON', 'CMA'];
  console.log(`\n== ${key}${sec.review ? '（回顾）' : ''}  对方前10在我们点集中 ${P.length}/10，其余 ${N.length}`);
  console.log('AUC 霞分', score((p) => p.ev[key].score), '| 条件分v1', score((p) => p.ev[key].cond),
    '|', models.map((m) => m + ' ' + score((p) => p.ev[key].models && p.ev[key].models[m])).join(' '),
    '| 幕布', score((p) => p.ev[key].comps.curtain), '缺口', score((p) => p.ev[key].comps.gap), '低云', score((p) => p.ev[key].comps.low),
    '| 通透度', score((p) => p.ev[key].clarity));
  const all = ours.map((p) => p.ev[key].score).sort((a, b) => b - a);
  const lv = [0, 0, 0, 0, 0, 0]; ours.forEach((p) => lv[p.ev[key].level]++);
  console.log('我们全部点分档', lv.join(','), '| 对方全国分档', sec.counts.join(','));
  console.log('地点        对方   我们 名次 | 中 高 低 | 上游 | AOD PM 能见 | 幕 缺 低 | 各模式');
  for (const t of sec.top10) {
    const p = ours.find((x) => x.name === t[0]); if (!p) continue;
    const e = p.ev[key], i = e.inputs;
    console.log(t[0].padEnd(6, '　'), t[1].padEnd(4, '　'), f(e.score), e.grade.padEnd(4, '　'), String(all.indexOf(e.score) + 1).padStart(2),
      '|', f(i.mid), f(i.high), f(i.low), '|', f(i.upTotalAvg), '|', i.aod == null ? '-' : i.aod.toFixed(2), f(i.pm), f(i.visKm),
      '|', f(e.comps.curtain), f(e.comps.gap), f(e.comps.low), '|', e.models ? Object.values(e.models).join('/') : '');
  }
}
