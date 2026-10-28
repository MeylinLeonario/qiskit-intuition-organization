"""Published curriculum shared by the API, web export and legacy client."""
from copy import deepcopy
import json
from pathlib import Path

from frontend.learning_content import GLOSSARY, LESSONS, PRACTICE, PRESETS, UNITS

CONTENT_PATH = Path(__file__).resolve().parents[2] / "frontend" / "site_content.json"


def course_content() -> dict:
    overrides = json.loads(CONTENT_PATH.read_text(encoding="utf-8"))
    lessons = deepcopy(overrides.get("lessons") or LESSONS)
    defaults = {lesson["id"]: lesson for lesson in LESSONS}
    for lesson in lessons:
        original = defaults.get(lesson["id"], {})
        if "solution" not in lesson.get("code_task", {}) and original.get("code_task"):
            lesson["code_task"] = {**original["code_task"], **lesson.get("code_task", {})}
    return {
        "brand": overrides.get("brand", {"name": "Qiskit Intuition"}),
        "lessons": lessons,
        "units": UNITS,
        "presets": PRESETS,
        "practice": PRACTICE,
        "glossary": GLOSSARY,
    }


def find_lesson(lesson_id: str) -> dict | None:
    return next((lesson for lesson in course_content()["lessons"] if lesson["id"] == lesson_id), None)
