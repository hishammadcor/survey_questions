from __future__ import annotations

import os
import csv
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse, JSONResponse

# Configuration
PORT = int(os.getenv("PORT", "8000"))
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parent / "data")).resolve()
SESSIONS_DIR = DATA_DIR / "sessions"
RESULTS_CSV = DATA_DIR / "results.csv"

SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)


def sanitize_id(value: str) -> str:
    return "".join([ch for ch in str(value or "") if ch.isalnum() or ch in ["_", "-"]])[:64]


def write_csv_header_if_needed() -> None:
    if not RESULTS_CSV.exists():
        header = [
            "participant_id",
            "timestamp",
            "index",
            "manifest_index",
            "audio",
            "label",
            "filename",
            "response",
        ]
        RESULTS_CSV.write_text(",".join(header) + "\n", encoding="utf-8")


def to_csv_value(value: Any) -> str:
    if value is None:
        return ""
    s = str(value)
    if any(c in s for c in ['"', ",", "\n"]):
        s = '"' + s.replace('"', '""') + '"'
    return s


def append_new_responses_to_csv(previous_len: int, responses: List[Dict[str, Any]]) -> None:
    write_csv_header_if_needed()
    new_rows = responses[previous_len:]
    if not new_rows:
        return
    lines = []
    for row in new_rows:
        fields = [
            row.get("participant_id"),
            row.get("timestamp"),
            row.get("index"),
            row.get("manifest_index"),
            row.get("audio"),
            row.get("label"),
            row.get("filename"),
            row.get("response"),
        ]
        lines.append(",".join(to_csv_value(f) for f in fields))
    with RESULTS_CSV.open("a", encoding="utf-8", newline="") as f:
        for line in lines:
            f.write(line + "\n")


class Session(BaseModel):
    participant_id: str
    order: Optional[List[int]] = None
    responses: List[Dict[str, Any]] = Field(default_factory=list)
    index: int = 0
    completed: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class EnsureSessionRequest(BaseModel):
    participant_id: str


class ProgressRequest(BaseModel):
    participant_id: str
    order: Optional[List[int]] = None
    responses: Optional[List[Dict[str, Any]]] = None
    index: Optional[int] = None
    completed: Optional[bool] = None


app = FastAPI(title="Survey API", version="1.0.0", openapi_url="/api/openapi.json", docs_url="/api/docs")

# Allow public access (configure allowed origins as needed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def session_path_for(pid: str) -> Path:
    return SESSIONS_DIR / f"{pid}.json"


def read_session(pid: str) -> Optional[Session]:
    p = session_path_for(pid)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return Session(**data)
    except Exception:
        return None


def write_session(data: Session) -> None:
    p = session_path_for(data.participant_id)
    p.write_text(json.dumps(data.dict(), ensure_ascii=False, indent=2), encoding="utf-8")


@app.post("/api/session")
def ensure_session(payload: EnsureSessionRequest) -> Dict[str, Any]:
    pid = sanitize_id(payload.participant_id)
    if not pid:
        raise HTTPException(status_code=400, detail="participant_id required")
    existing = read_session(pid)
    if existing is None:
        # Create a fresh session shell
        new_session = Session(
            participant_id=pid,
            order=None,
            responses=[],
            index=0,
            completed=False,
            created_at=__import__("datetime").datetime.utcnow().isoformat() + "Z",
            updated_at=__import__("datetime").datetime.utcnow().isoformat() + "Z",
        )
        write_session(new_session)
    return {"ok": True, "participant_id": pid}


@app.get("/api/session/{pid}")
def load_session(pid: str) -> Session:
    pid_s = sanitize_id(pid)
    s = read_session(pid_s)
    if s is None:
        raise HTTPException(status_code=404, detail="not found")
    return s


@app.post("/api/progress")
def save_progress(payload: ProgressRequest) -> Dict[str, Any]:
    pid = sanitize_id(payload.participant_id)
    if not pid:
        raise HTTPException(status_code=400, detail="participant_id required")

    previous = read_session(pid) or Session(participant_id=pid)
    prev_len = len(previous.responses or [])

    updated = Session(
        participant_id=pid,
        order=payload.order if payload.order is not None else previous.order,
        responses=payload.responses if payload.responses is not None else (previous.responses or []),
        index=payload.index if payload.index is not None else previous.index,
        completed=bool(payload.completed) or previous.completed,
        created_at=previous.created_at or __import__("datetime").datetime.utcnow().isoformat() + "Z",
        updated_at=__import__("datetime").datetime.utcnow().isoformat() + "Z",
    )

    # Persist JSON
    write_session(updated)

    # Append only new responses to CSV
    try:
        append_new_responses_to_csv(prev_len, updated.responses or [])
    except Exception:
        pass

    return {"ok": True}


@app.get("/api/results.json")
def results_json() -> JSONResponse:
    try:
        sessions: List[Session] = []
        for file in SESSIONS_DIR.glob("*.json"):
            try:
                data = json.loads(file.read_text(encoding="utf-8"))
                sessions.append(Session(**data))
            except Exception:
                continue
        # Return as plain dicts
        return JSONResponse({"sessions": [s.dict() for s in sessions]})
    except Exception:
        raise HTTPException(status_code=500, detail="failed_to_read_results")


@app.get("/api/results.csv")
def results_csv() -> StreamingResponse:
    try:
        write_csv_header_if_needed()
        def iterfile():
            with RESULTS_CSV.open("rb") as f:
                yield from f
        return StreamingResponse(iterfile(), media_type="text/csv; charset=utf-8")
    except Exception:
        raise HTTPException(status_code=500, detail="")


# Note: To run locally: uvicorn main:app --host 0.0.0.0 --port 8000