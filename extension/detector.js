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

// Tracks runs of consecutive positive windows. Each window ends at frame
// `end` and covers `windowFrames`. A short sound is inside every positive
// window of its run, so it lies in their intersection: from the start of the
// latest window to the end of the first. A sound longer than the window
// instead spans from the first window's end to the latest window's start.
// Taking min/max of those two points covers both cases; the range is refined
// on every hop, which is safe because playback is delayed past it.
export class RunTracker {
  constructor(windowFrames, padFrames) {
    this.windowFrames = windowFrames;
    this.padFrames = padFrames;
    this.reachFrames = Math.round(windowFrames * 0.4);
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
    const a = this.run.first;
    const b = end - this.windowFrames;
    // A long sound triggers windows that only partly overlap it, so its true
    // edges lie beyond a and b by up to that partial overlap.
    const reach = Math.min(Math.max(b - a, 0), this.reachFrames);
    return {
      id: this.run.id,
      start: Math.max(0, Math.min(a, b) - reach - this.padFrames),
      end: Math.max(a, b) + reach + this.padFrames,
      isNew,
    };
  }
}
