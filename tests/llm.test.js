/**
 * 大模型接入层自检：用本地模拟的 OpenAI 兼容服务验证流式解析、错误处理与上下文组装。
 *
 *   node tests/llm.test.js
 */
'use strict';

const path = require('path');
const http = require('http');
const LLM = require(path.join(__dirname, '..', 'public', 'assets', 'llm.js'));
const { KnowledgeBase } = require(path.join(__dirname, '..', 'server', 'kb.js'));
const { AnswerEngine } = require(path.join(__dirname, '..', 'server', 'answer.js'));

const LAW_PATH = path.join(__dirname, '..', 'public', 'data', 'law.json');
const PORT = 8793;

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

/** 模拟服务商：/chat/completions 支持流式与非流式，可按需返回错误码 */
function startMockServer() {
  const state = { lastBody: null, failWith: null };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw); } catch (e) { /* ignore */ }
      state.lastBody = body;

      if (state.failWith) {
        res.writeHead(state.failWith, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '模拟错误 ' + state.failWith } }));
        return;
      }

      const words = ['根据', '第九条', '，', '盗窃', '实行', '三次机会', '阶梯处罚', '。'];
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
        let i = 0;
        const timer = setInterval(() => {
          if (i >= words.length) {
            res.write('data: [DONE]\n\n');
            clearInterval(timer);
            res.end();
            return;
          }
          const chunk = { choices: [{ delta: { content: words[i++] } }] };
          res.write('data: ' + JSON.stringify(chunk) + '\n\n');
        }, 8);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: words.join('') } }],
        }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => resolve({ server, state }));
  });
}

(async () => {
  console.log('\n[1] 服务商预置');
  check('至少 6 个服务商可选', LLM.PROVIDERS.length >= 6, String(LLM.PROVIDERS.length));
  const dc = LLM.providerById('deepseek');
  check('DeepSeek 配置正确',
    dc.baseUrl === 'https://api.deepseek.com/v1' && dc.model === 'deepseek-chat', dc.baseUrl);
  check('每个服务商都有接口地址与模型',
    LLM.PROVIDERS.every((p) => p.baseUrl !== undefined && p.model !== undefined));
  check('提供自定义选项', LLM.PROVIDERS.some((p) => p.id === 'custom'));
  check('未知 id 回退到第一个', LLM.providerById('nope').id === LLM.PROVIDERS[0].id);

  console.log('\n[2] 系统提示词约束');
  const sp = LLM.SYSTEM_PROMPT;
  check('要求只依据给定条文', /只能依据/.test(sp));
  check('禁止编造条号', /不要编造|绝对不要编造/.test(sp));
  check('要求说明适用区域', /全服通用/.test(sp) && /一区专属/.test(sp));
  check('提示最终解释权归房主', /房主/.test(sp));

  console.log('\n[3] 上下文组装（检索结果 → 模型输入）');
  const kb = new KnowledgeBase(LAW_PATH);
  const engine = new AnswerEngine(kb, {});
  const offline = engine.compose('偷东西怎么判');
  const ctx = LLM.buildContext(offline.blocks);
  check('上下文包含条号标题', ctx.indexOf('第九条') !== -1, ctx.slice(0, 60));
  check('上下文包含条文原文', ctx.indexOf('三次机会') !== -1);
  check('上下文长度受控（< 8KB）', ctx.length < 8000, String(ctx.length));
  check('空 blocks 不报错', LLM.buildContext([]) === '');

  const messages = LLM.buildMessages('偷东西怎么判', offline.blocks,
    [{ role: 'user', content: '之前的问题' }, { role: 'assistant', content: '之前的回答' }]);
  check('消息结构：system 开头', messages[0].role === 'system');
  check('消息结构：user 结尾', messages[messages.length - 1].role === 'user');
  check('历史被带上', messages.some((m) => m.content === '之前的问题'));
  check('system 里带条文依据', messages[0].content.indexOf('第九条') !== -1);

  console.log('\n[4] 配置持久化（模拟 localStorage）');
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  check('未配置时返回 null', LLM.loadConfig() === null);
  LLM.saveConfig({ providerId: 'deepseek', apiKey: 'sk-test', model: 'deepseek-chat', baseUrl: 'x' });
  check('保存后可读回', (LLM.loadConfig() || {}).apiKey === 'sk-test');
  check('密钥存在 localStorage 里', JSON.stringify(store).indexOf('sk-test') !== -1);
  LLM.clearConfig();
  check('清除后返回 null', LLM.loadConfig() === null);

  console.log('\n[5] 真实 HTTP 调用（本地模拟服务）');
  const { server, state } = await startMockServer();
  const base = 'http://127.0.0.1:' + PORT;
  const cfg = { providerId: 'mock', baseUrl: base, model: 'mock-model', apiKey: 'sk-mock' };

  const pieces = [];
  const full = await LLM.chat(cfg, [{ role: 'user', content: '偷东西怎么判' }], {
    onDelta: (p) => pieces.push(p),
  });
  check('流式：收到多个分片', pieces.length >= 4, String(pieces.length));
  check('流式：拼接结果正确', full === '根据第九条，盗窃实行三次机会阶梯处罚。', full);
  check('流式：请求体带 model 与 stream',
    state.lastBody.model === 'mock-model' && state.lastBody.stream === true);
  check('流式：请求体带消息数组', Array.isArray(state.lastBody.messages));

  const once = await LLM.chat(cfg, [{ role: 'user', content: 'x' }], {});
  check('非流式：一次性返回全文', once === '根据第九条，盗窃实行三次机会阶梯处罚。', once);
  check('非流式：请求 stream=false', state.lastBody.stream === false);

  console.log('\n[6] 错误处理（都要给人话，不能静默失败）');
  for (const [code, expect] of [[401, '密钥无效'], [402, '余额'], [404, '模型名'], [429, '频繁']]) {
    state.failWith = code;
    let msg = '';
    try { await LLM.chat(cfg, [{ role: 'user', content: 'x' }], {}); }
    catch (e) { msg = e.message; }
    check('HTTP ' + code + ' 提示含「' + expect + '」', msg.indexOf(expect) !== -1, msg);
  }
  state.failWith = null;

  let noKey = '';
  try { await LLM.chat({ baseUrl: base, model: 'm', apiKey: '' }, [], {}); }
  catch (e) { noKey = e.message; }
  check('缺少密钥时明确报错', noKey.indexOf('密钥') !== -1, noKey);

  let noBase = '';
  try { await LLM.chat({ baseUrl: '', model: 'm', apiKey: 'k' }, [], {}); }
  catch (e) { noBase = e.message; }
  check('缺少地址时明确报错', noBase.indexOf('地址') !== -1, noBase);

  let badHost = '';
  try {
    await LLM.chat({ baseUrl: 'http://127.0.0.1:1', model: 'm', apiKey: 'k' }, [], {});
  } catch (e) { badHost = e.message; }
  check('连不上时给出可读提示', badHost.indexOf('无法连接') !== -1, badHost);

  console.log('\n[7] 连通性测试接口');
  const reply = await LLM.testConfig(cfg);
  check('testConfig 返回模型回复', reply.length > 0, reply);

  await new Promise((r) => server.close(r));

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\n测试无法完成：' + err.message);
  console.error(err.stack.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
});
