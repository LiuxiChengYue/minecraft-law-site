/**
 * 用 GitHub API 把静态产物发布到 gh-pages 分支（不依赖 git 推送，
 * 因为 github.com:443 在某些网络下时通时不通，而 api.github.com 稳定）。
 *
 *   node tools/deploy-pages-api.js --token <token> [--repo owner/name] [--dir pages-dist]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const TOKEN = argOf('--token', process.env.GITHUB_TOKEN || '');
const REPO = argOf('--repo', 'LiuxiChengYue/minecraft-law-site');
const DIR = path.resolve(ROOT, argOf('--dir', 'pages-dist'));
const BRANCH = 'gh-pages';
const API = 'https://api.github.com';

async function api(method, url, body, attempt = 0) {
  try {
    const res = await fetch(url.startsWith('http') ? url : API + url, {
      method,
      headers: {
        authorization: 'Bearer ' + TOKEN,
        accept: 'application/vnd.github+json',
        'user-agent': 'law-site-pages',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
    if (!res.ok) {
      // 网络抖动时重试（这个网络环境对 GitHub 不太稳定）
      if (res.status >= 500 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        return api(method, url, body, attempt + 1);
      }
      const err = new Error('GitHub API ' + res.status + ': ' + ((json && json.message) || text.slice(0, 200)));
      err.status = res.status;
      throw err;
    }
    return json;
  } catch (err) {
    if (!err.status && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      return api(method, url, body, attempt + 1);
    }
    throw err;
  }
}

(async () => {
  if (!TOKEN) {
    console.error('缺少令牌： node tools/deploy-pages-api.js --token <token>');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(DIR, 'index.html'))) {
    console.error('找不到产物：' + DIR + '（先跑 node server/bundle-pages.js --out pages-dist）');
    process.exit(1);
  }

  const files = [];
  (function walk(d, p) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const rel = p ? p + '/' + e.name : e.name;
      if (e.isDirectory()) walk(abs, rel); else files.push({ rel, abs });
    }
  })(DIR, '');

  console.log('\n[1/5] 验证令牌与仓库…');
  const me = await api('GET', '/user');
  const repo = await api('GET', '/repos/' + REPO);
  console.log('  账号 ' + me.login + ' · 仓库 ' + repo.full_name);
  console.log('  将发布 ' + files.length + ' 个文件到 ' + BRANCH + ' 分支');

  console.log('[2/5] 上传文件内容…');
  const blobs = [];
  let done = 0;
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    const isText = /\.(html|css|js|mjs|json|svg|txt|toml|yml|yaml|md|nojekyll)$/i.test(f.rel) ||
      f.rel === '.nojekyll';
    const blob = await api('POST', '/repos/' + REPO + '/git/blobs', {
      content: buf.toString(isText ? 'utf8' : 'base64'),
      encoding: isText ? 'utf8' : 'base64',
    });
    blobs.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
    done++;
    process.stdout.write('  ' + done + '/' + files.length + '  ' + f.rel + '            \r');
  }
  console.log('  已上传 ' + blobs.length + ' 个文件                        ');

  console.log('[3/5] 创建文件树…');
  const tree = await api('POST', '/repos/' + REPO + '/git/trees', { tree: blobs });

  console.log('[4/5] 创建提交…');
  let parentSha = null;
  try {
    const ref = await api('GET', '/repos/' + REPO + '/git/ref/heads/' + BRANCH);
    parentSha = ref.object.sha;
  } catch (e) { /* 分支还不存在 */ }
  const commit = await api('POST', '/repos/' + REPO + '/git/commits', {
    message: '部署《我的世界》世界基本法典官方网站（静态站 + 浏览器内置问答引擎）',
    tree: tree.sha,
    parents: parentSha ? [parentSha] : [],
  });

  console.log('[5/5] 更新分支引用…');
  if (parentSha) {
    await api('PATCH', '/repos/' + REPO + '/git/refs/heads/' + BRANCH, { sha: commit.sha, force: true });
  } else {
    await api('POST', '/repos/' + REPO + '/git/refs', { ref: 'refs/heads/' + BRANCH, sha: commit.sha });
  }
  console.log('  ' + BRANCH + ' -> ' + commit.sha.slice(0, 7));

  console.log('\n开启 GitHub Pages…');
  try {
    await api('POST', '/repos/' + REPO + '/pages', {
      source: { branch: BRANCH, path: '/' },
      build_type: 'legacy',
    });
    console.log('  Pages 已开启');
  } catch (err) {
    if (err.status === 409) {
      try {
        await api('PUT', '/repos/' + REPO + '/pages', {
          source: { branch: BRANCH, path: '/' },
          build_type: 'legacy',
        });
        console.log('  Pages 配置已更新');
      } catch (e2) {
        console.log('  Pages 已存在，沿用原配置（' + e2.message + '）');
      }
    } else if (err.status === 403) {
      console.log('  ! 令牌缺少 Pages 权限。分支已推送，请手动开启：');
      console.log('    仓库 → Settings → Pages → Source 选 gh-pages / (root) → Save');
    } else {
      console.log('  ! 开启 Pages 返回：' + err.message);
    }
  }

  const [owner, name] = REPO.split('/');
  const url = 'https://' + owner.toLowerCase() + '.github.io/' + name + '/';
  console.log('\n站点地址：' + url);
  console.log('正在等待生效（首次通常 30~120 秒）…');
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) {
        const html = await res.text();
        if (html.indexOf('世界基本法典') !== -1) {
          console.log('\n站点已生效！可以直接把这个地址发给任何人：');
          console.log('  ' + url + '\n');
          process.exit(0);
        }
      }
    } catch (e) { /* 还没生效 */ }
    process.stdout.write('  等待中… ' + ((i + 1) * 5) + 's\r');
  }
  console.log('\n分支已发布，但站点还没生效。GitHub 有时需要几分钟，稍后重试该地址。\n');
})().catch((err) => {
  console.error('\n失败：' + err.message);
  if (err.status === 401) console.error('  令牌无效或过期。');
  if (err.status === 403) console.error('  令牌权限不足。');
  process.exit(1);
});
