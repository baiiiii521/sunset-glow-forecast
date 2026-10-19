#!/usr/bin/env node
// UI 烟雾测试：在 Node 里用最小 DOM 垫片跑通 app.js 全流程（真实 API），
// 验证：首屏加载 → 霞历四场 → 天色时间轴 → 大气剖面 → 榜单单点路径（offsetSec 正确）。
// 用法：node test/smoke.js
'use strict';

global.window = globalThis;
global.window.innerWidth = 1280;
global.window.innerHeight = 900;
global.window.devicePixelRatio = 1;
global.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
global.window.addEventListener = () => {};

// 画布上下文垫片：任意方法调用都返回垫片，属性赋值可存
function canvasCtxStub() {
  return new Proxy({}, {
    get(t, k) { if (k in t) return t[k]; return (...args) => canvasCtxStub(); },
    set(t, k, v) { t[k] = v; return true; }
  });
}
function elStub() {
  const el = {
    textContent: '', innerHTML: '', hidden: false, disabled: false, value: '',
    offsetWidth: 0, style: { setProperty() {} },
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => elStub(), querySelectorAll: () => [],
    getAttribute: () => null, setAttribute: () => {}, removeAttribute: () => {},
    closest: () => null, scrollIntoView: () => {}, blur: () => {}, focus: () => {},
    parentElement: null, firstChild: { textContent: '' },
    getContext: () => canvasCtxStub()
  };
  return el;
}
const stubs = new Map();
function getStub(sel) {
  if (!stubs.has(sel)) stubs.set(sel, elStub());
  return stubs.get(sel);
}
global.document = {
  readyState: 'complete',
  querySelector: (sel) => getStub(sel),
  querySelectorAll: () => [],
  getElementById: (id) => getStub('#' + id),
  addEventListener: () => {},
  documentElement: { classList: { add: () => {} } }
};
global.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); }
};
let rafCount = 0;
global.requestAnimationFrame = (cb) => {
  if (rafCount < 3) { rafCount++; setTimeout(() => cb(Date.now()), 0); }
  return 0;
};
global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

let uncaught = null;
process.on('uncaughtException', (e) => { uncaught = e; });

require('../algo.js');
require('../api.js');
require('../app.js');
const API = globalThis.SunsetAPI;

const VERDICTS = ['有一点·小烧', '有·中烧', '有大烧', '基本没有'];
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  let failures = 0;
  // 等首屏预报加载完成
  let hero = '';
  for (let i = 0; i < 90; i++) {
    hero = getStub('#heroTitle').textContent;
    if (VERDICTS.includes(hero)) break;
    await sleep(500);
  }
  if (!VERDICTS.includes(hero)) { failures++; console.log('FAIL：首屏未加载出结论，heroTitle =', JSON.stringify(hero)); }
  else console.log('PASS：首屏结论 =', hero);

  const eventsHTML = getStub('#events').innerHTML;
  if ((eventsHTML.match(/class="ev-tile/g) || []).length !== 4) {
    failures++; console.log('FAIL：霞历四场未正确渲染');
  } else console.log('PASS：霞历四场渲染完成');

  const PHASES = ['白昼', '金色时刻', '火烧云', '蓝调时刻', '浅黑', '黑'];
  const phase = getStub('#tlName').textContent;
  const bands = getStub('#tlBands').innerHTML;
  if (!PHASES.includes(phase) || !/\d{2}:\d{2}/.test(getStub('#tlClock').textContent) || !bands.includes('<span')) {
    failures++; console.log('FAIL：天色时间轴未渲染，phase =', JSON.stringify(phase));
  } else console.log('PASS：天色时间轴 =', getStub('#tlClock').textContent, phase, getStub('#tlElev').textContent);

  const layersHTML = getStub('#layers').innerHTML;
  if ((layersHTML.match(/class="layer-row"/g) || []).length !== 11) { failures++; console.log('FAIL：大气剖面不是 11 层'); }
  else console.log('PASS：大气剖面 11 层渲染完成');

  // 榜单单点路径：胡志明市 + 南宁（验证 offsetSec / 日落当地时间格式）
  for (const city of [
    { name: '胡志明市', country: '越南', lat: 10.82, lon: 106.63 },
    { name: '南宁', country: '中国', lat: 22.82, lon: 108.37 }
  ]) {
    const r = await API.evaluateNextSunset(city);
    const timeStr = API.fmtTime(r.epoch, r.offsetSec);
    const ok = typeof r.score === 'number' && r.grade && r.offsetSec !== undefined &&
      r.tzName && /^\d{2}:\d{2}$/.test(timeStr);
    if (!ok) { failures++; console.log('FAIL：榜单单点路径异常', city.name, JSON.stringify(r)); }
    else console.log('PASS：榜单单点', city.name, '→', r.grade, r.score, '分，日落（当地）', timeStr, r.tzName);
  }

  if (uncaught) { failures++; console.log('FAIL：未捕获异常', uncaught); }
  console.log(failures === 0 ? 'SMOKE PASS' : `SMOKE FAIL：${failures} 处问题`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('SMOKE ERROR', e); process.exit(1); });
