/**
 * 局域网地址探测与容器网段过滤的自检。
 *
 *   node tests/access.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

let loadSeq = 0;

/** 用假的网卡列表加载一份全新的 index.js，验证 accessUrls() 的过滤逻辑。 */
function loadWithInterfaces(fake) {
  const real = os.networkInterfaces;
  os.networkInterfaces = () => fake;
  const target = path.join(ROOT, 'server', 'index.js');
  const prevPort = process.env.PORT;
  const prevHost = process.env.HOST;
  process.env.PORT = '8787';
  process.env.HOST = '127.0.0.1';
  let mod;
  let urls;
  try {
    // 每次把源码编译成独立模块，避免 require 缓存复用上一轮的实例
    const src = fs.readFileSync(target, 'utf8');
    const m = new Module(target, null);
    m.filename = target;
    m.paths = Module._nodeModulePaths(path.dirname(target));
    m._compile(src, target + '#case' + (++loadSeq));
    mod = m.exports;
    // 必须在恢复真实网卡列表之前取值：lanAddresses() 是惰性调用的
    urls = mod.accessUrls();
  } finally {
    os.networkInterfaces = real;
    if (prevPort === undefined) delete process.env.PORT; else process.env.PORT = prevPort;
    if (prevHost === undefined) delete process.env.HOST; else process.env.HOST = prevHost;
  }
  mod.server.close();
  return urls;
}

console.log('\n[1] 本机场景：只保留真实局域网地址');
let urls = loadWithInterfaces({
  'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  'vEthernet (WSL)': [{ family: 'IPv4', address: '172.24.96.1', internal: false }],
  'WLAN': [{ family: 'IPv4', address: '192.168.0.175', internal: false },
           { family: 'IPv6', address: 'fe80::1', internal: false }],
  'Ethernet': [{ family: 'IPv4', address: '169.254.10.20', internal: false }],
});
check('包含本机地址', urls.some((u) => !u.lan && u.url === 'http://127.0.0.1:8787'));
check('包含真实局域网地址', urls.some((u) => u.lan && u.url === 'http://192.168.0.175:8787'),
  JSON.stringify(urls));
check('过滤掉 WSL 虚拟网卡 (172.24.x)', !urls.some((u) => u.url.indexOf('172.24') !== -1));
check('过滤掉 APIPA (169.254.x)', !urls.some((u) => u.url.indexOf('169.254') !== -1));
check('忽略 IPv6 链路本地', !urls.some((u) => u.url.indexOf('fe80') !== -1));
check('客户端应该只在有真实局域网地址时才显示二维码',
  urls.filter((u) => u.lan).length === 1);

console.log('\n[2] 容器/云部署场景：不应暴露内网地址');
urls = loadWithInterfaces({
  'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  'eth0': [{ family: 'IPv4', address: '172.17.0.2', internal: false }],
});
check('Docker 默认网段被过滤', !urls.some((u) => u.lan), JSON.stringify(urls));
check('仍保留本机地址', urls.some((u) => !u.lan));

urls = loadWithInterfaces({
  'eth0': [{ family: 'IPv4', address: '10.0.3.17', internal: false }],
  'docker0': [{ family: 'IPv4', address: '172.18.0.1', internal: false }],
});
check('云主机内网 (10.x) 被过滤', !urls.some((u) => u.lan), JSON.stringify(urls));

urls = loadWithInterfaces({
  'wlan0': [{ family: 'IPv4', address: '100.96.3.5', internal: false }],
});
check('CGNAT 网段 (100.64/10) 被过滤', !urls.some((u) => u.lan), JSON.stringify(urls));

console.log('\n[3] 前端行为：没有局域网地址时不显示二维码');
const app = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'app.js'), 'utf8');
check('无 lan 地址时隐藏二维码容器', /qrBox\.hidden = true/.test(app));
check('公网部署时提示"直接用当前网址"', /已部署在公网/.test(app));
check('局域网场景渲染二维码', /DSH_QR\.svg\(lan\.url/.test(app));

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
