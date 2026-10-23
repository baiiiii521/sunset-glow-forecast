// 与 super朝霞晚霞预报 10-22 文章对账（5 城市 × 今明 4 场）
const algo = require('../algo.js');
global.SunsetAlgo = algo;
const api = require('../api.js');

const CITIES = [
  ['深圳南山区', 22.533, 113.93],
  ['广州越秀区', 23.13, 113.26],
  ['上海闵行区', 31.11, 121.38],
  ['西安碑林区', 34.23, 108.94],
  ['深圳龙华区', 22.66, 114.03],
];

(async () => {
  for (const [name, lat, lon] of CITIES) {
    try {
      const r = await api.evaluatePlace(lat, lon);
      const rows = r.events.map(e => {
        const when = e.day === 'today' ? '今天' : '明天';
        const ev = e.type === 'sunrise' ? '朝霞' : '晚霞';
        return `${when}${ev}: ${e.grade} ${e.score}分`;
      });
      console.log(`${name.padEnd(6)} ${rows.join(' ｜ ')}`);
    } catch (e) {
      console.log(`${name.padEnd(6)} ERR ${String(e.message).slice(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
})();
