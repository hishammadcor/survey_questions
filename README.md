## Audio-Text Matching Evaluation Survey

A self-contained static web app that presents audio (.wav) and sentences (.lab) for evaluators to judge whether they match.

### Features
- Automatic discovery of ~123 .wav/.lab pairs via `alpha_data/manifest.json`
- Per-participant anonymous ID, deterministic randomized order
- Server-side save/resume of progress and responses via FastAPI
- On-demand audio loading, mobile-friendly responsive UI
- Server export endpoints: JSON and CSV

### Folder structure
```
audio-text-matching-survey/
├─ index.html
├─ styles.css
├─ script.js
├─ config.js
├─ alpha_data/
│  ├─ manifest.json        # generated
│  ├─ file1.wav
│  ├─ file1.lab
│  └─ ...
└─ server/
   ├─ main.py              # FastAPI app
   └─ requirements.txt
```

### Prepare data
Place your `.wav` and `.lab` files in `alpha_data/`. Then generate the manifest:

```bash
python3 tools/generate_manifest.py alpha_data
```

### Run locally (static site + API)
- Start the API:
  ```bash
  cd server
  python3 -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8000
  # API at http://localhost:8000/api
  ```
- Serve the static site in another terminal (any static server):
  ```bash
  # from repo root
  python3 -m http.server 8080
  # open http://localhost:8080/
  # or point the client to the API via URL param:
  # http://localhost:8080/?api=http://localhost:8000/api
  ```

### API endpoints
- `POST /api/session` -> `{ ok: true, participant_id }`
- `GET  /api/session/{participant_id}` -> session JSON
- `POST /api/progress` -> `{ ok: true }`
- `GET  /api/results.json` -> `{ sessions: [...] }`
- `GET  /api/results.csv` -> CSV stream

Sessions are stored as JSON under `server/data/sessions/`. A cumulative CSV is maintained at `server/data/results.csv`.

### Configure the client
Point the web app to your API by editing `config.js`:
```js
window.SURVEY_CONFIG = { apiBase: 'https://your-server-host/api' };
```
Or append `?api=https://your-server-host/api` to the page URL.

### Deploy options

- Render (free tier)
  - The included `render.yaml` deploys the FastAPI app from `server/`.
  - Once deployed, set `window.SURVEY_CONFIG.apiBase` to your Render URL + `/api`.

- Nginx reverse proxy (VM/VPS)
  1. Run the API with uvicorn:
     ```bash
     cd server && uvicorn main:app --host 127.0.0.1 --port 8000
     ```
  2. Example Nginx site config:
     ```nginx
     server {
       listen 80;
       server_name your.domain.example;

       # Serve static site from repo root
       root /var/www/audio-text-matching-survey;
       index index.html;

       location /api/ {
         proxy_pass http://127.0.0.1:8000/api/;
         proxy_http_version 1.1;
         proxy_set_header Upgrade $http_upgrade;
         proxy_set_header Connection "upgrade";
         proxy_set_header Host $host;
         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
         proxy_read_timeout 600s;
       }

       location / {
         try_files $uri $uri/ =404;
       }
     }
     ```
  3. Copy the repo contents (excluding `server/`) to `/var/www/audio-text-matching-survey`.
  4. Reload Nginx.

- Docker (optional)
  ```dockerfile
  FROM python:3.11-slim
  WORKDIR /app
  COPY server/requirements.txt /app/
  RUN pip install -r requirements.txt
  COPY server /app
  EXPOSE 8000
  CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
  ```

### Notes
- The API is configured with permissive CORS to allow cross-origin access. Tighten `allow_origins` in `server/main.py` for production.
- All server-side save/load is handled exclusively via FastAPI; no other persistence paths are used.