/**
 * 把项目打包成 Netlify 可部署的形态（静态站 + 一个云函数处理 /api/*）。
 *
 *   node server/bundle-netlify.js --out netlify-dist
 *
 * 产出：
 *   netlify-dist/index.html      内联法典数据的首页
 *   netlify-dist/assets/…        样式与脚本
 *   netlify-dist/data/law.json   结构化法典（供二次开发 / 前端备份）
 *   netlify-dist/api.mjs         云函数（/api/health /api/law /api/search /api/ask）
 *   netlify-dist/netlify.toml    站点配置
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = path.resolve(ROOT, argOf('--out', 'netlify-dist'));
const API_BASE = argOf('--api-base', '').replace(/\/$/, '');

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

// 1) 静态资源
copyDir(path.join(PUBLIC, 'assets'), path.join(OUT, 'assets'));
copyDir(path.join(PUBLIC, 'data'), path.join(OUT, 'data'));

// 2) 首页：内联法典数据 + API 地址
const lawJson = fs.readFileSync(path.join(PUBLIC, 'data', 'law.json'), 'utf8');
const apiLine = 'window.__API_BASE__ = ' + JSON.stringify(API_BASE || null) + ';';
let shell = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
  .replace('<script>window.__LAW__', '<script>' + apiLine + '</script>\n<script>window.__LAW__')
  .replace('/*__LAW_DATA__*/null', lawJson.replace(/<\//g, '<\\/'));
fs.writeFileSync(path.join(OUT, 'index.html'), shell);

// 3) 云函数：内联 kb.js / answer.js 与法典数据，单个文件即可运行
//    内联的是 CommonJS 源码，这里注入 require/createRequire 让它在 ESM 下原样可用
const kb = fs.readFileSync(path.join(ROOT, 'server', 'kb.js'), 'utf8')
  .replace(/module\.exports\s*=\s*\{[^}]*\};?\s*$/m, '');
const answer = fs.readFileSync(path.join(ROOT, 'server', 'answer.js'), 'utf8')
  .replace(/const\s*\{\s*tokenize\s*\}\s*=\s*require\(['"]\.\/kb['"]\);?/, '')
  .replace(/module\.exports\s*=\s*\{[^}]*\};?\s*$/m, '');

const fn = `/**
 * 《我的世界》世界基本法典 —— 云函数（由 server/bundle-netlify.js 生成，请勿手改）
 * 处理 /api/health /api/law /api/search /api/ask
 */
import { createRequire } from 'node:module';

import LAW from './data/law.mjs';

const require = createRequire(import.meta.url);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

/* ══════════════ 以下代码由 server/kb.js 生成 ══════════════ */
${kb.replace(/^'use strict';\s*/m, '')}
/* ══════════════ 以下代码由 server/answer.js 生成 ══════════════ */
${answer.replace(/^'use strict';\s*/m, '')}

/* ══════════════════════════ 处理器 ══════════════════════════ */
const kb = new KnowledgeBase(LAW);
const engine = new AnswerEngine(kb, {
  provider: process.env.LAW_LLM_API_KEY ? {
    enabled: true,
    label: 'llm',
    apiKey: process.env.LAW_LLM_API_KEY,
    baseUrl: process.env.LAW_LLM_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.LAW_LLM_MODEL || 'deepseek-chat',
    temperature: 0.2,
    timeoutMs: 30000,
  } : { enabled: false },
});

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/\\/api\\/?/, '') || 'health';

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    if (route === 'health') {
      return json(200, {
        ok: true,
        articles: kb.articleList().length,
        docs: kb.docs.length,
        engine: process.env.LAW_LLM_API_KEY ? 'llm' : 'statute-retrieval',
        version: LAW.version,
        date: LAW.date,
        access: [],
      });
    }

    if (route === 'law') return json(200, LAW);

    if (route === 'search') {
      const q = url.searchParams.get('q') || '';
      const limit = Math.min(20, Number(url.searchParams.get('limit') || 8));
      return json(200, {
        query: q,
        results: kb.search(q, limit).map((h) => ({
          anchor: h.doc.anchor, title: h.doc.title, kind: h.doc.kind,
          chapterTitle: h.doc.chapterTitle, tags: h.doc.tags, score: h.score,
          excerpt: (h.doc.paragraphs || []).join(' ').slice(0, 180),
        })),
      });
    }

    if (route === 'ask') {
      if (req.method !== 'POST') return json(405, { error: 'use POST' });
      const body = await req.json().catch(() => ({}));
      const question = String(body.question || '').slice(0, 1000);
      if (!question.trim()) return json(400, { error: 'question is required' });
      const started = Date.now();
      const result = await engine.answer(question, Array.isArray(body.history) ? body.history : []);
      return json(200, {
        ...result,
        question,
        elapsedMs: Date.now() - started,
        retrieved: kb.search(question, 4).map((h) => ({
          anchor: h.doc.anchor, title: h.doc.title, score: h.score,
        })),
      });
    }

    return json(404, { error: 'unknown endpoint: ' + route });
  } catch (err) {
    return json(500, { error: err.message || 'internal error' });
  }
};

export const config = { path: '/api/*' };
`;

fs.writeFileSync(path.join(OUT, 'api.mjs'), fn);

// 4) Netlify 配置
fs.writeFileSync(path.join(OUT, 'netlify.toml'), `# 《我的世界》世界基本法典 官方网站
[build]
  publish = "."

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200

[[headers]]
  for = "/assets/*"
  [headers.values]
    cache-control = "public, max-age=3600"
`);

// 5) 函数目录（Netlify 约定 .netlify/functions）
const fnDir = path.join(OUT, '.netlify', 'functions');
fs.mkdirSync(path.join(fnDir, 'data'), { recursive: true });
// 用 .mjs 导出对象，避免各 Node 版本对 JSON 导入断言语法的差异
fs.writeFileSync(path.join(fnDir, 'data', 'law.mjs'),
  '// 《我的世界》世界基本法典 结构化数据（生成文件）\nexport default ' +
  JSON.stringify(JSON.parse(lawJson)) + ';\n');
fs.copyFileSync(path.join(OUT, 'api.mjs'), path.join(fnDir, 'api.mjs'));

// 让整个产物目录按 ESM 解析（云函数里用了 import）
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({
  name: 'minecraft-law-site-static',
  private: true,
  type: 'module',
}, null, 2) + '\n');
fs.writeFileSync(path.join(fnDir, 'package.json'), JSON.stringify({
  type: 'module',
}, null, 2) + '\n');

function dirSize(d) {
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
}

console.log('打包完成 -> ' + OUT);
console.log('  首页      : index.html（' + Math.round(shell.length / 1024) + ' KB，已内联法典数据）');
console.log('  云函数    : .netlify/functions/api.mjs');
console.log('  总大小    : ' + (dirSize(OUT) / 1024 / 1024).toFixed(2) + ' MB');
