// Offscreen document: owns the captured tab audio. Capturing a tab silences
// it, so this page is what the user actually hears: tab audio, delayed, with
// the detected sounds muted.

import {
  createClassifier, scoreSounds, RunTracker,
  WINDOW_SECONDS, HOP_SECONDS, PAD_SECONDS,
} from './detector.js';
import { DEFAULT_SETTINGS } from './settings.js';

// Must exceed the analysis window plus a hop plus inference time.
const DELAY_SECONDS = 1.5;

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
  const windowFrames = Math.round(WINDOW_SECONDS * rate);
  const hopFrames = Math.round(HOP_SECONDS * rate);
  const tracker = new RunTracker(windowFrames, Math.round(PAD_SECONDS * rate));
  const history = new Float32Array(windowFrames);
  let sinceLast = 0;
  let received = 0;

  node.port.onmessage = ({ data }) => {
    if (data.type !== 'audio') return;
    const { samples, endFrame } = data;
    history.copyWithin(0, samples.length);
    history.set(samples, windowFrames - samples.length);
    received += samples.length;
    sinceLast += samples.length;
    if (received < windowFrames || sinceLast < hopFrames) return;
    sinceLast = 0;

    const { score, label, heard } = scoreSounds(classifier.classify(history, rate), settings.sounds);
    // Live readout for the popup; nobody is listening when it is closed.
    chrome.runtime.sendMessage({ target: 'popup', type: 'score', score, heard }).catch(() => {});
    const mute = tracker.update(endFrame, score >= settings.threshold);
    if (!mute) return;
    node.port.postMessage({ type: 'mute', id: mute.id, start: mute.start, end: mute.end });
    if (mute.isNew) chrome.runtime.sendMessage({ target: 'background', type: 'detected', label, score });
  };

  // The tab was closed or navigated away from under us.
  stream.getAudioTracks()[0].addEventListener('ended', () => {
    stop();
    chrome.runtime.sendMessage({ target: 'background', type: 'ended' });
  });

  session = { stream, ctx };
}

function stop() {
  if (!session) return;
  session.stream.getTracks().forEach((t) => t.stop());
  session.ctx.close();
  session = null;
}
