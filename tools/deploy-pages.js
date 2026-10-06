/**
 * 把静态站发布到 GitHub Pages —— 不需要额外账号、不需要 OAuth。
 *
 * 做法：把产物作为孤儿提交推到 gh-pages 分支，并开启 Pages（build_type=legacy，
 * 即直接从分支提供文件，不需要 GitHub Actions）。
 *
 *   node tools/deploy-pages.js --token <github_token> [--repo owner/name] [--dir pages-dist]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

function findGit() {
  const cands = [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe'),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return 'git';
}

function git(args, opts) {
  const g = findGit();
  return execFileSync(g, args, { cwd: (opts && opts.cwd) || ROOT, encoding: 'utf8', stdio: 'pipe' });
}

async function api(method, url, body) {
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
    const err = new Error('GitHub API ' + res.status + ': ' +
      ((json && json.message) || text.slice(0, 200)));
    err.status = res.status;
    throw err;
  }
  return json;
}

(async () => {
  if (!TOKEN) {
    console.error('缺少令牌。用法： node tools/deploy-pages.js --token <github_token>');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(DIR, 'index.html'))) {
    console.error('找不到产物目录：' + DIR);
    console.error('请先执行： node server/bundle-pages.js --out pages-dist');
    process.exit(1);
  }

  const files = [];
  (function walk(d, p) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const rel = p ? p + '/' + e.name : e.name;
      if (e.isDirectory()) walk(abs, rel);
      else files.push({ rel, size: fs.statSync(abs).size });
    }
  })(DIR, '');
  console.log('\n将发布 ' + files.length + ' 个文件到 ' + REPO + ' 的 ' + BRANCH + ' 分支：');
  for (const f of files) console.log('  ' + f.rel.padEnd(24) + (f.size / 1024).toFixed(1) + ' KB');

  console.log('\n[1/4] 验证令牌…');
  const me = await api('GET', '/user');
  console.log('  账号：' + me.login);
  const [owner, name] = REPO.split('/');
  if (me.login !== owner) throw new Error('令牌账号 (' + me.login + ') 与仓库所有者 (' + owner + ') 不一致');

  console.log('[2/4] 在独立目录提交 gh-pages…');
  const work = path.join(ROOT, 'build', 'pages-repo');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  (function copy(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const s = path.join(from, e.name), d = path.join(to, e.name);
      if (e.isDirectory()) copy(s, d); else fs.copyFileSync(s, d);
    }
  })(DIR, work);

  git(['init', '-q'], { cwd: work });
  git(['config', 'user.name', me.login], { cwd: work });
  git(['config', 'user.email', me.login + '@users.noreply.github.com'], { cwd: work });
  git(['config', 'core.autocrlf', 'false'], { cwd: work });
  git(['add', '-A'], { cwd: work });
  git(['commit', '-q', '-m', '部署《我的世界》世界基本法典官方网站到 GitHub Pages'], { cwd: work });
  git(['branch', '-M', BRANCH], { cwd: work });
  git(['remote', 'add', 'origin',
    'https://' + owner + ':' + TOKEN + '@github.com/' + REPO + '.git'], { cwd: work });

  console.log('[3/4] 推送…');
  git(['push', '-f', 'origin', BRANCH], { cwd: work });
  console.log('  已推送 ' + BRANCH + ' 分支');

  console.log('[4/4] 开启 GitHub Pages…');
  let pagesInfo = null;
  try {
    pagesInfo = await api('POST', '/repos/' + REPO + '/pages', {
      source: { branch: BRANCH, path: '/' },
      build_type: 'legacy',
    });
  } catch (err) {
    if (err.status === 409) {
      pagesInfo = await api('PUT', '/repos/' + REPO + '/pages', {
        source: { branch: BRANCH, path: '/' },
        build_type: 'legacy',
      });
    } else if (err.status === 403) {
      console.log('  ! 令牌缺少 Pages 权限，但分支已推送。');
      console.log('    请手动开启： 仓库 → Settings → Pages → Source 选 gh-pages 分支');
    } else {
      throw err;
    }
  }
  if (pagesInfo) console.log('  Pages 已配置：' + (pagesInfo.html_url || ''));

  const url = 'https://' + owner.toLowerCase() + '.github.io/' + name + '/';
  console.log('\n发布完成，正在等待站点生效（通常 30~90 秒）…');
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) {
        const html = await res.text();
        if (html.indexOf('世界基本法典') !== -1) {
          console.log('\n站点已经可以访问！');
          console.log('  地址： ' + url);
          console.log('  说明： 问答由浏览器内置引擎完成，无需任何后端。\n');
          return;
        }
      }
    } catch (e) { /* 还没生效 */ }
    process.stdout.write('  等待中… (' + ((i + 1) * 5) + 's)\r');
  }
  console.log('\n分支已推送，但站点还没生效（GitHub 有时需要几分钟）。');
  console.log('  地址： ' + url + '（稍后再试）\n');
})().catch((err) => {
  console.error('\n失败：' + err.message);
  if (err.status === 401) console.error('  令牌无效或已过期。');
  if (err.status === 403) console.error('  令牌权限不足（需要 repo 权限）。');
  process.exit(1);
});
