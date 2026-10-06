# 《我的世界》世界基本法典 · 官方网站

服务器 / 房间最高法律文件 **G2.8** 的官方网站：法典全文、全文检索，以及一个**只依据本法典作答**的内置 AI 法务助手。

- 现代极简界面（无框架、无构建步骤、无外网依赖）
- 法典结构化为「章 / 节 / 条」数据（9 章 · 40 条 · 4 份附录）
- AI 问答：本地 BM25 检索 + 条文句子抽取，**每条回答都带条号引用**，可点回原文
- 可选：配置 OpenAI 兼容的大模型接口，用同一份检索结果做接地（grounding）生成

---

## 一、快速开始

```bash
node server/index.js            # 默认 http://127.0.0.1:8787（同时监听局域网）
node server/index.js --port 9000
```

启动后终端会打印两个地址：

```
本机          http://127.0.0.1:8787
手机 / 其他电脑  http://192.168.x.x:8787      ← 同一个 WiFi 下可直接打开
```

打开浏览器访问即可。首次启动不需要任何配置或密钥。

### 手机访问（同一 WiFi）

官网首页底部有「手机访问」区块，会把局域网地址渲染成**二维码**，手机扫码即可打开，
界面会自动适配手机屏幕（顶部导航折叠、目录抽屉、对话输入框贴底）。

若手机打不开，通常是 Windows 防火墙拦住了端口。以管理员身份运行一次：

```powershell
netsh advfirewall firewall add rule name="法典官网 8787" dir=in action=allow protocol=TCP localport=8787
```

### 让外网也能访问

局域网之外的访问需要额外的网络条件，最省事的是托管到公网。项目已经准备好一键部署包：

```bash
node server/build.js          # 产出 dist/（1.2MB，含 Dockerfile 与各平台配置）
node server/build.js --static-only --api-base https://api.example.com  # 纯静态 + 独立 API
```

- **Render.com（最省事，免费）**：推到 GitHub → New → Blueprint → 自动读 `render.yaml`
- **Docker**：`docker compose -f deploy/docker-compose.yml up -d --build`
- **Fly.io**：`fly launch --no-copy-config`，`deploy/fly.toml` 已开启自动停机省钱
- **VPS**：`deploy/law-site.service` 是现成的 systemd 单元
- **纯静态托管**：法典全文与检索完全在浏览器里跑，只有 AI 问答需要后端

完整步骤、Nginx/Caddy 反代示例、限流建议、部署后自检命令见 **[deploy/DEPLOY.md](deploy/DEPLOY.md)**。

| 环境变量 | 说明 |
| --- | --- |
| `PORT` | 监听端口，默认 `8787` |
| `HOST` | 监听地址，默认 `0.0.0.0`（所有网卡）；设成 `127.0.0.1` 则只允许本机 |

### 可选：接入大模型

不配置时，AI 问答完全离线运行（检索 + 条文抽取）。若希望由大模型组织语言，
设置以下环境变量即可，**检索到的条文仍会作为唯一依据传给模型**：

```bash
# PowerShell
$env:LAW_LLM_API_KEY = "sk-..."
$env:LAW_LLM_BASE_URL = "https://api.deepseek.com/v1"   # 任意 OpenAI 兼容接口
$env:LAW_LLM_MODEL    = "deepseek-chat"
node server/index.js
```

模型调用失败时自动回退到离线抽取式回答，页面不会报错。

---

## 二、目录结构

```
cr-law-site/
├─ server/
│  ├─ index.js        HTTP 服务：静态资源 + /api/*，法典数据内联进首页；支持源码/产物两种目录布局
│  ├─ kb.js           知识库：分词、同义词、BM25 检索、区域（一区/三区/全服）加权
│  ├─ answer.js       问答引擎：意图分类、句子抽取、引用生成、可选大模型调用
│  └─ build.js        构建 dist/（完整站点或纯静态站点）
├─ public/
│  ├─ index.html      单页外壳（三个视图：总览 / 法典全文 / AI 问答）
│  ├─ assets/
│  │  ├─ app.css      设计系统与全部样式（含深色模式、响应式、打印样式）
│  │  ├─ app.js       前端逻辑：hash 路由、渲染、检索面板、对话
│  │  ├─ render.js    纯函数渲染与检索（浏览器 + Node 共用，便于测试）
│  │  ├─ qr.js        零依赖二维码生成（供手机扫码访问）
│  │  └─ favicon.svg
│  └─ data/law.json   结构化法典数据（由 tools/ 从 PDF 生成）
├─ deploy/            部署配置：Dockerfile、compose、render/railway/fly、systemd、部署指南
├─ tools/             PDF → 结构化数据的完整流水线（Python 标准库）
├─ tests/             四个测试套件
├─ dist/              构建产物（node server/build.js 生成）
└─ build/             中间产物（抽取结果、测试日志）
```

---

## 三、数据是怎么来的

原始文件是排好版的 PDF（含矢量文本、无文本层缺失），但字体是**逐页重新子集化**的：
同一个字节码 `0x01` 在第 5 页是「十」，在第 12 页可能是「错」。因此不能整体合并
ToUnicode 表，必须**按页选择字体映射**。`tools/pdf_text.py` 用 Python 标准库
（`re` + `zlib`）实现了一个针对该文档的 PDF 文本抽取器：

1. 单遍切分所有 `N 0 obj … endobj`，按 `/Length` 精确取流（不能 `rstrip` 换行，
   否则会破坏 zlib 数据）
2. 解析 `/ToUnicode` CMap（`bfchar` / `bfrange` / `codespacerange` 的字节宽度）
3. 按 `/Pages → /Kids → /Resources → /Font` 解析每页的字体资源
4. 解释内容流：`Tf` 选字体、`Td/TD/Tm/T*` 维护文本矩阵、`Tj/TJ/'/"` 取文本，
   按**基线 y 坐标分行、x 坐标排序**还原阅读顺序，并按字宽估算补空格
5. 输出 `build/lines.tsv`（页码 · 字号 · 文本），字号用于区分标题与正文

```
# 完整重建流程（需要原始 PDF）
python tools/pdf_text.py  "法典.pdf" build/clean.txt build/lines.tsv
python tools/structure3.py build/lines.tsv build/law.raw.json
python tools/indexer.py    build/law.raw.json public/data/law.json
```

`indexer.py` 还会清洗版式噪声（页眉、页码、重复段落、`三 区` 这类分字空格），
并生成 `toc` / `index` / `search_docs` 等供前端使用的派生字段。

---

## 四、AI 问答是怎么工作的

```
提问 ──► 分词（CJK 单字 + 二元组 + 拉丁词 + 同义词扩展）
      ──► BM25 排序（标题命中加权、一区/三区/全服区域加权）
      ──► 取前 3 条，按句子打分选出真正回答问题的句子
      ──► 生成答案 + 条号引用 + 置信度；低置信度时明确说明「未找到对应条款」
```

设计取舍：**不做无依据的自由生成**。本地引擎直接从条文里选句子，因此不会编造条号
和金额；配置大模型后，模型也只看得到检索到的条文，并要求引用条号。

已覆盖的问答类型：定罪与处罚、区域差异、诉讼程序、公职职权、经济规则、
追责时效；寒暄类问题走引导回复，无关问题走兜底回答并提示房主最终解释权。

---

## 五、接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 首页（法典数据内联，首屏无需额外请求） |
| GET | `/api/health` | 服务状态、条数、当前引擎 |
| GET | `/api/law` | 结构化法典 JSON |
| GET | `/api/search?q=盗窃&limit=8` | 检索 |
| POST | `/api/search` | 检索（JSON body：`{ query, limit }`） |
| POST | `/api/ask` | 问答（JSON body：`{ question, history }`） |

`/api/ask` 返回 `answer`、`blocks`（按条分组的答案句）、`citations`（条号 + 摘录 +
锚点）、`confidence`、`intent`、`suggestions`、`engine`、`elapsedMs`。

---

## 六、测试

```bash
node tests/render.test.js     # 数据结构、渲染输出、检索命中（37 项）
node tests/qr.test.js         # 二维码矩阵结构 + 独立解码器回读（36 项）
node tests/server.test.js     # HTTP 接口、静态资源、DOM 契约、弹层默认隐藏（48 项，需先启动服务）
node tests/deploy.test.js     # 构建产物、纯静态模式、外部 API 模式、dist 独立运行（24 项）
```

合计 145 项。浏览器相关的部分（渲染 HTML、检索排序、二维码、弹层可见性）都用
「同一份逻辑在 Node 里跑」的方式验证，不依赖真实浏览器。

---

## 七、界面说明

- **总览**：法典定位、结构导览、手机访问二维码、常见问题（点击条号直接跳到原文）
- **法典全文**：左侧固定目录（滚动高亮），中间正文；顶部按 `全服通用 / 一区专属 /
  三区专属` 筛选；`#/law/art-九` 这样的锚点链接可直接分享某一条
- **AI 法务问答**：对话流式渲染，回答下方是可点击的「引用条文」卡片
- **检索面板**：按 `/` 打开，支持上下键选择、回车跳转
- 支持深色模式、移动端布局、打印（打印时自动隐藏导航与目录）

---

## 八、内容声明

本法典最终解释权、最高决定权与修改权专属房主所有。本站内容按 G2.8 文本整理，
如与房主公示的正式文本存在差异，以房主公示文本为准。
