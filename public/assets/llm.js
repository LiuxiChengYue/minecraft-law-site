/* ==========================================================================
   真·大模型接入层（自带密钥 / BYOK）
   浏览器直接调用服务商的 OpenAI 兼容接口，密钥只存在本机浏览器里。
   支持流式输出，失败时由调用方回退到内置条文引擎。
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DSH_LLM = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * 预置服务商。baseUrl 均支持 OpenAI 兼容的 /chat/completions，
   * 且允许浏览器跨域直接调用（CORS）。
   */
  var PROVIDERS = [
    {
      id: 'deepseek',
      label: 'DeepSeek（深度求索）',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      keyUrl: 'https://platform.deepseek.com/api_keys',
      note: '国内直连，价格最低；新用户注册后充值即可用',
    },
    {
      id: 'moonshot',
      label: 'Kimi（月之暗面）',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-8k',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-latest'],
      keyUrl: 'https://platform.moonshot.cn/console/api-keys',
      note: '国内直连，长文本能力强',
    },
    {
      id: 'zhipu',
      label: '智谱 GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash',
      models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
      keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
      note: 'glm-4-flash 有免费额度',
    },
    {
      id: 'siliconflow',
      label: '硅基流动 SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen2.5-7B-Instruct',
      models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-72B-Instruct',
        'deepseek-ai/DeepSeek-V3'],
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
      note: '多种开源模型，部分免费',
    },
    {
      id: 'dashscope',
      label: '阿里通义千问',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-turbo',
      models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
      keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
      note: '阿里云百炼平台',
    },
    {
      id: 'volcengine',
      label: '字节豆包',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-1-5-lite-32k-250115',
      models: ['doubao-1-5-lite-32k-250115', 'doubao-1-5-pro-32k-250115'],
      keyUrl: 'https://console.volcengine.com/ark',
      note: '需要在方舟控制台创建接入点',
    },
    {
      id: 'custom',
      label: '自定义（任意 OpenAI 兼容接口）',
      baseUrl: '',
      model: '',
      models: [],
      keyUrl: '',
      note: '填写完整地址，例如 https://example.com/v1',
    },
  ];

  var SYSTEM_PROMPT = [
    '你是《我的世界》(Minecraft) 服务器《世界基本法典》G2.8 的官方问答助手，直接面向玩家。',
    '',
    '【回答规则】',
    '1. 只能依据下面提供的法典条文作答。条文没有覆盖的内容，明确说"法典未规定"，并提示最终解释权归房主。',
    '2. 绝对不要编造条号、处罚金额、时长或程序。引用条号必须来自给定条文。',
    '3. 先给结论，再给依据。涉及区域差异时说明是「全服通用」「一区专属」还是「三区专属」。',
    '4. 用简体中文，语气克制、清楚、像在跟玩家面对面解释。不要用 Markdown 表格，可以用短段落和「•」列点。',
    '5. 条号写法统一为「第X条」，例如：第九条、第二十一条、第三条之一。',
    '6. 如果玩家问的是具体案件该不该罚、罚多少，说明判断标准，并提醒最终裁定权在房主。',
  ].join('\n');

  var STORE_KEY = 'dsh-law-llm-config';

  function loadConfig() {
    try {
      var raw = (typeof localStorage !== 'undefined') && localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var cfg = JSON.parse(raw);
      return cfg && cfg.apiKey ? cfg : null;
    } catch (e) { return null; }
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
      return true;
    } catch (e) { return false; }
  }

  function clearConfig() {
    try { localStorage.removeItem(STORE_KEY); return true; } catch (e) { return false; }
  }

  function providerById(id) {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
    return PROVIDERS[0];
  }

  /** 从检索结果拼出给模型的依据文本 */
  function buildContext(blocks, maxChars) {
    maxChars = maxChars || 7000;
    var parts = [];
    var used = 0;
    for (var i = 0; i < (blocks || []).length; i++) {
      var b = blocks[i];
      var head = '【' + b.title + '】' + (b.meta ? '（' + b.meta + '）' : '');
      var body = (b.sentences || []).join('');
      var chunk = head + '\n' + body;
      if (used + chunk.length > maxChars) break;
      parts.push(chunk);
      used += chunk.length;
    }
    return parts.join('\n\n');
  }

  /**
   * 调用模型（流式）。逐段回调 onDelta(text)，结束时 resolve(fullText)。
   * 传入 onDelta 即为流式；服务商不支持流式时自动降级为一次性返回。
   */
  async function chat(cfg, messages, options) {
    options = options || {};
    var onDelta = options.onDelta;
    var base = String(cfg.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('未填写接口地址');
    if (!cfg.apiKey) throw new Error('未填写密钥');

    var body = {
      model: cfg.model,
      messages: messages,
      temperature: options.temperature == null ? 0.3 : options.temperature,
      stream: Boolean(onDelta),
    };

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, options.timeoutMs || 60000);
    var res;
    try {
      res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + cfg.apiKey,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('请求超时');
      throw new Error('无法连接模型服务（可能是网络或跨域限制）：' + err.message);
    }

    if (!res.ok) {
      clearTimeout(timer);
      var detail = '';
      try {
        var j = await res.json();
        detail = (j.error && (j.error.message || j.error.code)) || JSON.stringify(j).slice(0, 160);
      } catch (e) {
        try { detail = (await res.text()).slice(0, 160); } catch (e2) { /* ignore */ }
      }
      var hint = '';
      if (res.status === 401) hint = '（密钥无效或已过期）';
      else if (res.status === 402) hint = '（账户余额不足，请到服务商后台充值）';
      else if (res.status === 404) hint = '（模型名或接口地址不对）';
      else if (res.status === 429) hint = '（请求过于频繁或超出配额）';
      throw new Error('模型返回 HTTP ' + res.status + hint + ' ' + detail);
    }

    // 非流式
    if (!onDelta || !res.body) {
      clearTimeout(timer);
      var json = await res.json();
      var text = (json.choices && json.choices[0] && json.choices[0].message &&
        json.choices[0].message.content) || '';
      if (onDelta && text) onDelta(text);
      return text;
    }

    // 流式：解析 SSE
    var reader = res.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buf = '';
    var full = '';
    try {
      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        buf += decoder.decode(step.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.charAt(0) === ':') continue;
          if (line.indexOf('data:') !== 0) continue;
          var data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          var piece = '';
          try {
            var obj = JSON.parse(data);
            var d = obj.choices && obj.choices[0] && obj.choices[0].delta;
            piece = (d && (d.content || d.reasoning_content)) || '';
          } catch (e) { /* 忽略不完整的分片 */ }
          if (piece) { full += piece; onDelta(piece); }
        }
      }
    } finally {
      clearTimeout(timer);
      try { reader.releaseLock(); } catch (e) { /* ignore */ }
    }
    return full;
  }

  /** 组装发给模型的消息：系统提示 + 条文依据 + 历史 + 本次问题 */
  function buildMessages(question, blocks, history) {
    var context = buildContext(blocks);
    var messages = [{
      role: 'system',
      content: SYSTEM_PROMPT + '\n\n【本次可依据的法典条文】\n' + context,
    }];
    for (var i = 0; i < (history || []).length; i++) {
      var h = history[i];
      if (h && h.role && h.content) {
        messages.push({ role: h.role, content: String(h.content).slice(0, 2000) });
      }
    }
    messages.push({ role: 'user', content: question });
    return messages;
  }

  /** 轻量连通性测试：问一句最短的话，确认密钥与模型可用 */
  async function testConfig(cfg) {
    var text = await chat(cfg, [
      { role: 'system', content: '你是连接测试助手，只回复两个字：正常' },
      { role: 'user', content: '测试' },
    ], { timeoutMs: 25000, temperature: 0 });
    return String(text || '').trim().slice(0, 40);
  }

  return {
    PROVIDERS: PROVIDERS,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    clearConfig: clearConfig,
    providerById: providerById,
    buildContext: buildContext,
    buildMessages: buildMessages,
    chat: chat,
    testConfig: testConfig,
  };
}));
