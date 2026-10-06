/**
 * 云端函数自检：直接在 Node 里调用生成的 Netlify 函数，模拟线上请求。
 *
 *   node tests/cloudfn.test.js [产物目录]
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const DIST = path.resolve(ROOT, process.argv[2] || 'build/netlify-dist');
const FN = path.join(DIST, '.netlify', 'functions', 'api.mjs');

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
  check('样式与脚本存在',
    fs.existsSync(path.join(DIST, 'assets', 'app.css')) &&
    fs.existsSync(path.join(DIST, 'assets', 'app.js')) &&
    fs.existsSync(path.join(DIST, 'assets', 'qr.js')));
  check('云函数存在', fs.existsSync(FN));
  check('云函数数据模块存在',
    fs.existsSync(path.join(DIST, '.netlify', 'functions', 'data', 'law.mjs')));
  check('netlify.toml 存在', fs.existsSync(path.join(DIST, 'netlify.toml')));
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  check('首页已内联法典数据', html.indexOf('window.__LAW__ = {') !== -1);
  check('首页无占位符残留', html.indexOf('__LAW_DATA__') === -1);

  console.log('\n[2] 云函数响应');
  const mod = await import(pathToFileURL(FN).href);
  const call = async (url, init) => {
    const res = await mod.default(new Request('http://localhost' + url, init));
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { body = { raw: text.slice(0, 120) }; }
    return { status: res.status, body, cors: res.headers.get('access-control-allow-origin') };
  };

  const h = await call('/api/health');
  check('GET /api/health 返回 200', h.status === 200, String(h.status));
  check('  报告 40 条条文', h.body.articles === 40, String(h.body.articles));
  check('  版本为 G2.8', h.body.version === 'G2.8', h.body.version);
  check('  带 CORS 头（允许跨域调用）', h.cors === '*', String(h.cors));

  const law = await call('/api/law');
  check('GET /api/law 返回完整法典', law.status === 200 && law.body.chapters.length === 9);

  const s = await call('/api/search?q=' + encodeURIComponent('盗窃') + '&limit=3');
  check('GET /api/search 命中第九条',
    s.status === 200 && s.body.results.some((r) => r.title.indexOf('第九条') === 0),
    (s.body.results || []).map((r) => r.title).join(','));

  const cases = [
    ['偷东西怎么判', '第九条'],
    ['一区可以PVP吗', '第四条'],
    ['使用外挂的后果', '第六条'],
    ['怎么向法院起诉', '第二十一条'],
  ];
  for (const [q, expect] of cases) {
    const a = await call('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: q }),
    });
    const titles = (a.body.citations || []).map((c) => c.title).join(' | ');
    check('POST /api/ask「' + q + '」引用 ' + expect,
      a.status === 200 && titles.indexOf(expect) !== -1, titles || '(无)');
  }

  const empty = await call('/api/ask', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: '' }),
  });
  check('空问题返回 400', empty.status === 400, String(empty.status));

  const opt = await mod.default(new Request('http://localhost/api/ask', { method: 'OPTIONS' }));
  check('OPTIONS 预检返回 204', opt.status === 204, String(opt.status));

  const unknown = await call('/api/nope');
  check('未知接口返回 404', unknown.status === 404, String(unknown.status));

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\n测试无法完成：' + err.message);
  console.error('先执行： node server/bundle-netlify.js --out build/netlify-dist');
  process.exit(1);
});
