# -*- coding: utf-8 -*-
"""Build the final structured law JSON from the size-annotated line dump.

Row format: page \t max-font-size \t line

Rules
  * headings are recognised by shape (第X章 / 第X节 / 第X条 / 附录X) and by size
  * body lines are merged into paragraphs: a new paragraph starts when the
    previous line ended a sentence (。！？；…"』）) or when the line opens a list
    item (●, （一）, 一、, [1]) or a labelled block (…：) or has a heading shape
"""
import json
import re
import sys

SRC, DST = sys.argv[1], sys.argv[2]

PAGE_HEADER = re.compile(r"^《我的世界》世界基本法典\s*G2\.8")
HEADING_MARK = re.compile(r"第\s*[一二三四五六七八九十百零〇]+\s*[章节条]|附录")
PAGE_FOOTER = re.compile(r"^第\d+页\s*/\s*共\d+页$")
RUNNING = re.compile(r"^(↑?\s*回目录.*|↑\s*回目录.*|G2\.8|·+)$")
TOC_LINE = re.compile(r"[·]{4,}")
DECOR = re.compile(r"^[■●◆▪▫\s]+$")
CN = "一二三四五六七八九十"
CH_RE = re.compile(r"^第\s*([%s]+)\s*章\s*[｜|·]?\s*(.*)$" % CN)
SEC_RE = re.compile(r"^第\s*([%s]+)\s*节\s*[｜|·]?\s*(.*)$" % CN)
ART_RE = re.compile(r"^第\s*([%s百零〇]+)\s*条(之[%s]+)?\s*(.*)$" % (CN, CN))
APP_RE = re.compile(r"^附录\s*([%s]+)\s*[｜|·\s]*(.*)$" % CN)
TAG_RE = re.compile(r"[【\[]([^】\]]{2,14})[】\]]")
ADMIN = {"壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"}
BULLET = re.compile(r"^[\u25cf\u25c6\u25aa\u25ab\u2022\uf0b7\uf0d8\uf076\uf0a7\u25a0]\s*")
DASH_BULLET = re.compile(r"^[\u2014\u2013-]{1,2}\s+")
ITEM_CN = re.compile(r"^[（(]\s*[%s]+\s*[)）]" % CN)
ITEM_NUM = re.compile(r"^[（(]\s*\d+\s*[)）]")
ITEM_DOT = re.compile(r"^\d+\s*[、.．]\s*")
ITEM_TIER = re.compile(r"^[%s]+\s*、" % CN)
LABEL_END = re.compile(r"[：:]$")
SENT_END = re.compile(r"[。！？；…”』」)）】]\s*$")


def norm(s):
    s = s.replace("\u3000", " ")
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


rows = []
toc_mode = False
for ln in open(SRC, encoding="utf-8"):
    parts = ln.rstrip("\n").split("\t")
    if len(parts) < 3:
        continue
    page, size, text = int(parts[0]), float(parts[1]), norm("\t".join(parts[2:]))
    # the bullet glyph comes from a symbol font with no ToUnicode map
    text = text.replace("\uf0b7", "\u25cf").replace("\uf0a7", "\u25cf")
    if not text or text in ADMIN:
        continue
    # the running page header is the bare header string; when the extractor
    # glued a real heading after it, keep the heading part
    if PAGE_HEADER.match(text):
        stripped = PAGE_HEADER.sub("", text).strip()
        if not stripped or not HEADING_MARK.search(stripped):
            continue
        text = stripped
    if PAGE_FOOTER.match(text):
        continue
    if text == "目录":
        toc_mode = True
        continue
    if toc_mode:
        if size >= 15.0 and CH_RE.match(text):
            toc_mode = False            # real chapter heading: body starts here
        else:
            continue
    if TOC_LINE.search(text) or RUNNING.match(text) or DECOR.match(text):
        continue
    if "--trace" in sys.argv and size >= 15.0:
        sys.stderr.write("ROW page=%s size=%s text=%r\n" % (page, size, text[:40]))
    rows.append((page, size, text))

# (the front-matter table of contents is already dropped by toc_mode above;
#  the body itself starts on the cover verso with 立法宗旨与基本原则)

chapters, appendices = [], []
cur_ch = cur_sec = cur_art = cur_app = None
mode = "body"          # body | appendix
flat = []


def target_container():
    if cur_art is not None:
        return cur_art["lines"]
    if cur_app is not None:
        return cur_app["lines"]
    if cur_sec is not None:
        return cur_sec.setdefault("lines", [])
    if cur_ch is not None:
        return cur_ch.setdefault("lines", [])
    return None


def start_article(no, suffix, head_text, page, size):
    global cur_art
    tags = TAG_RE.findall(head_text)
    heading = TAG_RE.sub("", head_text).strip(" ：:·-—")
    # headings glued to the next word keep a space for readability
    heading = re.sub(r"^([一二三四五六七八九十]+)(?=[\u4e00-\u9fff])", r"\1 ", heading)
    art = {
        "no": no, "suffix": suffix or "",
        "id": "art-%s%s" % (no, suffix or ""),
        "heading": heading, "tags": tags, "page": page, "lines": [],
    }
    cur_art = art
    flat.append(art)
    if cur_sec is not None:
        cur_sec["articles"].append(art)
    elif cur_ch is not None:
        cur_ch.setdefault("articles", []).append(art)
    return art


for page, size, text in rows:
    m_app = APP_RE.match(text)
    m_ch = CH_RE.match(text)
    m_sec = SEC_RE.match(text)
    m_art = ART_RE.match(text)
    if "--trace" in sys.argv and size >= 15.0:
        sys.stderr.write("TEST page=%s size=%s ch=%s app=%s sec=%s art=%s len=%d\n" % (
            page, size, bool(m_ch), bool(m_app), bool(m_sec), bool(m_art), len(text)))

    if m_app and size >= 10.8 and len(text) <= 20 and not m_art:
        cur_app = {"no": m_app.group(1), "title": m_app.group(2).strip(),
                   "page": page, "lines": []}
        appendices.append(cur_app)
        cur_ch = cur_sec = cur_art = None
        mode = "appendix"
        continue

    if m_ch and size >= 14.5 and len(text) <= 34 and not m_art:
        cur_ch = {"no": m_ch.group(1), "title": m_ch.group(2).strip(),
                  "sections": [], "articles": [], "lines": [], "page": page}
        chapters.append(cur_ch)
        if "--trace" in sys.argv:
            sys.stderr.write("CH+ 第%s章 %s (page %s size %s)\n"
                             % (cur_ch["no"], cur_ch["title"], page, size))
        cur_sec = cur_art = cur_app = None
        mode = "body"
        continue

    if m_sec and size >= 10.8 and len(text) <= 34 and not m_art:
        if cur_ch is None:
            cur_ch = {"no": "", "title": "总则", "sections": [], "articles": [],
                      "lines": [], "page": page}
            chapters.append(cur_ch)
        cur_sec = {"no": m_sec.group(1), "title": m_sec.group(2).strip(),
                   "articles": [], "lines": [], "page": page}
        cur_ch["sections"].append(cur_sec)
        cur_art = cur_app = None
        continue

    # A real article heading is typeset larger than body text (12pt vs 10.5pt)
    # and is a short standalone line. A line that merely mentions 第X条 in prose
    # must not open a new article.
    if m_art and mode == "body" and len(text) <= 34 and size >= 11.0:
        no, suffix, rest = m_art.group(1), m_art.group(2) or "", m_art.group(3)
        if "】" in rest:
            cut = rest.rfind("】") + 1
            head_text, inline = rest[:cut], rest[cut:].strip()
        else:
            head_text, inline = rest, ""
        art = start_article(no, suffix, head_text, page, size)
        if inline:
            art["lines"].append((page, -1.0, inline))
        continue

    cont = target_container()
    if cont is not None:
        cont.append((page, size, text))

# ------------------------------------------------------- paragraph merging
def block_kind(text):
    if BULLET.match(text):
        return "bullet"
    if ITEM_CN.match(text) or ITEM_NUM.match(text) or ITEM_DOT.match(text):
        return "item"
    if ITEM_TIER.match(text) and len(text) <= 40:
        return "item"
    # a short numbered heading like "二、军区主官的职权"
    if ITEM_TIER.match(text) and len(text) <= 16:
        return "item"
    if LABEL_END.search(text) and len(text) <= 40:
        return "label"
    return "text"


def merge(lines):
    """Merge physical lines into readable paragraphs.

    A line with size < 0 is text that sat on the same physical line as the
    article heading; it always opens the article and never merges upward.
    """
    paras = []
    for page, size, text in lines:
        t = text.strip()
        if not t:
            continue
        kind = block_kind(t)
        body = BULLET.sub("", t).strip()
        if size < 0:
            paras.append({"kind": kind, "text": body})
            continue
        if not paras:
            paras.append({"kind": kind, "text": body})
            continue
        prev = paras[-1]
        if kind == "text" and prev["kind"] == "bullet":
            prev["text"] += body            # wrapped continuation of a bullet
            continue
        if kind == "text" and not SENT_END.search(prev["text"]):
            # CJK runs join without a space; a colon/quote before the break also
            # joins directly ("谋权夺位定义：" + "任何玩家…")
            no_space = bool(re.search(r"[\u4e00-\u9fff：:、“”「」（）]$", prev["text"])) and \
                bool(re.match(r"^[\u4e00-\u9fff（(]", body))
            prev["text"] = (prev["text"] + ("" if no_space else " ") + body).strip()
            continue
        paras.append({"kind": kind, "text": body})
    return [p for p in paras if p["text"].strip()]


def finish(container):
    lines = container.pop("lines", [])
    container["paragraphs"] = merge(lines)
    # only articles carry 第X条 titles; chapters/sections/appendices keep theirs
    if "heading" in container:
        container["title"] = ("第%s条%s" % (container.get("no", ""),
                                            container.get("suffix", ""))) + (
            " " + container["heading"] if container["heading"] else "")
    return container


for ch in chapters:
    for sec in ch["sections"]:
        sec["articles"] = [finish(a) for a in sec["articles"]]
        finish(sec)
    ch["articles"] = [finish(a) for a in ch.get("articles", [])]
    finish(ch)
for ap in appendices:
    finish(ap)

# safety net: any article still unmerged
for a in flat:
    if "paragraphs" not in a:
        finish(a)

for a in flat:
    a["text"] = "\n".join(p["text"] for p in a["paragraphs"])

doc = {
    "title": "《我的世界》世界基本法典",
    "version": "G2.8",
    "date": "二〇二六年八月",
    "chapters": chapters,
    "appendices": appendices,
    "stats": {
        "chapters": len(chapters),
        "articles": len(flat),
        "appendices": len(appendices),
        "paragraphs": sum(len(a["paragraphs"]) for a in flat),
        "chars": sum(len(a["text"]) for a in flat),
    },
}
open(DST, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1))
print(json.dumps(doc["stats"], ensure_ascii=False))
for ch in chapters:
    arts = ch["articles"] + [a for s in ch["sections"] for a in s["articles"]]
    print("第%s章 %-16s arts=%d paras=%d" % (
        ch["no"], ch["title"][:16], len(arts), sum(len(a["paragraphs"]) for a in arts)))
for ap in appendices:
    print("附录%s %s paras=%d" % (ap["no"], ap["title"], len(ap["paragraphs"])))
