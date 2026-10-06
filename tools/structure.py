# -*- coding: utf-8 -*-
"""Turn the extracted law text into structured JSON.

Output: {title, version, date, chapters:[{no, title, sections:[{no,title,articles:[...]}]}], appendices:[...]}
"""
import json
import re
import sys

SRC = sys.argv[1]
DST = sys.argv[2]
raw = open(SRC, encoding="utf-8").read()

PAGE_HEADER = re.compile(
    r"^《我的世界》世界基本法典 G2\.8 .*$")
PAGE_FOOTER = re.compile(r"^第\d+页\s*/\s*共\d+页$")
RUNNING = re.compile(r"^(↑?回?目录|↑回目录|G2\.8)$")
TOC_LINE = re.compile(r"^[第附录修订].*[·]{4,}")
DECOR = re.compile(r"^[■●◆▪▫·\s]+$")

CHAPTER = re.compile(r"^第([一二三四五六七八九十]+)章\s*(.+)$")
SECTION = re.compile(r"^第([一二三四五六七八九十]+)节\s*(.+)$")
ARTICLE = re.compile(r"^第\s*([一二三四五六七八九十百零〇]+)\s*条(之[一二三四五六七八九十]+)?\s*(.*)$")
APPENDIX = re.compile(r"^附录([一二三四五六七八九十]+)\s*(.*)$")
TAG = re.compile(r"[【\[]([^】\]]{2,12})[】\]]")
CN_NUM = "一二三四五六七八九十"
# a heading line: 「第X章 title」「第X节 title」「第X条 title【tag】」
HEAD_SPLIT = re.compile(
    r"(第[" + CN_NUM + r"]+章[^第]{0,24}?)"
    r"(?=第[" + CN_NUM + r"]+[节条]|$)"
    r"|(第[" + CN_NUM + r"]+节[^第]{0,20}?)(?=第[" + CN_NUM + r"]+[节条]|$)"
    r"|(第\s*[" + CN_NUM + r"百零〇]+\s*条(?:之[" + CN_NUM + r"]+)?[^第]{0,40}?)(?=第\s*[" + CN_NUM + r"百零〇]+\s*条|$)"
)

def split_headings(s):
    """Non-empty groups matched by HEAD_SPLIT inside one line."""
    return [g for tup in HEAD_SPLIT.findall(s) for g in tup if g]


lines = []
for ln in raw.split("\n"):
    s = ln.strip()
    if not s:
        continue
    if PAGE_HEADER.match(s) or PAGE_FOOTER.match(s):
        continue
    if RUNNING.match(s) or TOC_LINE.match(s) or DECOR.match(s):
        continue
    if s in ("壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌"):
        continue
    parts = split_headings(s)
    if parts:
        # keep any prose that surrounded the headings
        prose = HEAD_SPLIT.sub("\x00", s)
        for piece in prose.split("\x00"):
            piece = piece.strip()
            if piece:
                lines.append(piece)
        for p in parts:
            lines.append(p.strip())
    else:
        lines.append(s)

for i, s in enumerate(lines):
    if s.startswith("【适用范围说明】"):
        lines = lines[i:]
        break

chapters = []
appendices = []
cur_ch = None
cur_sec = None
cur_art = None
cur_app = None
pending_section_title = None


def flush_article():
    global cur_art
    if cur_art is None:
        return
    if cur_ch is not None:
        if cur_sec is None:
            cur_ch.setdefault("_loose", []).append(cur_art)
        else:
            cur_sec["articles"].append(cur_art)
    cur_art = None


def target_list():
    if cur_app is not None:
        return cur_app["blocks"]
    if cur_sec is not None:
        return None
    return None


prev = None
for s in lines:
    mch = CHAPTER.match(s)
    msec = SECTION.match(s)
    mart = ARTICLE.match(s)
    mapp = APPENDIX.match(s)

    # a chapter heading is exactly the heading line (no trailing body text)
    if mch and len(s) <= 24 and not mart:
        flush_article()
        cur_ch = {"no": mch.group(1), "title": mch.group(2).strip(),
                  "sections": [], "_loose": []}
        chapters.append(cur_ch)
        cur_sec = None
        cur_app = None
        prev = "chapter"
        continue
    if msec and len(s) <= 24 and not mart:
        flush_article()
        if cur_ch is None:
            cur_ch = {"no": "", "title": "总则", "sections": [], "_loose": []}
            chapters.append(cur_ch)
        cur_sec = {"no": msec.group(1), "title": msec.group(2).strip(), "articles": []}
        cur_ch["sections"].append(cur_sec)
        cur_app = None
        prev = "section"
        continue
    if mapp and len(s) <= 30:
        flush_article()
        cur_app = {"no": mapp.group(1), "title": mapp.group(2).strip(), "blocks": []}
        appendices.append(cur_app)
        cur_sec = None
        cur_ch = None
        prev = "appendix"
        continue
    if mart:
        # heading may carry trailing text after the tag: "第九条私有财产保护【一区专属】"
        flush_article()
        head = s
        body_inline = ""
        # if the line is long, split heading from following prose at a tag boundary
        cur_art = {"no": mart.group(1) + (mart.group(2) or ""),
                   "heading": "", "tags": [], "paragraphs": []}
        rest = mart.group(3).strip()
        # heading ends at the last 【...】 tag if the remainder is prose
        tags = TAG.findall(rest)
        if tags:
            last = rest.rfind("】")
            head_part = rest[: last + 1]
            body_inline = rest[last + 1:].strip()
            cur_art["heading"] = TAG.sub("", head_part).strip()
            cur_art["tags"] = tags
        else:
            cur_art["heading"] = rest
        if body_inline:
            cur_art["paragraphs"].append(body_inline)
        prev = "article"
        continue

    # plain prose line -> append to the current article or appendix block
    if cur_art is not None:
        if prev == "article" and not cur_art["paragraphs"] and not cur_art["heading"]:
            cur_art["heading"] = s
        else:
            cur_art["paragraphs"].append(s)
    elif cur_app is not None:
        cur_app["blocks"].append(s)
    elif cur_ch is not None and cur_sec is None:
        cur_ch["_loose"].append(s)
    prev = "prose"

flush_article()

# merge loose paragraphs into the article they follow (chapters without sections)
for ch in chapters:
    if ch["_loose"]:
        if ch["sections"]:
            ch["sections"][-1].setdefault("preamble", []).extend(ch["_loose"])
        else:
            ch.setdefault("preamble", []).extend(ch["_loose"])
    ch.pop("_loose", None)


def clean_article(a):
    a["heading"] = re.sub(r"\s+", "", a["heading"] or "")
    a["paragraphs"] = [re.sub(r"\s{2,}", " ", p).strip() for p in a["paragraphs"] if p.strip()]
    a["text"] = "\n".join(a["paragraphs"])
    return a


n_articles = 0
for ch in chapters:
    for sec in ch["sections"]:
        sec["articles"] = [clean_article(a) for a in sec["articles"]]
        n_articles += len(sec["articles"])

doc = {
    "title": "《我的世界》世界基本法典",
    "version": "G2.8",
    "date": "二〇二六年八月",
    "chapters": chapters,
    "appendices": appendices,
}
open(DST, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1))

print("chapters:", len(chapters))
for ch in chapters:
    print("  第%s章 %s | sections=%d loose=%d" % (
        ch["no"], ch["title"], len(ch["sections"]),
        len(ch.get("preamble", []))))
    for sec in ch["sections"]:
        arts = " ".join(a["no"] for a in sec["articles"])
        print("     第%s节 %s -> %d articles: %s" % (
            sec["no"], sec["title"], len(sec["articles"]), arts[:80]))
print("appendices:", [(a["no"], a["title"], len(a["blocks"])) for a in appendices])
print("total articles:", n_articles)
