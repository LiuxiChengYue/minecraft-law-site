/**
 * Grounded answer engine.
 *
 * Every answer is assembled from the statute text itself: the top BM25 hits are
 * split into sentences, the sentences that best answer the question are chosen,
 * and a citation list is attached. When an external OpenAI-compatible LLM is
 * configured the same retrieved context is handed to it as grounding, and the
 * extractive answer is used as the fallback whenever the provider fails.
 */
'use strict';

const { tokenize } = require('./kb');

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

module.exports = { AnswerEngine, buildContext, sentences, classify };
