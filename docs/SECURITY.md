# 安全边界

## 身份与权限

- 密码使用 scrypt 哈希，特权角色强制 TOTP MFA。
- Session 使用 HttpOnly、SameSite=Strict Cookie；写请求同时校验 CSRF、Origin 与媒体类型。
- 权限只依据服务端生成的 `AuthContext`，不信任客户端提交的角色、Tenant、Project 或审计 actor。
- Tenant 不一致返回资源不可见；非特权用户还必须具备对应 Project 范围。
- 成员停用、会话超时和邀请撤销会阻断后续访问。

## 数据与密钥

- 身份配置、Fal 推理 Key、Fal Admin Key、邮件 Webhook Key、邀请加密 Key 必须分离保存，文件权限为 `0600`。
- 生产环境不得用明文环境变量传递 Fal Key；使用 `FAL_KEY_FILE` 与 `FAL_ADMIN_KEY_FILE`。
- 数据库、素材和备份目录按敏感业务数据保护；日志不得记录 Cookie、Prompt、图片 URL、请求正文、错误堆栈或密钥。
- 生产端口只监听 loopback，由同机 TLS 反向代理对外提供服务。

完整权限矩阵见 [architecture/auth-tenant-design.md](architecture/auth-tenant-design.md)，发布安全门禁见 [operations/release-preflight.md](operations/release-preflight.md)，组织邀请操作见 [operations/organization-management.md](operations/organization-management.md)。
