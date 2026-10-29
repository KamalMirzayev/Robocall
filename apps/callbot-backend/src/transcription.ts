import { readFile } from 'node:fs/promises';
import { GoogleGenAI } from '@google/genai';
import { recordAiTokenUsage } from './ai-usage.js';

type TranscriptContext = {
  agentName?: string | null;
  customerName?: string | null;
  customerSurname?: string | null;
  fallbackTranscript?: string | null;
};

const postCallTranscriptModel = process.env.POST_CALL_TRANSCRIPT_MODEL || 'gemini-2.5-flash';
const postCallTranscriptTimeoutMs = Number(process.env.POST_CALL_TRANSCRIPT_TIMEOUT_MS || 30000);

function normalizeTranscript(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function buildPrompt(context: TranscriptContext) {
  const customerName = [context.customerName, context.customerSurname].filter(Boolean).join(' ') || 'müştəri';
  const fallback = context.fallbackTranscript?.trim()
    ? `\n\nKöməkçi, amma etibarsız live transcript:\n${context.fallbackTranscript.trim()}`
    : '';

  return `Bu call center telefon danışığının MP3 yazısını transkripsiya et.

Dil qaydaları:
- Əsas dil Azərbaycan dilidir.
- Müştərinin danışığını Azərbaycan dilində eşitdiyin kimi yaz.
- Səsi başa düşmürsənsə, uydurma və başqa dillərdə sözlər yazma; həmin hissəni [anlaşılmadı] kimi qeyd et.
- Alman, Fransız, İngilis və ya başqa dilə oxşayan təsadüfi sözlər yaratma.
- Agentin adı: ${context.agentName || 'agent'}.
- Müştəri: ${customerName}.

Format:
A: agentin dediyi sözlər
C: müştərinin dediyi sözlər

Yalnız transcript qaytar, izah yazma.${fallback}`;
}

export async function transcribeCallRecording(filePath: string, context: TranscriptContext) {
  if (process.env.POST_CALL_TRANSCRIPTION_ENABLED === 'false') return null;

  const audio = await readFile(filePath);
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const request = ai.models.generateContent({
    model: postCallTranscriptModel,
    contents: [{
      role: 'user',
      parts: [
        { text: buildPrompt(context) },
        { inlineData: { mimeType: 'audio/mp3', data: audio.toString('base64') } },
      ],
    }],
    config: {
      temperature: 0,
    },
  });
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`post-call transcription timed out after ${postCallTranscriptTimeoutMs}ms`)), postCallTranscriptTimeoutMs);
  });
  const response = await Promise.race([request, timeout]);
  await recordAiTokenUsage({
    model: postCallTranscriptModel,
    operation: 'post_call_transcription',
    usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata as never,
  });

  const text = normalizeTranscript(response.text || '');
  return text || null;
}
