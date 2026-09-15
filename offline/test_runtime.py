"""Focused local adapter checks; no model import or network is required.

Run: .offline/venv/bin/python -m unittest discover -s offline -p test_runtime.py
"""
import contextlib
import io
import json
import os
import socket
import unittest
from email.message import Message
from types import SimpleNamespace
from unittest.mock import Mock, patch

import runtime

runtime.configure()
runtime.deny_outbound()
import server


class RuntimeTests(unittest.TestCase):
    def test_markup_and_all_numbered_placeholders_never_reach_inference(self):
        source = 'Read <i1 title="a > b">the article</i1> with {1}, {{2}}, [3], and [[4]].'
        with patch.object(runtime, "_translate_plain", side_effect=lambda text, *_: text) as infer:
            output, language = runtime.translate(source, "en", "zh")
        self.assertEqual(output, source)
        self.assertEqual(language, "en")
        self.assertEqual(
            [call.args[0] for call in infer.call_args_list],
            ["Read", "the article", "with", ", and"],
        )

    def test_punctuation_only_fragments_do_not_trigger_model_hallucinations(self):
        with patch.object(runtime, "_translate_plain", return_value="An article") as infer:
            output, _ = runtime.translate("<i1>一篇文章</i1>。 {1} 2026!", "zh", "en")
        infer.assert_called_once_with("一篇文章", "zh", "en")
        self.assertEqual(output, "<i1>An article</i1>。 {1} 2026!")

    def test_chinese_to_english_words_do_not_join_across_inline_markup(self):
        words = {"学习": "Learning", "新词": "new words", "很有用。": "is useful."}
        with patch.object(runtime, "_translate_plain", side_effect=lambda text, *_: words[text]):
            output, _ = runtime.translate("学习<i1>新词</i1>很有用。", "zh", "en")
        self.assertEqual(output, "Learning<i1> new words</i1> is useful.")

    def test_placeholders_keep_word_boundaries_in_english(self):
        words = {"使用": "Use", "显示时间。": "to display the time."}
        with patch.object(runtime, "_translate_plain", side_effect=lambda text, *_: words[text]):
            output, _ = runtime.translate("使用{1}显示时间。", "zh", "en")
        self.assertEqual(output, "Use {1} to display the time.")

    def test_existing_whitespace_is_preserved_around_inline_text(self):
        source = "\t Read <i1> a word </i1> today. \n"
        words = {"Read": "读", "a word": "一个词", "today.": "今天。"}
        with patch.object(runtime, "_translate_plain", side_effect=lambda text, *_: words[text]):
            output, _ = runtime.translate(source, "en", "zh")
        self.assertEqual(output, "\t 读 <i1> 一个词 </i1> 今天。 \n")

    def test_entities_are_decoded_for_inference_and_model_markup_is_escaped(self):
        with patch.object(runtime, "_translate_plain", return_value="甲 < 乙 & 丙") as infer:
            output, _ = runtime.translate("<i1>A &amp; B</i1>", "en", "zh")
        infer.assert_called_once_with("A & B", "en", "zh")
        self.assertEqual(output, "<i1>甲 &lt; 乙 &amp; 丙</i1>")

    def test_same_language_does_not_load_a_model_or_change_markup(self):
        source = '<i1 title="中文">English text</i1> {1}'
        with patch.object(runtime, "_translate_plain") as infer:
            output, language = runtime.translate(source, "auto", "en")
        self.assertEqual((output, language), (source, "en"))
        infer.assert_not_called()

    def test_inherited_debug_logging_is_disabled(self):
        with patch.dict(os.environ, {"ARGOS_DEBUG": "1"}):
            runtime.configure()
            self.assertEqual(os.environ["ARGOS_DEBUG"], "0")

    def test_outgoing_socket_is_rejected_before_connecting(self):
        with socket.socket() as connection:
            with self.assertRaisesRegex(RuntimeError, "禁止所有出站连接"):
                connection.connect(("1.1.1.1", 443))


class ServerInputTests(unittest.TestCase):
    @staticmethod
    def handler(payload):
        raw = json.dumps(payload).encode()
        handler = server.Handler.__new__(server.Handler)
        handler.path = "/translate"
        handler.server = SimpleNamespace(pairing_token="t" * 43, server_address=("127.0.0.1", 8765))
        handler.connection = Mock()
        handler.headers = Message()
        handler.headers["Host"] = "127.0.0.1:8765"
        handler.headers["Authorization"] = "Bearer " + "t" * 43
        handler.headers["Content-Type"] = "application/json"
        handler.headers["Content-Length"] = str(len(raw))
        handler.rfile = io.BytesIO(raw)
        handler.respond = Mock()
        return handler

    def test_non_object_json_returns_400_without_loading_the_model(self):
        for payload in ([], None, "hello", 4, True):
            with self.subTest(payload=payload), patch.object(server, "translate") as infer:
                handler = self.handler(payload)
                handler.do_POST()
                self.assertEqual(handler.respond.call_args.args[0], 400)
                infer.assert_not_called()

    def test_unexpected_dependency_error_logs_only_the_exception_type(self):
        handler = self.handler({"text": "Self-authored sample", "from": "en", "to": "zh"})
        output = io.StringIO()
        with patch.object(server, "translate", side_effect=RuntimeError("private source text")), \
                contextlib.redirect_stdout(output):
            handler.do_POST()
        self.assertEqual(output.getvalue(), "Translation failed: RuntimeError\n")
        self.assertEqual(handler.respond.call_args.args[0], 503)
        self.assertNotIn("private source text", str(handler.respond.call_args))


if __name__ == "__main__":
    unittest.main()
