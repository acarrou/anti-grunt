// Offscreen document: owns the captured tab audio. Capturing a tab silences
// it, so this page is what the user actually hears: tab audio, delayed, with
// the detected sounds muted.

import {
  createClassifier, scoreSounds, frameSlice, RunTracker,
  WINDOW_SECONDS, SLICE_SECONDS, HOP_SECONDS, PAD_SECONDS,
} from './detector.js';
import { DEFAULT_SETTINGS } from './settings.js';

// Must exceed the classified slice plus a hop plus inference time, with room
// to spare.
const DELAY_SECONDS = 1.5;

// How much recent audio and detector history to keep for a miss report.
const KEEP_SECONDS = 30;

let settings = { ...DEFAULT_SETTINGS };
let session = null;
let classifierPromise = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') {
    settings = { ...DEFAULT_SETTINGS, ...msg.settings };
    start(msg.streamId).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }),
    );
    return true;
  }
  if (msg.type === 'snapshot') {
    snapshot().then(
      (data) => sendResponse({ ok: true, ...data }),
      (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }),
    );
    return true;
  }
  if (msg.type === 'stop') {
    stop();
    sendResponse({ ok: true });
  } else if (msg.type === 'settings') {
    settings = { ...DEFAULT_SETTINGS, ...msg.settings };
  }
});

async function start(streamId) {
  stop();
  classifierPromise ??= createClassifier(chrome.runtime.getURL(''));
  const classifier = await classifierPromise;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });

  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('delay-mute-worklet.js');
  const node = new AudioWorkletNode(ctx, 'delay-mute', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { delaySeconds: DELAY_SECONDS },
  });
  ctx.createMediaStreamSource(stream).connect(node).connect(ctx.destination);

  const rate = ctx.sampleRate;
  const sliceFrames = Math.round(SLICE_SECONDS * rate);
  const hopFrames = Math.round(HOP_SECONDS * rate);
  const tracker = new RunTracker(sliceFrames, Math.round(PAD_SECONDS * rate));
  const history = new Float32Array(sliceFrames); // the most recent slice
  const input = new Float32Array(Math.round(WINDOW_SECONDS * rate));
  let sinceLast = 0;
  let received = 0;

  // Rolling record for miss reports: raw audio plus what the detector decided.
  const keepFrames = Math.round(KEEP_SECONDS * rate);
  const log = { rate, recent: new Float32Array(keepFrames), endFrame: 0, trace: [], mutes: [] };
  const trim = (list, frame) => { while (list.length && list[0].frame < frame - keepFrames) list.shift(); };

  node.port.onmessage = ({ data }) => {
    if (data.type !== 'audio') return;
    const { samples, endFrame } = data;
    history.copyWithin(0, samples.length);
    history.set(samples, sliceFrames - samples.length);
    log.recent.copyWithin(0, samples.length);
    log.recent.set(samples, keepFrames - samples.length);
    log.endFrame = endFrame;
    received += samples.length;
    sinceLast += samples.length;
    if (received < sliceFrames || sinceLast < hopFrames) return;
    sinceLast = 0;

    const { score, label, heard } = scoreSounds(
      classifier.classify(frameSlice(history, input, rate), rate), settings.sounds,
    );
    log.trace.push({ frame: endFrame, score, label, heard, threshold: settings.threshold });
    trim(log.trace, endFrame);
    // Live readout for the popup; nobody is listening when it is closed.
    chrome.runtime.sendMessage({ target: 'popup', type: 'score', score, heard }).catch(() => {});
    const mute = tracker.update(endFrame, score >= settings.threshold);
    if (!mute) return;
    log.mutes.push({ frame: endFrame, id: mute.id, start: mute.start, end: mute.end });
    trim(log.mutes, endFrame);
    node.port.postMessage({ type: 'mute', id: mute.id, start: mute.start, end: mute.end });
    if (mute.isNew) chrome.runtime.sendMessage({ target: 'background', type: 'detected', label, score });
  };

  // The tab was closed or navigated away from under us.
  stream.getAudioTracks()[0].addEventListener('ended', () => {
    stop();
    chrome.runtime.sendMessage({ target: 'background', type: 'ended' });
  });

  session = { stream, ctx, log };
}

function stop() {
  if (!session) return;
  session.stream.getTracks().forEach((t) => t.stop());
  session.ctx.close();
  session = null;
}

// The last KEEP_SECONDS of tab audio as a WAV data URL, plus the detector's
// scores and mute decisions over the same stretch. Times are in seconds from
// the start of the WAV.
async function snapshot() {
  if (!session) throw new Error('Not running.');
  const { rate, recent, endFrame, trace, mutes } = session.log;
  const startFrame = endFrame - recent.length;
  const sec = (frame) => +((frame - startFrame) / rate).toFixed(3);

  const wav = new DataView(new ArrayBuffer(44 + recent.length * 2));
  const text = (at, s) => [...s].forEach((ch, i) => wav.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF'); wav.setUint32(4, 36 + recent.length * 2, true); text(8, 'WAVEfmt ');
  wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
  wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true);
  wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
  text(36, 'data'); wav.setUint32(40, recent.length * 2, true);
  for (let i = 0; i < recent.length; i++) {
    wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, recent[i])) * 32767, true);
  }
  const wavUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([wav.buffer], { type: 'audio/wav' }));
  });

  return {
    wavUrl,
    info: {
      version: chrome.runtime.getManifest().version,
      savedAt: new Date().toISOString(),
      rate,
      seconds: KEEP_SECONDS,
      delaySeconds: DELAY_SECONDS,
      // What was coming out of the speakers at the moment of the report.
      playheadAtReport: sec(endFrame) - DELAY_SECONDS,
      settings,
      trace: trace.map((t) => ({ t: sec(t.frame), score: +t.score.toFixed(4), label: t.label, heard: t.heard, threshold: +t.threshold.toFixed(4) })),
      mutes: mutes.map((m) => ({ t: sec(m.frame), id: m.id, start: sec(m.start), end: sec(m.end) })),
    },
  };
}
