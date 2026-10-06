/**
 * 线上站点验证：直接请求已部署的地址，确认首页、资源、问答引擎都正常。
 *
 *   node tools/verify-live.js [站点地址]
 */
'use strict';

const BASE = (process.argv[2] || 'https://liuxichengyue.github.io/minecraft-law-site/')
  .replace(/\/?$/, '/');

async function get(pathname, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 30000);
  try {
    const res = await fetch(BASE + pathname, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    const text = await res.text();
    return { status: res.status, text, bytes: Buffer.byteLength(text) };
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  console.log('\n验证站点：' + BASE + '\n');

  console.log('[1] 首页');
  const home = await get('');
  console.log('  HTTP ' + home.status + ' · ' + (home.bytes / 1024).toFixed(0) + ' KB');
  console.log('  内联法典数据: ' + (home.text.indexOf('window.__LAW__ = {') !== -1 ? '是' : '否'));
  console.log('  含章节标题  : ' + (home.text.indexOf('刑法（生命与安全）') !== -1 ? '是' : '否'));
  console.log('  含 AI 问答区: ' + (home.text.indexOf('AI 法务问答') !== -1 ? '是' : '否'));
  console.log('  含手机扫码区: ' + (home.text.indexOf('手机访问') !== -1 ? '是' : '否'));
  console.log('  资源用相对路径: ' + (home.text.indexOf('src="./assets/app.js"') !== -1 ? '是' : '否'));

  console.log('\n[2] 静态资源');
  for (const f of ['assets/app.css', 'assets/app.js', 'assets/render.js',
    'assets/qr.js', 'assets/favicon.svg', 'data/law.json', '404.html', '.nojekyll']) {
    try {
      const r = await get(f, 25000);
      console.log('  ' + f.padEnd(22) + 'HTTP ' + r.status + '  ' + (r.bytes / 1024).toFixed(1) + ' KB');
    } catch (e) {
      console.log('  ' + f.padEnd(22) + '失败：' + e.message);
    }
  }

  console.log('\n[3] 前端能力');
  const render = await get('assets/render.js');
  console.log('  浏览器内置问答引擎: ' + (render.text.indexOf('answerLocally') !== -1 ? '已下发' : '缺失'));
  const app = await get('assets/app.js');
  console.log('  无后端时的兜底逻辑: ' + (app.text.indexOf('answerLocally') !== -1 ? '已下发' : '缺失'));
  console.log('  检索面板与路由    : ' + (app.text.indexOf('runPalette') !== -1 ? '已下发' : '缺失'));

  console.log('\n[4] 法典内容完整性（从下发的 JSON 里数）');
  const lawRaw = await get('data/law.json');
  try {
    const law = JSON.parse(lawRaw.text);
    const arts = law.chapters.reduce((n, ch) =>
      n + (ch.articles || []).length +
      (ch.sections || []).reduce((m, s) => m + (s.articles || []).length, 0), 0);
    console.log('  版本      : ' + law.version);
    console.log('  章节数    : ' + law.chapters.length);
    console.log('  条文数    : ' + arts);
    console.log('  附录数    : ' + law.appendices.length);
    console.log('  正文总字数: ' + law.stats.chars);
  } catch (e) {
    console.log('  解析失败：' + e.message);
  }

  console.log('\n完成。\n');
})().catch((err) => {
  console.error('验证失败：' + err.message);
  process.exit(1);
});
