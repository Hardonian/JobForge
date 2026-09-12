"""
Lightweight asyncio HTTP health server for Kubernetes / container orchestration.
Provides /healthz and /readyz endpoints.
"""

import asyncio
from typing import Callable, Optional

class HealthServer:
    def __init__(self, port: int = 8080, is_ready: Optional[Callable[[], bool]] = None):
        self.port = port
        self.is_ready = is_ready or (lambda: True)
        self._server = None

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            line = await reader.readline()
            request = line.decode().strip()
            parts = request.split()
            if len(parts) >= 2:
                path = parts[1]
            else:
                path = "/"

            if path == "/healthz":
                body = '{"status": "ok"}\n'
                response = f"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n{body}"
            elif path == "/readyz":
                if self.is_ready():
                    body = '{"status": "ready"}\n'
                    response = f"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n{body}"
                else:
                    body = '{"status": "not_ready"}\n'
                    response = f"HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n{body}"
            else:
                body = "Not Found\n"
                response = f"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: {len(body)}\r\n\r\n{body}"

            writer.write(response.encode())
            await writer.drain()
        except Exception:
            pass
        finally:
            writer.close()
            await writer.wait_closed()

    async def start(self):
        self._server = await asyncio.start_server(self._handle_client, "0.0.0.0", self.port)

    async def stop(self):
        if self._server:
            self._server.close()
            await self._server.wait_closed()
