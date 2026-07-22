# PIAS 中文节点式图片工作台

面向企业图片生产的中文无限画布工作台。系统将素材、场景、AI 任务、结果、审核、额度和组织权限放在同一条可追踪链路中，并通过 Fal 队列执行图片生成与编辑任务。

## 启动方式

要求 Node.js 24。

```bash
npm ci
npm run dev
```

开发地址：`http://127.0.0.1:5173/`。

生产构建与启动：

```bash
npm run build
npm start
```

完整生产配置见 [环境变量](docs/ENVIRONMENT.md) 与 [部署说明](docs/DEPLOYMENT.md)。

## 技术栈

- React 19、TypeScript、Vite
- React Flow 无限画布
- Node.js HTTP 服务、SQLite
- Fal 图片模型与异步队列
- Vitest、Testing Library、ESLint

## 核心功能

- 场景、任务、结果节点的自由拖拽、连线、缩放和版本谱系
- 生成、融图、多角度、定向光、去除、抠图、扩图、超分八类 Fal 工作流
- 队列进度、取消、失败恢复、额度冻结结算和供应商成本对账
- 项目、素材、画布、审核、用量、审计和自动持久化
- 邮箱登录、MFA、RBAC、Tenant/Project 隔离和成员邀请
- SQLite 作业租约、后台 Worker、备份恢复和单机生产部署

## 文档入口

- [系统架构](docs/ARCHITECTURE.md)
- [安全边界](docs/SECURITY.md)
- [部署说明](docs/DEPLOYMENT.md)
- [环境变量](docs/ENVIRONMENT.md)
- [验收说明](docs/ACCEPTANCE.md)
- [产品需求](docs/PRD_企业级AI全链路内容生产工作台_图片MVP_V1.2.md)
- [运维手册](docs/operations)
