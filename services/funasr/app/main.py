from __future__ import annotations

import hmac
import os
import re
import tempfile
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

import anyio
from fastapi import FastAPI, File, Form, Header, HTTPException, Response, UploadFile, status

from .config import Settings
from .contracts import HealthResponse, TranscriptionJobResponse, TranscriptionResponse
from .job_storage import (
    EmptyUploadError,
    LocalJobStorage,
    StoredUploadTooLargeError,
)
from .jobs import (
    IdempotencyConflictError,
    JobCancellationConflictError,
    JobCapacityError,
    JobConfig,
    JobNotFoundError,
    JobRecord,
    SQLiteJobStore,
)
from .media import (
    FFmpegMediaProcessor,
    MediaDurationError,
    MediaProcessingError,
)
from .model_service import (
    FunASRModelService,
    InferenceCapacityError,
    ModelNotReadyError,
)
from .normalizer import parse_hotwords
from .worker import TranscriptionWorker

_IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[\x21-\x7e]{8,128}$")

_ALLOWED_CONTENT_TYPES = {
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/flac",
    "audio/x-flac",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/webm",
    "video/mp4",
    "application/octet-stream",
}


def create_app(
    settings: Settings | None = None,
    model_service: FunASRModelService | None = None,
    media_processor: FFmpegMediaProcessor | None = None,
    job_store: SQLiteJobStore | None = None,
    job_storage: LocalJobStorage | None = None,
    worker: TranscriptionWorker | None = None,
    *,
    load_model: bool = True,
    start_worker: bool = True,
) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    service = model_service or FunASRModelService(resolved_settings)
    processor = media_processor or FFmpegMediaProcessor(
        ffmpeg_path=resolved_settings.ffmpeg_path,
        ffprobe_path=resolved_settings.ffprobe_path,
    )
    storage = job_storage or LocalJobStorage(resolved_settings.data_dir)
    store = job_store or SQLiteJobStore(
        resolved_settings.data_dir / "jobs.sqlite3",
        max_queued_jobs=resolved_settings.max_queued_jobs,
    )
    transcription_worker = worker or TranscriptionWorker(
        settings=resolved_settings,
        store=store,
        storage=storage,
        media_processor=processor,
        model_service=service,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await anyio.to_thread.run_sync(storage.initialize)
        worker_started = False
        try:
            await anyio.to_thread.run_sync(store.initialize)
            await anyio.to_thread.run_sync(
                lambda: store.recover_interrupted(
                    max_attempts=resolved_settings.job_max_attempts
                )
            )
            if load_model and not service.ready:
                await anyio.to_thread.run_sync(service.load)
            if start_worker:
                transcription_worker.start()
                worker_started = True
            yield
        finally:
            if worker_started:
                transcription_worker.stop()
            storage.close()

    app = FastAPI(
        title="FunASR Meeting Transcription API",
        version=resolved_settings.service_version,
        lifespan=lifespan,
    )
    app.state.settings = resolved_settings
    app.state.model_service = service
    app.state.media_processor = processor
    app.state.job_storage = storage
    app.state.job_store = store
    app.state.transcription_worker = transcription_worker

    @app.get("/health/live")
    async def health_live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready", response_model=HealthResponse)
    async def health_ready() -> HealthResponse:
        return _health_response(service, resolved_settings)

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return _health_response(service, resolved_settings)

    @app.get("/v1/models")
    async def models() -> dict[str, object]:
        return {
            "object": "list",
            "data": [
                {
                    "id": resolved_settings.asr_model,
                    "object": "model",
                    "owned_by": "funasr",
                }
            ],
        }

    @app.post(
        "/v1/audio/transcriptions",
        response_model=TranscriptionResponse,
        responses={
            status.HTTP_401_UNAUTHORIZED: {"description": "Invalid service token"},
            status.HTTP_413_CONTENT_TOO_LARGE: {"description": "Audio is too large"},
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: {"description": "Unsupported media"},
            status.HTTP_429_TOO_MANY_REQUESTS: {"description": "Inference capacity is busy"},
            status.HTTP_503_SERVICE_UNAVAILABLE: {"description": "Model is not ready"},
        },
    )
    async def transcribe(
        file: UploadFile = File(...),
        model: str = Form(default="paraformer-zh"),
        language: str = Form(default="zh"),
        response_format: str = Form(default="verbose_json"),
        hotwords: str | None = Form(default=None),
        diarize: bool = Form(default=False),
        spk: bool | None = Form(default=None),
        speaker_count: int | None = Form(default=None),
        authorization: str | None = Header(default=None),
    ) -> TranscriptionResponse:
        _authorize(resolved_settings, authorization)
        if model not in {"paraformer", resolved_settings.asr_model}:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unsupported model: {model}")
        if response_format != "verbose_json":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "only response_format=verbose_json is supported",
            )
        normalized_language = language.strip() or "zh"
        effective_diarize = diarize or spk is True
        if speaker_count is not None and speaker_count <= 0:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "speaker_count must be greater than zero",
            )
        if speaker_count is not None and not effective_diarize:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "speaker_count requires diarize=true",
            )

        try:
            parsed_hotwords = parse_hotwords(
                hotwords,
                max_items=resolved_settings.max_hotwords,
                max_chars=resolved_settings.max_hotword_chars,
            )
        except ValueError as error:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from error

        content_type = (file.content_type or "application/octet-stream").lower()
        if content_type not in _ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                f"unsupported content type: {content_type}",
            )

        temp_path: Path | None = None
        normalized_path: Path | None = None
        try:
            temp_path = await _save_upload(file, resolved_settings.max_file_bytes)
            normalized_path = temp_path.with_name(f"{temp_path.stem}-normalized.wav")
            normalized = await anyio.to_thread.run_sync(
                lambda: processor.normalize(
                    temp_path,
                    normalized_path,
                    max_duration_seconds=resolved_settings.max_duration_seconds,
                )
            )
            duration = normalized.duration

            return await anyio.to_thread.run_sync(
                lambda: service.transcribe(
                    normalized.path,
                    duration=duration,
                    language=normalized_language,
                    hotwords=parsed_hotwords,
                    diarize=effective_diarize,
                    speaker_count=speaker_count,
                )
            )
        except InferenceCapacityError as error:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                str(error),
                headers={"Retry-After": "1"},
            ) from error
        except MediaDurationError as error:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, str(error)) from error
        except ModelNotReadyError as error:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(error)) from error
        except HTTPException:
            raise
        except (MediaProcessingError, RuntimeError) as error:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"audio could not be processed: {error}",
            ) from error
        finally:
            await file.close()
            if normalized_path is not None:
                normalized_path.unlink(missing_ok=True)
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

    @app.post(
        "/internal/v1/transcription-jobs",
        response_model=TranscriptionJobResponse,
        status_code=status.HTTP_202_ACCEPTED,
        responses={
            status.HTTP_401_UNAUTHORIZED: {"description": "Invalid service token"},
            status.HTTP_409_CONFLICT: {"description": "Idempotency conflict"},
            status.HTTP_413_CONTENT_TOO_LARGE: {"description": "Audio is too large"},
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: {"description": "Unsupported media"},
            status.HTTP_429_TOO_MANY_REQUESTS: {"description": "Job queue is full"},
        },
    )
    async def create_transcription_job(
        response: Response,
        file: UploadFile = File(...),
        model: str = Form(default="paraformer-zh"),
        language: str = Form(default="zh"),
        hotwords: str | None = Form(default=None),
        diarize: bool = Form(default=False),
        speaker_count: int | None = Form(default=None),
        idempotency_key: str | None = Header(
            default=None,
            alias="Idempotency-Key",
        ),
        authorization: str | None = Header(default=None),
    ) -> TranscriptionJobResponse:
        _authorize(resolved_settings, authorization)
        validated_key = _validate_idempotency_key(idempotency_key)
        config = _job_config(
            resolved_settings,
            model=model,
            language=language,
            hotwords=hotwords,
            diarize=diarize,
            speaker_count=speaker_count,
        )
        content_type = (file.content_type or "application/octet-stream").lower()
        if content_type not in _ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                f"unsupported content type: {content_type}",
            )

        stored_upload = None
        try:
            stored_upload = await anyio.to_thread.run_sync(
                lambda: storage.write_stream(
                    file.file,
                    filename=file.filename,
                    max_file_bytes=resolved_settings.max_file_bytes,
                )
            )
            try:
                job, replayed = await anyio.to_thread.run_sync(
                    lambda: store.create_or_get(
                        idempotency_key=validated_key,
                        media_sha256=stored_upload.sha256,
                        input_path=stored_upload.path,
                        original_filename=stored_upload.original_filename,
                        content_type=content_type,
                        size_bytes=stored_upload.size_bytes,
                        config=config,
                    )
                )
            except IdempotencyConflictError as error:
                raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
            except JobCapacityError as error:
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    str(error),
                    headers={"Retry-After": "1"},
                ) from error

            if replayed:
                await anyio.to_thread.run_sync(
                    lambda: storage.delete_source(stored_upload.path)
                )
                stored_upload = None
                response.headers["Idempotency-Replayed"] = "true"
            else:
                stored_upload = None
                transcription_worker.notify()
            response.headers["Location"] = (
                f"/internal/v1/transcription-jobs/{job.id}"
            )
            return _job_response(job)
        except StoredUploadTooLargeError as error:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE,
                str(error),
            ) from error
        except EmptyUploadError as error:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                str(error),
            ) from error
        finally:
            await file.close()
            if stored_upload is not None:
                await anyio.to_thread.run_sync(
                    lambda: storage.delete_source(stored_upload.path)
                )

    @app.get(
        "/internal/v1/transcription-jobs/{job_id}",
        response_model=TranscriptionJobResponse,
    )
    async def get_transcription_job(
        job_id: str,
        authorization: str | None = Header(default=None),
    ) -> TranscriptionJobResponse:
        _authorize(resolved_settings, authorization)
        try:
            job = await anyio.to_thread.run_sync(lambda: store.get(job_id))
        except JobNotFoundError as error:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error
        return _job_response(job)

    @app.post(
        "/internal/v1/transcription-jobs/{job_id}/cancel",
        response_model=TranscriptionJobResponse,
    )
    async def cancel_transcription_job(
        job_id: str,
        authorization: str | None = Header(default=None),
    ) -> TranscriptionJobResponse:
        _authorize(resolved_settings, authorization)
        try:
            job = await anyio.to_thread.run_sync(lambda: store.cancel(job_id))
        except JobNotFoundError as error:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error
        except JobCancellationConflictError as error:
            raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
        await anyio.to_thread.run_sync(
            lambda: storage.delete_source(job.input_path)
        )
        return _job_response(job)

    return app


def _validate_idempotency_key(value: str | None) -> str:
    if value is None or not _IDEMPOTENCY_KEY_PATTERN.fullmatch(value):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Idempotency-Key must contain 8-128 visible ASCII characters",
        )
    return value


def _job_config(
    settings: Settings,
    *,
    model: str,
    language: str,
    hotwords: str | None,
    diarize: bool,
    speaker_count: int | None,
) -> JobConfig:
    if model not in {"paraformer", settings.asr_model}:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unsupported model: {model}",
        )
    if speaker_count is not None and speaker_count <= 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "speaker_count must be greater than zero",
        )
    if speaker_count is not None and not diarize:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "speaker_count requires diarize=true",
        )
    try:
        parsed_hotwords = parse_hotwords(
            hotwords,
            max_items=settings.max_hotwords,
            max_chars=settings.max_hotword_chars,
        )
    except ValueError as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            str(error),
        ) from error
    return JobConfig(
        model=settings.asr_model,
        language=language.strip() or "zh",
        hotwords=parsed_hotwords,
        diarize=diarize,
        speaker_count=speaker_count,
    )


def _job_response(job: JobRecord) -> TranscriptionJobResponse:
    return TranscriptionJobResponse.model_validate(
        {
            "id": job.id,
            "status": job.status,
            "stage": job.stage,
            "attempt": job.attempt_count,
            "recovery_count": job.recovery_count,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "started_at": job.started_at,
            "completed_at": job.completed_at,
            "input": {
                "filename": job.original_filename,
                "content_type": job.content_type,
                "size_bytes": job.size_bytes,
                "sha256": job.sha256,
            },
            "config": {
                "model": job.config.model,
                "language": job.config.language,
                "hotwords": job.config.hotwords,
                "diarize": job.config.diarize,
                "speaker_count": job.config.speaker_count,
            },
            "result": job.result,
            "error": job.error.__dict__ if job.error is not None else None,
        }
    )


async def _save_upload(file: UploadFile, max_file_bytes: int) -> Path:
    suffix = Path(file.filename or "audio.wav").suffix.lower() or ".wav"
    descriptor, raw_path = tempfile.mkstemp(prefix="funasr-", suffix=suffix)
    path = Path(raw_path)
    total = 0
    try:
        with os.fdopen(descriptor, "wb") as output:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > max_file_bytes:
                    raise HTTPException(
                        status.HTTP_413_CONTENT_TOO_LARGE,
                        f"audio exceeds {max_file_bytes} bytes",
                    )
                output.write(chunk)
        if total == 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "audio is empty")
        return path
    except Exception:
        path.unlink(missing_ok=True)
        raise


def _authorize(settings: Settings, authorization: str | None) -> None:
    if settings.service_token is None:
        return
    expected = f"Bearer {settings.service_token}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid service token")


def _health_response(
    service: FunASRModelService, settings: Settings
) -> HealthResponse:
    return HealthResponse(
        status="ok" if service.ready else "not_ready",
        ready=service.ready,
        device=settings.device,
        service_version=settings.service_version,
        models={
            "asr": settings.asr_model,
            "vad": settings.vad_model,
            "punctuation": settings.punctuation_model,
            "speaker": settings.speaker_model,
        },
        active_requests=service.active_requests,
        max_concurrency=settings.max_concurrency,
        error=service.load_error,
    )


app = create_app()
