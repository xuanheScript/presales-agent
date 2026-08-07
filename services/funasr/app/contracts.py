from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TokenTimestamp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)


class TranscriptSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int = Field(ge=0)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    text: str
    speaker: str | None = None
    speaker_id: int | str | None = None
    tokens: list[TokenTimestamp] = Field(default_factory=list)


class AlignmentMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["aligned", "mismatch", "unavailable"]
    token_count: int = Field(ge=0)
    timestamp_count: int = Field(ge=0)


class ModelMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    service_version: str
    asr_model: str
    vad_model: str
    punctuation_model: str
    speaker_model: str | None = None
    model_revision: str
    device: str
    timestamp_source: Literal["model", "unavailable"]
    speaker_scope: Literal["recording", "none"]


class TranscriptionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task: Literal["transcribe"] = "transcribe"
    language: str
    duration: float = Field(ge=0)
    text: str
    raw_text: str | None = None
    tokens: list[TokenTimestamp] = Field(default_factory=list)
    segments: list[TranscriptSegment] = Field(default_factory=list)
    alignment: AlignmentMetadata
    model: ModelMetadata
    processing_time: float = Field(ge=0)
    rtf: float = Field(ge=0)
    warnings: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "not_ready"]
    ready: bool
    device: str
    service_version: str
    models: dict[str, str]
    active_requests: int = Field(ge=0)
    max_concurrency: int = Field(gt=0)
    error: str | None = None


class JobInputMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str
    content_type: str
    size_bytes: int = Field(ge=0)
    sha256: str


class JobConfigMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str
    language: str
    hotwords: list[str]
    diarize: bool
    speaker_count: int | None = None


class JobErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    retryable: bool
    occurred_at: str


class TranscriptionJobResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    stage: str
    attempt: int = Field(ge=0)
    recovery_count: int = Field(ge=0)
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None
    input: JobInputMetadata
    config: JobConfigMetadata
    result: TranscriptionResponse | None = None
    error: JobErrorResponse | None = None
