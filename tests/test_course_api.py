"""Exercise the API used by the replacement frontend, with the real sandbox."""
from fastapi.testclient import TestClient

from backend.main import app
from frontend.learning_content import LESSONS

client = TestClient(app)


def test_complete_course_without_reference_solutions():
    response = client.get("/course")
    assert response.status_code == 200
    data = response.json()
    assert [lesson["id"] for lesson in data["lessons"]] == [lesson["id"] for lesson in LESSONS]
    assert all("solution" not in lesson["code_task"] for lesson in data["lessons"])


def test_checker_uses_published_reference():
    lesson = LESSONS[0]
    success = client.post("/course/exercise", json={"lesson_id": lesson["id"], "code": lesson["code_task"]["solution"]})
    assert success.status_code == 200
    assert success.json()["passed"]
    failure = client.post("/course/exercise", json={"lesson_id": lesson["id"], "code": lesson["code_task"]["starter"]})
    assert not failure.json()["passed"]


def test_unknown_lesson_and_oversize_input():
    assert client.post("/course/exercise", json={"lesson_id": "missing", "code": ""}).status_code == 404
    assert client.post("/course/exercise", json={"lesson_id": "qubit", "code": "x" * 20001}).status_code == 422
    assert client.post("/course/reflect", json={"lesson_id": "missing", "text": ""}).status_code == 404


def test_reflection_uses_original_rubric():
    result = client.post("/course/reflect", json={"lesson_id": "qubit", "text": "Repeat measurement many times to estimate probabilities."})
    assert result.status_code == 200
    assert result.json()["covered"]
    assert result.json()["markdown"]


def test_routing_inserts_gates_for_nonadjacent_qubits():
    line = client.post("/course/routing", json={"circuit": "far", "topology": "line"})
    full = client.post("/course/routing", json={"circuit": "far", "topology": "full"})
    assert line.status_code == full.status_code == 200
    assert line.json()["cx_after"] > full.json()["cx_after"]
    assert client.post("/course/routing", json={"circuit": "missing", "topology": "line"}).status_code == 422


def test_author_export_keeps_server_reference(monkeypatch, tmp_path):
    import json
    from backend.core import course_content

    lesson = dict(LESSONS[0])
    lesson["code_task"] = {key: value for key, value in lesson["code_task"].items() if key != "solution"}
    path = tmp_path / "site_content.json"
    path.write_text(json.dumps({"lessons": [lesson]}), encoding="utf-8")
    monkeypatch.setattr(course_content, "CONTENT_PATH", path)
    restored = course_content.find_lesson(lesson["id"])
    assert restored["code_task"]["solution"] == LESSONS[0]["code_task"]["solution"]


def test_vercel_entrypoint_exports_fastapi():
    from app import app as deployed_app
    assert deployed_app is app


def test_routing_failure_returns_json_without_exposing_internal_error(monkeypatch):
    from backend.core import routing

    def fail(*args):
        raise RuntimeError("internal filesystem path or native library failure")

    monkeypatch.setattr(routing, "route_circuit", fail)
    result = client.post("/course/routing", json={"circuit": "near", "topology": "line"})
    assert result.status_code == 503
    assert "temporarily unavailable" in result.json()["detail"]
    assert "filesystem" not in result.text
