/**
 * 下载 cloudflared（Cloudflare Tunnel 客户端）。
 * 用 Node 的 HTTPS 栈，自动尝试多个镜像源。
 *
 *   node tools/get-cloudflared.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'build', 'cloudflared.exe');

const VERSIONS = ['2025.2.0', '2025.1.1', '2024.12.2'];
const MIRRORS = [
  (v) => 'https://registry.npmmirror.com/-/binary/cloudflared/' + v + '/cloudflared-windows-amd64.exe',
  (v) => 'https://github.com/cloudflare/cloudflared/releases/download/' + v + '/cloudflared-windows-amd64.exe',
  (v) => 'https://ghproxy.net/https://github.com/cloudflare/cloudflared/releases/download/' + v + '/cloudflared-windows-amd64.exe',
  (v) => 'https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/download/' + v + '/cloudflared-windows-amd64.exe',
  (v) => 'https://hub.gitmirror.com/https://github.com/cloudflare/cloudflared/releases/download/' + v + '/cloudflared-windows-amd64.exe',
];

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('重定向过多'));
    const req = https.get(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 45000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        return download(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      let last = -20;
      const file = fs.createWriteStream(dest);
      res.on('data', (c) => {
        got += c.length;
        if (total) {
          const pct = Math.floor((got / total) * 100);
          if (pct >= last + 20) { last = pct; process.stdout.write('    ' + pct + '%\r'); }
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(got)));
      file.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('超时')));
    req.on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  for (const v of VERSIONS) {
    for (const mk of MIRRORS) {
      const url = mk(v);
      const host = url.split('/')[2];
      process.stdout.write('尝试 ' + v + ' @ ' + host + '\n');
      try {
        const size = await download(url, OUT);
        if (size < 10 * 1024 * 1024) throw new Error('文件过小 (' + size + ' 字节)，可能不是可执行文件');
        console.log('成功：' + OUT + '  (' + (size / 1024 / 1024).toFixed(1) + ' MB)');
        return;
      } catch (err) {
        console.log('   失败：' + err.message);
        if (fs.existsSync(OUT)) fs.rmSync(OUT);
      }
    }
  }
  console.error('\n所有源都失败了。可以手动下载：');
  console.error('  https://github.com/cloudflare/cloudflared/releases/latest');
  console.error('  把 cloudflared-windows-amd64.exe 放到 build\\cloudflared.exe');
  process.exit(1);
})();
