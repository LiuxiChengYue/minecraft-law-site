/**
 * Smoke test: renders every view's markup with the shared module and checks the
 * results, so the UI is verified even without a browser.
 *
 *   node tests/render.test.js
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

console.log('\n[1] 结构化数据');
check('章节数为 9', LAW.chapters.length === 9, 'got ' + LAW.chapters.length);
const arts = [];
for (const ch of LAW.chapters) {
  for (const a of ch.articles || []) arts.push(a);
  for (const s of ch.sections || []) for (const a of s.articles || []) arts.push(a);
}
check('条文数为 40（36 条 + 4 个之一/之二）', arts.length === 40, 'got ' + arts.length);
check('附录为 4 份', (LAW.appendices || []).length === 4,
  'got ' + (LAW.appendices || []).length);
check('每一条都有正文', arts.every((a) => (a.paragraphs || []).length > 0));
check('每一条都有标题', arts.every((a) => a.title && a.title.length > 3));
const minChars = Math.min.apply(null, arts.map((a) => a.text.length));
check('最短条文仍有内容（' + minChars + ' 字）', minChars >= 30);
check('正文总字数 > 3 万', LAW.stats.chars > 30000, 'got ' + LAW.stats.chars);
check('没有残留页眉', !arts.some((a) => /世界基本法典\s*G2\.8/.test(a.text)));
check('没有替换字符', !arts.some((a) => a.text.indexOf('\ufffd') !== -1));
check('区域标签齐全', LAW.tags.join(',') === '全服通用,一区专属,三区专属', LAW.tags.join(','));

console.log('\n[2] 渲染');
const lawHtml = R.lawHtml(LAW, '');
const articleCount = (lawHtml.match(/<article class="article/g) || []).length;
check('全文渲染包含 40 条条文 + 4 份附录', articleCount === 44, String(articleCount));
check('全文渲染包含 9 个 chapter 节点', (lawHtml.match(/<section class="chapter"/g) || []).length === 9);
check('条文锚点存在', lawHtml.indexOf('id="art-九"') !== -1);
check('区域标签渲染为 class', lawHtml.indexOf('tag tag-一区专属') !== -1);
check('渲染结果无未转义尖括号', !/<script/i.test(lawHtml));

const tocHtml = R.tocHtml(LAW);
check('目录包含 9 个章链接', (tocHtml.match(/data-ch=/g) || []).length === 9);
check('目录包含 40 个条文链接', (tocHtml.match(/class="toc-art"/g) || []).length === 44,
  String((tocHtml.match(/class="toc-art"/g) || []).length));
check('目录包含附录链接', tocHtml.indexOf('#/law/app-一') !== -1);

console.log('\n[3] 检索');
const docs = R.buildIndex(LAW);
check('检索单元数 = 条文 + 章前言 + 节 + 附录', docs.length === 44, 'got ' + docs.length);
const cases = [
  ['偷东西怎么判', 'art-九'],
  ['一区可以PVP吗', 'art-四'],
  ['使用外挂的后果', 'art-六'],
  ['怎么向法院起诉', 'art-二十一'],
  ['追诉时效是多久', 'art-三'],
  ['谋权夺位罪怎么判', 'art-三之一'],
  ['三区能打架吗', 'art-八'],
  ['罚金怎么缴纳', 'art-一'],
  ['紧急状态怎么宣布', 'art-三十'],
  ['建房补贴', 'art-十四之一一'],
];
for (const [q, expect] of cases) {
  const hits = R.search(docs, q, 5);
  const anchors = hits.map((h) => h.doc.anchor);
  check('「' + q + '」命中 ' + expect, anchors.indexOf(expect) !== -1,
    'top3=' + anchors.slice(0, 3).join(','));
}
check('空查询返回空结果', R.search(docs, '', 5).length === 0);
check('无关查询返回空结果', R.search(docs, 'zzzzqqq', 5).length === 0);

console.log('\n[4] 转义与高亮');
check('esc 转义尖括号', R.esc('<b>&"') === '&lt;b&gt;&amp;&quot;');
check('highlight 保留转义', R.highlight('盗窃 <b>', ['盗窃']).indexOf('<mark>盗窃</mark>') === 0);
check('fmt 加粗区域标记', R.fmt('【一区专属】规则').indexOf('<strong>【一区专属】</strong>') !== -1);

console.log('\n[5] 筛选');
const onlyZone1 = R.lawHtml(LAW, '一区专属');
check('筛选后仍渲染全部条文（用 hidden 控制显示）',
  (onlyZone1.match(/<article class="article/g) || []).length === 44);
check('筛选后非匹配条文带 hidden',
  (onlyZone1.match(/data-tags="全服通用" hidden/) || []).length > 0);
check('筛选后匹配条文不带 hidden',
  (onlyZone1.match(/data-tags="一区专属" hidden/) || []).length === 0);

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
