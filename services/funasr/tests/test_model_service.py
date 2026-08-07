from __future__ import annotations

import sys
import threading
import types
import unittest
from pathlib import Path

from app.config import Settings
from app.model_service import FunASRModelService, InferenceCapacityError


class BlockingModel:
    def __init__(self) -> None:
        self.entered = threading.Event()
        self.release = threading.Event()

    def generate(self, **_: object) -> list[dict[str, object]]:
        self.entered.set()
        if not self.release.wait(timeout=2):
            raise TimeoutError("test did not release fake inference")
        return [
            {
                "text": "测试。",
                "raw_text": "测 试",
                "timestamp": [[0, 100], [100, 200]],
            }
        ]


class ModelServiceConcurrencyTest(unittest.TestCase):
    def test_passes_configured_revision_to_auto_model(self) -> None:
        captured: dict[str, object] = {}

        class FakeAutoModel:
            def __init__(self, **kwargs: object) -> None:
                captured.update(kwargs)

        fake_funasr = types.ModuleType("funasr")
        fake_funasr.AutoModel = FakeAutoModel  # type: ignore[attr-defined]
        original_funasr = sys.modules.get("funasr")
        sys.modules["funasr"] = fake_funasr
        try:
            service = FunASRModelService(Settings(model_revision="fixed-revision"))
            service.load()
        finally:
            if original_funasr is None:
                sys.modules.pop("funasr", None)
            else:
                sys.modules["funasr"] = original_funasr

        self.assertEqual(captured["model_revision"], "fixed-revision")

    def test_rejects_second_request_while_inference_slot_is_busy(self) -> None:
        service = FunASRModelService(Settings())
        model = BlockingModel()
        service._model = model
        result: list[object] = []

        def run_first_request() -> None:
            result.append(
                service.transcribe(
                    Path("test.wav"),
                    duration=1.0,
                    language="zh",
                    hotwords=[],
                    diarize=False,
                    speaker_count=None,
                )
            )

        worker = threading.Thread(target=run_first_request)
        worker.start()
        self.assertTrue(model.entered.wait(timeout=1))
        self.assertEqual(service.active_requests, 1)

        with self.assertRaises(InferenceCapacityError):
            service.transcribe(
                Path("test.wav"),
                duration=1.0,
                language="zh",
                hotwords=[],
                diarize=False,
                speaker_count=None,
            )

        model.release.set()
        worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(service.active_requests, 0)
        self.assertEqual(len(result), 1)


if __name__ == "__main__":
    unittest.main()
