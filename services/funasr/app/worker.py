from __future__ import annotations

import threading
import time
from datetime import UTC, datetime

from .config import Settings
from .job_storage import LocalJobStorage
from .jobs import JobError, JobRecord, SQLiteJobStore
from .media import FFmpegMediaProcessor, MediaDurationError, MediaProcessingError
from .model_service import (
    FunASRModelService,
    InferenceCapacityError,
    ModelNotReadyError,
)


class TranscriptionWorker:
    def __init__(
        self,
        *,
        settings: Settings,
        store: SQLiteJobStore,
        storage: LocalJobStorage,
        media_processor: FFmpegMediaProcessor,
        model_service: FunASRModelService,
    ) -> None:
        self.settings = settings
        self.store = store
        self.storage = storage
        self.media_processor = media_processor
        self.model_service = model_service
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_cleanup_monotonic = 0.0

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.running:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="funasr-transcription-worker",
            daemon=True,
        )
        self._thread.start()

    def stop(self, *, timeout: float = 5) -> None:
        self._stop_event.set()
        self._wake_event.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    def notify(self) -> None:
        self._wake_event.set()

    def run_once(self) -> bool:
        self.cleanup_if_due()
        job = self.store.claim_next()
        if job is None:
            return False
        self._process(job)
        return True

    def _run(self) -> None:
        while not self._stop_event.is_set():
            if self.run_once():
                continue
            self._wake_event.wait(self.settings.job_poll_interval_seconds)
            self._wake_event.clear()

    def _process(self, job: JobRecord) -> None:
        normalized_path = self.storage.normalized_path(job.id)
        try:
            normalized = self.media_processor.normalize(
                job.input_path,
                normalized_path,
                max_duration_seconds=self.settings.max_duration_seconds,
            )
            self.store.set_stage(job.id, "transcribing")
            result = self.model_service.transcribe(
                normalized.path,
                duration=normalized.duration,
                language=job.config.language,
                hotwords=job.config.hotwords,
                diarize=job.config.diarize,
                speaker_count=job.config.speaker_count,
            )
            self.store.mark_succeeded(job.id, result)
        except MediaDurationError as error:
            self._fail(job.id, "DURATION_LIMIT", str(error), retryable=False)
        except MediaProcessingError as error:
            self._fail(job.id, "INVALID_MEDIA", str(error), retryable=False)
        except InferenceCapacityError:
            self.store.requeue_running(job.id, restore_attempt=True)
            self._wake_event.wait(self.settings.job_poll_interval_seconds)
            self._wake_event.clear()
        except ModelNotReadyError as error:
            self._fail(job.id, "MODEL_NOT_READY", str(error), retryable=True)
        except RuntimeError as error:
            self._fail(job.id, "INFERENCE_FAILED", str(error), retryable=False)
        except Exception as error:
            self._fail(job.id, "INTERNAL_ERROR", type(error).__name__, retryable=True)
        finally:
            normalized_path.unlink(missing_ok=True)

    def cleanup_if_due(self, *, force: bool = False) -> None:
        now = time.monotonic()
        if (
            not force
            and now - self._last_cleanup_monotonic
            < self.settings.cleanup_interval_seconds
        ):
            return
        self._last_cleanup_monotonic = now
        for job in self.store.terminal_sources_before(
            hours=self.settings.source_retention_hours
        ):
            self.storage.delete_source(job.input_path)
        for source_path in self.store.delete_terminal_before(
            days=self.settings.job_retention_days
        ):
            self.storage.delete_source(source_path)
        self.storage.cleanup_orphans(
            self.store.referenced_input_paths(
                source_retention_hours=self.settings.source_retention_hours
            )
        )

    def _fail(self, job_id: str, code: str, message: str, *, retryable: bool) -> None:
        safe_message = " ".join(message.split())[:500]
        self.store.mark_failed(
            job_id,
            JobError(
                code=code,
                message=safe_message,
                retryable=retryable,
                occurred_at=datetime.now(UTC).isoformat(),
            ),
        )
