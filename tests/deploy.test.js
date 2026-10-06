/**
 * 构建产物自检：dist/ 能否独立运行、纯静态模式与外部 API 模式是否正确。
 *
 * 全部在当前进程内完成（构建脚本是模块；dist 里的服务用 require 启动），
 * 这样在受限环境下也能跑。
 *
 *   node tests/deploy.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = 8791;

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

/** 直接调用构建脚本（模块方式，不产生子进程）。 */
function build(args) {
  const prevArgv = process.argv;
  const prevCwd = process.cwd();
  process.argv = [process.execPath, path.join(ROOT, 'server', 'build.js'), ...args];
  const log = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try {
    delete require.cache[require.resolve(path.join(ROOT, 'server', 'build.js'))];
    require(path.join(ROOT, 'server', 'build.js'));
  } finally {
    console.log = log;
    process.argv = prevArgv;
    process.chdir(prevCwd);
  }
  return lines;
}

function waitHealth(port, tries) {
  return new Promise((resolve) => {
    let n = 0;
    const tick = async () => {
      n++;
      try {
        const r = await fetch('http://127.0.0.1:' + port + '/api/health');
        if (r.ok) return resolve(await r.json());
      } catch (e) { /* not up yet */ }
      if (n >= (tries || 25)) return resolve(null);
      setTimeout(tick, 120);
    };
    tick();
  });
}

(async () => {
  console.log('\n[1] 完整站点构建（默认）');
  let out = build([]);
  check('构建脚本执行成功', /构建完成/.test(out.join('\n')), out.slice(-1)[0]);
  check('产出 index.html', fs.existsSync(path.join(DIST, 'index.html')));
  check('产出部署文件（Dockerfile / compose / 平台配置）',
    ['Dockerfile', 'docker-compose.yml', 'render.yaml', 'railway.json', 'fly.toml',
      'Procfile', 'law-site.service', '.dockerignore']
      .every((f) => fs.existsSync(path.join(DIST, f))));
  check('产出服务端与法典数据',
    fs.existsSync(path.join(DIST, 'server', 'index.js')) &&
    fs.existsSync(path.join(DIST, 'data', 'law.json')));

  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  check('首页已内联法典数据', html.indexOf('window.__LAW__ = {') !== -1);
  check('首页无残留占位符', html.indexOf('__LAW_DATA__') === -1);
  check('默认 API 地址为空（同源）', html.indexOf('window.__API_BASE__ = null;') !== -1);
  const meta = JSON.parse(fs.readFileSync(path.join(DIST, 'deploy.json'), 'utf8'));
  check('构建信息完整', meta.version === 'G2.8' && meta.mode === 'server' && meta.files > 15,
    JSON.stringify(meta));
  check('体积合理（< 3MB）', meta.bytes < 3 * 1024 * 1024,
    (meta.bytes / 1024 / 1024).toFixed(2) + ' MB');

  console.log('\n[2] dist/ 独立运行（require dist/server/index.js）');
  process.chdir(DIST);
  process.env.PORT = String(PORT);
  process.env.HOST = '127.0.0.1';
  const distServer = require(path.join(DIST, 'server', 'index.js'));
  const health = await waitHealth(PORT);
  check('服务从 dist/ 启动并响应健康检查', !!health, health ? '' : '无响应');
  if (health) {
    check('健康检查报告 40 条条文', health.articles === 40, String(health.articles));
    check('健康检查带访问地址', Array.isArray(health.access) && health.access.length > 0);
  }
  const ask = await (await fetch('http://127.0.0.1:' + PORT + '/api/ask', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: '偷东西怎么判' }),
  })).json();
  check('问答可用并引用第九条',
    (ask.citations || []).some((c) => c.title.indexOf('第九条') === 0),
    (ask.citations || []).map((c) => c.title).join(','));
  const page = await (await fetch('http://127.0.0.1:' + PORT + '/')).text();
  check('首页可直接访问', page.indexOf('世界基本法典') !== -1 && page.length > 100000);
  check('服务端正确识别构建产物布局',
    distServer.LAYOUT.pub === DIST, distServer.LAYOUT.pub);

  // 关闭监听并释放句柄，否则没法重建 dist/
  await new Promise((resolve) => distServer.server.close(resolve));
  process.chdir(ROOT);

  console.log('\n[3] 纯静态 + 外部 API 构建');
  out = build(['--static-only', '--api-base', 'https://api.example.com/']);
  check('构建脚本执行成功', /纯静态/.test(out.join('\n')), out.slice(-1)[0]);
  check('不含 server/', !fs.existsSync(path.join(DIST, 'server')));
  check('不含容器/平台文件',
    !fs.existsSync(path.join(DIST, 'Dockerfile')) &&
    !fs.existsSync(path.join(DIST, 'docker-compose.yml')));
  check('仍含静态资源',
    fs.existsSync(path.join(DIST, 'assets', 'app.js')) &&
    fs.existsSync(path.join(DIST, 'assets', 'qr.js')) &&
    fs.existsSync(path.join(DIST, 'data', 'law.json')));
  const html2 = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  check('API 地址已注入且去掉尾斜杠',
    html2.indexOf('window.__API_BASE__ = "https://api.example.com";') !== -1,
    (html2.match(/__API_BASE__ = [^;]+/) || [''])[0]);
  check('前端使用 __API_BASE__ 调用问答',
    fs.readFileSync(path.join(DIST, 'assets', 'app.js'), 'utf8')
      .indexOf("fetch(api('/api/ask')") !== -1);
  const meta2 = JSON.parse(fs.readFileSync(path.join(DIST, 'deploy.json'), 'utf8'));
  check('构建信息记录为 static', meta2.mode === 'static', meta2.mode);
  check('纯静态体积小于完整站点', meta2.bytes < meta.bytes);

  console.log('\n[4] 还原默认构建');
  build([]);
  check('重新构建为完整站点', fs.existsSync(path.join(DIST, 'server', 'index.js')));

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\n测试无法完成：' + err.message);
  process.exit(1);
});
