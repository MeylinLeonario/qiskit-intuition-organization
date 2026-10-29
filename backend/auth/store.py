"""SQLAlchemy account storage; SQLite also stores avatars and local preview email."""

from contextlib import contextmanager
from functools import lru_cache
import os
from pathlib import Path

from sqlalchemy import (
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.types import TypeDecorator
from sqlalchemy.schema import CreateIndex, CreateTable


class AuthConfigurationError(RuntimeError):
    pass


class Base(DeclarativeBase):
    pass


class ProfileImage(TypeDecorator):
    # libSQL accepts bytes directly but its DBAPI does not expose sqlite3.Binary.
    impl = LargeBinary
    cache_ok = True

    def bind_processor(self, dialect):
        return lambda value: bytes(value) if value is not None else None


class User(Base):
    __tablename__ = "auth_users"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Integer)
    avatar: Mapped[bytes | None] = mapped_column(ProfileImage, nullable=True)
    avatar_type: Mapped[str | None] = mapped_column(String(32), nullable=True)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("auth_users.id", ondelete="CASCADE"), index=True
    )
    expires_at: Mapped[int] = mapped_column(Integer)


class PasswordReset(Base):
    __tablename__ = "auth_password_resets"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("auth_users.id", ondelete="CASCADE"), index=True
    )
    expires_at: Mapped[int] = mapped_column(Integer)


class RateLimit(Base):
    __tablename__ = "auth_rate_limits"
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    count: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int] = mapped_column(Integer)


class Setting(Base):
    __tablename__ = "auth_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class EmailOutbox(Base):
    __tablename__ = "auth_email_outbox"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recipient: Mapped[str] = mapped_column(String(254))
    subject: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Integer)


def production() -> bool:
    return os.getenv("VERCEL") == "1" or os.getenv("APP_ENV") == "production"


@lru_cache(maxsize=8)
def engine_for(url: str, token: str | None = None):
    sqlite = url.startswith("sqlite:")
    from sqlalchemy.engine import make_url

    local_sqlite = url.startswith("sqlite") and not make_url(url).host
    if local_sqlite and os.getenv("VERCEL") == "1":
        raise AuthConfigurationError(
            "Local SQLite requires a persistent backend disk; Vercel filesystem storage is ephemeral."
        )
    if sqlite and url != "sqlite:///:memory:":
        filename = make_url(url).database
        if filename:
            Path(filename).resolve().parent.mkdir(parents=True, exist_ok=True)
    if url.startswith("sqlite+libsql:"):
        from sqlalchemy.pool import NullPool

        engine = create_engine(
            url, connect_args={"auth_token": token} if token else {}, poolclass=NullPool
        )
    else:
        engine = create_engine(
            url,
            connect_args={"check_same_thread": False, "timeout": 15} if sqlite else {},
        )
    if sqlite or url.startswith("sqlite+libsql:"):

        @event.listens_for(engine, "connect")
        def sqlite_options(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=15000")

    # Multiple Vercel cold starts can initialize the schema concurrently.
    with engine.begin() as connection:
        for table in Base.metadata.sorted_tables:
            connection.execute(CreateTable(table, if_not_exists=True))
            for index in table.indexes:
                connection.execute(CreateIndex(index, if_not_exists=True))
    return engine


@contextmanager
def database():
    remote = os.getenv("TURSO_DATABASE_URL", "").strip()
    if remote:
        from urllib.parse import urlsplit

        parsed = urlsplit(remote if "://" in remote else "libsql://" + remote)
        if (
            not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.path not in {"", "/"}
        ):
            raise AuthConfigurationError(
                "TURSO_DATABASE_URL must contain only the database origin"
            )
        token = os.getenv("TURSO_AUTH_TOKEN")
        if not token:
            raise AuthConfigurationError(
                "TURSO_AUTH_TOKEN is required for hosted SQLite"
            )
        engine = engine_for(f"sqlite+libsql://{parsed.netloc}?secure=true", token)
    else:
        engine = engine_for(
            os.getenv("AUTH_DATABASE_URL", "sqlite:///data/auth.sqlite3")
        )
    with Session(engine, expire_on_commit=False) as session, session.begin():
        yield session
