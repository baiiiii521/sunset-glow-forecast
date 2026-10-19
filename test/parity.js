#!/usr/bin/env node
// 算法对照测试：JS 实现 vs Python predict.py（同一组真实输入）
// 用法：先跑 python3 test/gen_fixture.py 生成 fixture.json，再跑 node test/parity.js
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('../algo.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf-8'));
let failures = 0;
function check(name, actual, expected, tol) {
  const t = tol === undefined ? 0 : tol;
  let ok;
  if (typeof expected === 'number' && typeof actual === 'number') {
    ok = Math.abs(actual - expected) <= t;
  } else {
    ok = JSON.stringify(actual) === JSON.stringify(expected);
  }
  if (!ok) {
    failures++;
    console.log('FAIL', name, '\n  JS:      ', JSON.stringify(actual), '\n  Python:  ', JSON.stringify(expected));
  }
}

// --- 1. 两场完整事件对照（真实数据） ---
const { fc, aq, upSunset, upSunrise, sunsetTime, sunriseTime, offsetSec, lat, todayDoy, tomorrowDoy } = fixture;
const jsSunset = A.evaluate(fc, aq, upSunset, A.toEpoch(sunsetTime, offsetSec), A.sunsetBearing(lat, todayDoy), offsetSec);
const jsSunrise = A.evaluate(fc, aq, upSunrise, A.toEpoch(sunriseTime, offsetSec), A.sunriseBearing(lat, tomorrowDoy), offsetSec);
for (const [label, js, py] of [['今晚晚霞', jsSunset, fixture.python.sunset], ['明日朝霞', jsSunrise, fixture.python.sunrise]]) {
  // v1 条件分与 predict.py 对照；v2 霞分是在其上新增的一层，Python 没有
  check(label + ' score', js.condScore, py.score);
  check(label + ' grade', js.condGrade, py.grade);
  check(label + ' conf', js.condConf, py.conf);
  check(label + ' script', js.script, py.script);
  check(label + ' reasons', js.reasons, py.reasons);
  console.log(label, '→ JS:', js.condGrade, js.condScore, js.condConf, js.script, '(v2 霞分', js.score, js.grade + ')', '| Python:', py.grade, py.score, py.conf, py.script);
}

// --- 2. 分项函数对照电池 ---
for (const item of fixture.battery) {
  const args = item.args.map((a) => (a === null ? null : a));
  let actual;
  if (item.fn === 'destination') {
    const d = A.destination(...args);
    actual = [d.lat, d.lon];
    const exp = [item.expected[0], item.expected[1]];
    check('battery destination', [Math.round(actual[0] * 1e6) / 1e6, Math.round(actual[1] * 1e6) / 1e6],
      [Math.round(exp[0] * 1e6) / 1e6, Math.round(exp[1] * 1e6) / 1e6]);
    continue;
  }
  if (item.fn === 'pyRound') { actual = A.pyRound(args[0]); check('battery pyRound(' + args[0] + ')', actual, item.expected); continue; }
  if (item.fn === 'sunsetBearing') { actual = A.sunsetBearing(...args); check('battery sunsetBearing', actual, item.expected, 1e-9); continue; }
  if (item.fn === 'sunriseBearing') { actual = A.sunriseBearing(...args); check('battery sunriseBearing', actual, item.expected, 1e-9); continue; }
  const fnMap = {
    cCurtain: A.cCurtain, cLow: A.cLow, cGap: A.cGap, cPrecip: A.cPrecip,
    cWashed: A.cWashed, cAod: A.cAod, cVis: A.cVis, cPm: A.cPm,
    cDew: A.cDew, cWind: A.cWind, cCape: A.cCape
  };
  actual = fnMap[item.fn](...args);
  // 分数允许 1e-9 浮点误差；说明文字要求完全一致
  const scoreOk = (actual[0] === null && item.expected[0] === null) ||
    (typeof actual[0] === 'number' && typeof item.expected[0] === 'number' && Math.abs(actual[0] - item.expected[0]) < 1e-9);
  if (!scoreOk || actual[1] !== item.expected[1]) {
    failures++;
    console.log('FAIL battery', item.fn, JSON.stringify(args), '\n  JS:     ', JSON.stringify(actual), '\n  Python: ', JSON.stringify(item.expected));
  }
}

console.log(failures === 0 ? 'PARITY PASS：JS 与 Python 输出一致' : `PARITY FAIL：${failures} 处不一致`);
process.exit(failures === 0 ? 0 : 1);
