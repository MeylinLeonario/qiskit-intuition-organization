"""Database failure logs remain useful without leaking native messages or binds."""

import logging

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.exc import StatementError

from backend.auth.diagnostics import (
    database_diagnostic,
    database_operation,
    failure_stage,
)
from backend.main import app


@pytest.mark.parametrize(
    "message,code",
    [
        ("HTTP status: 401 unauthorized token=private-value", "DB_AUTH_REJECTED"),
        ("Hrana: JWT token has expired", "DB_TOKEN_EXPIRED"),
        ("SQLITE_AUTH: permission denied", "DB_PERMISSION_DENIED"),
        ("attempt to write a readonly database", "DB_READ_ONLY"),
        ("DNS failed to resolve database", "DB_CONNECTION_FAILED"),
        ("certificate TLS verification failed", "DB_TLS_ERROR"),
        ("request timed out", "DB_TIMEOUT"),
        ("PRAGMA operation not supported", "DB_REMOTE_OPERATION_UNSUPPORTED"),
        ("no such table: auth_users", "DB_SCHEMA_ERROR"),
        ("remote stream error with unexpected response", "DB_PROTOCOL_ERROR"),
        ("arbitrary secret database details", "DB_UNCLASSIFIED"),
    ],
)
def test_native_errors_have_fixed_safe_codes(message, code):
    actual, hint = database_diagnostic(ValueError(message))
    assert actual == code
    assert "private-value" not in hint
    assert "arbitrary secret" not in hint


def test_nested_stages_and_sqlalchemy_wrapping_preserve_safe_information():
    try:
        with database_operation("connect"):
            with database_operation("initialize-schema"):
                raise ValueError("SQLITE_READONLY private text")
    except ValueError as error:
        wrapped = StatementError(
            "SQL with private parameters", "SQL", {"password": "private"}, error
        )
        assert failure_stage(wrapped) == "initialize-schema"
        assert database_diagnostic(wrapped)[0] == "DB_READ_ONLY"


def test_signup_failure_logs_code_without_native_secrets(monkeypatch, caplog):
    monkeypatch.setenv("AUTH_FRONTEND_URL", "http://localhost:3000")
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    from backend.routers import auth

    def fail(*args, **kwargs):
        raise ValueError(
            "Unauthorized token=SENSITIVE_TOKEN email=PRIVATE_EMAIL password=PRIVATE_PASSWORD"
        )

    monkeypatch.setattr(auth, "throttle", fail)
    with caplog.at_level(logging.ERROR), TestClient(app) as client:
        response = client.post(
            "/auth/signup",
            headers={"Origin": "http://localhost:3000"},
            json={
                "display_name": "Diagnostic",
                "email": "diagnostic@example.com",
                "password": "a test passphrase at least twelve",
            },
        )
    assert response.status_code == 503
    assert "DB_AUTH_REJECTED" in caplog.text
    for secret in ["SENSITIVE_TOKEN", "PRIVATE_EMAIL", "PRIVATE_PASSWORD"]:
        assert secret not in caplog.text
        assert secret not in response.text
