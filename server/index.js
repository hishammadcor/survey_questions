import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const RESULTS_CSV = path.join(DATA_DIR, 'results.csv');

// Optional GitHub mirroring configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || '';// format: owner/repo
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_DIR = process.env.GITHUB_DIR || 'survey_data';

fs.mkdirSync(SESSIONS_DIR, { recursive: true });

app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));

// Static site
app.use(express.static(ROOT));

function sanitizeId(id) { return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64); }

function writeCsvHeaderIfNeeded() {
  if (!fs.existsSync(RESULTS_CSV)) {
    const header = [
      'participant_id', 'timestamp', 'index', 'manifest_index', 'audio', 'label', 'filename', 'response'
    ].join(',') + '\n';
    fs.writeFileSync(RESULTS_CSV, header, 'utf8');
  }
}

function toCsvValue(value) {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function appendNewResponsesToCsv(previousLen, responses) {
  writeCsvHeaderIfNeeded();
  const rows = responses.slice(previousLen);
  if (rows.length === 0) return;
  const lines = rows.map(row => [
    'participant_id','timestamp','index','manifest_index','audio','label','filename','response'
  ].map(k => toCsvValue(row[k])).join(',')).join('\n') + '\n';
  fs.appendFileSync(RESULTS_CSV, lines, 'utf8');
}

async function githubIsConfigured() {
  return !!(GITHUB_TOKEN && GITHUB_REPO);
}

async function githubGetFileSha(repoPath) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(repoPath)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json' } });
  if (res.status === 200) {
    const json = await res.json();
    return json.sha || null;
  }
  return null;
}

async function githubPutFile(repoPath, contentUtf8, message) {
  const contentB64 = Buffer.from(contentUtf8, 'utf8').toString('base64');
  const sha = await githubGetFileSha(repoPath);
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(repoPath)}`;
  const body = { message, content: contentB64, branch: GITHUB_BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`GitHub update failed: ${res.status} ${errText}`);
  }
}

async function mirrorToGitHub(updatedSession, resultsCsvPath) {
  if (!(await githubIsConfigured())) return;
  const pid = updatedSession.participant_id;
  const sessionRelPath = `${GITHUB_DIR}/sessions/${pid}.json`;
  const resultsRelPath = `${GITHUB_DIR}/results.csv`;
  const sessionContent = JSON.stringify(updatedSession, null, 2);
  const resultsContent = fs.readFileSync(resultsCsvPath, 'utf8');
  await githubPutFile(sessionRelPath, sessionContent, `Update session ${pid}`);
  await githubPutFile(resultsRelPath, resultsContent, `Update results.csv (session ${pid})`);
}

app.post('/api/session', (req, res) => {
  const pid = sanitizeId(req.body?.participant_id || '');
  if (!pid) return res.status(400).json({ error: 'participant_id required' });
  const sessionPath = path.join(SESSIONS_DIR, pid + '.json');
  if (!fs.existsSync(sessionPath)) {
    const payload = { participant_id: pid, order: null, responses: [], index: 0, completed: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    fs.writeFileSync(sessionPath, JSON.stringify(payload, null, 2), 'utf8');
  }
  return res.json({ ok: true, participant_id: pid });
});

app.get('/api/session/:id', (req, res) => {
  const pid = sanitizeId(req.params.id);
  const sessionPath = path.join(SESSIONS_DIR, pid + '.json');
  if (!fs.existsSync(sessionPath)) return res.status(404).json({ error: 'not found' });
  const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  return res.json(data);
});

app.post('/api/progress', (req, res) => {
  const body = req.body || {};
  const pid = sanitizeId(body.participant_id || '');
  if (!pid) return res.status(400).json({ error: 'participant_id required' });
  const sessionPath = path.join(SESSIONS_DIR, pid + '.json');
  const previous = fs.existsSync(sessionPath) ? JSON.parse(fs.readFileSync(sessionPath, 'utf8')) : { participant_id: pid, order: null, responses: [], index: 0, completed: false };
  const prevLen = Array.isArray(previous.responses) ? previous.responses.length : 0;

  const order = Array.isArray(body.order) ? body.order : previous.order;
  const responses = Array.isArray(body.responses) ? body.responses : previous.responses;
  const index = typeof body.index === 'number' ? body.index : previous.index;
  const completed = !!body.completed || previous.completed;

  const updated = { participant_id: pid, order, responses, index, completed, updated_at: new Date().toISOString(), created_at: previous.created_at || new Date().toISOString() };
  fs.writeFileSync(sessionPath, JSON.stringify(updated, null, 2), 'utf8');

  try { appendNewResponsesToCsv(prevLen, responses); } catch (e) { /* ignore */ }

  // Fire-and-forget GitHub mirroring
  mirrorToGitHub(updated, RESULTS_CSV).catch(() => {});

  return res.json({ ok: true });
});

// Simple analytics/export endpoints
app.get('/api/results.json', (req, res) => {
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
    const sessions = files.map(f => JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8')));
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_read_results' });
  }
});

app.get('/api/results.csv', (req, res) => {
  try {
    writeCsvHeaderIfNeeded();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const stream = fs.createReadStream(RESULTS_CSV, 'utf8');
    stream.pipe(res);
  } catch (e) {
    res.status(500).send('');
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});