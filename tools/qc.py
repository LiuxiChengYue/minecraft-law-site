# -*- coding: utf-8 -*-
"""Quality check on the structured law JSON."""
import json, io, re, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
doc = json.load(open(sys.argv[1], encoding="utf-8"))

arts = []
for ch in doc["chapters"]:
    for a in ch.get("articles", []):
        arts.append((ch, None, a))
    for sec in ch.get("sections", []):
        for a in sec.get("articles", []):
            arts.append((ch, sec, a))

print("chapters=%d articles=%d appendices=%d paras=%d chars=%d" % (
    len(doc["chapters"]), len(arts), len(doc["appendices"]),
    sum(len(a["paragraphs"]) for _c, _s, a in arts),
    sum(len(a["text"]) for _c, _s, a in arts)))
print("\n--- per-article ---")
for ch, sec, a in arts:
    print("第%-3s章 %-24s %-8s paras=%2d chars=%5d  %s" % (
        ch["no"], a.get("title", a["id"])[:24], (a["tags"] or [""])[0][:6],
        len(a["paragraphs"]), len(a["text"]),
        a["paragraphs"][0]["text"][:34] if a["paragraphs"] else "*** EMPTY ***"))

print("\n--- suspicious short paragraphs ---")
bad = 0
for ch, sec, a in arts:
    for p in a["paragraphs"]:
        t = p["text"]
        if len(t) < 10:
            print("  %-14s %r" % (a.get("title", "")[:14], t)); bad += 1
print("  count:", bad)

print("\n--- chapters ---")
for ch in doc["chapters"]:
    n = len(ch["articles"]) + sum(len(s["articles"]) for s in ch["sections"])
    print("第%s章 %-18s arts=%d preamble=%d" % (
        ch["no"], ch["title"][:18], n, len(ch["paragraphs"])))
    for p in ch["paragraphs"][:4]:
        print("      preamble:", p["text"][:80])

print("\n--- appendices ---")
for ap in doc["appendices"]:
    print("附录%s %-16s paras=%d" % (ap["no"], ap["title"], len(ap["paragraphs"])))
    for p in ap["paragraphs"][:2]:
        print("      ", p["text"][:90])
