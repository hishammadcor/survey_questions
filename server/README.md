# Survey API (FastAPI)

## Run
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

- API root: `/api`
- Data directory: `DATA_DIR` env var (default: `server/data`)

## Endpoints
- POST `/api/session`
- GET  `/api/session/{participant_id}`
- POST `/api/progress`
- GET  `/api/results.json`
- GET  `/api/results.csv`

## Notes
- CORS is enabled for all origins by default; tighten for production.