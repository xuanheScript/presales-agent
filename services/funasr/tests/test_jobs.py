from __future__ import annotations

import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.contracts import ModelMetadata, TranscriptionResponse
from app.jobs import (
    IdempotencyConflictError,
    JobCancellationConflictError,
    JobConfig,
    SQLiteJobStore,
)


class SQLiteJobStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.store = SQLiteJobStore(self.root / "jobs.sqlite3", max_queued_jobs=10)
        self.store.initialize()
        self.config = JobConfig(
            model="paraformer-zh",
            language="zh",
            hotwords=["Supabase"],
            diarize=True,
            speaker_count=2,
        )

    def tearDown(self) -> None:
        self.directory.cleanup()

    def _source(self, name: str = "source") -> Path:
        path = self.root / name
        path.write_bytes(b"audio")
        return path

    def _create(self, key: str, source: Path | None = None):
        input_path = source or self._source(key)
        return self.store.create_or_get(
            idempotency_key=key,
            media_sha256="abc123",
            input_path=input_path,
            original_filename="meeting.webm",
            content_type="audio/webm",
            size_bytes=5,
            config=self.config,
        )

    def test_idempotency_replays_same_job_and_rejects_changed_config(self) -> None:
        created, replayed = self._create("idempotency-1")
        same, replayed_again = self._create("idempotency-1", self._source("duplicate"))

        self.assertFalse(replayed)
        self.assertTrue(replayed_again)
        self.assertEqual(same.id, created.id)

        changed = JobConfig(
            model="paraformer-zh",
            language="en",
            hotwords=["Supabase"],
            diarize=True,
            speaker_count=2,
        )
        with self.assertRaises(IdempotencyConflictError):
            self.store.create_or_get(
                idempotency_key="idempotency-1",
                media_sha256="abc123",
                input_path=self._source("conflict"),
                original_filename="meeting.webm",
                content_type="audio/webm",
                size_bytes=5,
                config=changed,
            )

    def test_concurrent_idempotency_creates_one_job(self) -> None:
        source = self._source("shared")
        results: list[str] = []
        errors: list[Exception] = []
        barrier = threading.Barrier(3)

        def create() -> None:
            try:
                barrier.wait()
                record, _ = self._create("idempotency-concurrent", source)
                results.append(record.id)
            except Exception as error:
                errors.append(error)

        threads = [threading.Thread(target=create) for _ in range(2)]
        for thread in threads:
            thread.start()
        barrier.wait()
        for thread in threads:
            thread.join()

        self.assertEqual(errors, [])
        self.assertEqual(len(set(results)), 1)
        self.assertEqual(self.store.counts(), {"queued": 1})

    def test_claim_cancel_and_terminal_result_are_persistent(self) -> None:
        first, _ = self._create("idempotency-a")
        second, _ = self._create("idempotency-b")
        claimed = self.store.claim_next()

        self.assertIsNotNone(claimed)
        self.assertEqual(claimed.id, first.id)
        self.assertEqual(claimed.status, "running")
        self.assertEqual(claimed.attempt_count, 1)
        with self.assertRaises(JobCancellationConflictError):
            self.store.cancel(first.id)

        cancelled = self.store.cancel(second.id)
        self.assertEqual(cancelled.status, "cancelled")
        self.assertEqual(self.store.cancel(second.id).status, "cancelled")

        self.store.mark_succeeded(first.id, _result())
        reopened = SQLiteJobStore(self.root / "jobs.sqlite3")
        self.assertEqual(reopened.get(first.id).result.text, "测试。")

    def test_recovers_running_and_fails_missing_inputs(self) -> None:
        running, _ = self._create("idempotency-running")
        self.store.claim_next()
        missing, _ = self._create("idempotency-missing")
        missing.input_path.unlink()

        recovered, failed = self.store.recover_interrupted(max_attempts=3)

        self.assertEqual((recovered, failed), (1, 1))
        self.assertEqual(self.store.get(running.id).status, "queued")
        self.assertEqual(self.store.get(running.id).recovery_count, 1)
        missing_record = self.store.get(missing.id)
        self.assertEqual(missing_record.status, "failed")
        self.assertEqual(missing_record.error.code, "INPUT_MISSING")

    def test_recovery_limit_fails_interrupted_job(self) -> None:
        record, _ = self._create("idempotency-recovery-limit")
        self.store.claim_next()

        recovered, failed = self.store.recover_interrupted(max_attempts=1)

        self.assertEqual((recovered, failed), (0, 1))
        failed_record = self.store.get(record.id)
        self.assertEqual(failed_record.status, "failed")
        self.assertEqual(failed_record.error.code, "RECOVERY_LIMIT")


def _result() -> TranscriptionResponse:
    return TranscriptionResponse(
        language="zh",
        duration=1.0,
        text="测试。",
        raw_text="测 试",
        alignment={"status": "aligned", "token_count": 0, "timestamp_count": 0},
        model=ModelMetadata(
            service_version="test",
            asr_model="paraformer-zh",
            vad_model="fsmn-vad",
            punctuation_model="ct-punc",
            speaker_model=None,
            model_revision="test",
            device="cpu",
            timestamp_source="model",
            speaker_scope="none",
        ),
        processing_time=0.1,
        rtf=0.1,
    )


if __name__ == "__main__":
    unittest.main()
