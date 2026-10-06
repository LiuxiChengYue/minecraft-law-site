# -*- coding: utf-8 -*-
"""Build structured law JSON from the size-annotated line dump.

Input TSV rows: page \t max-font-size \t line
Headings are detected by font size (body text is 10.5pt) plus the canonical
第X章 / 第X节 / 第X条 shapes; everything else is body prose.
"""
import json
import re
import sys

SRC, DST = sys.argv[1], sys.argv[2]

PAGE_HEADER = re.compile(r"^《我的世界》世界基本法典\s*G2\.8")
PAGE_FOOTER = re.compile(r"^第\d+页\s*/\s*共\d+页$")
RUNNING = re.compile(r"^(↑?\s*回目录.*|G2\.8|·+)$")
TOC_LINE = re.compile(r"[·]{4,}")
DECOR = re.compile(r"^[■●◆▪▫\s]+$")
CN = "一二三四五六七八九十"
CH_RE = re.compile(r"^第\s*([%s]+)\s*章\s*(.*)$" % CN)
SEC_RE = re.compile(r"^第\s*([%s]+)\s*节\s*(.*)$" % CN)
ART_RE = re.compile(r"^第\s*([%s百零〇]+)\s*条(之[%s]+)?\s*(.*)$" % (CN, CN))
APP_RE = re.compile(r"^附录\s*([%s]+)\s*[｜|·\s]*(.*)$" % CN)
TAG_RE = re.compile(r"[【\[]([^】\]]{2,14})[】\]]")
ADMIN = {"壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"}


def norm(s):
    s = s.replace("\u3000", " ")
    s = re.sub(r"\s{2,}", " ", s)
    return s.strip()


rows = []
for ln in open(SRC, encoding="utf-8"):
    parts = ln.rstrip("\n").split("\t")
    if len(parts) < 3:
        continue
    page, size, text = int(parts[0]), float(parts[1]), norm("\t".join(parts[2:]))
    if not text or text in ADMIN:
        continue
    if PAGE_HEADER.match(text) or PAGE_FOOTER.match(text):
        continue
    if TOC_LINE.search(text):
        continue                       # table of contents / index dotted lines
    if RUNNING.match(text) or DECOR.match(text):
        continue
    rows.append((page, size, text))

# drop the front-matter table of contents block ("目录" .. before the body)
start = 0
for i, (p, s, t) in enumerate(rows):
    if t.startswith("【适用范围说明】") or CH_RE.match(t) and "章" in t[:4]:
        start = i
        break
rows = rows[start:]

chapters, appendices = [], []
cur_ch = cur_sec = cur_art = cur_app = None
flat_articles = []


def attach_paragraph(text):
    if cur_art is not None:
        cur_art["paragraphs"].append(text)
    elif cur_app is not None:
        cur_app["blocks"].append(text)
    elif cur_sec is not None:
        cur_sec.setdefault("preamble", []).append(text)
    elif cur_ch is not None:
        cur_ch.setdefault("preamble", []).append(text)


def new_article(no, extra, head_text, page, size):
    global cur_art
    tags = TAG_RE.findall(head_text)
    heading = TAG_RE.sub("", head_text).strip(" ：:·-—")
    art = {
        "no": no,
        "suffix": extra or "",
        "id": "art-%s%s" % (no, extra or ""),
        "heading": heading,
        "tags": tags,
        "page": page,
        "paragraphs": [],
    }
    cur_art = art
    flat_articles.append(art)
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

    # appendix headings: "附录一罪名量刑速查表" (size >= 12)
    if m_app and size >= 11.5 and len(text) <= 30 and not m_art:
        cur_app = {"no": m_app.group(1), "title": m_app.group(2).strip(),
                   "blocks": [], "page": page}
        appendices.append(cur_app)
        cur_ch = cur_sec = cur_art = None
        continue

    if m_ch and size >= 11.5 and len(text) <= 30 and not m_art:
        cur_ch = {"no": m_ch.group(1), "title": m_ch.group(2).strip(),
                  "sections": [], "articles": [], "preamble": [], "page": page}
        chapters.append(cur_ch)
        cur_sec = cur_art = cur_app = None
        continue

    if m_sec and size >= 11.5 and len(text) <= 30 and not m_art:
        if cur_ch is None:
            cur_ch = {"no": "", "title": "总则", "sections": [], "articles": [],
                      "preamble": [], "page": page}
            chapters.append(cur_ch)
        cur_sec = {"no": m_sec.group(1), "title": m_sec.group(2).strip(),
                   "articles": [], "page": page}
        cur_ch["sections"].append(cur_sec)
        cur_art = cur_app = None
        continue

    if m_art:
        no = m_art.group(1)
        extra = m_art.group(2) or ""
        rest = m_art.group(3)
        # the heading may run into following prose: cut at the last 【..】 tag
        if "】" in rest:
            cut = rest.rfind("】") + 1
            head_text, inline = rest[:cut], rest[cut:].strip()
        else:
            head_text, inline = rest, ""
        art = new_article(no, extra, head_text, page, size)
        if inline:
            art["paragraphs"].append(inline)
        continue

    attach_paragraph(text)

# ---------------------------------------------------------------- finalize
def finalize_article(a):
    a["paragraphs"] = [p for p in a["paragraphs"] if p]
    a["text"] = "\n".join(a["paragraphs"])
    a["title"] = ("第%s条%s" % (a["no"], a["suffix"])) + (
        " " + a["heading"] if a["heading"] else "")
    return a


for ch in chapters:
    for sec in ch["sections"]:
        sec["articles"] = [finalize_article(a) for a in sec["articles"]]
    ch["articles"] = [finalize_article(a) for a in ch.get("articles", [])]

doc = {
    "title": "《我的世界》世界基本法典",
    "version": "G2.8",
    "date": "二〇二六年八月",
    "chapters": chapters,
    "appendices": appendices,
    "stats": {
        "chapters": len(chapters),
        "articles": len(flat_articles),
        "appendices": len(appendices),
    },
}
open(DST, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1))

print("chapters:", len(chapters), " articles:", len(flat_articles),
      " appendices:", len(appendices))
for ch in chapters:
    arts = ch["articles"] + [a for s in ch["sections"] for a in s["articles"]]
    print("  第%s章 %-16s articles=%d sections=%d preamble=%d" % (
        ch["no"], ch["title"][:16], len(arts), len(ch["sections"]), len(ch["preamble"])))
    for sec in ch["sections"]:
        print("     第%s节 %-14s -> %s" % (
            sec["no"], sec["title"][:14], " ".join(a["title"][:14] for a in sec["articles"])))
    if ch["articles"]:
        print("     ->", " | ".join(a["title"][:20] for a in ch["articles"]))
for a in appendices:
    print("  附录%s %s blocks=%d" % (a["no"], a["title"], len(a["blocks"])))
