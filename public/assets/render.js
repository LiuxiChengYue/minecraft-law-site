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
        var base = t.length >= 2 ? 3.4 : 0.9;
        score += Math.min(hits, 6) * base * idf(t);
        if (titleHay.indexOf(t) !== -1) score += base * 6 * idf(t);
      });
      if (score <= 0) return;
      if (zone && d.tags.length) score *= d.tags.indexOf(zone) !== -1 ? 1.7 : 0.5;
      // a Latin/technical key that appears in the heading is the strongest signal
      var head = (d.title + ' ' + d.heading).toLowerCase();
      terms.forEach(function (t) {
        if (t.length >= 3 && head.indexOf(t) !== -1) score *= 2.2;
      });
      if (d.kind === 'article') score *= 1.15;
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

  return {
    SYNONYMS: SYNONYMS, esc: esc, fmt: fmt, highlight: highlight,
    buildIndex: buildIndex, expand: expand, search: search, excerpt: excerpt,
    matchesTag: matchesTag, articleHtml: articleHtml, tocHtml: tocHtml, lawHtml: lawHtml,
  };
}));
