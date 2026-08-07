from __future__ import annotations

import unittest

from app.contracts import ModelMetadata
from app.normalizer import normalize_result, parse_hotwords


def metadata() -> ModelMetadata:
    return ModelMetadata(
        service_version="test",
        asr_model="paraformer-zh",
        vad_model="fsmn-vad",
        punctuation_model="ct-punc",
        speaker_model="cam++",
        model_revision="test-revision",
        device="cpu",
        timestamp_source="model",
        speaker_scope="none",
    )


class NormalizeResultTest(unittest.TestCase):
    def test_maps_native_tokens_and_sentences(self) -> None:
        result = normalize_result(
            {
                "text": "交易停滞。",
                "raw_text": "交 易 停 滞",
                "timestamp": [[100, 200], [200, 300], [500, 600], [600, 700]],
                "sentence_info": [
                    {
                        "text": "交易停滞。",
                        "raw_text": "交 易 停 滞",
                        "start": 100,
                        "end": 700,
                        "timestamp": [[100, 200], [200, 300], [500, 600], [600, 700]],
                        "spk": 1,
                    }
                ],
            },
            duration=1.0,
            language="zh",
            processing_time=0.1,
            model_metadata=metadata(),
        )

        self.assertEqual(result.alignment.status, "aligned")
        self.assertEqual([token.text for token in result.tokens], ["交", "易", "停", "滞"])
        self.assertEqual(result.tokens[0].start_ms, 100)
        self.assertEqual(result.tokens[-1].end_ms, 700)
        self.assertEqual(result.segments[0].speaker, "speaker_1")
        self.assertEqual(result.segments[0].speaker_id, 1)
        self.assertEqual(
            [token.text for token in result.segments[0].tokens],
            ["交", "易", "停", "滞"],
        )
        self.assertEqual(result.model.speaker_scope, "recording")

    def test_assigns_global_tokens_when_sentence_raw_text_has_no_spaces(self) -> None:
        result = normalize_result(
            {
                "text": "甚至出现交易。",
                "raw_text": "甚 至 出 现 交 易",
                "timestamp": [
                    [480, 720],
                    [720, 960],
                    [960, 1_200],
                    [1_200, 1_440],
                    [1_440, 1_680],
                    [1_680, 1_920],
                ],
                "sentence_info": [
                    {
                        "text": "甚至出现交易。",
                        "raw_text": "甚至出现交易",
                        "start": 480,
                        "end": 1_920,
                        "timestamp": [
                            [480, 720],
                            [720, 960],
                            [960, 1_200],
                            [1_200, 1_440],
                            [1_440, 1_680],
                            [1_680, 1_920],
                        ],
                    }
                ],
            },
            duration=2.0,
            language="zh",
            processing_time=0.2,
            model_metadata=metadata(),
        )

        self.assertEqual(
            [token.text for token in result.segments[0].tokens],
            ["甚", "至", "出", "现", "交", "易"],
        )
        self.assertNotIn(
            "sentence_token_timestamp_mismatch_at_index:0",
            result.warnings,
        )

    def test_does_not_force_token_into_inexact_sentence_range(self) -> None:
        result = normalize_result(
            {
                "text": "Next.js works.",
                "raw_text": "Next.js works",
                "timestamp": [[100, 400], [400, 700]],
                "sentence_info": [
                    {
                        "text": "Next.js works.",
                        "start": 150,
                        "end": 700,
                    }
                ],
            },
            duration=1.0,
            language="zh",
            processing_time=0.1,
            model_metadata=metadata(),
        )

        self.assertEqual(
            [token.text for token in result.segments[0].tokens],
            ["works"],
        )
        self.assertIn("model_tokens_outside_sentence_ranges", result.warnings)

    def test_mismatch_never_fabricates_tokens(self) -> None:
        result = normalize_result(
            {
                "text": "测试文本。",
                "raw_text": "测 试 文 本",
                "timestamp": [[100, 200], [200, 300]],
                "sentence_info": [
                    {"text": "测试文本。", "start": 100, "end": 300}
                ],
            },
            duration=1.0,
            language="zh",
            processing_time=0.1,
            model_metadata=metadata(),
        )

        self.assertEqual(result.alignment.status, "mismatch")
        self.assertEqual(result.tokens, [])
        self.assertTrue(any("mismatch" in warning for warning in result.warnings))

    def test_rejects_timestamps_outside_audio_duration(self) -> None:
        result = normalize_result(
            {
                "text": "测试。",
                "raw_text": "测 试",
                "timestamp": [[100, 200], [200, 1_100]],
                "sentence_info": [
                    {"text": "测试。", "start": 100, "end": 1_100}
                ],
            },
            duration=1.0,
            language="zh",
            processing_time=0.1,
            model_metadata=metadata(),
        )

        self.assertEqual(result.tokens, [])
        self.assertEqual(result.segments, [])
        self.assertEqual(result.alignment.status, "mismatch")
        self.assertIn("invalid_model_timestamp_bounds_at_index:1", result.warnings)
        self.assertIn("invalid_sentence_time_at_index:0", result.warnings)

    def test_uses_model_timestamp_for_single_fallback_segment(self) -> None:
        result = normalize_result(
            {
                "text": "交易。",
                "raw_text": "交 易",
                "timestamp": [[480, 720], [720, 960]],
            },
            duration=2.0,
            language="zh",
            processing_time=0.2,
            model_metadata=metadata(),
        )

        self.assertEqual(len(result.segments), 1)
        self.assertEqual(result.segments[0].start_ms, 480)
        self.assertEqual(result.segments[0].end_ms, 960)
        self.assertNotEqual(result.segments[0].end_ms, 2_000)


class ParseHotwordsTest(unittest.TestCase):
    def test_accepts_json_and_deduplicates(self) -> None:
        self.assertEqual(
            parse_hotwords(
                '["Next.js", "Supabase", "next.js"]',
                max_items=10,
                max_chars=100,
            ),
            ["Next.js", "Supabase"],
        )

    def test_accepts_comma_separated_values(self) -> None:
        self.assertEqual(
            parse_hotwords(
                "功能估算, 项目报告，权限管理",
                max_items=10,
                max_chars=100,
            ),
            ["功能估算", "项目报告", "权限管理"],
        )

    def test_rejects_paths_and_urls(self) -> None:
        for value in ("https://example.com/words.txt", "/tmp/words.txt"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_hotwords(value, max_items=10, max_chars=100)


if __name__ == "__main__":
    unittest.main()
