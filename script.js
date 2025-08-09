/*
Audio-Text Matching Evaluation Survey logic
- Loads alpha_data/manifest.json which lists items [{id, audio, label, filename}]
- Creates an anonymous participant ID and persists it
- Randomizes order per participant and persists progress
- Loads audio on demand and displays sentence
- Saves response after every click (localStorage and server)
- On completion, saves to server (no client CSV)
*/

const MANIFEST_CANDIDATES = [
  'alpha_data/manifest.json',
  '../alpha_data/manifest.json',
  '/alpha_data/manifest.json'
];
const STORAGE_KEYS = {
  participantId: 'atm_participant_id',
  order: 'atm_order',
  responses: 'atm_responses',
  index: 'atm_index',
  introSeen: 'atm_intro_seen'
};
const API_BASE = '/api';

function $(id) { return document.getElementById(id); }

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function generateParticipantId() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 9; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

function shuffleArray(seed, array) {
  let a = array.slice();
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 33 + seed.charCodeAt(i)) >>> 0;
  let state = (s ^ 0x9e3779b9) >>> 0;
  function rand() { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; }
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function tryLoadJSON(paths) {
  return new Promise(async (resolve, reject) => {
    let lastError = null;
    for (const path of paths) {
      try {
        const res = await fetch(path, { cache: 'no-store' });
        if (!res.ok) { lastError = new Error(`Failed to load ${path}: ${res.status}`); continue; }
        const data = await res.json();
        return resolve({ data, pathUsed: path });
      } catch (e) { lastError = e; }
    }
    reject(lastError || new Error('No manifest found'));
  });
}

function saveLocal(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function loadLocal(key, fallback) { const raw = localStorage.getItem(key); if (!raw) return fallback; try { return JSON.parse(raw); } catch { return fallback; } }

function showError(message) { const el = $('errorBlock'); el.textContent = message; el.classList.remove('hidden'); }
function updateHeader(participantId, currentIndex, total) { $('participantInfo').textContent = `Participant: ${participantId}`; $('progress').textContent = total > 0 ? `Progress: ${currentIndex + 1} / ${total}` : ''; }
function buildQuestionText(filename) { return `Does the following sentence match what you heard in the audio: ${filename}?`; }

async function apiEnsureSession(participantId) {
  try {
    const res = await fetch(`${API_BASE}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participant_id: participantId }) });
    if (!res.ok) throw new Error('Failed to ensure session');
    return await res.json();
  } catch { return null; }
}
async function apiLoadProgress(participantId) {
  try {
    const res = await fetch(`${API_BASE}/session/${encodeURIComponent(participantId)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function apiSaveProgress(state) {
  try {
    const res = await fetch(`${API_BASE}/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    if (!res.ok) throw new Error('Failed to save');
    return await res.json();
  } catch (e) { return null; }
}

async function init() {
  try {
    const sid = getQueryParam('sid');
    let participantId = sid || loadLocal(STORAGE_KEYS.participantId, null) || generateParticipantId();
    saveLocal(STORAGE_KEYS.participantId, participantId);

    await apiEnsureSession(participantId);

    const { data: manifest } = await tryLoadJSON(MANIFEST_CANDIDATES);
    if (!Array.isArray(manifest) || manifest.length === 0) { throw new Error('Manifest is empty or invalid.'); }

    let order = loadLocal(STORAGE_KEYS.order, null);
    let index = loadLocal(STORAGE_KEYS.index, 0);
    let responses = loadLocal(STORAGE_KEYS.responses, []);

    // Try loading server progress if sid present or local is empty
    const serverProgress = await apiLoadProgress(participantId);
    if (serverProgress && serverProgress.order && Array.isArray(serverProgress.order)) {
      order = serverProgress.order;
      index = typeof serverProgress.index === 'number' ? serverProgress.index : 0;
      responses = Array.isArray(serverProgress.responses) ? serverProgress.responses : [];
      saveLocal(STORAGE_KEYS.order, order);
      saveLocal(STORAGE_KEYS.index, index);
      saveLocal(STORAGE_KEYS.responses, responses);
      // Mark intro as seen if there is any progress recorded
      if ((serverProgress.index || 0) > 0 || (responses && responses.length > 0)) {
        saveLocal(STORAGE_KEYS.introSeen, true);
      }
    }

    if (!order) {
      const indices = manifest.map((_, idx) => idx);
      order = shuffleArray(participantId, indices);
      saveLocal(STORAGE_KEYS.order, order);
      // Best-effort: send initial order to server so resume works even before first answer
      try { await apiSaveProgress({ participant_id: participantId, order, responses, index }); } catch {}
    }

    const introSeen = !!loadLocal(STORAGE_KEYS.introSeen, false);

    const introBlock = $('introBlock');
    const beginBtn = $('beginBtn');

    $('loading').classList.add('hidden');

    function showIntro() {
      introBlock.classList.remove('hidden');
      $('questionBlock').classList.add('hidden');
    }
    function hideIntro() {
      introBlock.classList.add('hidden');
      $('questionBlock').classList.remove('hidden');
    }

    beginBtn?.addEventListener('click', () => {
      saveLocal(STORAGE_KEYS.introSeen, true);
      hideIntro();
      renderCurrent();
    });

    updateHeader(participantId, Math.min(index, order?.length ? order.length - 1 : 0), order ? order.length : 0);

    const audio = $('audioPlayer');
    const sentenceText = $('sentenceText');
    const questionText = $('questionText');

    async function renderCurrent() {
      if (index >= order.length) {
        $('questionBlock').classList.add('hidden');
        $('doneBlock').classList.remove('hidden');
        $('serverSaveStatus').textContent = 'Saving results to server…';
        await saveToServer(participantId, order, responses, index, true);
        $('serverSaveStatus').textContent = 'Results saved on server.';
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

    async function saveToServer(pid, ord, resp, idx, completed = false) {
      // Persist locally first
      saveLocal(STORAGE_KEYS.order, ord);
      saveLocal(STORAGE_KEYS.index, idx);
      saveLocal(STORAGE_KEYS.responses, resp);
      // Post to server (best-effort)
      const payload = { participant_id: pid, order: ord, responses: resp, index: idx, completed: !!completed };
      await apiSaveProgress(payload);
    }

    function record(responseLabel) {
      const nowIso = new Date().toISOString();
      const manifestIdx = order[index];
      const row = { participant_id: participantId, timestamp: nowIso, index: index, manifest_index: manifestIdx, audio: manifest[manifestIdx].audio, label: manifest[manifestIdx].label, filename: manifest[manifestIdx].filename || '', response: responseLabel };
      responses.push(row);
      index += 1;
      // Fire-and-forget server save
      saveToServer(participantId, order, responses, index).catch(() => {});
      renderCurrent();
    }

    $('btnYes').addEventListener('click', () => record('Yes'));
    $('btnNo').addEventListener('click', () => record('No'));
    $('btnUnsure').addEventListener('click', () => record('Not Sure'));

    $('continueLaterBtn').addEventListener('click', async () => {
      await saveToServer(participantId, order, responses, index);
      const resumeUrl = new URL(window.location.href);
      resumeUrl.searchParams.set('sid', participantId);
      const link = resumeUrl.toString();
      const info = $('resumeInfo');
      info.textContent = `Saved. Use this link to resume: ${link}`;
      info.classList.remove('hidden');
      try { await navigator.clipboard.writeText(link); info.textContent += ' (copied to clipboard)'; } catch {}
    });

    $('resetBtn').addEventListener('click', () => {
      if (confirm('This will clear your local progress and reload the survey. Continue?')) {
        localStorage.removeItem(STORAGE_KEYS.participantId);
        localStorage.removeItem(STORAGE_KEYS.order);
        localStorage.removeItem(STORAGE_KEYS.responses);
        localStorage.removeItem(STORAGE_KEYS.index);
        localStorage.removeItem(STORAGE_KEYS.introSeen);
        location.href = location.pathname; // drop sid
      }
    });

    // Initial route: if intro not seen and there is no progress yet, show intro.
    if (!introSeen && (!responses || responses.length === 0) && (index === 0)) {
      showIntro();
    } else {
      hideIntro();
      await renderCurrent();
    }
  } catch (err) { console.error(err); showError(err.message || 'Failed to initialize survey.'); }
}

window.addEventListener('DOMContentLoaded', init);