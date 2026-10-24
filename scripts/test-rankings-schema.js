#!/usr/bin/env node
/* ============================================================
 * 霞榜数据契约测试：同时校验「写出的形状」和「两个前端怎么读」
 * 用法：node scripts/test-rankings-schema.js [rankings.json]
 * 任何一项不符就 exit 1，可直接挂到 cron 的失败告警里。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'data', 'rankings.json');
const d = JSON.parse(fs.readFileSync(file, 'utf8'));

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
  d[k].forEach((r, i) => {
    need.forEach((f) => ok(r[f] !== undefined && r[f] !== null, `${k}[${i}] 缺字段 ${f}`));
    ok(r.city && typeof r.city.name === 'string' && r.city.name, `${k}[${i}].city.name 缺失`);
    ok(typeof r.city.lat === 'number' && Math.abs(r.city.lat) <= 90, `${k}[${i}] lat 越界`);
    ok(typeof r.city.lon === 'number' && Math.abs(r.city.lon) <= 180, `${k}[${i}] lon 越界`);
    ok(r.score >= 0 && r.score <= 100, `${k}[${i}] score 越界`);
    ok(r.level >= 0 && r.level <= 5, `${k}[${i}] level 越界`);
    // 精算过的条目必须带 4 个模式的分数；粗分混进来会让排序失真
    ok(Array.isArray(r.models) && r.models.length >= 1, `${k}[${i}] (${r.city.name}) 没有 models，疑似粗分混入榜单`);
  });
});

// 分数必须降序（前端直接按顺序渲染名次）
['global', 'china'].forEach((k) => {
  for (let i = 1; i < d[k].length; i++) {
    ok(d[k][i - 1].score >= d[k][i].score, `${k} 第 ${i} 名分数高于前一名（未排序）`);
  }
});

// 同一榜内不应出现同名同坐标
['global', 'china'].forEach((k) => {
  const seen = new Set();
  d[k].forEach((r) => {
    const key = String(r.city.name).replace(/[市区县镇]$/, '') + '|' + r.city.lat.toFixed(1);
    ok(!seen.has(key), `${k} 重复城市：${r.city.name}`);
    seen.add(key);
  });
});

if (fails.length) {
  console.error(`✗ 霞榜数据契约不通过（${fails.length} 项）：`);
  fails.slice(0, 20).forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`✓ 霞榜数据契约通过：全球 ${d.global.length} 城 / 中国 ${d.china.length} 城 · ` +
  `分布 global ${d.stats.global.counts.join('/')} china ${d.stats.china.counts.join('/')}`);
