#!/usr/bin/env node
/* ============================================================
 * 每日霞榜：服务器每天定时跑一次，用和网页完全相同的算法算出
 * 全球 / 中国 TOP 10 的下一场晚霞，写成一份静态 JSON。
 * 网页直接读这份文件，访客不再各自调用约 350 次 Open-Meteo。
 *
 * 用法：node scripts/build-rankings.js <输出文件>
 * 需要 Node 18+（自带 fetch）。先写临时文件再改名，网页不会读到半份；
 * 有效城市太少时直接失败、保留旧榜单，不会用残缺数据覆盖。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

require('../algo.js');
const API = require('../api.js');

const out = process.argv[2];
if (!out) {
  console.error('用法：node scripts/build-rankings.js <输出文件，如 /var/www/glow/data/rankings.json>');
  process.exit(2);
}

// 前端榜单只用到这些字段，其余明细（11 项评分、原始输入）不发布
function slim(r) {
  return {
    city: r.city, score: r.score, grade: r.grade, level: r.level, conf: r.conf,
    clarity: r.clarity || null,
    models: r.ensemble ? r.ensemble.members.map((m) => [m.label, m.score]) : null,
    epoch: r.epoch, offsetSec: r.offsetSec, tzName: r.tzName, day: r.day
  };
}

(async () => {
  const t0 = Date.now();
  // 低并发 + 失败重试：10-20、10-21 的定时任务曾因 429 限流整批作废
  const data = await API.loadRankings(null, { concurrency: 2 });
  if (data.failed.length) console.error(`${new Date().toISOString()} 失败 ${data.failed.length} 城：${data.failed.join('；')}`);
  if (data.singleModel) console.error(`${new Date().toISOString()} ${data.singleModel} 城多模式数据缺失，退回单模式`);
  if (data.global.length < 5 || data.china.length < 5) {
    throw new Error(`有效城市太少（全球 ${data.global.length}、中国 ${data.china.length}），保留旧榜单`);
  }
  const payload = {
    version: 2,
    computedAt: data.computedAt,
    stats: data.stats,
    global: data.global.map(slim),
    china: data.china.map(slim)
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, out);
  console.log(`${new Date().toISOString()} 霞榜已更新：全球 ${payload.global.length} / 中国 ${payload.china.length}，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s → ${out}`);
})().catch((e) => {
  console.error(`${new Date().toISOString()} 霞榜更新失败：${e && e.message || e}`);
  process.exit(1);
});
