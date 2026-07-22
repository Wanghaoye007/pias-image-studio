# Content Studio 局域网部署设计

## 目标

让同一可信局域网内的运营人员通过 HTTPS 使用完整 Content Studio，包括登录、项目隔离、画布保存、素材、Fal 任务和审核流程，同时保持 Fal Key、SQLite 和内部服务端口不直接暴露。

## 方案选择

采用“回环生产服务 + 自带 HTTPS 网关”方案：

```text
运营浏览器 -> HTTPS LAN Gateway -> 127.0.0.1 Production Server
                                      -> Auth / SQLite / Assets / Fal Worker
```

未采用直接开放 Vite 开发服务器，因为开发模式不适合承载真实账号、素材和 Fal 凭证。未要求 Caddy/Nginx，避免把首次部署依赖扩大到系统级软件安装；后续可无缝替换网关，内部生产服务仍维持原有回环边界。

## 安全边界

- 生产服务继续只允许 `127.0.0.1` 或 `::1`，且 Cookie 保持 `Secure`、`HttpOnly`、`SameSite=Strict`。
- 网关只能绑定 RFC 1918 私有 IPv4 地址，不接受 `0.0.0.0`、公网地址或回环地址。
- 对外地址必须是与网关主机和端口一致的 HTTPS Origin。
- TLS 私钥、身份配置和一次性凭据文件权限必须为 `0600`。
- Fal Key 只由生产服务读取，浏览器和 HTTPS 网关都不能读取或返回它。
- 网关固定转发到配置的回环服务，不接受客户端指定上游，不构成开放代理。
- 局域网防火墙应只允许公司网段访问网关端口；不得配置公网端口映射。

## 组件

### HTTPS 网关

`scripts/lan-gateway-core.mjs` 提供配置验证、HTTPS Server 和固定上游反向代理。`scripts/start-lan.mjs` 导入已构建的生产服务，先启动回环服务，再启动网关，并统一处理退出信号。

### 账号引导

`scripts/bootstrap-lan-auth.mjs` 创建一个强制 MFA 的 Owner 和一个无 MFA 的 Creator。密码与 TOTP Secret 随机生成；身份配置只保存 scrypt 哈希，一次性明文仅写入独立 `0600` 凭据文件。

### TLS 证书

`scripts/generate-lan-certificate.mjs` 使用系统 OpenSSL 生成本地 CA 和带私有 IP SAN 的服务证书。运营设备只需安装 CA 证书；CA 私钥不得分发。

### 常驻运行

LaunchAgent 使用 Node 24 的 `--env-file` 启动 `scripts/start-lan.mjs`，开机登录后自动恢复。标准输出和错误日志写入私有运行目录。

## 数据流

1. 浏览器访问局域网 HTTPS Origin。
2. 网关终止 TLS，并将原始 `Origin`、Cookie、CSRF 请求头和请求体转发到回环服务。
3. 生产服务执行同源校验、认证、RBAC、Tenant/Project 隔离和 API 限流。
4. SQLite、素材和 Fal Worker 均在服务端运行；响应沿原连接返回。

## 故障处理

- 配置不安全或证书权限错误时拒绝启动。
- 内部生产服务启动失败时不开放网关。
- 上游不可达时只返回稳定的 `502 LAN_GATEWAY_UPSTREAM_UNAVAILABLE`，不暴露路径或底层错误。
- 网关停止时先停止接受新请求，再关闭生产服务。

## 验收

- 私有 IP 上的 HTTPS `/api/health/live` 返回 200。
- `/api/health/ready` 返回 200，数据库、构建产物、素材目录和身份检查均为 `ok`。
- 未登录访问业务 API 返回 401；Owner 需要 MFA；Creator 不能执行管理员操作。
- 登录后可保存画布、刷新恢复、提交 Fal 任务，并确认 Key 不出现在 HTML、响应或浏览器存储。
- `repo:check`、`typecheck`、`lint`、`test`、`build` 全部通过。
