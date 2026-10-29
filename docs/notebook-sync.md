# Account notebook synchronization

Branch: `feat/database-connection` (based on `feat/authentication`).

## What is stored

Signed-in learners have one `auth_notebooks` row in SQLite/Turso. Its primary key
is the authenticated user's ID; it stores the complete validated version-1
notebook, a monotonically increasing revision, and the last-save timestamp.
The payload contains:

- Completed lessons and passed exercises.
- Quiz predictions and the furthest stage reached in each lesson.
- Margin notes, reflections and exercise-code attempts.
- Current lesson, stage and reading preference.

The existing SQLAlchemy connection and Turso settings are reused. No new service,
credentials or environment variables are required. The initial table is added
with `CREATE TABLE IF NOT EXISTS` on backend cold start; existing accounts are
preserved. Deploy both frontend and backend from this branch.

## Learner experience

On sign-in, the account notebook is loaded before the course is displayed.
Edits are saved automatically after a short pause. Navigation to the profile or
other app pages keeps the pending notebook in the layout's provider. A visible
status distinguishes local guest storage, pending saves, successful account
saves, connection failures and conflicts.

Guest work remains under the original browser key. It is not automatically
uploaded to whichever account signs in on a shared device. **Import browser
notebook** explicitly combines that guest notebook with the account notebook.
Completion and exercise progress are combined. Different edits to the same note,
reflection, code attempt or prediction require review first. Import keeps the
guest copy as a backup, and is remembered separately for each account.

JSON restore and Markdown/JSON downloads continue to work. A restored JSON
notebook is treated as a local edit to the current notebook, so account restores
also participate in revision checking before replacing server content.

## Concurrent edits

`GET /auth/notebook` returns the current payload and revision. A write to
`POST /auth/notebook` supplies the revision it started from. The server performs
an atomic insert or compare-and-update; stale writes receive HTTP 409 with the
current server notebook rather than overwriting it.

The client performs a three-way merge with the last server snapshot:

- Completed lessons and passed exercises are combined; maximum stages never go
  backward during a merge.
- Edits to different lessons/fields are combined automatically.
- If two devices edit the same field differently, both versions are shown. Saves
  pause until the learner chooses **Keep this version** or **Use other version**.
  Unresolved conflicts are kept in the account's browser backup across reloads.

An account ID supplied with a write is only an account-switch guard. Authorization
always comes from the JWT session. The server rejects a queued save if the
browser switched to another account, even if the request carries a valid session
for that other account. Late responses and updates from the previous account are
also ignored by the frontend.

## Offline behavior and limits

Each account has a separate local cache containing its notebook, base snapshot,
revision and unresolved conflicts. The guest cache is separate. Connection errors
do not convert an active account to guest mode. Online/focus events retry loading
and merge pending edits before saving. Closing a browser before a pending save
finishes relies on this local cache; reopen the same account on that browser to
retry. Offline work cannot appear on another device until uploaded successfully.

Local account caches remain on the device after sign-out for recovery of pending
work, but are not displayed to another account or as guest progress. They contain
notebook content, never JWTs. On shared computers, clear site data after ensuring
all account changes have synced and/or downloading a backup.

Sync payloads are limited to 1 MB, with at most 200 entries per field and 20,000
characters per text entry. If storage is blocked/full or a notebook is too large,
the UI reports it and the existing JSON/Markdown download remains available.
These limits are checked by the backend; the client does not silently mark a
failed upload as saved.

The notebook is a learner-editable record, not proof of assessment completion.
The API never accepts another user's ID as authorization and never exposes one
account's notebook through another account's session.

## Verification

Python tests run the notebook API against both SQLite and the native libSQL
driver used for Turso: complete round trips, new-session restore, account
isolation, revoked sessions, origin checks, validation/size limits and stale-save
rejection. Browser sync tests cover explicit import, offline recovery, in-flight
edits, conflicting notes, reload recovery and account switches. The production
browser check uses separate browser profiles and the actual Next.js proxy,
including the full HTTP-409 conflict response.
