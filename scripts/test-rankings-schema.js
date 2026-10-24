#!/usr/bin/env node
/* ============================================================
 * 霞榜数据契约测试（CLI 包装）：校验逻辑在 scripts/lib/validate-rankings.js，
 * 与 build-rankings-v3.js 写盘前的内存校验共用同一份规则。
 * 用法：node scripts/test-rankings-schema.js [rankings.json]
 * 任何一项不符就 exit 1，可直接挂到 cron 的失败告警里。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'data', 'rankings.json');
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const allFile = path.join(path.dirname(file), 'rankings-all.json');
const all = fs.existsSync(allFile) ? JSON.parse(fs.readFileSync(allFile, 'utf8')) : null;

const fails = require('./lib/validate-rankings.js').validateRankings(d, all);

if (fails.length) {
  console.error(`✗ 霞榜数据契约不通过（${fails.length} 项）：`);
  fails.slice(0, 20).forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`✓ 霞榜数据契约通过：全球 ${d.global.length} 城 / 中国 ${d.china.length} 城 · ` +
  `分布 global ${d.stats.global.counts.join('/')} china ${d.stats.china.counts.join('/')}`);
