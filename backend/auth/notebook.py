"""Versioned per-user course notebooks, persisted in the account database."""

import json
import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import update
from sqlalchemy.dialects.sqlite import insert

from backend.auth.store import UserNotebook, database
from backend.routers.auth import AccountRoute, current_identity, origin_check

MAX_NOTEBOOK_BYTES = 1_000_000
Key = Annotated[str, StringConstraints(max_length=80)]
Text = Annotated[str, StringConstraints(max_length=20000)]
Quiz = Annotated[int, Field(ge=0, le=20, strict=True)]
Stage = Annotated[int, Field(ge=0, le=5, strict=True)]


class NotebookData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    completed_lessons: list[Key] = Field(default_factory=list, max_length=200)
    tasks_passed: list[Key] = Field(default_factory=list, max_length=200)
    quiz_answers: dict[Key, Quiz] = Field(default_factory=dict, max_length=200)
    lesson_max_stage: dict[Key, Stage] = Field(default_factory=dict, max_length=200)
    notes: dict[Key, Text] = Field(default_factory=dict, max_length=200)
    reflections: dict[Key, Text] = Field(default_factory=dict, max_length=200)
    code_attempts: dict[Key, Text] = Field(default_factory=dict, max_length=200)
    selected_lesson: int = Field(default=0, ge=0, le=199, strict=True)
    learning_stage: Stage = 0
    reading_mode: Literal["plain", "notebook"] = "notebook"


class NotebookWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # This is an account-switch guard, never an authorization mechanism.
    owner_id: str = Field(min_length=1, max_length=64)
    revision: int = Field(ge=0, strict=True)
    notebook: NotebookData


router = APIRouter(
    prefix="/auth/notebook",
    tags=["notebook"],
    route_class=AccountRoute,
    dependencies=[Depends(origin_check)],
)


def snapshot(user_id: str, record: UserNotebook | None):
    return {
        "owner_id": user_id,
        "notebook": json.loads(record.payload)
        if record
        else NotebookData().model_dump(),
        "revision": record.revision if record else 0,
        "updated_at": record.updated_at if record else None,
    }


@router.get("")
def read_notebook(response: Response, identity=Depends(current_identity)):
    user, _ = identity
    response.headers["Cache-Control"] = "private, no-store"
    with database() as session:
        return snapshot(user.id, session.get(UserNotebook, user.id))


@router.post("")
def write_notebook(
    req: NotebookWrite, response: Response, identity=Depends(current_identity)
):
    user, _ = identity
    if req.owner_id != user.id:
        raise HTTPException(
            403, "The signed-in account changed. Reload your notebook before saving."
        )
    payload = req.notebook.model_dump()
    payload["completed_lessons"] = list(dict.fromkeys(payload["completed_lessons"]))
    payload["tasks_passed"] = list(dict.fromkeys(payload["tasks_passed"]))
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(serialized.encode("utf-8")) > MAX_NOTEBOOK_BYTES:
        raise HTTPException(
            413,
            "Your notebook is too large to sync. Download a backup and shorten its contents.",
        )
    now = int(time.time())
    with database() as session:
        if req.revision == 0:
            result = session.execute(
                insert(UserNotebook)
                .values(user_id=user.id, payload=serialized, revision=1, updated_at=now)
                .on_conflict_do_nothing(index_elements=[UserNotebook.user_id])
            )
        else:
            result = session.execute(
                update(UserNotebook)
                .where(
                    UserNotebook.user_id == user.id,
                    UserNotebook.revision == req.revision,
                )
                .values(payload=serialized, revision=req.revision + 1, updated_at=now)
            )
        record = session.get(UserNotebook, user.id)
        data = snapshot(user.id, record)
        if result.rowcount != 1:
            return JSONResponse(
                {
                    "detail": "This notebook changed on another device. Merge before saving.",
                    **data,
                },
                status_code=409,
                headers={"Cache-Control": "private, no-store"},
            )
        response.headers["Cache-Control"] = "private, no-store"
        return data
