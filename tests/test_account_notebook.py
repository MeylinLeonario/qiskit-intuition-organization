"""Account isolation and optimistic writes on SQLite and the Turso libSQL driver."""

from fastapi.testclient import TestClient
import pytest

from backend.auth.notebook import NotebookData
from backend.auth.store import engine_for
from backend.main import app


@pytest.fixture(params=["sqlite", "sqlite+libsql"])
def clients(tmp_path, monkeypatch, request):
    monkeypatch.setenv(
        "AUTH_DATABASE_URL", f"{request.param}:///{tmp_path}/notebooks.sqlite3"
    )
    monkeypatch.setenv(
        "AUTH_JWT_SECRET", "notebook-test-only-key-at-least-32-characters"
    )
    monkeypatch.setenv("AUTH_FRONTEND_URL", "http://localhost:3000")
    for key in ["VERCEL", "APP_ENV", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]:
        monkeypatch.delenv(key, raising=False)
    browsers = [
        TestClient(app, headers={"Origin": "http://localhost:3000"}) for _ in range(2)
    ]
    for index, browser in enumerate(browsers):
        response = browser.post(
            "/auth/signup",
            json={
                "email": f"learner{index}@example.com",
                "display_name": "Learner",
                "password": "long notebook test passphrase",
            },
        )
        assert response.status_code == 201, response.text
    yield browsers
    for browser in browsers:
        browser.close()
    engine_for.cache_clear()


def save(browser, data, revision=0, owner=None):
    owner = owner or browser.get("/auth/me").json()["user"]["id"]
    return browser.post(
        "/auth/notebook",
        json={"owner_id": owner, "revision": revision, "notebook": data},
    )


def test_complete_notebook_restored_in_new_session(clients):
    first, _ = clients
    notebook = NotebookData(
        completed_lessons=["qubit"],
        tasks_passed=["flip"],
        quiz_answers={"qubit": 2},
        lesson_max_stage={"qubit": 5},
        notes={"qubit": "My margin note"},
        reflections={"qubit": "My explanation"},
        code_attempts={"flip": "qc.x(0)"},
        selected_lesson=2,
        learning_stage=4,
        reading_mode="plain",
    ).model_dump()
    response = save(first, notebook)
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == 1
    with TestClient(app) as other_device:
        login = other_device.post(
            "/auth/login",
            json={
                "email": "learner0@example.com",
                "password": "long notebook test passphrase",
            },
        )
        assert login.status_code == 200
        loaded = other_device.get("/auth/notebook")
        assert loaded.status_code == 200
        assert loaded.json()["notebook"] == notebook
        assert loaded.headers["cache-control"] == "private, no-store"


def test_no_guest_access_or_cross_account_reads_and_writes(clients):
    alice, bob = clients
    assert TestClient(app).get("/auth/notebook").status_code == 401
    saved = save(alice, {"notes": {"qubit": "Private Alice note"}}).json()
    assert bob.get("/auth/notebook").json()["notebook"]["notes"] == {}
    assert (
        save(bob, {"notes": {"qubit": "Overwrite"}}, 1, saved["owner_id"]).status_code
        == 403
    )
    assert (
        alice.get("/auth/notebook").json()["notebook"]["notes"]["qubit"]
        == "Private Alice note"
    )


def test_stale_writes_and_simultaneous_initial_saves_return_current_notebook(clients):
    alice, _ = clients
    first = save(alice, {"notes": {"qubit": "Device one"}})
    assert first.status_code == 200
    race = save(alice, {"notes": {"qubit": "Device two"}})
    assert race.status_code == 409
    assert race.json()["revision"] == 1
    assert race.json()["notebook"]["notes"]["qubit"] == "Device one"
    current = save(alice, {"notes": {"qubit": "Merged by user"}}, 1)
    assert current.status_code == 200 and current.json()["revision"] == 2
    assert save(alice, {"notes": {"qubit": "Stale device"}}, 1).status_code == 409
    assert (
        alice.get("/auth/notebook").json()["notebook"]["notes"]["qubit"]
        == "Merged by user"
    )


def test_notebook_validation_and_total_size_limit(clients):
    alice, _ = clients
    assert save(alice, {"version": 2}).status_code == 422
    assert save(alice, {"notes": {"qubit": "x" * 20001}}).status_code == 422
    assert save(alice, {"learning_stage": 99}).status_code == 422
    assert save(alice, {"quiz_answers": {"qubit": True}}).status_code == 422
    assert (
        save(alice, {"notes": {str(i): "x" * 20000 for i in range(51)}}).status_code
        == 413
    )
    assert alice.get("/auth/notebook").json()["revision"] == 0


def test_revoked_session_cannot_save_and_cross_origin_is_rejected(clients):
    alice, _ = clients
    owner = alice.get("/auth/me").json()["user"]["id"]
    rejected = alice.post(
        "/auth/notebook",
        json={"owner_id": owner, "revision": 0, "notebook": {}},
        headers={"Origin": "https://attacker.example"},
    )
    assert rejected.status_code == 403
    assert alice.post("/auth/logout").status_code == 200
    assert save(alice, {}, owner=owner).status_code == 401
