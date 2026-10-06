/**
 * 世界基本法典 · 官方网站服务器
 *
 *   node server/index.js [--port 8787]
 *
 * Routes
 *   GET  /                     -> public/index.html (law data injected)
 *   GET  /assets/*             -> static assets
 *   GET  /api/health           -> service + engine status
 *   GET  /api/law              -> structured law JSON
 *   POST /api/ask              -> grounded Q&A  { question, history }
 *   POST /api/search           -> retrieval only { query, limit }
 *
 * The AI answers come from the statute itself (BM25 retrieval + sentence
 * selection). If an OpenAI-compatible endpoint is configured the same retrieved
 * context is used as grounding for that model instead; see README.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KnowledgeBase } = require('./kb');
const { AnswerEngine } = require('./answer');

const ROOT = path.join(__dirname, '..');

/**
 * 同时支持两种目录布局：
 *   开发/源码布局   <root>/public/{index.html,assets,data}
 *   构建产物布局    <root>/{index.html,assets,data} + <root>/server
 */
function resolveLayout(root) {
  const candidates = [
    { pub: path.join(root, 'public'), server: path.join(root, 'server') },
    { pub: root, server: path.join(root, 'server') },
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c.pub, 'index.html')) &&
        fs.existsSync(path.join(c.pub, 'data', 'law.json'))) {
      return c;
    }
  }
  return candidates[0];
}

const LAYOUT = resolveLayout(ROOT);
const PUBLIC = LAYOUT.pub;
const LAW_PATH = path.join(PUBLIC, 'data', 'law.json');

const argv = process.argv.slice(2);
const argPort = (() => {
  const i = argv.indexOf('--port');
  if (i !== -1 && argv[i + 1]) return Number(argv[i + 1]);
  return Number(process.env.PORT || 8787);
})();
const PORT = Number.isFinite(argPort) && argPort > 0 ? argPort : 8787;
// 0.0.0.0 让同一 WiFi 下的手机/其他电脑也能打开；设 HOST=127.0.0.1 可只允许本机
const HOST = process.env.HOST || '0.0.0.0';

/** 局域网 IPv4 地址（跳过回环、虚拟网卡、容器网段与 APIPA）。 */
function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  // 容器 / 云厂商内网网段：在公网部署时这些地址对外没有意义
  const isVirtualNet = (ip) =>
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||      // docker / k8s 默认网段
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) ||  // 运营商级 NAT (CGNAT)
    /^10\./.test(ip);                              // 云主机内网
  const isVirtualIface = (name) =>
    /^(vEthernet|Loopback|VMware|VirtualBox|Hyper-V|docker|br-|veth|tun|tap|wg)/i.test(name);
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (/^169\.254\./.test(info.address)) continue;   // APIPA
      if (isVirtualIface(name) || isVirtualNet(info.address)) continue;
      out.push({ address: info.address, iface: name });
    }
  }
  return out;
}

function accessUrls() {
  const list = [{ label: '本机', url: 'http://127.0.0.1:' + PORT, lan: false }];
  for (const { address, iface } of lanAddresses()) {
    list.push({ label: '局域网 · ' + iface, url: 'http://' + address + ':' + PORT, lan: true });
  }
  return list;
}

const kb = new KnowledgeBase(LAW_PATH);

const provider = (() => {
  const apiKey = process.env.LAW_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  if (!apiKey) return { enabled: false };
  const baseUrl = process.env.LAW_LLM_BASE_URL || 'https://api.deepseek.com/v1';
  return {
    enabled: true,
    label: process.env.LAW_LLM_LABEL || 'llm',
    apiKey,
    baseUrl,
    model: process.env.LAW_LLM_MODEL || 'deepseek-chat',
    temperature: process.env.LAW_LLM_TEMPERATURE ? Number(process.env.LAW_LLM_TEMPERATURE) : 0.2,
    timeoutMs: Number(process.env.LAW_LLM_TIMEOUT_MS || 30000),
  };
})();

const engine = new AnswerEngine(kb, { provider });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': type,
    'cache-control': type.startsWith('application/json') ? 'no-store' : 'no-cache',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Serve the SPA shell with the law payload inlined so the first paint is complete. */
function serveIndex(res) {
  const shell = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const law = fs.readFileSync(LAW_PATH, 'utf8');
  const html = shell.replace('/*__LAW_DATA__*/null',
    law.replace(/<\//g, '<\\/'));
  send(res, 200, html, MIME['.html']);
}

function serveStatic(res, rel) {
  const target = path.join(PUBLIC, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!target.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, { error: 'not found' });
    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
    fs.createReadStream(target).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const route = url.pathname;

  try {
    if (req.method === 'GET' && (route === '/' || route === '/index.html')) return serveIndex(res);

    if (req.method === 'GET' && route === '/api/health') {
      return send(res, 200, {
        ok: true,
        articles: kb.articleList().length,
        docs: kb.docs.length,
        engine: provider.enabled ? (provider.label || 'llm') : 'statute-retrieval',
        version: kb.law.version,
        date: kb.law.date,
        access: accessUrls(),
      });
    }

    if (req.method === 'GET' && route === '/api/law') return send(res, 200, kb.law);

    if (req.method === 'GET' && route === '/api/search') {
      const q = url.searchParams.get('q') || '';
      const limit = Math.min(20, Number(url.searchParams.get('limit') || 8));
      return send(res, 200, {
        query: q,
        results: kb.search(q, limit).map((h) => ({
          anchor: h.doc.anchor, title: h.doc.title, kind: h.doc.kind,
          chapterTitle: h.doc.chapterTitle, tags: h.doc.tags,
          score: h.score, excerpt: (h.doc.paragraphs || []).join(' ').slice(0, 180),
        })),
      });
    }

    if (req.method === 'POST' && route === '/api/search') {
      const body = await readBody(req);
      const limit = Math.min(20, Number(body.limit || 8));
      return send(res, 200, {
        query: body.query || '',
        results: kb.search(body.query || '', limit).map((h) => ({
          anchor: h.doc.anchor, title: h.doc.title, kind: h.doc.kind,
          chapterTitle: h.doc.chapterTitle, tags: h.doc.tags,
          score: h.score, excerpt: (h.doc.paragraphs || []).join(' ').slice(0, 180),
        })),
      });
    }

    if (req.method === 'POST' && route === '/api/ask') {
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

    if (req.method === 'GET') return serveStatic(res, route);
    return send(res, 405, { error: 'method not allowed' });
  } catch (err) {
    return send(res, 500, { error: err.message || 'internal error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log('法典官网已启动');
  for (const u of accessUrls()) {
    console.log('  ' + (u.lan ? '手机 / 其他电脑' : '本机        ') + '  ' + u.url);
  }
  console.log('  法典版本: ' + kb.law.version + ' · 条文 ' + kb.articleList().length +
    ' 条 · 检索单元 ' + kb.docs.length + ' 个');
  console.log('  AI 引擎: ' + (provider.enabled
    ? (provider.label || 'llm') + ' (' + provider.model + ' @ ' + provider.baseUrl + ')'
    : '条文检索（离线，内置）'));
  if (HOST === '0.0.0.0') {
    console.log('  提示: 手机连同一个 WiFi 即可访问上面的局域网地址；');
    console.log('        若打不开，请允许 Node.js 通过 Windows 防火墙（专用网络）。');
  }
});

// 被 require 时（测试、嵌入其他进程）暴露句柄，便于优雅关闭
module.exports = { server, kb, engine, accessUrls, LAYOUT, PORT, HOST };
