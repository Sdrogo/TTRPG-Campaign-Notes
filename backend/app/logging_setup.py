"""Logs as one JSON object per line on stdout (ticket 75 Decision 5), so the
log viewer (Dozzle) can filter by field and nothing needs parsing.

Every line carries `time`, `level`, `logger` and `message`, plus the
request's `request_id` when one is running (set by
app/api/request_metrics.py) and any of `method`, `route`, `status`,
`duration_ms` passed through `extra=`. Exceptions add `exc_type` and the
traceback. Request bodies, headers, tokens and query strings are never
logged; messages and tracebacks can still hold values (an email in a
constraint error), which is why they stay in the container log, rotated
within weeks, and never reach a database table."""

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime

# The id of the request being handled, for every line logged while it runs.
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

# Fields copied from `extra=` when present.
_EXTRA_FIELDS = ("method", "route", "status", "duration_ms", "group")


class JsonFormatter(logging.Formatter):
    """One JSON object per record."""

    def format(self, record: logging.LogRecord) -> str:
        """The record as a single JSON line."""
        entry: dict[str, object] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = request_id_var.get()
        if request_id is not None:
            entry["request_id"] = request_id
        for name in _EXTRA_FIELDS:
            value = getattr(record, name, None)
            if value is not None:
                entry[name] = value
        if record.exc_info and record.exc_info[0] is not None:
            entry["exc_type"] = record.exc_info[0].__name__
            entry["traceback"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    """Sends the app's and uvicorn's logs through `JsonFormatter` to stdout.
    Uvicorn sets up its own handlers before importing the app, so its
    loggers are rewired here; its access log is replaced by the request
    line of app/api/request_metrics.py (no client IP, no query string)."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    for name in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True
    access = logging.getLogger("uvicorn.access")
    access.handlers = []
    access.propagate = False
    access.disabled = True
