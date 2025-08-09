/*
Audio-Text Matching Evaluation Survey logic
- Loads alpha_data/manifest.json which lists items [{id, audio, label, filename}]
- Creates an anonymous participant ID and persists it
- Randomizes order per participant and persists progress
- Loads audio on demand and displays sentence
- Saves response after every click (localStorage)
- On completion, triggers CSV download
*/

const MANIFEST_CANDIDATES = [
  'alpha_data/manifest.json',       // within app folder
  '../alpha_data/manifest.json',    // repo root alpha_data when app is nested
  '/alpha_data/manifest.json'       // absolute root
];
const STORAGE_KEYS = {
  participantId: 'atm_participant_id',
  order: 'atm_order',
  responses: 'atm_responses',
  index: 'atm_index'
};

function $(id) { return document.getElementById(id); }

function generateParticipantId() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 9; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

function shuffleArray(seed, array) {
  // Deterministic shuffle using seed; for simplicity use Math.random with seeded LCG
  let a = array.slice();
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 33 + seed.charCodeAt(i)) >>> 0;
  let state = (s ^ 0x9e3779b9) >>> 0;
  function rand() {
    state = (state * 1664525 + 1013904223) >>> 0; // LCG
    return state / 0x100000000;
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function tryLoadJSON(paths) {
  // Try to fetch JSON from the first path that returns ok
  return new Promise(async (resolve, reject) => {
    let lastError = null;
    for (const path of paths) {
      try {
        const res = await fetch(path, { cache: 'no-store' });
        if (!res.ok) { lastError = new Error(`Failed to load ${path}: ${res.status}`); continue; }
        const data = await res.json();
        return resolve({ data, pathUsed: path });
      } catch (e) {
        lastError = e;
      }
    }
    reject(lastError || new Error('No manifest found'));
  });
}

function saveLocal(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function loadLocal(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function showError(message) {
  const el = $('errorBlock');
  el.textContent = message;
  el.classList.remove('hidden');
}

function updateHeader(participantId, currentIndex, total) {
  $('participantInfo').textContent = `Participant: ${participantId}`;
  $('progress').textContent = total > 0 ? `Progress: ${currentIndex + 1} / ${total}` : '';
}

function buildQuestionText(filename) {
  return `Does the following sentence match what you heard in the audio: ${filename}?`;
}

async function init() {
  try {
    const participantId = loadLocal(STORAGE_KEYS.participantId, null) || generateParticipantId();
    saveLocal(STORAGE_KEYS.participantId, participantId);

    const { data: manifest } = await tryLoadJSON(MANIFEST_CANDIDATES);
    if (!Array.isArray(manifest) || manifest.length === 0) {
      throw new Error('Manifest is empty or invalid.');
    }

    let order = loadLocal(STORAGE_KEYS.order, null);
    if (!order) {
      const indices = manifest.map((_, idx) => idx);
      order = shuffleArray(participantId, indices);
      saveLocal(STORAGE_KEYS.order, order);
    }

    let index = loadLocal(STORAGE_KEYS.index, 0);
    let responses = loadLocal(STORAGE_KEYS.responses, []);

    $('loading').classList.add('hidden');
    $('questionBlock').classList.remove('hidden');

    updateHeader(participantId, Math.min(index, order.length - 1), order.length);

    const audio = $('audioPlayer');
    const sentenceText = $('sentenceText');
    const questionText = $('questionText');

    async function renderCurrent() {
      if (index >= order.length) {
        $('questionBlock').classList.add('hidden');
        $('doneBlock').classList.remove('hidden');
        triggerCsvDownload(participantId, manifest, responses);
        return;
      }
      const manifestIdx = order[index];
      const item = manifest[manifestIdx];
      const filename = item.filename || (item.audio?.split('/')?.pop() || 'audio.wav');

      questionText.textContent = buildQuestionText(filename);
      sentenceText.textContent = item.label || '';
      audio.src = item.audio;
      audio.load();

      updateHeader(participantId, index, order.length);
    }

    function record(responseLabel) {
      const nowIso = new Date().toISOString();
      const manifestIdx = order[index];
      const item = manifest[manifestIdx];
      const row = {
        participant_id: participantId,
        timestamp: nowIso,
        index: index,
        manifest_index: manifestIdx,
        audio: item.audio,
        label: item.label,
        filename: item.filename || '',
        response: responseLabel
      };
      responses.push(row);
      saveLocal(STORAGE_KEYS.responses, responses);
      index += 1;
      saveLocal(STORAGE_KEYS.index, index);
      renderCurrent();
    }

    $('btnYes').addEventListener('click', () => record('Yes'));
    $('btnNo').addEventListener('click', () => record('No'));
    $('btnUnsure').addEventListener('click', () => record('Not Sure'));

    $('downloadAgain').addEventListener('click', () => {
      triggerCsvDownload(participantId, manifest, responses);
    });

    $('resetBtn').addEventListener('click', () => {
      if (confirm('This will clear your local progress and reload the survey. Continue?')) {
        localStorage.removeItem(STORAGE_KEYS.participantId);
        localStorage.removeItem(STORAGE_KEYS.order);
        localStorage.removeItem(STORAGE_KEYS.responses);
        localStorage.removeItem(STORAGE_KEYS.index);
        location.reload();
      }
    });

    await renderCurrent();
  } catch (err) {
    console.error(err);
    showError(err.message || 'Failed to initialize survey.');
  }
}

function toCsvValue(value) {
  if (value == null) return '';
  const str = String(value);
  if (/[,"\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function rowsToCsv(rows) {
  const header = [
    'participant_id', 'timestamp', 'index', 'manifest_index', 'audio', 'label', 'filename', 'response'
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    const values = header.map(k => toCsvValue(row[k]));
    lines.push(values.join(','));
  }
  return lines.join('\n');
}

function triggerCsvDownload(participantId, manifest, responses) {
  const filename = `results_${participantId}.csv`;
  const csv = rowsToCsv(responses);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

window.addEventListener('DOMContentLoaded', init);