from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

from .config import Settings
from .contracts import ModelMetadata, TranscriptionResponse
from .normalizer import normalize_result


class ModelNotReadyError(RuntimeError):
    pass


class InferenceCapacityError(RuntimeError):
    pass


class FunASRModelService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model: Any | None = None
        self._load_error: str | None = None
        self._state_lock = threading.Lock()
        self._inference_slots = threading.BoundedSemaphore(settings.max_concurrency)
        self._active_requests = 0

    @property
    def ready(self) -> bool:
        return self._model is not None and self._load_error is None

    @property
    def load_error(self) -> str | None:
        return self._load_error

    @property
    def active_requests(self) -> int:
        with self._state_lock:
            return self._active_requests

    def load(self) -> None:
        try:
            from funasr import AutoModel

            self._model = AutoModel(
                model=self.settings.asr_model,
                vad_model=self.settings.vad_model,
                punc_model=self.settings.punctuation_model,
                spk_model=self.settings.speaker_model,
                spk_mode=self.settings.speaker_mode,
                hub=self.settings.model_hub,
                model_revision=self.settings.model_revision,
                device=self.settings.device,
                disable_update=True,
            )
            self._load_error = None
        except Exception as error:
            self._model = None
            self._load_error = f"{type(error).__name__}: {error}"
            raise

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
        if not self.ready or self._model is None:
            raise ModelNotReadyError(self._load_error or "FunASR model is not loaded")
        if not self._inference_slots.acquire(blocking=False):
            raise InferenceCapacityError("all FunASR inference slots are busy")

        with self._state_lock:
            self._active_requests += 1
        try:
            kwargs: dict[str, Any] = {
                "input": str(audio_path),
                "batch_size": 1,
                "return_raw_text": True,
                "sentence_timestamp": True,
                "return_spk_res": diarize,
            }
            if hotwords:
                kwargs["hotword"] = " ".join(hotwords)
            if speaker_count is not None:
                kwargs["preset_spk_num"] = speaker_count

            started = time.perf_counter()
            native_results = self._model.generate(**kwargs)
            processing_time = time.perf_counter() - started
            if not isinstance(native_results, list) or not native_results:
                raise RuntimeError("FunASR returned no transcription result")
            native_result = native_results[0]
            if not isinstance(native_result, dict):
                raise RuntimeError("FunASR returned an invalid transcription result")

            return normalize_result(
                native_result,
                duration=duration,
                language=language,
                processing_time=processing_time,
                model_metadata=self.model_metadata(diarize=diarize),
            )
        finally:
            with self._state_lock:
                self._active_requests -= 1
            self._inference_slots.release()

    def model_metadata(self, *, diarize: bool) -> ModelMetadata:
        return ModelMetadata(
            service_version=self.settings.service_version,
            asr_model=self.settings.asr_model,
            vad_model=self.settings.vad_model,
            punctuation_model=self.settings.punctuation_model,
            speaker_model=self.settings.speaker_model if diarize else None,
            model_revision=self.settings.model_revision,
            device=self.settings.device,
            timestamp_source="model",
            speaker_scope="recording" if diarize else "none",
        )
