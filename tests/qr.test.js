/**
 * QR 编码自检：矩阵结构 + 用独立实现的解码器把二维码读回来。
 *
 *   node tests/qr.test.js
 */
'use strict';

const path = require('path');
const QR = require(path.join(__dirname, '..', 'public', 'assets', 'qr.js'));

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

/* ── 独立解码器：读回矩阵，验证编码正确（不共用编码逻辑） ── */
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  11: [6, 30, 54], 12: [6, 32, 58]
};

function decode(m) {
  const size = m.size;
  const get = (r, c) => m.modules[r][c];
  const reserved = m.reserved;

  // read format info (both copies) and unmask
  let mask = -1;
  for (let cand = 0; cand < 8; cand++) {
    const data = (0 << 3) | cand;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    let ok = true;
    const bit = (i) => (bits >>> i) & 1;
    for (let k = 0; k <= 5 && ok; k++) if (get(8, k) !== bit(k)) ok = false;
    if (ok && get(8, 7) !== bit(6)) ok = false;
    if (ok && get(8, 8) !== bit(7)) ok = false;
    if (ok && get(7, 8) !== bit(8)) ok = false;
    for (let k = 9; k <= 14 && ok; k++) if (get(14 - k, 8) !== bit(k)) ok = false;
    if (ok) { mask = cand; break; }
  }
  if (mask < 0) throw new Error('format info not readable');

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];
  const unmask = (r, c, v) => (MASKS[mask](r, c) ? v ^ 1 : v);

  // rebuild the reserved map the same way the standard defines it
  const res = [];
  for (let i = 0; i < size; i++) res.push(new Array(size).fill(false));
  const markFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        res[rr][cc] = true;
      }
    }
  };
  markFinder(0, 0); markFinder(0, size - 7); markFinder(size - 7, 0);
  const version = (size - 17) / 4;
  const pos = ALIGN[version] || [];
  pos.forEach((row) => pos.forEach((col) => {
    if ((row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8)) return;
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) res[row + r][col + c] = true;
  }));
  for (let i = 8; i < size - 8; i++) { res[6][i] = true; res[i][6] = true; }
  for (let i = 0; i < 9; i++) { res[8][i] = true; res[i][8] = true; }
  for (let j = 0; j < 8; j++) { res[8][size - 1 - j] = true; res[size - 1 - j][8] = true; }
  res[size - 8][8] = true;

  // zig-zag read
  const bits = [];
  let colIndex = 0;
  for (let col = size - 1; col > 0; col -= 2, colIndex++) {
    if (col === 6) col--;
    const up = colIndex % 2 === 0;
    for (let step = 0; step < size; step++) {
      const row = up ? size - 1 - step : step;
      for (let s = 0; s < 2; s++) {
        const cc = col - s;
        if (res[row][cc]) continue;
        bits.push(unmask(row, cc, get(row, cc)));
      }
    }
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
    bytes.push(v);
  }

  // de-interleave
  const VERSIONS = {
    1: { ec: 10, groups: [[1, 16]] }, 2: { ec: 16, groups: [[1, 28]] },
    3: { ec: 26, groups: [[1, 44]] }, 4: { ec: 18, groups: [[2, 32]] },
    5: { ec: 24, groups: [[2, 43]] }, 6: { ec: 16, groups: [[4, 27]] },
    7: { ec: 18, groups: [[4, 31]] }, 8: { ec: 22, groups: [[2, 38], [2, 39]] },
    9: { ec: 22, groups: [[3, 36], [2, 37]] }, 10: { ec: 26, groups: [[4, 43], [1, 44]] },
    11: { ec: 30, groups: [[1, 50], [4, 51]] }, 12: { ec: 22, groups: [[6, 36], [2, 37]] }
  };
  const spec = VERSIONS[version];
  const blockLens = [];
  spec.groups.forEach((g) => { for (let n = 0; n < g[0]; n++) blockLens.push(g[1]); });
  const maxLen = Math.max.apply(null, blockLens);
  const blocks = blockLens.map(() => []);
  let p = 0;
  for (let i = 0; i < maxLen; i++) {
    for (let b = 0; b < blocks.length; b++) {
      if (i < blockLens[b]) blocks[b].push(bytes[p++]);
    }
  }
  const data = [];
  blocks.forEach((b) => b.forEach((v) => data.push(v)));

  // parse the bit stream
  const stream = [];
  data.forEach((v) => { for (let k = 7; k >= 0; k--) stream.push((v >>> k) & 1); });
  let idx = 0;
  const take = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | stream[idx++]; return v; };
  const mode = take(4);
  const lenBits = version <= 9 ? 8 : 16;
  const len = take(lenBits);
  const out = [];
  for (let i = 0; i < len; i++) out.push(take(8));
  return { mode, text: Buffer.from(out).toString('utf8'), version, mask };
}

console.log('\n[1] 矩阵结构');
const cases = [
  'http://192.168.0.175:8787/',
  'http://127.0.0.1:8787/',
  'http://10.0.0.23:8787/',
  'https://law.example.com/',
];
for (const text of cases) {
  const m = QR.matrix(text);
  check('可为 ' + text + ' 生成矩阵（版本 ' + (m ? (m.size - 17) / 4 : '?') + '）', !!m);
  if (!m) continue;
  check('  尺寸符合规范（4v+17）', (m.size - 17) % 4 === 0 && m.size >= 21);
  const on = (r, c) => m.modules[r][c] === 1;
  // 定位图案：7×7 黑框 + 3×3 黑心，中间一圈白
  check('  左上定位图案正确', on(0, 0) && on(0, 1) && on(1, 0) && on(6, 6) &&
    on(2, 2) && on(3, 3) && on(4, 4) && !on(1, 1) && !on(1, 5) && !on(5, 1));
  check('  右上/左下定位图案存在', on(0, m.size - 7) && on(m.size - 7, 0));
  check('  时序图案交替', on(6, 8) && !on(6, 9) && on(6, 10) && !on(6, 11));
  const dark = on(m.size - 8, 8);
  check('  固定暗模块为 1', dark);
  check('  白边留白由 SVG 处理', QR.svg(text, 100).indexOf('viewBox="0 0 ' + (m.size + 4)) !== -1);
}

console.log('\n[2] 编码可被独立解码器读回');
for (const text of cases) {
  const m = QR.matrix(text);
  let got = null, err = null;
  try { got = decode(m); } catch (e) { err = e.message; }
  check('解码 ' + text, got && got.text === text,
    err || (got ? 'got "' + got.text + '" mode=' + got.mode : 'null'));
}

console.log('\n[3] SVG 输出');
const svg = QR.svg('http://192.168.0.175:8787/', 148);
check('生成 SVG', svg.indexOf('<svg') === 0 && svg.indexOf('</svg>') > 0);
check('SVG 含尺寸属性', svg.indexOf('width="148"') !== -1);
check('SVG 路径非空', (svg.match(/M\d+ \d+h1v1h-1z/g) || []).length > 50);
check('超长文本返回空', QR.svg(new Array(4000).join('x'), 100) === '');

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
