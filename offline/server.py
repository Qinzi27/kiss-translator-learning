"""Local-only HTTP adapter for KISS Translator's existing Custom provider."""
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from runtime import configure, deny_outbound, translate

configure()
deny_outbound()
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def allowed_origin(self):
        origin = self.headers.get("Origin", "")
        return not origin or origin in ("http://127.0.0.1:4318", "http://localhost:4318") or bool(
            re.fullmatch(r"(?:chrome|moz)-extension://[a-zA-Z0-9-]+", origin))

    def respond(self, status, data):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        if self.allowed_origin() and self.headers.get("Origin"):
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.respond(200 if self.allowed_origin() else 403, {})

    def do_GET(self):
        if self.path != "/health":
            return self.respond(404, {"error": "Not found"})
        self.respond(200, {"engine": "Argos Translate", "outboundConnections": "blocked",
                           "languages": ["en", "zh"], "models": "prepared separately"})

    def do_POST(self):
        if self.path != "/translate":
            return self.respond(404, {"error": "Not found"})
        if not self.allowed_origin():
            return self.respond(403, {"error": "Origin is not allowed"})
        if self.headers.get_content_type() != "application/json":
            return self.respond(415, {"error": "application/json required"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 80000:
                raise ValueError("请求过长或为空。")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("请求正文必须是 JSON 对象。")
            texts = data.get("texts", [data.get("text")])
            if not isinstance(texts, list) or not 1 <= len(texts) <= 8 or any(
                not isinstance(text, str) or not text.strip() or len(text) > 6000 for text in texts
            ):
                raise ValueError("每次支持 1–8 段非空文本，每段不超过 6000 字符。")
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
        except (ValueError, TypeError, KeyError) as error:
            self.respond(400, {"error": str(error)})
        except Exception as error:
            # No source text or request headers are logged.
            print(f"Translation failed: {type(error).__name__}", flush=True)
            self.respond(503, {"error": "本机翻译失败，请确认已运行 prepare.py 完成模型准备。"})


if __name__ == "__main__":
    print("Argos offline service: http://127.0.0.1:8765 (outgoing connections blocked)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
