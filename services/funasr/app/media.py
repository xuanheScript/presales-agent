from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


class MediaProcessingError(RuntimeError):
    pass


class MediaDurationError(MediaProcessingError):
    pass


@dataclass(frozen=True)
class NormalizedAudio:
    path: Path
    duration: float


class FFmpegMediaProcessor:
    def __init__(
        self,
        *,
        ffmpeg_path: str = "ffmpeg",
        ffprobe_path: str = "ffprobe",
        sample_rate: int = 16_000,
    ) -> None:
        self.ffmpeg_path = ffmpeg_path
        self.ffprobe_path = ffprobe_path
        self.sample_rate = sample_rate

    def normalize(
        self,
        source_path: Path,
        output_path: Path,
        *,
        max_duration_seconds: int,
    ) -> NormalizedAudio:
        self._require_executable(self.ffmpeg_path)
        self._require_executable(self.ffprobe_path)

        duration = self._probe_duration(source_path)
        if duration > max_duration_seconds:
            raise MediaDurationError(
                f"audio duration exceeds {max_duration_seconds} seconds"
            )
        command = [
            self.ffmpeg_path,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-y",
            "-i",
            str(source_path),
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(self.sample_rate),
            "-c:a",
            "pcm_s16le",
            str(output_path),
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                check=False,
                text=True,
                timeout=max(60, round(duration * 2)),
            )
        except subprocess.TimeoutExpired as error:
            output_path.unlink(missing_ok=True)
            raise MediaProcessingError("FFmpeg normalization timed out") from error

        if completed.returncode != 0 or not output_path.is_file():
            output_path.unlink(missing_ok=True)
            detail = completed.stderr.strip().splitlines()
            message = detail[-1] if detail else "unknown FFmpeg error"
            raise MediaProcessingError(f"FFmpeg normalization failed: {message}")
        return NormalizedAudio(path=output_path, duration=duration)

    def _probe_duration(self, source_path: Path) -> float:
        command = [
            self.ffprobe_path,
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-protocol_whitelist",
            "file,pipe",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(source_path),
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                check=False,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired as error:
            raise MediaProcessingError("ffprobe timed out") from error

        if completed.returncode != 0:
            raise MediaProcessingError("audio duration could not be read")
        try:
            duration = float(completed.stdout.strip())
        except ValueError as error:
            raise MediaProcessingError("ffprobe returned an invalid duration") from error
        if duration <= 0:
            raise MediaProcessingError("audio is empty")
        return duration

    @staticmethod
    def _require_executable(executable: str) -> None:
        if shutil.which(executable) is None:
            raise MediaProcessingError(f"required executable is unavailable: {executable}")
