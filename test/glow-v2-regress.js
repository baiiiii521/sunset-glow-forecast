#!/usr/bin/env node
/* ============================================================
 * v2 霞分回归测试（离线，不联网）。
 * 覆盖 2026-10-25 这批修复：
 *   1. 金标：FLAGS 全关 + 干燥场景，v2 分数与改动前逐位一致
 *      （基准值在改动前用同一组输入锁定，B1 只在涉雨场景改变结果）
 *   2. B1：事件那一小时（ip 格）有雨 → 封顶 34；无雨对照不受影响
 *   3. washedV2：霞前 3 小时窗口对齐（i,i-1,i-2），同一小时的雨不重复计
 *   4. cGap3（影子）：光路几何方向性 / 连续性 / 缺数据 / 0-0 保护
 *   5. blendCloudAt：整点间插值
 *   6. band 委托 levelOf；tzParts 夏令时换算
 * 用法：node test/glow-v2-regress.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('../algo.js');
const API = require('../api.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('PASS', name); }
  else { failures++; console.log('FAIL', name, detail === undefined ? '' : '→ ' + detail); }
}

/* ---------------- 合成数据 ---------------- */
function synthHourly(o) {
  o = o || {};
  const times = []; for (let h = 0; h < 24; h++) times.push('2026-10-24T' + String(h).padStart(2, '0') + ':00');
  const mk = (fn) => times.map((t, i) => fn(i));
  return {
    time: times,
    cloud_cover: mk(() => o.total != null ? o.total : 20),
    cloud_cover_mid: mk(() => o.mid != null ? o.mid : 60),
    cloud_cover_high: mk(() => o.high != null ? o.high : 30),
    cloud_cover_low: mk(() => o.low != null ? o.low : 10),
    precipitation: o.precip ? mk(o.precip) : mk(() => 0),
    precipitation_probability: o.prob ? mk(o.prob) : mk(() => 0),
    temperature_2m: mk(() => 25), dew_point_2m: mk(() => 15),
    visibility: mk(() => 20000), wind_speed_10m: mk(() => 10),
    wind_direction_10m: mk(() => 180), cape: mk(() => 100)
  };
}
function upHourly(low, mid) {
  const times = []; for (let h = 0; h < 24; h++) times.push('2026-10-24T' + String(h).padStart(2, '0') + ':00');
  return { hourly: { time: times, cloud_cover_low: times.map(() => low), cloud_cover_mid: times.map(() => mid), cloud_cover: times.map(() => low + mid) }, utc_offset_seconds: 0 };
}
const EV = Date.parse('2026-10-24T18:44:00Z');   // i=18, ip=19
const UPS3 = [upHourly(10, 10), upHourly(10, 10), upHourly(10, 10)];
const D3 = [50, 100, 200];
function ev(o, ups, dist) {
  return A.evaluate({ hourly: synthHourly(o), utc_offset_seconds: 0 }, null, ups || UPS3, EV, 270, 0, null, dist || D3);
}

/* ---------------- 1. 金标（FLAGS 全关 + 干燥） ---------------- */
const savedFlags = Object.assign({}, A.FLAGS);
// 先断言默认值全关：否则有人把 algo.js 里的默认开关改成 true，下面的强制赋 false
// 会让金标照样全绿，AGENTS.md 的硬约定就形同虚设
check('FLAGS 默认全关（影子开关不许默认打开）', savedFlags.gapV3 === false && savedFlags.windowAlign === false,
  JSON.stringify(savedFlags));
A.FLAGS.gapV3 = false; A.FLAGS.windowAlign = false;
try {
  const GOLDEN = {
    dryA: { score: 92, rawScore: 92.30087296519885, level: 5 },
    dryB: { score: 67, rawScore: 67.2983255856264, level: 4 },
    dryC: { score: 0, rawScore: 0, level: 0 }
  };
  const cases = {
    dryA: ev({}, UPS3, D3),
    dryB: ev({ low: 40, mid: 20, high: 70 }, [upHourly(40, 30), upHourly(40, 30), upHourly(40, 30)], D3),
    dryC: ev({ low: 0, mid: 0, high: 0 }, [upHourly(0, 0), upHourly(0, 0), upHourly(0, 0)], D3)
  };
  Object.keys(GOLDEN).forEach((k) => {
    const g = GOLDEN[k], c = cases[k];
    check('金标 ' + k, c.score === g.score && Math.abs(c.rawScore - g.rawScore) < 1e-9 && c.level === g.level,
      'score=' + c.score + ' raw=' + c.rawScore + ' level=' + c.level + '（期望 ' + g.score + '/' + g.rawScore + '/' + g.level + '）');
  });

  // fixture.json 两场（改动前锁定）
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));
  const f = fixture;
  const r1 = A.evaluate(f.fc, f.aq, f.upSunset, A.toEpoch(f.sunsetTime, f.offsetSec), A.sunsetBearing(f.lat, f.todayDoy), f.offsetSec);
  const r2 = A.evaluate(f.fc, f.aq, f.upSunrise, A.toEpoch(f.sunriseTime, f.offsetSec), A.sunriseBearing(f.lat, f.tomorrowDoy), f.offsetSec);
  check('金标 fixture 日落', r1.score === 34 && r1.rawScore === 34 && r1.level === 1, 'score=' + r1.score + ' raw=' + r1.rawScore + ' level=' + r1.level);
  check('金标 fixture 日出', r2.score === 65 && Math.abs(r2.rawScore - 65.33776105733308) < 1e-9 && r2.level === 4, 'score=' + r2.score + ' raw=' + r2.rawScore + ' level=' + r2.level);

  /* ---------------- 2. B1：事件那一小时的雨必须封顶 ---------------- */
  const wet = ev({ precip: (i) => i === 19 ? 2.0 : 0, prob: (i) => i === 19 ? 90 : 0 });
  const dry = ev({});
  check('B1 封顶：事件格有雨 → 34', wet.score === 34 && wet.comps.precipV2[0] === 0, 'score=' + wet.score);
  check('B1 对照：无雨 → 92', dry.score === 92, 'score=' + dry.score);
  // 旧小时（i 格）有雨、事件格无雨：v1 口径触发但 v2 不应封顶
  const oldHourRain = ev({ precip: (i) => i === 18 ? 2.0 : 0, prob: (i) => i === 18 ? 90 : 0 });
  check('B1 只有旧小时（17-18时）有雨 → v2 不封顶', oldHourRain.score > 34 && oldHourRain.comps.precipV2[0] === 100,
    'score=' + oldHourRain.score + ' precipV2=' + JSON.stringify(oldHourRain.comps.precipV2));

  /* ---------------- 3. washedV2：窗口对齐 ---------------- */
  // 雨下在 16/17/18 时（i,i-1,i-2 三格），18-19 时（ip，覆盖事件）已停：
  // washedV2 应判「雨后洗净」（+5）；v1 的 pre3（i-1..i-3）包含 16/17 但 dryNow 用 i 格有雨 → 判 0
  const washedCase = ev({ precip: (i) => (i === 16 || i === 17 || i === 18) ? 1.0 : 0, prob: (i) => (i === 16 || i === 17 || i === 18) ? 80 : 0 });
  check('washedV2 雨后洗净 +5', washedCase.comps.washedV2[0] === 100 && washedCase.score === Math.min(100, dry.score + 5),
    'washedV2=' + washedCase.comps.washedV2[0] + ' score=' + washedCase.score + '（期望 ' + Math.min(100, dry.score + 5) + '）');
  check('washedV2 与 v1 washed 窗口分开（v1 此例判 0）', washedCase.comps.washed[0] === 0, 'washed=' + washedCase.comps.washed[0]);

  // M1 反例：雨只下在第 15 格（i-3，事件前约 3–4 小时）——v1 的 pre3 看得见（判洗净 +5），
  // v2 的窗口看不见（判 0）。分数必须跟 v2 走：不加 5，等于无雨对照
  const m1 = ev({ precip: (i) => (i === 15 ? 1.0 : 0), prob: (i) => (i === 15 ? 80 : 0) });
  check('M1 washedV2 判 0 时不回退 v1 加成', m1.comps.washedV2[0] === 0 && m1.comps.washed[0] === 100 && m1.score === dry.score,
    'washedV2=' + m1.comps.washedV2[0] + ' washed=' + m1.comps.washed[0] + ' score=' + m1.score + '（期望 ' + dry.score + '）');

  // B5：上游点缺数据保留 null 占位后，距离权重必须按各自下标对齐
  const b5 = A.evaluate({ hourly: synthHourly({}), utc_offset_seconds: 0 }, null,
    [null, upHourly(80, 0), upHourly(0, 0)], EV, 270, 0, null, [50, 100, 200]);
  // idx1（100km）权重 0.5、idx2（200km）权重 1/3：upLowAvg = (80×0.5 + 0×1/3) / (0.5+1/3) = 48
  check('B5 null 占位后距离权重不错位', Math.abs(b5.inputs.upLowAvg - 48) < 1e-9, 'upLowAvg=' + b5.inputs.upLowAvg);

  /* ---------------- 4. cGap3（影子输出，不进霞分） ---------------- */
  const pts5 = (lowAt, midAt) => [50, 100, 200, 300, 400].map((d) => ({ d, low: lowAt(d), mid: midAt(d) }));
  const gClear = A.cGap3(pts5(() => 0, () => 0), 60, 30);
  const gWall300 = A.cGap3(pts5((d) => (d === 300 ? 100 : 0), () => 0), 60, 30);
  const gWall50 = A.cGap3(pts5((d) => (d === 50 ? 100 : 0), () => 0), 60, 30);
  check('cGap3 全晴上游 = 100', gClear[0] === 100, JSON.stringify(gClear));
  check('cGap3 方向性：300km 低云墙 < 50km 低云墙', gWall300[0] < gWall50[0], gWall300[0] + ' vs ' + gWall50[0]);
  check('cGap3 300km 墙显著压分（< 90）', gWall300[0] < 90, String(gWall300[0]));
  // 单调性：远端（200-400km）低云递增 → 分数单调不增
  let prev = 101, mono = true;
  for (const low of [0, 25, 50, 75, 100]) {
    const s = A.cGap3([50, 100, 200, 300, 400].map((d) => ({ d, low: d >= 200 ? low : 0, mid: 0 })), 60, 30)[0];
    if (s > prev + 1e-9) mono = false;
    prev = s;
  }
  check('cGap3 远端低云单调', mono);
  // 缺数据与 0-0 保护
  check('cGap3 全部上游缺数据 → null', A.cGap3([], 60, 30)[0] === null && A.cGap3([{ d: 100 }], 60, 30)[0] === null);
  const g00 = A.cGap3(pts5(() => 30, () => 30), 0, 0);
  check('cGap3 幕布 0/0 份额保护（有限值）', isFinite(g00[0]) && g00[0] >= 0, String(g00[0]));
  // 影子开关可回滚：开着时 glow 实际用的是 gapV3（分数应与关着时不同），
  // 关回去后分数必须与金标逐位一致
  A.FLAGS.gapV3 = true;
  const dryGap3on = ev({}, UPS3, D3);
  A.FLAGS.gapV3 = false;
  const dryGap3off = ev({}, UPS3, D3);
  check('cGap3 开关真的换了口径（开≠关）', dryGap3on.comps.gapV3[0] !== null && Math.abs(dryGap3on.rawScore - dryGap3off.rawScore) > 1e-9,
    'on=' + dryGap3on.rawScore + ' off=' + dryGap3off.rawScore);
  check('cGap3 关回去 = 金标 dryA', dryGap3off.score === 92 && Math.abs(dryGap3off.rawScore - 92.30087296519885) < 1e-9,
    String(dryGap3off.rawScore));

  /* ---------------- 5. blendCloudAt ---------------- */
  const bh = synthHourly({ low: 10 });
  bh.cloud_cover_low = bh.cloud_cover_low.map((v, i) => (i === 18 ? 10 : 0));
  bh.cloud_cover_low[19] = 30;
  const blended = A.blendCloudAt(bh, EV, 0);
  check('blendCloudAt 整点间插值（18:44 → 10×0.27+30×0.73）',
    Math.abs(blended.cloud_cover_low[18] - (10 * (1 - 44 / 60) + 30 * (44 / 60))) < 1e-9,
    String(blended.cloud_cover_low[18]));
  check('blendCloudAt 不改原数组', bh.cloud_cover_low[18] === 10);
  const bh2 = synthHourly({});
  bh2.cloud_cover_low[18] = null;
  const blended2 = A.blendCloudAt(bh2, EV, 0);
  check('blendCloudAt 某格 null → 取另一格', blended2.cloud_cover_low[18] === bh2.cloud_cover_low[19], String(blended2.cloud_cover_low[18]));

  /* ---------------- 6. levelOf 切点 + tzParts ---------------- */
  // band 在 glow.js（浏览器层）已委托 levelOf，这里验证 levelOf 的切点与六档一致
  let levelOk = true;
  for (let s = 0; s <= 100; s += 0.5) {
    const lv = A.levelOf(s);
    if (s < 20 && lv !== 0) levelOk = false;
    if (s >= 20 && s < 35 && lv !== 1) levelOk = false;
    if (s >= 35 && s < 50 && lv !== 2) levelOk = false;
    if (s >= 50 && s < 65 && lv !== 3) levelOk = false;
    if (s >= 65 && s < 80 && lv !== 4) levelOk = false;
    if (s >= 80 && lv !== 5) levelOk = false;
  }
  check('levelOf 切点连续且与六档一致', levelOk);

  const madridAfterDst = Date.UTC(2026, 9, 26, 17, 19);   // 10-26 17:19Z，马德里已切 CET(+1)
  const tp = API.tzParts('Europe/Madrid', madridAfterDst);
  const zp = API.zonedParts(madridAfterDst, 7200);
  check('tzParts 夏令时换算（CET → 18:19）', tp && tp.timeStr === '18:19', tp && tp.timeStr);
  check('tzParts vs 固定偏移（固定 +2 会显示 19:19）', zp.timeStr === '19:19', zp.timeStr);
  check('tzParts 非法时区 → null 回落', API.tzParts('Not/AZone', madridAfterDst) === null);
  check('API.fmtTime 三参换算', API.fmtTime(madridAfterDst, 7200, 'Europe/Madrid') === '18:19', API.fmtTime(madridAfterDst, 7200, 'Europe/Madrid'));

  /* ---------------- 7. 集合路径金标（scoreEvent · A 旧口径 · 入库回放样例） ----------------
   * 覆盖 memberHourly 的 epoch 对齐、上游 null 占位、旧时间窗挑最大值——
   * 这些都在 scoreEvent 里，只测 evaluate 抓不到。数值在改动定稿后锁定。 */
  const replayDir = path.join(__dirname, 'fixtures', 'replay');
  const ENS_GOLDEN = {
    '洛杉矶': { score: 1, rawScore: 0.5071981861166309, n: 4 },
    '纽约': { score: 54, rawScore: 53.88573208219389, n: 4 }
  };
  if (fs.existsSync(replayDir)) {
    fs.readdirSync(replayDir).filter((f) => f.endsWith('.json')).forEach((f) => {
      const rec = JSON.parse(fs.readFileSync(path.join(replayDir, f), 'utf8'));
      const g = ENS_GOLDEN[rec.city.name];
      if (!g) return;
      try {
        const res = API.scoreEvent(rec.fc, rec.aq, rec.spec.epoch, rec.spec.bearing,
          rec.spec.offsetSec, rec.ens, rec.spec.upIdx, rec.spec.dist);
        check('集合金标 ' + rec.city.name,
          res.score === g.score && Math.abs(res.rawScore - g.rawScore) < 1e-9 &&
          res.ensemble && res.ensemble.n === g.n,
          'score=' + res.score + ' raw=' + res.rawScore + ' n=' + (res.ensemble && res.ensemble.n));
      } catch (e) {
        check('集合金标 ' + rec.city.name, false, '异常 ' + e.message);
      }
    });
  }
} finally {
  Object.assign(A.FLAGS, savedFlags);   // 恢复，避免污染其他测试
}

console.log(failures === 0 ? '\nGLOW-V2-REGRESS PASS' : `\nGLOW-V2-REGRESS FAIL：${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
