'use strict';
// 批量评估：node scripts/crosscheck/run.js <仓库目录> <points.json> <输出.json>
// points.json = [{name, lat, lon}]。用于和外部预报 / 实况交叉对比（数据放仓库外，见 docs/HANDOFF.md）。
// 每点算四场（today|sunrise, today|sunset, tomorrow|sunrise, tomorrow|sunset），点间停 1.5s 避开 Open-Meteo 分钟限流。
// 「today|sunrise」在事后运行时用的是最新一轮预报，可当作对已发生场次的事后估计。
const [REPO, PTS, OUT] = process.argv.slice(2);
require(REPO + '/algo.js');
const API = require(REPO + '/api.js');
const P = require(require('path').resolve(PTS));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const out = { ranAt: new Date().toISOString(), points: [] };
  for (const p of P) {
    let r = null;
    for (let t = 0; t < 3 && !r; t++) {
      try { r = await API.evaluatePlace(p.lat, p.lon); } catch (e) { console.error(p.name, e.message); await sleep(20000); }
    }
    if (!r) continue;
    const ev = {};
    for (const e of r.events) {
      ev[e.day + '|' + e.type] = {
        score: e.score, grade: e.grade, level: e.level, conf: e.conf, cond: e.condScore,
        clarity: e.clarity && e.clarity.level,
        models: e.ensemble ? Object.fromEntries(e.ensemble.members.map((m) => [m.label, m.score])) : null,
        inputs: e.inputs,
        comps: Object.fromEntries(Object.entries(e.comps).map(([k, v]) => [k, v[0] == null ? null : Math.round(v[0])]))
      };
    }
    out.points.push({ name: p.name, lat: p.lat, lon: p.lon, ev });
    console.log(p.name, ['today|sunrise', 'today|sunset', 'tomorrow|sunrise', 'tomorrow|sunset'].map((k) => ev[k].score + ev[k].grade).join(' | '));
    await sleep(1500);
  }
  require('fs').writeFileSync(OUT, JSON.stringify(out));
})();
