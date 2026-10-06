/* ==========================================================================
   极简 QR 码生成器（字节模式，纠错等级 M，版本 1-10，自动选择掩码）
   仅用于把站点地址变成可扫码的 SVG，无任何外部依赖。
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DSH_QR = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- GF(256) ---- */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function mul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function genPoly(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= mul(poly[j], 1);
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function eccBytes(data, ecLen) {
    var gen = genPoly(ecLen);
    var res = new Uint8Array(data.length + ecLen);
    res.set(data);
    for (var i = 0; i < data.length; i++) {
      var coeff = res[i];
      if (!coeff) continue;
      for (var j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], coeff);
    }
    return Array.prototype.slice.call(res, data.length);
  }

  /* ---- 容量表（纠错等级 M）与分组结构 ---- */
  var VERSIONS = {
    1:  { ec: 10, groups: [[1, 16]] },
    2:  { ec: 16, groups: [[1, 28]] },
    3:  { ec: 26, groups: [[1, 44]] },
    4:  { ec: 18, groups: [[2, 32]] },
    5:  { ec: 24, groups: [[2, 43]] },
    6:  { ec: 16, groups: [[4, 27]] },
    7:  { ec: 18, groups: [[4, 31]] },
    8:  { ec: 22, groups: [[2, 38], [2, 39]] },
    9:  { ec: 22, groups: [[3, 36], [2, 37]] },
    10: { ec: 26, groups: [[4, 43], [1, 44]] },
    11: { ec: 30, groups: [[1, 50], [4, 51]] },
    12: { ec: 22, groups: [[6, 36], [2, 37]] }
  };

  function dataCapacity(v) {
    return VERSIONS[v].groups.reduce(function (s, g) { return s + g[0] * g[1]; }, 0);
  }

  function pickVersion(len) {
    for (var v = 1; v <= 12; v++) {
      // 4 bit mode + 8 bit length (v<=9) / 16 bit length (v>=10) + payload + terminator
      var lenBits = v <= 9 ? 8 : 16;
      var need = 4 + lenBits + len * 8;
      if (Math.ceil(need / 8) <= dataCapacity(v)) return v;
    }
    return 0;
  }

  /* ---- 位流 ---- */
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  /* ---- 矩阵构造 ---- */
  function Matrix(size) {
    this.size = size;
    this.modules = [];
    this.reserved = [];
    for (var i = 0; i < size; i++) {
      this.modules.push(new Array(size).fill(0));
      this.reserved.push(new Array(size).fill(false));
    }
  }
  Matrix.prototype.set = function (r, c, v) { this.modules[r][c] = v ? 1 : 0; };
  Matrix.prototype.get = function (r, c) { return this.modules[r][c]; };
  Matrix.prototype.reserve = function (r, c) { this.reserved[r][c] = true; };

  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
    11: [6, 30, 54], 12: [6, 32, 58]
  };

  function placeFinder(m, row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= m.size || cc >= m.size) continue;
        var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                 (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                 (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        m.set(rr, cc, on ? 1 : 0);
        m.reserve(rr, cc);
      }
    }
  }

  function placeAlignment(m, v) {
    var pos = ALIGN[v];
    for (var i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        var row = pos[i], col = pos[j];
        if ((row <= 8 && col <= 8) || (row <= 8 && col >= m.size - 9) ||
            (row >= m.size - 9 && col <= 8)) continue;
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            var on = Math.max(Math.abs(r), Math.abs(c)) !== 1;
            m.set(row + r, col + c, on ? 1 : 0);
            m.reserve(row + r, col + c);
          }
        }
      }
    }
  }

  function placeTiming(m) {
    for (var i = 8; i < m.size - 8; i++) {
      var v = i % 2 === 0 ? 1 : 0;
      m.set(6, i, v); m.reserve(6, i);
      m.set(i, 6, v); m.reserve(i, 6);
    }
  }

  function reserveFormat(m) {
    for (var i = 0; i < 9; i++) {
      m.reserve(8, i); m.reserve(i, 8);
    }
    for (var j = 0; j < 8; j++) {
      m.reserve(8, m.size - 1 - j);
      m.reserve(m.size - 1 - j, 8);
    }
    m.set(m.size - 8, 8, 1); m.reserve(m.size - 8, 8);   // dark module
  }

  function placeFormat(m, mask) {
    // 纠错等级 M = 0b00
    var data = (0 << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;

    function bit(i) { return (bits >>> i) & 1; }
    for (var k = 0; k <= 5; k++) m.set(8, k, bit(k));
    m.set(8, 7, bit(6));
    m.set(8, 8, bit(7));
    m.set(7, 8, bit(8));
    for (var k2 = 9; k2 <= 14; k2++) m.set(14 - k2, 8, bit(k2));

    for (var k3 = 0; k3 <= 7; k3++) m.set(m.size - 1 - k3, 8, bit(k3));
    for (var k4 = 8; k4 <= 14; k4++) m.set(8, m.size - 15 + k4, bit(k4));

    m.set(m.size - 8, 8, 1);            // 固定暗模块
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  function penalty(m) {
    var size = m.size, score = 0, r, c, i;
    // rule 1: runs of five or more
    for (r = 0; r < size; r++) {
      var run = 1;
      for (c = 1; c < size; c++) {
        if (m.get(r, c) === m.get(r, c - 1)) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
    for (c = 0; c < size; c++) {
      var run2 = 1;
      for (r = 1; r < size; r++) {
        if (m.get(r, c) === m.get(r - 1, c)) run2++;
        else { if (run2 >= 5) score += run2 - 2; run2 = 1; }
      }
      if (run2 >= 5) score += run2 - 2;
    }
    // rule 2: 2x2 blocks
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m.get(r, c);
        if (v === m.get(r, c + 1) && v === m.get(r + 1, c) && v === m.get(r + 1, c + 1)) score += 3;
      }
    }
    // rule 4: balance
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) dark += m.get(r, c);
    var ratio = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return score;
  }

  /** Build the module matrix for a UTF-8 string. Returns null when too long. */
  function matrix(text) {
    var bytes = utf8(String(text));
    var version = pickVersion(bytes.length);
    if (!version) return null;
    var spec = VERSIONS[version];

    var buf = new BitBuffer();
    buf.put(4, 4);                                   // byte mode
    buf.put(bytes.length, version <= 9 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);
    var capacityBits = dataCapacity(version) * 8;
    var term = Math.min(4, capacityBits - buf.bits.length);
    buf.put(0, term);
    while (buf.bits.length % 8 !== 0) buf.bits.push(0);
    var pad = [0xec, 0x11], p = 0;
    while (buf.bits.length < capacityBits) buf.put(pad[p++ % 2], 8);

    // codewords
    var cw = [];
    for (var b = 0; b < buf.bits.length; b += 8) {
      var byteVal = 0;
      for (var k = 0; k < 8; k++) byteVal = (byteVal << 1) | buf.bits[b + k];
      cw.push(byteVal);
    }

    // split into blocks, interleave data then ecc
    var blocks = [], ecBlocks = [], offset = 0;
    spec.groups.forEach(function (g) {
      for (var n = 0; n < g[0]; n++) {
        var d = cw.slice(offset, offset + g[1]);
        offset += g[1];
        blocks.push(d);
        ecBlocks.push(eccBytes(d, spec.ec));
      }
    });
    var maxData = Math.max.apply(null, blocks.map(function (b2) { return b2.length; }));
    var final = [];
    for (var c2 = 0; c2 < maxData; c2++) {
      blocks.forEach(function (b3) { if (c2 < b3.length) final.push(b3[c2]); });
    }
    for (var c3 = 0; c3 < spec.ec; c3++) {
      ecBlocks.forEach(function (b4) { if (c3 < b4.length) final.push(b4[c3]); });
    }

    var size = version * 4 + 17;
    var base = new Matrix(size);
    placeFinder(base, 0, 0);
    placeFinder(base, 0, size - 7);
    placeFinder(base, size - 7, 0);
    placeAlignment(base, version);
    placeTiming(base);
    reserveFormat(base);

    // data placement: two-module columns from the right, zig-zagging upward and
    // downward, skipping the vertical timing column (col 6) and reserved areas
    var bitIndex = 0;
    var totalBits = final.length * 8;
    var colIndex = 0;
    for (var col = size - 1; col > 0; col -= 2, colIndex++) {
      if (col === 6) col--;
      var up = colIndex % 2 === 0;
      for (var step = 0; step < size; step++) {
        var row = up ? size - 1 - step : step;
        for (var s = 0; s < 2; s++) {
          var cc = col - s;
          if (base.reserved[row][cc]) continue;
          var bv = 0;
          if (bitIndex < totalBits) bv = (final[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1;
          base.set(row, cc, bv);
          bitIndex++;
        }
      }
    }

    // choose the best mask
    var best = null, bestScore = Infinity;
    for (var maskId = 0; maskId < 8; maskId++) {
      var cand = new Matrix(size);
      for (var r3 = 0; r3 < size; r3++) {
        for (var c4 = 0; c4 < size; c4++) {
          cand.modules[r3][c4] = base.modules[r3][c4];
          cand.reserved[r3][c4] = base.reserved[r3][c4];
        }
      }
      for (var r4 = 0; r4 < size; r4++) {
        for (var c5 = 0; c5 < size; c5++) {
          if (cand.reserved[r4][c5]) continue;
          if (MASKS[maskId](r4, c5)) cand.modules[r4][c5] ^= 1;
        }
      }
      placeFormat(cand, maskId);
      var sc = penalty(cand);
      if (sc < bestScore) { bestScore = sc; best = cand; }
    }
    return best;
  }

  /** SVG markup for a QR code. */
  function svg(text, sizePx, opts) {
    opts = opts || {};
    var m = matrix(text);
    if (!m) return '';
    var quiet = opts.quiet == null ? 2 : opts.quiet;
    var total = m.size + quiet * 2;
    var dark = opts.dark || '#14171a';
    var light = opts.light || '#ffffff';
    var path = [];
    for (var r = 0; r < m.size; r++) {
      for (var c = 0; c < m.size; c++) {
        if (m.get(r, c)) path.push('M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z');
      }
    }
    var px = sizePx || 132;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total +
      '" width="' + px + '" height="' + px + '" shape-rendering="crispEdges" role="img" ' +
      'aria-label="站点地址二维码">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
      '<path d="' + path.join('') + '" fill="' + dark + '"/></svg>';
  }

  return { matrix: matrix, svg: svg, version: pickVersion };
}));
