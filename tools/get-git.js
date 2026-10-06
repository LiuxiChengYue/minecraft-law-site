/**
 * 下载 Git for Windows 安装包（用 Node 的 HTTPS 栈，避免 PowerShell/curl 的 TLS 问题）。
 *
 *   node tools/get-git.js            # 下载到 build/
 *   node tools/get-git.js --install  # 下载并静默安装
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const OUT_DIR = path.join(__dirname, '..', 'build');
const TARGET = path.join(OUT_DIR, 'git-installer.exe');

// 官方发布源（GitHub Releases），assorted 备用镜像
const SOURCES = [
  'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe',
  'https://mirrors.tuna.tsinghua.edu.cn/github-release/git-for-windows/git/LatestRelease/Git-2.47.1-64-bit.exe',
  'https://registry.npmmirror.com/-/binary/git-for-windows/v2.47.1.windows.1/Git-2.47.1-64-bit.exe',
];

function fetch(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('too many redirects'));
    const req = https.get(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 30000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        return fetch(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      let lastPct = -10;
      const file = fs.createWriteStream(dest);
      res.on('data', (c) => {
        got += c.length;
        if (total) {
          const pct = Math.floor((got / total) * 100);
          if (pct >= lastPct + 10) { lastPct = pct; process.stdout.write('  下载中 ' + pct + '%\r'); }
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        process.stdout.write('  下载完成 ' + (got / 1024 / 1024).toFixed(1) + ' MB\n');
        resolve(dest);
      }));
      file.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let ok = false;
  for (const url of SOURCES) {
    process.stdout.write('尝试: ' + url.split('/')[2] + '\n');
    try {
      await fetch(url, TARGET);
      const size = fs.statSync(TARGET).size;
      if (size < 20 * 1024 * 1024) throw new Error('文件太小，可能不是安装包 (' + size + ' 字节)');
      ok = true;
      console.log('已保存: ' + TARGET + '  (' + (size / 1024 / 1024).toFixed(1) + ' MB)');
      break;
    } catch (err) {
      console.log('  失败: ' + err.message);
      if (fs.existsSync(TARGET)) fs.rmSync(TARGET);
    }
  }
  if (!ok) {
    console.error('\n所有下载源都失败了。请手动下载 Git for Windows 安装包：');
    console.error('  https://git-scm.com/download/win');
    process.exit(1);
  }

  if (process.argv.includes('--install')) {
    console.log('\n开始静默安装（可能需要 1-2 分钟）…');
    // /VERYSILENT 静默，/NORESTART 不重启，其余保持默认（含 PATH 配置）
    const r = spawnSync(TARGET, [
      '/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/CLOSEAPPLICATIONS',
      '/RESTARTAPPLICATIONS', '/COMPONENTS=gitlfs,assoc,assoc_sh,windowsterminal',
    ], { stdio: 'inherit', windowsVerbatimArguments: false });
    console.log('安装器退出码: ' + r.status);
    if (r.error) console.error('启动失败: ' + r.error.message);
  } else {
    console.log('\n加 --install 参数可自动静默安装。');
  }
})().catch((err) => {
  console.error('出错: ' + err.message);
  process.exit(1);
});
