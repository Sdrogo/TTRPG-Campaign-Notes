"""The request middleware of ticket 75: gives each request an id, times it,
counts it in the hourly statistics (app/domain/request_stats.py), writes one
JSON log line for it, and keeps a short record of every server error for the
Admin page.

A plain ASGI middleware rather than Starlette's `BaseHTTPMiddleware`, so the
live streams (spec 46_2, spec 52) pass through untouched. It sits inside
Starlette's error handler: an unhandled exception reaches it, is counted as a
500 and raised on, and Starlette answers as before."""

import logging
import secrets
import time
from collections.abc import Awaitable, Callable, MutableMapping
from datetime import UTC, datetime
from typing import Any

from app.domain import request_stats
from app.domain.request_stats import ErrorEvent, route_group
from app.logging_setup import request_id_var

logger = logging.getLogger("app.request")

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

REQUEST_ID_HEADER = b"x-request-id"
# Polled every 15 s by the container's healthcheck and every minute by the
# uptime monitors: counted, but not logged, or they would bury the rest.
_QUIET_GROUPS = frozenset({"health"})


def new_request_id() -> str:
    """A short random id, logged with every line of the request and sent
    back as `X-Request-ID`, so an error in the Admin page leads to its full
    log in Dozzle."""
    return secrets.token_hex(8)


class RequestMetricsMiddleware:
    """See the module docstring."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Wraps one HTTP request; anything else passes straight through."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = new_request_id()
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        # 0 until a response starts: a request the client abandoned before
        # that is neither counted nor stored as an error.
        status = 0

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = int(message["status"])
                headers = list(message.get("headers", []))
                headers.append((REQUEST_ID_HEADER, request_id.encode()))
                message["headers"] = headers
            await send(message)

        exc_type: str | None = None
        try:
            await self.app(scope, receive, send_with_id)
        except Exception as exc:
            status = 500
            exc_type = type(exc).__name__
            # Logged here so the traceback carries the request id. The 500
            # itself is sent by Starlette's outer error handler, without the
            # `X-Request-ID` header: the log line and the error event have it.
            logger.exception("Unhandled error")
            raise
        finally:
            self._finish(scope, request_id, started, status, exc_type)
            request_id_var.reset(token)

    def _finish(
        self, scope: Scope, request_id: str, started: float, status: int, exc_type: str | None
    ) -> None:
        duration_ms = (time.perf_counter() - started) * 1000
        now = datetime.now(UTC)
        route = scope.get("route")
        template: str | None = getattr(route, "path", None)
        method = str(scope.get("method", ""))
        if status == 0:
            return
        request_stats.stats.record(now, template, status, duration_ms)
        group = route_group(template)
        # A health check's deliberate 503 (database down, stale backup) is
        # counted and logged, but not stored as an error event: the uptime
        # monitor asks every minute and would push the real errors out of
        # the Admin page's list.
        if status >= 500 and (exc_type is not None or group not in _QUIET_GROUPS):
            request_stats.record_error(
                ErrorEvent(
                    occurred_at=now,
                    route=template or "(no route)",
                    method=method,
                    status=status,
                    exc_type=exc_type,
                    request_id=request_id,
                )
            )
        if group in _QUIET_GROUPS and status < 500:
            return
        level = logging.ERROR if status >= 500 else logging.INFO
        # No route template to show for a path no route knows (bots probing
        # `/.env` and the like), so the path itself, never the query string,
        # cut short. Matched routes log only their template.
        path = None if template else str(scope.get("path", ""))[:200]
        logger.log(
            level,
            "%s %s %s",
            method,
            template or path or "(no route)",
            status,
            extra={
                "method": method,
                "route": template,
                "path": path,
                "status": status,
                "duration_ms": round(duration_ms, 1),
                "group": group,
            },
        )
