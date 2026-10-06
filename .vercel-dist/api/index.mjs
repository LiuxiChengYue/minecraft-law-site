/**
 * 《我的世界》世界基本法典 —— Vercel Serverless 函数
 * 由 server/bundle-vercel.js 生成，请勿手改。
 *
 * 处理：GET /api/health  GET /api/law  GET|POST /api/search  POST /api/ask
 */
import { createRequire } from 'node:module';

import LAW from '../data/law.mjs';

const require = createRequire(import.meta.url);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

/* ══════════════ 内联自 server/kb.js ══════════════ */
/**
 * Law knowledge base: loading, tokenisation and BM25 retrieval.
 *
 * The corpus is Simplified Chinese with embedded Latin words and numbers. CJK
 * text has no whitespace, so a character-level index is used for CJK runs while
 * Latin words and digits stay whole tokens. That keeps recall high for short
 * queries such as "偷东西怎么判" without needing a segmenter dependency.
 */
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
  /**
   * @param {string|object} source 法典 JSON 的文件路径，或已解析好的数据对象
   *        （云函数没有文件系统，直接传对象；本地服务传路径）
   */
  constructor(source) {
    if (source && typeof source === 'object') {
      this.law = source;
      this.source = '(inline)';
    } else {
      this.law = JSON.parse(fs.readFileSync(source, 'utf8'));
      this.source = String(source);
    }
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


/* ══════════════ 内联自 server/answer.js ══════════════ */
/**
 * Grounded answer engine.
 *
 * Every answer is assembled from the statute text itself: the top BM25 hits are
 * split into sentences, the sentences that best answer the question are chosen,
 * and a citation list is attached. When an external OpenAI-compatible LLM is
 * configured the same retrieved context is handed to it as grounding, and the
 * extractive answer is used as the fallback whenever the provider fails.
 */
const SENT_SPLIT = /(?<=[。！？；])|\n+/;
const KINDS = [
  { id: 'penalty', label: '处罚与量刑', re: /(怎么|如何|怎样|什么|多少|几|多久|判|罚|处罚|量刑|惩罚|后果|责任|坐牢|封|流放|赔偿|钻石|小时|天)/ },
  { id: 'definition', label: '定义与构成', re: /(什么是|啥是|定义|算不算|属于|构成|是否|是不是|认定为|包括哪些|包含)/ },
  { id: 'procedure', label: '程序与救济', re: /(怎么起诉|如何起诉|上诉|申诉|流程|程序|证据|法院|举报|投诉|备案|申请)/ },
  { id: 'permission', label: '权限与职权', re: /(谁|哪个|哪一|负责|职权|权限|部门|职位|任命|层级|管辖)/ },
  { id: 'scope', label: '适用范围', re: /(哪里|哪些区域|适用|范围|一区|三区|全服)/ },
];

const GENERIC = /^(你好|您好|hi|hello|hey|在吗|嗨|哈喽|谢谢|感谢|多谢|再见|拜拜)[!！。~\s]*$/i;
const SOCIAL = [
  { re: /(你好|您好|hi|hello|hey|在吗|嗨|哈喽)/i,
    text: '你好，我是《我的世界》世界基本法典 G2.8 的智能法务助手。你可以问我任何条款问题，例如「偷东西怎么判」「一区能不能 PVP」「怎么起诉」——我会定位到具体条号并给出处罚标准。' },
  { re: /(你是谁|你是什么|介绍一下自己|你能做什么|会什么)/,
    text: '我是本站内置的法典助手，回答只依据《我的世界》世界基本法典 G2.8 正文（9 章 36 条 + 4 个附录与修订记录）。你可以直接提出事实性或程序性问题，我会引用条号、适用区域与处罚标准。' },
  { re: /^(谢谢|感谢|多谢|辛苦了)/,
    text: '不客气。如果还有条款疑问，继续问我即可；涉及具体案件定性时，最终裁定权在房主。' },
];

/** Split a document body into citable sentences with their source paragraph. */
function sentences(doc) {
  const out = [];
  (doc.paragraphs || []).forEach((p, pi) => {
    for (const raw of String(p).split(SENT_SPLIT)) {
      const s = raw.replace(/^[●◆▪▫•\s]+/, '').trim();
      if (s.length >= 4) out.push({ text: s, pi });
    }
  });
  return out;
}

function pickSentences(doc, terms, maxSentences = 4, maxChars = 420) {
  const sents = sentences(doc);
  if (!sents.length) return { picks: [], more: 0 };
  const scored = sents.map((s, idx) => {
    const toks = tokenize(s.text);
    const set = new Set(toks);
    let hit = 0;
    for (const t of terms) if (set.has(t)) hit += t.length >= 2 ? 1.8 : 1;
    const density = hit / Math.sqrt(s.text.length + 8);
    const boost = idx === 0 && s.pi === 0 ? 0.35 : 0;   // lead sentence matters
    return { ...s, idx, score: density + boost };
  });
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const picks = [];
  let chars = 0;
  for (const s of scored) {
    if (picks.length >= maxSentences || chars >= maxChars) break;
    if (s.score <= 0.02 && picks.length) continue;
    picks.push(s);
    chars += s.text.length;
  }
  picks.sort((a, b) => a.idx - b.idx);
  return { picks, more: Math.max(0, sents.length - picks.length) };
}

function classify(question) {
  let best = { id: 'general', label: '条款查询', score: 0 };
  for (const k of KINDS) {
    const m = question.match(new RegExp(k.re.source, 'g'));
    const score = m ? m.length : 0;
    if (score > best.score) best = { id: k.id, label: k.label, score };
  }
  return best;
}

function confidenceOf(top) {
  if (!top) return 'none';
  if (top.score >= 9) return 'high';
  if (top.score >= 4.5) return 'medium';
  return 'low';
}

/** Extract the statutory context window handed to an LLM. */
function buildContext(hits, maxChars = 6000) {
  const parts = [];
  let used = 0;
  for (const h of hits) {
    const d = h.doc;
    const head = `【${d.title}】${d.chapterTitle ? '（第' + d.chapterNo + '章 ' + d.chapterTitle + '）' : ''}` +
      (d.tags && d.tags.length ? '［' + d.tags.join('、') + '］' : '');
    const body = (d.paragraphs || []).join('\n');
    const chunk = head + '\n' + body;
    if (used + chunk.length > maxChars) break;
    parts.push(chunk);
    used += chunk.length;
  }
  return parts.join('\n\n');
}

class AnswerEngine {
  constructor(kb, options = {}) {
    this.kb = kb;
    this.options = options;
  }

  /** Deterministic, fully offline answer assembled from the statute. */
  compose(question) {
    const q = String(question || '').trim();
    if (!q) {
      return {
        answer: '请描述你的问题，例如「盗窃的处罚是什么」或「一区允许 PVP 吗」。',
        citations: [], confidence: 'none', intent: 'empty',
      };
    }

    for (const s of SOCIAL) {
      if (s.re.test(q)) {
        return {
          answer: s.text, citations: [], confidence: 'high', intent: 'social',
          suggestions: ['盗窃的处罚标准', '一区 PVP 规则', '谋权夺位罪怎么判', '怎么向法院起诉'],
        };
      }
    }

    const hits = this.kb.search(q, 6);
    const intent = classify(q);
    if (!hits.length) {
      return {
        answer: '在《我的世界》世界基本法典 G2.8 中没有找到与这个问题直接相关的条款。' +
          '可以换一种问法，或直接说明涉及的罪名、区域（全服 / 一区 / 三区）与场景；' +
          '若属于法典未覆盖的情形，最终由房主裁定。',
        citations: [], confidence: 'none', intent: intent.id,
        suggestions: ['刑罚种类有哪些', '量刑标准分几级', '追诉时效是多久', '紧急状态如何宣布'],
      };
    }

    const terms = tokenize(q);
    const top = hits[0];
    const confidence = confidenceOf(top);
    const blocks = [];
    const citations = [];
    const usedAnchors = new Set();

    const main = pickSentences(top.doc, terms, 5, 520);
    if (main.picks.length) {
      blocks.push({
        anchor: top.doc.anchor,
        title: top.doc.title,
        meta: [top.doc.chapterTitle && ('第' + top.doc.chapterNo + '章 ' + top.doc.chapterTitle),
               top.doc.sectionTitle, (top.doc.tags || []).join('、')].filter(Boolean).join(' · '),
        sentences: main.picks.map((s) => s.text),
        more: main.more,
      });
      usedAnchors.add(top.doc.anchor);
      citations.push(cite(top.doc, main.picks[0].text));
    }

    for (const h of hits.slice(1)) {
      if (usedAnchors.has(h.doc.anchor)) continue;
      if (h.score < top.score * 0.25 && blocks.length >= 2) break;
      const picked = pickSentences(h.doc, terms, 2, 220);
      if (!picked.picks.length) continue;
      blocks.push({
        anchor: h.doc.anchor,
        title: h.doc.title,
        meta: [h.doc.chapterTitle && ('第' + h.doc.chapterNo + '章 ' + h.doc.chapterTitle),
               h.doc.sectionTitle, (h.doc.tags || []).join('、')].filter(Boolean).join(' · '),
        sentences: picked.picks.map((s) => s.text),
        more: picked.more,
      });
      usedAnchors.add(h.doc.anchor);
      citations.push(cite(h.doc, picked.picks[0].text));
      if (blocks.length >= 3) break;
    }

    const lead =
      confidence === 'low'
        ? '没有找到与问题完全对应的条款，以下是最接近的规定，供参考：'
        : null;

    return {
      answer: blocks.map((b) => b.sentences.join('')).join('\n\n'),
      blocks, lead, citations, confidence, intent: intent.id,
      suggestions: this.suggest(q, hits),
    };
  }

  suggest(question, hits) {
    const out = [];
    for (const h of hits.slice(1, 5)) {
      if (h.doc.heading) out.push(h.doc.heading);
    }
    const extras = ['量刑标准分几级', '怎么向法院起诉', '谋权夺位罪的处罚', '一区建房补贴'];
    for (const e of extras) if (out.length < 3 && !out.includes(e)) out.push(e);
    return out.slice(0, 3);
  }

  /** Full answer: LLM when configured and reachable, extractive otherwise. */
  async answer(question, history = []) {
    const offline = this.compose(question);
    const provider = this.options.provider;
    if (!provider || !provider.enabled) {
      return { ...offline, engine: 'statute-retrieval' };
    }
    try {
      const hits = this.kb.search(question, 6);
      const context = buildContext(hits);
      const text = await callProvider(provider, question, context, history);
      if (text) {
        return {
          answer: text,
          blocks: offline.blocks,
          lead: null,
          citations: offline.citations,
          confidence: offline.confidence,
          intent: offline.intent,
          suggestions: offline.suggestions,
          engine: provider.label || 'llm',
        };
      }
    } catch (err) {
      this.lastError = err.message;
    }
    return { ...offline, engine: 'statute-retrieval', degraded: Boolean(provider.enabled) };
  }
}

function cite(doc, quote) {
  return {
    anchor: doc.anchor,
    title: doc.title,
    kind: doc.kind,
    chapterNo: doc.chapterNo,
    chapterTitle: doc.chapterTitle,
    sectionTitle: doc.sectionTitle,
    tags: doc.tags || [],
    quote: String(quote || '').slice(0, 160),
  };
}

const SYSTEM_PROMPT =
  '你是《我的世界》Minecraft 服务器法典的官方问答助手。只能依据下面提供的法典条文回答，' +
  '不得编造条号、处罚金额或程序。回答要求：先给结论，再给依据（引用条号，例如「第二条」「第三十六条」），' +
  '涉及区域差异时说明「全服通用 / 一区专属 / 三区专属」。若条文未覆盖，明确说明并提示最终解释权归房主。' +
  '使用简体中文，语气简洁、克制，不要使用 Markdown 表格。';

async function callProvider(provider, question, context, history) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT + '\n\n【法典条文】\n' + context }];
  for (const h of (history || []).slice(-6)) {
    if (h.role && h.content) messages.push({ role: h.role, content: String(h.content).slice(0, 2000) });
  }
  messages.push({ role: 'user', content: question });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), provider.timeoutMs || 30000);
  try {
    const res = await fetch(provider.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + provider.apiKey,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: provider.temperature == null ? 0.2 : provider.temperature,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('provider HTTP ' + res.status);
    const json = await res.json();
    const text = json && json.choices && json.choices[0] &&
      json.choices[0].message && json.choices[0].message.content;
    return text ? String(text).trim() : '';
  } finally {
    clearTimeout(timer);
  }
}



/* ══════════════════════════ 入口 ══════════════════════════ */
const kb = new KnowledgeBase(LAW);
const engine = new AnswerEngine(kb, {
  provider: process.env.LAW_LLM_API_KEY ? {
    enabled: true,
    label: 'llm',
    apiKey: process.env.LAW_LLM_API_KEY,
    baseUrl: process.env.LAW_LLM_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.LAW_LLM_MODEL || 'deepseek-chat',
    temperature: 0.2,
    timeoutMs: 30000,
  } : { enabled: false },
});

function send(res, status, body) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 262144) req.destroy(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const route = url.pathname.replace(/^\/api\/?/, '') || 'health';

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    return res.end();
  }

  try {
    if (route === 'health') {
      return send(res, 200, {
        ok: true,
        articles: kb.articleList().length,
        docs: kb.docs.length,
        engine: process.env.LAW_LLM_API_KEY ? 'llm' : 'statute-retrieval',
        version: LAW.version,
        date: LAW.date,
        access: [],
      });
    }

    if (route === 'law') return send(res, 200, LAW);

    if (route === 'search') {
      let q = url.searchParams.get('q') || '';
      let limit = Number(url.searchParams.get('limit') || 8);
      if (req.method === 'POST') {
        const body = await readBody(req);
        q = String(body.query || q);
        limit = Number(body.limit || limit);
      }
      limit = Math.min(20, limit || 8);
      return send(res, 200, {
        query: q,
        results: kb.search(q, limit).map((h) => ({
          anchor: h.doc.anchor, title: h.doc.title, kind: h.doc.kind,
          chapterTitle: h.doc.chapterTitle, tags: h.doc.tags, score: h.score,
          excerpt: (h.doc.paragraphs || []).join(' ').slice(0, 180),
        })),
      });
    }

    if (route === 'ask') {
      if (req.method !== 'POST') return send(res, 405, { error: 'use POST' });
      const body = await readBody(req);
      const question = String(body.question || '').slice(0, 1000);
      if (!question.trim()) return send(res, 400, { error: 'question is required' });
      const started = Date.now();
      const result = await engine.answer(question, Array.isArray(body.history) ? body.history : []);
      return send(res, 200, {
        ...result,
        question,
        elapsedMs: Date.now() - started,
        retrieved: kb.search(question, 4).map((h) => ({
          anchor: h.doc.anchor, title: h.doc.title, score: h.score,
        })),
      });
    }

    return send(res, 404, { error: 'unknown endpoint: ' + route });
  } catch (err) {
    return send(res, 500, { error: err.message || 'internal error' });
  }
}
