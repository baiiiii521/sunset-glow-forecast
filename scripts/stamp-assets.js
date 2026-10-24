#!/usr/bin/env node
/* ============================================================
 * 给 index.html 里的 css / js 引用加内容版本号：styles.css?v=<内容哈希前 8 位>
 * 文件一改哈希就变，浏览器立刻取新文件；内容不变时可以放心长缓存。
 *
 * 用法：
 *   node scripts/stamp-assets.js          改写 index.html（部署前、提交前跑）
 *   node scripts/stamp-assets.js --check  只检查版本号是否最新，过期时退出码 1
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ASSETS = ['styles.css', 'algo.js', 'api.js', 'app.js'];
const htmlPath = path.join(ROOT, 'index.html');
const check = process.argv.includes('--check');

const html = fs.readFileSync(htmlPath, 'utf-8');
let out = html;
for (const name of ASSETS) {
  const hash = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, name))).digest('hex').slice(0, 8);
  const re = new RegExp('((?:href|src)=")' + name.replace('.', '\\.') + '(?:\\?v=[0-9a-f]+)?(")', 'g');
  if (!re.test(out)) { console.error('index.html 里没找到对 ' + name + ' 的引用'); process.exit(2); }
  out = out.replace(re, '$1' + name + '?v=' + hash + '$2');
}


/* ---------------- v2 三页：本地 css/js + 共享 ../algo.js ../api.js ---------------- */
function stampV2() {
  const pages = ['v2/index.html', 'v2/city.html', 'v2/board.html'];
  let dirty = [];
  for (const page of pages) {
    const abs = path.join(ROOT, page);
    const html = fs.readFileSync(abs, 'utf-8');
    let out = html;
    const refs = html.match(/(?:href|src)="(?:assets\/(?:css|js)\/[^"]+|\.\.\/(?:algo|api)\.js)(?:\?v=[0-9a-f]+)?"/g) || [];
    for (const ref of refs) {
      const m = ref.match(/(?:href|src)="([^"?]+)(?:\?v=[0-9a-f]+)?"/);
      if (!m) continue;
      const rel = m[1];
      const file = path.join(ROOT, page, '..', rel);     // 相对该页面解析
      if (!fs.existsSync(file)) continue;
      const hash = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
      const re = new RegExp('((?:href|src)="' + rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?:\\?v=[0-9a-f]+)?(")', 'g');
      out = out.replace(re, '$1?v=' + hash + '$2');
    }
    if (out !== html) dirty.push(page);
    if (!check) fs.writeFileSync(abs, out);
  }
  return dirty;
}

const v2Dirty = stampV2();
if (check) {
  if (v2Dirty.length) { console.error('STAMP STALE（v2）：' + v2Dirty.join(', ')); process.exit(1); }
  console.log('v2 版本号均为最新');
} else if (v2Dirty.length) {
  console.log('已更新版本号：' + v2Dirty.join(', '));
}

if (check) {
  if (out !== html) { console.error('STAMP STALE：index.html 的版本号不是最新，先跑 node scripts/stamp-assets.js'); process.exit(1); }
  console.log('STAMP OK：index.html 的 css / js 版本号与文件内容一致');
} else if (out !== html) {
  fs.writeFileSync(htmlPath, out);
  console.log('已更新 index.html 的 css / js 版本号');
} else {
  console.log('版本号已是最新，无需改动');
}
