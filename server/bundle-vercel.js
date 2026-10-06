/**
 * 打包成 Vercel 可部署形态：静态站 + Serverless 函数。
 *
 *   node server/bundle-vercel.js [--out .vercel-dist]
 *
 * 产出结构：
 *   .vercel-dist/index.html          首页（已内联法典数据）
 *   .vercel-dist/assets/…            样式与脚本
 *   .vercel-dist/data/law.json       结构化法典
 *   .vercel-dist/api/index.mjs       函数入口（/api/*）
 *   .vercel-dist/vercel.json         路由与函数配置
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = path.resolve(ROOT, argOf('--out', '.vercel-dist'));

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

// 2) 首页：同源 API，无需 __API_BASE__
const lawJson = fs.readFileSync(path.join(PUBLIC, 'data', 'law.json'), 'utf8');
let shell = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
  .replace('<script>window.__LAW__',
    '<script>window.__API_BASE__ = null;</script>\n<script>window.__LAW__')
  .replace('/*__LAW_DATA__*/null', lawJson.replace(/<\//g, '<\\/'));
fs.writeFileSync(path.join(OUT, 'index.html'), shell);

// 3) Serverless 函数：内联 kb.js / answer.js，注入 require 以便原样复用 CJS 代码
const kbSrc = fs.readFileSync(path.join(ROOT, 'server', 'kb.js'), 'utf8')
  .replace(/module\.exports\s*=\s*\{[^}]*\};?\s*$/m, '');
const ansSrc = fs.readFileSync(path.join(ROOT, 'server', 'answer.js'), 'utf8')
  .replace(/const\s*\{\s*tokenize\s*\}\s*=\s*require\(['"]\.\/kb['"]\);?/, '')
  .replace(/module\.exports\s*=\s*\{[^}]*\};?\s*$/m, '');

const fnSource = `/**
 * 《我的世界》世界基本法典 —— Vercel Serverless 函数
 * 由 server/bundle-vercel.js 生成，请勿手改。
 *
 * 处理：GET /api/health  GET /api/law  GET|POST /api/search  POST /api/ask
 */
import { createRequire } from 'node:module';

import LAW from '../data/law.mjs';

const require = createRequire(import.meta.url);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

/* ══════════════ 内联自 server/kb.js ══════════════ */
${kbSrc.replace(/^'use strict';\s*/m, '')}
/* ══════════════ 内联自 server/answer.js ══════════════ */
${ansSrc.replace(/^'use strict';\s*/m, '')}

/* ══════════════════════════ 入口 ══════════════════════════ */
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

function send(res, status, body) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 262144) req.destroy(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const route = url.pathname.replace(/^\\/api\\/?/, '') || 'health';

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    return res.end();
  }

  try {
    if (route === 'health') {
      return send(res, 200, {
        ok: true,
        articles: kb.articleList().length,
        docs: kb.docs.length,
        engine: process.env.LAW_LLM_API_KEY ? 'llm' : 'statute-retrieval',
        version: LAW.version,
        date: LAW.date,
        access: [],
      });
    }

    if (route === 'law') return send(res, 200, LAW);

    if (route === 'search') {
      let q = url.searchParams.get('q') || '';
      let limit = Number(url.searchParams.get('limit') || 8);
      if (req.method === 'POST') {
        const body = await readBody(req);
        q = String(body.query || q);
        limit = Number(body.limit || limit);
      }
      limit = Math.min(20, limit || 8);
      return send(res, 200, {
        query: q,
        results: kb.search(q, limit).map((h) => ({
          anchor: h.doc.anchor, title: h.doc.title, kind: h.doc.kind,
          chapterTitle: h.doc.chapterTitle, tags: h.doc.tags, score: h.score,
          excerpt: (h.doc.paragraphs || []).join(' ').slice(0, 180),
        })),
      });
    }

    if (route === 'ask') {
      if (req.method !== 'POST') return send(res, 405, { error: 'use POST' });
      const body = await readBody(req);
      const question = String(body.question || '').slice(0, 1000);
      if (!question.trim()) return send(res, 400, { error: 'question is required' });
      const started = Date.now();
      const result = await engine.answer(question, Array.isArray(body.history) ? body.history : []);
      return send(res, 200, {
        ...result,
        question,
        elapsedMs: Date.now() - started,
        retrieved: kb.search(question, 4).map((h) => ({
          anchor: h.doc.anchor, title: h.doc.title, score: h.score,
        })),
      });
    }

    return send(res, 404, { error: 'unknown endpoint: ' + route });
  } catch (err) {
    return send(res, 500, { error: err.message || 'internal error' });
  }
}
`;

fs.mkdirSync(path.join(OUT, 'api'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'api', 'index.mjs'), fnSource);

// 数据也放一份给函数用（.mjs 形式，避免 JSON 导入断言语法的版本差异）
fs.writeFileSync(path.join(OUT, 'data', 'law.mjs'),
  '// 生成文件：供 Serverless 函数导入\nexport default ' +
  JSON.stringify(JSON.parse(lawJson)) + ';\n');

// 4) Vercel 配置
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({
  name: 'minecraft-law-site',
  version: '2.8.0',
  private: true,
  type: 'module',
}, null, 2) + '\n');

fs.writeFileSync(path.join(OUT, 'vercel.json'), JSON.stringify({
  version: 2,
  rewrites: [{ source: '/api/:path*', destination: '/api/index' }],
  headers: [
    {
      source: '/assets/(.*)',
      headers: [{ key: 'cache-control', value: 'public, max-age=3600' }],
    },
  ],
}, null, 2) + '\n');

function dirSize(d) {
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
}

console.log('Vercel 打包完成 -> ' + OUT);
console.log('  首页   : index.html（' + Math.round(shell.length / 1024) + ' KB，已内联法典数据）');
console.log('  函数   : api/index.mjs');
console.log('  总大小 : ' + (dirSize(OUT) / 1024 / 1024).toFixed(2) + ' MB');
