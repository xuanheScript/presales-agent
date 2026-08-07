from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal

from .contracts import TranscriptionResponse

JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]


class JobNotFoundError(RuntimeError):
    pass


class IdempotencyConflictError(RuntimeError):
    pass


class JobCapacityError(RuntimeError):
    pass


class JobCancellationConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class JobConfig:
    model: str
    language: str
    hotwords: list[str]
    diarize: bool
    speaker_count: int | None

    def canonical_json(self) -> str:
        return json.dumps(
            {
                "diarize": self.diarize,
                "hotwords": self.hotwords,
                "language": self.language,
                "model": self.model,
                "speaker_count": self.speaker_count,
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )


@dataclass(frozen=True)
class JobError:
    code: str
    message: str
    retryable: bool
    occurred_at: str


@dataclass(frozen=True)
class JobRecord:
    id: str
    idempotency_key: str
    request_fingerprint: str
    status: JobStatus
    stage: str
    attempt_count: int
    recovery_count: int
    created_at: str
    updated_at: str
    started_at: str | None
    completed_at: str | None
    input_path: Path
    original_filename: str
    content_type: str
    size_bytes: int
    sha256: str
    config: JobConfig
    result: TranscriptionResponse | None
    error: JobError | None


class SQLiteJobStore:
    def __init__(self, database_path: Path, *, max_queued_jobs: int = 100) -> None:
        self.database_path = database_path
        self.max_queued_jobs = max_queued_jobs
        self._initialize_lock = threading.Lock()

    def initialize(self) -> None:
        with self._initialize_lock:
            self.database_path.parent.mkdir(parents=True, exist_ok=True)
            with self._connect() as connection:
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS transcription_jobs (
                        id TEXT PRIMARY KEY,
                        idempotency_key TEXT NOT NULL UNIQUE,
                        request_fingerprint TEXT NOT NULL,
                        status TEXT NOT NULL CHECK (
                            status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
                        ),
                        stage TEXT NOT NULL,
                        attempt_count INTEGER NOT NULL DEFAULT 0,
                        recovery_count INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        started_at TEXT,
                        completed_at TEXT,
                        input_path TEXT NOT NULL,
                        original_filename TEXT NOT NULL,
                        content_type TEXT NOT NULL,
                        size_bytes INTEGER NOT NULL,
                        sha256 TEXT NOT NULL,
                        config_json TEXT NOT NULL,
                        result_json TEXT,
                        error_json TEXT
                    );
                    CREATE INDEX IF NOT EXISTS transcription_jobs_queue_idx
                        ON transcription_jobs(status, created_at, id);
                    """
                )
                connection.execute("PRAGMA user_version = 1")

    def create_or_get(
        self,
        *,
        idempotency_key: str,
        media_sha256: str,
        input_path: Path,
        original_filename: str,
        content_type: str,
        size_bytes: int,
        config: JobConfig,
    ) -> tuple[JobRecord, bool]:
        fingerprint = hashlib.sha256(
            f"{media_sha256}\n{config.canonical_json()}".encode()
        ).hexdigest()
        now = _utc_now()
        job_id = str(uuid.uuid4())
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                "SELECT * FROM transcription_jobs WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if existing is not None:
                if existing["request_fingerprint"] != fingerprint:
                    raise IdempotencyConflictError(
                        "idempotency key was already used with different input"
                    )
                return _row_to_record(existing), True

            queued = connection.execute(
                "SELECT COUNT(*) FROM transcription_jobs WHERE status = 'queued'"
            ).fetchone()[0]
            if queued >= self.max_queued_jobs:
                raise JobCapacityError("transcription job queue is full")

            connection.execute(
                """
                INSERT INTO transcription_jobs (
                    id, idempotency_key, request_fingerprint, status, stage,
                    created_at, updated_at, input_path, original_filename,
                    content_type, size_bytes, sha256, config_json
                ) VALUES (?, ?, ?, 'queued', 'queued', ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    idempotency_key,
                    fingerprint,
                    now,
                    now,
                    str(input_path),
                    original_filename,
                    content_type,
                    size_bytes,
                    media_sha256,
                    config.canonical_json(),
                ),
            )
            row = connection.execute(
                "SELECT * FROM transcription_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
            return _row_to_record(row), False

    def get(self, job_id: str) -> JobRecord:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM transcription_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
        if row is None:
            raise JobNotFoundError(f"transcription job not found: {job_id}")
        return _row_to_record(row)

    def claim_next(self) -> JobRecord | None:
        now = _utc_now()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            candidate = connection.execute(
                """
                SELECT id FROM transcription_jobs
                WHERE status = 'queued'
                ORDER BY created_at, id
                LIMIT 1
                """
            ).fetchone()
            if candidate is None:
                return None
            updated = connection.execute(
                """
                UPDATE transcription_jobs
                SET status = 'running', stage = 'normalizing',
                    attempt_count = attempt_count + 1,
                    started_at = ?, updated_at = ?
                WHERE id = ? AND status = 'queued'
                """,
                (now, now, candidate["id"]),
            )
            if updated.rowcount != 1:
                return None
            row = connection.execute(
                "SELECT * FROM transcription_jobs WHERE id = ?",
                (candidate["id"],),
            ).fetchone()
            return _row_to_record(row)

    def set_stage(self, job_id: str, stage: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE transcription_jobs SET stage = ?, updated_at = ?
                WHERE id = ? AND status = 'running'
                """,
                (stage, _utc_now(), job_id),
            )

    def requeue_running(
        self,
        job_id: str,
        *,
        stage: str = "queued",
        restore_attempt: bool = False,
    ) -> None:
        attempt_expression = (
            "MAX(attempt_count - 1, 0)" if restore_attempt else "attempt_count"
        )
        with self._connect() as connection:
            updated = connection.execute(
                f"""
                UPDATE transcription_jobs
                SET status = 'queued', stage = ?, started_at = NULL,
                    attempt_count = {attempt_expression}, updated_at = ?
                WHERE id = ? AND status = 'running'
                """,
                (stage, _utc_now(), job_id),
            )
            if updated.rowcount != 1:
                raise RuntimeError("job is not running")

    def mark_succeeded(self, job_id: str, result: TranscriptionResponse) -> None:
        now = _utc_now()
        with self._connect() as connection:
            updated = connection.execute(
                """
                UPDATE transcription_jobs
                SET status = 'succeeded', stage = 'complete', result_json = ?,
                    error_json = NULL, updated_at = ?, completed_at = ?
                WHERE id = ? AND status = 'running'
                """,
                (result.model_dump_json(), now, now, job_id),
            )
            if updated.rowcount != 1:
                raise RuntimeError("job is not running")

    def mark_failed(self, job_id: str, error: JobError) -> None:
        now = _utc_now()
        with self._connect() as connection:
            updated = connection.execute(
                """
                UPDATE transcription_jobs
                SET status = 'failed', stage = 'complete', result_json = NULL,
                    error_json = ?, updated_at = ?, completed_at = ?
                WHERE id = ? AND status IN ('queued', 'running')
                """,
                (json.dumps(error.__dict__, separators=(",", ":")), now, now, job_id),
            )
            if updated.rowcount != 1:
                raise RuntimeError("job cannot be marked failed")

    def cancel(self, job_id: str) -> JobRecord:
        now = _utc_now()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM transcription_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
            if row is None:
                raise JobNotFoundError(f"transcription job not found: {job_id}")
            if row["status"] == "cancelled":
                return _row_to_record(row)
            if row["status"] != "queued":
                raise JobCancellationConflictError(
                    f"cannot cancel job in {row['status']} status"
                )
            connection.execute(
                """
                UPDATE transcription_jobs
                SET status = 'cancelled', stage = 'complete',
                    updated_at = ?, completed_at = ?
                WHERE id = ? AND status = 'queued'
                """,
                (now, now, job_id),
            )
            updated = connection.execute(
                "SELECT * FROM transcription_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
            return _row_to_record(updated)

    def recover_interrupted(self, *, max_attempts: int) -> tuple[int, int]:
        recovered = 0
        failed = 0
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute(
                "SELECT * FROM transcription_jobs WHERE status IN ('queued', 'running')"
            ).fetchall()
            for row in rows:
                input_exists = Path(row["input_path"]).is_file()
                if not input_exists:
                    self._mark_failed_in_connection(
                        connection,
                        row["id"],
                        "INPUT_MISSING",
                        "source media is unavailable",
                    )
                    failed += 1
                elif row["status"] == "running" and row["attempt_count"] >= max_attempts:
                    self._mark_failed_in_connection(
                        connection,
                        row["id"],
                        "RECOVERY_LIMIT",
                        "job recovery limit was reached",
                    )
                    failed += 1
                elif row["status"] == "running":
                    connection.execute(
                        """
                        UPDATE transcription_jobs
                        SET status = 'queued', stage = 'queued', started_at = NULL,
                            recovery_count = recovery_count + 1, updated_at = ?
                        WHERE id = ? AND status = 'running'
                        """,
                        (_utc_now(), row["id"]),
                    )
                    recovered += 1
        return recovered, failed

    def terminal_sources_before(self, *, hours: int) -> list[JobRecord]:
        cutoff = (datetime.now(UTC) - timedelta(hours=hours)).isoformat()
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM transcription_jobs
                WHERE status IN ('succeeded', 'failed', 'cancelled')
                  AND completed_at IS NOT NULL
                  AND completed_at <= ?
                ORDER BY completed_at, id
                """,
                (cutoff,),
            ).fetchall()
        return [_row_to_record(row) for row in rows]

    def delete_terminal_before(self, *, days: int) -> list[Path]:
        cutoff = (datetime.now(UTC) - timedelta(days=days)).isoformat()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute(
                """
                SELECT input_path FROM transcription_jobs
                WHERE status IN ('succeeded', 'failed', 'cancelled')
                  AND completed_at IS NOT NULL
                  AND completed_at <= ?
                """,
                (cutoff,),
            ).fetchall()
            connection.execute(
                """
                DELETE FROM transcription_jobs
                WHERE status IN ('succeeded', 'failed', 'cancelled')
                  AND completed_at IS NOT NULL
                  AND completed_at <= ?
                """,
                (cutoff,),
            )
        return [Path(row["input_path"]) for row in rows]

    def referenced_input_paths(self, *, source_retention_hours: int) -> set[Path]:
        cutoff = (
            datetime.now(UTC) - timedelta(hours=source_retention_hours)
        ).isoformat()
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT input_path FROM transcription_jobs
                WHERE status IN ('queued', 'running')
                   OR (
                       status IN ('succeeded', 'failed')
                       AND completed_at IS NOT NULL
                       AND completed_at > ?
                   )
                """,
                (cutoff,),
            ).fetchall()
        return {Path(row["input_path"]).resolve() for row in rows}

    def counts(self) -> dict[str, int]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT status, COUNT(*) AS count FROM transcription_jobs GROUP BY status"
            ).fetchall()
        return {row["status"]: row["count"] for row in rows}

    def _mark_failed_in_connection(
        self,
        connection: sqlite3.Connection,
        job_id: str,
        code: str,
        message: str,
    ) -> None:
        now = _utc_now()
        error = JobError(code=code, message=message, retryable=False, occurred_at=now)
        connection.execute(
            """
            UPDATE transcription_jobs
            SET status = 'failed', stage = 'complete', error_json = ?,
                updated_at = ?, completed_at = ?
            WHERE id = ? AND status IN ('queued', 'running')
            """,
            (json.dumps(error.__dict__, separators=(",", ":")), now, now, job_id),
        )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = FULL")
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection


def _row_to_record(row: sqlite3.Row) -> JobRecord:
    config_data = json.loads(row["config_json"])
    result = (
        TranscriptionResponse.model_validate_json(row["result_json"])
        if row["result_json"]
        else None
    )
    error = JobError(**json.loads(row["error_json"])) if row["error_json"] else None
    return JobRecord(
        id=row["id"],
        idempotency_key=row["idempotency_key"],
        request_fingerprint=row["request_fingerprint"],
        status=row["status"],
        stage=row["stage"],
        attempt_count=row["attempt_count"],
        recovery_count=row["recovery_count"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        input_path=Path(row["input_path"]),
        original_filename=row["original_filename"],
        content_type=row["content_type"],
        size_bytes=row["size_bytes"],
        sha256=row["sha256"],
        config=JobConfig(**config_data),
        result=result,
        error=error,
    )


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()
