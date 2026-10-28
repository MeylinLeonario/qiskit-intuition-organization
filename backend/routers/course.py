"""Course endpoints; reference exercise solutions remain on the server."""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.course_content import course_content, find_lesson
from backend.core.exercise_checker import check_code_task
from backend.core.explanation_review import review_explanation

router = APIRouter(prefix="/course")


def public_content() -> dict:
    content = course_content()
    for lesson in content["lessons"]:
        lesson.get("code_task", {}).pop("solution", None)
    return content


@router.get("")
def get_course():
    return public_content()


class ExerciseRequest(BaseModel):
    lesson_id: str = Field(max_length=80)
    code: str = Field(max_length=20000)


class ReflectionRequest(BaseModel):
    lesson_id: str = Field(max_length=80)
    text: str = Field(max_length=20000)


def require_lesson(lesson_id: str) -> dict:
    lesson = find_lesson(lesson_id)
    if lesson is None:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return lesson


@router.post("/exercise")
def check_exercise(req: ExerciseRequest):
    lesson = require_lesson(req.lesson_id)
    if not lesson.get("code_task"):
        raise HTTPException(status_code=404, detail="Exercise not found")
    return check_code_task(req.code, lesson["code_task"])


@router.post("/reflect")
def reflect(req: ReflectionRequest):
    return review_explanation(req.text, require_lesson(req.lesson_id))


class RoutingRequest(BaseModel):
    circuit: str
    topology: str


@router.post("/routing")
def routing(req: RoutingRequest):
    from backend.core.routing import ROUTING_CIRCUITS, route_circuit
    names = dict(zip(["near", "far", "star"], ROUTING_CIRCUITS))
    if req.circuit not in names or req.topology not in {"line", "full"}:
        raise HTTPException(status_code=422, detail="Unknown circuit or topology")
    try:
        return route_circuit(names[req.circuit], "Line" if req.topology == "line" else "Full")
    except Exception:
        logging.getLogger(__name__).exception("Hardware transpilation failed")
        raise HTTPException(status_code=503, detail="Circuit compilation is temporarily unavailable. Please try again shortly.") from None
