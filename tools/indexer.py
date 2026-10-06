# -*- coding: utf-8 -*-
"""Add search metadata + a flat article index to the structured law JSON."""
import json
import re
import sys

SRC, DST = sys.argv[1], sys.argv[2]
doc = json.load(open(SRC, encoding="utf-8"))
WORD = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]")
# Running page header / footer text that the PDF layout interleaves with body
# text: "《我的世界》世界基本法典 G2.8 第二章物权法（财产与领土）第九条私有财产保护【一区专属】"
RUNNING_HEAD = re.compile(
    r"《我的世界》世界基本法典\s*G2\.8"
    r"(?:\s*第\s*[一二三四五六七八九十]+\s*章[^第]{0,20}?)?"
    # the article part may itself contain 第…条-ish text, so let it run to the
    # 【…】 tag rather than stopping at the next 第
    r"(?:\s*第\s*[一二三四五六七八九十]+\s*条(?:之[一二三四五六七八九十]+)?[^【\n]{0,30}?(?:【[^】]{2,10}】)?)?"
    r"(?:\s*第\s*[一二三四五六七八九十]+\s*节[^第]{0,20}?)?")

# a header that carries no tag ends right before the next 第…章/条/节
BARE_HEAD = re.compile(
    r"《我的世界》世界基本法典\s*G2\.8[^。；\n]{0,60}?"
    r"(?=第\s*[一二三四五六七八九十]+\s*[章节条]|[。；\n]|$)")


def collapse_headers(text):
    """Strip running headers, wherever the PDF layout interleaved them."""
    prev = None
    out = text
    while prev != out:
        prev = out
        out = RUNNING_HEAD.sub("", out)
    prev = None
    while prev != out:
        prev = out
        out = BARE_HEAD.sub("", out)
    return out
NOISE = re.compile(r"^(被引用于[:：].*|修订记录|过渡条款)$")


def clean(text):
    t = collapse_headers(text)
    t = t.replace("\ufffd", "")
    # "三 区" / "【一 区专属】" spacing artefacts from glyph-by-glyph extraction
    t = re.sub(r"(?<=[\u4e00-\u9fff【\[])\s+(?=区)", "", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t


flat = []


def scrub(container):
    """Remove running headers and other extraction noise from paragraphs."""
    paras = []
    for p in container.get("paragraphs", []):
        t = clean(p["text"])
        if not t or NOISE.match(t):
            continue
        p["text"] = t
        if not paras or paras[-1]["text"] != t:      # drop exact duplicates
            paras.append(p)
    container["paragraphs"] = paras
    for a in container.get("articles", []):
        scrub(a)
    for s in container.get("sections", []):
        scrub(s)
    return container


for ch in doc["chapters"]:
    scrub(ch)
for ap in doc["appendices"]:
    scrub(ap)


def register(art, ch, sec):
    art["chapterNo"] = ch["no"]
    art["chapterTitle"] = clean(ch["title"])
    art["sectionNo"] = sec["no"] if sec else ""
    art["sectionTitle"] = clean(sec["title"]) if sec else ""
    # rebuild the display title from canonical parts (avoids "之一一" glitches)
    suffix = art.get("suffix", "")
    heading = clean(art.get("heading", ""))
    art["heading"] = heading
    art["tags"] = [clean(t) for t in art.get("tags", [])]
    label = ("第%s条%s" % (art["no"], suffix)).replace("之一一", "之一")
    art["title"] = label + (" " + heading if heading else "")
    art["anchor"] = "art-%s%s" % (art["no"], suffix)
    art["search"] = " ".join([
        art["title"], art.get("heading", ""), " ".join(art.get("tags", [])),
        art["chapterTitle"], art.get("sectionTitle", ""), art["text"],
    ])
    flat.append(art)


for ch in doc["chapters"]:
    for a in ch.get("articles", []):
        register(a, ch, None)
    for sec in ch.get("sections", []):
        for a in sec.get("articles", []):
            register(a, ch, sec)

# chapter-level table of contents for the UI sidebar
toc = []
for ch in doc["chapters"]:
    node = {"type": "chapter", "no": ch["no"], "title": ch["title"],
            "anchor": "ch-%s" % ch["no"], "children": []}
    for a in ch.get("articles", []):
        node["children"].append({"type": "article", "no": a["no"],
                                 "title": a["title"], "anchor": a["anchor"],
                                 "tags": a.get("tags", [])})
    for sec in ch.get("sections", []):
        snode = {"type": "section", "no": sec["no"], "title": sec["title"],
                 "anchor": "sec-%s-%s" % (ch["no"], sec["no"]), "children": []}
        for a in sec.get("articles", []):
            snode["children"].append({"type": "article", "no": a["no"],
                                      "title": a["title"], "anchor": a["anchor"],
                                      "tags": a.get("tags", [])})
        node["children"].append(snode)
    toc.append(node)
doc["toc"] = toc

# every tag used anywhere, for the filter chips
tags = []
for a in flat:
    for t in a.get("tags", []):
        if t not in tags:
            tags.append(t)
doc["tags"] = tags
doc["stats"]["articles"] = len(flat)
doc["stats"]["chars"] = sum(len(a["text"]) for a in flat)
doc["index"] = [{"no": a["no"], "suffix": a.get("suffix", ""), "title": a["title"],
                 "heading": a.get("heading", ""), "tags": a.get("tags", []),
                 "anchor": a["anchor"], "chapter": a["chapterNo"],
                 "chapterTitle": a["chapterTitle"], "page": a.get("page")}
                for a in flat]

doc["search_docs"] = [{"anchor": a["anchor"], "title": a["title"],
                       "chapterTitle": a["chapterTitle"],
                       "tags": a.get("tags", []),
                       "paragraphs": [p["text"] for p in a["paragraphs"]]}
                      for a in flat]

open(DST, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1))
print("articles=%d tags=%s chars=%d" % (len(flat), tags, doc["stats"]["chars"]))
for a in flat[:4] + flat[-2:]:
    print("  %-24s %s" % (a["title"][:24], a["chapterTitle"]))
