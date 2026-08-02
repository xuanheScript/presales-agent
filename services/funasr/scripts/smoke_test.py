from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import httpx


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test the FunASR HTTP service")
    parser.add_argument("audio", type=Path)
    parser.add_argument("--base-url", default="http://127.0.0.1:8100")
    parser.add_argument("--token")
    parser.add_argument("--hotword", action="append", default=[])
    parser.add_argument("--diarize", action="store_true")
    parser.add_argument("--speaker-count", type=int)
    parser.add_argument("--timeout", type=float, default=300.0)
    args = parser.parse_args()

    if not args.audio.is_file():
        parser.error(f"audio file does not exist: {args.audio}")

    headers = {}
    if args.token:
        headers["Authorization"] = f"Bearer {args.token}"
    data = {
        "model": "paraformer",
        "language": "zh",
        "response_format": "verbose_json",
        "hotwords": json.dumps(args.hotword, ensure_ascii=False),
        "diarize": str(args.diarize).lower(),
    }
    if args.speaker_count is not None:
        data["speaker_count"] = str(args.speaker_count)

    with args.audio.open("rb") as audio:
        response = httpx.post(
            f"{args.base_url.rstrip('/')}/v1/audio/transcriptions",
            headers=headers,
            data=data,
            files={"file": (args.audio.name, audio, "application/octet-stream")},
            timeout=args.timeout,
        )

    print(f"HTTP {response.status_code}", file=sys.stderr)
    try:
        payload = response.json()
    except ValueError:
        print(response.text)
        return 1
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if response.is_success else 1


if __name__ == "__main__":
    raise SystemExit(main())
