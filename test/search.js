#!/usr/bin/env node
// 搜索对照测试：南阳 bug 修复验证（真实地理编码 API）
// 用法：node test/search.js
'use strict';
const API = require('../api.js');

async function main() {
  let failures = 0;
  const nanyang = await API.searchPlaces('南阳');
  console.log('搜「南阳」返回', nanyang.length, '条：');
  nanyang.forEach((p, i) => console.log(' ', i + 1, p.name, '|', p.admin1, '|', p.admin2, '|', p.lat, p.lon, '| 人口', p.population, '|', p.feature));
  const first = nanyang[0];
  const ok = first && (first.name === '南阳市' || first.name === '南阳') &&
    (first.admin1 === '河南' || first.admin1 === 'Henan') &&
    Math.abs(first.lat - 33.00524) < 0.01 && Math.abs(first.lon - 112.54659) < 0.01 &&
    first.population === 1811812;
  if (!ok) { failures++; console.log('FAIL：搜「南阳」第一条不是南阳市（河南，33.00524/112.54659，人口 1811812）'); }
  else console.log('PASS：搜「南阳」第一条是南阳市（河南）');

  const kyoto = await API.searchPlaces('京都');
  console.log('搜「京都」第一条：', kyoto[0] && kyoto[0].name, '|', kyoto[0] && kyoto[0].admin1, '|', kyoto[0] && kyoto[0].lat, kyoto[0] && kyoto[0].lon);
  if (!kyoto[0] || !/京都|Kyoto/.test(kyoto[0].name)) { failures++; console.log('FAIL：搜「京都」第一条不是京都'); }
  else console.log('PASS：搜「京都」第一条是京都');

  console.log(failures === 0 ? 'SEARCH PASS' : `SEARCH FAIL：${failures} 处不一致`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('SEARCH ERROR', e); process.exit(1); });
