from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.config import Settings
from app.job_storage import LocalJobStorage
from app.jobs import JobConfig, SQLiteJobStore
from app.media import NormalizedAudio
from app.model_service import InferenceCapacityError
from app.worker import TranscriptionWorker
from test_jobs import _result


class FakeMediaProcessor:
    def normalize(
        self,
        source_path: Path,
        output_path: Path,
        *,
        max_duration_seconds: int,
    ) -> NormalizedAudio:
        output_path.write_bytes(b"wav")
        return NormalizedAudio(path=output_path, duration=1.0)


class FakeModelService:
    def __init__(self) -> None:
        self.busy = False

    def transcribe(self, *_: object, **__: object):
        if self.busy:
            raise InferenceCapacityError("busy")
        return _result()


class TranscriptionWorkerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.storage = LocalJobStorage(self.root)
        self.storage.initialize()
        self.store = SQLiteJobStore(self.root / "jobs.sqlite3")
        self.store.initialize()
        self.service = FakeModelService()
        self.worker = TranscriptionWorker(
            settings=Settings(
                data_dir=self.root,
                job_poll_interval_seconds=0.01,
                cleanup_interval_seconds=3_600,
            ),
            store=self.store,
            storage=self.storage,
            media_processor=FakeMediaProcessor(),
            model_service=self.service,
        )

    def tearDown(self) -> None:
        self.storage.close()
        self.directory.cleanup()

    def _create(self, key: str):
        upload = self.storage.write_stream(
            _BytesReader(b"audio"),
            filename="meeting.webm",
            max_file_bytes=100,
        )
        record, _ = self.store.create_or_get(
            idempotency_key=key,
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
        return record

    def test_processes_queued_job_and_cleans_normalized_audio(self) -> None:
        record = self._create("worker-success")

        self.assertTrue(self.worker.run_once())

        completed = self.store.get(record.id)
        self.assertEqual(completed.status, "succeeded")
        self.assertEqual(completed.result.text, "测试。")
        self.assertFalse(self.storage.normalized_path(record.id).exists())

    def test_requeues_when_inference_slot_is_busy(self) -> None:
        record = self._create("worker-busy")
        self.service.busy = True

        self.assertTrue(self.worker.run_once())

        queued = self.store.get(record.id)
        self.assertEqual(queued.status, "queued")
        self.assertEqual(queued.attempt_count, 0)


class _BytesReader:
    def __init__(self, value: bytes) -> None:
        self.value = value
        self.read_once = False

    def read(self, _: int) -> bytes:
        if self.read_once:
            return b""
        self.read_once = True
        return self.value


if __name__ == "__main__":
    unittest.main()
