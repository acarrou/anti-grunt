// Service worker: creates the offscreen audio document and tracks which tab
// is being filtered. State lives in storage.session because the worker can be
// suspended at any time.

import { loadSettings } from './settings.js';

const OFFSCREEN_URL = 'offscreen.html';

async function getState() {
  const { state } = await chrome.storage.session.get('state');
  return state ?? { tabId: null, count: 0, last: null };
}

async function setState(state) {
  await chrome.storage.session.set({ state });
  await chrome.action.setBadgeBackgroundColor({ color: '#2f6f4f' });
  await chrome.action.setBadgeText({ text: state.tabId == null ? '' : String(state.count) });
}

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Filter and play back the audio of the captured tab.',
  });
}

async function closeOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) await chrome.offscreen.closeDocument();
}

async function start({ streamId, tabId }) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({
    target: 'offscreen', type: 'start', streamId, settings: await loadSettings(),
  });
  if (!res?.ok) {
    await closeOffscreen();
    throw new Error(res?.error ?? 'Could not start audio capture.');
  }
  await setState({ tabId, count: 0, last: null });
}

async function stop() {
  await closeOffscreen(); // closing the document releases the capture
  await setState({ tabId: null, count: 0, last: null });
}

async function handle(msg) {
  switch (msg.type) {
    case 'start': await start(msg); return getState();
    case 'stop': await stop(); return getState();
    case 'status': return getState();
    case 'ended': await stop(); return null;
    case 'detected': {
      const state = await getState();
      if (state.tabId == null) return null;
      await setState({ ...state, count: state.count + 1, last: { label: msg.label, score: msg.score } });
      return null;
    }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'background') return;
  handle(msg).then(
    (state) => sendResponse({ ok: true, state }),
    (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }),
  );
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getState()).tabId === tabId) await stop();
});
