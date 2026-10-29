"""Password-recovery mail via Resend, with a SQLite-only local preview outbox."""

import logging
import os
import time
from urllib.parse import urlsplit

import requests

from backend.auth.store import EmailOutbox, AuthConfigurationError, database, production


def frontend_url() -> str:
    url = os.getenv("AUTH_FRONTEND_URL", "http://localhost:3000").rstrip("/")
    parsed = urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise AuthConfigurationError(
            "AUTH_FRONTEND_URL must be an absolute trusted frontend URL"
        )
    if production() and parsed.scheme != "https":
        raise AuthConfigurationError("AUTH_FRONTEND_URL must use HTTPS in production")
    return url


def mail_ready():
    frontend_url()
    if (production() or os.getenv("RESEND_API_KEY")) and (
        not os.getenv("RESEND_API_KEY") or not os.getenv("AUTH_EMAIL_FROM")
    ):
        raise AuthConfigurationError(
            "RESEND_API_KEY and AUTH_EMAIL_FROM are required for password recovery"
        )


def deliver_reset(recipient: str, token: str):
    url = f"{frontend_url()}/reset-password#token={token}"
    subject = "Reset your Qiskit Intuition password"
    body = (
        f"Someone requested a password reset for your Qiskit Intuition account.\n\n"
        f"Open this link to choose a new password:\n{url}\n\n"
        "This link expires in 30 minutes and can only be used once. "
        "If you did not request this, you can ignore this email.\n"
    )
    if not os.getenv("RESEND_API_KEY") and not production():
        with database() as conn:
            conn.add(
                EmailOutbox(
                    recipient=recipient,
                    subject=subject,
                    body=body,
                    created_at=int(time.time()),
                )
            )
        return
    try:
        response = requests.post(
            "https://api.resend.com/emails",
            json={
                "from": os.environ["AUTH_EMAIL_FROM"],
                "to": [recipient],
                "subject": subject,
                "text": body,
            },
            headers={"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}"},
            timeout=15,
        )
        response.raise_for_status()
    except (requests.RequestException, KeyError):
        # Never log reset links, credentials, or Resend response bodies.
        logging.getLogger(__name__).error(
            "Password recovery email delivery failed; check Resend configuration"
        )
