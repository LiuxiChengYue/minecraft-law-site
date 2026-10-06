/**
 * Law knowledge base: loading, tokenisation and BM25 retrieval.
 *
 * The corpus is Simplified Chinese with embedded Latin words and numbers. CJK
 * text has no whitespace, so a character-level index is used for CJK runs while
 * Latin words and digits stay whole tokens. That keeps recall high for short
 * queries such as "偷东西怎么判" without needing a segmenter dependency.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN = /[A-Za-z0-9_]+/g;

/** Characters that carry no retrieval signal on their own. */
const STOP_CHARS = new Set(
  ('的了是我你他她它们这那有和与及或在为对会能可要就都也很不没吗呢吧啊把被让给从到个之其所以并' +
   '请问一下怎么如何什么哪些哪位告诉想要知道么样嘛呀哦嗯').split('')
);

function isCjk(ch) {
  return CJK.test(ch);
}

/** Tokenise free text into retrieval terms. */
function tokenize(text) {
  const out = [];
  if (!text) return out;
  const lower = String(text).toLowerCase();
  // Latin words and numbers as whole tokens
  let m;
  LATIN.lastIndex = 0;
  while ((m = LATIN.exec(lower)) !== null) out.push(m[0]);
  // CJK characters individually, skipping pure stop characters
  for (const ch of lower) {
    if (isCjk(ch) && !STOP_CHARS.has(ch)) out.push(ch);
  }
  // CJK bigrams add precision when the query is a phrase
  const cjkRuns = lower.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) || [];
  for (const run of cjkRuns) {
    for (let i = 0; i + 1 < run.length; i++) {
      const bg = run.slice(i, i + 2);
      if (!STOP_CHARS.has(bg[0]) && !STOP_CHARS.has(bg[1])) out.push(bg);
    }
  }
  // a Latin/technical token embedded in CJK ("一区可以PVP吗") counts on its own
  for (const t of lower.match(/[a-z0-9_]{2,}/g) || []) {
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** Domain synonyms so colloquial questions still hit the statutory wording. */
const SYNONYMS = {
  杀人: ['恶意杀人', '击杀', '人身安全', 'PVP', '禁止直杀'],
  击杀: ['恶意杀人', '禁止直杀', '人身安全'],
  偷: ['盗窃', '盗窃罪', '未获批取用'],
  偷东西: ['盗窃', '盗窃罪'],
  盗窃: ['盗窃罪', '私有财产保护'],
  抢: ['盗窃', '侵占'],
  破坏: ['恶意破坏', '恶意破坏罪', '公共设施'],
  炸: ['爆炸', 'TNT', '危害公共安全'],
  tnt: ['爆炸性手段', '危害公共安全'],
  外挂: ['作弊', '外挂与作弊禁令', '三级极刑'],
  作弊: ['外挂', '作弊客户端'],
  卡服: ['崩服', '服务器卡顿', '危害公共安全'],
  崩服: ['危害公共安全', '恶意崩服'],
  红石: ['红石违规', '存档健康保护'],
  判: ['处罚', '量刑', '量刑标准'],
  判罚: ['处罚', '量刑标准'],
  处罚: ['量刑标准', '刑罚种类'],
  多少钱: ['罚金', '钻石'],
  罚款: ['罚金'],
  坐牢: ['监禁', '刑罚种类'],
  封号: ['永久封禁', '永久封禁账号'],
  流放: ['流放', '永久流放'],
  假释: ['减刑', '从轻'],
  上诉: ['上诉权', '再审', '诉讼程序'],
  起诉: ['诉讼程序', '起诉状'],
  告: ['起诉', '诉讼程序'],
  证据: ['证据规则', '物证', '书证'],
  房主: ['房主最高权限', '房主中立原则'],
  权限: ['准入权限', '转让准入权限'],
  村长: ['区长', '公务人员'],
  官员: ['公务人员', '职权'],
  职位: ['公务职位', '权力层级'],
  税: ['税收', '税收权限'],
  钱: ['货币', '钻石本位制'],
  汇率: ['货币与汇率制度', '汇率'],
  土地: ['领土', '建筑空间专属保护'],
  房子: ['建筑', '建筑规范', '建筑空间专属保护'],
  建房: ['建筑规范', '建房补贴'],
  补贴: ['建房补贴', '一区建房补贴制度'],
  地铁: ['地铁建设专项规则', '轨道建设厅'],
  环境: ['环境维护义务', '环境与建设法'],
  种树: ['浮空树冠', '环境维护义务'],
  稀有资源: ['稀有资源与公共结构规则', '龙蛋', '鞘翅'],
  紧急: ['紧急状态法', '紧急权'],
  谋权: ['谋权夺位', '禁止谋权夺位罪'],
  篡位: ['谋权夺位', '禁止谋权夺位罪'],
  时效: ['追诉时效'],
  累犯: ['累犯认定标准'],
  自卫: ['自卫权', '防卫过当'],
  守尸: ['恶意守尸'],
  三区: ['三区PVP规则', '三区专属'],
  一区: ['一区专属'],
  全服: ['全服通用'],
};

class KnowledgeBase {
  constructor(lawPath) {
    this.law = JSON.parse(fs.readFileSync(lawPath, 'utf8'));
    this.docs = [];
    this.df = new Map();
    this.build();
  }

  build() {
    const law = this.law;
    const push = (doc) => {
      doc.tokens = tokenize(doc.searchText || (doc.title + ' ' + doc.body));
      doc.tf = new Map();
      for (const t of doc.tokens) doc.tf.set(t, (doc.tf.get(t) || 0) + 1);
      for (const t of doc.tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
      doc.len = doc.tokens.length;
      this.docs.push(doc);
    };

    for (const ch of law.chapters || []) {
      const walk = (container, secTitle) => {
        for (const a of container.articles || []) {
          const body = (a.paragraphs || []).map((p) => p.text).join('\n');
          push({
            kind: 'article',
            anchor: a.anchor || ('art-' + a.no),
            title: a.title,
            heading: a.heading,
            tags: a.tags || [],
            chapterNo: ch.no,
            chapterTitle: ch.title,
            sectionTitle: secTitle || '',
            paragraphs: (a.paragraphs || []).map((p) => p.text),
            body,
            searchText: [
              a.title, a.heading, (a.tags || []).join(' '), ch.title, secTitle || '', body,
            ].join(' '),
          });
        }
      };
      walk(ch, '');
      for (const sec of ch.sections || []) {
        walk(sec, sec.title);
        if (sec.paragraphs && sec.paragraphs.length) {
          push({
            kind: 'section', anchor: 'sec-' + ch.no + '-' + sec.no,
            title: '第' + sec.no + '节 ' + sec.title, heading: sec.title, tags: [],
            chapterNo: ch.no, chapterTitle: ch.title, sectionTitle: sec.title,
            paragraphs: sec.paragraphs.map((p) => p.text),
            body: sec.paragraphs.map((p) => p.text).join('\n'),
            searchText: sec.title + ' ' + ch.title,
          });
        }
      }
      if (ch.paragraphs && ch.paragraphs.length) {
        push({
          kind: 'chapter', anchor: 'ch-' + ch.no,
          title: '第' + ch.no + '章 ' + ch.title, heading: ch.title, tags: [],
          chapterNo: ch.no, chapterTitle: ch.title, sectionTitle: '',
          paragraphs: ch.paragraphs.map((p) => p.text),
          body: ch.paragraphs.map((p) => p.text).join('\n'),
          searchText: ch.title,
        });
      }
    }
    for (const ap of law.appendices || []) {
      push({
        kind: 'appendix', anchor: 'app-' + ap.no,
        title: '附录' + ap.no + ' ' + ap.title, heading: ap.title, tags: [],
        chapterNo: '', chapterTitle: '附录', sectionTitle: '',
        paragraphs: (ap.paragraphs || []).map((p) => p.text),
        body: (ap.paragraphs || []).map((p) => p.text).join('\n'),
        searchText: ap.title + ' ' + (ap.paragraphs || []).map((p) => p.text).join(' '),
      });
    }
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / (this.docs.length || 1);
  }

  /** BM25 over the corpus, with title boosts and zone awareness. */
  search(query, limit = 6) {
    const law = this.law;
    const base = tokenize(query);
    if (!base.length) return [];
    const expanded = new Set(base);
    const lower = String(query).toLowerCase();
    for (const [k, list] of Object.entries(SYNONYMS)) {
      if (lower.includes(k)) for (const t of list) for (const x of tokenize(t)) expanded.add(x);
    }
    const terms = [...expanded];
    // Which area is the question about? (一区 / 三区 / 全服)
    const zone = lower.includes('一区') ? '一区专属'
      : lower.includes('三区') ? '三区专属'
        : (lower.includes('全服') ? '全服通用' : null);
    const N = this.docs.length;
    const k1 = 1.4;
    const b = 0.7;
    const scored = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const t of terms) {
        const f = doc.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) || 1;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const weight = base.includes(t) ? 1 : 0.45;   // synonyms count less
        score += weight * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (doc.len / this.avgLen))));
      }
      if (!score) continue;
      const titleHay = (doc.title + ' ' + (doc.heading || '')).toLowerCase();
      for (const t of base) {
        if (t.length >= 2 && titleHay.includes(t)) score += 2.4;
        else if (t.length === 1 && titleHay.includes(t)) score += 0.12;
      }
      // a Latin/technical key that appears in the heading is the strongest signal
      for (const t of base) {
        if (t.length >= 3 && titleHay.includes(t)) score *= 2.2;
      }
      if (zone && doc.tags && doc.tags.length) {
        // a question about one area should prefer rules written for that area
        score *= doc.tags.includes(zone) ? 1.7 : 0.45;
      }
      if (doc.kind === 'article') score *= 1.25;
      if (doc.kind === 'appendix') score *= 0.9;
      scored.push({ doc, score });
    }
    scored.sort((a, c) => c.score - a.score);
    return scored.slice(0, limit).map((s) => ({ ...s, score: Number(s.score.toFixed(3)) }));
  }

  articleList() {
    return this.docs.filter((d) => d.kind === 'article');
  }
}

module.exports = { KnowledgeBase, tokenize, SYNONYMS };
