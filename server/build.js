/**
 * 构建可部署产物。
 *
 *   node server/build.js                  -> dist/            （完整站点：静态 + API）
 *   node server/build.js --static-only    -> dist/            （纯静态，可放任意托管/CDN）
 *   node server/build.js --api-base https://api.example.com
 *
 * dist/ 内容：
 *   index.html            法典数据已内联，首屏零额外请求
 *   assets/…              样式、脚本、图标
 *   data/law.json         结构化法典（供二次开发）
 *   server/…              Node 服务（可选，只有 AI 问答需要它）
 *   Dockerfile 等         部署所需文件
 *   deploy.json           本次构建信息
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, dflt) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt;
};

const staticOnly = flag('--static-only');
const apiBase = value('--api-base', '').replace(/\/$/, '');
const outDir = value('--out', DIST);

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function bytes(dir) {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += fs.statSync(p).size;
    }
  };
  walk(dir);
  return total;
}

/* ─────────────────────────── 组装 ─────────────────────────── */

rmrf(outDir);
fs.mkdirSync(outDir, { recursive: true });

// 1) 静态资源
copyDir(path.join(PUBLIC, 'assets'), path.join(outDir, 'assets'));
copyDir(path.join(PUBLIC, 'data'), path.join(outDir, 'data'));

// 2) 首页：内联法典数据 + 可选的 API 地址
const lawJson = fs.readFileSync(path.join(PUBLIC, 'data', 'law.json'), 'utf8');
let shell = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const apiLine = 'window.__API_BASE__ = ' + JSON.stringify(apiBase || null) + ';';
shell = shell
  .replace('<script>window.__LAW__', '<script>' + apiLine + '</script>\n<script>window.__LAW__')
  .replace('/*__LAW_DATA__*/null', lawJson.replace(/<\//g, '<\\/'));
fs.writeFileSync(path.join(outDir, 'index.html'), shell);

// 3) 服务端（纯静态构建时也保留，方便随时加回 AI）
copyDir(path.join(ROOT, 'server'), path.join(outDir, 'server'));

// 4) 部署所需的描述文件（仓库根目录：Blueprint / 容器平台都从这里读）
const DEPLOY_FILES = ['Dockerfile', 'docker-compose.yml', 'render.yaml', 'railway.json',
  'fly.toml', 'Procfile', 'law-site.service', '.dockerignore'];
for (const f of DEPLOY_FILES) {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, f));
}
if (fs.existsSync(path.join(ROOT, 'README.md'))) {
  fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(outDir, 'README.md'));
}

// 纯静态构建：去掉服务端与容器文件，只留可直接托管的静态站
if (staticOnly) {
  rmrf(path.join(outDir, 'server'));
  for (const f of DEPLOY_FILES) {
    const p = path.join(outDir, f);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

const meta = {
  builtAt: new Date().toISOString(),
  version: JSON.parse(lawJson).version,
  mode: staticOnly ? 'static' : 'server',
  apiBase: apiBase || '(same origin)',
  files: 0,
  bytes: 0,
};
meta.bytes = bytes(outDir);
const walkCount = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce(
  (n, e) => n + (e.isDirectory() ? walkCount(path.join(d, e.name)) : 1), 0);
meta.files = walkCount(outDir);
fs.writeFileSync(path.join(outDir, 'deploy.json'),
  JSON.stringify(meta, null, 2) + '\n');

console.log('构建完成 -> ' + outDir);
console.log('  模式     : ' + (staticOnly ? '纯静态（仅需静态托管）' : '完整站点（含 Node 服务）'));
console.log('  API 地址 : ' + meta.apiBase);
console.log('  法典版本 : ' + meta.version);
console.log('  文件数量 : ' + meta.files + ' 个，共 ' +
  (meta.bytes / 1024 / 1024).toFixed(2) + ' MB');
if (staticOnly) {
  console.log('  提示     : 纯静态站点里 AI 问答会不可用（会给出友好提示），检索与全文正常。');
}
