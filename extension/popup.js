import { SOUND_CHOICES, loadSettings } from './settings.js';

const statusEl = document.getElementById('status');
const toggle = document.getElementById('toggle');
const sensitivity = document.getElementById('sensitivity');
const soundsEl = document.getElementById('sounds');

// Slider 0..100 maps to threshold 0.60..0.03 on a log scale, since useful
// thresholds cluster at the low end.
const T_MAX = 0.6;
const T_MIN = 0.01;
const toThreshold = (v) => T_MAX * (T_MIN / T_MAX) ** (v / 100);
const toSlider = (t) => Math.round((100 * Math.log(t / T_MAX)) / Math.log(T_MIN / T_MAX));

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let settings = await loadSettings();
let state = { tabId: null, count: 0, last: null };

async function send(msg) {
  const res = await chrome.runtime.sendMessage({ target: 'background', ...msg });
  if (!res?.ok) throw new Error(res?.error ?? 'No response from the extension.');
  return res.state;
}

// Live readout: what the model hears and how the selected sounds score, so
// the sensitivity can be set just below what a real throat clear reaches.
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const live = document.getElementById('live');
const peakEl = document.getElementById('peak');
const triggerEl = document.getElementById('trigger');
let peak = 0;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'popup' || msg.type !== 'score') return;
  peak = Math.max(peak, msg.score);
  document.getElementById('heard').textContent = msg.heard ?? 'silence';
  document.getElementById('now').textContent = pct(msg.score);
  peakEl.textContent = pct(peak);
});

document.getElementById('resetPeak').addEventListener('click', (e) => {
  e.preventDefault();
  peak = 0;
  peakEl.textContent = pct(0);
});

const reportBox = document.getElementById('reportBox');
const reportBtn = document.getElementById('report');
const reportNote = document.getElementById('reportNote');
document.getElementById('version').textContent = `Version ${chrome.runtime.getManifest().version}`;
let reports = 0;

reportBtn.addEventListener('click', async () => {
  reportBtn.disabled = true;
  try {
    await send({ type: 'report' });
    reports += 1;
    reportNote.textContent = `Saved ${reports} to Downloads/anti-grunt. Keep watching and press again next time.`;
  } catch (err) {
    reportNote.textContent = String(err?.message ?? err);
  }
  reportBtn.disabled = false;
});

function render(error) {
  triggerEl.textContent = pct(settings.threshold);
  live.hidden = state.tabId == null;
  reportBox.hidden = state.tabId == null;
  const active = state.tabId != null;
  const here = active && state.tabId === tab?.id;
  toggle.disabled = false;
  toggle.classList.toggle('on', active);
  toggle.textContent = !active ? 'Start on this tab' : here ? 'Stop' : 'Stop (running on another tab)';
  statusEl.classList.toggle('error', Boolean(error));
  if (error) {
    statusEl.textContent = error;
  } else if (!active) {
    statusEl.textContent = 'Off. Open the video, then press Start.';
  } else {
    const last = state.last ? ` Last: ${state.last.label} (${Math.round(state.last.score * 100)}%).` : '';
    statusEl.textContent = `Listening. Muted ${state.count} sound${state.count === 1 ? '' : 's'} so far.${last}`;
  }
}

async function saveSettings() {
  await chrome.storage.local.set({ settings });
  // Nobody is listening when the filter is off; that is fine.
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'settings', settings }).catch(() => {});
}

sensitivity.value = toSlider(settings.threshold);
sensitivity.addEventListener('input', () => {
  settings = { ...settings, threshold: toThreshold(Number(sensitivity.value)) };
  triggerEl.textContent = pct(settings.threshold);
  saveSettings();
});

for (const name of SOUND_CHOICES) {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = settings.sounds.includes(name);
  box.addEventListener('change', () => {
    const sounds = new Set(settings.sounds);
    box.checked ? sounds.add(name) : sounds.delete(name);
    settings = { ...settings, sounds: [...sounds] };
    saveSettings();
  });
  label.append(box, ` ${name.split(',')[0]}`);
  soundsEl.append(label);
}

toggle.addEventListener('click', async () => {
  toggle.disabled = true;
  try {
    if (state.tabId != null) {
      state = await send({ type: 'stop' });
    } else {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      state = await send({ type: 'start', streamId, tabId: tab.id });
    }
    render();
  } catch (err) {
    render(String(err?.message ?? err));
  }
});

chrome.storage.session.onChanged.addListener((changes) => {
  if (!changes.state) return;
  state = changes.state.newValue ?? state;
  render();
});

try {
  state = await send({ type: 'status' });
  render();
} catch (err) {
  render(String(err?.message ?? err));
}
