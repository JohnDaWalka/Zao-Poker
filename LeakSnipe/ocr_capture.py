"""
Live capture helpers for browser-based poker clients.
"""

from __future__ import annotations

import base64
import json
import os
import queue
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional

try:
    import win32gui

    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False

from PIL import ImageGrab


class ReplayWindowCapture:
    """Capture a Replay Poker PWA/browser window from the desktop."""

    TITLE_PATTERNS = ("replay poker", "casino.org")

    @classmethod
    def title_matches(cls, title: str) -> bool:
        lowered = (title or "").lower()
        return any(pattern in lowered for pattern in cls.TITLE_PATTERNS)

    @staticmethod
    def _rect_for_window(hwnd: int) -> Optional[tuple[int, int, int, int]]:
        try:
            left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        except Exception:
            return None
        width = right - left
        height = bottom - top
        if width <= 200 or height <= 150:
            return None
        return left, top, width, height

    @classmethod
    def _window_entry(cls, hwnd: int) -> Optional[Dict[str, Any]]:
        title = win32gui.GetWindowText(hwnd)
        rect = cls._rect_for_window(hwnd)
        if not rect:
            return None
        return {"hwnd": hwnd, "title": title, "rect": rect}

    @classmethod
    def list_windows(cls) -> List[Dict[str, Any]]:
        if not HAS_WIN32:
            return []
        found: List[Dict[str, Any]] = []

        def _cb(hwnd: int, _param: Any) -> None:
            if not win32gui.IsWindowVisible(hwnd):
                return
            title = win32gui.GetWindowText(hwnd)
            if not cls.title_matches(title):
                return
            entry = cls._window_entry(hwnd)
            if entry:
                found.append(entry)

        win32gui.EnumWindows(_cb, None)
        return found

    @classmethod
    def find_window(cls, allow_foreground_fallback: bool = False) -> Optional[Dict[str, Any]]:
        if not HAS_WIN32:
            return None
        try:
            foreground = win32gui.GetForegroundWindow()
        except Exception:
            foreground = None

        if foreground:
            entry = cls._window_entry(foreground)
            if entry and (cls.title_matches(entry["title"]) or allow_foreground_fallback):
                return entry

        windows = cls.list_windows()
        if windows:
            return windows[0]
        return None

    @classmethod
    def capture_window(cls, allow_foreground_fallback: bool = False) -> Dict[str, Any]:
        entry = cls.find_window(allow_foreground_fallback=allow_foreground_fallback)
        if not entry:
            raise RuntimeError("No Replay Poker window found")

        left, top, width, height = entry["rect"]
        image = ImageGrab.grab(bbox=(left, top, left + width, top + height), all_screens=True)
        path = os.path.join(tempfile.gettempdir(), f"replay_capture_{int(time.time() * 1000)}.png")
        image.save(path, "PNG")
        entry["path"] = path
        return entry


class OCRCaptureBridge:
    """Localhost bridge for browser-side tools to submit OCR text or screenshots."""

    def __init__(self, host: str = "127.0.0.1", port: int = 16888):
        self.host = host
        self.port = port
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self._queue: "queue.Queue[Dict[str, Any]]" = queue.Queue()

    @property
    def running(self) -> bool:
        return self._server is not None

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    @property
    def capture_text_url(self) -> str:
        return f"{self.base_url}/capture/text"

    @property
    def capture_image_url(self) -> str:
        return f"{self.base_url}/capture/image"

    @property
    def health_url(self) -> str:
        return f"{self.base_url}/health"

    @staticmethod
    def _extract_base64_payload(value: str) -> str:
        payload = (value or "").strip()
        if "," in payload and payload.lower().startswith("data:"):
            payload = payload.split(",", 1)[1]
        return payload

    @classmethod
    def save_base64_image(cls, value: str, suffix: str = ".png") -> str:
        payload = cls._extract_base64_payload(value)
        if not payload:
            raise ValueError("Missing image_base64 payload")
        raw = base64.b64decode(payload)
        path = os.path.join(tempfile.gettempdir(), f"bridge_capture_{int(time.time() * 1000)}{suffix}")
        with open(path, "wb") as handle:
            handle.write(raw)
        return path

    def start(self) -> bool:
        if self._server is not None:
            return True

        server = None
        for candidate_port in (self.port, 0):
            try:
                server = ThreadingHTTPServer((self.host, candidate_port), self._build_handler())
                break
            except OSError:
                continue
        if server is None:
            return False

        self._server = server
        self.port = int(server.server_address[1])
        self._thread = threading.Thread(target=server.serve_forever, daemon=True)
        self._thread.start()
        return True

    def stop(self) -> None:
        if self._server is None:
            return
        self._server.shutdown()
        self._server.server_close()
        self._server = None

    def get_capture(self) -> Optional[Dict[str, Any]]:
        try:
            return self._queue.get_nowait()
        except queue.Empty:
            return None

    def _enqueue(self, payload: Dict[str, Any]) -> None:
        self._queue.put(payload)

    def _build_handler(self):
        bridge = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                return

            def _write_json(self, status: int, payload: Dict[str, Any]) -> None:
                encoded = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.end_headers()
                self.wfile.write(encoded)

            def do_OPTIONS(self) -> None:
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.end_headers()

            def do_GET(self) -> None:
                if self.path != "/health":
                    self._write_json(404, {"error": "not_found"})
                    return
                self._write_json(200, {"ok": True, "text_url": bridge.capture_text_url, "image_url": bridge.capture_image_url})

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw = self.rfile.read(length) if length else b""
                try:
                    payload = json.loads(raw.decode("utf-8") or "{}")
                except json.JSONDecodeError:
                    self._write_json(400, {"error": "invalid_json"})
                    return

                if self.path == "/capture/text":
                    text = str(payload.get("text", "") or "")
                    if not text.strip():
                        self._write_json(400, {"error": "missing_text"})
                        return
                    bridge._enqueue(
                        {
                            "type": "text",
                            "text": text,
                            "source": str(payload.get("source", "bridge-text")),
                            "site": str(payload.get("site", "ReplayPoker")),
                        }
                    )
                    self._write_json(200, {"ok": True})
                    return

                if self.path == "/capture/image":
                    image_base64 = str(payload.get("image_base64", "") or "")
                    if not image_base64:
                        self._write_json(400, {"error": "missing_image_base64"})
                        return
                    try:
                        image_path = bridge.save_base64_image(image_base64)
                    except Exception as exc:
                        self._write_json(400, {"error": str(exc)})
                        return
                    bridge._enqueue(
                        {
                            "type": "image",
                            "path": image_path,
                            "source": str(payload.get("source", "bridge-image")),
                            "site": str(payload.get("site", "ReplayPoker")),
                        }
                    )
                    self._write_json(200, {"ok": True, "path": image_path})
                    return

                self._write_json(404, {"error": "not_found"})

        return Handler
