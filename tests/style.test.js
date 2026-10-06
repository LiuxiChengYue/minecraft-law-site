/**
 * 样式契约自检：把 iOS 审美改造的关键点固化成可回归的断言，
 * 避免以后改动时悄悄丢掉毛玻璃、深色模式或无障碍回退。
 *
 *   node tests/style.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const CSS_PATH = path.join(__dirname, '..', 'public', 'assets', 'app.css');
const HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

/** 取出某个选择器的声明块（够用即可，不追求完整 CSS 解析） */
function block(selector, from) {
  const i = css.indexOf(selector, from || 0);
  if (i === -1) return '';
  const start = css.indexOf('{', i);
  if (start === -1) return '';
  let depth = 0;
  for (let j = start; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') {
      depth--;
      if (depth === 0) return css.slice(start + 1, j);
    }
  }
  return '';
}
const root = block(':root');
// 深色模式的 :root 在第一个 @media 里，跳过浅色定义再找
const darkAt = css.indexOf('prefers-color-scheme: dark');
const dark = block(':root', darkAt);

console.log('\n[1] 结构健全');
const open = (css.match(/\{/g) || []).length;
const close = (css.match(/\}/g) || []).length;
check('大括号平衡（' + open + ' 对）', open === close, open + ' vs ' + close);
check('没有未替换的旧配色（#fbfbfa）', css.indexOf('#fbfbfa') === -1);
check('没有未替换的旧配色（#14171a）', css.indexOf('#14171a') === -1);
check('无 TODO / FIXME 残留', !/TODO|FIXME/.test(css));

console.log('\n[2] iOS 设计令牌');
// 浅色用标准系统色，深色用 iOS 深色模式对应值
const IOS_COLORS = {
  '--blue': '#007aff', '--green': '#34c759', '--orange': '#ff9500',
  '--red': '#ff3b30', '--purple': '#af52de',
};
const IOS_COLORS_DARK = {
  '--blue': '#0a84ff', '--green': '#30d158', '--orange': '#ff9f0a', '--red': '#ff453a',
};
for (const [token, value] of Object.entries(IOS_COLORS)) {
  check('浅色模式 ' + token + ' = ' + value,
    new RegExp(token + ':\\s*' + value, 'i').test(root));
}
check('深色块定位正确（' + dark.length + ' 字符）', dark.length > 400, String(dark.length));
for (const [token, value] of Object.entries(IOS_COLORS_DARK)) {
  check('深色模式 ' + token + ' = ' + value,
    new RegExp(token + ':\\s*' + value, 'i').test(dark));
}
check('深色模式重新定义了全部主色',
  Object.keys(IOS_COLORS).every((t) => dark.indexOf(t + ':') !== -1));
check('深色背景用纯黑（iOS 习惯）', /--bg:\s*#000000/.test(dark), 'expected --bg: #000000');
check('浅色背景用 systemGroupedBackground (#f2f2f7)',
  /--bg:\s*#f2f2f7/.test(root));
check('圆角体系含胶囊值', /--r-pill:\s*980px/.test(root));
check('圆角体系含大卡片值', /--r-lg:\s*20px/.test(root));

console.log('\n[3] 毛玻璃材质');
const glassTokens = css.match(/--blur(-strong)?:\s*saturate\((180|200|220)%\)\s*blur\(/g) || [];
check('定义了两级模糊强度', glassTokens.length >= 2, String(glassTokens.length));
check('模糊值足够强（≥28px）', /--blur:\s*saturate\([^)]*\)\s*blur\((2[8-9]|[3-9]\d)px\)/.test(css),
  (css.match(/--blur:\s*[^;]+/) || [''])[0]);
// 顶栏的材质在 .topbar-inner 上（外层只是定位与渐隐遮罩）
check('顶栏使用毛玻璃', /\.topbar-inner\s*\{[^}]*backdrop-filter/s.test(css));
check('顶栏同时带 -webkit- 前缀', /\.topbar-inner\s*\{[^}]*-webkit-backdrop-filter/s.test(css));
check('侧栏使用毛玻璃', /\.law-side\s*\{[^}]*backdrop-filter/s.test(css));
check('检索遮罩使用模糊背景', /\.overlay\s*\{[^}]*backdrop-filter/s.test(css));
check('AI 回答气泡使用毛玻璃', /\.msg-ai \.msg-text\s*\{[^}]*backdrop-filter/s.test(css));
check('输入框使用毛玻璃', /\.composer\s*\{[^}]*backdrop-filter/s.test(css));
check('设置面板使用毛玻璃', /\.panel\s*\{[^}]*backdrop-filter/s.test(css));
check('玻璃层足够通透（≤0.6，否则看不出材质）',
  /--surface-glass:\s*rgba\([^)]*\.([0-5]\d?)\)/.test(css),
  (css.match(/--surface-glass:\s*[^;]+/) || [''])[0]);
check('玻璃有边缘高光（苹果质感关键）',
  /--glass-edge:\s*inset 0 \.5px 0/.test(css));
check('边缘高光已应用到玻璃件上', (css.match(/var\(--glass-edge\)/g) || []).length >= 10,
  String((css.match(/var\(--glass-edge\)/g) || []).length) + ' 处');
check('提供了不支持时的回退方案',
  /@supports not[\s\S]{0,200}backdrop-filter[\s\S]{0,600}background:\s*var\(--bg-elev\)/.test(css));

console.log('\n[4] 组件观感');
check('导航是分段控件（胶囊底 + 内边距）', /\.nav\s*\{[^}]*border-radius:\s*var\(--r-pill\)/s.test(css));
check('激活项是浮起的白色药丸', /\.nav a\.is-active\s*\{[^}]*background:\s*var\(--bg-elev\)/s.test(css));
check('主按钮用蓝色渐变', /\.btn-primary\s*\{[^}]*linear-gradient\(180deg, #2c8cff, #0064e0\)/s.test(css));
check('按钮按下有缩放反馈', /\.btn:active\s*\{[^}]*transform:\s*scale\(\.97\)/s.test(css));
check('使用了 Apple 的缓动曲线', css.indexOf('cubic-bezier(.32, .72, 0, 1)') !== -1);
check('用户提问是蓝色气泡（iMessage 观感）',
  /\.msg-user \.msg-text\s*\{[^}]*linear-gradient\(180deg, #2c8cff, #0064e0\)/s.test(css));
check('AI 回答是玻璃气泡', /\.msg-ai \.msg-text\s*\{[^}]*surface-glass/s.test(css));
check('气泡用小圆角贴角（对话感）',
  /\.msg-ai \.msg-text\s*\{[^}]*border-radius:\s*4px var\(--r-lg\)/s.test(css));
check('条文卡片化（有圆角与阴影）',
  /\.article\s*\{[^}]*border-radius:\s*var\(--r-lg\)[^}]*box-shadow/s.test(css));
check('章节列表是 iOS 分组列表', /\.chapter-grid\s*\{[^}]*background:\s*var\(--surface-glass\)[^}]*border-radius/s.test(css));
check('分隔线用 .5px 发丝线', /\.5px solid var\(--line\)/.test(css));
check('大标题用渐变文字', /\.hero h1\s*\{[^}]*background-clip:\s*text/s.test(css));
check('背景有会流动的彩色光斑（玻璃的折射源）',
  /body::before\s*\{[^}]*radial-gradient/s.test(css));
check('光斑带动画（缓慢漂移）', /@keyframes drift/.test(css));
check('深色模式也有光斑', /prefers-color-scheme: dark[\s\S]{0,200}body::before/.test(css));
check('背景之上有可读性纱层', /body::after\s*\{[^}]*linear-gradient/s.test(css));
check('移动端降低光斑强度', /max-width: 700px[\s\S]{0,400}body::before/.test(css));
check('顶栏是悬浮胶囊（不是贴边通栏）',
  /\.topbar-inner\s*\{[^}]*border-radius:\s*var\(--r-pill\)/s.test(css));
check('弹层遮罩带模糊（iOS sheet 观感）',
  /\.overlay\s*\{[^}]*backdrop-filter:\s*blur\(1[0-9]px\)/s.test(css));

console.log('\n[5] 无障碍与降级');
check('尊重 prefers-reduced-motion',
  /@media \(prefers-reduced-motion: reduce\)/.test(css));
check('打印样式隐藏交互元素', /@media print[\s\S]{0,200}display:\s*none\s*!important/.test(css));
check('打印时标题用实色（避免渐变文字消失）',
  /@media print[\s\S]{0,600}-webkit-text-fill-color:\s*#000/.test(css));
check('焦点圈可见', /:focus-visible\s*\{[^}]*outline:/.test(css));
check('弹层默认隐藏规则仍在（防止老 bug 回归）',
  /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css));
check('触摸设备去掉点击高亮', /-webkit-tap-highlight-color:\s*transparent/.test(css));

console.log('\n[6] 响应式');
check('窄屏把侧栏改为抽屉', /@media \(max-width: 900px\)[\s\S]{0,400}\.law-side[\s\S]{0,300}position:\s*fixed/.test(css));
check('窄屏缩小正文字号', /@media \(max-width: 700px\)[\s\S]{0,200}font-size:\s*16px/.test(css));
check('窄屏单列设置表单', /@media \(max-width: 700px\)[\s\S]{0,2200}\.field-row\s*\{\s*grid-template-columns:\s*1fr/.test(css));

console.log('\n[7] 标记与样式的对应');
check('index.html 引入样式表', html.indexOf('assets/app.css') !== -1);
check('index.html 有主题色元信息', /name="theme-color"/.test(html));
check('CSS 里未被引用的关键类不缺失',
  ['.topbar', '.hero', '.article', '.cite', '.palette', '.panel', '.composer', '.access']
    .every((sel) => css.indexOf(sel) !== -1));

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
