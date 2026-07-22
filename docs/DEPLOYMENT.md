# 部署说明

当前支持单机 Node.js 24 + SQLite 部署。应用监听 loopback，由 Nginx 等反向代理终止 TLS；SQLite、素材与备份必须位于本机 POSIX 文件系统。

## 发布流程

```bash
npm ci
npm run repo:check
npm run typecheck
npm run lint
npm run test
npm run build
npm run release:preflight
npm run acceptance
npm start
```

构建产物为 `dist/` 和 `dist-server/server.mjs`。生产配置以 [deploy/pias.env.example](../deploy/pias.env.example) 为模板，systemd 与 Nginx 样例分别见 [deploy/pias.service.example](../deploy/pias.service.example) 和 [deploy/nginx-pias.conf.example](../deploy/nginx-pias.conf.example)。

详细目录权限、备份、健康检查、日志、发布与回滚步骤见 [operations/deployment-runbook.md](operations/deployment-runbook.md)。数据库操作见 [operations/database-runbook.md](operations/database-runbook.md)，统一预检见 [operations/release-preflight.md](operations/release-preflight.md)。
