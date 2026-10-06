# -*- coding: utf-8 -*-
"""Dependency-free PDF text extractor tuned for this document (stdlib only).

Pipeline:
  1. index every `N 0 obj ... endobj` body (single pass, non-greedy slices)
  2. expand /ObjStm compressed object streams
  3. decode every /ToUnicode CMap into {code: char} + declared code widths
  4. walk pages in /Pages -> /Kids order, resolve /Resources (indirect or inline)
  5. interpret content streams: Tf selects the font, Tj/TJ/'/" emit text,
     Td/TD/T*/Tm/BT start new lines
"""
import re
import sys
import zlib

SRC, DST = sys.argv[1], sys.argv[2]
data = open(SRC, "rb").read()

OBJ_RE = re.compile(rb"(\d+)\s+(\d+)\s+obj\b")
END_RE = re.compile(rb"\bendobj\b")

objs = {}
for m in OBJ_RE.finditer(data):
    e = END_RE.search(data, m.end())
    objs[int(m.group(1))] = data[m.end(): e.start() if e else len(data)]
sys.stderr.write("objects: %d\n" % len(objs))


def parts(num):
    """(header, compressed_bytes_or_None) for an object.

    The stream payload is delimited by /Length when trustworthy, otherwise by
    the `endstream` keyword. Only a single trailing EOL is removed: raw
    compressed bytes may legitimately end in 0x0A..0x0D.
    """
    b = objs.get(num)
    if b is None:
        return b"", None
    sm = re.search(rb"\bstream\r\n|\bstream\n|\bstream\r", b)
    if not sm:
        return b, None
    header = b[: sm.start()]
    raw = b[sm.end():]
    e = raw.rfind(b"endstream")
    if e != -1:
        raw = raw[:e]
        if raw.endswith(b"\r\n"):
            raw = raw[:-2]
        elif raw.endswith(b"\n") or raw.endswith(b"\r"):
            raw = raw[:-1]
    ml = re.search(rb"/Length\s+(\d+)(?!\s+\d+\s+R)", header)
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
    try:
        return zlib.decompress(raw)
    except Exception:
        try:
            return zlib.decompressobj().decompress(raw)
        except Exception:
            return None


def stream(num):
    h, raw = parts(num)
    return inflate(h, raw)


if "--probe" in sys.argv:
    for n in (64, 66, 161, 242):
        h, raw = parts(n)
        dec = inflate(h, raw)
        sys.stderr.write("probe obj %d: raw=%s dec=%s\n" % (
            n, len(raw) if raw else None, len(dec) if dec else None))
        if dec:
            sys.stderr.write(dec[:200].decode("latin-1").replace("\n", "|") + "\n")
    sys.stderr.write("font dict 4: %s\n" % parts(4)[0][:200].decode("latin-1"))
    sys.stderr.write("page 63: %s\n" % parts(63)[0][:200].decode("latin-1"))
    sys.stderr.write("resources 3: %s\n" % parts(3)[0][:300].decode("latin-1"))


# ------------------------------------------------------ expand object streams
added = 0
for num in list(objs):
    h, raw = parts(num)
    if b"/ObjStm" not in h:
        continue
    dec = inflate(h, raw)
    if not dec:
        continue
    mn = re.search(rb"/N\s+(\d+)", h)
    mf = re.search(rb"/First\s+(\d+)", h)
    if not (mn and mf):
        continue
    n, first = int(mn.group(1)), int(mf.group(1))
    head = dec[:first].split()
    try:
        pairs = [(int(head[i]), int(head[i + 1])) for i in range(0, 2 * n, 2)]
    except Exception:
        continue
    for i, (onum, off) in enumerate(pairs):
        end = (pairs[i + 1][1] if i + 1 < len(pairs) else len(dec) - first)
        if onum not in objs:
            objs[onum] = dec[first + off: first + end]
            added += 1
sys.stderr.write("objstm expanded: %d\n" % added)


# --------------------------------------------------------------- ToUnicode
def cmap_widths(txt):
    widths = []
    for m in re.finditer(rb"begincodespacerange(.*?)endcodespacerange", txt, re.S):
        for r in re.finditer(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", m.group(1)):
            widths.append(max(1, len(r.group(1)) // 2))
            widths.append(max(1, len(r.group(2)) // 2))
    if not widths:
        m = re.search(rb"beginbfchar(.*?)endbfchar", txt, re.S)
        if m:
            c = re.search(rb"<([0-9A-Fa-f]+)>", m.group(1))
            if c:
                widths.append(max(1, len(c.group(1)) // 2))
    widths = sorted({w for w in widths if w in (1, 2, 3, 4)}) or [1]
    return widths


def hex_to_text(h):
    h = h.strip()
    if len(h) % 4:
        h = h.ljust(len(h) + (4 - len(h) % 4), b"0")
    out = []
    for i in range(0, len(h), 4):
        try:
            out.append(chr(int(h[i:i + 4], 16)))
        except Exception:
            pass
    return "".join(out)


def parse_cmap(txt):
    table = {}
    widths = cmap_widths(txt)
    for m in re.finditer(rb"beginbfchar(.*?)endbfchar", txt, re.S):
        for p in re.finditer(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>", m.group(1)):
            table[int(p.group(1), 16)] = hex_to_text(p.group(2))
    for m in re.finditer(rb"beginbfrange(.*?)endbfrange", txt, re.S):
        for r in re.finditer(
            rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[(.*?)\])",
            m.group(1), re.S,
        ):
            lo, hi = int(r.group(1), 16), int(r.group(2), 16)
            if r.group(3) is not None:
                base = r.group(3).decode()
                if len(base) >= 4:
                    start = int(base[:4], 16)
                    tail = hex_to_text(base[4:])
                    for k in range(lo, min(hi, lo + 65535) + 1):
                        table[k] = chr(start + k - lo) + tail
            elif r.group(4) is not None:
                for i, it in enumerate(re.findall(rb"<([0-9A-Fa-f]*)>", r.group(4))):
                    if lo + i <= hi:
                        table[lo + i] = hex_to_text(it)
    return {"table": table, "widths": widths}


FONT_CMAP = {}          # font object number -> cmap
DROP_STATS = {}
for num in list(objs):
    h, _ = parts(num)
    if b"/Type" in h and b"/Font" in h:
        m = re.search(rb"/ToUnicode\s+(\d+)\s+\d+\s+R", h)
        if m:
            txt = stream(int(m.group(1)))
            if txt and (b"beginbfchar" in txt or b"beginbfrange" in txt):
                FONT_CMAP[num] = parse_cmap(txt)
sys.stderr.write("cmaps: %d\n" % len(FONT_CMAP))


# --------------------------------------------------------------- resources
def _balanced(buf, start):
    """Slice a << >> balanced dictionary starting at the '<' of '<<'."""
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
    """Map resource name (/F1) -> font object number for one page."""
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
                fonts.setdefault(f.group(1), int(f.group(2)))
    return fonts


def page_order():
    pages = [n for n in objs if re.search(rb"/Type\s*/Page\b", parts(n)[0])]
    order = []
    for n in objs:
        h, _ = parts(n)
        if re.search(rb"/Type\s*/Pages", h):
            km = re.search(rb"/Kids\s*\[(.*?)\]", h, re.S)
            if km:
                for k in re.finditer(rb"(\d+)\s+\d+\s+R", km.group(1)):
                    order.append(int(k.group(1)))
    if order:
        known = set(pages)
        seq = [n for n in order if n in known]
        rest = [n for n in pages if n not in set(seq)]
        if len(seq) >= 0.6 * len(pages):
            return seq + rest
    return sorted(pages)


# --------------------------------------------------------- content decoding
TOKEN_RE = re.compile(
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

SIMPLE_ESC = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12,
              0x28: 40, 0x29: 41, 0x5C: 92}


def unescape(s):
    out = bytearray()
    i = 0
    while i < len(s):
        c = s[i]
        if c == 0x5C and i + 1 < len(s):
            n = s[i + 1]
            if n in SIMPLE_ESC:
                out.append(SIMPLE_ESC[n]); i += 2; continue
            if 0x30 <= n <= 0x37:
                j, oct_digits = i + 1, b""
                while j < len(s) and len(oct_digits) < 3 and 0x30 <= s[j] <= 0x37:
                    oct_digits += bytes([s[j]]); j += 1
                out.append(int(oct_digits, 8) & 0xFF); i = j; continue
            if n in (10, 13):
                i += 2; continue
            out.append(n); i += 2; continue
        out.append(c); i += 1
    return bytes(out)


def decode_string(cmap, raw, is_hex):
    global DROP_STATS
    if is_hex:
        h = re.sub(rb"\s", b"", raw)
        if len(h) % 2:
            h += b"0"
        try:
            b = bytes.fromhex(h.decode("ascii"))
        except Exception:
            return ""
    else:
        b = unescape(raw)
    if not cmap:
        return b.decode("latin-1", "replace")
    table, widths = cmap["table"], cmap["widths"]
    for w in widths:
        if len(b) % w:
            continue
        codes = [int.from_bytes(b[i:i + w], "big") for i in range(0, len(b), w)]
        if all(c in table for c in codes):
            return "".join(table[c] for c in codes)
    w = widths[0] if len(b) % widths[0] == 0 else 1
    out = []
    for i in range(0, len(b) - w + 1, w):
        c = int.from_bytes(b[i:i + w], "big")
        if c in table:
            out.append(table[c])
        else:
            DROP_STATS[c] = DROP_STATS.get(c, 0) + 1
    return "".join(out)


def extract(page_num):
    body, _ = parts(page_num)
    contents = [int(m.group(1)) for m in re.finditer(rb"/Contents\s+(\d+)\s+\d+\s+R", body)]
    for m in re.finditer(rb"/Contents\s*\[(.*?)\]", body, re.S):
        contents += [int(k.group(1)) for k in re.finditer(rb"(\d+)\s+\d+\s+R", m.group(1))]
    fonts = resolve_fonts(body)

    lines = []
    for cnum in contents:
        dec = stream(cnum)
        if "--probe" in sys.argv:
            sys.stderr.write("  extract cnum=%r dec=%s\n" % (cnum, len(dec) if dec else None))
        if not dec:
            continue
        cmap, buf, pend = None, [], []
        prev_y = None
        dbg = 0
        if "--probe" in sys.argv and DROP_STATS:
            pass
        if "--probe" in sys.argv and cnum == pages[2] and False:
            pass
        if "--probe" in sys.argv and cnum in (161,):
            sys.stderr.write("  CJKDUMP obj=%s len=%d\n" % (cnum, len(dec)))
            sys.stderr.write("  seg=%r\n" % dec[400:1100])
        for m in TOKEN_RE.finditer(dec):
            kind = m.lastgroup
            if kind == "ws":
                continue
            tok = m.group()
            if "--probe" in sys.argv and dbg < 25:
                dbg += 1
                sys.stderr.write("    tok kind=%s %r\n" % (kind, tok[:40]))
            if kind in ("str", "hex", "name", "num"):
                pend.append((kind, tok))
                if len(pend) > 300:
                    pend = pend[-150:]
                continue
            if kind == "arr":
                # '[' opens a TJ array: operands from here belong to it.
                # ']' must NOT clear them - the following TJ reads them.
                if tok == b"[":
                    pend = []
                continue

            if tok == b"Tf":
                for k, v in reversed(pend):
                    if k == "name":
                        cmap = FONT_CMAP.get(fonts.get(v[1:], -1))
                        if "--probe" in sys.argv and dbg < 40:
                            sys.stderr.write("    Tf %r -> fontobj=%r cmap=%s keys=%r\n" % (
                                v, fonts.get(v[1:]), bool(cmap), sorted(FONT_CMAP)[:20]))
                        break
                pend = []
            elif tok in (b"Tj", b"'", b'"'):
                s = next((v for k, v in reversed(pend) if k == "str"), None)
                if s is not None:
                    buf.append(decode_string(cmap, s[1:-1], False))
                if tok in (b"'", b'"') and buf:
                    lines.append("".join(buf)); buf = []
                pend = []
            elif tok == b"TJ":
                if "--probe" in sys.argv:
                    sys.stderr.write("    TJ cnum=%s pend=%r cmap=%s buf=%r\n" % (
                        cnum, pend[:8], bool(cmap), "".join(buf)[:40]))
                for k, v in pend:
                    if k == "str":
                        buf.append(decode_string(cmap, v[1:-1], False))
                    elif k == "hex":
                        buf.append(decode_string(cmap, v[1:-1], True))
                    elif k == "num":
                        try:
                            if float(v) < -170:
                                buf.append(" ")
                        except Exception:
                            pass
                pend = []
            elif tok in (b"Td", b"TD", b"T*", b"Tm", b"BT"):
                nums = [float(v) for k, v in pend if k == "num"]
                y = None
                if tok in (b"Td", b"TD") and len(nums) >= 2:
                    y = nums[1]
                    if abs(y) > 0.3:
                        if buf:
                            lines.append("".join(buf)); buf = []
                elif tok == b"Tm" and len(nums) >= 6:
                    y = nums[5]
                    if prev_y is not None and abs(y - prev_y) > 0.3 and buf:
                        lines.append("".join(buf)); buf = []
                    prev_y = y
                elif tok == b"T*" and buf:
                    lines.append("".join(buf)); buf = []
                pend = []
            else:
                pend = []
        if buf:
            lines.append("".join(buf))
    return lines


pages = page_order()
sys.stderr.write("pages: %d\n" % len(pages))
if "--probe" in sys.argv:
    _b = parts(pages[0])[0]
    sys.stderr.write("PAGE0 body=%r\n" % _b[:220])
    _cs = [int(m.group(1)) for m in re.finditer(rb"/Contents\s+(\d+)\s+\d+\s+R", _b)]
    sys.stderr.write("PAGE0 contents=%r\n" % _cs)
    sys.stderr.write("PAGE0 fonts=%r\n" % resolve_fonts(_b))
out = []
for i, pn in enumerate(pages, 1):
    ls = extract(pn)
    txt = "\n".join(ls)
    out.append(txt)
    sys.stderr.write("p%02d obj%-5d %6d chars\n" % (i, pn, len(txt)))

# join hyphen-free: keep page breaks as blank lines
open(DST, "w", encoding="utf-8").write("\n\n".join(out))
if "--probe" in sys.argv:
    top = sorted(DROP_STATS.items(), key=lambda kv: -kv[1])[:40]
    sys.stderr.write("dropped codes: %d distinct, top=%r\n" % (len(DROP_STATS), top))
    for fo, cm in sorted(FONT_CMAP.items()):
        sys.stderr.write("font %d widths=%r entries=%d sample=%r\n" % (
            fo, cm["widths"], len(cm["table"]),
            [(hex(k), v) for k, v in list(cm["table"].items())[:6]]))
sys.stderr.write("wrote %s\n" % DST)
