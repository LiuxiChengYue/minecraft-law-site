# 部署指南

网站本身没有依赖、不需要构建产物，**任何能跑 Node 18+ 的地方都能跑**。
下面按「省事程度」排序，任选一种。

---

## 方案 A：Render.com（最省事，免费套餐够用）

1. 把这个项目推到 GitHub（`cr-law-site` 整个目录即可）
2. 打开 <https://dashboard.render.com> → **New** → **Blueprint**
3. 选中你的仓库，Render 会自动读取 `render.yaml`
4. 部署完成后得到 `https://<name>.onrender.com`

免费套餐的注意点：15 分钟无访问会休眠，下次打开约需 30 秒唤醒；
需要大模型增强时，在 Render 的 Environment 里填 `LAW_LLM_API_KEY`。

---

## 方案 B：Docker（自有服务器 / NAS / 云主机）

```bash
# 在项目根目录
docker compose -f deploy/docker-compose.yml up -d --build
```

或不用 compose：

```bash
docker build -f deploy/Dockerfile -t law-site:g2.8 .
docker run -d --name law-site --restart unless-stopped -p 8787:8787 law-site:g2.8
```

放到 Nginx / Caddy 后面提供 HTTPS（Caddy 最省事，自动签证书）：

```caddyfile
law.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

---

## 方案 C：Fly.io

```bash
fly launch --no-deploy --copy-config --dockerfile deploy/Dockerfile
fly deploy
```

`deploy/fly.toml` 里已经把 `auto_stop_machines` 打开：没人访问时机器自动停，
省钱；有人访问时自动拉起。

---

## 方案 D：VPS + systemd（不用容器）

```bash
# 1) 上传文件
sudo mkdir -p /opt/law-site
sudo rsync -av --exclude build --exclude tests ./ /opt/law-site/

# 2) 装服务
sudo cp /opt/law-site/deploy/law-site.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now law-site
systemctl status law-site

# 3) 防火墙（用 ufw 的话）
sudo ufw allow 8787/tcp
```

---

## 方案 E：静态托管 + 独立 API

法典全文与检索**完全在浏览器里运行**，不需要后端。只有 AI 问答需要 `/api/ask`。

```bash
node server/build.js --static-only                     # 产出 dist/（纯静态）
node server/build.js --api-base https://api.example.com # 静态站 + 指向别处的 API
```

- `dist/` 可直接丢给 Cloudflare Pages / GitHub Pages / Vercel / 对象存储 + CDN
- API 单独部署在上面任一方案上，前端通过 `window.__API_BASE__` 指向它
- 纯静态模式下打开 AI 问答会给出友好提示，检索与全文不受影响

---

## 部署后自检

```bash
curl https://你的域名/api/health
# {"ok":true,"articles":40,"docs":45,"engine":"statute-retrieval","version":"G2.8",...}

curl -s -X POST https://你的域名/api/ask \
  -H 'content-type: application/json' \
  -d '{"question":"偷东西怎么判"}' | head -c 300
```

浏览器端检查：打开首页 → 点「AI 法务问答」→ 输入「使用外挂的后果」，
应返回第六条并给出引用卡片。

---

## 大模型增强（可选）

不配置时是内置的离线引擎（检索 + 条文抽取，不会编造条号）。要换成大模型组织语言：

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `LAW_LLM_API_KEY` | `sk-...` | 必填，任何 OpenAI 兼容接口 |
| `LAW_LLM_BASE_URL` | `https://api.deepseek.com/v1` | 默认 DeepSeek |
| `LAW_LLM_MODEL` | `deepseek-chat` | 默认 deepseek-chat |
| `LAW_LLM_TEMPERATURE` | `0.2` | 默认 0.2 |
| `LAW_LLM_TIMEOUT_MS` | `30000` | 默认 30 秒 |

模型调用失败会自动回退到离线抽取式回答，页面不会报错。
注意：无论用不用模型，**回答的依据都只来自检索到的条文**。

---

## 安全与合规提醒

- 这是公开站点，任何人都能调用 `/api/ask`。若担心被刷，建议在反向代理层加限流
  （Caddy: `rate_limit`，Nginx: `limit_req`），或把 `LAW_LLM_API_KEY` 留在服务端环境变量里
  并控制调用量
- 法典里涉及玩家 ID、内部职位等信息都属于公开条款内容，本站未额外收录任何玩家数据
- 首页与页脚已注明：法典最终解释权归房主，与房主公示文本冲突时以其公示文本为准
