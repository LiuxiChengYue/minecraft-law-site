/**
 * 浏览器内置问答引擎自检：在 Node 里直接调用 render.js 的 answerLocally()，
 * 验证「无后端也能回答并引用条号」。
 *
 *   node tests/local-answer.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const R = require(path.join(__dirname, '..', 'public', 'assets', 'render.js'));

const LAW = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'law.json'), 'utf8'));

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

console.log('\n[1] 语句切分');
const docs = R.buildIndex(LAW);
const art9 = docs.filter((d) => d.anchor === 'art-九')[0];
const sents = R.sentencesOf(art9);
check('第九条能切出句子', sents.length > 3, String(sents.length));
check('句子都以标点或结尾收束',
  sents.every((s) => s.text.length >= 4 && s.text.length < 400),
  sents.map((s) => s.text.length).join(','));
check('切分保留了「三次机会」关键词',
  sents.some((s) => s.text.indexOf('三次机会') !== -1));

console.log('\n[2] 本地问答（模拟无后端）');
const cases = [
  ['偷东西怎么判', '第九条'],
  ['一区可以PVP吗', '第四条'],
  ['使用外挂的后果', '第六条'],
  ['怎么向法院起诉', '第二十一条'],
  ['追诉时效是多久', '第三条'],
  ['谋权夺位罪怎么处罚', '第三条之一'],
  ['三区可以随便打架吗', '第八条'],
  ['建房补贴怎么领', '第十四条之一'],
  ['罚金怎么缴纳', '第一条'],
  ['紧急状态怎么宣布', '第三十条'],
];
for (const [q, expect] of cases) {
  const a = R.answerLocally(LAW, q);
  const titles = (a.citations || []).map((c) => c.title).join(' | ');
  check('「' + q + '」引用 ' + expect, titles.indexOf(expect) !== -1, titles || '(无引用)');
  check('  有回答正文', (a.answer || '').length > 15, String((a.answer || '').length));
  check('  标为浏览器引擎', a.engine === 'browser', String(a.engine));
}

console.log('\n[3] 边界情况');
const hello = R.answerLocally(LAW, '你好');
check('寒暄走引导回复', hello.intent === 'social', hello.intent);
const nothing = R.answerLocally(LAW, 'zzzqqqxxx');
check('无关问题给出兜底说明', nothing.confidence === 'none', nothing.confidence);
check('  并附建议问题', (nothing.suggestions || []).length > 0);
const empty = R.answerLocally(LAW, '');
check('空问题不报错', empty.confidence === 'none' && empty.intent === 'empty');
check('回答结构包含 blocks / citations / confidence',
  ['blocks', 'citations', 'confidence', 'intent', 'suggestions', 'engine']
    .every((k) => k in R.answerLocally(LAW, '盗窃')));

console.log('\n[4] 与服务器结果对比（同一问题）');
const localA = R.answerLocally(LAW, '偷东西怎么判');
check('本地引擎首条引用与服务器一致（第九条）',
  localA.citations[0].title.indexOf('第九条') === 0, localA.citations[0].title);
check('引文非空且来自条文',
  localA.citations[0].quote.length > 10 &&
  art9.text.indexOf(localA.citations[0].quote.slice(0, 8)) !== -1);

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
