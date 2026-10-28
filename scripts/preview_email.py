"""Show the newest local password-reset email; never available in production."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")
from sqlalchemy import select  # noqa: E402
from backend.auth.store import EmailOutbox, database, production  # noqa: E402

if production():
    sys.exit("Email previews are disabled in production.")
with database() as session:
    message = session.scalars(
        select(EmailOutbox).order_by(EmailOutbox.id.desc())
    ).first()
    if not message:
        sys.exit(
            "No preview email yet. Use Forgot password with a registered local email first."
        )
    print(f"To: {message.recipient}\nSubject: {message.subject}\n\n{message.body}")
