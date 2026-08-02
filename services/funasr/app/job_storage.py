from __future__ import annotations

import hashlib
import os
import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

if os.name == "posix":
    import fcntl
else:
    fcntl = None  # type: ignore[assignment]


class StoredUploadTooLargeError(RuntimeError):
    pass


class EmptyUploadError(RuntimeError):
    pass


class DataDirectoryLockedError(RuntimeError):
    pass


@dataclass(frozen=True)
class StoredUpload:
    path: Path
    original_filename: str
    size_bytes: int
    sha256: str


class LocalJobStorage:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.uploads_dir = self.root / "uploads"
        self.scratch_dir = self.root / "scratch"
        self._lock_file: BinaryIO | None = None

    def initialize(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self._acquire_lock()
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.scratch_dir.mkdir(parents=True, exist_ok=True)
        self.cleanup_scratch()

    def close(self) -> None:
        if self._lock_file is None:
            return
        if fcntl is not None:
            fcntl.flock(self._lock_file.fileno(), fcntl.LOCK_UN)
        self._lock_file.close()
        self._lock_file = None

    def _acquire_lock(self) -> None:
        if self._lock_file is not None:
            return
        if fcntl is None:
            raise DataDirectoryLockedError(
                "FunASR data directory locking requires a POSIX platform"
            )
        lock_file = (self.root / ".funasr.lock").open("a+b")
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            lock_file.close()
            raise DataDirectoryLockedError(
                f"FunASR data directory is already in use: {self.root}"
            ) from error
        self._lock_file = lock_file

    def write_stream(
        self,
        stream: BinaryIO,
        *,
        filename: str | None,
        max_file_bytes: int,
    ) -> StoredUpload:
        upload_id = str(uuid.uuid4())
        directory = self.uploads_dir / upload_id
        directory.mkdir(parents=False, exist_ok=False)
        part_path = directory / "source.part"
        source_path = directory / "source"
        digest = hashlib.sha256()
        total = 0
        try:
            with part_path.open("xb") as output:
                while chunk := stream.read(1024 * 1024):
                    total += len(chunk)
                    if total > max_file_bytes:
                        raise StoredUploadTooLargeError(
                            f"audio exceeds {max_file_bytes} bytes"
                        )
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if total == 0:
                raise EmptyUploadError("audio is empty")
            os.replace(part_path, source_path)
            return StoredUpload(
                path=source_path,
                original_filename=_sanitize_filename(filename),
                size_bytes=total,
                sha256=digest.hexdigest(),
            )
        except Exception:
            shutil.rmtree(directory, ignore_errors=True)
            raise

    def normalized_path(self, job_id: str) -> Path:
        return self.scratch_dir / f"{job_id}-normalized.wav"

    def delete_source(self, source_path: Path) -> None:
        resolved = source_path.resolve()
        if not resolved.is_relative_to(self.uploads_dir):
            raise ValueError("source path is outside job storage")
        source_path.unlink(missing_ok=True)
        try:
            source_path.parent.rmdir()
        except OSError:
            pass

    def cleanup_orphans(self, referenced_paths: set[Path]) -> int:
        referenced = {path.resolve() for path in referenced_paths}
        removed = 0
        if not self.uploads_dir.exists():
            return removed
        for directory in self.uploads_dir.iterdir():
            if not directory.is_dir():
                directory.unlink(missing_ok=True)
                removed += 1
                continue
            source = (directory / "source").resolve()
            if source not in referenced:
                shutil.rmtree(directory, ignore_errors=True)
                removed += 1
                continue
            (directory / "source.part").unlink(missing_ok=True)
        return removed

    def cleanup_scratch(self) -> None:
        if not self.scratch_dir.exists():
            return
        for path in self.scratch_dir.iterdir():
            if path.is_file() or path.is_symlink():
                path.unlink(missing_ok=True)
            elif path.is_dir():
                shutil.rmtree(path, ignore_errors=True)


def _sanitize_filename(filename: str | None) -> str:
    name = Path(filename or "audio").name
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    return (name or "audio")[:255]
