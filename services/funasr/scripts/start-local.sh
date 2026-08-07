#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$SERVICE_DIR/../.." && pwd)"
ENV_FILE="${FUNASR_ENV_FILE:-$ROOT_DIR/.env.local}"
VENV_DIR="${FUNASR_VENV_DIR:-$SERVICE_DIR/.venv}"
UVICORN="$VENV_DIR/bin/uvicorn"
HOST="${FUNASR_HOST:-127.0.0.1}"
PORT="${FUNASR_PORT:-8100}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

export FUNASR_DEVICE="${FUNASR_DEVICE:-cpu}"
export FUNASR_DATA_DIR="${FUNASR_DATA_DIR:-$SERVICE_DIR/work}"

if [[ ! -x "$UVICORN" ]]; then
  printf '未找到 FunASR Python 环境：%s\n' "$UVICORN" >&2
  printf '请先按照 services/funasr/README.md 安装依赖。\n' >&2
  exit 1
fi

if [[ -z "${FUNASR_SERVICE_TOKEN:-}" ]]; then
  printf '缺少 FUNASR_SERVICE_TOKEN，请在 %s 中配置。\n' "$ENV_FILE" >&2
  exit 1
fi

printf '启动 FunASR Job API：http://%s:%s（device=%s）\n' \
  "$HOST" "$PORT" "$FUNASR_DEVICE"

exec "$UVICORN" app.main:app \
  --app-dir "$SERVICE_DIR" \
  --host "$HOST" \
  --port "$PORT" \
  --workers 1
