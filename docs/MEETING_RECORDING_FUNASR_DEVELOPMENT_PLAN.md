# 会议录音、FunASR 转写与功能估算开发计划

> 方案日期：2026-07-29  
> 最近更新：2026-07-30  
> 状态：阶段 0 HTTP PoC 与单节点异步 Job API 基线已实现；阶段 1 会议数据库、私有 Storage、RLS/RPC、基础页面、浏览器 TUS 上传及 Trigger.dev 转写编排代码已实现；相关 migration 均已部署，本地 Trigger.dev worker 已通过真实共享云项目烟测；转写校对 MVP 与音频安全播放代码已实现，待部署校对 workflow migration 后进行真实页面验收；Trigger.dev 云端任务尚未部署  
> ASR 决策：自托管 FunASR，通过 HTTP API 集成，不使用 MCP  
> 本文定义完整开发方案、阶段和验收标准；当前已打通 Storage → 本地 Trigger.dev worker → 自托管 FunASR Job API → PostgreSQL 的真实端到端链路，并实现 machine → human draft → 自动保存/并发保护 → 人工批准以及短期签名 URL 播放和片段时间码跳转。会议分析、估算版本化、Trigger.dev 云端部署及生产环境验收仍待实施。

## 0. 快速验证记录（2026-07-29）

已在 Apple Silicon Mac、Python 3.14.4、PyTorch/TorchAudio 2.11.0、FunASR 1.3.30、CPU 模式下完成第一轮官方 HTTP 服务验证：

- `GET /health` 正常，SenseVoice 和 Paraformer 可按请求延迟加载；
- `GET /v1/models` 返回 `fun-asr-nano`、`sensevoice`、`paraformer`；
- SenseVoice 对 4.204 秒官方样本连续 3 次返回相同文本，热启动耗时约 0.54–0.74 秒；
- Paraformer 首次请求因下载和加载模型耗时约 495 秒，热启动后相同样本约 0.63 秒；
- Paraformer 返回标点，但 `language` 为 `unknown`，当前 `words` 为空；
- OpenAPI 的 `/v1/audio/transcriptions` 参数仅包含 `file`、`model`、`language`、`response_format`、`spk`，没有热词参数；
- `spk=true` 会延迟加载 CAM++，单说话人样本热启动后返回 `SPK0`；
- 31.4 秒、两种系统合成声音的临时样本可完成转写，但本次聚类仍全部为 `SPK0`，不能据此确认多人分离质量；英文技术名词识别也明显不足；
- 当前 OpenAI 兼容服务的 Paraformer fallback 在拿不到 `sentence_info` 时，会按文本长度生成粗粒度时间段；这类 `start/end` 不能直接视为模型真实句段时间码；
- `/asr` 虽声明支持 `hotwords`，但当前实现会尝试加载 `fun-asr-nano`，本机 CPU 请求超过 180 秒并使单进程服务失去响应，因此它不能作为当前 Paraformer 热词验证接口；
- Homebrew FFmpeg 最初因异常 `.reinstall` keg 和 `libvpx.11.dylib` ABI 不匹配而不可运行；已恢复 keg、升级到 `ffmpeg 8.1.2_1`，当前 `libvpx 1.16.0` 正确提供并链接 `libvpx.12.dylib`；
- Python 3.14 进程外直接导入完整 FunASR 曾触发 Numba/coverage 兼容异常；进一步确认该异常由项目根目录的 `coverage/` 测试报告目录遮蔽 Python 的 `coverage` 模块造成，在项目目录外导入 `AutoModel` 正常。生产服务仍建议使用独立工作目录和 Python 3.12，避免应用仓库文件名影响 Python 依赖导入；
- 重启为预加载 Paraformer 后，健康检查立即返回 `models_loaded=["paraformer"]`，4.204 秒样本普通转写约 0.84 秒，`spk=true` 首次约 1.56 秒；31.4 秒合成样本普通转写约 1.14 秒、speaker 转写约 1.83 秒；
- 同时提交 4 个 31.4 秒请求全部成功并返回一致文本，完成时间约 1.14、2.25、3.39、4.51 秒，表现为单进程内近似串行处理；正式容量规划不能把 HTTP 并发等同于模型并行；
- Paraformer 原生 `AutoModel.generate()` 实测会返回逐 token/字的 `timestamp` 毫秒数组，当前 OpenAI 兼容包装层没有映射该字段，反而在没有 `sentence_info` 时生成粗粒度估算 segments；生产 HTTP 层必须保留原生 timestamp 并构造可信时间码；
- Paraformer 原生 `generate(..., hotword="交易 停滞 功能估算")` 已验证可用，日志确认热词被解析；当前 `/v1/audio/transcriptions` 没有暴露该参数，因此需在生产 HTTP 契约中增加并传递 `hotword`，不应调用只面向 Fun-ASR-Nano 的 `/asr` 端点；
- 已在 `services/funasr/` 实现独立 FastAPI HTTP PoC：Bearer Token、分片上传、500 MB/2 小时限制、热词、可选 CAM++、原生时间码、健康检查和单实例单并发；
- 修复后真实 4.204 秒样本返回 13 个全局 token 及 13 个句段内 token，时间范围为 480–3775 ms，`alignment.status=aligned` 且无 warning；句段 token 由全局模型时间码按句段范围归属，不按文本长度估算；
- `diarize=true` 真实烟测返回 `speaker_0`、`speaker_id=0` 和 `speaker_scope=recording`；短单人样本只验证调用路径，不代表多人聚类质量；
- 当前自动化验证为 26 项测试全部通过，包括第二个并发推理请求触发容量拒绝、HTTP 429/`Retry-After` 契约、模型 revision 传递、时间码音频边界，以及 WebM/MP4 经 FFmpeg 标准化的 API 契约；Python 编译、模型 manifest JSON 与 `git diff --check` 均通过；测试仍有 Starlette TestClient/httpx2 迁移警告，属于依赖升级事项；
- 已实现 FFmpeg 媒体标准化层：先用 ffprobe 校验音频流和时长，再转为 16 kHz 单声道 PCM WAV；只允许 `file,pipe` 协议，源文件和派生 WAV 在请求结束后删除；
- 已完成真实浏览器格式端到端烟测：将 4.204 秒 WAV 分别编码为 WebM/Opus 和 MP4/AAC，经 HTTP 上传、FFmpeg 标准化、Paraformer 热词和 CAM++ 后，两种格式均返回相同文本、13 个已对齐 token、`speaker_0` 且无 warning；WebM 时长 4.211 秒、处理约 1.161 秒，MP4 时长 4.204 秒、处理约 0.767 秒；
- 已在 Python 3.12.12 独立虚拟环境完整安装锁定依赖，`pip check` 无破损依赖，26 项测试和 Python 编译均通过；必须从 `services/funasr/` 独立工作目录运行，若从仓库根目录导入，仍会被根目录 `coverage/` 遮蔽真正的 Python 包；
- 已完成 arm64 CPU Docker 构建与真实容器烟测。初版直接从 PyPI 安装 Linux `torch==2.11.0` 时意外拉取 CUDA 13、cuDNN、NCCL 等依赖，已修复为先从 PyTorch 官方 CPU wheel 索引安装 `torch`/`torchaudio`，最终镜像约 663.6 MB，运行时为 Python 3.12.13、Torch/TorchAudio 2.11.0+cpu、FFmpeg 7.1.5；
- 空模型缓存容器首次下载 Paraformer、FSMN-VAD、CT-Punc 和 CAM++ 后约 477 秒 ready，模型缓存约 2.1 GB；同一容器保留缓存后重启约 24.5 秒 ready。正式环境应把 `/home/funasr/.cache` 挂载到持久 volume，当前阶段不建议把约 2.1 GB 权重直接烘焙进 CPU 基线镜像；
- Docker 内 4.204 秒 WAV、4.211 秒 WebM/Opus 和 4.204 秒 MP4/AAC 均返回相同文本、13 个全局及句段 token、`alignment.status=aligned`、`speaker_0` 且无 warning；墙钟耗时分别约 2.368、1.024、1.007 秒，响应内处理耗时约 2.079、0.890、0.873 秒；
- Docker 真实并发验证中，第一个 60 秒请求成功，第二个同时请求立即返回 HTTP 429 和 `Retry-After: 1`；Bearer Token 无效时返回 401；请求结束后上传源文件和标准化 WAV 均已清理。容器 ready 后内存约 4.2 GiB，完成 60 秒请求后约 3.2 GiB；
- 已实现单节点异步 Job API 基线：SQLite WAL/FULL 持久状态、multipart 流式落盘及 SHA-256、必填 `Idempotency-Key`、FIFO 单 worker、创建/查询/排队取消、结构化结果和错误持久化、进程重启恢复，以及任务数据目录进程独占锁；
- 异步创建不接受 URL、signed URL 或文件路径，消除了 FunASR 服务主动下载任意远程资源的 SSRF 输入面；相同 key 与相同媒体/config 返回同一任务，输入冲突返回 409，队列满返回 429；
- 恢复语义明确为 at-least-once inference：`running` 任务在源媒体存在且 attempt 未达上限时恢复排队，源媒体缺失或恢复达到上限时持久化分类错误；不宣称 exactly-once；
- 默认成功/失败源媒体保留 24 小时、终态任务及结果保留 30 天，取消任务立即删除源媒体，并定期清理标准化 WAV、过期源媒体和孤儿上传目录；
- 异步任务加入后自动化测试增至 37 项，覆盖 API、并发幂等、SQLite 跨实例结果持久化、FIFO 领取、取消、恢复与恢复上限、worker 繁忙重排和保留清理。该基线仍未进行本轮 Docker 重建和真实长音频稳定性验证；
- 已新增应用侧阶段 1 基座 migration：`meetings`、`media_assets`、`processing_jobs`、`transcript_revisions`、`transcript_segments`，包含项目 owner RLS、活动任务唯一约束、私有 `meeting-audio` bucket、精确媒体对象路径策略，以及创建会议、初始化上传、完成上传和批准转写 RPC；
- 已新增项目“会议录音”Tab、会议列表/创建页、详情与处理状态页，并新增上传初始化、上传完成和任务状态查询 API；本批通过 migration 命名校验、TypeScript、定向 ESLint、92 项单元测试、15 项集成测试和 Next.js 生产构建；
- 阶段 1 基础 migration `20260730090000_add_meeting_recording_foundation.sql` 已通过 Supabase CLI 部署到 linked 云项目 `wroyjvsryyfzdhbexskr`；远端 migration history、5 张会议表、4 个 RPC，以及私有 `meeting-audio` bucket 的 500 MB 限制已核对；
- 已接入 `tus-js-client 4.3.1` 浏览器上传：使用 direct Storage hostname、6 MiB 分片、Bearer Session、`x-upsert: false`、退避重试、本地指纹恢复、进度和暂停/继续；刷新后重新选择初始化记录中的同一文件即可续传；
- 浏览器 SHA-256 改为 4 MiB 分块增量计算，不会把最大 500 MB 文件一次性读入内存；该摘要用于幂等键和后续可信后台复核，不能单独证明 Storage 对象内容可信；
- 上传完成 API 会以当前用户身份调用 Storage `info()` 回查精确对象路径，验证对象存在、实际大小与实际 MIME 后才执行完成 RPC 并创建转写任务；对象内容 SHA-256 仍需由后续后台下载流式复核；
- TUS 上传本批验证通过 TypeScript、定向 ESLint、104 项单元测试（新增 12 项上传/哈希测试）、15 项集成测试和 migration 命名校验；真实云端大文件上传与浏览器刷新恢复仍待端到端验收；
- 已加入 Trigger.dev 4.5.8 编排适配层：上传完成 API 以 processing job ID 为幂等键触发 `transcribe-meeting`，任务采用 PostgreSQL lease token 进行 fencing；单次数据库 attempt 使用稳定 FunASR Idempotency-Key，retryable 失败由数据库安排下一时间并由 Trigger durable wait 后以新 attempt 重提；
- 已实现后台 service-role client、私有 Storage REST 流式下载到临时文件、服务端 SHA-256/大小复核、FunASR Job API Zod 契约、durable polling、provider task 绑定、空稿分类失败和机器稿原子提交；音频不会由 Supabase SDK 先构造完整 Blob；
- 转写编排 migration `20260730140000_add_transcription_job_orchestration.sql` 已通过 Supabase CLI 推送至 linked 项目 `wroyjvsryyfzdhbexskr`，远端 migration history 已核对为 Local/Remote 一致，后续 dry-run 返回 `Remote database is up to date`；该 migration 包含领取/续租、可重试失败调度、provider task 不可替换约束、原子提交，以及基础 migration 的入队权限和 transcript RLS 收紧；
- 用户任务 API 和 Client Component 已改为显式安全投影，不返回 `provider_task_id`、attempt、worker ID、lease token 或 lease 时间；
- 当前应用验证结果：TypeScript 通过，112 项单元测试通过，15 项集成测试通过且 1 项按环境守卫跳过，生产构建通过，全量 ESLint 0 error/26 个既有 warning，migration 命名和 `git diff --check` 通过。Trigger.dev 尚未 deploy。
- 首次共享云项目 E2E 在 `claim_transcription_job` 暴露 `provider_task_id` 同名歧义；修复 migration `20260730170000_fix_transcription_claim_column_ambiguity.sql` 已通过 Supabase CLI 部署，并保持 RPC 仅允许 `service_role` 调用。
- 修复后已完成真实 Storage → 本地 Trigger.dev worker → 自托管 FunASR Job API → PostgreSQL 烟测：任务首次 attempt 成功，最终为 `succeeded/complete/100%`，provider task 已绑定且 lease 已释放；会议进入 `review_required`，原子生成 revision 1 的 `machine/in_review` 机器稿及 1 个合法时间段（480–3775 ms），segment confidence 保持 `null`。测试期间未向普通日志输出完整转写稿、Bearer Token 或 signed URL。
- 本轮明确标记的 E2E meeting、级联 media/job/revision/segments、私有 Storage 对象和本地临时状态文件均已删除并复查为零残留。该小样本只证明编排与持久化链路，不证明 500 MB/2 小时稳定性、真实多人 speaker 聚类质量或 P95 30 分钟 SLO。
- 真实用户上传补充验收暴露并修复两项问题：空 `search_path` 下裸 `uuid_generate_v4()` 无法解析，以及 Storage RLS 子查询将未限定 `name` 误解析为 `projects.name`。修复 migration `20260730180000` 与 `20260730190000` 均已部署，用户已确认音频上传、转写完成和进入待校对状态正常。
- 已实现转写校对 MVP 代码：从机器稿或已批准稿原子创建/恢复唯一 human draft；完整片段快照原子保存；通过 `updated_at` CAS 阻止多标签页静默覆盖；仅允许批准非空且全文与片段一致的 human revision；批准版本不可编辑，再次修改创建新版本。校对 workflow migration `20260730200000_add_transcript_review_workflow.sql` 已通过 dry-run，但尚未推送。
- 已实现私有音频安全播放与校对 UI：服务端只按已鉴权的 media asset 生成 10 分钟 signed URL，响应 `no-store`；浏览器不接触 service-role；原生音频/视频播放器支持点击时间码跳转和当前片段高亮；编辑器支持 speaker/text 修改、1 秒 debounce 自动保存、立即保存、冲突停止覆盖和批准确认。signed URL 不进入数据库、普通日志或 Langfuse。
- 当前校对批次验证结果：TypeScript、定向 ESLint、migration 命名、`git diff --check` 和 Supabase dry-run 通过；完整单元测试 17 个文件、114 项全部通过。待部署 migration 后补真实 authenticated 页面与数据库事务验收。

因此，快速烟测结论是“独立 HTTP PoC、Paraformer 原生时间码、热词、CAM++ 调用路径，以及浏览器 WebM/Opus、MP4/AAC 标准化链路均可运行”。仍未证明真实多人分离、2 小时稳定性或 30 分钟 SLO；这些能力必须在真实获授权会议录音和目标部署环境中验收。

## 1. 背景与目标

在现有售前估算系统中增加会议录音入口，使用户能够：

1. 在网页中直接录音，或上传已有音频文件；
2. 支持最长约 2 小时、最大约 500 MB 的多人需求会议；
3. 使用自托管 FunASR 完成中文为主、夹杂英文技术术语的转写；
4. 获得匿名说话人标签和句段时间码，并在目标模型支持时保留词级时间码；
5. 先人工校对转写稿，再执行会议内容分析；
6. 从已批准的转写版本生成需求、决策、待办、风险、冲突和未决问题；
7. 复用现有售前估算 Workflow 生成新估算版本；
8. 由用户确认后发布为项目正式版本，历史版本不被覆盖；
9. 按配置期限删除原始音频和派生媒体文件。

目标处理时效定义为：从音频上传完成并通过服务端校验开始，到机器转写稿可校对为止，PoC 目标为 P95 不超过 30 分钟。该目标是项目内部 SLO，不是 FunASR 的公开 SLA。

## 2. 已确定的技术决策

### 2.1 FunASR 只通过 HTTP 集成

正式业务不集成 FunASR MCP Server，也不把 FunASR 作为可由 LLM 自主调用的 Agent Tool。

集成边界为：

```text
Next.js / 后台编排
  → 内部 HTTP
  → FunASR 服务
  → 标准化转写结果
```

开发阶段可使用 FunASR 文档提供的 OpenAI 兼容接口进行模型烟测，但生产环境要在其外层提供受保护、幂等、可查询的任务 API，避免让 2 小时推理依赖一个长时间同步 HTTP 响应。

FunASR 的职责仅包括：

- ASR；
- VAD；
- 标点恢复；
- 句段或词时间码；
- 说话人 embedding 与聚类；
- 返回模型和推理元数据。

FunASR 不负责：

- 项目权限；
- 业务状态机；
- 转写版本管理；
- 会议需求分析；
- 功能及成本估算；
- 正式版本发布。

### 2.2 首期模型组合

PoC 基线采用：

```text
Paraformer-zh
+ FSMN-VAD
+ CT-Punc
+ CAM++
+ 项目领域热词
```

PoC 结束前必须冻结以下信息，不能只保存 `paraformer` 等易漂移别名：

- 每个 checkpoint 的完整模型 ID；
- revision 或内容摘要；
- FunASR、PyTorch、CUDA 和运行镜像版本；
- 推理参数；
- 热词表版本；
- 代码和每个模型权重各自的许可证快照；
- GPU 型号及基准数据。

CAM++ 提供 speaker embedding 和聚类，不应对外宣称为身份识别，也不能假定它能恢复重叠发言中已经丢失的第二路文本。

### 2.3 长任务脱离 HTTP 页面请求

会议转写、分析和估算不复用现有请求内 SSE 执行模式。后台任务必须：

- 页面关闭后继续运行；
- 支持重试和幂等；
- 支持刷新后恢复进度；
- 将数据库作为任务状态事实来源；
- 不因 Realtime 或浏览器连接中断而取消。

首选使用 Trigger.dev 编排业务任务。若实施前改用 Vercel Workflow 或其他持久任务平台，只替换编排适配层，不改变数据库状态机和 FunASR HTTP 契约。

### 2.4 大文件不经过 Next.js 中转

500 MB 音频由浏览器直接上传 Supabase Storage 私有 bucket，使用 TUS 可恢复上传。Next.js 只负责创建元数据、签发或授权上传、完成校验和启动后台任务，不读取完整音频到内存。

linked 云项目的 `meeting-audio` bucket 已配置为私有且单对象限制为 500,000,000 字节；上线前仍需确认 Supabase 套餐和项目级 Storage 配额能够承载该文件大小与每日 1–20 场会议的容量。

### 2.5 转写和估算不可变版本化

机器稿、人工修改稿、会议分析和估算结果分别版本化。发布动作只切换项目的正式版本指针，不删除或覆盖旧版本。

## 3. 总体架构

```text
浏览器 MediaRecorder / 文件选择
  ↓
IndexedDB 分片暂存
  ↓
tus-js-client 直传私有 Storage
  ↓
服务端校验对象元数据
  ↓
processing_jobs：transcription
  ↓
持久后台编排
  ↓
ffprobe / FFmpeg 探测及必要标准化
  ↓
FunASR HTTP Job API
  ↓
VAD、ASR、标点、时间码、全场 speaker 聚类
  ↓
NormalizedTranscript
  ↓
机器 transcript revision
  ↓
人工校对与批准
  ↓
meeting analysis version
  ↓
现有 analyze → breakdown → estimate → calculate
  ↓
不可变 estimate version
  ↓
人工发布
```

### 3.1 状态事实与通知

- PostgreSQL `processing_jobs` 是状态事实来源；
- Supabase Realtime Broadcast 只负责快速通知；
- 页面加载或重连时调用 REST 获取完整状态快照；
- Realtime 不可用时以 5–10 秒退避轮询兜底；
- 广播只传 ID、阶段、状态、进度和事件序号，不传完整转写稿。

### 3.2 部署单元

建议拆为三个运行单元：

1. **Next.js 应用**：认证、项目 UI、上传控制、校对、发布和查询 API；
2. **后台编排任务**：媒体校验、转写调度、分析、估算、清理和重试；
3. **FunASR GPU 服务**：内部 HTTP API、模型预热、推理队列和结果产出。

FunASR 不能部署到 Vercel Function。GPU 服务应部署在固定区域的容器或 GPU 主机，并通过私网、VPN 或带鉴权的 HTTPS 访问。

## 4. FunASR HTTP 服务设计

## 4.1 两阶段接口策略

### PoC 阶段

可直接调用官方 `funasr-server` 的 OpenAI 兼容接口：

```text
POST /v1/audio/transcriptions
GET  /v1/models
GET  /health
```

该接口用于验证模型质量、格式兼容性、显存和实时系数，不作为最终长任务协议。

### 生产阶段

在 FunASR 推理层外增加薄 HTTP 服务，提供幂等异步 Job API：

```text
POST /internal/v1/transcription-jobs
GET  /internal/v1/transcription-jobs/{id}
POST /internal/v1/transcription-jobs/{id}/cancel
GET  /internal/v1/health/live
GET  /internal/v1/health/ready
```

创建请求使用 `multipart/form-data`，媒体作为 `file` 字段直接流式上传，`Idempotency-Key` 使用请求头传递。服务不接受 `url`、`audio_url`、`signed_url` 或 `file_path`：

```bash
curl --fail-with-body \
  https://funasr.internal/internal/v1/transcription-jobs \
  -H 'Authorization: Bearer SERVICE_TOKEN' \
  -H 'Idempotency-Key: meeting-uuid-config-v1' \
  -F file=@meeting.webm \
  -F model=paraformer \
  -F language=zh \
  -F 'hotwords=["Next.js","Supabase","FunASR"]' \
  -F diarize=true \
  -F speaker_count=3
```

创建操作要求：

- 相同 `Idempotency-Key`、媒体 SHA-256 和规范化 config 重试时返回同一任务，并设置 `Idempotency-Replayed: true`；
- 相同 key 对应不同媒体或 config 时返回 409；
- key 必须为 8–128 个可见 ASCII 字符；
- 接口只在任务和源媒体被持久接收后返回 `202 Accepted` 与 `Location`；
- 不在同步创建响应中等待完整推理；
- 上传时分片计算 SHA-256，不把完整媒体读入内存；
- HTTP 服务不主动下载客户端提供的任意远程地址，避免重新引入 SSRF 输入面。

查询响应至少包含：

```json
{
  "jobId": "uuid",
  "status": "queued | downloading | processing | succeeded | failed | cancelled",
  "progressPercent": 60,
  "stage": "asr",
  "result": null,
  "error": null,
  "model": {
    "asr": "exact-model-id@revision",
    "vad": "exact-model-id@revision",
    "punctuation": "exact-model-id@revision",
    "speaker": "exact-model-id@revision",
    "runtimeImage": "digest"
  }
}
```

当前 `services/funasr/` 已实现 SQLite 单节点基线：WAL、`synchronous=FULL`、短生命周期连接、`BEGIN IMMEDIATE`、条件状态更新和 FIFO 单 worker。进程重启时 `queued` 保持排队，`running` 按 at-least-once 语义恢复；源媒体缺失和恢复次数达到上限会写入结构化终态错误。任务数据目录使用进程独占锁，因此必须以一个 Uvicorn worker 运行并挂载持久 volume。

规模扩大到多 GPU 节点时，可以替换为 Redis 或数据库持久队列，由独立 GPU worker 领取任务，但不能退回 FastAPI 进程内 `BackgroundTasks` 作为唯一任务保障。当前基线不包含多节点调度，也尚未通过 2 小时音频稳定性验收。

## 4.2 服务端目录建议

如 FunASR 服务与本项目同仓管理：

```text
services/funasr/
  app/
    api.py
    config.py
    contracts.py
    inference.py
    normalizer.py
    queue.py
    worker.py
  tests/
  scripts/
    smoke_test.py
    benchmark.py
  Dockerfile
  requirements.lock
  README.md
```

如果部署平台要求独立仓库，应在本仓库保留：

- OpenAPI 契约快照；
- 镜像 tag/digest；
- 模型 manifest；
- 部署和回滚文档；
- 测试用 fake server。

## 4.3 长音频处理

长音频不能按固定时间无条件硬切。推荐流程：

1. 使用 `ffprobe` 校验时长、编码、采样率、声道和容器；
2. 必要时转为 FunASR 已验证的标准格式；
3. 使用 VAD 找到自然语音边界；
4. 对超长连续语音增加带重叠的兜底切片；
5. 每个片段保留全局时间偏移；
6. ASR 和标点处理后合并片段，并对重叠文本确定性去重；
7. speaker embedding 在整场会议范围聚类，保持跨片 speaker ID 稳定；
8. 输出全局时间码和匿名 `speaker-1`、`speaker-2` 标签；
9. 保存原始推理结果用于排查，但业务层只消费标准化结果。

转码和切片策略必须通过真实 2 小时样本验证，不能在开发计划阶段预设一个未经测试的固定片长。

## 4.4 安全要求

- FunASR HTTP 服务不暴露到公共互联网，或必须使用 mTLS/服务令牌；
- 服务令牌放在服务端 Secret，不进入浏览器；
- 只接受允许的音频 MIME 和最大字节数；
- 下载后校验实际字节数和 SHA-256；
- 防止服务端请求伪造：只允许受信任 Storage 域名，禁用任意 URL；
- 临时文件使用任务级目录并在成功、失败、取消后清理；
- 禁止在日志和 Langfuse 中记录 signed URL、原始音频、完整转写文本和客户敏感信息；
- 健康检查区分进程存活和模型已加载；
- 容器以非 root 用户运行；
- 依赖和镜像固定版本并进行漏洞扫描。

## 5. 应用端目录与代码边界

建议新增：

```text
app/(dashboard)/projects/[id]/meetings/
  page.tsx
  [meetingId]/page.tsx

app/api/meetings/
app/api/media-assets/[id]/complete/
app/api/processing-jobs/[id]/

components/meeting/
  audio-recorder.tsx
  resumable-uploader.tsx
  recording-recovery.tsx
  job-status.tsx
  transcript-editor.tsx
  transcript-segment.tsx
  meeting-analysis-review.tsx

lib/media/
  recorder.ts
  indexed-db.ts
  mime.ts
  validation.ts

lib/storage/
  meeting-audio.ts
  resumable-upload.ts

lib/transcription/
  contracts.ts
  normalize.ts
  provider.ts
  providers/funasr-http.ts

lib/meetings/
  service.ts
  permissions.ts
  state-machine.ts

lib/workflows/meeting-processing/
  contracts.ts
  transcribe.ts
  analyze.ts
  generate-estimate-version.ts
```

如果 [WORKFLOW_AGENT_REFACTOR_PLAN.md](./WORKFLOW_AGENT_REFACTOR_PLAN.md) 尚未执行，实施时应选择当前实际目录并避免同时进行大规模目录迁移。会议功能提交不应顺带改名现有 `lib/agents/*`。

### 5.1 Provider 契约

即使首期只有 FunASR，也保留窄 Provider 接口，避免业务层依赖 FunASR 原始 JSON：

```ts
interface AsrProvider {
  submit(input: AsrSubmitInput): Promise<AsrSubmission>;
  getStatus(providerTaskId: string): Promise<AsrStatus>;
  fetchResult(providerTaskId: string): Promise<NormalizedTranscript>;
  cancel?(providerTaskId: string): Promise<void>;
  capabilities(): AsrCapabilities;
}
```

FunASR 能力声明必须真实反映当前固定模型和配置，例如：

```ts
{
  asyncJobs: true,                // 由自建 HTTP Job API 提供
  speakerDiarization: true,
  segmentTimestamps: true,
  wordTimestamps: "model-dependent",
  hotwords: true,
  maxDurationSeconds: 7200,       // 项目验收限制，不冒充上游保证
  maxFileBytes: 500_000_000       // 项目验收限制
}
```

### 5.2 标准化转写契约

```ts
interface NormalizedTranscript {
  text: string;
  language?: string;
  durationMs: number;
  segments: Array<{
    id: string;
    sequence: number;
    speakerKey?: string;
    startMs: number;
    endMs: number;
    text: string;
    confidence?: number;
    words?: Array<{
      text: string;
      startMs?: number;
      endMs?: number;
      confidence?: number;
    }>;
  }>;
  provenance: {
    provider: "funasr";
    modelManifestId: string;
    configVersion: string;
    sourceAudioSha256: string;
    generatedAt: string;
  };
}
```

标准化层必须验证：

- 时间码非负且 `startMs <= endMs`；
- 片段顺序确定；
- 总时长不超源音频容差；
- speaker key 格式统一；
- 空片段被记录或安全过滤；
- 不可解析结果进入失败状态，不能静默生成空转写。

## 6. 数据库设计

建议新增以下表。最终字段和约束必须通过独立 Supabase migration 实施。

### 6.1 `meetings`

- `id`；
- `project_id`；
- `title`；
- `status`；
- `created_by`；
- `approved_transcript_revision_id`；
- `latest_analysis_version_id`；
- `latest_estimate_version_id`；
- `created_at`、`updated_at`。

状态：

```text
draft → uploading → transcribing → review_required
      → analyzing → estimate_ready → published → archived
```

处理失败时保留最近成功状态和可重试错误，不通过删除会议恢复。

### 6.2 `media_assets`

- `meeting_id`；
- `kind`：`original | normalized | provider_result`；
- `bucket`、`object_path`；
- `mime_type`、`size_bytes`、`duration_ms`；
- `sample_rate`、`channels`；
- `sha256`；
- `status`；
- `derived_from_asset_id`；
- `retention_until`、`deleted_at`。

状态：

```text
created → uploading → uploaded → verified → normalizing → ready
                                            ↘ failed
```

### 6.3 `processing_jobs`

- `meeting_id`；
- `job_type`：`transcription | meeting_analysis | estimate_generation | retention_cleanup`；
- `status`；
- `idempotency_key`；
- `provider`；
- `provider_task_id`；
- `attempt`、`max_attempts`；
- `progress_percent`、`stage`、`event_sequence`；
- `next_poll_at`；
- `error_code`、`error_message`；
- `started_at`、`finished_at`。

同一业务动作的活动任务应通过唯一索引或事务 RPC 防止重复创建。

### 6.4 `transcript_revisions` 与 `transcript_segments`

Revision 保存：

- `meeting_id`；
- `revision_no`、`parent_revision_id`；
- `kind`：`machine | human`；
- `status`：`draft | in_review | approved`；
- `full_text`、`content_hash`；
- `model_manifest`、`config_version`；
- `approved_by`、`approved_at`。

Segment 保存：

- `transcript_revision_id`；
- `sequence_no`；
- `speaker_key`；
- `start_ms`、`end_ms`；
- `text`、`confidence`；
- `words JSONB`；
- `source_segment_id`，用于人工 revision 追溯机器片段。

批准后的 revision 不允许原地修改。再次编辑时从它创建新 draft。

### 6.5 `meeting_analysis_versions`

保存：

- 来源 `transcript_revision_id`；
- 摘要；
- 需求；
- 决策；
- 待办；
- 风险；
- 冲突；
- 未决问题；
- 每项对应的 `evidence_segment_ids`；
- 模型、Prompt 和 Schema 版本。

### 6.6 `estimate_versions` 及明细表

建议新增：

- `estimate_versions`；
- `estimate_version_functions`；
- `estimate_version_roles`；
- `estimate_version_additional_work`；
- `estimate_version_costs`。

每个版本绑定：

- `project_id`；
- 来源会议；
- 来源已批准转写 revision；
- 来源 analysis version；
- `parent_version_id`；
- 当前成本规则版本和输入快照；
- `draft | in_review | published` 状态。

`projects` 增加 `published_estimate_version_id`。现有报告、导出和正式成本查询逐步改为读取该指针，而不是读取最新插入记录。

### 6.7 RLS 与 RPC

所有新表按项目 owner 进行 RLS 隔离。服务端写入仍应显式校验项目归属，不能只依赖 RLS。

需要的事务 RPC 至少包括：

- 创建 meeting、media asset 和上传会话；
- 服务端校验后 CAS 更新媒体状态；
- 创建或领取 processing job；
- 提交机器转写 revision；
- 批准 transcript revision；
- 创建 estimate version；
- 发布 estimate version；
- 标记媒体保留期删除结果。

发布 RPC 在一个事务内：

1. 锁定 project；
2. 校验用户和 expected revision；
3. 校验 estimate version 属于该 project；
4. 校验来源 transcript 已批准；
5. 校验功能、角色和成本数据完整；
6. 更新版本状态；
7. 原子切换 `published_estimate_version_id`；
8. 写审计事件。

## 7. 前端交互计划

## 7.1 录音与上传

录音采用 `MediaRecorder`，运行时按以下顺序探测：

```text
audio/webm;codecs=opus
audio/mp4;codecs=mp4a.40.2
audio/mp4
audio/ogg;codecs=opus
浏览器默认格式
```

必须使用 `MediaRecorder.isTypeSupported()`，并以 `recorder.mimeType` 作为实际 MIME。

每 5–15 秒生成分片并写入 IndexedDB。React 状态只保存进度，不长期保存全部 Blob。页面刷新后提示恢复、导出或放弃本地录音。

上传要求：

- 支持选择已有音频；
- 客户端预检类型和大小；
- 使用 `tus-js-client` 直传；
- 显示字节进度、速度和预计剩余时间；
- 网络中断后自动恢复；
- 禁止覆盖已有对象；
- 上传完成后由服务端回查 Storage 元数据再进入转写。

## 7.2 转写校对

编辑器支持：

- 点击片段跳转对应音频时间；
- 片段播放和循环播放；
- 修改文本；
- 修改匿名 speaker 名称；
- 合并、拆分片段；
- 删除闲聊或标记不纳入估算；
- 自动保存草稿；
- 显示机器稿来源和当前 revision；
- 明确的“批准转写稿”动作。

首期不实现实时协同编辑。使用 revision 和乐观并发检查防止多标签页静默覆盖。

## 7.3 会议分析与估算

分析结果按以下结构展示并支持追溯：

- 明确需求；
- 原始发言证据；
- 会议决策；
- 待办事项；
- 风险；
- 冲突表述；
- 未决问题；
- 范围外事项。

只有 approved transcript revision 可以启动会议分析。只有已成功的 analysis version 可以启动估算。

## 7.4 版本发布

新增 estimate version 选择器，显示：

- 版本号和状态；
- 来源会议；
- 来源转写 revision；
- 生成时间和生成人；
- 模型、Prompt、成本规则版本；
- 与当前正式版本的摘要差异。

首期差异 UI 可只展示汇总变化，不要求完成逐字段高级 diff。发布前显示不可逆语义说明：历史不会被删除，但正式项目指针会切换到所选版本。

## 8. 分阶段实施计划

## 阶段 0：基线冻结与 FunASR PoC（6–10 人日）

### 任务

- 记录当前未提交工作树，不覆盖已有改动；
- 准备 10–20 场获授权的真实会议样本；
- 部署临时 FunASR GPU 环境；
- 通过官方 HTTP API 验证 Paraformer、VAD、标点、CAM++ 和热词；
- 验证 WebM/Opus、MP4/AAC 和已有音频格式；
- 建立 2 小时及接近 500 MB 边界样本；
- 测量 CER、英文术语召回率、DER、时间码偏差、RTF、显存和内存；
- 验证按 VAD 切片和全场 speaker 聚类；
- 审计精确 checkpoint 许可证；
- 输出模型 manifest 和 PoC 报告。

### 退出条件

- 2 小时音频可稳定完成；
- 机器转写适合人工校对；
- 技术术语召回达到约定阈值；
- 处理时长具备达到 P95 30 分钟的余量；
- 明确选定 GPU 规格和并发策略；
- 所有生产 checkpoint 许可可接受。

若退出条件不满足，不继续大规模业务开发；先调整模型、GPU 或说话人方案。

## 阶段 1：数据库、Storage 和安全基座（7–11 人日）

### 任务

- 新增会议、媒体、任务和转写相关 migration；
- 建立私有 `meeting-audio` bucket 和 RLS；
- 将 linked 云项目 Storage 限制提升到有安全余量的配置；
- 实现 meeting/media 创建及完成校验 RPC；
- 建立对象路径、MIME、大小、hash 和保留期校验；
- 建立任务状态快照 API；
- 增加跨项目、跨用户和重复提交测试。

### 退出条件

- 500 MB 文件可直传且中断后恢复；
- 非 owner 无法读取或写入媒体元数据和对象；
- 客户端伪造完成、路径或大小不能启动任务；
- 重复完成请求只创建一个活动任务。

## 阶段 2：录音与上传体验（7–10 人日）

### 任务

- 实现 MediaRecorder MIME 探测；
- 实现 IndexedDB 分片保存和页面刷新恢复；
- 实现 tus-js-client 上传；
- 实现时长、大小、格式和浏览器兼容提示；
- 实现录音预览、放弃和上传状态；
- 增加 Chromium 和 Safari 主路径浏览器测试。

### 退出条件

- 2 小时录音不持续占用等量页面内存；
- 页面意外刷新后可恢复本地录音；
- Chrome/Edge 与 Safari 产生的实际 MIME 被正确保存；
- 断网重连后可继续上传。

## 阶段 3：FunASR 生产 HTTP 服务与任务编排（10–16 人日）

### 任务

- 建立受保护的异步 HTTP Job API；
- 建立持久 GPU 队列、模型预热和健康检查；
- 实现 `FunAsrProvider`；
- 实现 signed URL 下载、hash 校验、临时文件和清理；
- 实现 FFmpeg 探测、必要转码和切片；
- 实现轮询、超时、取消、有限重试和幂等；
- 实现标准化转写和原始结果留存；
- 接入 processing job 状态和 Realtime 通知；
- 增加 FunASR fake server 和协议测试；
- 完成 GPU 服务监控和部署文档。

### 退出条件

- 页面关闭或应用重启不丢失任务；
- FunASR 服务重启后任务可恢复或安全重试；
- 同一音频和配置不会产生重复 machine revision；
- 429、5xx、下载失败、URL 过期、OOM 和非法结果均有确定错误分类；
- 2 小时任务在目标并发下达到 PoC 时效指标。

## 阶段 4：转写校对与会议分析（8–12 人日）

### 任务

- 持久化 machine revision 和 segments；
- 实现音频与片段时间码联动；
- 实现编辑、speaker 重命名、片段合并拆分和草稿保存；
- 实现 revision 创建、并发控制和批准 RPC；
- 定义会议分析 Zod Schema；
- 每个需求和结论必须引用 evidence segment；
- 通过后台任务执行会议分析；
- 增加空会议、低质量转写、证据缺失和 Schema 失败测试。

### 退出条件

- approved revision 不可原地修改；
- 用户可从分析结果跳回原始会议证据；
- 未批准转写无法启动分析；
- 分析失败不会破坏转写稿或创建半成品估算。

## 阶段 5：估算版本化和正式发布（12–18 人日）

### 任务

- 新增 estimate version 和明细表；
- 扩展现有售前 Workflow 输入，使其绑定 transcript 和 analysis version；
- 修改 execution service，使结果写入目标 draft version；
- 保留确定性成本计算规则；
- 新增 publish RPC 和项目正式版本指针；
- 改造功能明细、角色、成本、报告和导出查询；
- 人工修改基于父版本创建新 draft，不修改已发布版本；
- 增加并发发布、版本归属、来源批准和原子回滚测试。

### 退出条件

- 重新分析会议不会覆盖当前正式结果；
- 发布要么全部成功，要么项目指针和版本状态均不变；
- 报告和导出明确绑定版本；
- 历史版本可查看，并保留来源链路；
- 当前非会议文本入口继续工作。

## 阶段 6：保留策略、压测与上线（7–11 人日）

### 任务

- 实现默认 30 天、可配置 7/30/90 天保留期；
- 删除原始、标准化音频、原始 provider 结果和 GPU 临时文件；
- 保留必要审计元数据和转写/估算版本；
- 实现删除失败重试和可审计状态；
- 完成 1、5、20 场并发压测；
- 完成 GPU OOM、磁盘不足、Storage 故障和任务平台故障演练；
- 建立 Dashboard、告警和运行手册；
- 灰度开放给内部用户，再逐步扩大范围。

### 退出条件

- 到期媒体对象被实际删除，而不是只删除数据库行；
- 生产告警覆盖排队、失败率、P95 时延、GPU、磁盘和清理积压；
- 具备暂停新任务、排空队列、切换镜像和回滚版本的运行步骤；
- 连续至少 5 个工作日稳定运行。

## 9. 测试与验收矩阵

### 9.1 FunASR 质量

- 中文 CER；
- 英文 WER；
- 中英混说 MER；
- 领域术语精确率、召回率和 F1；
- 数字、金额、日期和型号准确率；
- DER/JER；
- speaker-attributed CER/WER；
- 短回应 speaker 归属；
- 重叠语音漏识率；
- 句段和词时间码偏差。

建议首轮目标仅作为 PoC 起点：

- 中文 CER 不高于 10%；
- 启用热词后术语召回率不低于 95%；
- 数字准确率不低于 98%；
- 不含重叠语音的 DER 不高于 15%；
- 句段时间码误差 P95 不高于 1 秒。

若真实会议可用性与这些自动指标冲突，以盲测人工校对时间和需求证据可追溯性为最终决策依据。

### 9.2 性能与容量

- 2 小时音频；
- 接近 500 MB 文件；
- 3、5、10 人会议；
- 20 场连续或并发提交；
- P50、P95、P99 等待和处理时间；
- GPU 利用率和峰值显存；
- CPU、内存、磁盘和网络；
- 单音频小时成本；
- 页面端录音内存；
- 上传恢复成功率。

### 9.3 故障与幂等

- 重复点击上传完成；
- 重复启动转写；
- 后台任务重放；
- FunASR 创建请求超时但实际已接收；
- GPU 服务重启；
- OOM；
- signed URL 过期；
- Storage 下载中断；
- 非法或空转写结果；
- Realtime 断开；
- 发布时 revision 冲突。

### 9.4 权限与隐私

- 跨用户和跨项目访问；
- 伪造对象路径；
- 非 owner 获取 signed URL；
- 日志、Trace 和错误报告中的敏感数据泄漏；
- 到期删除；
- 已批准 revision 的不可变性；
- 已发布版本的不可变性。

## 10. 可观测性与运行指标

应用侧至少记录：

- `meeting_id`、`media_asset_id`、`processing_job_id`；
- 当前阶段和状态；
- 排队、下载、转码、ASR、标准化和持久化耗时；
- 输入时长和字节数；
- 模型 manifest/config 版本；
- 重试次数和稳定错误码；
- 片段、speaker 和文本长度等非敏感统计。

FunASR 服务至少暴露：

- 队列长度和最老任务等待时间；
- 当前运行数；
- 推理耗时与 RTF；
- GPU 利用率、显存和 OOM 数；
- 模型加载状态；
- 下载、解码、VAD、ASR、聚类和合并耗时；
- 临时磁盘占用和清理失败数。

禁止默认记录：

- 原始音频；
- 完整转写文本；
- signed URL；
- Storage bearer token；
- 热词中的客户敏感信息；
- LLM 的完整会议输入输出。

## 11. 配置与 Secret

应用/Trigger.dev 侧当前必需配置：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
TRIGGER_PROJECT_REF
TRIGGER_SECRET_KEY
FUNASR_BASE_URL
FUNASR_SERVICE_TOKEN
FUNASR_CONFIG_VERSION
```

后续可配置项：

```text
MEETING_AUDIO_BUCKET
MEETING_MAX_FILE_BYTES
MEETING_MAX_DURATION_SECONDS
MEETING_AUDIO_RETENTION_DAYS
MEETING_JOB_POLL_INTERVAL_SECONDS
```

FunASR 服务侧建议配置：

```text
FUNASR_DEVICE
FUNASR_ASR_MODEL_ID
FUNASR_ASR_MODEL_REVISION
FUNASR_VAD_MODEL_ID
FUNASR_VAD_MODEL_REVISION
FUNASR_PUNC_MODEL_ID
FUNASR_PUNC_MODEL_REVISION
FUNASR_SPEAKER_MODEL_ID
FUNASR_SPEAKER_MODEL_REVISION
FUNASR_MAX_CONCURRENCY
FUNASR_DATA_DIR
FUNASR_MAX_QUEUED_JOBS
FUNASR_JOB_MAX_ATTEMPTS
FUNASR_JOB_POLL_INTERVAL_SECONDS
FUNASR_SOURCE_RETENTION_HOURS
FUNASR_JOB_RETENTION_DAYS
FUNASR_CLEANUP_INTERVAL_SECONDS
SERVICE_TOKEN_HASH
```

Secret 不写入仓库、数据库普通字段或客户端环境变量。`SUPABASE_SERVICE_ROLE_KEY` 只提供给 Trigger.dev worker，FunASR 只持独立 Service Token。

Trigger.dev 上线顺序：

1. 为目标 Trigger.dev project 配置上述必需环境变量；
2. 确认 `20260730140000_add_transcription_job_orchestration.sql` 已在目标 Supabase 项目部署且 migration history 一致；
3. 运行 `pnpm trigger:dev`，以小音频验证领取、续租、provider polling、机器稿提交和失败调度；
4. 经单独部署确认后运行 `pnpm trigger:deploy`；
5. 用同一媒体重复调用上传完成 API，验证 Trigger 和 FunASR 两级幂等不会生成第二任务或第二机器稿。

Trigger.dev 未部署前，数据库中已入队任务会保持 `queued`，不会由 Vercel 请求进程代跑。

## 12. 工作量与交付策略

完整生产范围估算：

| 阶段 | 人日 |
|---|---:|
| 阶段 0：FunASR PoC | 6–10 |
| 阶段 1：数据库与 Storage | 7–11 |
| 阶段 2：录音与上传 | 7–10 |
| 阶段 3：FunASR 服务与编排 | 10–16 |
| 阶段 4：校对与会议分析 | 8–12 |
| 阶段 5：估算版本化与发布 | 12–18 |
| 阶段 6：可靠性与上线 | 7–11 |
| **合计** | **57–88** |

两名熟悉项目的工程师合理并行，预计约 7–11 个日历周。自托管 FunASR 比云 ASR 增加了 GPU 服务、持久队列、模型治理、监控和容量管理，因此不能沿用云 API 方案的原工作量。

建议分两个可验收交付物：

### 交付物 A：内部 MVP

包含阶段 0–4：录音/上传、FunASR 转写、人工校对和会议分析。暂不切换项目正式估算结果。

### 交付物 B：生产闭环

包含阶段 5–6：不可变估算版本、发布、保留删除、压测、监控和灰度上线。

## 13. 主要风险与应对

| 风险 | 应对 |
|---|---|
| 中英术语识别不足 | 真实会议盲测、热词版本化、保留第二模型对照 |
| CAM++ 在重叠发言下效果有限 | UI 标注匿名 speaker、允许人工修正，必要时 PoC pyannote 增强 |
| 2 小时音频 OOM 或过慢 | VAD 切片、控制并发、固定 GPU、压测后设置准入限制 |
| 同步 HTTP 长连接不稳定 | 生产使用幂等异步 Job API，不等待单次长响应 |
| 页面刷新或任务重放产生重复数据 | 数据库幂等键、CAS、唯一索引和不可变 revision |
| 500 MB Storage 限制 | 付费计划、全局和 bucket 双重配置、客户端字节预检 |
| GPU 服务成为单点 | 持久队列、健康检查、任务恢复、镜像回滚；规模增长后再水平扩容 |
| 模型许可证误判 | 按 checkpoint/revision 固定许可证和 NOTICE 快照 |
| 日志泄漏会议内容 | 默认只记录统计和 ID，敏感字段脱敏或禁用 |
| 当前未提交改动较多 | 分阶段小提交、实施前记录基线，不覆盖非本功能改动 |

## 14. 明确不在首期范围

- FunASR MCP Server 或任何 MCP Agent 集成；
- 实时边录边转写；
- 声纹注册、实名身份识别；
- 重叠语音源分离；
- 多人实时协同编辑；
- 移动端原生录音 App；
- 自动跳过人工校对并直接发布正式估算；
- 同时接入多家云 ASR；
- 在会议功能开发中顺带执行现有 Workflow/Agent 目录大迁移；
- 修改当前确定性成本公式。

## 15. 实施前检查清单

进入阶段 0 前确认：

- [ ] GPU 部署区域和预算；
- [ ] 测试会议已获得合法授权；
- [ ] FunASR checkpoint 候选和许可证可下载审计；
- [ ] 2 小时及 500 MB 边界样本已准备；
- [ ] Supabase Storage 付费计划和容量可调整；
- [ ] FunASR 服务到 Storage 的网络路径可用；
- [ ] 30 分钟 SLO 从 `media_asset.verified_at` 开始计时；
- [ ] 原始音频默认保存 30 天；
- [ ] 当前工作树基线已记录且不会被覆盖。

阶段 0 通过后再确认：

- [ ] 精确模型 manifest；
- [ ] GPU 规格和最大并发；
- [ ] 长音频转码、切片及 speaker 聚类策略；
- [ ] FunASR 生产镜像 digest；
- [ ] 质量和时效验收阈值；
- [ ] 是否需要 pyannote 作为 speaker 增强方案；
- [ ] 是否正式进入阶段 1–4 的内部 MVP 开发。
