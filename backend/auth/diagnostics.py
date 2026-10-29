"""Useful database diagnostics that never log native exception text or SQL binds."""

from contextlib import contextmanager
from pathlib import Path
import re


def database_diagnostic(error: Exception) -> tuple[str, str]:
    original = getattr(error, "orig", None) or error
    # Inspect locally; output is restricted to fixed codes/hints below. Native
    # errors can contain credentials, SQL parameters or user data.
    message = str(original).lower()
    rules = [
        (
            ("sqlite_readonly", "read-only", "readonly", "read only"),
            "DB_READ_ONLY",
            "Use a writable database token; registration creates tables and rows.",
        ),
        (
            ("expired", "expiration"),
            "DB_TOKEN_EXPIRED",
            "Create a new Turso database token and redeploy the backend.",
        ),
        (
            (
                "unauthorized",
                "unauthenticated",
                "invalid token",
                "invalid jwt",
                "jwt verification",
                "status: 401",
                "status 401",
                "401 unauthorized",
            ),
            "DB_AUTH_REJECTED",
            "Check TURSO_AUTH_TOKEN belongs to this database and is pasted without quotes.",
        ),
        (
            (
                "forbidden",
                "permission denied",
                "sqlite_auth",
                "not authorized",
                "status: 403",
                "status 403",
            ),
            "DB_PERMISSION_DENIED",
            "Check the Turso token database scope and read/write/schema permissions.",
        ),
        (
            ("certificate", "tls", "ssl"),
            "DB_TLS_ERROR",
            "Check database URL and trusted TLS connectivity; keep TLS verification enabled.",
        ),
        (
            (
                "dns",
                "resolve",
                "name or service not known",
                "connection refused",
                "connect error",
                "tcp connect",
                "network is unreachable",
            ),
            "DB_CONNECTION_FAILED",
            "Check the database hostname and outbound database connectivity.",
        ),
        (
            ("timeout", "timed out"),
            "DB_TIMEOUT",
            "The database did not answer in time; check service availability.",
        ),
        (
            ("pragma", "unsupported statement", "not supported"),
            "DB_REMOTE_OPERATION_UNSUPPORTED",
            "The database rejected a driver or initialization operation.",
        ),
        (
            ("no such table", "no such column", "schema"),
            "DB_SCHEMA_ERROR",
            "Check schema initialization and the database selected by TURSO_DATABASE_URL.",
        ),
        (
            ("not found", "does not exist", "404"),
            "DB_NOT_FOUND",
            "Check the Turso database URL and whether the database is active.",
        ),
        (
            ("sqlite_busy", "database is locked"),
            "DB_BUSY",
            "The database is busy; retry after active writes complete.",
        ),
        (
            (
                "protocol",
                "cursor stream ended",
                "unexpected response",
                "invalid url",
                "invalid uri",
            ),
            "DB_PROTOCOL_ERROR",
            "Check that TURSO_DATABASE_URL is the database origin, not a dashboard or API URL.",
        ),
    ]
    for needles, code, hint in rules:
        if any(needle in message for needle in needles):
            return code, hint
    return (
        "DB_UNCLASSIFIED",
        "Use the reported stage and source location to inspect the database operation; no secret values are needed.",
    )


def failure_stage(error: Exception) -> str:
    return (
        getattr(error, "auth_db_stage", None)
        or getattr(getattr(error, "orig", None), "auth_db_stage", None)
        or "account-operation"
    )


@contextmanager
def database_operation(stage: str):
    try:
        yield
    except Exception as error:
        if failure_stage(error) == "account-operation":
            error.auth_db_stage = stage
        raise


def failure_location(error: Exception) -> str:
    # Only our own source filenames/function names/line numbers; never source
    # text, traceback locals, exception messages, full paths or SQL parameters.
    location = "unknown"
    trace = error.__traceback__
    while trace:
        filename = Path(trace.tb_frame.f_code.co_filename)
        if (
            filename.parent.name in {"auth", "routers"}
            and filename.name != "diagnostics.py"
        ):
            function = re.sub(r"[^a-zA-Z0-9_]", "", trace.tb_frame.f_code.co_name)
            location = f"{filename.name}:{trace.tb_lineno}:{function}"
        trace = trace.tb_next
    return location
