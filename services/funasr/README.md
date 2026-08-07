# FunASR Meeting Transcription API

独立的 FunASR HTTP PoC 服务，预加载 Paraformer、FSMN-VAD、CT-Punc 和 CAM++，用于验证会议转写契约。它不使用 MCP，也不依赖 Next.js 请求生命周期。

## 当前范围

- OpenAI 风格的同步 `POST /v1/audio/transcriptions`；
- SQLite 持久化异步 Job API：创建、查询和排队取消；
- 必填 `Idempotency-Key`，同键同输入重放、异输入返回 409；
- 单 worker FIFO 消费和进程重启后的 at-least-once 恢复；
- Paraformer 原生 token/字级毫秒时间戳；
- 基于 `sentence_info` 的句段；
- 可选 CAM++ 匿名 speaker 聚类；
- Paraformer 原生 `hotword`；
- Bearer Token；
- 上传字节数和音频时长限制；
- FFmpeg 标准化为 16 kHz、单声道、16-bit PCM WAV，支持浏览器 WebM/MP4 输入；
- 单模型实例单并发，繁忙时返回 429；
- readiness/liveness；
- 任务源媒体和终态记录按独立保留期清理；
- 数据目录进程独占锁，防止多个 Uvicorn 进程共享本地队列；
- 不按文本长度伪造时间码。

当前异步队列是单节点持久化基线，适合 PoC 和单 GPU worker。它不宣称 exactly-once 推理，也不替代后续多节点外部队列、长音频切片和 GPU 容量验证。

## 环境

推荐 Python 3.12。不要从仓库根目录直接导入 FunASR，因为根目录的 `coverage/` 报告目录会遮蔽 Python `coverage` 模块。使用服务目录作为工作目录即可避免该问题。

```bash
cd services/funasr

/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate

python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements.lock
```

本地和生产运行都要求可用的 FFmpeg 与 ffprobe。所有允许的媒体会先通过 ffprobe 校验时长，再由 FFmpeg 转为 16 kHz、单声道、16-bit PCM WAV 后交给 FunASR。当前允许 WAV、FLAC、MP3、OGG、WebM 和 MP4；FFmpeg 子进程只允许 `file,pipe` 协议，不会访问上传文件引用的网络资源。

当前主机已验证 Homebrew `ffmpeg 8.1.2_1`、`libvpx 1.16.0`，FFmpeg 正确链接 `libvpx.12.dylib`。如果本机出现动态库错误，可检查：

```bash
ffmpeg -version
ffprobe -version
otool -L "$(brew --prefix ffmpeg)/bin/ffmpeg" | grep libvpx
```

## 启动

本地开发推荐从仓库根目录启动。脚本会加载 `.env.local`，默认使用 CPU，并监听 `127.0.0.1:8100`：

```bash
pnpm funasr:dev
```

可通过环境变量覆盖设备和端口：

```bash
FUNASR_DEVICE=mps FUNASR_PORT=8100 pnpm funasr:dev
```

本地脚本要求 `.env.local` 中已配置 `FUNASR_SERVICE_TOKEN`。`FUNASR_DEVICE` 未设置时显式回退为 `cpu`；这与另一个 OpenAI 兼容的 `funasr-server` CLI 不同，后者当前默认使用 `cuda`，在 Mac CPU 环境调用该 CLI 时仍需传入 `--device cpu`。

也可以在服务目录手动启动：

CPU：

```bash
cd services/funasr
source .venv/bin/activate

export FUNASR_DEVICE=cpu
export FUNASR_SERVICE_TOKEN=replace-with-random-secret

uvicorn app.main:app \
  --host 127.0.0.1 \
  --port 8100 \
  --workers 1
```

Apple Silicon 可在 CPU 验证后尝试：

```bash
export FUNASR_DEVICE=mps
```

生产 GPU 环境设为 `cuda`。一个进程只允许一个 AutoModel 实例；当前实现固定 `FUNASR_MAX_CONCURRENCY=1`，因为 FunASR AutoModel 会修改共享 runtime kwargs。不要通过增加 Uvicorn workers 扩容，否则每个 worker 都会加载一套模型。正式扩容应由外部队列调度独立 GPU worker。

首次启动会下载和加载模型，`/health/live` 只表示进程存活；只有 `/health/ready` 中 `ready=true` 才能接收推理。

## 调用

```bash
curl --fail-with-body \
  http://127.0.0.1:8100/v1/audio/transcriptions \
  -H 'Authorization: Bearer replace-with-random-secret' \
  -F file=@../../sample.wav \
  -F model=paraformer \
  -F language=zh \
  -F response_format=verbose_json \
  -F 'hotwords=["Next.js","Supabase","FunASR","功能估算"]' \
  -F diarize=true
```

已知说话人数时才传：

```bash
-F speaker_count=3
```

兼容官方快速接口的 `spk=true`，但新代码优先使用 `diarize=true`。

### 异步 Job API

创建任务使用 multipart 文件上传，不接受远程 URL 或文件路径：

```bash
curl --fail-with-body \
  http://127.0.0.1:8100/internal/v1/transcription-jobs \
  -H 'Authorization: Bearer replace-with-random-secret' \
  -H 'Idempotency-Key: meeting-20260730-0001' \
  -F file=@../../sample.webm \
  -F model=paraformer \
  -F language=zh \
  -F 'hotwords=["Next.js","Supabase","FunASR"]' \
  -F diarize=true
```

成功持久接收后返回 `202 Accepted` 和 `Location`。相同 key、相同文件内容与相同规范化配置返回同一任务，并包含 `Idempotency-Replayed: true`；相同 key 对应不同输入返回 409。

```bash
curl --fail-with-body \
  http://127.0.0.1:8100/internal/v1/transcription-jobs/JOB_ID \
  -H 'Authorization: Bearer replace-with-random-secret'

curl --fail-with-body -X POST \
  http://127.0.0.1:8100/internal/v1/transcription-jobs/JOB_ID/cancel \
  -H 'Authorization: Bearer replace-with-random-secret'
```

只有 `queued` 任务可以取消；重复取消已取消任务是幂等操作。`running`、`succeeded` 和 `failed` 返回 409。进程重启时，仍有源媒体且未达到尝试上限的 `running` 任务会恢复为 `queued`，因此推理语义是 at-least-once。

## 响应契约

```json
{
  "task": "transcribe",
  "language": "zh",
  "duration": 4.2039375,
  "text": "甚至出现交易几乎停滞的情况。",
  "raw_text": "甚 至 出 现 交 易 几 乎 停 滞 的 情 况",
  "tokens": [
    {"text": "甚", "start_ms": 480, "end_ms": 720}
  ],
  "segments": [
    {
      "id": 0,
      "start_ms": 480,
      "end_ms": 3775,
      "text": "甚至出现交易几乎停滞的情况。",
      "speaker": "speaker_0",
      "speaker_id": 0,
      "tokens": [
        {"text": "甚", "start_ms": 480, "end_ms": 720}
      ]
    }
  ],
  "alignment": {
    "status": "aligned",
    "token_count": 13,
    "timestamp_count": 13
  },
  "model": {
    "timestamp_source": "model",
    "speaker_scope": "recording"
  },
  "warnings": []
}
```

时间戳是 Paraformer BiCIF 模型预测并叠加 VAD offset 后的结果，不是人工真值或强制对齐结果。如果 `raw_text` token 数与 `timestamp` 数不一致，服务返回 `tokens=[]` 和 `alignment.status=mismatch`，不会截断、补齐或均匀分配时间。句段内 token 直接从全局已对齐 token 中按模型句段时间范围归属，不再依赖 `sentence_info.raw_text` 的空格格式；范围无法精确覆盖时会保守遗漏并返回 warning，不会强行映射。

Speaker 标签只在当前录音内有效，不代表身份。当前 CAM++ 聚类无法表达重叠讲话中的多个 speaker。

## 配置

| 变量 | 默认值 | 说明 |
|---|---|---|
| `FUNASR_DEVICE` | `cpu` | `cpu`、`mps` 或 `cuda` |
| `FUNASR_ASR_MODEL` | `paraformer-zh` | ASR 模型 |
| `FUNASR_VAD_MODEL` | `fsmn-vad` | VAD 模型 |
| `FUNASR_PUNC_MODEL` | `ct-punc` | 标点模型 |
| `FUNASR_SPEAKER_MODEL` | `cam++` | speaker embedding 模型 |
| `FUNASR_MODEL_HUB` | `ms` | 模型来源 |
| `FUNASR_MODEL_REVISION` | `master` | 实际传给 ASR 模型并记录到响应；生产前必须固定 |
| `FUNASR_FFMPEG_PATH` | `ffmpeg` | FFmpeg 可执行文件路径 |
| `FUNASR_FFPROBE_PATH` | `ffprobe` | ffprobe 可执行文件路径 |
| `FUNASR_SERVICE_TOKEN` | 空 | 非空时要求 Bearer Token |
| `FUNASR_MAX_FILE_BYTES` | `500000000` | 最大上传字节数 |
| `FUNASR_MAX_DURATION_SECONDS` | `7200` | 最大音频时长 |
| `FUNASR_MAX_HOTWORDS` | `200` | 单请求热词数 |
| `FUNASR_MAX_HOTWORD_CHARS` | `2000` | 拼接后热词字符数 |
| `FUNASR_MAX_CONCURRENCY` | `1` | 当前必须为 1 |
| `FUNASR_DATA_DIR` | `work` | SQLite、上传源媒体和临时 WAV 的持久目录 |
| `FUNASR_MAX_QUEUED_JOBS` | `100` | 最大排队任务数 |
| `FUNASR_JOB_MAX_ATTEMPTS` | `3` | 重启恢复允许的最大已开始次数 |
| `FUNASR_JOB_POLL_INTERVAL_SECONDS` | `1` | 空队列轮询间隔 |
| `FUNASR_SOURCE_RETENTION_HOURS` | `24` | 成功/失败任务源媒体保留时间；取消时立即删除 |
| `FUNASR_JOB_RETENTION_DAYS` | `30` | 终态任务、结果和结构化错误保留时间 |
| `FUNASR_CLEANUP_INTERVAL_SECONDS` | `3600` | 保留清理扫描间隔 |

生产前必须将 `model-manifest.json` 中的 `master` 替换为不可变 revision 或制品摘要，并保存各 checkpoint 的模型卡和许可证快照。

## 测试

纯单元和 API fake 测试不会加载模型：

```bash
cd services/funasr
python -m unittest discover -s tests -v
```

真实服务烟测：

```bash
python scripts/smoke_test.py ../../sample.wav \
  --base-url http://127.0.0.1:8100 \
  --token replace-with-random-secret \
  --hotword FunASR \
  --hotword 功能估算 \
  --diarize
```

## Docker

```bash
cd services/funasr
docker build -t presales-funasr:poc .
docker run --rm -p 8100:8100 \
  -e FUNASR_DEVICE=cpu \
  -e FUNASR_SERVICE_TOKEN=replace-with-random-secret \
  -e FUNASR_DATA_DIR=/var/lib/funasr \
  -v funasr-model-cache:/home/funasr/.cache \
  -v funasr-job-data:/var/lib/funasr \
  presales-funasr:poc
```

CPU Dockerfile 会先从 PyTorch 官方 CPU wheel 索引安装 Torch/TorchAudio，再安装其余锁定依赖。不能在 Linux CPU 镜像中直接从 PyPI 安装当前 `torch==2.11.0`，否则会引入 CUDA 13 运行时依赖，大幅增加下载量和镜像体积。

建议同时持久化 `/home/funasr/.cache` 和 `FUNASR_DATA_DIR`。模型 cache volume 避免删除容器后约 2.1 GB 权重丢失；任务数据 volume 保证 SQLite、排队媒体和结果在容器重建后仍可恢复。数据目录使用独占文件锁，因此同一 volume 不能被多个服务进程同时使用。当前 Apple Silicon Docker Desktop CPU 基线实测：

- arm64 镜像约 663.6 MB，运行时为 Python 3.12.13、Torch/TorchAudio 2.11.0+cpu；
- 空缓存首次启动下载四套模型后约 477 秒 ready，缓存约 2.1 GB；
- 同一容器保留缓存后重启约 24.5 秒 ready；
- ready 后内存约 4.2 GiB，完成 60 秒请求后约 3.2 GiB；
- 4.2 秒 WAV、WebM/Opus 和 MP4/AAC 均转写成功，热请求墙钟时间约 1.0–2.4 秒；
- 真实并发请求中第二个请求返回 429，并包含 `Retry-After: 1`；
- 请求结束后上传源文件和标准化 WAV 均已清理，`/tmp` 仅保留 Jieba/性能运行时文件。

该 Dockerfile 当前是 CPU 基线。CUDA 镜像需要按照目标 GPU、驱动和 CUDA 版本单独固定 PyTorch wheel 与基础镜像，不能复用 CPU wheel 安装步骤。
