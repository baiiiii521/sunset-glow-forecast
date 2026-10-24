/* ============================================================
 * 霞榜数据契约校验（纯函数，不 process.exit、不读文件）。
 * 两个使用方：
 *   - scripts/test-rankings-schema.js：CLI，提交 / cron 告警用
 *   - scripts/build-rankings-v3.js：写盘前在内存里校验，
 *     违约就不落盘（退出码 3），旧榜单原样保留
 * all 传 null 表示只校验 rankings 本体（rankings-all.json 不存在或不在同一批）。
 * ============================================================ */
'use strict';
const path = require('path');
const Algo = require(path.join(__dirname, '..', '..', 'algo.js'));
const LEVELS = Algo.LEVELS, levelOf = Algo.levelOf;

function validateRankings(d, all) {
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };

  // 顶层
  ok(d.version >= 2, 'version 缺失或过旧');
  ok(typeof d.computedAt === 'number' && d.computedAt > 1.6e12, 'computedAt 不是合法时间戳');
  ok(Array.isArray(d.global) && d.global.length > 0, 'global 为空');
  ok(Array.isArray(d.china) && d.china.length > 0, 'china 为空');

  // stats：前端按 stats.<scope>.counts 读（board.js / home.js），旧站 app.js 也是
  ['global', 'china'].forEach((k) => {
    const st = d.stats && d.stats[k];
    ok(st && typeof st === 'object' && !Array.isArray(st), `stats.${k} 必须是对象，实际 ${Array.isArray(st) ? '数组' : typeof st}`);
    ok(st && Array.isArray(st.counts), `stats.${k}.counts 必须是数组`);
    ok(st && Array.isArray(st.counts) && st.counts.length === 6, `stats.${k}.counts 必须是 6 档`);
    ok(st && Array.isArray(st.counts) && st.counts.every((n) => typeof n === 'number' && n >= 0), `stats.${k}.counts 必须是非负数字`);
  });

  // 榜单条目：前端直接读这些字段
  const need = ['city', 'score', 'grade', 'level', 'epoch', 'offsetSec', 'tzName'];
  ['global', 'china'].forEach((k) => {
    (d[k] || []).forEach((r, i) => {
      need.forEach((f) => ok(r[f] !== undefined && r[f] !== null, `${k}[${i}] 缺字段 ${f}`));
      ok(r.city && typeof r.city.name === 'string' && r.city.name, `${k}[${i}].city.name 缺失`);
      ok(typeof r.city.lat === 'number' && Math.abs(r.city.lat) <= 90, `${k}[${i}] lat 越界`);
      ok(typeof r.city.lon === 'number' && Math.abs(r.city.lon) <= 180, `${k}[${i}] lon 越界`);
      ok(r.score >= 0 && r.score <= 100, `${k}[${i}] score 越界`);
      ok(r.level >= 0 && r.level <= 5, `${k}[${i}] level 越界`);
      // 精算过的条目必须带模式分数；粗分混进来会让排序失真
      ok(Array.isArray(r.models) && r.models.length >= 1, `${k}[${i}] (${r.city.name}) 没有 models，疑似粗分混入榜单`);
      // 等级文案、等级序号、分数三者必须自洽（页面直接拿 level 取颜色、拿 grade 出字）
      ok(LEVELS[r.level] && LEVELS[r.level].name === r.grade,
        `${k}[${i}] (${r.city.name}) grade「${r.grade}」与 level ${r.level} 不匹配（应为 ${LEVELS[r.level] && LEVELS[r.level].name}）`);
      ok(levelOf(r.score) === r.level,
        `${k}[${i}] (${r.city.name}) score ${r.score} 落在 level ${levelOf(r.score)}，但条目写的是 level ${r.level}`);
    });
  });

  // 分数必须降序（前端直接按顺序渲染名次）
  ['global', 'china'].forEach((k) => {
    for (let i = 1; i < (d[k] || []).length; i++) {
      ok(d[k][i - 1].score >= d[k][i].score, `${k} 第 ${i} 名分数高于前一名（未排序）`);
    }
  });

  // 同一榜内不应出现同名同坐标
  ['global', 'china'].forEach((k) => {
    const seen = new Set(), coords = new Set();
    (d[k] || []).forEach((r) => {
      const key = String(r.city.name).replace(/[市区县镇]$/, '') + '|' + r.city.lat.toFixed(1);
      ok(!seen.has(key), `${k} 重复城市：${r.city.name}`);
      seen.add(key);
      const ck = r.city.lat.toFixed(3) + ',' + r.city.lon.toFixed(3);
      ok(!coords.has(ck), `${k} 重复坐标：${r.city.name} @ ${ck}`);
      coords.add(ck);
    });
  });

  // stats 的分档计数必须和实际条目对得上（榜单被 slice 到 TOP 时，计数可以更大，但不能更小或漏档）
  ['global', 'china'].forEach((k) => {
    const st = d.stats && d.stats[k];
    if (!st || !Array.isArray(st.counts)) return;
    const sum = st.counts.reduce((a, b) => a + b, 0);
    ok(sum >= (d[k] || []).length, `stats.${k}.counts 合计 ${sum} < 实际条目 ${(d[k] || []).length}`);
    const real = [0, 0, 0, 0, 0, 0];
    (d[k] || []).forEach((r) => { real[r.level] += 1; });
    for (let i = 0; i < 6; i++) {
      ok(st.counts[i] >= real[i], `stats.${k}.counts[${i}] = ${st.counts[i]}，但榜里有 ${real[i]} 条`);
    }
  });

  // rankings-all.json：全量结果也要符合同一套契约（不是同一次跑批时 all 传 null 跳过）
  if (all) {
    ok(all.version >= 2, 'rankings-all.version 缺失或过旧');
    ok(typeof all.computedAt === 'number', 'rankings-all.computedAt 不合法');
    ['global', 'china'].forEach((k) => {
      ok(Array.isArray(all[k]) && all[k].length > 0, `rankings-all.${k} 为空`);
      (all[k] || []).forEach((r, i) => {
        need.forEach((f) => ok(r[f] !== undefined && r[f] !== null, `rankings-all.${k}[${i}] 缺字段 ${f}`));
        ok(LEVELS[r.level] && LEVELS[r.level].name === r.grade,
          `rankings-all.${k}[${i}] (${r.city && r.city.name}) grade/level 不一致`);
        ok(levelOf(r.score) === r.level, `rankings-all.${k}[${i}] score 与 level 不一致`);
      });
      for (let i = 1; i < (all[k] || []).length; i++) {
        ok(all[k][i - 1].score >= all[k][i].score, `rankings-all.${k} 未按分数降序`);
      }
      // 全量必须覆盖榜单里的城市
      const inAll = new Set((all[k] || []).map((r) => r.city.name));
      (d[k] || []).forEach((r) => ok(inAll.has(r.city.name), `rankings-all.${k} 漏了榜上城市：${r.city.name}`));
    });
    ok(all.computedAt === d.computedAt || Math.abs(all.computedAt - d.computedAt) < 6e5,
      'rankings-all 与 rankings 的 computedAt 相差过大（不是同一次跑批）');
  }

  return fails;
}

module.exports = { validateRankings };
