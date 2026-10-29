"""Password hashing and strictly validated JWT sessions."""

import os
import secrets
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
import jwt

from sqlalchemy import delete, insert, literal, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from backend.auth.store import (
    AuthSession,
    Setting,
    User,
    AuthConfigurationError,
    database,
    production,
)


class CredentialsChangedError(Exception):
    pass


PASSWORDS = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
DUMMY_HASH = PASSWORDS.hash(secrets.token_urlsafe(24))
COOKIE = "qi_session"
SESSION_SECONDS = 8 * 60 * 60
ISSUER = "qiskit-intuition"
AUDIENCE = "qiskit-intuition-web"


def secret() -> str:
    configured = os.getenv("AUTH_JWT_SECRET", "")
    if configured:
        if len(configured.encode()) < 32:
            raise AuthConfigurationError(
                "AUTH_JWT_SECRET must contain at least 32 bytes"
            )
        return configured
    if production():
        raise AuthConfigurationError("AUTH_JWT_SECRET is required in production")
    with database() as conn:
        conn.execute(
            sqlite_insert(Setting)
            .values(key="jwt_secret", value=secrets.token_urlsafe(48))
            .on_conflict_do_nothing(index_elements=[Setting.key])
        )
        return conn.get(Setting, "jwt_secret").value


def password_matches(password: str, encoded: str) -> bool:
    try:
        return PASSWORDS.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False


def issue_session(user_id: str, expected_hash: str) -> str:
    key = secret()
    now = int(time.time())
    session_id = secrets.token_urlsafe(32)
    with database() as conn:
        conn.execute(delete(AuthSession).where(AuthSession.expires_at <= now))
        created = conn.execute(
            insert(AuthSession).from_select(
                ["id", "user_id", "expires_at"],
                select(
                    literal(session_id), User.id, literal(now + SESSION_SECONDS)
                ).where(User.id == user_id, User.password_hash == expected_hash),
            )
        )
        if created.rowcount != 1:
            raise CredentialsChangedError(
                "The account password changed while signing in"
            )
    return jwt.encode(
        {
            "sub": user_id,
            "jti": session_id,
            "iat": now,
            "exp": now + SESSION_SECONDS,
            "iss": ISSUER,
            "aud": AUDIENCE,
            "type": "session",
        },
        key,
        algorithm="HS256",
    )


def decode_session(token: str) -> dict:
    claims = jwt.decode(
        token,
        secret(),
        algorithms=["HS256"],
        issuer=ISSUER,
        audience=AUDIENCE,
        options={"require": ["exp", "iat", "sub", "jti", "iss", "aud"]},
    )
    if claims.get("type") != "session":
        raise jwt.InvalidTokenError("Wrong token type")
    return claims
