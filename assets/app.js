/* ==========================================================================
   《我的世界》世界基本法典 · 前端应用
   零依赖：hash 路由 + 本地检索 + 服务端 grounded 问答。
   ========================================================================== */
(function () {
  'use strict';

  var LAW = window.__LAW__ || null;
  var R = window.DSH_LAW_RENDER;
  var LLM = window.DSH_LLM;
  // 允许把 AI 问答指向另一个后端（静态托管 + 独立 API 时使用）
  var API_BASE = (window.__API_BASE__ || '').replace(/\/$/, '');
  var api = function (p) { return API_BASE + p; };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = R.esc, fmt = R.fmt, highlight = R.highlight, expand = R.expand, excerpt = R.excerpt;

  var state = {
    view: 'home',
    tag: '',
    query: '',
    hits: [],
    hitIndex: 0,
    chat: [],          // { role: 'user'|'assistant', text, citations, engine, lead, streaming }
    busy: false,
    llm: null,         // 大模型配置（自带密钥），null 表示使用内置引擎
  };

  /* ─────────────────────────── 本地检索 ─────────────────────────── */

  var index = null;

  function buildIndex() {
    index = { docs: R.buildIndex(LAW || { chapters: [], appendices: [] }) };
  }

  function search(query, limit) {
    return R.search(index.docs, query, limit);
  }

  /* ─────────────────────────── 视图切换 ─────────────────────────── */

  function setView(view) {
    state.view = view;
    document.body.dataset.view = view;
    ['home', 'law', 'ask'].forEach(function (v) {
      var el = $('#view-' + v);
      if (el) el.hidden = v !== view;
    });
    $$('.nav a').forEach(function (a) {
      a.classList.toggle('is-active', a.dataset.nav === view);
    });
    if (view === 'ask') {
      setTimeout(function () { var i = $('#chat-input'); if (i && window.innerWidth > 700) i.focus(); }, 60);
    }
  }

  function parseHash() {
    var h = (location.hash || '#/').replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    if (!parts.length) return { view: 'home' };
    if (parts[0] === 'law') return { view: 'law', anchor: parts[1] ? decodeURIComponent(parts[1]) : '' };
    if (parts[0] === 'ask') return { view: 'ask', q: parts[1] ? decodeURIComponent(parts[1]) : '' };
    return { view: 'home' };
  }

  function route() {
    var r = parseHash();
    setView(r.view);
    if (r.view === 'law') {
      if (r.anchor) focusArticle(r.anchor);
      else window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    } else if (r.view === 'ask' && r.q) {
      var input = $('#chat-input');
      if (input) input.value = r.q;
      send(r.q);
      location.hash = '#/ask';
    } else {
      window.scrollTo(0, 0);
    }
  }

  function focusArticle(anchor) {
    var el = document.getElementById(anchor);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    el.classList.add('is-flash');
    setTimeout(function () { el.classList.remove('is-flash'); }, 1800);
    $$('.toc-art').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('href') === '#/law/' + anchor);
    });
  }

  /* ─────────────────────────── 渲染：首页 ─────────────────────────── */

  var FAQ = [
    {
      q: '盗窃会怎么处理？',
      a: '第九条对私有财产实行「三次机会」阶梯处罚：第一次书面警告并责令归还赔偿；第二次处被盗物品价值三至五倍钻石罚金；第三次逐出一区（永久剥夺一区准入权限，适用永久流放标准）。数额巨大、团伙盗窃、破坏存档、屡教不改的不受三次限制，直接按二级重罪及以上顶格处理。',
      cite: ['art-九', 'art-二']
    },
    {
      q: '一区可以 PVP 吗？',
      a: '一区原则上禁止直接攻击其他玩家，只有法院指定的决斗竞技场或双方明确约定的 PVP 才被允许；禁止利用打火石、熔岩、末影水晶、陷阱等方式间接谋杀。三区不适用禁止直杀的规定，允许自由 PVP。',
      cite: ['art-四', 'art-八']
    },
    {
      q: '使用外挂会有什么后果？',
      a: '第六条把外挂与作弊列为危害公共安全罪：造成服务器损失、他人财产损失或存档损坏的，由开挂者承担全部赔偿责任，并处三级极刑顶格处罚。',
      cite: ['art-六']
    },
    {
      q: '怎么向法院起诉？',
      a: '原告向法院提交起诉状，写明被告 ID、罪名、事实与证据，并缴纳 8 铁锭（0.25 钻石）诉讼费用；法院受理后向被告送达副本，庭审结束后 24 小时内作出判决。对一审判决不服的，可在公示之日起 48 小时内向世界法院上诉。',
      cite: ['art-二十一', 'art-二十']
    },
    {
      q: '谋权夺位罪怎么判？',
      a: '这是本法典第一重罪，一律按三级极刑顶格处罚，附加「诛九族」式全链条追责，不适用从轻、减轻、免罚情节，也不受追诉时效限制；主犯永久封禁并没收全部个人资产。',
      cite: ['art-三之一']
    }
  ];

  var HERO_CHIPS = ['偷东西怎么判', '一区可以 PVP 吗', '使用外挂的后果', '怎么向法院起诉', '谋权夺位罪'];

  function renderHome() {
    if (!LAW) return;
    $('#hero-version').textContent = LAW.version;
    $('#brand-version').textContent = LAW.version;
    $('#foot-meta').textContent = LAW.version + ' · ' + LAW.date;

    var arts = (LAW.index || []).length;
    var chars = (LAW.stats && LAW.stats.chars) || 0;
    $('#hero-stats').innerHTML = [
      ['章节', LAW.chapters.length, '章'],
      ['条文', arts, '条'],
      ['附录', LAW.appendices.length, '份'],
      ['正文字数', (chars / 10000).toFixed(1), '万字'],
    ].map(function (s) {
      return '<div><dd>' + s[1] + '<small>' + s[2] + '</small></dd><dt>' + s[0] + '</dt></div>';
    }).join('');

    $('#hero-chips').innerHTML = HERO_CHIPS.map(function (q) {
      return '<button class="chip" type="button" data-ask="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('');

    $('#chapter-grid').innerHTML = LAW.chapters.map(function (ch, i) {
      var n = (ch.articles || []).length + (ch.sections || []).reduce(function (s, x) {
        return s + (x.articles || []).length;
      }, 0);
      var first = (ch.articles && ch.articles[0]) ||
        (ch.sections && ch.sections[0] && ch.sections[0].articles[0]);
      return '<li><a href="#/law/' + esc(first ? first.anchor : 'ch-' + ch.no) + '">' +
        '<span class="ch-no">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="ch-title">' + esc(ch.title) + '</span>' +
        '<span class="ch-meta">' + n + ' 条</span></a></li>';
    }).join('');

    $('#faq-list').innerHTML = FAQ.map(function (f, i) {
      return '<details' + (i === 0 ? ' open' : '') + '><summary>' + esc(f.q) + '</summary>' +
        '<div class="faq-a">' + fmt(f.a) + '<div class="cite-row">' +
        f.cite.map(function (a) {
          var art = findArticle(a);
          if (!art) return '';
          return '<button class="chip" type="button" data-goto="' + esc(a) + '">' +
            '<span class="chip-mark">§</span>' + esc(art.title) + '</button>';
        }).join(' ') + '</div></div></details>';
    }).join('');

    var tips = (LAW.index || []).slice(0, 6).map(function (a) { return a.heading; }).filter(Boolean);
    $('#ask-chips').innerHTML = tips.concat(HERO_CHIPS.slice(0, 2)).slice(0, 8).map(function (q) {
      return '<button class="chip" type="button" data-ask="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('');
  }

  function findArticle(anchor) {
    return (LAW.index || []).filter(function (a) { return a.anchor === anchor; })[0] || null;
  }

  /* ─────────────────────────── 渲染：法典全文 ─────────────────────────── */
  function renderToc() {
    $("#toc").innerHTML = R.tocHtml(LAW);
  }

  function renderLaw() {
    if (!LAW) return;
    $("#law-body").innerHTML = R.lawHtml(LAW, state.tag);
    applyFilter();
  }

  function matchesTag(a) { return R.matchesTag(a, state.tag); }

  function articleHtml(a, anchor, plain) { return R.articleHtml(a, anchor, plain, state.tag); }


  function applyFilter() {
    var shown = 0;
    $$('#law-body .article').forEach(function (el) {
      var tags = (el.dataset.tags || '').split(',').filter(Boolean);
      var ok = !state.tag || tags.indexOf(state.tag) !== -1;
      el.hidden = !ok;
      if (ok) shown++;
    });
    $$('#law-body .chapter').forEach(function (ch) {
      var any = $$('.article', ch).some(function (a) { return !a.hidden; });
      ch.hidden = !any;
    });
    $$('#law-body .section-head').forEach(function (h) {
      var next = h.nextElementSibling;
      var any = false;
      while (next && !next.classList.contains('section-head')) {
        if (next.classList.contains('article') && !next.hidden) any = true;
        next = next.nextElementSibling;
      }
      h.hidden = !any;
    });
    $('#law-count').textContent = state.tag
      ? state.tag + ' · ' + shown + ' 条'
      : '共 ' + shown + ' 条 · ' + LAW.chapters.length + ' 章';
  }

  /* ─────────────────────────── 渲染：问答 ─────────────────────────── */

  function renderChat() {
    var thread = $('#thread');
    if (!state.chat.length) {
      thread.innerHTML = '<div class="msg msg-ai"><div class="avatar">法</div><div class="msg-body">' +
        '<div class="msg-who">AI 法务助手</div>' +
        '<div class="msg-text"><p>你好。我只会依据《我的世界》世界基本法典 ' + esc(LAW.version) +
        ' 作答——你可以用日常说法提问，我会定位到具体条号，给出结论、适用区域与处罚标准，并附上原文引用。</p>' +
        '<p>例如：「盗窃会被怎么处罚？」「一区可以 PVP 吗？」「怎么向法院起诉？」</p></div></div></div>';
      return;
    }
    thread.innerHTML = state.chat.map(function (m) {
      if (m.role === 'user') {
        return '<div class="msg msg-user"><div class="avatar">你</div><div class="msg-body">' +
          '<div class="msg-who">提问</div><div class="msg-text">' + esc(m.text) + '</div></div></div>';
      }
      var streaming = m.streaming && !m.html;
      return '<div class="msg msg-ai"' + (m.id ? ' id="msg-' + esc(m.id) + '"' : '') + '>' +
        '<div class="avatar">法</div><div class="msg-body">' +
        '<div class="msg-who">AI 法务助手</div>' +
        (m.lead ? '<div class="msg-lead">' + esc(m.lead) + '</div>' : '') +
        '<div class="msg-text">' + (streaming
          ? '<div class="typing"><i></i><i></i><i></i></div>'
          : (m.html || '')) + '</div>' +
        (m.streaming ? '' : (m.citations && m.citations.length ? citeHtml(m.citations) : '')) +
        '<div class="msg-foot">' +
        '<span class="engine-tag">' + esc(m.engine || '') + '</span>' +
        (m.elapsedMs ? '<span class="engine-tag">' + m.elapsedMs + ' ms</span>' : '') +
        (m.plain ? '<button class="copy-btn" type="button" data-copy="' +
          esc(m.plain) + '">复制回答</button>' : '') +
        '</div></div></div>';
    }).join('') + (state.busy && !state.chat.some(function (m) { return m.streaming; })
      ? '<div class="msg msg-ai" id="typing"><div class="avatar">法</div><div class="msg-body">' +
        '<div class="msg-who">AI 法务助手</div><div class="typing"><i></i><i></i><i></i></div></div></div>'
      : '');
    scrollThread();
  }

  function citeHtml(cites) {
    return '<div class="cites"><div class="cites-label">引用条文</div>' +
      cites.map(function (c) {
        var meta = [c.chapterTitle, c.sectionTitle, (c.tags || []).join('、')].filter(Boolean).join(' · ');
        return '<button class="cite" type="button" data-goto="' + esc(c.anchor) + '">' +
          '<span class="cite-top"><span class="cite-title">' + esc(c.title) + '</span>' +
          '<span class="cite-meta">' + esc(meta) + '</span></span>' +
          (c.quote ? '<span class="cite-quote">' + esc(c.quote) + '…</span>' : '') +
          '</button>';
      }).join('') + '</div>';
  }

  function scrollThread() {
    var last = $('#thread').lastElementChild;
    if (last) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function plainFromResult(res) {
    var parts = [];
    (res.blocks || []).forEach(function (b) {
      parts.push('【' + b.title + '】' + b.sentences.join(''));
    });
    if (!parts.length) parts.push(res.answer || '');
    if (res.citations && res.citations.length) {
      parts.push('引用：' + res.citations.map(function (c) { return c.title; }).join('、'));
    }
    return parts.join('\n\n');
  }

  function htmlFromResult(res) {
    if (res.blocks && res.blocks.length) {
      return res.blocks.map(function (b) {
        return b.sentences.map(function (s) { return '<p>' + fmt(s) + '</p>'; }).join('');
      }).join('');
    }
    return String(res.answer || '').split(/\n{2,}/).map(function (p) {
      return '<p>' + fmt(p) + '</p>';
    }).join('');
  }

  /* ──────────────────── 回答生成：真 AI 优先，内置引擎兜底 ──────────────────── */

  /** 用大模型回答；onDelta 存在时边生成边显示。 */
  function answerWithLLM(question, history, msg) {
    var offline = R.answerLocally(LAW, question);
    var messages = LLM.buildMessages(question, offline.blocks || [], history);
    var started = Date.now();
    var buffer = '';
    return LLM.chat(state.llm, messages, {
      temperature: 0.3,
      timeoutMs: 60000,
      onDelta: function (piece) {
        buffer += piece;
        msg.html = renderStreamingText(buffer);
        msg.plain = buffer;
        msg.streaming = true;
        patchStreamingMessage(msg);
      },
    }).then(function (full) {
      var text = (full || buffer || '').trim();
      if (!text) throw new Error('模型返回了空内容');
      msg.html = renderAnswerText(text);
      msg.plain = text;
      msg.streaming = false;
      msg.engine = modelLabel();
      msg.elapsedMs = Date.now() - started;
      msg.citations = offline.citations || [];
      renderChat();
      return true;
    });
  }

  /** 把模型输出转成段落 HTML：支持短行、• 列点、**加粗**、条号高亮 */
  function renderAnswerText(text) {
    var lines = String(text).split(/\n+/);
    var out = [];
    var buf = [];
    var flush = function () {
      if (buf.length) {
        out.push('<p>' + buf.join('') + '</p>');
        buf = [];
      }
    };
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) { flush(); return; }
      var isItem = /^([•·\-*]|\d+[.、)]|（[一二三四五六七八九十\d]+）)/.test(line);
      var body = inlineFormat(line.replace(/^([•·\-*])\s*/, ''));
      if (isItem) {
        flush();
        out.push('<p class="ai-item">' + body + '</p>');
      } else {
        buf.push(body);
      }
    });
    flush();
    return out.join('');
  }

  /** 流式过程中先按纯文本渲染，避免半截 Markdown 造成闪烁 */
  function renderStreamingText(text) {
    return String(text).split(/\n{2,}/).map(function (p) {
      return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function inlineFormat(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/【([^】]{1,14})】/g, '<strong>【$1】</strong>')
      .replace(/(第[一二三四五六七八九十百零〇]+条(?:之[一二三四五六七八九十]+)?)/g,
        '<span class="cite-ref">$1</span>');
  }

  function modelLabel() {
    if (!state.llm) return '内置条文引擎';
    var p = LLM.providerById(state.llm.providerId);
    return '真 AI · ' + (state.llm.model || p.model);
  }

  /** 流式过程中只更新当前消息节点，避免整屏重绘 */
  function patchStreamingMessage(msg) {
    var el = document.getElementById('msg-' + msg.id);
    if (!el) { renderChat(); return; }
    var body = el.querySelector('.msg-text');
    if (body) {
      body.innerHTML = msg.html;
      var foot = el.querySelector('.engine-tag');
      if (foot) foot.textContent = '正在生成…';
    }
    scrollThread();
  }

  function send(question) {
    question = String(question || '').trim();
    if (!question || state.busy) return;
    var input = $('#chat-input');
    if (input) { input.value = ''; autoGrow(input); }
    state.chat.push({ role: 'user', text: question });
    state.busy = true;
    renderChat();

    var history = state.chat.slice(-7, -1).map(function (m) {
      return { role: m.role === 'user' ? 'user' : 'assistant', content: m.plain || m.text };
    });

    // ① 已配置大模型 → 用真 AI 回答
    if (state.llm) {
      var msg = {
        id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6),
        role: 'assistant', html: '', plain: '', citations: [], engine: '正在生成…',
        lead: '', streaming: true,
      };
      state.chat.push(msg);
      renderChat();
      answerWithLLM(question, history, msg).catch(function (err) {
        msg.streaming = false;
        msg.engine = '真 AI 调用失败';
        msg.lead = '真 AI 调用失败：' + err.message + '（已改用内置条文引擎回答）';
        var local = R.answerLocally(LAW, question);
        msg.html = htmlFromResult(local);
        msg.plain = plainFromResult(local);
        msg.citations = local.citations || [];
        state.busy = false;
        renderChat();
      }).then(function () { state.busy = false; });
      return;
    }

    // ② 未配置大模型 → 先试服务端（如果部署时带了后端），失败再用浏览器内置引擎
    fetch(api('/api/ask'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: question, history: history })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (res) {
      state.busy = false;
      state.chat.push({
        role: 'assistant',
        html: htmlFromResult(res),
        plain: plainFromResult(res),
        citations: res.citations || [],
        engine: res.engine || '',
        lead: res.lead || '',
        elapsedMs: res.elapsedMs,
      });
      renderChat();
    }).catch(function (err) {
      state.busy = false;
      // 纯静态部署（没有后端）时，改用浏览器内置的条文引擎回答，
      // 算法与服务器一致：检索 → 从句 → 引用条号。
      try {
        var local = R.answerLocally(LAW, question);
        state.chat.push({
          role: 'assistant',
          html: htmlFromResult(local),
          plain: plainFromResult(local),
          citations: local.citations || [],
          engine: '浏览器内置引擎',
          lead: local.lead || '',
          elapsedMs: 0,
        });
        renderChat();
        return;
      } catch (e2) { /* 连本地引擎也失败，走下面的兜底说明 */ }
      var hint = /Failed to fetch|NetworkError|load failed|HTTP 5/i.test(err.message)
        ? '（当前未连接问答后端）'
        : '（' + esc(err.message) + '）';
      state.chat.push({
        role: 'assistant',
        html: '<p>问答服务暂时不可用' + hint + '。你仍然可以使用「法典全文」与检索功能。</p>',
        plain: '问答服务不可用', citations: [], engine: 'offline'
      });
      renderChat();
    });
  }

  /* ─────────────────────────── 模型接入设置 ─────────────────────────── */

  function renderLlmBanner() {
    var banner = $('#llm-banner');
    var note = $('#answer-note');
    if (!banner) return;
    if (state.llm) {
      banner.hidden = false;
      banner.className = 'llm-banner is-on';
      banner.innerHTML = '<span class="llm-dot"></span>真 AI 已启用：<strong>' +
        esc(state.llm.model) + '</strong>　' +
        '<button class="link-more as-link" type="button" id="llm-banner-off">关闭</button>';
      var off = $('#llm-banner-off');
      if (off) off.addEventListener('click', function () {
        LLM.clearConfig();
        state.llm = null;
        renderLlmBanner();
        toast('已切回内置条文引擎');
      });
      var btn = $('#chat-settings');
      if (btn) btn.textContent = '真 AI 设置';
      if (note) {
        note.innerHTML = '当前由<strong>大模型</strong>依据检索到的法典条文组织语言作答，' +
          '引用条号仍来自法典原文。想换模型或关闭，点右上角<strong>「真 AI 设置」</strong>。';
      }
    } else {
      banner.hidden = true;
      var b2 = $('#chat-settings');
      if (b2) b2.textContent = '接入真 AI';
    }
  }

  function fillLlmForm(cfg) {
    var provider = LLM.providerById((cfg && cfg.providerId) || 'deepseek');
    var sel = $('#llm-provider');
    sel.innerHTML = LLM.PROVIDERS.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.label) + '</option>';
    }).join('');
    sel.value = provider.id;
    $('#llm-base').value = (cfg && cfg.baseUrl) || provider.baseUrl;
    $('#llm-model').value = (cfg && cfg.model) || provider.model;
    $('#llm-key').value = (cfg && cfg.apiKey) || '';
    $('#llm-models').innerHTML = (provider.models || []).map(function (m) {
      return '<option value="' + esc(m) + '"></option>';
    }).join('');
    $('#llm-provider-note').innerHTML = esc(provider.note || '') +
      (provider.keyUrl ? '　<a href="' + esc(provider.keyUrl) +
        '" target="_blank" rel="noopener">去获取密钥 →</a>' : '');
  }

  function openLlmPanel() {
    fillLlmForm(state.llm);
    $('#llm-status').hidden = true;
    $('#llm-overlay').hidden = false;
    setTimeout(function () { $('#llm-key').focus(); }, 40);
  }

  function llmStatus(kind, text) {
    var el = $('#llm-status');
    el.hidden = false;
    el.className = 'llm-status is-' + kind;
    el.innerHTML = text;
  }

  function readLlmForm() {
    return {
      providerId: $('#llm-provider').value,
      baseUrl: $('#llm-base').value.trim(),
      model: $('#llm-model').value.trim(),
      apiKey: $('#llm-key').value.trim(),
    };
  }

  function bindLlmPanel() {
    var sel = $('#llm-provider');
    sel.addEventListener('change', function () {
      var p = LLM.providerById(sel.value);
      $('#llm-base').value = p.baseUrl;
      $('#llm-model').value = p.model;
      $('#llm-models').innerHTML = (p.models || []).map(function (m) {
        return '<option value="' + esc(m) + '"></option>';
      }).join('');
      $('#llm-provider-note').innerHTML = esc(p.note || '') +
        (p.keyUrl ? '　<a href="' + esc(p.keyUrl) +
          '" target="_blank" rel="noopener">去获取密钥 →</a>' : '');
    });

    $('#chat-settings').addEventListener('click', openLlmPanel);
    $('#llm-close').addEventListener('click', function () { $('#llm-overlay').hidden = true; });
    $('#llm-overlay').addEventListener('click', function (e) {
      if (e.target === $('#llm-overlay')) $('#llm-overlay').hidden = true;
    });

    $('#llm-test').addEventListener('click', function () {
      var cfg = readLlmForm();
      if (!cfg.apiKey) return llmStatus('err', '请先填写 API 密钥。');
      var btn = $('#llm-test');
      btn.disabled = true;
      llmStatus('wait', '正在连接 ' + esc(cfg.model) + ' …');
      LLM.testConfig(cfg).then(function (reply) {
        btn.disabled = false;
        llmStatus('ok', '连接成功，模型回复：' + esc(reply || '（空）'));
      }).catch(function (err) {
        btn.disabled = false;
        llmStatus('err', esc(err.message));
      });
    });

    $('#llm-save').addEventListener('click', function () {
      var cfg = readLlmForm();
      if (!cfg.apiKey) return llmStatus('err', '请先填写 API 密钥。');
      if (!cfg.baseUrl) return llmStatus('err', '请填写接口地址。');
      if (!cfg.model) return llmStatus('err', '请填写模型名。');
      if (!LLM.saveConfig(cfg)) return llmStatus('err', '浏览器拒绝保存（可能是隐私模式），请允许本地存储。');
      state.llm = cfg;
      renderLlmBanner();
      llmStatus('ok', '已启用。现在回到对话提问，回答将由 <strong>' + esc(cfg.model) +
        '</strong> 生成。');
      setTimeout(function () { $('#llm-overlay').hidden = true; }, 900);
    });

    $('#llm-off').addEventListener('click', function () {
      LLM.clearConfig();
      state.llm = null;
      renderLlmBanner();
      llmStatus('ok', '已切回内置条文引擎（无需密钥，离线可用）。');
    });
  }

  /* ─────────────────────────── 检索面板 ─────────────────────────── */

  function openSearch(prefill) {
    var overlay = $('#overlay');
    overlay.hidden = false;
    var input = $('#search-input');
    input.value = prefill || '';
    runPalette();
    setTimeout(function () { input.focus(); input.select(); }, 20);
  }

  function closeSearch() { $('#overlay').hidden = true; }

  function runPalette() {
    var q = $('#search-input').value.trim();
    state.query = q;
    var terms = expand(q);
    if (!q) {
      var popular = ['盗窃', 'PVP', '量刑标准', '诉讼', '外挂', '红石', '紧急状态', '罚金'];
      $('#palette-body').innerHTML = '<div class="palette-empty">输入关键词开始检索 · 试试：' +
        popular.map(function (p) { return '<button class="chip" type="button" data-fill="' + esc(p) + '">' + esc(p) + '</button>'; }).join(' ') +
        '</div>';
      $('#palette-count').textContent = LAW ? (LAW.index || []).length + ' 条可检索' : '';
      return;
    }
    var hits = search(q, 10);
    state.hits = hits;
    state.hitIndex = 0;
    if (!hits.length) {
      $('#palette-body').innerHTML = '<div class="palette-empty">没有匹配的条款，换个说法试试。</div>';
      $('#palette-count').textContent = '0 条';
      return;
    }
    $('#palette-body').innerHTML = hits.map(function (h, i) {
      var d = h.doc;
      var meta = [d.chapterTitle, (d.tags || []).join('、')].filter(Boolean).join(' · ');
      return '<button class="hit' + (i === 0 ? ' is-on' : '') + '" type="button" data-goto="' + esc(d.anchor) + '">' +
        '<span class="hit-top"><span class="hit-title">' + highlight(d.title, [q]) + '</span>' +
        '<span class="hit-meta">' + esc(meta) + '</span></span>' +
        '<span class="hit-excerpt">' + highlight(excerpt(d, terms), [q]) + '</span></button>';
    }).join('');
    $('#palette-count').textContent = hits.length + ' 条结果';
  }

  function moveHit(delta) {
    if (!state.hits.length) return;
    state.hitIndex = Math.max(0, Math.min(state.hits.length - 1, state.hitIndex + delta));
    $$('.hit').forEach(function (el, i) { el.classList.toggle('is-on', i === state.hitIndex); });
    var el = $$('.hit')[state.hitIndex];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function openHit(anchor, query) {
    closeSearch();
    location.hash = '#/law/' + anchor;
    if (query) {
      setTimeout(function () { }, 0);
    }
  }

  /* ─────────────────────────── 交互绑定 ─────────────────────────── */

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(180, el.scrollHeight) + 'px';
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 1800);
  }

  function bind() {
    window.addEventListener('hashchange', route);

    document.addEventListener('click', function (e) {
      var ask = e.target.closest('[data-ask]');
      if (ask) {
        var q = ask.dataset.ask;
        location.hash = '#/ask';
        setView('ask');
        send(q);
        return;
      }
      var goto = e.target.closest('[data-goto]');
      if (goto) {
        var anchor = goto.dataset.goto;
        $('#overlay').hidden = true;
        if (state.view === 'law') {
          history.replaceState(null, '', '#/law/' + anchor);
          focusArticle(anchor);
        } else {
          location.hash = '#/law/' + anchor;
        }
        return;
      }
      var fill = e.target.closest('[data-fill]');
      if (fill) {
        $('#search-input').value = fill.dataset.fill;
        runPalette();
        $('#search-input').focus();
        return;
      }
      var copy = e.target.closest('[data-copy]');
      if (copy) {
        navigator.clipboard.writeText(copy.dataset.copy).then(function () {
          toast('回答已复制');
        }, function () { toast('复制失败'); });
      }
    });

    $('#search-open').addEventListener('click', function () { openSearch(); });
    $('#how-search').addEventListener('click', function () { openSearch(); });
    $('#search-input').addEventListener('input', runPalette);
    $('#overlay').addEventListener('click', function (e) {
      if (e.target === $('#overlay')) closeSearch();
    });

    $('#ask-mini').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('#ask-mini-input').value.trim();
      if (!q) return;
      $('#ask-mini-input').value = '';
      location.hash = '#/ask';
      setView('ask');
      send(q);
    });

    $('#composer').addEventListener('submit', function (e) {
      e.preventDefault();
      send($('#chat-input').value);
    });
    $('#chat-input').addEventListener('input', function (e) { autoGrow(e.target); });
    $('#chat-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send(e.target.value);
      }
    });
    $('#chat-clear').addEventListener('click', function () {
      state.chat = [];
      renderChat();
    });

    $$('.pill').forEach(function (p) {
      p.addEventListener('click', function () {
        $$('.pill').forEach(function (x) { x.classList.remove('is-on'); });
        p.classList.add('is-on');
        state.tag = p.dataset.tag;
        applyFilter();
      });
    });

    $('#side-open').addEventListener('click', function () { $('#law-side').classList.add('is-open'); });
    $('#side-close').addEventListener('click', function () { $('#law-side').classList.remove('is-open'); });
    $('#toc').addEventListener('click', function (e) {
      if (e.target.closest('a') && window.innerWidth <= 900) $('#law-side').classList.remove('is-open');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('#overlay').hidden) { closeSearch(); return; }
        if ($('#law-side').classList.contains('is-open')) $('#law-side').classList.remove('is-open');
      }
      var typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); openSearch(); return; }
      if (!$('#overlay').hidden) {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveHit(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveHit(-1); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          var hit = state.hits[state.hitIndex];
          if (hit) openHit(hit.doc.anchor, state.query);
        }
      }
    });

    // reading progress + active TOC entry
    var progress = document.createElement('span');
    $('#progress').appendChild(progress);
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var h = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.width = (h > 0 ? Math.min(100, (window.scrollY / h) * 100) : 0) + '%';
        if (state.view !== 'law') return;
        var y = window.scrollY + 140;
        var current = null;
        $$('#law-body .article').forEach(function (el) {
          if (el.hidden) return;
          if (el.offsetTop <= y) current = el.id;
        });
        $$('.toc-art').forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === '#/law/' + current);
        });
      });
    }, { passive: true });
  }

  /* ─────────────────────────── 启动 ─────────────────────────── */

  function boot() {
    // defensive: the search panel and toast must never be visible on load
    $('#overlay').hidden = true;
    $('#toast').hidden = true;

    if (!LAW) {
      document.getElementById('main').innerHTML =
        '<div class="view" style="padding:80px 24px"><h1>法典数据未加载</h1>' +
        '<p class="lede">请通过本站服务器访问：<code>node server/index.js</code>，' +
        '然后打开 http://127.0.0.1:8787 。</p></div>';
      return;
    }
    buildIndex();
    renderHome();
    renderToc();
    renderLaw();
    renderChat();
    bind();
    // 读取本机保存的模型配置（自带密钥模式）
    if (LLM) {
      state.llm = LLM.loadConfig();
      bindLlmPanel();
      renderLlmBanner();
    }
    $('#foot-title').textContent = LAW.title;
    route();
    loadAccessInfo();
  }

  /** 站点访问方式（本机 / 局域网），供侧栏与二维码使用。 */
  function loadAccessInfo() {
    var qrBox = $('#access-qr');
    var qrNote = $('#access-qr-note');
    var list = $('#access-list');
    var isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);

    fetch('api/health').then(function (r) { return r.json(); }).then(function (h) {
      if (!h) throw new Error('empty');
      if (h.engine && h.engine !== 'statute-retrieval') {
        $('#engine-note').textContent = '大模型增强 · 依据《我的世界》世界基本法典 ' + LAW.version + ' 作答';
      }
      var urls = (h.access && h.access.length) ? h.access : [];
      list.innerHTML = urls.map(function (u) {
        return '<li><span class="url-label">' + esc(u.label) + '</span>' +
          '<a class="url-value" href="' + esc(u.url) + '">' + esc(u.url) + '</a></li>';
      }).join('') || '<li>仅本机可访问</li>';

      var lan = urls.filter(function (u) { return u.lan; })[0];
      if (lan && window.DSH_QR) {
        qrBox.innerHTML = window.DSH_QR.svg(lan.url, 148);
        qrNote.textContent = '手机扫码即可打开（需与本机连同一个 WiFi）';
      } else {
        qrBox.hidden = true;
        qrNote.textContent = lan
          ? '当前已经是局域网地址，可直接分享给同一 WiFi 下的手机'
          : '未检测到局域网地址';
      }
    }).catch(function () {
      // 纯静态部署（或后端不可用）：这台机器没有可分享的局域网地址
      qrBox.hidden = true;
      if (isLocal) {
        qrNote.textContent = '本机未启动后端服务，因此没有局域网地址。';
        list.innerHTML = '<li><span class="url-label">当前地址</span>' +
          '<a class="url-value" href="' + esc(location.href) + '">' + esc(location.href) + '</a></li>';
      } else {
        qrNote.textContent = '本站已部署在公网，直接用当前网址即可访问，无需扫码。';
        list.innerHTML = '<li><span class="url-label">当前网址</span>' +
          '<a class="url-value" href="' + esc(location.origin + '/') + '">' +
          esc(location.origin + '/') + '</a></li>';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
