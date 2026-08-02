from __future__ import annotations

import io
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from app.config import Settings
from app.job_storage import LocalJobStorage
from app.jobs import JobConfig, SQLiteJobStore
from app.worker import TranscriptionWorker
from test_worker import FakeMediaProcessor, FakeModelService


class RetentionTest(unittest.TestCase):
    def test_removes_expired_source_then_terminal_record(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            storage = LocalJobStorage(root)
            storage.initialize()
            try:
                store = SQLiteJobStore(root / "jobs.sqlite3")
                store.initialize()
                upload = storage.write_stream(
                    io.BytesIO(b"audio"),
                    filename="meeting.webm",
                    max_file_bytes=100,
                )
                job, _ = store.create_or_get(
                    idempotency_key="retention-job",
                    media_sha256=upload.sha256,
                    input_path=upload.path,
                    original_filename=upload.original_filename,
                    content_type="audio/webm",
                    size_bytes=upload.size_bytes,
                    config=JobConfig(
                        model="paraformer-zh",
                        language="zh",
                        hotwords=[],
                        diarize=False,
                        speaker_count=None,
                    ),
                )
                store.cancel(job.id)
                old = (datetime.now(UTC) - timedelta(days=40)).isoformat()
                with store._connect() as connection:
                    connection.execute(
                        "UPDATE transcription_jobs SET completed_at = ? WHERE id = ?",
                        (old, job.id),
                    )

                worker = TranscriptionWorker(
                    settings=Settings(
                        data_dir=root,
                        source_retention_hours=24,
                        job_retention_days=30,
                    ),
                    store=store,
                    storage=storage,
                    media_processor=FakeMediaProcessor(),
                    model_service=FakeModelService(),
                )
                worker.cleanup_if_due(force=True)

                self.assertFalse(upload.path.exists())
                with self.assertRaisesRegex(RuntimeError, "not found"):
                    store.get(job.id)
            finally:
                storage.close()

    def test_cleans_orphan_upload_directory(self) -> None:
        with TemporaryDirectory() as directory:
            storage = LocalJobStorage(Path(directory))
            storage.initialize()
            try:
                upload = storage.write_stream(
                    io.BytesIO(b"audio"),
                    filename="orphan.webm",
                    max_file_bytes=100,
                )
                self.assertEqual(storage.cleanup_orphans(set()), 1)
                self.assertFalse(upload.path.exists())
            finally:
                storage.close()


if __name__ == "__main__":
    unittest.main()
