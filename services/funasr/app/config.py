from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    device: str = "cpu"
    asr_model: str = "paraformer-zh"
    vad_model: str = "fsmn-vad"
    punctuation_model: str = "ct-punc"
    speaker_model: str = "cam++"
    speaker_mode: str = "punc_segment"
    model_hub: str = "ms"
    model_revision: str = "master"
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    service_version: str = "funasr-meeting-v1"
    service_token: str | None = None
    max_file_bytes: int = 500_000_000
    max_duration_seconds: int = 7_200
    max_hotwords: int = 200
    max_hotword_chars: int = 2_000
    max_concurrency: int = 1
    data_dir: Path = Path("work")
    max_queued_jobs: int = 100
    job_max_attempts: int = 3
    job_poll_interval_seconds: float = 1.0
    source_retention_hours: int = 24
    job_retention_days: int = 30
    cleanup_interval_seconds: float = 3_600.0

    def __post_init__(self) -> None:
        if self.max_concurrency != 1:
            raise ValueError(
                "FUNASR_MAX_CONCURRENCY must be 1 because AutoModel mutates shared runtime state"
            )
        if self.job_poll_interval_seconds <= 0:
            raise ValueError("FUNASR_JOB_POLL_INTERVAL_SECONDS must be greater than zero")
        if self.cleanup_interval_seconds <= 0:
            raise ValueError("FUNASR_CLEANUP_INTERVAL_SECONDS must be greater than zero")

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            device=os.getenv("FUNASR_DEVICE", "cpu"),
            asr_model=os.getenv("FUNASR_ASR_MODEL", "paraformer-zh"),
            vad_model=os.getenv("FUNASR_VAD_MODEL", "fsmn-vad"),
            punctuation_model=os.getenv("FUNASR_PUNC_MODEL", "ct-punc"),
            speaker_model=os.getenv("FUNASR_SPEAKER_MODEL", "cam++"),
            speaker_mode=os.getenv("FUNASR_SPEAKER_MODE", "punc_segment"),
            model_hub=os.getenv("FUNASR_MODEL_HUB", "ms"),
            model_revision=os.getenv("FUNASR_MODEL_REVISION", "master"),
            ffmpeg_path=os.getenv("FUNASR_FFMPEG_PATH", "ffmpeg"),
            ffprobe_path=os.getenv("FUNASR_FFPROBE_PATH", "ffprobe"),
            service_version=os.getenv("FUNASR_SERVICE_VERSION", "funasr-meeting-v1"),
            service_token=os.getenv("FUNASR_SERVICE_TOKEN") or None,
            max_file_bytes=_positive_int("FUNASR_MAX_FILE_BYTES", 500_000_000),
            max_duration_seconds=_positive_int("FUNASR_MAX_DURATION_SECONDS", 7_200),
            max_hotwords=_positive_int("FUNASR_MAX_HOTWORDS", 200),
            max_hotword_chars=_positive_int("FUNASR_MAX_HOTWORD_CHARS", 2_000),
            max_concurrency=_positive_int("FUNASR_MAX_CONCURRENCY", 1),
            data_dir=Path(os.getenv("FUNASR_DATA_DIR", "work")),
            max_queued_jobs=_positive_int("FUNASR_MAX_QUEUED_JOBS", 100),
            job_max_attempts=_positive_int("FUNASR_JOB_MAX_ATTEMPTS", 3),
            job_poll_interval_seconds=_positive_float(
                "FUNASR_JOB_POLL_INTERVAL_SECONDS",
                1.0,
            ),
            source_retention_hours=_positive_int(
                "FUNASR_SOURCE_RETENTION_HOURS",
                24,
            ),
            job_retention_days=_positive_int("FUNASR_JOB_RETENTION_DAYS", 30),
            cleanup_interval_seconds=_positive_float(
                "FUNASR_CLEANUP_INTERVAL_SECONDS",
                3_600.0,
            ),
        )


def _positive_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = int(raw)
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def _positive_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = float(raw)
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value
