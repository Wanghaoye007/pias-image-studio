# 验收说明

## 代码质量门

```bash
npm run repo:check
npm run typecheck
npm run lint
npm run test
npm run build
```

五项命令必须全部返回 `0`。`repo:check` 检查仓库卫生；其余命令分别验证静态类型、代码规范、自动化测试与前后端产物。

## 发布门禁

```bash
npm run release:preflight
npm run acceptance
```

`release:preflight` 校验生产配置、身份、密钥、数据库、回滚备份、邮件、Fal Billing 和构建产物。`acceptance` 校验 [acceptance/manifest.json](../acceptance/manifest.json) 中的必选业务证据与自动化检查。

报告模式 `npm run release:preflight:report` 和 `npm run acceptance:report` 用于查看阻塞项，不替代发布门禁。验收标准、项目报告、整改记录和证据入口见 [acceptance/README.md](acceptance/README.md)。
