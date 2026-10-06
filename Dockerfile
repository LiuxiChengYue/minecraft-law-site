# 《我的世界》世界基本法典 · 官方网站
# 零依赖 Node 服务，镜像 ~90MB
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0

WORKDIR /app

# 只复制运行所需内容（法典数据已内联进 index.html）
COPY public/ ./public/
COPY server/ ./server/
COPY README.md ./

# 不用 root 运行
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
