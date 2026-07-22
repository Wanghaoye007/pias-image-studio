# Fal 费用对账运维手册

## 目标与边界

Content Studio 将客户额度和供应商采购成本分离处理：

- 客户侧只显示企业额度单位，每个 Job 通过不可变 Reserve、Charge 和 Release 条目对账。
- 供应商成本通过 Fal Billing Events Admin API 按上游 `request_id` 拉取，只保存在服务端私有 Fal 作业快照。
- 普通任务、结果和用量 API 不返回 `unit_price`、`cost_estimate_nano_usd` 或折扣信息。
- 普通队列响应的计费单位头不作为真实账单替代；账户折扣后成本以 Billing Events 为准。

Fal 官方参考：[Billing Events API](https://fal.ai/docs/platform-apis/v1/models/billing-events)、[Pricing](https://fal.ai/docs/documentation/model-apis/pricing)。

## 生产配置

1. 分别创建推理 Key 和具有 Billing Events 读权限的 Admin Key，禁止共用。
2. 将两个密钥分别写入只有服务账户可读的文件：

```bash
install -m 600 /dev/null /etc/content-studio/fal-inference.key
install -m 600 /dev/null /etc/content-studio/fal-admin.key
```

3. 在服务环境中只配置文件路径，不把密钥写入仓库、命令行参数或前端环境变量：

```bash
FAL_KEY_FILE=/etc/content-studio/fal-inference.key
FAL_ADMIN_KEY_FILE=/etc/content-studio/fal-admin.key
CONTENT_STUDIO_FAL_BILLING_RETRY_MS=300000
```

`FAL_ADMIN_KEY` 只用于受控制的 Secret Manager 注入；本地文件部署优先使用 `FAL_ADMIN_KEY_FILE`。系统不会在 Admin Key 缺失时回退使用推理 Key。

## 上线前预检

```bash
npm run fal:billing:check
```

成功只输出不含密钥和账单正文的状态：

```json
{"ok":true,"status":200,"reason":"billing_access_confirmed"}
```

以下结果必须阻断生产发布：

| reason | 含义 | 处理 |
| --- | --- | --- |
| `admin_key_missing` | 未配置独立 Admin Key | 检查文件路径和服务账户读权限 |
| `billing_access_denied` | Key 无 Admin API 账单权限 | 在 Fal 控制台创建或轮换正确的 Admin Key |
| `billing_api_unreachable` | 网络、DNS 或 TLS 失败 | 检查出站策略后重试 |
| `billing_api_error` | Billing Events 返回其他错误 | 核对 Fal 服务状态与 API 变更 |

## 运行与对账

- 任务终态后立即尝试对账；Billing Events 尚未生成时保持 `pending`。
- 后台 Worker 按 `CONTENT_STUDIO_FAL_BILLING_RETRY_MS` 冷却周期重试 `pending` 和 `unavailable` 记录，配置修复后无需手工改数据。
- 只有全部上游 request ID 均获得 Billing Event 时才标记 `confirmed`；部分返回不得冒充完成。
- 客户额度与供应商成本允许口径不同：Content Studio V1 失败或取消默认释放客户额度，但供应商已产生成本仍会记入内部对账。

任何对账差异先保留 Job、上游 request ID 和私有账单快照，不得直接修改客户余额字段；调整必须走后续双审 Adjustment 流程。
