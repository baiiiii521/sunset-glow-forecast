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

if (check) {
  if (out !== html) { console.error('STAMP STALE：index.html 的版本号不是最新，先跑 node scripts/stamp-assets.js'); process.exit(1); }
  console.log('STAMP OK：index.html 的 css / js 版本号与文件内容一致');
} else if (out !== html) {
  fs.writeFileSync(htmlPath, out);
  console.log('已更新 index.html 的 css / js 版本号');
} else {
  console.log('版本号已是最新，无需改动');
}
