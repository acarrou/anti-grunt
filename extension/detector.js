// Sound detection: YAMNet over a sliding window, plus the logic that turns a
// run of positive windows into the frame range to silence.

import { AudioClassifier, FilesetResolver } from './vendor/audio_bundle.mjs';

export const WINDOW_SECONDS = 0.975; // YAMNet's native analysis window
// Only the most recent slice of audio is classified, centred in an otherwise
// silent window. A short grunt under speech fills most of a half-second slice
// but only a third of a full window, where the speech drowns it out: on test
// coughs mixed quietly into speech, full windows missed 9 of 15 and slices
// missed 1 or 2, with fewer false mutes.
export const SLICE_SECONDS = 0.5;
export const HOP_SECONDS = 0.08;
export const PAD_SECONDS = 0.12;
const FADE_SECONDS = 0.01; // softens the slice edges so they do not click

// Copies `slice` into the middle of the silent model input `out`.
export function frameSlice(slice, out, rate) {
  const at = (out.length - slice.length) >> 1;
  const fade = Math.round(FADE_SECONDS * rate);
  out.fill(0);
  out.set(slice, at);
  for (let i = 0; i < fade; i++) {
    out[at + i] *= i / fade;
    out[at + slice.length - 1 - i] *= i / fade;
  }
  return out;
}

export async function createClassifier(baseUrl) {
  const fileset = await FilesetResolver.forAudioTasks(new URL('vendor/wasm', baseUrl).href);
  return AudioClassifier.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL('vendor/yamnet.tflite', baseUrl).href },
    maxResults: -1,
  });
}

// Highest combined score of the wanted sounds across the returned windows,
// and the name of the strongest one.
export function scoreSounds(results, sounds) {
  const wanted = new Set(sounds.map((s) => s.toLowerCase()));
  let best = { score: 0, label: null };
  let heard = { score: 0, label: null }; // strongest sound of any kind
  for (const result of results) {
    let sum = 0;
    let top = { score: 0, label: null };
    for (const c of result.classifications?.[0]?.categories ?? []) {
      if (c.score > heard.score) heard = { score: c.score, label: c.categoryName };
      if (!wanted.has(c.categoryName.toLowerCase())) continue;
      sum += c.score;
      if (c.score > top.score) top = { score: c.score, label: c.categoryName };
    }
    if (sum > best.score) best = { score: sum, label: top.label };
  }
  return { ...best, heard: heard.label };
}

// Tracks runs of consecutive positive windows and returns the frame range to
// silence. Each window (here, a classified slice) ends at frame `end` and
// covers `windowFrames`.
//
// A positive window only says the sound is somewhere inside it, and the sound
// usually carries on past that window's end. So the range runs from the start
// of the first positive window to the end of the latest one: it never
// shrinks, and it grows on every hop while the run lasts, which is safe
// because playback is delayed past it.
export class RunTracker {
  constructor(windowFrames, padFrames) {
    this.windowFrames = windowFrames;
    this.padFrames = padFrames;
    this.run = null;
    this.nextId = 1;
  }

  // Returns { id, start, end, isNew } to mute, or null.
  update(end, positive) {
    if (!positive) {
      this.run = null;
      return null;
    }
    const isNew = !this.run;
    if (isNew) this.run = { id: this.nextId++, first: end };
    return {
      id: this.run.id,
      start: Math.max(0, this.run.first - this.windowFrames - this.padFrames),
      end: end + this.padFrames,
      isNew,
    };
  }
}
