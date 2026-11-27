// Prepares the bot's 24 kHz voice for the phone line (8 kHz).
// The telephony service turns 24 kHz into 8 kHz by keeping every third sample, chunk by chunk.
// Two things made that crackle:
//  1. Nothing above 4 kHz was removed first, so those tones folded back as hiss and grit (aliasing).
//  2. Chunks whose length was not a multiple of 3 samples shifted the sampling phase at every
//     chunk edge, which is heard as clicks.
// Here a low-pass filter (kept continuous across chunks) removes everything above ~3.4 kHz, and
// only whole groups of 3 samples go out; the rest waits for the next chunk.

const TAPS = 63;
const CUTOFF_HZ = 3400;
const RATE = 24000;

// Windowed-sinc low-pass (Blackman window), normalised to unity gain.
const KERNEL: Float64Array = (() => {
  const k = new Float64Array(TAPS);
  const fc = CUTOFF_HZ / RATE;
  const m = TAPS - 1;
  let sum = 0;
  for (let i = 0; i < TAPS; i += 1) {
    const x = i - m / 2;
    const sinc = x === 0 ? 2 * Math.PI * fc : Math.sin(2 * Math.PI * fc * x) / x;
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / m) + 0.08 * Math.cos((4 * Math.PI * i) / m);
    k[i] = sinc * w;
    sum += k[i];
  }
  for (let i = 0; i < TAPS; i += 1) k[i] /= sum;
  return k;
})();

export class PhoneAudio {
  private history = new Float64Array(TAPS - 1); // last input samples, for a seamless filter across chunks
  private carry: Int16Array = new Int16Array(0); // filtered samples waiting to make a group of 3

  /** Takes base64 PCM16 LE at 24 kHz, returns base64 PCM16 at 24 kHz (filtered, length a multiple of 3 samples) or '' if nothing is ready yet. */
  process(base64: string): string {
    const buf = Buffer.from(base64, 'base64');
    const n = Math.floor(buf.length / 2);
    if (!n) return '';
    const input = new Float64Array(TAPS - 1 + n);
    input.set(this.history, 0);
    for (let i = 0; i < n; i += 1) input[TAPS - 1 + i] = buf.readInt16LE(i * 2);
    this.history = input.slice(n);

    const all = new Int16Array(this.carry.length + n);
    all.set(this.carry, 0);
    for (let i = 0; i < n; i += 1) {
      let acc = 0;
      for (let t = 0; t < TAPS; t += 1) acc += KERNEL[t] * input[i + t];
      all[this.carry.length + i] = acc > 32767 ? 32767 : acc < -32768 ? -32768 : Math.round(acc);
    }
    const ready = all.length - (all.length % 3);
    this.carry = all.slice(ready);
    if (!ready) return '';
    const out = Buffer.alloc(ready * 2);
    for (let i = 0; i < ready; i += 1) out.writeInt16LE(all[i], i * 2);
    return out.toString('base64');
  }

  /** The bot was interrupted: drop what is held so old speech does not leak into the next turn. */
  reset(): void {
    this.history = new Float64Array(TAPS - 1);
    this.carry = new Int16Array(0);
  }
}
