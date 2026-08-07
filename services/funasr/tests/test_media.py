from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app.media import FFmpegMediaProcessor, MediaDurationError, MediaProcessingError


class FFmpegMediaProcessorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.processor = FFmpegMediaProcessor(
            ffmpeg_path="ffmpeg-test",
            ffprobe_path="ffprobe-test",
        )

    @patch("app.media.shutil.which", return_value="/usr/bin/tool")
    @patch("app.media.subprocess.run")
    def test_probes_and_normalizes_to_mono_16khz_wav(
        self,
        run: unittest.mock.Mock,
        _: unittest.mock.Mock,
    ) -> None:
        with TemporaryDirectory() as directory:
            source = Path(directory) / "meeting.webm"
            output = Path(directory) / "meeting.wav"
            source.write_bytes(b"webm")

            def command_result(command: list[str], **__: object) -> subprocess.CompletedProcess[str]:
                if command[0] == "ffprobe-test":
                    return subprocess.CompletedProcess(command, 0, "12.5\n", "")
                output.write_bytes(b"wav")
                return subprocess.CompletedProcess(command, 0, "", "")

            run.side_effect = command_result
            normalized = self.processor.normalize(
                source,
                output,
                max_duration_seconds=60,
            )

        self.assertEqual(normalized.duration, 12.5)
        ffmpeg_command = run.call_args_list[1].args[0]
        self.assertIn("-ac", ffmpeg_command)
        self.assertEqual(ffmpeg_command[ffmpeg_command.index("-ac") + 1], "1")
        self.assertEqual(ffmpeg_command[ffmpeg_command.index("-ar") + 1], "16000")
        self.assertEqual(ffmpeg_command[ffmpeg_command.index("-c:a") + 1], "pcm_s16le")

    @patch("app.media.shutil.which", return_value=None)
    def test_rejects_missing_ffmpeg(self, _: unittest.mock.Mock) -> None:
        with TemporaryDirectory() as directory, self.assertRaisesRegex(
            MediaProcessingError,
            "required executable is unavailable",
        ):
            self.processor.normalize(
                Path(directory) / "meeting.webm",
                Path(directory) / "meeting.wav",
                max_duration_seconds=60,
            )

    @patch("app.media.shutil.which", return_value="/usr/bin/tool")
    @patch("app.media.subprocess.run")
    def test_rejects_duration_before_transcoding(
        self,
        run: unittest.mock.Mock,
        _: unittest.mock.Mock,
    ) -> None:
        run.return_value = subprocess.CompletedProcess([], 0, "120.0\n", "")
        with TemporaryDirectory() as directory, self.assertRaisesRegex(
            MediaDurationError,
            "exceeds 60 seconds",
        ):
            self.processor.normalize(
                Path(directory) / "meeting.webm",
                Path(directory) / "meeting.wav",
                max_duration_seconds=60,
            )
        self.assertEqual(run.call_count, 1)

    @patch("app.media.shutil.which", return_value="/usr/bin/tool")
    @patch("app.media.subprocess.run")
    def test_rejects_invalid_probe_duration(
        self,
        run: unittest.mock.Mock,
        _: unittest.mock.Mock,
    ) -> None:
        run.return_value = subprocess.CompletedProcess([], 0, "unknown", "")
        with TemporaryDirectory() as directory, self.assertRaisesRegex(
            MediaProcessingError,
            "invalid duration",
        ):
            self.processor.normalize(
                Path(directory) / "meeting.webm",
                Path(directory) / "meeting.wav",
                max_duration_seconds=60,
            )

    @patch("app.media.shutil.which", return_value="/usr/bin/tool")
    @patch("app.media.subprocess.run")
    def test_removes_partial_output_when_ffmpeg_fails(
        self,
        run: unittest.mock.Mock,
        _: unittest.mock.Mock,
    ) -> None:
        with TemporaryDirectory() as directory:
            output = Path(directory) / "meeting.wav"

            def command_result(command: list[str], **__: object) -> subprocess.CompletedProcess[str]:
                if command[0] == "ffprobe-test":
                    return subprocess.CompletedProcess(command, 0, "2.0\n", "")
                output.write_bytes(b"partial")
                return subprocess.CompletedProcess(command, 1, "", "decode failed")

            run.side_effect = command_result
            with self.assertRaisesRegex(MediaProcessingError, "decode failed"):
                self.processor.normalize(
                    Path(directory) / "meeting.webm",
                    output,
                    max_duration_seconds=60,
                )
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
