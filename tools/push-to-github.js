/**
 * 用 GitHub API 直接把项目发布到 GitHub —— 不需要安装 Git。
 *
 *   node tools/push-to-github.js                    # 检查环境、列出将要上传的文件
 *   node tools/push-to-github.js --token ghp_xxx    # 创建仓库并上传
 *   node tools/push-to-github.js --token ghp_xxx --repo my-law-site --private
 *
 * 令牌权限只需要 Contents: Read and write + Administration: Read and write。
 * 用完可以在 GitHub 上随时撤销，不会保存在任何文件里。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = 'https://api.github.com';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const TOKEN = argOf('--token', process.env.GITHUB_TOKEN || '');
const REPO = argOf('--repo', 'minecraft-law-site');
const PRIVATE = argv.includes('--private');
const DESC = '《我的世界》世界基本法典 G2.8 官方网站：全文条款、检索与 AI 法务问答';

/* 不上传的东西：构建产物、中间文件、依赖、以及安装包 */
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'build', 'dist', '.vscode', '.idea']);
const EXCLUDE_FILES = new Set(['.DS_Store', 'Thumbs.db']);
const MAX_FILE = 25 * 1024 * 1024;   // GitHub API 单文件上限

function collect(dir, prefix, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      collect(path.join(dir, entry.name), prefix + entry.name + '/', out);
    } else {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      if (/\.(log|tsv)$/.test(entry.name)) continue;
      if (/^git-installer\.exe$/i.test(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const stat = fs.statSync(abs);
      if (stat.size > MAX_FILE) { out.skipped.push(prefix + entry.name); continue; }
      out.files.push({ path: prefix + entry.name, abs, size: stat.size });
    }
  }
  return out;
}

async function api(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: {
      authorization: 'Bearer ' + TOKEN,
      accept: 'application/vnd.github+json',
      'user-agent': 'law-site-publisher',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const msg = (json && (json.message || json.raw)) || res.statusText;
    const err = new Error('GitHub API ' + res.status + ': ' + msg);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

(async () => {
  const tree = collect(ROOT, '', { files: [], skipped: [] });
  const totalBytes = tree.files.reduce((s, f) => s + f.size, 0);

  console.log('\n将要上传 ' + tree.files.length + ' 个文件，共 ' +
    (totalBytes / 1024).toFixed(0) + ' KB：');
  for (const f of tree.files) {
    console.log('  ' + f.path.padEnd(34) + (f.size / 1024).toFixed(1) + ' KB');
  }
  if (tree.skipped.length) {
    console.log('\n跳过（超过 25MB 上限）：' + tree.skipped.join(', '));
  }

  if (!TOKEN) {
    console.log('\n[未提供令牌] 只做了预演。正式上传请加 --token <你的令牌>');
    console.log('\n获取令牌（约 1 分钟）：');
    console.log('  1. 打开 https://github.com/settings/tokens?type=beta');
    console.log('  2. Generate new token → 名字随便填，有效期选 30 天');
    console.log('  3. Repository access 选 All repositories');
    console.log('  4. Permissions 里把 Contents 和 Administration 设为 Read and write');
    console.log('  5. Generate token → 复制 gh 开头的那串，然后执行：');
    console.log('     node tools/push-to-github.js --token 你的令牌\n');
    return;
  }

  console.log('\n[1/4] 验证令牌…');
  const me = await api('GET', '/user');
  console.log('  已登录：' + me.login + (me.name ? ' (' + me.name + ')' : ''));

  console.log('[2/4] 准备仓库 ' + me.login + '/' + REPO + ' …');
  let repo = null;
  try {
    repo = await api('GET', '/repos/' + me.login + '/' + REPO);
    console.log('  仓库已存在，将更新其中的文件');
  } catch (err) {
    if (err.status !== 404) throw err;
    repo = await api('POST', '/user/repos', {
      name: REPO,
      description: DESC,
      private: PRIVATE,
      auto_init: false,
      has_issues: true,
    });
    console.log('  已创建：' + repo.html_url);
  }

  console.log('[3/4] 创建文件树（' + tree.files.length + ' 个文件）…');
  const blobs = [];
  for (const f of tree.files) {
    const content = fs.readFileSync(f.abs);
    const isBinary = /\.(png|jpg|jpeg|gif|ico|woff2?|exe|zip)$/i.test(f.path);
    const blob = await api('POST', '/repos/' + me.login + '/' + REPO + '/git/blobs', {
      content: content.toString(isBinary ? 'base64' : 'utf8'),
      encoding: isBinary ? 'base64' : 'utf8',
    });
    blobs.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    process.stdout.write('  已上传 ' + blobs.length + '/' + tree.files.length + '\r');
  }
  console.log('  已上传 ' + blobs.length + ' 个文件            ');

  const newTree = await api('POST', '/repos/' + me.login + '/' + REPO + '/git/trees', {
    tree: blobs,
  });

  console.log('[4/4] 提交…');
  let parentSha = null;
  let baseTree = null;
  try {
    const ref = await api('GET', '/repos/' + me.login + '/' + REPO + '/git/ref/heads/main');
    parentSha = ref.object.sha;
    const commit = await api('GET', '/repos/' + me.login + '/' + REPO + '/git/commits/' + parentSha);
    baseTree = commit.tree.sha;
  } catch (err) { /* 空仓库，没有 main 分支 */ }

  const fullTree = baseTree
    ? await api('POST', '/repos/' + me.login + '/' + REPO + '/git/trees', {
      base_tree: baseTree, tree: blobs,
    })
    : newTree;

  const commitBody = {
    message: parentSha
      ? '更新《我的世界》世界基本法典官方网站'
      : '《我的世界》世界基本法典 G2.8 官方网站：全文、检索与 AI 法务问答',
    tree: fullTree.sha,
    parents: parentSha ? [parentSha] : [],
  };
  const newCommit = await api('POST', '/repos/' + me.login + '/' + REPO + '/git/commits', commitBody);

  if (parentSha) {
    await api('PATCH', '/repos/' + me.login + '/' + REPO + '/git/refs/heads/main', {
      sha: newCommit.sha, force: false,
    });
  } else {
    await api('POST', '/repos/' + me.login + '/' + REPO + '/git/refs', {
      ref: 'refs/heads/main', sha: newCommit.sha,
    });
  }

  console.log('\n发布成功！');
  console.log('  仓库地址：https://github.com/' + me.login + '/' + REPO);
  console.log('\n下一步 —— 部署到 Render 拿到公网地址：');
  console.log('  1. 打开 https://dashboard.render.com ，用 GitHub 登录');
  console.log('  2. New → Blueprint → 选中 ' + REPO + ' → Connect');
  console.log('  3. Render 会读到项目里的 render.yaml，点 Apply');
  console.log('  4. 等 1~2 分钟，得到 https://' + REPO + '.onrender.com');
  console.log('\n以后更新：改完文件重新跑一次本脚本即可（会自动提交为新版本）。');
  console.log('安全提醒：令牌用完可以去 https://github.com/settings/tokens 撤销。\n');
})().catch((err) => {
  console.error('\n失败：' + err.message);
  if (err.status === 401) console.error('  令牌无效或已过期，请重新生成。');
  if (err.status === 403) console.error('  令牌权限不足，请确认 Contents 与 Administration 都是 Read and write。');
  if (err.status === 404) console.error('  找不到资源，请确认令牌有 repo 权限。');
  process.exit(1);
});
