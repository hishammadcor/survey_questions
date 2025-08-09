import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const RESULTS_CSV = path.join(DATA_DIR, 'results.csv');

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

  return res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});