/**
 * End-to-end check of the running site: HTTP endpoints, inlined data, assets and
 * the DOM contract used by the client script.
 *
 *   node tests/server.test.js [baseUrl]
 */
'use strict';

const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const PUBLIC = path.join(__dirname, '..', 'public');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

async function getJson(pathname) {
  const res = await fetch(BASE + pathname);
  return { status: res.status, body: await res.json() };
}

async function postJson(pathname, payload) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

(async () => {
  console.log('\n[1] 健康检查与数据接口');
  const health = await getJson('/api/health');
  check('GET /api/health 返回 200', health.status === 200);
  check('健康检查报告 40 条条文', health.body.articles === 40, String(health.body.articles));
  check('健康检查报告引擎', typeof health.body.engine === 'string', health.body.engine);
  check('版本为 G2.8', health.body.version === 'G2.8', health.body.version);

  const law = await getJson('/api/law');
  check('GET /api/law 返回结构化法典', law.status === 200 && law.body.chapters.length === 9);
  check('法典含 4 份附录', law.body.appendices.length === 4, String(law.body.appendices.length));

  console.log('\n[2] 检索接口');
  const s1 = await getJson('/api/search?q=' + encodeURIComponent('盗窃'));
  check('GET /api/search 返回结果', s1.body.results.length > 0);
  check('盗窃首个结果为第九条', s1.body.results[0].title.indexOf('第九条') === 0,
    s1.body.results[0].title);
  const s2 = await postJson('/api/search', { query: '外挂', limit: 3 });
  check('POST /api/search 返回结果', s2.body.results.length > 0);
  check('检索结果带摘录', typeof s2.body.results[0].excerpt === 'string' &&
    s2.body.results[0].excerpt.length > 10);

  console.log('\n[3] 问答接口');
  const cases = [
    ['偷东西怎么判', '第九条'],
    ['一区可以PVP吗', '第四条'],
    ['使用外挂的后果', '第六条'],
    ['怎么向法院起诉', '第二十一条'],
    ['追诉时效是多久', '第三条'],
    ['谋权夺位罪怎么处罚', '第三条之一'],
    ['三区可以随便打架吗', '第八条'],
  ];
  for (const [q, expect] of cases) {
    const r = await postJson('/api/ask', { question: q });
    const titles = (r.body.citations || []).map((c) => c.title).join(' | ');
    check('「' + q + '」引用 ' + expect, titles.indexOf(expect) !== -1, titles || '(无引用)');
    check('「' + q + '」回答非空', (r.body.answer || '').length > 20);
  }
  const social = await postJson('/api/ask', { question: '你好' });
  check('社交寒暄走引导回复', social.body.intent === 'social', social.body.intent);
  const empty = await postJson('/api/ask', { question: '' });
  check('空问题返回 400', empty.status === 400, String(empty.status));
  const gibberish = await postJson('/api/ask', { question: 'zzzqqqxxx' });
  check('无关问题给出兜底回答', gibberish.body.confidence === 'none',
    gibberish.body.confidence);

  console.log('\n[4] 页面与静态资源');
  const pageRes = await fetch(BASE + '/');
  const page = await pageRes.text();
  check('GET / 返回 200', pageRes.status === 200);
  check('页面内联了法典数据', page.indexOf('window.__LAW__ = {') !== -1);
  check('页面未留下占位符', page.indexOf('/*__LAW_DATA__*/null') === -1);
  check('页面引用了 render.js', page.indexOf('assets/render.js') !== -1);
  check('页面引用了 app.js', page.indexOf('assets/app.js') !== -1);

  for (const asset of ['/assets/app.css', '/assets/app.js', '/assets/render.js',
    '/assets/favicon.svg', '/data/law.json']) {
    const r = await fetch(BASE + asset);
    const text = await r.text();
    check('静态资源 ' + asset + ' 可访问（' + text.length + ' 字节）',
      r.status === 200 && text.length > 100, String(r.status));
  }

  const notFound = await fetch(BASE + '/nope.txt');
  check('未知路径返回 404', notFound.status === 404, String(notFound.status));

  console.log('\n[5] 客户端 DOM 契约');
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(PUBLIC, 'assets', 'app.js'), 'utf8');

  const ids = (html.match(/id="[^"]+"/g) || []).map((s) => s.slice(4, -1));
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  check('index.html 无重复 id', dupes.length === 0, dupes.join(','));

  // every #id the script selects must exist in the markup
  const wanted = new Set();
  const re = /\$\('#([a-zA-Z0-9_-]+)'\)/g;
  let m;
  while ((m = re.exec(app)) !== null) wanted.add(m[1]);
  const missing = [...wanted].filter((id) => ids.indexOf(id) === -1);
  check('脚本静态引用的 ' + wanted.size + ' 个 id 全部存在', missing.length === 0, missing.join(','));

  // dynamically composed ids: $('#view-' + v)
  const dyn = (app.match(/\$\('#([a-zA-Z0-9_-]+-)' \+/g) || [])
    .map((s) => s.replace(/\$\('#/, '').replace(/' \+$/, ''));
  const dynMissing = dyn.filter((prefix) => !ids.some((id) => id.indexOf(prefix) === 0));
  check('脚本拼接的 id 前缀存在（' + (dyn.join(',') || '无') + '）', dynMissing.length === 0,
    dynMissing.join(','));

  // views referenced by setView()
  check('三个视图容器齐备',
    ['view-home', 'view-law', 'view-ask'].every((v) => ids.indexOf(v) !== -1));

  // the law data placeholder must be inside index.html exactly once
  check('数据占位符唯一', (html.match(/__LAW_DATA__/g) || []).length === 1);

  console.log('\n[6] 弹层默认隐藏（曾经的 bug：display:flex 压过 hidden）');
  const css = fs.readFileSync(path.join(PUBLIC, 'assets', 'app.css'), 'utf8');
  check('CSS 有 [hidden] 强制规则',
    /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(css));
  const overlayTag = (html.match(/<div class="overlay"[^>]*>/) || [''])[0];
  check('检索面板初始带 hidden 属性', /\shidden(\s|>)/.test(overlayTag), overlayTag);
  check('提示条初始带 hidden 属性',
    /\shidden(\s|>)/.test((html.match(/<div class="toast"[^>]*>/) || [''])[0]));
  // any element whose CSS sets display must not rely on hidden without the rule above
  const displayRules = (css.match(/^\.[a-z-]+[^{]*\{[^}]*display\s*:\s*(flex|grid|block)/gm) || [])
    .map((r) => r.split(/[{\s]/)[0]);
  const risky = displayRules.filter((sel) => /overlay|toast/.test(sel));
  check('弹层类名确实设置了 display（因此必须有 [hidden] 兜底）',
    risky.length > 0, risky.join(','));
  check('启动脚本兜底隐藏弹层',
    /overlay'\)\.hidden = true/.test(app) && /toast'\)\.hidden = true/.test(app));

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\n测试无法完成：' + err.message);
  console.error('请先启动服务：node server/index.js\n');
  process.exit(1);
});
