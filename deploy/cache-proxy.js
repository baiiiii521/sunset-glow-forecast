#!/usr/bin/env node
/* ============================================================
 * 缓存代理（不依赖 nginx 配置权时用）
 *   node deploy/cache-proxy.js 8790
 * nginx 侧：
 *   location /om/ { proxy_pass http://127.0.0.1:8790/; }
 * 前端：window.GLOW_OM_BASE = '/om'
 *
 * 缓存策略：同一 URL 10 分钟内只回源一次；上游 429/5xx 时返回旧缓存并标 X-Glow-Cache: STALE。
 * ============================================================ */
'use strict';
const http = require('http');

const PORT = Number(process.argv[2] || 8790);
const TTL = 10 * 60 * 1000;
const MAX_ENTRIES = 4000;

const cache = new Map();          // key -> {body, at, type}
const inflight = new Map();       // key -> Promise

const UPSTREAM = {
  '/v1/': { host: 'api.open-meteo.com', path: '/v1/' },
  '/air-quality/v1/': { host: 'air-quality-api.open-meteo.com', path: '/v1/' },
  '/geo/v1/': { host: 'geocoding-api.open-meteo.com', path: '/v1/' }
};

function upstreamFor(url) {
  for (const prefix of Object.keys(UPSTREAM)) {
    if (url.startsWith(prefix)) {
      return { ...UPSTREAM[prefix], rest: url.slice(prefix.length) };
    }
  }
  return null;
}

async function fetchUpstream(target) {
  const url = 'https://' + target.host + target.path + target.rest;
  const res = await fetch(url, { headers: { 'User-Agent': 'glow-cache-proxy/1.0' } });
  const body = await res.text();
  return { status: res.status, body, type: res.headers.get('content-type') || 'application/json' };
}

function trim() {
  if (cache.size <= MAX_ENTRIES) return;
  const drop = cache.size - MAX_ENTRIES;
  let i = 0;
  for (const k of cache.keys()) { if (i++ >= drop) break; cache.delete(k); }
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '';
  const target = upstreamFor(url);
  if (!target) { res.writeHead(404); return res.end('not found'); }

  const key = url;
  const hit = cache.get(key);
  const fresh = hit && Date.now() - hit.at < TTL;

  const send = (entry, state) => {
    res.writeHead(entry.status || 200, {
      'content-type': entry.type || 'application/json',
      'cache-control': 'public, max-age=300',
      'x-glow-cache': state,
      'access-control-allow-origin': '*'
    });
    res.end(entry.body);
  };

  if (fresh) return send(hit, 'HIT');

  try {
    let p = inflight.get(key);
    if (!p) {
      p = fetchUpstream(target).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const out = await p;
    if (out.status === 200) {
      cache.set(key, { ...out, at: Date.now() });
      trim();
      return send(cache.get(key), 'MISS');
    }
    if (hit) return send(hit, 'STALE');
    res.writeHead(out.status, { 'content-type': 'application/json' });
    return res.end(out.body);
  } catch (e) {
    if (hit) return send(hit, 'STALE');
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`glow cache proxy on 127.0.0.1:${PORT}  ttl=${TTL / 1000}s`);
});
