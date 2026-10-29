# Authentication

Authentication: `feat/authentication`; account notebook sync: `feat/database-connection`. The course remains available to guests. Account
records, Argon2id password hashes, profile pictures, JWT session records,
password-reset token hashes and rate limits live in SQLite, through SQLAlchemy.
Signed-in notebooks (completion, exercises, predictions, margin notes, reflections,
code attempts, reading mode and current lesson/stage) are stored per account in
SQLite/Turso. Guests keep the original browser-only notebook. A guest notebook
is imported only when the learner chooses **Import browser notebook**. See
[Notebook synchronization](notebook-sync.md) for conflict and offline behavior.

## Local development

1. Install `requirements-dev.txt` (or `uv sync --locked` for runtime dependencies).
2. Copy `.env.example` to `.env` at the repository root.
3. Start `uvicorn backend.main:app --reload --port 8000` and `cd web && npm run dev`.
4. Open `/signup`, then `/profile` to edit your name, add/remove your picture,
   change your password or sign out.

SQLite is created at `data/auth.sqlite3`. It is ignored by Git and Docker's build
context. Without `AUTH_JWT_SECRET`, development creates a random signing key in
the database; production requires an explicitly configured secret. Back up the
SQLite file when using a persistent local database.

Without `RESEND_API_KEY`, local reset messages go to the database's
`auth_email_outbox` table. After requesting a reset, run
`python scripts/preview_email.py` in a local terminal to read the link. This
preview contains a live reset token: keep it private. Production does not store
reset emails and disables previews.

## Vercel with hosted SQLite (Turso)

Local SQLite files are **not persistent** in Vercel functions. Production uses
Turso through SQLAlchemy's libSQL dialect, connecting directly to the hosted
database with TLS. Avatars are database blobs rather than filesystem uploads.

Create a Turso database and a database access token in your own account. Configure
these environment variables on the **backend project**, never in client code:

| Variable | Value |
| --- | --- |
| `TURSO_DATABASE_URL` | The `libsql://…turso.io` database origin, without a token or query string |
| `TURSO_AUTH_TOKEN` | The database access token |
| `AUTH_JWT_SECRET` | A long random secret, at least 32 bytes |
| `AUTH_FRONTEND_URL` | The exact HTTPS origin of your frontend deployment |
| `RESEND_API_KEY` | Your Resend API key |
| `AUTH_EMAIL_FROM` | A sender address on a domain verified with Resend |

On the **frontend project**, set `NEXT_PUBLIC_API_URL` to the backend's HTTPS
origin. It is a public address, not a secret. JWT signing, Turso and Resend
credentials are server-only. Deploy the backend from the repository root and
the frontend from `web/`, both using this branch.

The initial schema is created with SQLAlchemy on first use. Keep the Turso token
scoped to the intended database, and configure backups with your database
provider. Future schema changes should use a migration rather than dropping the
account tables. The SQLAlchemy libSQL integration is pinned and tested against
its native SQLite driver; a real hosted connection needs your Turso credentials.

For password-reset delivery, verify a sending domain in Resend and set
`AUTH_EMAIL_FROM` accordingly. In production, missing mail configuration produces
an account-service error instead of generating publicly accessible reset links.
Real email delivery can only be verified after these credentials are configured.

## Session and recovery behavior

- Sessions use HS256 JWTs with a fixed algorithm, issuer, audience and an eight-hour
  expiry. JWTs are stored in HttpOnly, SameSite=Lax cookies, with Secure enabled
  in production. They are not returned in JSON or saved in browser localStorage.
- The Node proxy forwards only the account-session cookie to the backend and
  forwards the backend's Set-Cookie response to the browser. Profile pictures
  require an authenticated request and use private, no-store responses.
- Signing out revokes the server-side session. Changing or resetting a password
  revokes every session for the account; sign in again afterward.
- Passwords require 12–128 characters. Password updates require the current
  password. Argon2id hashes are stored; plaintext passwords are never persisted.
- Reset requests return the same message for existing and unknown email
  addresses. Links expire after 30 minutes, are single-use, and replace earlier
  links. Only SHA-256 hashes of their random tokens are stored in production.
- Reset tokens travel in the email URL fragment. The reset page removes the
  fragment from the address bar and submits the token in the request body.
- Cookie-changing requests enforce the trusted frontend origin; account
  mutations also check origin at the frontend proxy. Login and recovery attempts
  are rate-limited in the database.
- JPEG, PNG and WebP avatars are decoded and re-encoded to JPEG, with metadata
  removed and dimensions reduced to at most 512×512. Upload limits are 2 MB and
  16 megapixels. SVG and malformed image data are rejected.

## Verification

`pytest tests/test_auth.py -q` exercises registration, hashed storage, duplicate
emails, login, JWT expiry/tampering/revocation, profile isolation, picture uploads,
password changes, CSRF, throttling, reset expiry/reuse and mocked Resend delivery.
The same contract runs against Python SQLite and Turso's libSQL driver locally.

Never commit `.env`, database files or live credentials. Do not print session
cookies or reset tokens in production logs.
