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