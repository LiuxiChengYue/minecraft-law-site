/* ==========================================================================
   纯渲染与检索函数（浏览器与 Node 共用，便于自动化测试）
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DSH_LAW_RENDER = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SYNONYMS = {
    '杀人': ['恶意杀人', '击杀', '人身安全', 'PVP'], '击杀': ['恶意杀人', '禁止直杀'],
    '偷': ['盗窃', '未获批取用'], '偷东西': ['盗窃', '盗窃罪'], '抢': ['盗窃', '侵占'],
    '破坏': ['恶意破坏', '公共设施'], '炸': ['爆炸', 'TNT', '危害公共安全'],
    '外挂': ['作弊', '三级极刑'], '作弊': ['外挂'], '卡服': ['崩服', '危害公共安全'],
    '红石': ['红石违规', '存档健康保护'], '判': ['处罚', '量刑'], '判罚': ['量刑标准'],
    '罚款': ['罚金'], '坐牢': ['监禁'], '封号': ['永久封禁'], '流放': ['永久流放'],
    '上诉': ['上诉权', '再审'], '起诉': ['诉讼程序'], '告': ['起诉', '诉讼程序'],
    '证据': ['证据规则', '物证', '书证'], '房主': ['房主最高权限'], '权限': ['准入权限'],
    '官员': ['公务人员', '职权'], '职位': ['公务职位', '权力层级'], '税': ['税收'],
    '钱': ['货币', '钻石本位制'], '汇率': ['货币与汇率制度'], '土地': ['领土'],
    '房子': ['建筑', '建筑规范'], '建房': ['建筑规范', '建房补贴'], '补贴': ['建房补贴'],
    '地铁': ['地铁建设专项规则'], '环境': ['环境维护义务'], '稀有资源': ['龙蛋', '鞘翅'],
    '紧急': ['紧急状态法', '紧急权'], '谋权': ['谋权夺位'], '篡位': ['谋权夺位'],
    '时效': ['追诉时效'], '累犯': ['累犯认定标准'], '自卫': ['自卫权', '防卫过当'],
    '守尸': ['恶意守尸'], '一区': ['一区专属'], '三区': ['三区专属'], '全服': ['全服通用']
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Emphasis inside statute text: 【…】 area markers and "罪名：" labels. */
  function fmt(s) {
    return esc(s)
      .replace(/【([^】]{1,14})】/g, '<strong>【$1】</strong>')
      .replace(/([\u4e00-\u9fffA-Za-z0-9]{2,12}：)/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function highlight(s, terms) {
    var out = esc(s);
    (terms || []).slice(0, 6).forEach(function (t) {
      if (!t || t.length < 2) return;
      var safe = String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try { out = out.replace(new RegExp(safe, 'g'), '<mark>$&</mark>'); } catch (e) {}
    });
    return out;
  }

  function buildIndex(LAW) {
    var docs = [];
    var mk = function (kind, a, ch, sec) {
      var paras = (a.paragraphs || []).map(function (p) { return p.text || p; });
      var text = paras.join('\n');
      docs.push({
        kind: kind,
        anchor: a.anchor,
        title: a.title,
        heading: a.heading || '',
        tags: a.tags || [],
        chapterNo: ch.no,
        chapterTitle: ch.title,
        sectionTitle: sec ? sec.title : '',
        paragraphs: paras,
        text: text,
        hay: (a.title + ' ' + (a.heading || '') + ' ' + (a.tags || []).join(' ') + ' ' +
          ch.title + ' ' + text).toLowerCase()
      });
    };
    (LAW.chapters || []).forEach(function (ch) {
      (ch.articles || []).forEach(function (a) { mk('article', a, ch, null); });
      (ch.sections || []).forEach(function (sec) {
        (sec.articles || []).forEach(function (a) { mk('article', a, ch, sec); });
        if (sec.paragraphs && sec.paragraphs.length) {
          mk('section', {
            anchor: 'sec-' + ch.no + '-' + sec.no,
            title: '第' + sec.no + '节 ' + sec.title,
            heading: sec.title, tags: [], paragraphs: sec.paragraphs
          }, ch, sec);
        }
      });
    });
    (LAW.appendices || []).forEach(function (ap) {
      mk('appendix', {
        anchor: 'app-' + ap.no, title: '附录' + ap.no + ' ' + ap.title,
        heading: ap.title, tags: [], paragraphs: ap.paragraphs
      }, { no: '', title: '附录' }, null);
    });
    return docs;
  }

  function expand(query) {
    var terms = [];
    var lower = String(query || '').toLowerCase().trim();
    if (!lower) return terms;
    lower.split(/\s+/).forEach(function (w) { if (w) terms.push(w); });
    // "一区可以PVP吗" -> the Latin/technical part is a strong signal on its own
    (lower.match(/[a-z0-9_]{2,}/g) || []).forEach(function (w) { terms.push(w); });
    Object.keys(SYNONYMS).forEach(function (k) {
      if (lower.indexOf(k) !== -1) SYNONYMS[k].forEach(function (s) { terms.push(s.toLowerCase()); });
    });
    (lower.match(/[\u4e00-\u9fff]{3,}/g) || []).forEach(function (run) {
      for (var i = 0; i + 1 < run.length; i++) terms.push(run.slice(i, i + 2));
    });
    return terms;
  }

  function search(docs, query, limit) {
    var terms = expand(query);
    if (!terms.length) return [];
    // document frequency -> rare terms (names, 罪名) weigh more than 一/区
    var df = {};
    docs.forEach(function (d) {
      var seen = {};
      terms.forEach(function (t) {
        if (!t || seen[t]) return;
        if (d.hay.indexOf(t) !== -1) { df[t] = (df[t] || 0) + 1; seen[t] = 1; }
      });
    });
    var N = docs.length || 1;
    var idf = function (t) { return Math.log(1 + N / (1 + (df[t] || 0))); };
    var zone = query.indexOf('一区') !== -1 ? '一区专属'
      : (query.indexOf('三区') !== -1 ? '三区专属'
        : (query.indexOf('全服') !== -1 ? '全服通用' : null));
    var seenAnchor = {};
    var results = [];
    docs.forEach(function (d) {
      var score = 0;
      var titleHay = (d.title + ' ' + d.heading).toLowerCase();
      terms.forEach(function (t) {
        if (!t) return;
        var hits = d.hay.split(t).length - 1;
        if (!hits) return;
        // 词频饱和：命中 1 次已经说明问题，重复出现不该线性加分
        var base = t.length >= 2 ? 2.6 : 0.35;
        var saturation = hits / (hits + 2.2);
        score += saturation * 6.5 * base * idf(t);
        // 命中标题是最强信号
        if (titleHay.indexOf(t) !== -1) score += base * 5.5 * idf(t);
      });
      if (score <= 0) return;
      if (zone && d.tags.length) score *= d.tags.indexOf(zone) !== -1 ? 1.7 : 0.5;
      // a Latin/technical key that appears in the heading is the strongest signal
      var head = (d.title + ' ' + d.heading).toLowerCase();
      terms.forEach(function (t) {
        if (t.length >= 3 && head.indexOf(t) !== -1) score *= 2.2;
      });
      // 条文优先于附录：附录是速查表，几乎含所有罪名，词频上天然占便宜
      if (d.kind === 'article') score *= 1.35;
      else if (d.kind === 'appendix') score *= 0.45;
      else if (d.kind === 'chapter') score *= 0.7;
      if (!seenAnchor[d.anchor]) { seenAnchor[d.anchor] = 1; results.push({ doc: d, score: score }); }
    });
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, limit || 8);
  }

  function excerpt(d, terms) {
    var q = (terms || [])[0] || '';
    var hay = d.text;
    var at = q ? hay.toLowerCase().indexOf(String(q).toLowerCase()) : -1;
    if (at < 0) return hay.slice(0, 150);
    var start = Math.max(0, at - 42);
    return (start > 0 ? '…' : '') + hay.slice(start, start + 165);
  }

  function matchesTag(a, tag) {
    return !tag || (a.tags || []).indexOf(tag) !== -1;
  }

  function paragraphHtml(p) {
    var kind = (p && p.kind) || 'text';
    var cls = kind === 'bullet' ? 'is-bullet'
      : (kind === 'item' || kind === 'label' ? 'is-item' : '');
    return '<p class="' + cls + '">' + fmt((p && p.text) || p || '') + '</p>';
  }

  function articleHtml(a, anchor, plain, tag) {
    var hidden = matchesTag(a, tag) ? '' : ' hidden';
    var label = plain
      ? '附录' + String(a.title || '').replace(/^附录/, '').split(' ')[0]
      : '第' + a.no + '条' + (a.suffix || '');
    var heading = a.heading || String(a.title || '').replace(/^第[^ ]+条[^ ]*\s*/, '');
    return '<article class="article' + (plain ? ' appendix-item' : '') + '" id="' + esc(anchor) +
      '" data-anchor="' + esc(anchor) + '" data-tags="' + esc((a.tags || []).join(',')) + '"' + hidden + '>' +
      '<div class="article-head">' +
      '<span class="article-no">' + esc(label) + '</span>' +
      '<h3>' + esc(heading) + '</h3>' +
      (a.tags || []).map(function (t) {
        return '<span class="tag tag-' + esc(t) + '">' + esc(t) + '</span>';
      }).join('') +
      '</div><div class="paras">' +
      (a.paragraphs || []).map(paragraphHtml).join('') +
      '</div></article>';
  }

  function tocHtml(LAW) {
    var html = (LAW.chapters || []).map(function (ch) {
      var out = '<div class="toc-ch" data-ch="ch-' + esc(ch.no) + '">' +
        '<a href="#/law/ch-' + esc(ch.no) + '">第' + esc(ch.no) + '章 ' + esc(ch.title) + '</a>';
      (ch.articles || []).forEach(function (a) {
        out += '<a class="toc-art" href="#/law/' + esc(a.anchor) + '">' + esc(a.title) + '</a>';
      });
      (ch.sections || []).forEach(function (sec) {
        out += '<div class="toc-sec"><span>第' + esc(sec.no) + '节 ' + esc(sec.title) + '</span></div>';
        (sec.articles || []).forEach(function (a) {
          out += '<a class="toc-art" href="#/law/' + esc(a.anchor) + '">' + esc(a.title) + '</a>';
        });
      });
      return out + '</div>';
    }).join('');
    html += '<div class="toc-ch"><a href="#/law/app-一">附录</a>' +
      (LAW.appendices || []).map(function (ap) {
        return '<a class="toc-art" href="#/law/app-' + esc(ap.no) + '">附录' + esc(ap.no) + ' ' +
          esc(ap.title) + '</a>';
      }).join('') + '</div>';
    return html;
  }

  function lawHtml(LAW, tag) {
    var html = '';
    (LAW.chapters || []).forEach(function (ch) {
      html += '<section class="chapter" id="ch-' + esc(ch.no) + '">' +
        '<header class="chapter-head"><div class="ch-kicker">CHAPTER ' + esc(ch.no) + '</div>' +
        '<h2>第' + esc(ch.no) + '章 ' + esc(ch.title) + '</h2>' +
        ((ch.paragraphs || []).length
          ? '<div class="chapter-preamble">' + ch.paragraphs.map(paragraphHtml).join('') + '</div>' : '') +
        '</header>';
      (ch.articles || []).forEach(function (a) {
        html += articleHtml(a, 'art-' + a.no + (a.suffix || ''), false, tag);
      });
      (ch.sections || []).forEach(function (sec) {
        html += '<h3 class="section-head" id="sec-' + esc(ch.no) + '-' + esc(sec.no) + '">第' +
          esc(sec.no) + '节 ' + esc(sec.title) + '</h3>';
        (sec.articles || []).forEach(function (a) {
          html += articleHtml(a, 'art-' + a.no + (a.suffix || ''), false, tag);
        });
      });
      html += '</section>';
    });
    html += '<section class="appendix" id="app-一"><header class="chapter-head appendix-head">' +
      '<div class="ch-kicker">APPENDIX</div><h2>附录</h2></header>';
    (LAW.appendices || []).forEach(function (ap) {
      html += articleHtml({
        anchor: 'app-' + ap.no, title: '附录' + ap.no + ' ' + ap.title,
        heading: ap.title, tags: [], paragraphs: ap.paragraphs
      }, 'app-' + ap.no, true, tag);
    });
    return html + '</section>';
  }

  /* ───────────── 纯浏览器端的条文化问答（无后端时使用） ───────────── */

  var STOP = '的了是我你他她它们这那有和与及或在为对会能可要就都也很不没吗呢吧啊把被让给从到个之其所以并请问一下怎么如何什么哪些哪位告诉想要知道么样嘛呀哦嗯';

  function tok(text) {
    var out = [];
    var s = String(text || '').toLowerCase();
    var latin = s.match(/[a-z0-9_]+/g) || [];
    for (var i = 0; i < latin.length; i++) out.push(latin[i]);
    var ch;
    for (var j = 0; j < s.length; j++) {
      ch = s.charAt(j);
      if (/[\u3400-\u9fff]/.test(ch) && STOP.indexOf(ch) === -1) out.push(ch);
    }
    var runs = s.match(/[\u3400-\u9fff]+/g) || [];
    for (var k = 0; k < runs.length; k++) {
      for (var m = 0; m + 1 < runs[k].length; m++) {
        var bg = runs[k].slice(m, m + 2);
        if (STOP.indexOf(bg.charAt(0)) === -1 && STOP.indexOf(bg.charAt(1)) === -1) out.push(bg);
      }
    }
    return out;
  }

  /** 把条文正文切成可引用的句子 */
  function sentencesOf(doc) {
    var out = [];
    var parts = doc.paragraphs || [];
    for (var i = 0; i < parts.length; i++) {
      var pieces = String(parts[i]).split(/(?<=[。！？；])/);
      for (var j = 0; j < pieces.length; j++) {
        var s = pieces[j].replace(/^[●◆▪▫•\s]+/, '').trim();
        if (s.length >= 4) out.push({ text: s, pi: i });
      }
    }
    return out;
  }

  var SOCIAL = [
    { re: /(你好|您好|hi|hello|hey|在吗|嗨|哈喽)/i,
      text: '你好，我是《我的世界》世界基本法典 G2.8 的智能法务助手。你可以问我任何条款问题，' +
        '例如「偷东西怎么判」「一区能不能 PVP」「怎么起诉」——我会定位到具体条号并给出处罚标准。' },
    { re: /(你是谁|你是什么|介绍一下自己|你能做什么)/,
      text: '我是本站内置的法典助手，回答只依据《我的世界》世界基本法典 G2.8 正文（9 章 36 条 + 附录）。' },
    { re: /^(谢谢|感谢|多谢|辛苦了)/,
      text: '不客气。还有条款疑问继续问我即可；涉及具体案件定性时，最终裁定权在房主。' },
  ];

  var KIND_RULES = [
    { id: 'penalty', re: /(怎么|如何|怎样|什么|多少|几|多久|判|罚|处罚|量刑|惩罚|后果|责任|坐牢|封|流放|赔偿|钻石|小时|天)/ },
    { id: 'definition', re: /(什么是|啥是|定义|算不算|属于|构成|是否|是不是|认定为|包括哪些|包含)/ },
    { id: 'procedure', re: /(起诉|上诉|申诉|流程|程序|证据|法院|举报|投诉|备案|申请)/ },
    { id: 'permission', re: /(谁|哪个|哪一|负责|职权|权限|部门|职位|任命|层级|管辖)/ },
    { id: 'scope', re: /(哪里|哪些区域|适用|范围|一区|三区|全服)/ },
  ];

  function classify(q) {
    var best = 'general';
    var bestScore = 0;
    for (var i = 0; i < KIND_RULES.length; i++) {
      var m = q.match(new RegExp(KIND_RULES[i].re.source, 'g'));
      var score = m ? m.length : 0;
      if (score > bestScore) { bestScore = score; best = KIND_RULES[i].id; }
    }
    return best;
  }

  function pickSentences(doc, terms, maxSentences, maxChars) {
    var sents = sentencesOf(doc);
    var scored = [];
    for (var i = 0; i < sents.length; i++) {
      var set = {};
      var toks = tok(sents[i].text);
      for (var j = 0; j < toks.length; j++) set[toks[j]] = 1;
      var hit = 0;
      for (var k = 0; k < terms.length; k++) {
        if (set[terms[k]]) hit += terms[k].length >= 2 ? 1.8 : 1;
      }
      scored.push({
        text: sents[i].text,
        idx: i,
        score: hit / Math.sqrt(sents[i].text.length + 8) + (i === 0 ? 0.35 : 0),
      });
    }
    scored.sort(function (a, b) { return b.score - a.score || a.idx - b.idx; });
    var picks = [];
    var chars = 0;
    for (var n = 0; n < scored.length; n++) {
      if (picks.length >= maxSentences || chars >= maxChars) break;
      if (scored[n].score <= 0.02 && picks.length) continue;
      picks.push(scored[n]);
      chars += scored[n].text.length;
    }
    picks.sort(function (a, b) { return a.idx - b.idx; });
    return { picks: picks, more: Math.max(0, sents.length - picks.length) };
  }

  /**
   * 在没有后端的情况下，用与服务器相同的方式组装回答：
   * 检索 → 从句 → 引用。返回结构与 /api/ask 一致，前端无需区分。
   */
  function answerLocally(LAW, question) {
    var q = String(question || '').trim();
    if (!q) {
      return { answer: '请描述你的问题。', blocks: [], citations: [],
        confidence: 'none', intent: 'empty', suggestions: [], engine: 'browser' };
    }
    for (var i = 0; i < SOCIAL.length; i++) {
      if (SOCIAL[i].re.test(q)) {
        return { answer: SOCIAL[i].text, blocks: [], citations: [],
          confidence: 'high', intent: 'social', engine: 'browser',
          suggestions: ['盗窃的处罚标准', '一区 PVP 规则', '谋权夺位罪怎么判', '怎么向法院起诉'] };
      }
    }

    var docs = buildIndex(LAW);
    var hits = search(docs, q, 6);
    var intent = classify(q);
    if (!hits.length) {
      return {
        answer: '在《我的世界》世界基本法典 G2.8 中没有找到与这个问题直接相关的条款。' +
          '可以换一种问法，或说明涉及的罪名、区域（全服 / 一区 / 三区）与场景；' +
          '若属于法典未覆盖的情形，最终由房主裁定。',
        blocks: [], citations: [], confidence: 'none', intent: intent, engine: 'browser',
        suggestions: ['刑罚种类有哪些', '量刑标准分几级', '追诉时效是多久', '紧急状态如何宣布'],
      };
    }

    var terms = expand(q);
    var top = hits[0];
    var confidence = top.score >= 9 ? 'high' : (top.score >= 4.5 ? 'medium' : 'low');
    var blocks = [];
    var citations = [];
    var used = {};

    var main = pickSentences(top.doc, terms, 5, 520);
    if (main.picks.length) {
      blocks.push({
        anchor: top.doc.anchor, title: top.doc.title,
        meta: [top.doc.chapterTitle, top.doc.sectionTitle,
          (top.doc.tags || []).join('、')].filter(Boolean).join(' · '),
        sentences: main.picks.map(function (s) { return s.text; }), more: main.more,
      });
      used[top.doc.anchor] = 1;
      citations.push({
        anchor: top.doc.anchor, title: top.doc.title, kind: top.doc.kind,
        chapterTitle: top.doc.chapterTitle, sectionTitle: top.doc.sectionTitle,
        tags: top.doc.tags || [], quote: main.picks[0].text.slice(0, 160),
      });
    }

    for (var h = 1; h < hits.length && blocks.length < 3; h++) {
      if (used[hits[h].doc.anchor]) continue;
      if (hits[h].score < top.score * 0.25 && blocks.length >= 2) break;
      var picked = pickSentences(hits[h].doc, terms, 2, 220);
      if (!picked.picks.length) continue;
      blocks.push({
        anchor: hits[h].doc.anchor, title: hits[h].doc.title,
        meta: [hits[h].doc.chapterTitle, hits[h].doc.sectionTitle,
          (hits[h].doc.tags || []).join('、')].filter(Boolean).join(' · '),
        sentences: picked.picks.map(function (s) { return s.text; }), more: picked.more,
      });
      used[hits[h].doc.anchor] = 1;
      citations.push({
        anchor: hits[h].doc.anchor, title: hits[h].doc.title, kind: hits[h].doc.kind,
        chapterTitle: hits[h].doc.chapterTitle, sectionTitle: hits[h].doc.sectionTitle,
        tags: hits[h].doc.tags || [], quote: picked.picks[0].text.slice(0, 160),
      });
    }

    var suggestions = [];
    for (var s = 1; s < hits.length && suggestions.length < 3; s++) {
      if (hits[s].doc.heading) suggestions.push(hits[s].doc.heading);
    }
    ['量刑标准分几级', '怎么向法院起诉', '谋权夺位罪的处罚', '一区建房补贴'].forEach(function (e) {
      if (suggestions.length < 3 && suggestions.indexOf(e) === -1) suggestions.push(e);
    });

    return {
      answer: blocks.map(function (b) { return b.sentences.join(''); }).join('\n\n'),
      blocks: blocks,
      lead: confidence === 'low' ? '没有找到与问题完全对应的条款，以下是最接近的规定，供参考：' : null,
      citations: citations, confidence: confidence, intent: intent,
      suggestions: suggestions, engine: 'browser',
    };
  }

  return {
    SYNONYMS: SYNONYMS, esc: esc, fmt: fmt, highlight: highlight,
    buildIndex: buildIndex, expand: expand, search: search, excerpt: excerpt,
    matchesTag: matchesTag, articleHtml: articleHtml, tocHtml: tocHtml, lawHtml: lawHtml,
    answerLocally: answerLocally, sentencesOf: sentencesOf, tokenize: tok,
  };
}));
