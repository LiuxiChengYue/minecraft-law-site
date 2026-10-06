/**
 * 用 Vercel REST API 直接部署（不需要安装 CLI）。
 *
 *   node tools/deploy-vercel.js --token <vercel_token> [--prod] [--name minecraft-law-site]
 *   node tools/deploy-vercel.js --check        # 只检查产物是否就绪
 *
 * 令牌获取：https://vercel.com/account/tokens
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const TOKEN = argOf('--token', process.env.VERCEL_TOKEN || '');
const NAME = argOf('--name', 'minecraft-law-site');
const PROD = argv.includes('--prod');
const DIST = path.resolve(ROOT, argOf('--dir', '.vercel-dist'));
const API = 'https://api.vercel.com';

/* 不参与上传的文件 */
const EXCLUDE = new Set(['.git', 'node_modules', '.vercel', 'build', '.DS_Store']);

function walk(dir, prefix, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    const rel = prefix ? prefix + '/' + e.name : e.name;
    if (e.isDirectory()) walk(abs, rel, out);
    else {
      const buf = fs.readFileSync(abs);
      out.push({
        file: rel,
        abs,
        size: buf.length,
        sha: crypto.createHash('sha1').update(buf).digest('hex'),
        data: buf,
      });
    }
  }
  return out;
}

async function api(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: {
      authorization: 'Bearer ' + TOKEN,
      'content-type': 'application/json',
      'user-agent': 'law-site-deployer',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error('Vercel API ' + res.status + ': ' +
      ((json && (json.error && (json.error.message || json.error.code))) || text.slice(0, 200)));
    err.status = res.status;
    throw err;
  }
  return json;
}

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('找不到产物：' + DIST);
    console.error('请先执行： node server/bundle-vercel.js');
    process.exit(1);
  }

  const files = walk(DIST, '', []);
  const total = files.reduce((s, f) => s + f.size, 0);
  console.log('\n准备上传 ' + files.length + ' 个文件，共 ' + (total / 1024).toFixed(0) + ' KB');
  for (const f of files) console.log('  ' + f.file.padEnd(28) + (f.size / 1024).toFixed(1) + ' KB');

  if (!TOKEN) {
    console.log('\n[未提供令牌] 只做了预演。正式部署请加 --token <你的令牌>');
    console.log('令牌获取地址： https://vercel.com/account/tokens\n');
    return;
  }

  console.log('\n[1/3] 验证令牌…');
  const me = await api('GET', '/v2/user');
  console.log('  已登录：' + (me.user.username || me.user.email));

  console.log('[2/3] 上传文件…');
  const payload = files.map((f) => ({
    file: f.file,
    sha: f.sha,
    size: f.size,
    encoding: 'base64',
    data: f.data.toString('base64'),
  }));

  const deploy = await api('POST', '/v13/deployments?forceNew=1', {
    name: NAME,
    files: payload,
    target: PROD ? 'production' : undefined,
    projectSettings: {
      framework: null,
      buildCommand: null,
      outputDirectory: null,
      installCommand: null,
      devCommand: null,
    },
  });

  console.log('[3/3] 部署中…');
  const idOrUrl = deploy.id;
  let state = deploy.readyState || deploy.status;
  let url = deploy.url ? 'https://' + deploy.url : null;
  for (let i = 0; i < 60 && state !== 'READY' && state !== 'ERROR'; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const d = await api('GET', '/v13/deployments/' + idOrUrl);
    state = d.readyState || d.status;
    url = d.url ? 'https://' + d.url : url;
    process.stdout.write('  状态：' + state + '    \r');
  }
  console.log('  最终状态：' + state + '            ');

  if (state !== 'READY') {
    console.error('\n部署未成功。可以到 https://vercel.com/dashboard 查看构建日志。');
    process.exit(1);
  }

  console.log('\n部署成功！');
  console.log('  访问地址： ' + url);
  console.log('  检查接口： ' + url + '/api/health');
  console.log('  管理面板： https://vercel.com/dashboard\n');
})().catch((err) => {
  console.error('\n失败：' + err.message);
  if (err.status === 403) console.error('  令牌无效或权限不足。');
  if (err.status === 404) console.error('  找不到资源，请确认令牌属于正确的账号。');
  process.exit(1);
});
