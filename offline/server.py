"""Authenticated loopback HTTP adapter for KISS Translator's Custom provider."""
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from runtime import configure, deny_outbound, translate

TOKEN_PATH = Path(__file__).resolve().parents[1] / ".offline" / "pairing-token"
MAX_BODY_BYTES = 80000
BODY_READ_TIMEOUT = 5
MAX_CONNECTIONS = 8
lock = threading.Lock()


def load_pairing_token(path=TOKEN_PATH):
    """Create once; never follow a symlink or accept a shared/non-regular file."""
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags | os.O_CREAT | os.O_EXCL, 0o600)
        created = True
    except FileExistsError:
        if path.is_symlink():
            raise ValueError("Pairing token must not be a symbolic link")
        fd = os.open(path, flags)
        created = False
    with os.fdopen(fd, "r+", encoding="ascii") as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("Pairing token must be a regular private file")
        if not created and info.st_size > 44:
            raise ValueError("Invalid pairing token file size")
        if os.name == "posix":
            if info.st_uid != os.getuid():
                raise ValueError("Pairing token must belong to the current user")
            os.fchmod(file.fileno(), 0o600)
        if created:
            token = secrets.token_urlsafe(32)
            file.write(token + "\n")
            file.flush()
        else:
            token = file.read(128).strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            raise ValueError("Invalid pairing token file; stop the service and regenerate it")
    return token


class LocalHTTPServer(ThreadingHTTPServer):
    """Bound both accepted connection workers and queued connections."""
    daemon_threads = True
    block_on_close = False
    request_queue_size = MAX_CONNECTIONS

    def __init__(self, address, pairing_token):
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", pairing_token):
            raise ValueError("A generated pairing token is required")
        self.pairing_token = pairing_token
        self.connection_slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
        super().__init__(address, Handler)

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(BODY_READ_TIMEOUT)
        return request, address

    def process_request(self, request, client_address):
        if not self.connection_slots.acquire(blocking=False):
            try:
                request.settimeout(0.2)
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.connection_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.connection_slots.release()

    def handle_error(self, request, client_address):
        # Never write a traceback, request text, URL, or Authorization to logs.
        print("Local HTTP request failed", file=sys.stderr, flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        # BaseHTTPRequestHandler normally logs paths and request lines.
        pass

    def allowed_origin(self):
        origins = self.headers.get_all("Origin", [])
        if len(origins) > 1:
            return False
        origin = origins[0] if origins else ""
        return not origin or origin in ("http://127.0.0.1:4318", "http://localhost:4318") or bool(
            re.fullmatch(r"chrome-extension://[a-p]{32}|moz-extension://[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", origin))

    def allowed_host(self):
        hosts = self.headers.get_all("Host", [])
        port = self.server.server_address[1]
        return len(hosts) == 1 and hosts[0] in (f"127.0.0.1:{port}", f"localhost:{port}")

    def authorize_context(self):
        if not self.allowed_host():
            self.respond(403, {"error": "Loopback Host required"})
            return False
        if not self.allowed_origin():
            self.respond(403, {"error": "Origin is not allowed"})
            return False
        return True

    def authenticated(self):
        values = self.headers.get_all("Authorization", [])
        return len(values) == 1 and hmac.compare_digest(
            values[0].encode("utf-8"), ("Bearer " + self.server.pairing_token).encode("ascii"))

    def respond(self, status, data):
        self.close_connection = True
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        if self.allowed_host() and self.allowed_origin() and self.headers.get("Origin"):
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (OSError, TimeoutError):
            pass

    def do_OPTIONS(self):
        if not self.authorize_context():
            return
        self.respond(200 if self.path in ("/translate", "/health") else 404, {})

    def do_GET(self):
        if not self.authorize_context():
            return
        if self.path != "/health":
            return self.respond(404, {"error": "Not found"})
        self.respond(200, {"status": "ok"})

    def read_body(self, length):
        deadline = time.monotonic() + BODY_READ_TIMEOUT
        chunks = []
        remaining = length
        while remaining:
            timeout = deadline - time.monotonic()
            if timeout <= 0:
                raise TimeoutError("Body deadline exceeded")
            self.connection.settimeout(timeout)
            chunk = self.rfile.read1(min(remaining, 8192))
            if not chunk:
                raise ValueError("Incomplete body")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def do_POST(self):
        if not self.authorize_context():
            return
        if self.path != "/translate":
            return self.respond(404, {"error": "Not found"})
        if not self.authenticated():
            return self.respond(401, {"error": "Pairing token required; copy the local token into the Argos service Key"})
        if self.headers.get_content_type() != "application/json":
            return self.respond(415, {"error": "application/json required"})
        if self.headers.get("Transfer-Encoding"):
            return self.respond(400, {"error": "Transfer-Encoding is not supported"})
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,8}", lengths[0]):
            return self.respond(400, {"error": "One valid Content-Length is required"})
        length = int(lengths[0])
        if not 0 < length <= MAX_BODY_BYTES:
            return self.respond(413, {"error": "请求过长或为空。"})
        try:
            data = json.loads(self.read_body(length))
            if not isinstance(data, dict):
                raise ValueError("Invalid object")
            texts = data.get("texts", [data.get("text")])
            if not isinstance(texts, list) or not 1 <= len(texts) <= 8 or any(
                not isinstance(text, str) or not text.strip() or len(text) > 6000 for text in texts
            ):
                return self.respond(400, {"error": "每次支持 1–8 段非空文本，每段不超过 6000 字符。"})
            if not lock.acquire(blocking=False):
                return self.respond(429, {"error": "本机模型正在翻译，请稍后重试。"})
            try:
                results = []
                for text in texts:
                    output, source = translate(text, data.get("from", "auto"), data.get("to", "zh-CN"))
                    results.append({"text": output, "src": "zh-CN" if source == "zh" else source})
            finally:
                lock.release()
            self.respond(200, results if "texts" in data else results[0])
        except (TimeoutError, socket.timeout):
            self.respond(408, {"error": "请求正文读取超时，请重新发送完整请求。"})
        except (ValueError, TypeError, KeyError):
            self.respond(400, {"error": "请求 JSON、正文或中英语言参数无效。"})
        except Exception as error:
            print(f"Translation failed: {type(error).__name__}", flush=True)
            self.respond(503, {"error": "本机翻译失败，请确认已运行 prepare.py 完成模型准备。"})


def main():
    token = load_pairing_token()
    configure()
    deny_outbound()
    server = LocalHTTPServer(("127.0.0.1", 8765), token)
    print("Argos offline service: http://127.0.0.1:8765 (outgoing connections blocked)", flush=True)
    if sys.stdout.isatty():
        print("Copy this local pairing token into the Argos service Key:", flush=True)
        print(token, flush=True)
    else:
        print("Pairing token saved in .offline/pairing-token; open that local file to configure the Argos Key.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
