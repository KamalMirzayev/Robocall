import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

export const recordingSampleRate = 16000;
const defaultRecordingsDir = path.resolve(process.cwd(), '../../recordings');
export const recordingsDir = process.env.RECORDINGS_DIR || defaultRecordingsDir;

type AudioRole = 'agent' | 'customer';
type Chunk = { role: AudioRole; offsetSamples: number; samples: Int16Array };

function clamp16(value: number) {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

function decodePcm16Base64(data: string) {
  const buffer = Buffer.from(data, 'base64');
  const samples = new Int16Array(Math.floor(buffer.length / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = buffer.readInt16LE(i * 2);
  }
  return samples;
}

function resample(samples: Int16Array, fromRate: number, toRate: number) {
  if (fromRate === toRate || samples.length === 0) return samples;
  const outputLength = Math.max(1, Math.round(samples.length * toRate / fromRate));
  const output = new Int16Array(outputLength);
  const ratio = fromRate / toRate;

  for (let i = 0; i < outputLength; i += 1) {
    const source = i * ratio;
    const index = Math.floor(source);
    const frac = source - index;
    const current = samples[Math.min(index, samples.length - 1)] || 0;
    const next = samples[Math.min(index + 1, samples.length - 1)] || current;
    output[i] = clamp16(current + ((next - current) * frac));
  }

  return output;
}

function pcmBuffer(samples: Int16Array) {
  const buffer = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(samples[i], i * 2);
  }
  return buffer;
}

async function writeMp3(filePath: string, samples: Int16Array) {
  const input = pcmBuffer(samples);
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 's16le',
      '-ar', String(recordingSampleRate),
      '-ac', '1',
      '-i', 'pipe:0',
      '-af', process.env.RECORDINGS_AUDIO_FILTER || 'highpass=f=90,lowpass=f=3800,acompressor=threshold=-18dB:ratio=2.5:attack=5:release=80,alimiter=limit=0.95',
      '-codec:a', 'libmp3lame',
      '-b:a', process.env.RECORDINGS_MP3_BITRATE || '64k',
      '-y',
      filePath,
    ]);
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
    ffmpeg.stdin.end(input);
  });
}

export function recordingPath(jobId: number) {
  return path.join(recordingsDir, `telephony-job-${jobId}.mp3`);
}

export async function recordingFileInfo(jobId: number) {
  try {
    const filePath = recordingPath(jobId);
    const info = await stat(filePath);
    return { filePath, size: info.size, updatedAt: info.mtime };
  } catch {
    return null;
  }
}

export function createRecordingStream(jobId: number) {
  return createReadStream(recordingPath(jobId));
}

export class LiveCallRecording {
  private readonly startedAtMs = Date.now();
  private readonly chunks: Chunk[] = [];
  private readonly roleCursors = new Map<AudioRole, number>();
  private saved = false;

  constructor(readonly jobId: number) {}

  add(role: AudioRole, rate: number, data: string) {
    if (this.saved || !data) return;
    const decoded = decodePcm16Base64(data);
    const samples = resample(decoded, rate, recordingSampleRate);
    if (samples.length === 0) return;

    const arrivalSamples = Math.max(0, Math.floor((Date.now() - this.startedAtMs) * recordingSampleRate / 1000));
    const cursorSamples = this.roleCursors.get(role) || 0;
    const offsetSamples = Math.max(arrivalSamples, cursorSamples);
    this.roleCursors.set(role, offsetSamples + samples.length);
    this.chunks.push({ role, offsetSamples, samples });
  }

  clear(role: AudioRole, rollbackMs = Number(process.env.RECORDINGS_CLEAR_ROLLBACK_MS || 80)) {
    if (this.saved) return;
    const currentSamples = Math.max(0, Math.floor((Date.now() - this.startedAtMs) * recordingSampleRate / 1000));
    const cutoffSamples = Math.max(0, currentSamples - Math.floor(Math.max(0, rollbackMs) * recordingSampleRate / 1000));
    for (let i = this.chunks.length - 1; i >= 0; i -= 1) {
      const chunk = this.chunks[i];
      if (chunk.role === role && chunk.offsetSamples >= cutoffSamples) this.chunks.splice(i, 1);
    }
    this.roleCursors.set(role, cutoffSamples);
  }

  async save() {
    if (this.saved) return null;
    this.saved = true;
    if (this.chunks.length === 0) return null;

    let totalSamples = 0;
    for (const chunk of this.chunks) {
      totalSamples = Math.max(totalSamples, chunk.offsetSamples + chunk.samples.length);
    }
    if (totalSamples <= 0) return null;

    const mix = new Int32Array(totalSamples);
    for (const chunk of this.chunks) {
      for (let i = 0; i < chunk.samples.length; i += 1) {
        mix[chunk.offsetSamples + i] += chunk.samples[i];
      }
    }

    const output = new Int16Array(totalSamples);
    for (let i = 0; i < mix.length; i += 1) {
      output[i] = clamp16(mix[i]);
    }

    await mkdir(recordingsDir, { recursive: true });
    const filePath = recordingPath(this.jobId);
    await writeMp3(filePath, output);
    return filePath;
  }
}
