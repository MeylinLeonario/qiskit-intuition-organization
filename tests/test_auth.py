"""Authentication contract tested against SQLite and Turso's actual libSQL driver."""

import base64
import hashlib
from io import BytesIO
import re
import time

from fastapi.testclient import TestClient
import jwt
from PIL import Image
import pytest
from sqlalchemy import select, update

from backend.auth.security import COOKIE
from backend.auth.store import EmailOutbox, PasswordReset, User, database, engine_for
from backend.main import app

PASSWORD = "a long test passphrase 123"
NEW_PASSWORD = "a different strong passphrase 456"


@pytest.fixture(params=["sqlite", "sqlite+libsql"])
def client(tmp_path, monkeypatch, request):
    monkeypatch.setenv(
        "AUTH_DATABASE_URL", f"{request.param}:///{tmp_path}/accounts.sqlite3"
    )
    monkeypatch.setenv(
        "AUTH_JWT_SECRET", "unit-test-only-signing-key-at-least-32-characters"
    )
    monkeypatch.setenv("AUTH_FRONTEND_URL", "http://localhost:3000")
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("TURSO_DATABASE_URL", raising=False)
    monkeypatch.delenv("TURSO_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    with TestClient(app, headers={"Origin": "http://localhost:3000"}) as browser:
        yield browser
    engine_for.cache_clear()


def signup(client, email="alice@example.com"):
    result = client.post(
        "/auth/signup",
        json={"email": email, "password": PASSWORD, "display_name": " Alice "},
    )
    assert result.status_code == 201, result.text
    return result


def login(client, password=PASSWORD):
    return client.post(
        "/auth/login", json={"email": "alice@example.com", "password": password}
    )


def reset_token():
    with database() as conn:
        email = conn.scalars(
            select(EmailOutbox).order_by(EmailOutbox.id.desc())
        ).first()
        return re.search(r"#token=([^\s]+)", email.body).group(1)


def test_signup_cookie_hash_and_duplicate(client):
    response = signup(client, "ALICE@EXAMPLE.COM")
    data = response.json()["user"]
    assert data["email"] == "alice@example.com"
    assert data["display_name"] == "Alice"
    assert "password_hash" not in data
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=lax" in response.headers["set-cookie"]
    with database() as conn:
        user = conn.get(User, data["id"])
        assert user.password_hash.startswith("$argon2id$")
        assert PASSWORD not in user.password_hash
    assert client.get("/auth/me").status_code == 200
    duplicate = client.post(
        "/auth/signup",
        json={
            "email": "alice@example.com",
            "password": PASSWORD,
            "display_name": "Other",
        },
    )
    assert duplicate.status_code == 409


def test_bad_login_no_account_enumeration_and_validation(client):
    signup(client)
    wrong = login(client, "incorrect")
    unknown = client.post(
        "/auth/login", json={"email": "unknown@example.com", "password": "incorrect"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    result = client.post(
        "/auth/signup",
        json={"email": "bad address", "password": "short", "display_name": "Name"},
    )
    assert result.status_code == 422
    assert '"input"' not in result.text
    assert login(client).status_code == 200


def test_logout_revokes_copied_jwt(client):
    signup(client)
    copied = client.cookies.get(COOKIE)
    assert client.post("/auth/logout").status_code == 200
    assert client.get("/auth/me").status_code == 401
    client.cookies.set(COOKIE, copied)
    assert client.get("/auth/me").status_code == 401


def test_tampered_and_expired_jwt_rejected(client, monkeypatch):
    signup(client)
    client.cookies.clear()
    client.cookies.set(COOKIE, "not.a.jwt")
    assert client.get("/auth/me").status_code == 401
    import os

    expired = jwt.encode(
        {
            "sub": "1",
            "jti": "x",
            "iat": 1,
            "exp": 2,
            "iss": "qiskit-intuition",
            "aud": "qiskit-intuition-web",
            "type": "session",
        },
        os.environ["AUTH_JWT_SECRET"],
        algorithm="HS256",
    )
    client.cookies.set(COOKIE, expired)
    assert client.get("/auth/me").status_code == 401


def test_profile_and_avatar_are_private_and_isolated(client):
    signup(client)
    assert (
        client.post("/auth/profile", json={"display_name": "New name"}).json()["user"][
            "display_name"
        ]
        == "New name"
    )
    output = BytesIO()
    Image.new("RGB", (800, 600), "blue").save(output, format="PNG")
    result = client.post(
        "/auth/avatar", json={"image": base64.b64encode(output.getvalue()).decode()}
    )
    assert result.status_code == 200, result.text
    assert result.json()["user"]["has_avatar"]
    picture = client.get("/auth/avatar")
    assert picture.headers["content-type"] == "image/jpeg"
    assert max(Image.open(BytesIO(picture.content)).size) <= 512
    assert (
        client.post("/auth/avatar", json={"image": "<svg>bad</svg>"}).status_code == 422
    )
    client.post("/auth/logout")
    assert client.get("/auth/avatar").status_code == 401
    signup(client, "bob@example.com")
    assert client.get("/auth/avatar").status_code == 404


def test_password_change_revokes_all_sessions(client):
    signup(client)
    first = client.cookies.get(COOKIE)
    login(client)
    second = client.cookies.get(COOKIE)
    assert first != second
    assert (
        client.post(
            "/auth/change-password",
            json={"current_password": "wrong", "new_password": NEW_PASSWORD},
        ).status_code
        == 401
    )
    result = client.post(
        "/auth/change-password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert result.status_code == 200
    client.cookies.set(COOKIE, first)
    assert client.get("/auth/me").status_code == 401
    client.cookies.clear()
    assert login(client).status_code == 401
    assert login(client, NEW_PASSWORD).status_code == 200


def test_reset_is_generic_hashed_single_use_and_revokes_sessions(client):
    signup(client)
    copied = client.cookies.get(COOKIE)
    known = client.post("/auth/forgot-password", json={"email": "alice@example.com"})
    unknown = client.post(
        "/auth/forgot-password", json={"email": "unknown@example.com"}
    )
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()
    token = reset_token()
    assert token not in known.text
    with database() as conn:
        assert (
            conn.get(PasswordReset, hashlib.sha256(token.encode()).hexdigest())
            is not None
        )
        assert conn.get(PasswordReset, token) is None
    result = client.post(
        "/auth/reset-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert result.status_code == 200, result.text
    assert (
        client.post(
            "/auth/reset-password", json={"token": token, "new_password": PASSWORD}
        ).status_code
        == 400
    )
    client.cookies.set(COOKIE, copied)
    assert client.get("/auth/me").status_code == 401
    client.cookies.clear()
    assert login(client).status_code == 401
    assert login(client, NEW_PASSWORD).status_code == 200


def test_expired_reset_and_superseded_link_rejected(client):
    signup(client)
    client.post("/auth/forgot-password", json={"email": "alice@example.com"})
    old = reset_token()
    client.post("/auth/forgot-password", json={"email": "alice@example.com"})
    token = reset_token()
    assert token != old
    assert (
        client.post(
            "/auth/reset-password", json={"token": old, "new_password": NEW_PASSWORD}
        ).status_code
        == 400
    )
    with database() as conn:
        conn.execute(update(PasswordReset).values(expires_at=int(time.time()) - 1))
    assert (
        client.post(
            "/auth/reset-password", json={"token": token, "new_password": NEW_PASSWORD}
        ).status_code
        == 400
    )


def test_csrf_and_login_throttle(client):
    signup(client)
    assert (
        client.post(
            "/auth/profile",
            json={"display_name": "Attacker"},
            headers={"Origin": "https://attacker.example"},
        ).status_code
        == 403
    )
    for _ in range(10):
        assert login(client, "wrong").status_code == 401
    assert login(client, "wrong").status_code == 429


def test_resend_delivery_is_used_without_persisting_email(client, monkeypatch):
    signup(client)
    monkeypatch.setenv("RESEND_API_KEY", "fake-test-key")
    monkeypatch.setenv("AUTH_EMAIL_FROM", "Qiskit Intuition <accounts@example.com>")
    calls = []

    class Delivered:
        def raise_for_status(self):
            pass

    def send(url, **kwargs):
        calls.append((url, kwargs))
        return Delivered()

    monkeypatch.setattr("backend.auth.mail.requests.post", send)
    assert (
        client.post(
            "/auth/forgot-password", json={"email": "alice@example.com"}
        ).status_code
        == 200
    )
    assert len(calls) == 1
    assert calls[0][0] == "https://api.resend.com/emails"
    assert "http://localhost:3000/reset-password#token=" in calls[0][1]["json"]["text"]
    with database() as conn:
        assert conn.scalar(select(EmailOutbox)) is None


def test_production_requires_secret_and_uses_secure_cookies(client, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("AUTH_FRONTEND_URL", "https://course.example.com")
    client.headers["Origin"] = "https://course.example.com"
    monkeypatch.delenv("AUTH_JWT_SECRET")
    result = client.post(
        "/auth/signup",
        json={
            "email": "alice@example.com",
            "password": PASSWORD,
            "display_name": "Alice",
        },
    )
    assert result.status_code == 503
    with database() as conn:
        assert conn.scalar(select(User)) is None
    monkeypatch.setenv("AUTH_JWT_SECRET", "production-test-only-at-least-32-characters")
    response = signup(client)
    assert "Secure" in response.headers["set-cookie"]
    assert (
        client.post(
            "/auth/forgot-password", json={"email": "alice@example.com"}
        ).status_code
        == 503
    )


def test_wrong_audience_and_algorithm_cannot_authenticate(client):
    signup(client)
    import os

    token = client.cookies.get(COOKIE)
    claims = jwt.decode(token, options={"verify_signature": False})
    client.cookies.clear()
    claims["aud"] = "another-application"
    client.cookies.set(
        COOKIE, jwt.encode(claims, os.environ["AUTH_JWT_SECRET"], algorithm="HS256")
    )
    assert client.get("/auth/me").status_code == 401
    claims["aud"] = "qiskit-intuition-web"
    client.cookies.set(
        COOKIE, jwt.encode(claims, os.environ["AUTH_JWT_SECRET"], algorithm="HS384")
    )
    assert client.get("/auth/me").status_code == 401


def test_stale_password_cannot_issue_a_new_session(client):
    from backend.auth.security import CredentialsChangedError, issue_session
    from backend.auth.store import AuthSession
    from sqlalchemy import func

    user_id = signup(client).json()["user"]["id"]
    with database() as conn:
        original = conn.get(User, user_id).password_hash
    assert (
        client.post(
            "/auth/change-password",
            json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        ).status_code
        == 200
    )
    with pytest.raises(CredentialsChangedError):
        issue_session(user_id, original)
    with database() as conn:
        assert conn.scalar(select(func.count()).select_from(AuthSession)) == 0


def test_remove_picture_and_logout_expired_cookie(client):
    signup(client)
    assert client.post("/auth/avatar", json={"image": None}).status_code == 200
    assert client.get("/auth/avatar").status_code == 404
    client.cookies.clear()
    client.cookies.set(COOKIE, "invalid.session.token")
    assert client.post("/auth/logout").status_code == 200
    assert client.get("/auth/me").status_code == 401
