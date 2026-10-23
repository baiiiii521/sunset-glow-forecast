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
const jev = require('./jev.js');

const out = process.argv[2];
if (!out) {
  console.error('用法：node scripts/build-rankings.js <输出文件，如 /var/www/glow/data/rankings.json>');
  process.exit(2);
}

// 前端榜单只用到这些字段，其余明细（11 项评分、原始输入）不发布
// verified: Jev 独立复核（0–1），结论对这种天气是否合理；<0.5 前端标⚠️。null=未复核。
function cityKey(r) {
  const c = r.city || {};
  return (c.name || '') + '|' + (c.lat != null ? Number(c.lat).toFixed(3) : '') + ',' + (c.lon != null ? Number(c.lon).toFixed(3) : '');
}

function slim(r, verified) {
  const i = r.inputs || {};
  return {
    city: r.city, score: r.score, grade: r.grade, level: r.level, conf: r.conf,
    clarity: r.clarity || null,
    verified: (verified === null || verified === undefined) ? null : Math.round(verified * 100) / 100,
    // 复核用的原始条件（服务端在境内调不到 Jev，由 Mac 侧读完这份跑复核再回传）
    cond: { h: i.high, m: i.mid, l: i.low, rain: i.precip, paod: i.aod, vis: i.visKm },
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
    global: [],
    china: []
  };

  // ---- Jev 独立复核（非致命：无 key / 超时 / 报错都照常出榜） ----
  let verifyByKey = {};
  if (jev.hasKey()) {
    const all = data.global.concat(data.china);
    const cities = all.map(function (r) {
      const i = r.inputs || {};
      return {
        city: r.city && r.city.name,
        grade: r.grade,
        score: r.score,
        high_cloud_pct: i.high,
        mid_cloud_pct: i.mid,
        low_cloud_pct: i.low,
        precip_mm: i.precip,
        precip_prob_pct: i.prob,
        aod: i.aod,
        visibility_km: i.visKm
      };
    });
    const v = await (async function () {
      // 分批（每批 5 城）：实测一次问 20 城会明显退化（后面的题被判成同一个低分），
      // 5 城一批时判别正常（正例 0.62–0.79、明显错误 0.06–0.17）。
      const CHUNK = 5;
      const scores = new Array(cities.length).fill(null);
      let model = null;
      for (let i = 0; i < cities.length; i += CHUNK) {
        const batch = cities.slice(i, i + CHUNK);
        const r = await jev.verifyCities(batch, { timeout: 20000 }).catch(function (e) {
          return { ok: false, error: String((e && e.message) || e) };
        });
        if (!r.ok) return { ok: false, error: r.error };
        model = r.model;
        r.scores.forEach(function (p, k) { scores[i + k] = p; });
      }
      // 二次复核：批量会系统性压低分数（实测南京/海口批量 0.46/0.39，单问 0.61/0.67），
      // 所以只对批量判存疑的城单独再问一次，以单问结果为准。
      for (let k = 0; k < cities.length; k++) {
        if (scores[k] !== null && scores[k] < 0.5) {
          const r2 = await jev.verifyEvent(cities[k], { timeout: 15000 }).catch(function () { return { ok: false }; });
          if (r2.ok) scores[k] = r2.p;
        }
      }
      return { ok: true, scores: scores, model: model };
    })();
    if (v.ok && v.scores) {
      all.forEach(function (r, k) { verifyByKey[cityKey(r)] = v.scores[k]; });
      const flagged = v.scores.filter(function (p) { return p !== null && p < 0.5; }).length;
      console.error(`${new Date().toISOString()} Jev 复核 ${v.scores.length} 城（${v.model}），存疑 ${flagged} 城`);
    } else {
      console.error(`${new Date().toISOString()} Jev 复核跳过：${v.error || 'unknown'}`);
    }
  }

  payload.global = data.global.map(function (r) { return slim(r, verifyByKey[cityKey(r)]); });
  payload.china = data.china.map(function (r) { return slim(r, verifyByKey[cityKey(r)]); });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, out);
  console.log(`${new Date().toISOString()} 霞榜已更新：全球 ${payload.global.length} / 中国 ${payload.china.length}，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s → ${out}`);
})().catch((e) => {
  console.error(`${new Date().toISOString()} 霞榜更新失败：${e && e.message || e}`);
  process.exit(1);
});
