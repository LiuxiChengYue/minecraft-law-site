/**
 * 打包成 GitHub Pages 静态站（无需任何后端，问答在浏览器里完成）。
 *
 *   node server/bundle-pages.js [--out pages-dist] [--base /repo-name/]
 *
 * GitHub Pages 是子路径部署（/仓库名/），因此把资源引用改成相对路径，
 * 这样根域名和子路径两种情形都能工作。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = path.resolve(ROOT, argOf('--out', 'pages-dist'));

function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

copyDir(path.join(PUBLIC, 'assets'), path.join(OUT, 'assets'));
copyDir(path.join(PUBLIC, 'data'), path.join(OUT, 'data'));

const lawJson = fs.readFileSync(path.join(PUBLIC, 'data', 'law.json'), 'utf8');
let shell = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

// 纯静态：API 基址为空，前端会自动回退到浏览器内置引擎
shell = shell
  .replace('<script>window.__LAW__',
    '<script>window.__API_BASE__ = null;</script>\n<script>window.__LAW__')
  .replace('/*__LAW_DATA__*/null', lawJson.replace(/<\//g, '<\\/'));

// 资源引用改相对路径，兼容 https://user.github.io/repo/ 这种子路径
shell = shell
  .replace(/href="assets\//g, 'href="./assets/')
  .replace(/src="assets\//g, 'src="./assets/');

// 让 GitHub Pages 不要用 Jekyll 处理（避免下划线目录被忽略）
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

fs.writeFileSync(path.join(OUT, 'index.html'), shell);

// 404 也指回首页（单页应用用 hash 路由，刷新不会 404）
fs.copyFileSync(path.join(OUT, 'index.html'), path.join(OUT, '404.html'));

function dirSize(d) {
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
}

console.log('GitHub Pages 打包完成 -> ' + OUT);
console.log('  index.html : ' + Math.round(shell.length / 1024) + ' KB（已内联法典数据）');
console.log('  404.html   : 复制自 index.html（hash 路由刷新不丢页）');
console.log('  .nojekyll  : 已添加');
console.log('  总大小     : ' + (dirSize(OUT) / 1024 / 1024).toFixed(2) + ' MB');
console.log('  问答方式   : 浏览器内置引擎（无需后端）');
