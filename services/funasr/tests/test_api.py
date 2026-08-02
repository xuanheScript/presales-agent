from __future__ import annotations

import io
import threading
import time
import unittest
import wave
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from app.config import Settings
from app.contracts import ModelMetadata, TranscriptionResponse
from app.main import create_app
from app.media import MediaDurationError, MediaProcessingError, NormalizedAudio
from app.model_service import InferenceCapacityError


class FakeMediaProcessor:
    def __init__(self) -> None:
        self.calls: list[tuple[Path, Path]] = []
        self.duration = 1.0
        self.error: MediaProcessingError | None = None

    def normalize(
        self,
        source_path: Path,
        output_path: Path,
        *,
        max_duration_seconds: int,
    ) -> NormalizedAudio:
        self.calls.append((source_path, output_path))
        if self.error is not None:
            raise self.error
        if self.duration > max_duration_seconds:
            raise MediaDurationError(
                f"audio duration exceeds {max_duration_seconds} seconds"
            )
        output_path.write_bytes(b"normalized wav")
        return NormalizedAudio(path=output_path, duration=self.duration)


class FakeModelService:
    def __init__(self) -> None:
        self.ready = True
        self.load_error = None
        self.active_requests = 0
        self.calls: list[dict[str, object]] = []

    def transcribe(
        self,
        audio_path: Path,
        *,
        duration: float,
        language: str,
        hotwords: list[str],
        diarize: bool,
        speaker_count: int | None,
    ) -> TranscriptionResponse:
        self.calls.append(
            {
                "path": audio_path,
                "duration": duration,
                "language": language,
                "hotwords": hotwords,
                "diarize": diarize,
                "speaker_count": speaker_count,
            }
        )
        return TranscriptionResponse(
            language=language,
            duration=duration,
            text="测试。",
            raw_text="测 试",
            tokens=[
                {"text": "测", "start_ms": 0, "end_ms": 100},
                {"text": "试", "start_ms": 100, "end_ms": 200},
            ],
            segments=[
                {
                    "id": 0,
                    "start_ms": 0,
                    "end_ms": 200,
                    "text": "测试。",
                    "speaker": "speaker_0" if diarize else None,
                    "speaker_id": 0 if diarize else None,
                    "tokens": [],
                }
            ],
            alignment={"status": "aligned", "token_count": 2, "timestamp_count": 2},
            model=ModelMetadata(
                service_version="test",
                asr_model="paraformer-zh",
                vad_model="fsmn-vad",
                punctuation_model="ct-punc",
                speaker_model="cam++" if diarize else None,
                model_revision="test",
                device="cpu",
                timestamp_source="model",
                speaker_scope="recording" if diarize else "none",
            ),
            processing_time=0.1,
            rtf=0.1,
        )


class ApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = TemporaryDirectory()
        self.service = FakeModelService()
        self.media_processor = FakeMediaProcessor()
        self.settings = Settings(
            service_token="secret",
            max_file_bytes=1_000_000,
            max_duration_seconds=10,
            data_dir=Path(self.directory.name),
        )
        self.client = TestClient(
            create_app(
                self.settings,
                self.service,
                self.media_processor,
                load_model=False,
                start_worker=False,
            )
        )
        self.client.__enter__()
        self.audio = _wav_bytes(seconds=1)

    def tearDown(self) -> None:
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def test_health_and_models(self) -> None:
        health = self.client.get("/health/ready")
        self.assertEqual(health.status_code, 200)
        self.assertTrue(health.json()["ready"])
        models = self.client.get("/v1/models")
        self.assertEqual(models.json()["data"][0]["id"], "paraformer-zh")

    def test_requires_bearer_token(self) -> None:
        response = self.client.post(
            "/v1/audio/transcriptions",
            files={"file": ("test.wav", self.audio, "audio/wav")},
        )
        self.assertEqual(response.status_code, 401)

    def test_transcribes_and_passes_validated_options(self) -> None:
        response = self.client.post(
            "/v1/audio/transcriptions",
            headers={"Authorization": "Bearer secret"},
            files={"file": ("test.wav", self.audio, "audio/wav")},
            data={
                "model": "paraformer",
                "language": "zh",
                "response_format": "verbose_json",
                "hotwords": '["Next.js", "Supabase"]',
                "diarize": "true",
                "speaker_count": "2",
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["segments"][0]["speaker"], "speaker_0")
        self.assertEqual(self.service.calls[0]["hotwords"], ["Next.js", "Supabase"])
        self.assertEqual(self.service.calls[0]["speaker_count"], 2)
        self.assertTrue(str(self.service.calls[0]["path"]).endswith("-normalized.wav"))
        self.assertFalse(Path(self.service.calls[0]["path"]).exists())
        source_path, normalized_path = self.media_processor.calls[0]
        self.assertFalse(source_path.exists())
        self.assertFalse(normalized_path.exists())

    def test_returns_retryable_429_when_inference_is_busy(self) -> None:
        def reject_busy(*_: object, **__: object) -> TranscriptionResponse:
            raise InferenceCapacityError("all FunASR inference slots are busy")

        self.service.transcribe = reject_busy  # type: ignore[method-assign]
        response = self.client.post(
            "/v1/audio/transcriptions",
            headers={"Authorization": "Bearer secret"},
            files={"file": ("test.wav", self.audio, "audio/wav")},
        )

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["Retry-After"], "1")

    def test_rejects_speaker_count_without_diarization(self) -> None:
        response = self.client.post(
            "/v1/audio/transcriptions",
            headers={"Authorization": "Bearer secret"},
            files={"file": ("test.wav", self.audio, "audio/wav")},
            data={"speaker_count": "2"},
        )
        self.assertEqual(response.status_code, 422)

    def test_rejects_unsupported_media(self) -> None:
        response = self.client.post(
            "/v1/audio/transcriptions",
            headers={"Authorization": "Bearer secret"},
            files={"file": ("test.txt", b"not audio", "text/plain")},
        )
        self.assertEqual(response.status_code, 415)

    def test_accepts_browser_media_through_normalization(self) -> None:
        for filename, content_type in (
            ("test.webm", "audio/webm"),
            ("test.mp4", "audio/mp4"),
            ("test.mp4", "video/mp4"),
        ):
            with self.subTest(content_type=content_type):
                response = self.client.post(
                    "/v1/audio/transcriptions",
                    headers={"Authorization": "Bearer secret"},
                    files={"file": (filename, b"browser audio", content_type)},
                )
                self.assertEqual(response.status_code, 200, response.text)

    def test_returns_422_when_media_normalization_fails(self) -> None:
        self.media_processor.error = MediaProcessingError("invalid media")
        response = self.client.post(
            "/v1/audio/transcriptions",
            headers={"Authorization": "Bearer secret"},
            files={"file": ("test.webm", b"invalid", "audio/webm")},
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("audio could not be processed", response.json()["detail"])
        source_path, normalized_path = self.media_processor.calls[0]
        self.assertFalse(source_path.exists())
        self.assertFalse(normalized_path.exists())

    def test_rejects_audio_longer_than_limit_after_probe(self) -> None:
        self.media_processor.duration = 11.0
        response = self.client.post(
            "/v1/audio/transcriptions",
            headers={"Authorization": "Bearer secret"},
            files={"file": ("test.webm", b"browser audio", "audio/webm")},
        )

        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.service.calls, [])

    def test_rejects_oversized_upload(self) -> None:
        with TemporaryDirectory() as directory:
            settings = Settings(
                service_token="secret",
                max_file_bytes=10,
                data_dir=Path(directory),
            )
            with TestClient(
                create_app(
                    settings,
                    self.service,
                    self.media_processor,
                    load_model=False,
                    start_worker=False,
                )
            ) as client:
                response = client.post(
                    "/v1/audio/transcriptions",
                    headers={"Authorization": "Bearer secret"},
                    files={"file": ("test.wav", self.audio, "audio/wav")},
                )
        self.assertEqual(response.status_code, 413)

    def test_creates_queries_replays_and_cancels_job(self) -> None:
        headers = {
            "Authorization": "Bearer secret",
            "Idempotency-Key": "meeting-job-0001",
        }
        response = self.client.post(
            "/internal/v1/transcription-jobs",
            headers=headers,
            files={"file": ("meeting.webm", b"browser audio", "audio/webm")},
            data={
                "hotwords": '["Next.js"]',
                "diarize": "true",
                "speaker_count": "2",
            },
        )

        self.assertEqual(response.status_code, 202, response.text)
        job = response.json()
        self.assertEqual(job["status"], "queued")
        self.assertNotIn("input_path", response.text)
        self.assertEqual(response.headers["Location"], f"/internal/v1/transcription-jobs/{job['id']}")

        replay = self.client.post(
            "/internal/v1/transcription-jobs",
            headers=headers,
            files={"file": ("meeting.webm", b"browser audio", "audio/webm")},
            data={
                "hotwords": '["Next.js"]',
                "diarize": "true",
                "speaker_count": "2",
            },
        )
        self.assertEqual(replay.status_code, 202)
        self.assertEqual(replay.json()["id"], job["id"])
        self.assertEqual(replay.headers["Idempotency-Replayed"], "true")

        fetched = self.client.get(
            response.headers["Location"],
            headers={"Authorization": "Bearer secret"},
        )
        self.assertEqual(fetched.status_code, 200)
        cancelled = self.client.post(
            f"/internal/v1/transcription-jobs/{job['id']}/cancel",
            headers={"Authorization": "Bearer secret"},
        )
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()["status"], "cancelled")
        source_path = self.client.app.state.job_store.get(job["id"]).input_path
        self.assertFalse(source_path.exists())

    def test_rejects_missing_or_conflicting_idempotency_key(self) -> None:
        missing = self.client.post(
            "/internal/v1/transcription-jobs",
            headers={"Authorization": "Bearer secret"},
            files={"file": ("meeting.webm", b"audio", "audio/webm")},
        )
        self.assertEqual(missing.status_code, 422)

        headers = {
            "Authorization": "Bearer secret",
            "Idempotency-Key": "meeting-job-conflict",
        }
        first = self.client.post(
            "/internal/v1/transcription-jobs",
            headers=headers,
            files={"file": ("meeting.webm", b"audio-a", "audio/webm")},
        )
        conflict = self.client.post(
            "/internal/v1/transcription-jobs",
            headers=headers,
            files={"file": ("meeting.webm", b"audio-b", "audio/webm")},
        )
        self.assertEqual(first.status_code, 202)
        self.assertEqual(conflict.status_code, 409)
        upload_sources = list(self.client.app.state.job_storage.uploads_dir.glob("*/source"))
        self.assertEqual(len(upload_sources), 1)


def _wav_bytes(*, seconds: int) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16_000)
        audio.writeframes(b"\x00\x00" * 16_000 * seconds)
    return output.getvalue()


if __name__ == "__main__":
    unittest.main()
