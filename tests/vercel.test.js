/**
 * Vercel 函数自检：用 Node 的 http 服务器真实调用 api/index.mjs。
 *
 *   node tests/vercel.test.js [产物目录]
 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const DIST = path.resolve(ROOT, process.argv[2] || '.vercel-dist');
const PORT = 8792;

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

(async () => {
  console.log('\n[1] 产物结构');
  check('产物目录存在', fs.existsSync(DIST), DIST);
  check('首页存在', fs.existsSync(path.join(DIST, 'index.html')));
  check('函数存在', fs.existsSync(path.join(DIST, 'api', 'index.mjs')));
  check('函数可用的数据模块存在', fs.existsSync(path.join(DIST, 'data', 'law.mjs')));
  check('vercel.json 存在', fs.existsSync(path.join(DIST, 'vercel.json')));
  check('package.json 声明 type=module',
    JSON.parse(fs.readFileSync(path.join(DIST, 'package.json'), 'utf8')).type === 'module');
  const vj = JSON.parse(fs.readFileSync(path.join(DIST, 'vercel.json'), 'utf8'));
  check('vercel.json 把 /api/* 指向函数',
    JSON.stringify(vj.rewrites || []).indexOf('/api/index') !== -1);
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  check('首页已内联法典数据', html.indexOf('window.__LAW__ = {') !== -1);
  check('首页无占位符残留', html.indexOf('__LAW_DATA__') === -1);

  console.log('\n[2] 真实 HTTP 调用');
  const mod = await import(pathToFileURL(path.join(DIST, 'api', 'index.mjs')).href);
  const server = http.createServer((req, res) => {
    mod.default(req, res).catch((err) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    });
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + PORT;

  const get = async (p) => {
    const r = await fetch(base + p);
    const t = await r.text();
    let b = null;
    try { b = JSON.parse(t); } catch (e) { b = { raw: t.slice(0, 100) }; }
    return { status: r.status, body: b, cors: r.headers.get('access-control-allow-origin') };
  };
  const post = async (p, payload) => {
    const r = await fetch(base + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: r.status, body: await r.json(), cors: r.headers.get('access-control-allow-origin') };
  };

  const h = await get('/api/health');
  check('GET /api/health 返回 200', h.status === 200, String(h.status));
  check('  报告 40 条条文', h.body.articles === 40, String(h.body.articles));
  check('  带 CORS 头', h.cors === '*', String(h.cors));

  const law = await get('/api/law');
  check('GET /api/law 返回 9 章', law.status === 200 && law.body.chapters.length === 9);

  const s = await get('/api/search?q=' + encodeURIComponent('盗窃'));
  check('GET /api/search 命中第九条',
    s.body.results.some((r) => r.title.indexOf('第九条') === 0),
    (s.body.results || []).map((r) => r.title).slice(0, 2).join(','));

  const sp = await post('/api/search', { query: '外挂', limit: 3 });
  check('POST /api/search 可用', sp.status === 200 && sp.body.results.length > 0);

  for (const [q, expect] of [
    ['偷东西怎么判', '第九条'],
    ['一区可以PVP吗', '第四条'],
    ['使用外挂的后果', '第六条'],
    ['谋权夺位罪', '第三条之一'],
  ]) {
    const a = await post('/api/ask', { question: q });
    const titles = (a.body.citations || []).map((c) => c.title).join(' | ');
    check('POST /api/ask「' + q + '」引用 ' + expect,
      a.status === 200 && titles.indexOf(expect) !== -1, titles || '(无)');
  }

  const empty = await post('/api/ask', { question: '' });
  check('空问题返回 400', empty.status === 400, String(empty.status));

  const opt = await fetch(base + '/api/ask', { method: 'OPTIONS' });
  check('OPTIONS 预检返回 204', opt.status === 204, String(opt.status));

  await new Promise((r) => server.close(r));

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\n测试无法完成：' + err.message);
  console.error('先执行： node server/bundle-vercel.js');
  process.exit(1);
});
