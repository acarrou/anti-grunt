// Plays its input back after a fixed delay, silencing any frame ranges the
// main thread has flagged in the meantime. The delay is what gives the
// classifier time to hear a sound before the listener does.
//
// Frame numbers are absolute counts of input frames since the node started,
// so the main thread and this processor share one timeline.

const CHUNK = 2048; // mono frames per message to the classifier
const FADE_SECONDS = 0.02;

class DelayMuteProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const rate = options.processorOptions.sampleRate ?? sampleRate;
    this.delay = Math.round(options.processorOptions.delaySeconds * rate);
    this.size = this.delay + 1024;
    this.ring = [new Float32Array(this.size), new Float32Array(this.size)];
    this.written = 0;
    this.gain = 1;
    this.fadeStep = 1 / (FADE_SECONDS * rate);
    this.intervals = new Map(); // id -> [startFrame, endFrame)
    this.chunk = new Float32Array(CHUNK);
    this.chunkFill = 0;

    this.port.onmessage = ({ data }) => {
      if (data.type === 'mute') this.intervals.set(data.id, [data.start, data.end]);
    };
  }

  isMuted(frame) {
    for (const [start, end] of this.intervals.values()) {
      if (frame >= start && frame < end) return true;
    }
    return false;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const frames = output[0].length;
    const inL = input[0];
    const inR = input[1] ?? inL;

    for (let i = 0; i < frames; i++) {
      const abs = this.written + i;
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : 0;
      const w = abs % this.size;
      this.ring[0][w] = l;
      this.ring[1][w] = r;

      this.chunk[this.chunkFill++] = (l + r) / 2;
      if (this.chunkFill === CHUNK) {
        const samples = this.chunk;
        this.port.postMessage({ type: 'audio', samples, endFrame: abs + 1 }, [samples.buffer]);
        this.chunk = new Float32Array(CHUNK);
        this.chunkFill = 0;
      }

      const readAbs = abs - this.delay;
      const target = readAbs >= 0 && this.isMuted(readAbs) ? 0 : 1;
      if (this.gain < target) this.gain = Math.min(target, this.gain + this.fadeStep);
      else if (this.gain > target) this.gain = Math.max(target, this.gain - this.fadeStep);

      const rd = ((readAbs % this.size) + this.size) % this.size;
      for (let c = 0; c < output.length; c++) {
        output[c][i] = readAbs >= 0 ? this.ring[Math.min(c, 1)][rd] * this.gain : 0;
      }
    }
    this.written += frames;

    // Forget ranges that have already been played.
    const played = this.written - this.delay;
    for (const [id, [, end]] of this.intervals) {
      if (end < played - this.size) this.intervals.delete(id);
    }
    return true;
  }
}

registerProcessor('delay-mute', DelayMuteProcessor);
