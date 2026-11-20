// Sound detection: YAMNet over a sliding window, plus the logic that turns a
// run of positive windows into the frame range to silence.

import { AudioClassifier, FilesetResolver } from './vendor/audio_bundle.mjs';

export const WINDOW_SECONDS = 0.975; // YAMNet's native analysis window
export const HOP_SECONDS = 0.2;
export const PAD_SECONDS = 0.12;

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
// silence. Each window ends at frame `end` and covers `windowFrames`.
//
// A positive window only says the sound is somewhere inside it. Measured on
// real coughs, the first positive window can hold anything from the first
// 0.2 s of the sound to all of it, and the sound usually carries on past that
// window's end. So the range runs from the start of the first positive window
// to the end of the latest one: it never shrinks, and it grows on every hop
// while the run lasts, which is safe because playback is delayed past it.
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
