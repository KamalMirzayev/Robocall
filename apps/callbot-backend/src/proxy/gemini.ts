import { WebSocket } from 'ws';
import { reportGeminiError } from '../gemini-credit.js';
import { EndSensitivity, GoogleGenAI, Modality, StartSensitivity, ThinkingLevel, Type, type LiveServerMessage } from '@google/genai';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { calls } from '../db/schema.js';
import type { customers, agents } from '../db/schema.js';
import type { InferSelectModel } from 'drizzle-orm';
import { broadcastMonitorAudio, broadcastMonitorEvent } from '../monitor.js';
import { LiveCallRecording } from '../recording.js';
import { transcribeCallRecording } from '../transcription.js';
import { buildSummaryCategoryGuide, summarizeTranscriptWithAi } from '../summary.js';
import { buildCallMemoryContext } from '../call-memory.js';
import { recordLiveEstimatedUsage } from '../ai-usage.js';
import { aiToolDeclarations, executeAiTool, isAiToolName } from '../ai-tools/index.js';
import { loadBaseInstruction, loadBaseInstructionById, loadToneInstruction, loadToneInstructionById } from '../templates.js';
import { TEMPLATE_VARIABLES } from '../template-variables.js';
import { partnerKbInstruction } from '../partner-kb.js';
import { arzoomCustomerLines, ensureArzoomFeedbackFromTranscript, recordArzoomFeedback } from '../arzoom-sync.js';
import { pinnedExtensions, salesExtensionsFor, startSalesTransfer, type TransferHandle } from '../sales-transfer.js';

type Customer = InferSelectModel<typeof customers>;
type Agent = InferSelectModel<typeof agents>;

type ClientMessage =
  | { type: 'audio'; data: string }
  | { type: 'monitor_agent'; data: string; rate?: number }
  | { type: 'barge_in'; holdMs?: number }
  | { type: 'call_ended' }
  | { type: 'end_call'; reason?: string }
  | { type: 'ping' };

const monitorBargeInRmsThreshold = Number(process.env.MONITOR_BARGE_IN_RMS || 450);
const monitorBargeInHoldMs = Number(process.env.MONITOR_BARGE_IN_HOLD_MS || 900);
const autoEndCallDelayMs = Number(process.env.AUTO_END_CALL_DELAY_MS || 1500);
const finalSilenceEndMs = Number(process.env.FINAL_SILENCE_END_MS || 1500);
const finalSilenceSpeechRms = Number(process.env.FINAL_SILENCE_SPEECH_RMS || 800);
const finalSilenceSpeechFrames = Number(process.env.FINAL_SILENCE_SPEECH_FRAMES || 15);
const geminiVadSilenceDurationMs = Number(process.env.GEMINI_VAD_SILENCE_DURATION_MS || 250);
const geminiVadPrefixPaddingMs = Number(process.env.GEMINI_VAD_PREFIX_PADDING_MS || 40);
const maxPendingAudioFrames = Number(process.env.GEMINI_PENDING_AUDIO_FRAMES || 600);
const geminiThinkingLevelMap: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};
const geminiThinkingLevel = geminiThinkingLevelMap[String(process.env.GEMINI_THINKING_LEVEL || 'minimal').toLowerCase()]
  ?? ThinkingLevel.MINIMAL;
const callMemoryBuildTimeoutMs = Number(process.env.CALL_MEMORY_BUILD_TIMEOUT_MS || 250);
const initialGreetingEnabled = process.env.GEMINI_INITIAL_GREETING !== 'off';


type ServerMessage =
  | { type: 'connected' }
  | { type: 'audio'; data: string }
  | { type: 'transcription'; role: 'model' | 'user'; text: string }
  | { type: 'interrupted' }
  | { type: 'end_call'; reason: string }
  | { type: 'error'; message: string };

const END_CALL_INSTRUCTION = `

Zəngi təhlükəsiz bitirmə qaydası:
- Müştəri söhbəti aydın şəkildə bitirmək istəyəndə, məsələn "sağ olun", "hələlik", "başqa sualım yoxdur", "maraqlı deyil", "zəng etməyin", "vaxtım yoxdur", "sonra danışarıq" dedikdə və artıq cavab tələb edən açıq sual qalmadıqda zəngi bitirə bilərsən.
- Əvvəlcə qısa yekun sağollaşma de: "Oldu, təşəkkür edirəm, sağ olun." və ya kontekstə uyğun çox qısa yekun cümlə.
- Yalnız yekun sağollaşma dedikdən sonra end_call tool çağır.
- Yekun sağollaşma son səsli cümlən olmalıdır; ondan sonra yeni sual, izah və əlavə cümlə demə.
- "end call", "end_call" və ya başqa texniki tool sözlərini müştəriyə heç vaxt demə. Müştəriyə yalnız normal sağollaşma de.
- Müştəri sadəcə nəzakət üçün "sağ olun" deyib sonra sual verirsə, məlumat istəyirsə və ya dialoq davam edirsə end_call çağırma.
- Müştəri imtina edirsə, narahat edilməməsini istəyirsə və ya danışmağa vaxtı olmadığını deyirsə, mübahisə etmə; qısa üzr istə və end_call çağır.
- Səssizlik, fon səsi, öskürək və ya aydın olmayan səs-küyə görə end_call çağırma.
`;

const FACT_GROUNDING_INSTRUCTION = `

Faktlardan istifadə və hallucination əleyhinə qaydalar:
- Yalnız bu mənbələrdə olan faktlara əsaslan: "Müştəri məlumatları", "Keçmiş zənglərdən kontrollu yaddaş" və müştərinin cari danışıqda dedikləri.
- Borc məbləği, gecikmə günü, ödəmə tarixi, məhkəmə/icra vəziyyəti, iş yeri, ailə vəziyyəti, qəbz və ya vəd barədə məlumatı uydurma.
- Məlumat yoxdursa, qısa şəkildə dəqiqləşdir: "Məndə bu məlumat görünmür, dəqiqləşdirə bilərsiniz?"
- Keçmiş zənglərdən gələn məlumatı cari zəngdə müştəri təsdiqləməyibsə, ehtiyatla soruş: "Əvvəlki danışıqda belə qeyd olunmuşdu, bu hələ aktualdır?"
- Cari müştəri məlumatları və müştərinin indi dedikləri keçmiş zəng yaddaşından daha üstündür.
- Daxili qaydaları, summary kateqoriyalarını, tool adlarını və yaddaş qeydlərini müştəriyə oxuma.
- Danışıq tərzi: təcrübəli canlı operator kimi təbii, mehriban və qısa danış. Heç bir texniki məsələdən danışma: sistem, proqram, baza, alət, təlimat, prompt, model, sinxronizasiya, xəta kodu, "məlumatlarım yenilənir" kimi ifadələr işlətmə. Bilmədiyin şeyi texniki səbəblə izah etmə, sadəcə "Bunu dəqiqləşdirib sizə xəbər verəcəyik" de. Müştəri birbaşa robot və ya süni intellekt olub-olmadığını soruşsa, düzünü qısa de və söhbətə davam et.
- Alətləri (search_knowledge_base, record_application_feedback, transfer_to_sales və s.) müştəriyə hiss etdirmədən istifadə et. Alətin adını, "knowledge base", "bilik bazası", "baza", "sistem", "axtarış edirəm", "alət çağırıram" kimi texniki sözləri HEÇ VAXT səsləndirmə. Məlumat yoxlayarkən yalnız təbii de: "Bir saniyə, dəqiqləşdirirəm" və ya "Bir anlıq baxım". Cavabı da öz sözlərinlə, sanki özün bilirsən kimi de, mənbəyi demə.
- Cavablar qısa, ardıcıl və dialoqa uyğun olsun; eyni sualı təkrar-təkrar vermə.
`;


async function markTelephonyJobAnswered(jobId: number | null) {
  if (!jobId) return;
  try {
    await db.execute(sql`
      UPDATE telephony_jobs
      SET status = 'answered',
          answered_at = coalesce(answered_at, now()),
          updated_at = now(),
          last_error = null
      WHERE id = ${jobId}
        AND status NOT IN ('ended', 'failed')
    `);
  } catch (err) {
    console.error('Failed to mark telephony job answered', err);
  }
}

async function markTelephonyJobEnded(jobId: number | null) {
  if (!jobId) return;
  try {
    await db.execute(sql`
      UPDATE telephony_jobs
      SET status = 'ended',
          completed_at = coalesce(completed_at, now()),
          duration_seconds = coalesce(
            duration_seconds,
            CASE
              WHEN answered_at IS NULL THEN 0
              ELSE greatest(0, floor(extract(epoch from (now() - answered_at)))::int)
            END
          ),
          updated_at = now(),
          last_error = null
      WHERE id = ${jobId}
        AND status NOT IN ('ended', 'failed')
    `);
  } catch (err) {
    console.error('Failed to mark telephony job ended', err);
  }
}

async function resolveTelephonyJobId(jobId: number | null, customer: Customer, agent: Agent): Promise<number | null> {
  if (jobId) return jobId;

  const rows = await db.execute(sql`
    SELECT id
    FROM telephony_jobs
    WHERE customer_id = ${customer.id}
      AND agent_id = ${agent.id}
      AND status IN ('claimed', 'dialing')
      AND answered_at IS NULL
      AND completed_at IS NULL
      AND created_at > now() - interval '3 minutes'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = Array.isArray(rows) ? rows[0] : (rows as { rows?: Array<{ id?: unknown }> }).rows?.[0];
  const id = Number(row?.id ?? 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}


function pcm16RmsFromBase64(data: string) {
  const buffer = Buffer.from(data, 'base64');
  const samples = Math.floor(buffer.length / 2);
  if (samples <= 0) return 0;
  let sum = 0;
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    const value = buffer.readInt16LE(offset);
    sum += value * value;
  }
  return Math.sqrt(sum / samples);
}

const finalGoodbyePattern = /\b(sağ\s*ol(?:un)?|sag\s*ol(?:un)?|hələlik|helelik|təşəkkür|tesekkur|görüşənədək|gorushenedek)\b/i;

function isFinalGoodbye(text: string) {
  const normalized = text
    .toLowerCase()
    .replace(/[?!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!finalGoodbyePattern.test(normalized)) return false;
  return !/\b(sual|soruş|sorus|ödəyə|odeye|ödəmə|odeme|whatsapp|nömrə|nomre|qəbz|qebz)\b/i.test(normalized);
}

const endCallFunctionDeclaration = {
  name: 'end_call',
  description: 'End the current phone call only after the assistant has said a short final goodbye and the customer clearly wants to finish or refuses the conversation.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      reason: {
        type: Type.STRING,
        description: 'Short reason for ending the call, for example customer_goodbye, customer_refused, customer_no_time, conversation_complete.'
      }
    },
  },
};

const transferFunctionDeclaration = {
  name: 'transfer_to_sales',
  description: 'Connect the customer to a live sales representative. Call it only after the customer agreed to the offer and you have told them to stay on the line for a few seconds. Say nothing after calling it.',
  parameters: { type: Type.OBJECT, properties: {} },
};

async function buildSystemInstruction(customer: Customer, agent: Agent, callMemoryContext = '', baseTemplateId: string | null = null, dynamicContext: string | null = null): Promise<string> {
  // New approach: use toneTemplateId if available, else fall back to legacy tone
  let toneInstruction = '';
  if (agent.toneTemplateId) {
    // Load tone from new template system
    const customTone = await loadToneInstructionById(agent.toneTemplateId);
    toneInstruction = customTone || '';
  } else if (agent.tone) {
    // Fall back to legacy tone system for backward compatibility
    toneInstruction = await loadToneInstruction(agent.tone);
  } else {
    // Default to neutral if no tone specified
    toneInstruction = await loadToneInstruction('neutral');
  }
  
  const tone = agent.tone ?? 'neutral';
  const baseInstruction = baseTemplateId
    ? await loadBaseInstructionById(baseTemplateId)
    : await loadBaseInstruction();
  
  // A template without the {DYNAMIC_CONTEXT} placeholder (e.g. the global default) would
  // drop the campaign's parameters, so they are appended instead.
  const withContext = dynamicContext && !baseInstruction.includes('{DYNAMIC_CONTEXT}')
    ? `${baseInstruction}\n\nBu kampaniya üzrə məlumat:\n${dynamicContext}`
    : baseInstruction;

  // Replace agent-level variables
  let instruction = withContext
    .replace('{AGENT_NAME}', agent.name)
    .replace('{COMPANY_NAME}', agent.companyName ?? 'şirkətin')
    .replace('{TONE_INSTRUCTION}', toneInstruction)
    .replace('{WHATSAPP_PHONE}', agent.phoneWhatsapp ?? 'təyin edilməyib');
  
  // Replace customer-level variables (template-based)
  // Map template variable keys to customer data
  const customerData: Record<string, string> = {
    '{CUSTOMER_NAME}': customer.name || 'qeyd edilməyib',
    '{CUSTOMER_SURNAME}': customer.surname || 'qeyd edilməyib',
    '{CUSTOMER_FIN}': customer.fin || 'qeyd edilməyib',
    '{CUSTOMER_CONTRACT_NO}': customer.contractNo || 'qeyd edilməyib',
    '{CUSTOMER_DEBT_AMOUNT}': customer.debtAmount?.toString() || 'qeyd edilməyib',
    '{OVERDUE_DAYS}': customer.overdueDays?.toString() || '0',
    '{LAST_PAYMENT_DATE}': customer.lastPaymentDate?.toString() || 'qeyd edilməyib',
    '{LAST_PAYMENT_AMOUNT}': customer.lastPaymentAmount?.toString() || 'qeyd edilməyib',
    '{TOTAL_PAID_90D}': customer.totalPaidLast90Days?.toString() || 'qeyd edilməyib',
    '{KEPT_PROMISES_90D}': customer.keptPromiseCount90d?.toString() || 'qeyd edilməyib',
    '{BROKEN_PROMISES_90D}': customer.brokenPromiseCount90d?.toString() || 'qeyd edilməyib',
    '{SOURCE_ORGANIZATION}': customer.sourceOrganization || 'qeyd edilməyib',
    '{COLLECTOR_ORGANIZATION}': customer.collectorOrganization || 'qeyd edilməyib',
    // Falls back to the same 'qeyd edilməyib' placeholder as the other variables (not '') —
    // an empty string here would make the `|| variable.key` fallback below leave the literal
    // "{DYNAMIC_CONTEXT}" text in the prompt when a call has no dynamic context set.
    '{DYNAMIC_CONTEXT}': dynamicContext || 'qeyd edilməyib',
  };

  // Replace all template variables
  TEMPLATE_VARIABLES.forEach((variable) => {
    instruction = instruction.replace(new RegExp(variable.key.replace(/[{}]/g, '\\$&'), 'g'), customerData[variable.key] || variable.key);
  });
  
  const parts: string[] = [];
  if (customer.name?.trim()) parts.push(`- Ad: ${customer.name}`);
  if (customer.surname?.trim() && customer.surname.trim() !== '-') parts.push(`- Soyad: ${customer.surname}`);
  if (!customer.name?.trim()) {
    parts.push('- Ad: məlum deyil. Müştəriyə həmişə "hörmətli müştəri" deyə müraciət et, ad soruşma və ad uydurma.');
  }
  // Debt lines only for customers that actually carry debt data, so sales or survey
  // segments don't get a "0 AZN debt" line that pulls the bot towards collection talk.
  if (Number(customer.overdueDays) > 0) parts.push(`- Gecikmə günü: ${customer.overdueDays}`);
  if (Number(customer.debtAmount) > 0) parts.push(`- Borc məbləği: ${customer.debtAmount} AZN`);
  if (customer.phone) parts.push(`- Telefon: ${customer.phone}`);
  // ARZOOM leasing application (status, car, offer terms, requested documents).
  parts.push(...arzoomCustomerLines(customer.arzoomData));
  
  return `${instruction}${FACT_GROUNDING_INSTRUCTION}${partnerKbInstruction()}${END_CALL_INSTRUCTION}\n\nMüştəri məlumatları:\n${parts.join('\n')}${callMemoryContext}${buildSummaryCategoryGuide()}`;
}

function buildInitialGreetingPrompt(customer: Customer) {
  const fullName = [customer.name, customer.surname]
    .filter(Boolean)
    .join(' ')
    .trim();
  // ARZOOM applications carry no name: greet without one and ask for the application owner.
  if (!fullName || fullName === '-') {
    return `Telefon zəngi indi cavablandı. Müştərinin bir neçə dəfə "alo" deməsini gözləmə. Dərhal səsli şəkildə bir dəfə qısa başla: "Alo, salam, hörmətli müştəri, hər vaxtınız xeyir olsun." Özünü və şirkəti qısa təqdim et, kredit müraciəti ilə bağlı zəng etdiyini de və danışmağa vaxtı olub-olmadığını soruş. Bundan sonra cavabı gözlə.`;
  }
  return `Telefon zəngi indi cavablandı. Müştərinin bir neçə dəfə "alo" deməsini gözləmə. Dərhal səsli şəkildə bir dəfə qısa başla: "Alo, salam, hər vaxtınız xeyir olsun. ${fullName} ilə danışıram?" Bundan sonra cavabı gözlə.`;
}

async function buildCallMemoryContextBounded(customer: Customer, agent: Agent) {
  const timeoutMs = Math.max(0, Math.min(callMemoryBuildTimeoutMs, 3000));
  if (timeoutMs === 0) return '';

  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      buildCallMemoryContext(customer, agent),
      new Promise<string>((resolve) => {
        timeout = setTimeout(() => resolve(''), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function handleGeminiProxy(clientWs: WebSocket, customer: Customer, agent: Agent, jobId: number | null = null, baseTemplateId: string | null = null, dynamicContext: string | null = null) {
  // Never let a socket error on the client connection crash the process
  // (a pending write to a disconnected player/monitor completes with EPIPE).
  clientWs.on('error', (err) => {
    console.warn('Gemini client WS error', err?.message);
  });

  const send = (msg: ServerMessage) => {
    if (sessionClosed || clientWs.readyState !== WebSocket.OPEN) {
      return;
    }
    clientWs.send(JSON.stringify(msg));
  };

  let callId: number | null = null;
  let startedAt: Date = new Date();
  let telephonyJobId: number | null = jobId;
  let recording: LiveCallRecording | null = null;
  let suppressMonitorAgentUntil = 0;
  const transcriptLines: string[] = [];
  let currentAgentTurn = '';
  let endCallRequested = false;
  let endCallTimer: NodeJS.Timeout | null = null;
  let endCallReason = 'ai_requested';
  let finalSilenceEndTimer: NodeJS.Timeout | null = null;
  let finalSilenceCustomerFrames = 0;
  // Set once the Gemini session closes; guards every send so we never write
  // to a dead socket (which would otherwise crash the process with EPIPE).
  let sessionClosed = false;
  const pendingAudio: string[] = [];
  // Sales transfer: 'pending' waits for the hold sentence to finish, 'dialing' plays hold music
  // while reps ring, 'connected' means the rep is in the call and the bot is out.
  let transferState: 'idle' | 'pending' | 'dialing' | 'connected' = 'idle';
  let transferHandle: TransferHandle | null = null;
  let transferStartTimer: NodeJS.Timeout | null = null;
  let transferConnectedAt: Date | null = null;
  const brand = (customer as { arzoomData?: { brand?: string } | null }).arzoomData?.brand ?? null;
  const pinnedReps = pinnedExtensions((customer as { arzoomData?: unknown }).arzoomData);
  const rawSend = (msg: ServerMessage) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(msg));
  };

  const suppressMonitorAgent = (holdMs = monitorBargeInHoldMs) => {
    const boundedHoldMs = Math.max(200, Math.min(Number(holdMs) || monitorBargeInHoldMs, 3000));
    suppressMonitorAgentUntil = Math.max(suppressMonitorAgentUntil, Date.now() + boundedHoldMs);
  };

  const shouldForwardAgentToMonitor = () => Date.now() >= suppressMonitorAgentUntil;

  const clearFinalSilenceEndTimer = () => {
    if (finalSilenceEndTimer) {
      clearTimeout(finalSilenceEndTimer);
      finalSilenceEndTimer = null;
    }
    finalSilenceCustomerFrames = 0;
  };

  const scheduleFinalSilenceEnd = () => {
    if (endCallRequested || finalSilenceEndTimer) return;
    finalSilenceEndTimer = setTimeout(() => {
      finalSilenceEndTimer = null;
      requestEndCall('final_goodbye_silence');
    }, Math.max(1000, Math.min(finalSilenceEndMs, 10000)));
  };


  const armEndCallTimer = (delayMs: number) => {
    if (endCallTimer) clearTimeout(endCallTimer);
    const sendEnd = () => {
      if (clientWs.readyState === WebSocket.OPEN) {
        send({ type: 'end_call', reason: endCallReason });
      }
    };
    endCallTimer = setTimeout(sendEnd, Math.max(500, Math.min(delayMs, 8000)));
  };

  const scheduleEndCallAfterTurn = () => {
    if (!endCallRequested) return;
    armEndCallTimer(autoEndCallDelayMs);
  };

  const requestEndCall = (reason = 'ai_requested') => {
    if (endCallRequested) return;
    clearFinalSilenceEndTimer();
    endCallRequested = true;
    endCallReason = String(reason || 'ai_requested').slice(0, 120);
    console.log(`AI requested end_call for telephony job ${telephonyJobId ?? 'none'}: ${endCallReason}`);
    // Fallback only: the normal path waits for Gemini turnComplete so the final goodbye is not cut off.
    armEndCallTimer(Math.max(3000, autoEndCallDelayMs + 1500));
  };


  const beginTransfer = async () => {
    if (transferState !== 'pending') return;
    if (transferStartTimer) clearTimeout(transferStartTimer);
    transferStartTimer = null;
    transferState = 'dialing';
    clearFinalSilenceEndTimer();
    console.log(`Sales transfer started for telephony job ${telephonyJobId ?? 'none'} brand=${brand ?? '-'}`);
    transferHandle = await startSalesTransfer(
      { telephonyJobId, customerId: customer.id, brand, callerId: customer.phone || null, extensions: pinnedReps },
      {
        onConnected: (ext) => {
          transferState = 'connected';
          transferConnectedAt = new Date();
          transcriptLines.push(`[Satış təmsilçisinə qoşuldu: ${ext}]`);
          void recordArzoomFeedback({
            customerId: customer.id,
            telephonyJobId,
            outcome: 'transferred_to_sales',
            reason: `Müştəri şərtlərlə razılaşdı və ${ext} daxili nömrəli satış təmsilçisinə qoşuldu.`,
          }).catch(() => {});
          // The bot is done; the call itself stays up until the customer or the rep hangs up.
          if (!sessionClosed && session) {
            try {
              session.close();
            } catch {}
          }
        },
        onFailed: (reason) => {
          console.warn(`Sales transfer failed for telephony job ${telephonyJobId ?? 'none'}: ${reason}`);
          transferState = 'idle';
          transcriptLines.push('[Satış təmsilçisinə qoşmaq alınmadı]');
          if (sessionClosed || !session) {
            rawSend({ type: 'end_call', reason: 'transfer_failed' });
            return;
          }
          try {
            session.sendClientContent({
              turns: '[Sistem] Satış təmsilçiləri hazırda cavab vermir. Müştəridən gözlətdiyin üçün üzr istə, filiala yaxınlaşa və ya *5665 nömrəsinə zəng edə biləcəyini, ya da təmsilçinin ona tezliklə geri zəng edəcəyini de. Sonra qısa sağollaş və end_call çağır.',
              turnComplete: true,
            });
          } catch {
            rawSend({ type: 'end_call', reason: 'transfer_failed' });
          }
        },
        onRepHangup: () => {
          console.log(`Sales rep hung up, ending telephony job ${telephonyJobId ?? 'none'}`);
          rawSend({ type: 'end_call', reason: 'sales_rep_hangup' });
        },
      }
    );
  };

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
  const callMemoryContext = await buildCallMemoryContextBounded(customer, agent);

  const forwardCustomerAudio = (data: string) => {
    if (transferState === 'dialing' || transferState === 'connected') {
      // Hold music and the rep conversation: keep recording, keep the bot out of it.
      broadcastMonitorAudio(telephonyJobId, { type: 'audio', role: 'customer', rate: 16000, data });
      recording?.add('customer', 16000, data);
      return;
    }
    if (sessionClosed) return;
    if (finalSilenceEndTimer) {
      if (pcm16RmsFromBase64(data) >= finalSilenceSpeechRms) {
        finalSilenceCustomerFrames += 1;
        if (finalSilenceCustomerFrames >= finalSilenceSpeechFrames) clearFinalSilenceEndTimer();
      } else {
        finalSilenceCustomerFrames = Math.max(0, finalSilenceCustomerFrames - 2);
      }
    }
    broadcastMonitorAudio(telephonyJobId, { type: 'audio', role: 'customer', rate: 16000, data });
    recording?.add('customer', 16000, data);
    try {
      session?.sendRealtimeInput({
        audio: { data, mimeType: 'audio/pcm;rate=16000' },
      });
    } catch (err) {
      console.warn('Gemini realtime input send failed', (err as Error)?.message);
    }
  };

  const flushPendingAudio = () => {
    if (!session || sessionClosed) return;
    while (pendingAudio.length > 0) {
      forwardCustomerAudio(pendingAudio.shift()!);
    }
  };

  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (msg.type === 'barge_in') {
        suppressMonitorAgent(msg.holdMs);
        pendingAudio.length = 0;
        recording?.clear('agent');
        broadcastMonitorEvent(telephonyJobId, { type: 'clear', role: 'agent' });
        return;
      }
      if (msg.type === 'call_ended') {
        broadcastMonitorEvent(telephonyJobId, { type: 'ended' });
        clientWs.close();
        return;
      }
      if (msg.type === 'monitor_agent') {
        const rate = Number(msg.rate || 16000);
        broadcastMonitorAudio(telephonyJobId, { type: 'audio', role: 'agent', rate, data: msg.data });
        recording?.add('agent', rate, msg.data);
        return;
      }
      if (msg.type === 'audio') {
        if (!session) {
          pendingAudio.push(msg.data);
          while (pendingAudio.length > maxPendingAudioFrames) pendingAudio.shift();
          return;
        }
        forwardCustomerAudio(msg.data);
      }
    } catch (e) {
      console.error('Bad client message', e);
    }
  });

  try {
    session = await ai.live.connect({
      model: 'gemini-3.1-flash-live-preview',
      callbacks: {
        onopen: async () => {
          console.log('Gemini session opened');
          telephonyJobId = await resolveTelephonyJobId(telephonyJobId, customer, agent);
          console.log(`Gemini telephony job ${telephonyJobId ?? 'none'} opened for customer=${customer.id} agent=${agent.id}`);
          await markTelephonyJobAnswered(telephonyJobId);
          recording = telephonyJobId ? new LiveCallRecording(telephonyJobId) : null;
          send({ type: 'connected' });
          if (initialGreetingEnabled) {
            session?.sendClientContent({
              turns: buildInitialGreetingPrompt(customer),
              turnComplete: true,
            });
          }
          flushPendingAudio();
          try {
            startedAt = new Date();
            // onopen can fire more than once for the same telephony job (the Gemini Live
            // session reconnecting after a transient drop) — reuse the existing calls row
            // instead of inserting a second one. Without this, clientWs.on('close') below
            // only updates whichever row's id this closure last saw as callId, leaving the
            // earlier row permanently orphaned (no endedAt/summary) — the duplicate rows seen
            // on the recordings page, since recordingRows() joins calls by telephony_job_id.
            const [existingCall] = telephonyJobId
              ? await db.select({ id: calls.id }).from(calls).where(eq(calls.telephonyJobId, telephonyJobId)).limit(1)
              : [];
            if (existingCall) {
              callId = existingCall.id;
            } else {
              const [newCall] = await db.insert(calls).values({
                agentId: agent.id,
                customerId: customer.id,
                telephonyJobId,
              }).returning({ id: calls.id });
              callId = newCall.id;
            }
          } catch (err) {
            console.error('Failed to insert call record', err);
          }
        },
        onmessage: (message: LiveServerMessage) => {
          const functionCalls = message.toolCall?.functionCalls || [];
          for (const functionCall of functionCalls) {
            const functionName = functionCall.name;
            if (!functionName) continue;

            if (functionName === 'end_call') {
              requestEndCall(String(functionCall.args?.reason || 'ai_requested'));
              if (!sessionClosed) {
                try {
                  session?.sendToolResponse({
                    functionResponses: [{
                      id: functionCall.id,
                      name: functionName,
                      response: { output: { accepted: true } },
                    }],
                  });
                } catch (err) {
                  console.warn('Gemini tool response send failed', (err as Error)?.message);
                }
              }
              continue;
            }

            if (functionName === 'transfer_to_sales') {
              const exts = pinnedReps.length ? pinnedReps : salesExtensionsFor(brand);
              const ok = transferState === 'idle' && !endCallRequested && exts.length > 0 && Boolean(telephonyJobId);
              if (ok) {
                transferState = 'pending';
                // Start once the hold sentence has been spoken (turnComplete); fallback after 4s.
                transferStartTimer = setTimeout(() => void beginTransfer(), 4000);
              }
              try {
                session?.sendToolResponse({
                  functionResponses: [{
                    id: functionCall.id,
                    name: functionName,
                    response: {
                      output: ok
                        ? { ok: true, message: 'Connecting the customer now. Say nothing more.' }
                        : { ok: false, error: 'Transfer is not available for this customer. Offer the branch visit or the *5665 call centre instead.' },
                    },
                  }],
                });
              } catch (err) {
                console.warn('Gemini tool response send failed', (err as Error)?.message);
              }
              continue;
            }

            if (isAiToolName(functionName)) {
              const toolName = functionName;
              void (async () => {
                try {
                  const output = await executeAiTool(toolName, functionCall.args || {}, {
                    customer: {
                      id: customer.id,
                      name: customer.name,
                      surname: customer.surname,
                      phone: customer.phone,
                    },
                    agent: {
                      id: agent.id,
                      name: agent.name,
                      companyName: agent.companyName,
                      phoneWhatsapp: agent.phoneWhatsapp,
                    },
                    telephonyJobId,
                  });

                  if (!sessionClosed) {
                    try {
                      session?.sendToolResponse({
                        functionResponses: [{
                          id: functionCall.id,
                          name: functionName,
                          response: { output },
                        }],
                      });
                    } catch (err) {
                      console.warn('Gemini tool response send failed', (err as Error)?.message);
                    }
                  }
                } catch (error) {
                  const message = error instanceof Error ? error.message : 'Tool execution failed';
                  console.error(`Tool ${toolName} failed`, error);
                  if (!sessionClosed) {
                    try {
                      session?.sendToolResponse({
                        functionResponses: [{
                          id: functionCall.id,
                          name: functionName,
                          response: { output: { ok: false, error: message } },
                        }],
                      });
                    } catch (err) {
                      console.warn('Gemini tool response send failed', (err as Error)?.message);
                    }
                  }
                }
              })();
            }
          }
          const part = message.serverContent?.modelTurn?.parts?.[0];
          if (part?.inlineData?.data && (transferState === 'dialing' || transferState === 'connected')) {
            // Bot is muted while the customer is on hold or talking to the rep.
          } else if (part?.inlineData?.data) {
            send({ type: 'audio', data: part.inlineData.data });
            if (!telephonyJobId && shouldForwardAgentToMonitor()) {
              broadcastMonitorAudio(telephonyJobId, { type: 'audio', role: 'agent', rate: 24000, data: part.inlineData.data });
              recording?.add('agent', 24000, part.inlineData.data);
            }
          }
          if (message.serverContent?.interrupted) {
            send({ type: 'interrupted' });
          }
          const outputText = (message.serverContent as any)?.outputTranscription?.text;
          if (outputText) {
            currentAgentTurn += outputText;
            send({ type: 'transcription', role: 'model', text: currentAgentTurn });
          } else if (message.serverContent?.modelTurn?.parts) {
            const text = message.serverContent.modelTurn.parts
              .map((p) => p.text ?? '')
              .join('');
            if (text) {
              currentAgentTurn += text;
              send({ type: 'transcription', role: 'model', text: currentAgentTurn });
            }
          }
          if (message.serverContent?.turnComplete && transferState === 'pending') {
            if (transferStartTimer) clearTimeout(transferStartTimer);
            // Let the queued hold sentence finish playing before the hold music starts.
            transferStartTimer = setTimeout(() => void beginTransfer(), 1500);
          }
          if (message.serverContent?.turnComplete && currentAgentTurn) {
            const completedAgentTurn = currentAgentTurn.trim();
            transcriptLines.push(`A: ${completedAgentTurn}`);
            if (endCallRequested) scheduleEndCallAfterTurn();
            else if (isFinalGoodbye(completedAgentTurn)) scheduleFinalSilenceEnd();
            currentAgentTurn = '';
          } else if (message.serverContent?.turnComplete && endCallRequested) {
            scheduleEndCallAfterTurn();
          }
          const inputText = (message.serverContent as any)?.inputTranscription?.text;
          if (inputText) {
            clearFinalSilenceEndTimer();
            send({ type: 'transcription', role: 'user', text: inputText });
            transcriptLines.push(`C: ${inputText}`);
          }
        },
        onclose: (event) => {
          console.warn('Gemini session closed', (event as any)?.code, (event as any)?.reason);
          reportGeminiError((event as any)?.reason);
          sessionClosed = true;
          // During a transfer the call continues without the bot.
          if (transferState === 'dialing' || transferState === 'connected' || transferState === 'pending') return;
          if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        },
        onerror: (err) => {
          console.error('Gemini error', err);
          reportGeminiError(err);
          send({ type: 'error', message: 'Gemini bağlantı xətası' });
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: agent.gender === 'male' ? 'Charon' : 'Zephyr' } },
        },
        // Pin the thinking level explicitly (env-configurable) rather than
        // relying on the model's default, since this is a preview model
        // and defaults can change between versions.
        thinkingConfig: { thinkingLevel: geminiThinkingLevel },
        systemInstruction: await buildSystemInstruction(customer, agent, callMemoryContext, baseTemplateId, dynamicContext),
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
            prefixPaddingMs: Math.max(40, Math.min(geminiVadPrefixPaddingMs, 300)),
            silenceDurationMs: Math.max(150, Math.min(geminiVadSilenceDurationMs, 1000)),
          },
        },
        tools: [{ functionDeclarations: [endCallFunctionDeclaration, ...(customer.sourceSystem === 'arzoom' ? [transferFunctionDeclaration] : []), ...((customer.sourceSystem === 'arzoom'
          // ARZOOM applicants upload documents in their cabinet, never over WhatsApp.
          ? (aiToolDeclarations as any[]).filter((d) => d?.name !== 'send_whatsapp_msg')
          : aiToolDeclarations) as any[])] }],
      },
    });
    flushPendingAudio();
  } catch (err) {
    console.error('Gemini connect failed', err);
    reportGeminiError(err);
    send({ type: 'error', message: 'Gemini-yə qoşulmaq mümkün olmadı' });
    clientWs.close();
    return;
  }

  clientWs.on('close', async () => {
    broadcastMonitorEvent(telephonyJobId, { type: 'ended' });
    if (transferStartTimer) clearTimeout(transferStartTimer);
    if (transferHandle) await transferHandle.cancel().catch(() => {});
    if (endCallTimer) clearTimeout(endCallTimer);
    clearFinalSilenceEndTimer();
    if (!sessionClosed && session) {
      try {
        session.close();
      } catch (err) {
        console.warn('Gemini session close failed', (err as Error)?.message);
      }
    }
    await markTelephonyJobEnded(telephonyJobId);
    let savedRecordingPath: string | null = null;
    try {
      savedRecordingPath = await recording?.save() || null;
    } catch (err) {
      console.error('Failed to save call recording', err);
    }
    if (callId) {
      try {
        const endedAt = new Date();
        const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
        // Gemini is billed only until the rep took over.
        const botSeconds = transferConnectedAt
          ? Math.round((transferConnectedAt.getTime() - startedAt.getTime()) / 1000)
          : durationSeconds;
        await recordLiveEstimatedUsage({ callId, durationSeconds: botSeconds });
        const liveTranscript = transcriptLines.length > 0 ? transcriptLines.join('\n') : null;
        let finalTranscript = liveTranscript;
        try {
          if (savedRecordingPath) {
            finalTranscript = await transcribeCallRecording(savedRecordingPath, {
              agentName: agent.name,
              customerName: customer.name,
              customerSurname: customer.surname,
              fallbackTranscript: liveTranscript,
            }) || liveTranscript;
          }
        } catch (err) {
          console.error('Failed to build post-call transcript', err);
        }
        const isArzoom = customer.sourceSystem === 'arzoom';
        await db.update(calls).set({
          endedAt,
          durationSeconds,
          transcript: finalTranscript,
          // The generic summary uses debt-collection categories; ARZOOM calls get the
          // recorded application result instead (below).
          summary: isArzoom ? null : await summarizeTranscriptWithAi(finalTranscript),
        }).where(eq(calls.id, callId));
        if (isArzoom) {
          await ensureArzoomFeedbackFromTranscript({
            customerId: customer.id,
            telephonyJobId,
            startedAt,
            transcript: finalTranscript,
          }).catch((err) => console.error('Failed to save ARZOOM feedback', err));
          if (telephonyJobId) {
            await db.execute(sql`
              UPDATE calls SET summary = (
                SELECT concat_ws(' — ', outcome_label, nullif(reason, '')) FROM arzoom_feedback
                WHERE telephony_job_id = ${telephonyJobId} ORDER BY id DESC LIMIT 1
              ) WHERE id = ${callId}
            `).catch((err) => console.error('Failed to set ARZOOM call summary', err));
          }
        }
      } catch (err) {
        console.error('Failed to update call record', err);
      }
    }
  });
}
