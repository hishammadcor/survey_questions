## Audio-Text Matching Evaluation Survey

A self-contained static web app that presents audio (.wav) and sentences (.lab) for evaluators to judge whether they match.

### Features
- Automatic discovery of ~123 .wav/.lab pairs via `alpha_data/manifest.json`
- Per-participant anonymous ID, deterministic randomized order, and auto-save/resume via `localStorage`
- On-demand audio loading, mobile-friendly responsive UI
- CSV export on completion (`results_<participant_id>.csv`)
- No login; hostable on GitHub Pages or any static server

### Folder structure
```
audio-text-matching-survey/
├─ index.html
├─ styles.css
├─ script.js
├─ alpha_data/
│  ├─ manifest.json        # generated
│  ├─ file1.wav
│  ├─ file1.lab
│  └─ ...
└─ tools/
   └─ generate_manifest.py
```

### Prepare data
Place your `.wav` and `.lab` files in `alpha_data/`. Then generate the manifest:

```bash
python3 tools/generate_manifest.py alpha_data
```

This creates `alpha_data/manifest.json` like:

```json
[
  {
    "id": "file1",
    "audio": "alpha_data/file1.wav",
    "label": "The sentence from file1.lab",
    "filename": "file1.wav"
  }
]
```

Notes:
- `.lab` content is read as UTF-8 (invalid bytes ignored). The first non-empty line is used.
- Only `.wav` files are enumerated; `.lab` is optional but recommended.

### Run locally
Use any static server. Examples:

- Python:
  ```bash
  cd audio-text-matching-survey
  python3 -m http.server 8080
  # open http://localhost:8080/
  ```
- Node (serve):
  ```bash
  npx serve -p 8080 .
  ```

### Deploy (GitHub Pages)
- Push this folder to a GitHub repo root
- Enable Pages (settings → Pages → Deploy from branch → `main` root)
- Visit the public URL to start the survey

### Resetting local progress
Click “Reset survey” in the footer. This clears stored participant ID, randomized order, responses, and current index.

### CSV columns
- `participant_id`
- `timestamp` (ISO-8601)
- `index` (0-based position shown)
- `manifest_index` (index within manifest)
- `audio` (path)
- `label` (sentence)
- `filename` (audio filename)
- `response` (Yes | No | Not Sure)

### Server-side saving (new)
A minimal Node/Express server is included to store progress and maintain a CSV on the server.

- Start the server and static site together:
  ```bash
  cd audio-text-matching-survey/server
  npm install
  npm start
  # open http://localhost:3000/
  ```
- Resume links include a `sid` parameter, e.g. `http://localhost:3000/?sid=<participant_id>`
- The server stores per-session JSON in `server/data/sessions/` and appends CSV rows to `server/data/results.csv` on every progress update.

Deploy the server to any Node host (Render, Fly.io, Railway, etc.), then serve the static app from the same server for simplicity.

### Optional: GitHub mirroring (server)
Set the following environment variables where the server runs to mirror sessions and a cumulative CSV to a GitHub repo. This keeps data versioned and easy to analyze.

- `GITHUB_TOKEN`: Personal access token with contents: read/write for the target repo
- `GITHUB_REPO`: `owner/repo` (e.g., `hishammadcor/survey_questions`)
- `GITHUB_BRANCH`: Branch to write to (default: `main`)
- `GITHUB_DIR`: Base directory within the repo (default: `survey_data`)

Example (locally):
```bash
cd server
cp .env.example .env
# edit .env and set:
# GITHUB_TOKEN=github_pat_xxx
# GITHUB_REPO=hishammadcor/survey_questions
npm i
npm start
```

On each progress save, the server will attempt to write:
- `survey_data/sessions/<participant_id>.json`
- `survey_data/results.csv`

If the token or repo is not configured, the server continues to save locally.