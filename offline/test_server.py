"""HTTP boundary tests with synthetic inputs; no sockets or model are loaded."""
import contextlib
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from email.message import Message
from types import SimpleNamespace
from unittest.mock import Mock, patch

import server

TOKEN = "t" * 43


def handler(payload=None, *, auth=True, host="127.0.0.1:8765", origin=None):
    raw = json.dumps({"text": "Synthetic sample", "from": "en", "to": "zh-CN"}
                     if payload is None else payload).encode()
    request = server.Handler.__new__(server.Handler)
    request.path = "/translate"
    request.server = SimpleNamespace(pairing_token=TOKEN, server_address=("127.0.0.1", 8765))
    request.headers = Message()
    if host is not None:
        request.headers["Host"] = host
    if auth:
        request.headers["Authorization"] = "Bearer " + TOKEN
    if origin is not None:
        request.headers["Origin"] = origin
    request.headers["Content-Type"] = "application/json"
    request.headers["Content-Length"] = str(len(raw))
    request.rfile = io.BytesIO(raw)
    request.connection = Mock()
    request.respond = Mock()
    return request


class PairingTests(unittest.TestCase):
    def test_startup_only_displays_synthetic_token_in_interactive_terminal(self):
        for interactive in (False, True):
            output = io.StringIO()
            output.isatty = lambda: interactive
            local = Mock()
            local.serve_forever.side_effect = KeyboardInterrupt
            with patch.object(server, "load_pairing_token", return_value=TOKEN), \
                    patch.object(server, "configure"), patch.object(server, "deny_outbound"), \
                    patch.object(server, "LocalHTTPServer", return_value=local), \
                    contextlib.redirect_stdout(output):
                server.main()
            self.assertEqual(TOKEN in output.getvalue(), interactive)
            if not interactive:
                self.assertIn(".offline/pairing-token", output.getvalue())
            local.server_close.assert_called_once()

    def test_token_is_random_persistent_private_and_not_printed(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()) as output:
            path = Path(directory) / "pairing-token"
            token = server.load_pairing_token(path)
            self.assertRegex(token, r"^[A-Za-z0-9_-]{43}$")
            self.assertEqual(server.load_pairing_token(path), token)
            self.assertNotEqual(server.load_pairing_token(Path(directory) / "second"), token)
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(output.getvalue(), "")

    def test_symlink_and_invalid_file_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "target"
            target.write_text("invalid", encoding="ascii")
            with self.assertRaises(ValueError):
                server.load_pairing_token(target)
            link = Path(directory) / "link"
            try:
                link.symlink_to(target)
            except (OSError, NotImplementedError):
                return
            with self.assertRaises(ValueError):
                server.load_pairing_token(link)
            self.assertEqual(target.read_text(), "invalid")

    def test_oversized_token_file_is_not_partially_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pairing-token"
            path.write_text(TOKEN + " " * 200, encoding="ascii")
            with self.assertRaises(ValueError):
                server.load_pairing_token(path)

    @unittest.skipUnless(os.name == "posix", "POSIX file modes")
    def test_existing_file_permissions_are_tightened(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pairing-token"
            server.load_pairing_token(path)
            path.chmod(0o644)
            server.load_pairing_token(path)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)


class RequestTests(unittest.TestCase):
    def test_all_translation_requests_require_token_before_body_read(self):
        for origin in (None, "http://127.0.0.1:4318", "chrome-extension://" + "a" * 32):
            with self.subTest(origin=origin), patch.object(server, "translate") as infer:
                request = handler(auth=False, origin=origin)
                request.read_body = Mock(side_effect=AssertionError("must not read body"))
                request.do_POST()
                self.assertEqual(request.respond.call_args.args[0], 401)
                request.read_body.assert_not_called()
                infer.assert_not_called()

    def test_wrong_duplicate_and_non_ascii_auth_are_rejected(self):
        for value in ("Bearer wrong", "Bearer " + TOKEN + " ", "Bearer 中文", "Basic " + TOKEN):
            request = handler(auth=False)
            request.headers["Authorization"] = value
            request.do_POST()
            self.assertEqual(request.respond.call_args.args[0], 401)
        request = handler()
        request.headers["Authorization"] = "Bearer " + TOKEN
        request.do_POST()
        self.assertEqual(request.respond.call_args.args[0], 401)

    def test_strict_host_blocks_dns_rebinding(self):
        for host in (None, "evil.test:8765", "127.0.0.1.evil.test:8765", "127.1:8765", "2130706433:8765", "127.0.0.1", "127.0.0.1:80"):
            request = handler(host=host)
            request.do_POST()
            self.assertEqual(request.respond.call_args.args[0], 403)
        request = handler()
        request.headers["Host"] = "localhost:8765"
        request.do_POST()
        self.assertEqual(request.respond.call_args.args[0], 403)

    def test_untrusted_origins_are_rejected_even_with_token(self):
        for origin in ("null", "https://evil.test", "http://localhost:4319", "http://localhost:4318/", "chrome-extension://not-an-id"):
            request = handler(origin=origin)
            request.do_POST()
            self.assertEqual(request.respond.call_args.args[0], 403)
        request = handler(origin="http://localhost:4318")
        request.headers["Origin"] = "https://evil.test"
        request.do_POST()
        self.assertEqual(request.respond.call_args.args[0], 403)

    def test_authorized_single_and_batch_preserve_custom_protocol(self):
        for payload, expected in (({"text": "Sample"}, {"text": "示例", "src": "en"}),
                                  ({"texts": ["Sample", "Sample"]}, [{"text": "示例", "src": "en"}] * 2)):
            with patch.object(server, "translate", return_value=("示例", "en")):
                request = handler(payload, host="localhost:8765", origin="chrome-extension://" + "a" * 32)
                request.do_POST()
                request.respond.assert_called_once_with(200, expected)

    def test_health_discloses_only_basic_status_without_token(self):
        with patch.object(server, "translate") as infer:
            request = handler(auth=False)
            request.path = "/health"
            request.do_GET()
            request.respond.assert_called_once_with(200, {"status": "ok"})
            infer.assert_not_called()

    def test_preflight_allows_auth_header_without_auth_but_checks_host_origin(self):
        request = handler(auth=False, origin="http://localhost:4318")
        request.do_OPTIONS()
        request.respond.assert_called_once_with(200, {})
        request = handler(auth=False, host="evil.test:8765")
        request.do_OPTIONS()
        self.assertEqual(request.respond.call_args.args[0], 403)

    def test_response_never_exposes_token_or_unsafe_cors(self):
        for origin, status in (("http://localhost:4318", 200), ("https://evil.test", 403)):
            request = handler(origin=origin)
            request.send_response = Mock()
            request.send_header = Mock()
            request.end_headers = Mock()
            request.wfile = io.BytesIO()
            server.Handler.respond(request, status, {"status": "ok"})
            headers = dict(call.args for call in request.send_header.call_args_list)
            self.assertEqual(headers.get("Access-Control-Allow-Origin"), origin if status == 200 else None)
            self.assertNotIn(TOKEN, str(headers) + request.wfile.getvalue().decode())

    def test_body_length_encoding_and_parsing_limits(self):
        for length, expected in (("0", 413), ("80001", 413), ("-1", 400), ("many", 400)):
            request = handler()
            request.headers.replace_header("Content-Length", length)
            request.do_POST()
            self.assertEqual(request.respond.call_args.args[0], expected)
        request = handler()
        request.headers["Content-Length"] = "5"
        request.do_POST()
        self.assertEqual(request.respond.call_args.args[0], 400)
        request = handler()
        request.headers["Transfer-Encoding"] = "chunked"
        request.do_POST()
        self.assertEqual(request.respond.call_args.args[0], 400)
        request = handler()
        request.headers.replace_header("Content-Type", "text/plain")
        request.do_POST()
        self.assertEqual(request.respond.call_args.args[0], 415)
        for payload in ([], "string", False, {"text": ""}, {"text": "x" * 6001}, {"texts": ["x"] * 9}):
            request = handler(payload)
            request.do_POST()
            self.assertEqual(request.respond.call_args.args[0], 400)

    def test_slow_body_has_absolute_deadline_and_incomplete_body_is_rejected(self):
        request = handler()
        request.rfile = Mock()
        request.rfile.read1.return_value = b"a"
        with patch.object(server.time, "monotonic", side_effect=[0, 1, 6]):
            with self.assertRaises(TimeoutError):
                request.read_body(3)
        request.connection.settimeout.assert_called_once_with(4)
        request = handler()
        request.read_body = Mock(side_effect=TimeoutError)
        request.do_POST()
        self.assertEqual(request.respond.call_args.args[0], 408)
        request = handler()
        request.rfile = io.BytesIO(b"")
        request.do_POST()
        self.assertEqual(request.respond.call_args.args[0], 400)

    def test_single_model_concurrency_and_lock_release_on_failure(self):
        request = handler()
        server.lock.acquire()
        try:
            with patch.object(server, "translate") as infer:
                request.do_POST()
                self.assertEqual(request.respond.call_args.args[0], 429)
                infer.assert_not_called()
        finally:
            server.lock.release()
        request = handler()
        with patch.object(server, "translate", side_effect=RuntimeError("Synthetic private text")), contextlib.redirect_stdout(io.StringIO()) as output:
            request.do_POST()
        self.assertEqual(output.getvalue(), "Translation failed: RuntimeError\n")
        self.assertFalse(server.lock.locked())
        self.assertEqual(request.respond.call_args.args[0], 503)
        self.assertNotIn("Synthetic private text", str(request.respond.call_args))


class ConnectionLimitTests(unittest.TestCase):
    def test_saturated_pool_refuses_without_spawning_thread(self):
        local = server.LocalHTTPServer.__new__(server.LocalHTTPServer)
        local.connection_slots = threading.BoundedSemaphore(1)
        local.connection_slots.acquire()
        local.shutdown_request = Mock()
        request = Mock()
        with patch.object(server.ThreadingHTTPServer, "process_request") as spawn:
            local.process_request(request, ("127.0.0.1", 10000))
        spawn.assert_not_called()
        self.assertIn(b"503", request.sendall.call_args.args[0])
        local.shutdown_request.assert_called_once_with(request)

    def test_connection_slot_is_returned_after_worker_or_thread_start_failure(self):
        local = server.LocalHTTPServer.__new__(server.LocalHTTPServer)
        local.connection_slots = threading.BoundedSemaphore(1)
        local.connection_slots.acquire()
        with patch.object(server.ThreadingHTTPServer, "process_request_thread"):
            local.process_request_thread(Mock(), ("127.0.0.1", 10000))
        self.assertTrue(local.connection_slots.acquire(blocking=False))
        local.connection_slots.release()
        with patch.object(server.ThreadingHTTPServer, "process_request", side_effect=RuntimeError):
            with self.assertRaises(RuntimeError):
                local.process_request(Mock(), ("127.0.0.1", 10000))
        self.assertTrue(local.connection_slots.acquire(blocking=False))


if __name__ == "__main__":
    unittest.main()
