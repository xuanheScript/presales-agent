from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from .contracts import (
    AlignmentMetadata,
    ModelMetadata,
    TokenTimestamp,
    TranscriptSegment,
    TranscriptionResponse,
)

_PUNCTUATION = "，。！？；：、,.!?;:"


def normalize_result(
    native_result: dict[str, Any],
    *,
    duration: float,
    language: str,
    processing_time: float,
    model_metadata: ModelMetadata,
) -> TranscriptionResponse:
    warnings: list[str] = []
    max_timestamp_ms = round(duration * 1_000)
    timestamps = _valid_timestamps(
        native_result.get("timestamp"),
        warnings,
        max_timestamp_ms=max_timestamp_ms,
    )
    raw_text = _optional_text(native_result.get("raw_text"))
    source_tokens = _source_tokens(native_result, raw_text)
    tokens, alignment = _align_tokens(source_tokens, timestamps)

    if alignment.status == "mismatch":
        warnings.append(
            "model_token_timestamp_mismatch: token timestamps were omitted rather than estimated"
        )
    elif alignment.status == "unavailable":
        warnings.append("model_timestamps_unavailable")

    segments = _normalize_segments(
        native_result.get("sentence_info"),
        warnings,
        max_timestamp_ms=max_timestamp_ms,
    )
    if segments and tokens:
        _assign_segment_tokens(segments, tokens, warnings)
    if not segments and tokens:
        segments = [
            TranscriptSegment(
                id=0,
                start_ms=tokens[0].start_ms,
                end_ms=tokens[-1].end_ms,
                text=_required_text(native_result.get("text")),
                tokens=tokens,
            )
        ]
        warnings.append("sentence_info_unavailable: emitted one model-timestamp segment")
    elif not segments and native_result.get("text"):
        warnings.append("sentence_info_unavailable: no segment timestamps were emitted")

    if any(segment.speaker is not None for segment in segments):
        model_metadata.speaker_scope = "recording"
    else:
        model_metadata.speaker_scope = "none"

    rtf = processing_time / duration if duration > 0 else 0.0
    return TranscriptionResponse(
        language=language,
        duration=duration,
        text=_required_text(native_result.get("text")),
        raw_text=raw_text,
        tokens=tokens,
        segments=segments,
        alignment=alignment,
        model=model_metadata,
        processing_time=round(processing_time, 3),
        rtf=round(rtf, 4),
        warnings=warnings,
    )


def _source_tokens(result: dict[str, Any], raw_text: str | None) -> list[str]:
    if raw_text:
        return raw_text.split()
    words = result.get("words")
    if isinstance(words, list) and all(isinstance(word, str) and word.strip() for word in words):
        return [word.strip() for word in words]
    return []


def _valid_timestamps(
    value: Any,
    warnings: list[str],
    *,
    max_timestamp_ms: int | None = None,
) -> list[tuple[int, int]]:
    if not isinstance(value, list):
        return []

    timestamps: list[tuple[int, int]] = []
    previous_start = -1
    for index, item in enumerate(value):
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            warnings.append(f"invalid_model_timestamp_at_index:{index}")
            return []
        try:
            start = int(item[0])
            end = int(item[1])
        except (TypeError, ValueError):
            warnings.append(f"invalid_model_timestamp_at_index:{index}")
            return []
        if (
            start < 0
            or end < start
            or start < previous_start
            or (max_timestamp_ms is not None and end > max_timestamp_ms)
        ):
            warnings.append(f"invalid_model_timestamp_bounds_at_index:{index}")
            return []
        timestamps.append((start, end))
        previous_start = start
    return timestamps


def _align_tokens(
    source_tokens: Sequence[str], timestamps: Sequence[tuple[int, int]]
) -> tuple[list[TokenTimestamp], AlignmentMetadata]:
    if not source_tokens and not timestamps:
        return [], AlignmentMetadata(status="unavailable", token_count=0, timestamp_count=0)
    if len(source_tokens) != len(timestamps):
        return [], AlignmentMetadata(
            status="mismatch",
            token_count=len(source_tokens),
            timestamp_count=len(timestamps),
        )

    tokens = [
        TokenTimestamp(text=text, start_ms=start, end_ms=end)
        for text, (start, end) in zip(source_tokens, timestamps, strict=True)
    ]
    return tokens, AlignmentMetadata(
        status="aligned",
        token_count=len(source_tokens),
        timestamp_count=len(timestamps),
    )


def _normalize_segments(
    value: Any,
    warnings: list[str],
    *,
    max_timestamp_ms: int,
) -> list[TranscriptSegment]:
    if not isinstance(value, list):
        return []

    segments: list[TranscriptSegment] = []
    previous_start = -1
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            warnings.append(f"invalid_sentence_info_at_index:{index}")
            continue
        try:
            start = int(item["start"])
            end = int(item["end"])
        except (KeyError, TypeError, ValueError):
            warnings.append(f"invalid_sentence_time_at_index:{index}")
            continue
        if (
            start < 0
            or end < start
            or start < previous_start
            or end > max_timestamp_ms
        ):
            warnings.append(f"invalid_sentence_time_at_index:{index}")
            continue

        text = _optional_text(item.get("text") or item.get("sentence"))
        if not text:
            warnings.append(f"empty_sentence_text_at_index:{index}")
            continue

        speaker_id = item.get("spk")
        speaker = f"speaker_{speaker_id}" if speaker_id is not None else None
        segments.append(
            TranscriptSegment(
                id=len(segments),
                start_ms=start,
                end_ms=end,
                text=text,
                speaker=speaker,
                speaker_id=speaker_id,
            )
        )
        previous_start = start
    return segments


def _assign_segment_tokens(
    segments: Sequence[TranscriptSegment],
    tokens: Sequence[TokenTimestamp],
    warnings: list[str],
) -> None:
    assigned_token_indexes: set[int] = set()
    for segment_index, segment in enumerate(segments):
        segment_token_indexes = [
            token_index
            for token_index, token in enumerate(tokens)
            if token.start_ms >= segment.start_ms and token.end_ms <= segment.end_ms
        ]
        segment.tokens = [tokens[token_index] for token_index in segment_token_indexes]
        assigned_token_indexes.update(segment_token_indexes)
        if not segment.tokens:
            warnings.append(f"segment_tokens_unavailable_at_index:{segment_index}")

    if len(assigned_token_indexes) != len(tokens):
        warnings.append("model_tokens_outside_sentence_ranges")


def parse_hotwords(
    hotwords: str | None,
    *,
    max_items: int,
    max_chars: int,
) -> list[str]:
    if not hotwords or not hotwords.strip():
        return []

    raw = hotwords.strip()
    if raw.startswith("["):
        import json

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ValueError("hotwords must be a JSON array or comma-separated string") from error
        if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
            raise ValueError("hotwords JSON value must be an array of strings")
        items = parsed
    else:
        items = re.split(r"[,，\n]", raw)

    normalized: list[str] = []
    seen: set[str] = set()
    for item in items:
        word = " ".join(item.strip().split())
        if not word:
            continue
        if any(ord(char) < 32 for char in word):
            raise ValueError("hotwords cannot contain control characters")
        if word.startswith(("http://", "https://", "file://")) or word.endswith(".txt"):
            raise ValueError("hotwords cannot reference files or URLs")
        key = word.casefold()
        if key not in seen:
            normalized.append(word)
            seen.add(key)

    if len(normalized) > max_items:
        raise ValueError(f"hotwords cannot contain more than {max_items} entries")
    joined = " ".join(normalized)
    if len(joined) > max_chars:
        raise ValueError(f"hotwords cannot exceed {max_chars} characters")
    return normalized


def _optional_text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _required_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""
