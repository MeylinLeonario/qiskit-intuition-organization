"""JWT authentication, profile editing and email password recovery."""

import base64
import binascii
import hashlib
from io import BytesIO
import os
import secrets
import time
import warnings

from email_validator import EmailNotValidError, validate_email
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Request,
    Response,
)
import jwt
from fastapi.routing import APIRoute
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import SQLAlchemyError

from backend.auth import mail
from backend.auth.security import (
    COOKIE,
    DUMMY_HASH,
    PASSWORDS,
    SESSION_SECONDS,
    CredentialsChangedError,
    decode_session,
    issue_session,
    password_matches,
)
from backend.auth.store import (
    AuthSession,
    PasswordReset,
    RateLimit,
    User,
    AuthConfigurationError,
    database,
    production,
)


def origin_check(request: Request):
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    origin = request.headers.get("origin")
    allowed = {
        mail.frontend_url(),
        *[
            url.strip().rstrip("/")
            for url in os.getenv("ALLOWED_ORIGINS", "").split(",")
            if url.strip()
        ],
    }
    if origin and origin.rstrip("/") not in allowed:
        raise HTTPException(403, "This request did not come from the application.")
    if not origin and request.cookies.get(COOKIE):
        raise HTTPException(403, "An application origin is required for this request.")


class AccountRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def safe_handler(request: Request):
            try:
                return await handler(request)
            except (RuntimeError, SQLAlchemyError, ValueError) as error:
                # The native libSQL DBAPI can raise ValueError instead of a
                # SQLAlchemy exception. Never expose its connection details.
                return await configuration_error_handler(request, error)

        return safe_handler


router = APIRouter(
    route_class=AccountRoute,
    prefix="/auth",
    tags=["authentication"],
    dependencies=[Depends(origin_check)],
)


def public_user(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "created_at": user.created_at,
        "has_avatar": user.avatar is not None,
    }


def normalize_email(value: str) -> str:
    try:
        return validate_email(
            value.strip(), check_deliverability=False
        ).normalized.casefold()
    except EmailNotValidError:
        raise ValueError("Enter a valid email address") from None


class EmailRequest(BaseModel):
    email: str = Field(max_length=254)
    _email = field_validator("email")(normalize_email)


class LoginRequest(EmailRequest):
    password: str = Field(min_length=1, max_length=128)


class SignupRequest(LoginRequest):
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("display_name")
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError("Enter your name")
        return value.strip()

    @field_validator("password")
    @classmethod
    def strong_password(cls, value):
        if len(value) < 12:
            raise ValueError("Use at least 12 characters for your password")
        return value


class PasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class ResetRequest(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    new_password: str = Field(min_length=12, max_length=128)


class ProfileRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    _name = field_validator("display_name")(SignupRequest.clean_name.__func__)


class AvatarRequest(BaseModel):
    image: str | None = Field(default=None, max_length=2800000)


def throttle(prefix: str, identifier: str, maximum=10, period=900):
    now = int(time.time())
    key = prefix + ":" + hashlib.sha256(identifier.encode()).hexdigest()
    with database() as conn:
        conn.execute(delete(RateLimit).where(RateLimit.expires_at <= now))
        statement = insert(RateLimit).values(key=key, count=1, expires_at=now + period)
        conn.execute(
            statement.on_conflict_do_update(
                index_elements=[RateLimit.key], set_={"count": RateLimit.count + 1}
            )
        )
        count = conn.get(RateLimit, key).count
    if count > maximum:
        raise HTTPException(
            429,
            "Too many attempts. Please try again in 15 minutes.",
            headers={"Retry-After": str(period)},
        )


def current_identity(request: Request) -> tuple[User, dict]:
    token = request.cookies.get(COOKIE)
    if not token:
        authorization = request.headers.get("authorization", "")
        token = authorization[7:] if authorization.startswith("Bearer ") else None
    if not token:
        raise HTTPException(401, "Please sign in to continue.")
    try:
        claims = decode_session(token)
    except jwt.InvalidTokenError:
        raise HTTPException(
            401, "Your session has expired. Please sign in again."
        ) from None
    with database() as conn:
        session = conn.get(AuthSession, claims["jti"])
        if (
            session is None
            or session.user_id != claims["sub"]
            or session.expires_at <= int(time.time())
        ):
            raise HTTPException(401, "Your session has expired. Please sign in again.")
        user = conn.get(User, session.user_id)
        if user is None:
            raise HTTPException(401, "Please sign in again.")
        return user, claims


def attach_cookie(response: Response, token: str):
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        secure=production(),
        samesite="lax",
        max_age=SESSION_SECONDS,
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"


def clear_cookie(response: Response):
    response.delete_cookie(
        COOKIE, path="/", httponly=True, secure=production(), samesite="lax"
    )
    response.headers["Cache-Control"] = "no-store"


@router.post("/signup", status_code=201)
def signup(req: SignupRequest, response: Response, request: Request):
    throttle("signup", request.client.host if request.client else "unknown", maximum=30)
    # Validate signing configuration before persisting an account.
    from backend.auth.security import secret

    secret()
    user = User(
        id=secrets.token_hex(16),
        email=req.email,
        display_name=req.display_name,
        password_hash=PASSWORDS.hash(req.password),
        created_at=int(time.time()),
    )
    with database() as conn:
        result = conn.execute(
            insert(User)
            .values(
                id=user.id,
                email=user.email,
                display_name=user.display_name,
                password_hash=user.password_hash,
                created_at=user.created_at,
            )
            .on_conflict_do_nothing(index_elements=[User.email])
        )
        if result.rowcount != 1:
            raise HTTPException(
                409,
                "An account with that email already exists. Sign in or reset your password.",
            )
    try:
        attach_cookie(response, issue_session(user.id, user.password_hash))
    except CredentialsChangedError:
        raise HTTPException(
            401, "Your password changed. Please sign in again."
        ) from None
    return {"user": public_user(user)}


@router.post("/login")
def login(req: LoginRequest, response: Response):
    throttle("login", req.email)
    with database() as conn:
        user = conn.scalar(select(User).where(User.email == req.email))
    valid = password_matches(req.password, user.password_hash if user else DUMMY_HASH)
    if not valid or user is None:
        raise HTTPException(401, "Email or password is incorrect.")
    with database() as conn:
        if PASSWORDS.check_needs_rehash(user.password_hash):
            replacement = PASSWORDS.hash(req.password)
            updated = conn.execute(
                update(User)
                .where(User.id == user.id, User.password_hash == user.password_hash)
                .values(password_hash=replacement)
            )
            if updated.rowcount != 1:
                raise HTTPException(401, "Your password changed. Please sign in again.")
            user.password_hash = replacement
    try:
        attach_cookie(response, issue_session(user.id, user.password_hash))
    except CredentialsChangedError:
        raise HTTPException(
            401, "Your password changed. Please sign in again."
        ) from None
    return {"user": public_user(user)}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    if token:
        try:
            claims = decode_session(token)
        except jwt.InvalidTokenError:
            claims = None
        if claims is not None:
            with database() as conn:
                conn.execute(
                    delete(AuthSession).where(
                        AuthSession.id == claims["jti"],
                        AuthSession.user_id == claims["sub"],
                    )
                )
    clear_cookie(response)
    return {"message": "Signed out."}


@router.get("/me")
def me(response: Response, identity=Depends(current_identity)):
    response.headers["Cache-Control"] = "no-store"
    return {"user": public_user(identity[0])}


@router.post("/profile")
def update_profile(req: ProfileRequest, identity=Depends(current_identity)):
    user, _ = identity
    with database() as conn:
        conn.execute(
            update(User).where(User.id == user.id).values(display_name=req.display_name)
        )
    user.display_name = req.display_name
    return {"user": public_user(user)}


@router.post("/avatar")
def upload_avatar(req: AvatarRequest, identity=Depends(current_identity)):
    user, _ = identity
    picture = None
    if req.image is not None:
        try:
            raw = base64.b64decode(req.image, validate=True)
            if not 0 < len(raw) <= 2 * 1024 * 1024:
                raise ValueError("size")
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(raw)) as image:
                    if (
                        image.format not in {"JPEG", "PNG", "WEBP"}
                        or image.width * image.height > 16000000
                    ):
                        raise ValueError("format")
                    image = ImageOps.exif_transpose(image).convert("RGB")
                    image.thumbnail((512, 512))
                    output = BytesIO()
                    image.save(output, format="JPEG", quality=85)
                    picture = output.getvalue()
        except (
            ValueError,
            binascii.Error,
            OSError,
            UnidentifiedImageError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
        ):
            raise HTTPException(
                422,
                "Choose a valid JPEG, PNG or WebP picture smaller than 2 MB and 16 megapixels.",
            ) from None
    with database() as conn:
        conn.execute(
            update(User)
            .where(User.id == user.id)
            .values(avatar=picture, avatar_type="image/jpeg" if picture else None)
        )
    user.avatar = picture
    return {"user": public_user(user)}


@router.get("/avatar")
def get_avatar(identity=Depends(current_identity)):
    user, _ = identity
    if user.avatar is None:
        raise HTTPException(404, "No profile picture yet.")
    return Response(
        user.avatar,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/change-password")
def change_password(
    req: PasswordRequest, response: Response, identity=Depends(current_identity)
):
    user, _ = identity
    throttle("password", user.id)
    if not password_matches(req.current_password, user.password_hash):
        raise HTTPException(401, "Your current password is incorrect.")
    if req.new_password == req.current_password:
        raise HTTPException(422, "Choose a different password.")
    encoded = PASSWORDS.hash(req.new_password)
    with database() as conn:
        changed = conn.execute(
            update(User)
            .where(User.id == user.id, User.password_hash == user.password_hash)
            .values(password_hash=encoded)
        )
        if changed.rowcount != 1:
            raise HTTPException(401, "Your password changed. Please sign in again.")
        conn.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
        conn.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    clear_cookie(response)
    return {"message": "Password changed. Please sign in again on your devices."}


@router.post("/forgot-password")
def forgot_password(req: EmailRequest, tasks: BackgroundTasks):
    mail.mail_ready()
    throttle("reset", req.email, maximum=3)
    now = int(time.time())
    with database() as conn:
        user = conn.scalar(select(User).where(User.email == req.email))
        if user is not None:
            token = secrets.token_urlsafe(48)
            conn.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
            conn.add(
                PasswordReset(
                    token_hash=hashlib.sha256(token.encode()).hexdigest(),
                    user_id=user.id,
                    expires_at=now + 1800,
                )
            )
            tasks.add_task(mail.deliver_reset, user.email, token)
    return {
        "message": "If an account exists for that email, a password-reset link will be sent. Check your inbox and spam folder."
    }


@router.post("/reset-password")
def reset_password(req: ResetRequest, response: Response, request: Request):
    throttle(
        "reset-use", request.client.host if request.client else "unknown", maximum=30
    )
    digest = hashlib.sha256(req.token.encode()).hexdigest()
    encoded = PASSWORDS.hash(req.new_password)
    now = int(time.time())
    with database() as conn:
        record = conn.get(PasswordReset, digest)
        if record is None or record.expires_at <= now:
            raise HTTPException(
                400, "This reset link is invalid or has expired. Request a new one."
            )
        user_id = record.user_id
        used = conn.execute(
            delete(PasswordReset).where(
                PasswordReset.token_hash == digest, PasswordReset.expires_at > now
            )
        )
        if used.rowcount != 1:
            raise HTTPException(400, "This reset link has already been used.")
        conn.execute(
            update(User).where(User.id == user_id).values(password_hash=encoded)
        )
        conn.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
        conn.execute(delete(PasswordReset).where(PasswordReset.user_id == user_id))
    clear_cookie(response)
    return {"message": "Password reset. Sign in with your new password."}


async def configuration_error_handler(request: Request, error: Exception):
    import logging
    from fastapi.responses import JSONResponse

    if isinstance(error, AuthConfigurationError):
        # These configuration messages name missing variables, never their values.
        logging.getLogger(__name__).error("Authentication configuration: %s", error)
    else:
        logging.getLogger(__name__).error(
            "Authentication database failure (%s)", type(error).__name__
        )
    return JSONResponse(
        {
            "detail": "Account services are temporarily unavailable. Please try again later."
        },
        status_code=503,
    )


AUTH_ERROR_TYPES = (AuthConfigurationError, SQLAlchemyError)
