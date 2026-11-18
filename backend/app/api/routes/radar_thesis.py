# Nuvos Radar 2.0 — Fase 7 "Mi tesis": guardado privado real.
# SQL: ver backend/migrations/127_user_radar_theses.sql (no aplicada aún).
#
# Solo requiere sesión real autenticada (get_current_user_id) — no
# get_current_user_id, no el gate de admin — cualquier usuario puede
# guardar su propia tesis, nunca la de otro. user_id nunca viaja en el
# payload del cliente, solo se deriva del token verificado.

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import get_current_user_id
from app.services import radar_thesis_service as svc

router = APIRouter(prefix="/radar/thesis", tags=["radar-thesis"])


class ThesisAnswersPayload(BaseModel):
    q1: str | None = None
    q2: list[str] = Field(default_factory=list)
    q3: list[str] = Field(default_factory=list)
    q4: str | None = None
    q5: list[str] = Field(default_factory=list)
    q5Own: str = ""
    q6: str | None = None


@router.get("/{ticker}")
async def get_my_thesis(ticker: str, user_id: str = Depends(get_current_user_id)):
    row = await svc.get_thesis(user_id, ticker)
    if row is None:
        return {"exists": False, "answers": None, "updated_at": None}
    return {
        "exists": True,
        "answers": row.get("answers"),
        "schema_version": row.get("schema_version"),
        "updated_at": row.get("updated_at"),
    }


@router.put("/{ticker}")
async def save_my_thesis(
    ticker: str,
    payload: ThesisAnswersPayload,
    user_id: str = Depends(get_current_user_id),
):
    row = await svc.save_thesis(user_id, ticker, payload.model_dump())
    return {
        "exists": True,
        "answers": row.get("answers"),
        "schema_version": row.get("schema_version"),
        "updated_at": row.get("updated_at"),
    }
