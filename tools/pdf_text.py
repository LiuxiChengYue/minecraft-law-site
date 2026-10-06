# -*- coding: utf-8 -*-
"""Extract reading-order text from the covenant PDF (standard library only).

Key facts about this document (verified by inspection):
  * every page shares /Resources 3 0 R, whose /Font maps /F1../F13 to font objects
  * each page re-subsets the CJK face: a single-byte code 0x01..0xFF is remapped
    per page through that page's /ToUnicode CMap, so the CMap must be selected
    from the current page's font resource, never merged globally
  * text is positioned with Td/TD/Tm; runs must be merged by baseline and
    ordered left-to-right, top-to-bottom
"""
import re
import sys
import zlib

SRC, DST = sys.argv[1], sys.argv[2]
PROBE = "--probe" in sys.argv
data = open(SRC, "rb").read()

OBJ_RE = re.compile(rb"(\d+)\s+(\d+)\s+obj\b")
END_RE = re.compile(rb"\bendobj\b")
objs = {}
for m in OBJ_RE.finditer(data):
    e = END_RE.search(data, m.end())
    objs[int(m.group(1))] = data[m.end(): e.start() if e else len(data)]


def parts(num):
    b = objs.get(num)
    if b is None:
        return b"", None
    sm = re.search(rb"\bstream\r\n|\bstream\n|\bstream\r", b)
    if not sm:
        return b, None
    header, raw = b[: sm.start()], b[sm.end():]
    e = raw.rfind(b"endstream")
    if e != -1:
        raw = raw[:e]
        if raw.endswith(b"\r\n"):
            raw = raw[:-2]
        elif raw.endswith(b"\n") or raw.endswith(b"\r"):
            raw = raw[:-1]
    ml = re.search(rb"/Length\s+(\d+)(?!\s*\d+\s+R)", header)
    if ml:
        n = int(ml.group(1))
        if 0 < n <= len(raw):
            raw = raw[:n]
    return header, raw


def inflate(header, raw):
    if raw is None:
        return None
    if b"FlateDecode" not in header:
        return raw
    for attempt in (raw, raw.rstrip(b"\r\n")):
        try:
            return zlib.decompress(attempt)
        except Exception:
            pass
    try:
        return zlib.decompressobj().decompress(raw)
    except Exception:
        return None


def stream(num):
    return inflate(*parts(num))


if PROBE:
    sys.stderr.write("objects=%d\n" % len(objs))


# ------------------------------------------------------------------ CMaps
def hex_to_text(h):
    h = h.strip()
    if len(h) % 4:
        h = h.ljust(len(h) + 4 - len(h) % 4, b"0")
    return "".join(chr(int(h[i:i + 4], 16)) for i in range(0, len(h), 4))


def parse_cmap(txt):
    table = {}
    for m in re.finditer(rb"beginbfchar(.*?)endbfchar", txt, re.S):
        for p in re.finditer(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>", m.group(1)):
            table[int(p.group(1), 16)] = hex_to_text(p.group(2))
    for m in re.finditer(rb"beginbfrange(.*?)endbfrange", txt, re.S):
        for r in re.finditer(
                rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[(.*?)\])",
                m.group(1), re.S):
            lo, hi = int(r.group(1), 16), int(r.group(2), 16)
            if r.group(3) is not None:
                base = r.group(3).decode()
                if len(base) >= 4:
                    start, tail = int(base[:4], 16), hex_to_text(base[4:])
                    for k in range(lo, min(hi, lo + 4095) + 1):
                        table[k] = chr(start + k - lo) + tail
            else:
                for i, it in enumerate(re.findall(rb"<([0-9A-Fa-f]*)>", r.group(4))):
                    if lo + i <= hi:
                        table[lo + i] = hex_to_text(it)
    widths = []
    for m in re.finditer(rb"begincodespacerange(.*?)endcodespacerange", txt, re.S):
        for r in re.finditer(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", m.group(1)):
            widths += [max(1, len(r.group(1)) // 2), max(1, len(r.group(2)) // 2)]
    return table, (sorted(set(widths)) or [1])


FONT_CMAP = {}      # font object -> (table, widths)
for num in list(objs):
    h, _ = parts(num)
    if b"/Type" in h and b"/Font" in h:
        m = re.search(rb"/ToUnicode\s+(\d+)\s+\d+\s+R", h)
        if m:
            txt = stream(int(m.group(1)))
            if txt and (b"beginbfchar" in txt or b"beginbfrange" in txt):
                FONT_CMAP[num] = parse_cmap(txt)
if PROBE:
    sys.stderr.write("cmaps=%d\n" % len(FONT_CMAP))


# --------------------------------------------------------------- resources
def _balanced(buf, start):
    i, depth = start, 0
    while i < len(buf):
        if buf[i:i + 2] == b"<<":
            depth += 1; i += 2; continue
        if buf[i:i + 2] == b">>":
            depth -= 1; i += 2
            if depth == 0:
                return buf[start:i]
            continue
        i += 1
    return buf[start:]


def resolve_fonts(page_body):
    blobs = []
    rn = re.search(rb"/Resources\s+(\d+)\s+\d+\s+R", page_body)
    if rn and int(rn.group(1)) in objs:
        blobs.append(objs[int(rn.group(1))])
    for m in re.finditer(rb"/Resources\s*<<", page_body):
        blobs.append(_balanced(page_body, m.end() - 2))
    fonts = {}
    for blob in blobs:
        fdicts = []
        fr = re.search(rb"/Font\s+(\d+)\s+\d+\s+R", blob)
        if fr and int(fr.group(1)) in objs:
            fdicts.append(objs[int(fr.group(1))])
        for fm in re.finditer(rb"/Font\s*<<", blob):
            fdicts.append(_balanced(blob, fm.end() - 2))
        for fd in fdicts:
            for f in re.finditer(rb"/([^\s/\[\]()<>{}]+)\s+(\d+)\s+\d+\s+R", fd):
                fonts.setdefault(f.group(1).decode("latin-1"), int(f.group(2)))
    return fonts


def page_order():
    pages = [n for n in objs
             if re.search(rb"/Type\s*/Page(?![sA-Za-z])", parts(n)[0])]
    order = []
    for n in objs:
        h, _ = parts(n)
        if re.search(rb"/Type\s*/Pages", h):
            km = re.search(rb"/Kids\s*\[(.*?)\]", h, re.S)
            if km:
                order += [int(k.group(1)) for k in re.finditer(rb"(\d+)\s+\d+\s+R", km.group(1))]
    if order:
        known = set(pages)
        seq = [n for n in order if n in known]
        if len(seq) >= 0.8 * len(pages):
            return seq
    return sorted(pages)


# ------------------------------------------------------------- tokenizer
TOK = re.compile(
    rb"(?P<str>\((?:\\.|[^\\()])*\))"
    rb"|(?P<hex><[0-9A-Fa-f\s]*>)"
    rb"|(?P<name>/[^\s/\[\]()<>{}]*)"
    rb"|(?P<num>[-+]?(?:\d+\.\d*|\.\d+|\d+))"
    rb"|(?P<arr>[\[\]])"
    rb"|(?P<op>[A-Za-z][A-Za-z0-9*]*)"
    rb"|(?P<ws>\s+)"
    rb"|(?P<junk><<|>>|.)",
    re.S,
)
ESC = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 40, 0x29: 41, 0x5C: 92}


def unescape(s):
    out, i = bytearray(), 0
    while i < len(s):
        c = s[i]
        if c == 0x5C and i + 1 < len(s):
            n = s[i + 1]
            if n in ESC:
                out.append(ESC[n]); i += 2; continue
            if 0x30 <= n <= 0x37:
                j, od = i + 1, b""
                while j < len(s) and len(od) < 3 and 0x30 <= s[j] <= 0x37:
                    od += bytes([s[j]]); j += 1
                out.append(int(od, 8) & 0xFF); i = j; continue
            if n in (10, 13):
                i += 2; continue
            out.append(n); i += 2; continue
        out.append(c); i += 1
    return bytes(out)


def decode_bytes(cmap, b):
    """Decode a byte string; unmapped glyphs become U+FFFD so nothing is lost."""
    if not cmap:
        return b.decode("latin-1", "replace")
    table, widths = cmap
    for w in widths:
        if len(b) % w:
            continue
        codes = [int.from_bytes(b[i:i + w], "big") for i in range(0, len(b), w)]
        if all(c in table for c in codes):
            return "".join(table[c] for c in codes)
    w = widths[0] if len(b) % widths[0] == 0 else 1
    return "".join(table.get(int.from_bytes(b[i:i + w], "big"), "\ufffd")
                   for i in range(0, len(b) - w + 1, w))


# ---------------------------------------------------------- page rendering
def page_runs(page_num):
    """[(y, x, fontsize, text)] text runs in the page's content streams."""
    body, _ = parts(page_num)
    contents = [int(m.group(1)) for m in re.finditer(rb"/Contents\s+(\d+)\s+\d+\s+R", body)]
    for m in re.finditer(rb"/Contents\s*\[(.*?)\]", body, re.S):
        contents += [int(k.group(1)) for k in re.finditer(rb"(\d+)\s+\d+\s+R", m.group(1))]
    fonts = resolve_fonts(body)

    runs = []
    for cnum in contents:
        dec = stream(cnum)
        if not dec:
            continue
        cmap = None
        size = 0.0
        # text line matrix (a b c d e f) and text matrix; Td/TD/T* move the line
        # matrix, Tm sets it absolutely, glyph position = Tm x Tlm.
        la, lb, lc, ld, le, lf = 1.0, 0.0, 0.0, 1.0, 0.0, 0.0
        ta, tb, tc, td, te, tf = 1.0, 0.0, 0.0, 1.0, 0.0, 0.0
        stack = []
        for m in TOK.finditer(dec):
            kind = m.lastgroup
            if kind == "ws":
                continue
            tok = m.group()
            if kind in ("str", "hex", "name", "num"):
                stack.append((kind, tok))
                if len(stack) > 400:
                    stack = stack[-200:]
                continue
            if kind == "arr":
                if tok == b"[":
                    stack = []
                continue

            if tok == b"Tf":
                for k, v in reversed(stack):
                    if k == "name":
                        cmap = FONT_CMAP.get(fonts.get(v[1:].decode("latin-1"), -1))
                        break
                sizes = [float(v) for k, v in stack if k == "num"]
                if sizes:
                    size = sizes[-1]
                stack = []
            elif tok == b"BT":
                la, lb, lc, ld, le, lf = 1.0, 0.0, 0.0, 1.0, 0.0, 0.0
                ta, tb, tc, td, te, tf = 1.0, 0.0, 0.0, 1.0, 0.0, 0.0
                stack = []
            elif tok == b"Td" or tok == b"TD":
                nums = [float(v) for k, v in stack if k == "num"]
                if len(nums) >= 2:
                    dx, dy = nums[-2], nums[-1]
                    le, lf = le + dx * la + dy * lc, lf + dx * lb + dy * ld
                if tok == b"TD":
                    pass
                stack = []
            elif tok == b"Tm":
                nums = [float(v) for k, v in stack if k == "num"]
                if len(nums) >= 6:
                    la, lb, lc, ld, le, lf = nums[-6:]
                stack = []
            elif tok == b"T*":
                le, lf = le - (size * 1.2) * lc, lf - (size * 1.2) * ld
                stack = []
            elif tok in (b"Tj", b"TJ", b"'", b'"'):
                if tok in (b"'", b'"'):
                    le, lf = le - (size * 1.2) * lc, lf - (size * 1.2) * ld
                chunks = []
                for k, v in stack:
                    if k == "hex":
                        h = re.sub(rb"\s", b"", v[1:-1])
                        if len(h) % 2:
                            h += b"0"
                        try:
                            b = bytes.fromhex(h.decode("ascii"))
                        except Exception:
                            continue
                    elif k == "str":
                        b = unescape(v[1:-1])
                    elif k == "num":
                        try:
                            if float(v) < -170:
                                chunks.append(" ")
                        except Exception:
                            pass
                        continue
                    else:
                        continue
                    chunks.append(decode_bytes(cmap, b))
                text = "".join(chunks)
                if text.strip():
                    gy = lf + le * lb          # baseline y in device space
                    gx = le + lf * lc          # baseline x in device space
                    runs.append((round(gy, 1), round(gx, 1), size, text))
                # approximate advance so following runs sort correctly
                adv = glyph_advance(text, size)
                le, lf = le + adv * la, lf + adv * lb
                stack = []
            else:
                stack = []
    return runs


def glyph_advance(text, size):
    """Rough pen advance for a run (CJK glyphs are ~1em wide)."""
    if not size:
        size = 10.0
    units = 0.0
    for ch in text:
        o = ord(ch)
        if 0x2E80 <= o <= 0x9FFF or 0xF900 <= o <= 0xFAFF or 0xFF00 <= o <= 0xFF60:
            units += 1.0
        elif ch == " ":
            units += 0.3
        else:
            units += 0.52
    return units * size


def page_text(page_num):
    runs = page_runs(page_num)
    if not runs:
        return "", []
    runs.sort(key=lambda r: (-r[0], r[1]))
    lines, cur_y, cur = [], None, []
    for y, x, size, text in runs:
        if cur_y is None or abs(y - cur_y) <= 2.0:
            cur.append((x, size, text))
            cur_y = y if cur_y is None else cur_y
        else:
            lines.append((cur_y, cur))
            cur_y, cur = y, [(x, size, text)]
    if cur:
        lines.append((cur_y, cur))

    out = []
    for _y, items in lines:
        items.sort(key=lambda t: t[0])
        buf = ""
        prev_end = None
        prev_size = 10.0
        sizes = []
        for x, size, text in items:
            if prev_end is not None:
                gap = x - prev_end
                if gap > max(1.5, 0.6 * (prev_size or 10.0)) and not buf.endswith(" "):
                    buf += " "
            buf += text
            prev_end = x + glyph_advance(text, size)
            prev_size = size
            sizes.append(size)
        s = re.sub(r"[ \t]{2,}", " ", buf)
        # CJK runs are emitted per glyph; drop spaces between CJK characters
        s = re.sub(r"(?<=[\u2e80-\u9fff\uf900-\ufaff\uff00-\uff60]) "
                   r"(?=[\u2e80-\u9fff\uf900-\ufaff\uff00-\uff60])", "", s)
        s = s.strip()
        if s:
            out.append((max(sizes) if sizes else 10.0, s))
    return "\n".join(t for _s, t in out), out


HEAD_MARK = re.compile(r"《我的世界》世界基本法典\s*G2\.8")
CN = "一二三四五六七八九十"
HEADING_HEAD = re.compile(
    r"第\s*([%s]+)\s*章|第\s*([%s]+)\s*节|第\s*([%s百零〇]+)\s*条(?:之[%s]+)?(?!\s*[：:])" % (CN, CN, CN, CN))


def split_glued_heading(line):
    """Split the running page header out of a line.

    When a heading is the first thing on a page, the extractor glues the running
    header onto it: "《我的世界》世界基本法典 G2.8 第二章物权法（财产与领土）
    第九条私有财产保护【一区专属】". The heading is the *last* 第X章/节/条 marker
    in the line, so everything before it is header text and is dropped.
    """
    m = HEAD_MARK.match(line)
    if not m:
        return line
    rest = line[m.end():].strip()
    if not rest:
        return ""
    matches = list(HEADING_HEAD.finditer(rest))
    if matches:
        return rest[matches[-1].start():].strip()
    # no heading follows: drop a chapter title, or the whole header run
    rest = re.sub(r"^第\s*[%s]+\s*章[^第]{0,22}" % CN, "", rest).strip()
    rest = re.sub(r"^第\s*[%s]+\s*条(?:之[%s]+)?\s*[^【\n]{0,26}?(?:【[^】]{2,10}】)?" % (CN, CN),
                  "", rest).strip()
    return rest


def bare_header(line):
    """A line that is nothing but the running header."""
    return bool(HEAD_MARK.match(line)) and not HEADING_HEAD.search(HEAD_MARK.sub("", line, 1))


pages = page_order()
if PROBE:
    sys.stderr.write("pages=%d\n" % len(pages))
out = []
all_lines = []
for i, pn in enumerate(pages, 1):
    t, lines_info = page_text(pn)
    kept = []
    for s, txt in lines_info:
        cleaned = split_glued_heading(txt)
        if not cleaned or bare_header(cleaned):
            continue
        kept.append((s, cleaned))
        all_lines.append((i, round(s, 1), cleaned))
    out.append("\n".join(x[1] for x in kept))
    if PROBE:
        sys.stderr.write("p%02d obj%-4d %6d chars | %s\n" % (
            i, pn, len(t), " / ".join(x[1] for x in kept)[:60]))
open(DST, "w", encoding="utf-8").write("\n\n".join(out))

# sidecar: page, font size, line  (used to detect headings)
if len(sys.argv) > 3:
    with open(sys.argv[3], "w", encoding="utf-8") as fh:
        for pg, sz, txt in all_lines:
            fh.write("%d\t%s\t%s\n" % (pg, sz, txt))
sys.stderr.write("wrote %s\n" % DST)
