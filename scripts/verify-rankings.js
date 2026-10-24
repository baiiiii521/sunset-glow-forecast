#!/usr/bin/env node
/* ============================================================
 * 霞榜 Jev 复核（在能访问 api.typesafe.ai 的机器上跑，例如本机 Mac）。
 * 服务器在境内会被 TypeSafe 451 地区限制拦住，所以服务端只出榜、
 * 复核在这里做，结果写 verified.json 回传，前端按 computedAt 对齐后合并。
 *
 * 用法：node scripts/verify-rankings.js <输出文件> [rankings 来源]
 *   默认来源 https://glow.nybbq.art/data/rankings.json
 * ============================================================ */
'use strict';
const fs = require('fs');
const jev = require('./jev.js');

const out = process.argv[2];
const src = process.argv[3] || 'https://glow.nybbq.art/data/rankings.json';
if (!out) {
  console.error('用法：node scripts/verify-rankings.js <输出文件> [rankings.json 路径/URL]');
  process.exit(2);
}

function cityKey(c) {
  return (c.name || '') + '|' + (c.lat != null ? Number(c.lat).toFixed(3) : '') + ',' + (c.lon != null ? Number(c.lon).toFixed(3) : '');
}

function conditions(r) {
  const d = r.cond || {};
  return {
    grade: r.grade, score: r.score,
    high_cloud_pct: d.h, mid_cloud_pct: d.m, low_cloud_pct: d.l,
    precip_mm: d.rain, precip_prob_pct: d.rain ? 60 : 5,
    aod: d.paod, visibility_km: d.vis
  };
}

async function load() {
  if (/^https?:/.test(src)) {
    // 2026-10-24 15:29 的 cron 就是死在这里：裸 fetch 没有超时也没有重试，
    // 一次网络抖动（Node 只报 "fetch failed"）就让整条复核失败。
    // 现在：20s 超时 + 4 次退避（5s/15s/40s），仍然失败才抛。
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(src + (src.includes('?') ? '&' : '?') + 't=' + Date.now(),
                                 { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (attempt < 3) await new Promise((r) => setTimeout(r, [5000, 15000, 40000][attempt]));
      }
    }
    throw new Error('榜单取数 4 次仍失败（' + (lastErr && lastErr.message || lastErr) + '）');
  }
  return JSON.parse(fs.readFileSync(src, 'utf8'));
}

(async () => {
  if (!jev.hasKey()) throw new Error('没有 Jev key（~/.config/typesafe/key）');
  const data = await load();
  const list = data.global.concat(data.china);
  const scores = new Array(list.length).fill(null);
  const CHUNK = 5;
  let model = null;
  for (let i = 0; i < list.length; i += CHUNK) {
    const batch = list.slice(i, i + CHUNK).map(conditions);
    const r = await jev.verifyCities(batch, { timeout: 20000 });
    if (!r.ok) throw new Error('批量复核失败：' + r.error);
    model = r.model;
    r.scores.forEach((p, k) => { scores[i + k] = p; });
  }
  // 批量会把分数系统性压低，存疑的单独再问一次
  for (let k = 0; k < list.length; k++) {
    if (scores[k] !== null && scores[k] < 0.5) {
      const r2 = await jev.verifyEvent(conditions(list[k]), { timeout: 15000 }).catch(() => ({ ok: false }));
      if (r2.ok) scores[k] = r2.p;
    }
  }
  const map = {};
  list.forEach((r, k) => { map[cityKey(r.city)] = scores[k] === null ? null : Math.round(scores[k] * 100) / 100; });
  const payload = { computedAt: data.computedAt, verifiedAt: Date.now(), model: model, map: map };
  fs.writeFileSync(out, JSON.stringify(payload));
  const flagged = Object.keys(map).filter((k) => map[k] !== null && map[k] < 0.5);
  console.log(`复核 ${list.length} 城（${model}），存疑 ${flagged.length}：${flagged.join(', ') || '无'} → ${out}`);
})().catch((e) => {
  console.error('霞榜复核失败：' + (e && e.message || e));
  process.exit(1);
});
