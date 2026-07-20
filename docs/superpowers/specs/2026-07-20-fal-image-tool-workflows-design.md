# PIAS 图片工作台 Fal 全节点工作流设计

## 目标与决策

将工作台现有八个业务节点全部接入 Fal，并保持「业务节点稳定、模型可替换」的产品边界。画布继续使用 `generate`、`blend`、`angle`、`light`、`remove`、`extract`、`expand`、`upscale` 八个 Profile ID；服务端统一负责凭证、参数校验、Fal 队列、子任务编排、结果标准化、取消和安全错误映射。

采用「统一 Fal 作业编排器 + 专用模型适配器」方案：

- 不为每个节点复制一套 HTTP 代理和轮询代码。
- 不用一个通用编辑模型冒充所有能力；抠图、擦除、扩图和超分使用专用 endpoint。
- 节点只提交稳定业务参数，模型字段在服务端适配器内生成。
- 一个本地 Job 可对应一个或多个 Fal 子请求。编排器聚合状态、结果和取消操作。

备选方案一是八套独立代理，短期直接但会重复凭证、队列、错误和结果代码。备选方案二是全部使用通用图像编辑模型，接入最少但透明通道、蒙版擦除、画布扩展和尺寸控制无法形成可信契约。两者均不采用。

## 模型调查结论

| 工作台节点 | 首选 Fal endpoint | 使用原因 | 执行形态 |
| --- | --- | --- | --- |
| 生成 | `fal-ai/bria/product-shot` | 面向电商商品场景，输入商品图和场景描述，强调商品完整性，原生支持 1-4 个结果 | 单请求、多结果 |
| 融图 | `fal-ai/bria/product-shot` | 同一 endpoint 的 `ref_image_url` 路径明确接收商品图和目标场景图，避免按上传顺序猜角色 | 单请求、多结果 |
| 多角度 | `fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles` | 原生支持旋转、推进、垂直角度、广角和 1-4 个结果 | 单请求、多结果 |
| 定向光 | `bria/fibo-edit/edit` | 通用编辑指令可表达当前八方向、强度和色温；专用 `relight` endpoint 只提供四种粗方向，无法完整承接现有 UI | 1-4 个并行子请求，标记实验级方向控制 |
| 去除 | `fal-ai/bria/eraser` | 原生接收源图和用户笔刷生成的二值 Mask，支持 `manual` mask 和 Alpha 保留 | 单请求、单结果 |
| 抠图 | `fal-ai/bria/background/remove` | 专用前景分割，输出透明 PNG，保留输入尺寸 | 单请求、单结果 |
| 扩图 | `fal-ai/bria/expand` | 原生接收目标画布、原图尺寸、原图左上角位置和可选英文描述 | 1-4 个并行子请求 |
| 超分 | `fal-ai/topaz/upscale/image` | 支持 High Fidelity V2、1-4 倍、PNG、锐化/降噪/压缩修复，适合商品文字与 Logo 保护 | 单请求；超过 4 倍时顺序执行两段 |

官方契约：

- [Bria Product Shot](https://fal.ai/models/fal-ai/bria/product-shot/api)
- [Qwen Multiple Angles](https://fal.ai/models/fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles/api)
- [Bria Fibo Edit](https://fal.ai/models/bria/fibo-edit/edit/api)
- [Bria Eraser](https://fal.ai/models/fal-ai/bria/eraser/api)
- [Bria Background Remove](https://fal.ai/models/fal-ai/bria/background/remove/api)
- [Bria Expand](https://fal.ai/models/fal-ai/bria/expand/api)
- [Topaz Upscale](https://fal.ai/models/fal-ai/topaz/upscale/image/api)

## 真实技术 Spike

2026-07-20 使用当前 Fal 账户逐 endpoint 执行一张官方或工作台样例。所有 Key 读取均在 Node.js 进程内完成，输出未包含凭证。

| 节点 | 结果 | Fal request ID | 耗时 |
| --- | --- | --- | --- |
| 生成 | 成功，PNG 836x1254 | `019f800f-2481-7d40-aa09-4adc3501cd0d` | 38.8s |
| 融图 | 成功，PNG 836x1254 | `019f800f-ba50-7941-9869-ea01f6374332` | 26.8s |
| 定向光专用四向 | 成功 | `019f8010-2309-77b1-af6c-20253c549e0d` | 15.8s |
| 定向光左上指令 | 成功，PNG 1024x1024 | `019f8011-8fac-7882-a290-2c0893952ee5` | 18.8s |
| 去除 | 成功，PNG 3632x5456 | `019f8010-60d8-7ed1-86bd-32ae3122fb7a` | 20.9s |
| 抠图 | 成功，透明 PNG 512x512 | `019f8011-410a-7ec3-9f39-0c16bac6de10` | 3.8s |
| 扩图 | 成功，PNG 1200x674 | `019f8010-b83b-7fd2-be88-f4036319bbf1` | 9.4s |
| 超分 | 成功，PNG | `019f8010-dd19-7263-b54b-efc9664e1227` | 14.3s |

多角度已在上一批真实验证通过，请求 ID 为 `019f7ffe-f458-7f20-80f4-f7c2185fa04c`。抠图第一次使用 Fal 文档中的临时示例 URL 返回 422；改用工作台本地 PNG 的 Data URI 后成功，因此客户端必须统一准备本地素材，不能依赖示例 URL 的长期有效性。

## 统一 API 与编排器

本地服务暴露统一路由：

- `POST /api/fal/jobs`：提交 `{ profileId, imageUrls, prompt, ratio, outputCount, parameters, maskImageUrl }`，返回本地 `requestId`、实际 `modelId`。
- `GET /api/fal/jobs/:id/status`：返回聚合的 `queued | running | completed`、进度和脱敏日志。
- `GET /api/fal/jobs/:id/result`：返回统一 `{ images, seed?, modelId, childRequestIds }`。
- `DELETE /api/fal/jobs/:id`：取消尚未终止的全部 Fal 子请求。

编排器为每个本地请求保存内存态子任务列表。原生支持多结果的模型只提交一次；单结果模型按输出数创建多个子请求。聚合状态规则：任一子任务运行即为 `running`；全部进入完成态后为 `completed`；读取结果时保留成功图片，全部失败才返回失败。当前本地 Vite 服务重启后内存请求不可恢复，生产版必须将编排状态迁移到数据库与队列。

服务端错误使用稳定中文码：`FAL_INVALID_INPUT`、`FAL_CREDENTIALS`、`FAL_SUBMIT_FAILED`、`FAL_STATUS_FAILED`、`FAL_RESULT_FAILED`、`FAL_EMPTY_RESULT`、`FAL_CANCEL_FAILED`。上游响应体、Data URI、Key 和完整模型日志不返回浏览器。

## 节点工作流

### 生成

1. 客户端准备当前 Scene 商品图。
2. 服务端将 `sceneTemplate` 映射为冻结版本的英文场景描述，再追加经过约束的用户补充描述。
3. `quality=快速` 映射 `fast=true`，`quality=精细` 映射 `fast=false`。
4. 比例映射为约 1MP 的 `shot_size`，商品位置使用 `manual_placement`；`outputCount` 映射 `num_results`。
5. 调用 Product Shot，标准化 `images[]`。

### 融图

1. 当前 Scene 是商品输入，参考素材必须显式作为目标场景。
2. `image_url` 发送商品图，`ref_image_url` 发送场景图，`num_results` 发送输出数。
3. Product Shot 的参考图模式不提供数值融合强度，现有 `blendStrength` 不继续伪装成模型参数；界面改为商品位置预设，第一批默认 `bottom_center`。
4. 补充描述只保存到任务快照。Fal 不接受参考图与场景描述同时作为该路径的确定性输入，界面明确说明参考场景优先。

### 多角度

沿用已实现适配器。水平旋转、推进、垂直角度、广角、比例和输出数直接映射官方字段。模型会推断不可见区域，结果始终要求人工复核。

### 定向光

1. 服务端把八方向、0-100 强度、2800-7500K 色温和补充描述组成英文保真编辑指令。
2. 指令明确要求不改变商品结构、标签、颜色、背景、构图、相机角度和数量。
3. Fibo Edit 单请求单结果；输出 2 或 4 张时并行扇出并使用不同 Seed。
4. Fal 当前没有可验证的八方向数值控制 endpoint，因此节点显示「实验级方向控制」，不能把结果描述为几何确定性打光。

### 去除

1. 画布进入笔刷模式，用户在源图上涂抹待移除区域；笔刷大小控制实际路径宽度。
2. 客户端导出与源图同宽高的黑底白色二值 PNG Mask。
3. 提交源图、Mask、`mask_type=manual`、`preserve_alpha=true`。
4. 去除是确定性单结果节点，隐藏输出数量和比例控件；没有有效笔画时禁止提交。

### 抠图

输入源图，调用 Background Remove，返回透明 PNG。该节点固定一个结果、保持源尺寸和比例；`edgePrecision` 暂无对应官方参数，界面不再把它显示为已生效的模型控制。后续如需边缘精修，应增加独立后处理而非伪造映射。

### 扩图

1. 比例决定目标画布尺寸；原图缩放百分比决定 `original_image_size`。
2. 九宫格锚点决定 `original_image_location`，客户端预览与服务端计算共用纯函数。
3. 中文补充描述原样追加到冻结的英文场景模板中，避免静默丢弃用户输入；空描述允许调用。
4. Expand 单请求单结果，输出 2 或 4 张时并行扇出。
5. 相同比例且原图 100% 时禁用提交。

### 超分

1. 客户端读取源图真实宽高，按目标长边 2K、4K、8K 计算需要倍率。
2. 每次 Topaz 调用倍率限制在 1-4；超过 4 倍时先执行 4 倍，再用首段输出执行剩余倍率。
3. 使用 `High Fidelity V2`、`face_enhancement=false`、`output_format=png`，将细节增强映射到 `sharpen`，默认低创造性。
4. 目标不大于源尺寸时阻止提交；输出固定一个结果。

## 前端和数据调整

- 用通用 `runFalImageJob` 替换多角度专用客户端，统一准备源图、参考图和可选 Mask。
- `ExternalExecution.requestId` 保存本地编排 ID；`modelId` 保存实际首选模型。结果元数据可附加脱敏子请求 ID 列表，但不保存 Data URI。
- 去除、抠图、超分固定单结果；去除和抠图隐藏比例。生成、融图、多角度、定向光、扩图保留 1/2/4 输出。
- 画布新增 Remove Mask Overlay；Expand Overlay 增加可点击九宫格锚点。
- 结果详情继续显示模型 ID、请求 ID、尺寸、Seed 和业务参数。

## 测试与验收

1. 每个适配器有输入契约单测，覆盖比例、数量、参数边界和模型 ID。
2. 编排器测试原生多结果、并行扇出、部分成功、聚合进度、取消和安全错误。
3. 客户端测试本地素材转 Data URI、参考素材角色、轮询和取消。
4. 工作台测试八个节点都走 Fal，不再触发模拟定时器；确定性节点固定单结果。
5. 去除 Mask 和扩图锚点做交互测试；无笔画、无参考场景、无扩展区域时禁止提交。
6. 自动测试不进行付费调用；完成后每个节点用当前 Key 做一次单图真实验收。
7. 桌面和移动端截图检查参数面板、画布覆盖层、任务状态、结果节点和错误提示。
8. Key 不进入源码、前端响应、浏览器存储、截图、日志或 Git。

## 明确边界

- 这批完成 Fal 能力封装与本地可运行闭环，不等同于 PRD 中的生产数据库、对象存储、计费台账、租户路由、Webhook 恢复和 20 SKU 质量基准。
- 定向光八方向是模型指令控制，必须保留实验级标记，直到基准评测证明方向命中率。
- 模型“调用成功”不等于商品保真达到发布门槛。上线前仍需按 PRD 第 5.3 和 22.2 节执行冻结基准集评测。
