import { WebSocket } from 'ws';
import { PhoneAudio } from './phone-audio.js';
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
import { EXCEL_SOURCE, ensureCampaignResultFromTranscript, excelCallContext, excelCustomerLines, recordCampaignResult, tradeInTerms } from '../campaign-results.js';
import { pinnedExtensions, recordTransferIssue, salesExtensionsFor, startSalesTransfer, type TransferHandle } from '../sales-transfer.js';

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
// How long the customer must be silent before the bot answers. 250 ms cut people off mid-sentence
// (the bot answered early, then got interrupted and repeated itself); 700 ms lets them finish.
const geminiVadSilenceDurationMs = Number(process.env.GEMINI_VAD_SILENCE_DURATION_MS || 700);
// Audio kept from before speech was detected, so the first syllable is not lost.
const geminiVadPrefixPaddingMs = Number(process.env.GEMINI_VAD_PREFIX_PADDING_MS || 200);
// LOW: a customer's "alo" or line noise over the greeting no longer cuts the bot off (it then
// restarted the greeting: 39 of 220 calls on 18.11); real speech still interrupts it.
const geminiVadStartSensitivity = String(process.env.GEMINI_VAD_START_SENSITIVITY || 'low').toLowerCase() === 'high'
  ? StartSensitivity.START_SENSITIVITY_HIGH : StartSensitivity.START_SENSITIVITY_LOW;
// LOW: a short pause inside a sentence does not count as the end of the customer's turn.
const geminiVadEndSensitivity = String(process.env.GEMINI_VAD_END_SENSITIVITY || 'low').toLowerCase() === 'high'
  ? EndSensitivity.END_SENSITIVITY_HIGH : EndSensitivity.END_SENSITIVITY_LOW;
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
  description: 'Connect the customer to a live sales representative. Call it ONLY when the customer asked to be connected or clearly said yes to your question whether to connect them; never because they asked a question (answer questions yourself, with search_knowledge_base). First tell them to stay on the line for a few seconds. Say nothing after calling it.',
  parameters: { type: Type.OBJECT, properties: {} },
};

// Phone line, Azerbaijani speakers: how to listen. Short or unclear replies were taken as "yes",
// and the bot repeated whole sentences after being cut off.
const LISTENING_INSTRUCTION = `

SƏS TONU: həmişə yumşaq, sakit, isti və nəzakətli danış, gülümsəyərək danışırmış kimi. Sərt, kobud, quru və ya əmredici ton işlətmə, səsini qaldırma.

TƏLƏFFÜZ: Bakılı azərbaycanlı kimi, doğma Azərbaycan aksenti ilə danış, türk (Türkiyə) aksenti ilə YOX. "ə" səsini açıq və aydın de ("əla", "mərkəz", "təklif" — "ela", "merkez", "teklif" yox). "q" səsini Azərbaycan dilindəki kimi qalın de ("qiymət", "qoşuram" — "kiymet", "koşuram" yox). "x" səsini aydın de ("xahiş", "xəttə"). Türk intonasiyasını və melodiyasını işlətmə, sakit, düz Bakı danışığı ilə danış.

DİL: Yalnız Azərbaycan dilində (Bakı danışığı) danış. Zəngi həmişə Azərbaycan dilində başla və Azərbaycan dilində davam et, başqa dilə özbaşına keçmə. Müştəriyə dil haqqında sual HEÇ VAXT vermə ("Azərbaycan dilində danışa bilərik?", "hansı dildə danışaq?" və s. QADAĞANDIR). Xətt zəif olanda və ya müştərinin sözü başqa dilə oxşayanda da Azərbaycan dilində davam et. Yalnız müştəri bir neçə tam cümləni aydın rus dilində deyirsə, rus dilində cavab ver. İspan, ingilis, portuqal və ya hər hansı başqa dildə bir söz belə demə ("Entiendo", "okay" və s.). Türkiyə türkcəsi sözləri və şəkilçiləri QADAĞANDIR: "evet" yox "bəli", "tamam" yox "oldu/yaxşı", "şimdi" yox "indi", "nasıl" yox "necə", "araç/araba" yox "maşın", "bilgi" yox "məlumat", "lütfen" yox "zəhmət olmasa", "teşekkür ederim" yox "təşəkkür edirəm", "efendim" yox "buyurun", "görüşme" yox "görüş", "yardımcı olmak" yox "kömək etmək", "-iyor" yox "-ır/-ir" ("geliyor" yox "gəlir"), "fiyat" yox "qiymət", "kredi" yox "kredit", "hemen" yox "dərhal", "değil" yox "deyil", "var mı" yox "varmı/var?".

DİNLƏMƏ QAYDALARI:
- BİLİK BAZASI MÜTLƏQDİR: müştəri hər hansı sual verəndə (maşın, model, qiymət, komplektasiya, motor, kredit, faiz, ilkin ödəniş, sənədlər, kampaniya şərtləri, ünvan, filial, iş saatları, servis, zəmanət və s.) cavab verməzdən ƏVVƏL HƏR DƏFƏ search_knowledge_base alətini çağır, cavabı bildiyini düşünsən belə. Eyni mövzuda yeni sual gəlsə, yenə çağır. Gözləyərkən yalnız "Bir saniyə, baxım" de. Cavabı yalnız bazadan gələn məlumatla ver. Bazada yoxdursa, uydurma, "bu barədə dəqiq məlumatı mərkəzdə deyə bilərlər" de. Yalnız salamlaşma, "kimsiniz?" və "danışmağa vaxtınız var?" kimi danışıq cavablarında bazaya baxmaq lazım deyil.
- Müştərinin bütün suallarına (qiymət, model, komplektasiya, kredit, sənədlər, filial) ÖZÜN cavab ver, lazım olsa search_knowledge_base alətindən istifadə et. Müştərini nümayəndəyə YALNIZ o özü istəyəndə və ya "qoşum?" sualına açıq "bəli" deyəndə qoş. Sualı cavablandırmamaq üçün nümayəndəyə qoşma.
- Müştəri Azərbaycan dilində danışır (bəzən rus dilində). Telefon xətti zəifdir: eşitdiyin söz başqa dilə oxşayırsa, bu, Azərbaycan dilində qısa bir sözdür ("alo", "bəli", "hə", "buyurun", "yox").
- Müştərinin cavabını aydın başa düşmədinsə, razılıq kimi qəbul etmə. Nəzakətlə bir dəfə qısa soruş: "Bağışlayın, xətt bir az zəifdir, təkrar edə bilərsiniz?"
- Müştəri danışarkən heç vaxt danışma, onun cümləsini bitirməsini gözlə.
- Müştəri sözünü kəssə, əvvəlki cümləni əvvəldən təkrarlama. Onun dediyinə cavab ver, lazım olsa yarımçıq fikri bir qısa cümlə ilə tamamla.
- Eyni cümləni və ya təklifi iki dəfə eyni sözlərlə demə. Müştəri eyni sualı yenidən verirsə, deməli əvvəlki cavab ona aydın olmayıb: başqa, daha konkret sözlərlə cavab ver.
- Canlı danışıq Azərbaycan dilində danış, tərcümə dili kimi yox: qısa cümlələr (bir cavabda 1-2 cümlə), sadə sözlər, rəsmi kitab dili işlətmə.
- Salamlaşmanı ("Alo, salam…") zəngdə yalnız bir dəfə de. Müştəri onun üstündən "alo", "bəli" desə, salamlaşmanı təkrarlama: qısa "Bəli, eşidirəm" de və növbəti cümləyə keç.
- Müştəri sual veribsə, əvvəl onun sualına cavab ver, sonra ssenari ilə davam et.
- Müştəri mövzudan kənar bir şey desə (məs. "boğazım ağrıyır"), qısa və mehriban reaksiya ver, sonra yarımçıq qalan addımı tamamla (məs. linki göndərməyə razılığını soruş). Mövzunu dəyişmə.
- Müştəri özü xahiş etməyibsə və ya "indi vaxtım yoxdur" deməyibsə, "nə vaxt zəng edək" soruşma.
- Heç vaxt ingiliscə danışma, ingiliscə söz demə ("no speech", "silence", "noise", "okay", "hello" və s.). Müştəri susursa və ya heç nə eşitmirsənsə, Azərbaycan dilində de: "Alo, eşidirsinizmi?" İki dəfə cavab gəlməsə, "Görünür, xətt kəsilir, sizə sonra zəng edərik. Sağ olun" de və end_call çağır.
- Heç vaxt texniki söz səsləndirmə: alət adları (transfer_to_sales, record_campaign_result, end_call), "alət", "funksiya", "sistem", "[Sistem]", "outcome", "status", mötərizədəki qeydlər, ingiliscə terminlər. Alət çağıranda müştəriyə yalnız adi insan cümləsi de, məsələn: "Bir neçə saniyə xətdə qalın, sizi satış nümayəndəmizə qoşuram."
- Sağollaşmazdan və zəngi bitirməzdən əvvəl HƏMİŞƏ soruş: "Başqa sualınız və ya istəyiniz varmı?" və cavabı gözlə. Varsa, cavab ver; yoxdursa, təşəkkür edib sağollaş. (Nümayəndəyə qoşanda bunu soruşma.)
- Zəngi bitirməzdən əvvəl müştərinin son sözünə bax: sual verib ("Sən kimsən?", "Hardan zəng edirsiniz?", "Nə təklifdir?"), cavabsız qoyub sağollaşma. Əvvəl qısa cavab ver (öz adını və hansı şirkətdən zəng etdiyini de), sonra lazım olsa sağollaş.`;

async function buildSystemInstruction(customer: Customer, agent: Agent, callMemoryContext = '', baseTemplateId: string | null = null, dynamicContext: string | null = null, excel: { segment: string | null; canTransfer: boolean; params?: Record<string, unknown> | null } | null = null): Promise<string> {
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
  // Every occurrence, and the tone text first, so placeholders inside it are filled too
  // ("{COMPANY_NAME}" was read out loud on a call).
  let instruction = withContext
    .split('{TONE_INSTRUCTION}').join(toneInstruction)
    .split('{AGENT_NAME}').join(agent.name)
    .split('{COMPANY_NAME}').join(agent.companyName ?? 'şirkətin')
    .split('{WHATSAPP_PHONE}').join(agent.phoneWhatsapp ?? 'təyin edilməyib');
  
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
  // Customers imported from Excel (service / credit-offer campaigns).
  if (excel) parts.push(...excelCustomerLines((customer as { importData?: unknown }).importData, excel.segment, { canTransfer: excel.canTransfer, params: excel.params }));
  const legacyGuide = customer.sourceSystem === 'arzoom' || customer.sourceSystem === EXCEL_SOURCE ? '' : buildSummaryCategoryGuide();
  
  return `${instruction}${FACT_GROUNDING_INSTRUCTION}${LISTENING_INSTRUCTION}${partnerKbInstruction()}${END_CALL_INSTRUCTION}\n\nMüştəri məlumatları:\n${parts.join('\n')}${callMemoryContext}${legacyGuide}`;
}

function buildInitialGreetingPrompt(customer: Customer, segment: string | null = null, params: Record<string, unknown> | null = null) {
  const fullName = [customer.name, customer.surname]
    .filter((p) => p && p.trim() !== '-')
    .join(' ')
    .trim();
  // Churn campaign: the company greeting comes first (see CHURN SSENARİSİ in the customer data).
  if (segment === 'credit_offer') {
    return `Telefon zəngi indi cavablandı. Müştərinin bir neçə dəfə "alo" deməsini gözləmə. Dərhal səsli şəkildə bir dəfə qısa başla: "Alo, salam, hörmətli müştəri, sizi Group Motors şirkətindən salamlayıram. Danışmağa vaxtınız var?" Bundan sonra cavabı gözlə. Müştəri açıq razılıq verməyincə ("bəli", "var", "buyurun", "danışa bilərəm") təklifin detallarını DANIŞMA. "Alo", "hə?", "eşitmirəm" razılıq DEYİL: müştəri səni eşitməyib, qısa təkrar et: "Bəli, eşidirsiniz? Toyota Abşeron Mərkəzindən narahat edirik, danışmağa vaxtınız var?" Müştəri razılıq əvəzinə sual versə (məs. "Kimsiniz?", "Kim danışır?"), yalnız o suala qısa cavab ver və yenidən soruş: "Danışmağa vaxtınız var?" Razılıq verəndən sonra CHURN SSENARİSİ ilə davam et.`;
  }
  if (segment === 'trade_in') {
    const { company, model } = tradeInTerms(params);
    return `Telefon zəngi indi cavablandı. Müştərinin bir neçə dəfə "alo" deməsini gözləmə. Dərhal səsli şəkildə bir dəfə qısa başla, təklifi hələ demə: "Alo, salam, hörmətli müştəri, ${company} narahat edirik. Danışmağa vaxtınız var?" Bundan sonra cavabı gözlə. Müştəri açıq razılıq verməyincə ("bəli", "var", "buyurun", "danışa bilərəm") təklifin detallarını DANIŞMA. "Alo", "hə?", "eşitmirəm" razılıq DEYİL: müştəri səni eşitməyib, qısa təkrar et: "Bəli, eşidirsiniz? Toyota Abşeron Mərkəzindən narahat edirik, danışmağa vaxtınız var?" Müştəri razılıq əvəzinə sual versə (məs. "Kimsiniz?", "Kim danışır?"), yalnız o suala qısa cavab ver və yenidən soruş: "Danışmağa vaxtınız var?" Razılıq verəndən sonra TRADE-IN SSENARİSİ ilə davam et.`;
  }
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
  // A turn in a foreign language (Spanish, English...) is muted and replaced by an Azerbaijani one.
  // Azerbaijani never uses these letters; the words are ones the model said on calls.
  let foreignTurn = false;
  const FOREIGN_SPEECH = /[áéíóúñ¿¡ãõâê]|\b(entiendo|comunique|gustaría|representante|vehículo|usted|gracias|señor|claro que|por favor|okay|sorry|of course|i understand|thank you|no speech|silence)\b/i;
  // When the bot's queued speech will have finished playing on the line (audio arrives faster than real time).
  let playoutEndsAt = 0;
  const msUntilPlayedOut = () => Math.max(0, playoutEndsAt - Date.now());
  const phoneAudio = new PhoneAudio();
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
  // 'awaiting_rep': a queue (e.g. 6434) took the call at once; the bot listens silently until a live rep speaks.
  let transferState: 'idle' | 'pending' | 'dialing' | 'awaiting_rep' | 'briefing' | 'connected' = 'idle';
  const queueWaitMs = Math.max(20, Math.min(Number(process.env.SALES_QUEUE_WAIT_SECONDS || 150), 600)) * 1000;
  let briefingText = '';
  let repHeard = '';
  let lastModelAudioAt = 0;
  let startQueueBriefing: (by: 'greeting' | 'bot') => void = () => {};
  // A live rep picking up in the queue: "Alo", "Salam", "Buyurun", "Bəli", "Eşidirəm", "Toyota ..., Tərlan, buyurun".
  const REP_GREETING = /(al+o|hello|salam|buyur|bəli|beli|eşidirəm|esidirem|eşidir|danışır|danisir|xoş|слушаю|алло|ало|здравствуйте|да,)/i;
  let briefingTimer: ReturnType<typeof setTimeout> | null = null;
  let transferHandle: TransferHandle | null = null;
  let transferStartTimer: NodeJS.Timeout | null = null;
  let transferConnectedAt: Date | null = null;
  const brand = (customer as { arzoomData?: { brand?: string } | null }).arzoomData?.brand ?? null;
  const pinnedReps = pinnedExtensions((customer as { arzoomData?: unknown }).arzoomData);
  const isExcel = customer.sourceSystem === EXCEL_SOURCE;
  // Service campaigns: the campaign's service-rep extensions (empty = no live transfer).
  let excelCtx: { segment: string | null; transferExtensions: string[]; params?: Record<string, unknown> | null } | null = null;
  const transferExtensions = () => (isExcel ? excelCtx?.transferExtensions ?? [] : pinnedReps.length ? pinnedReps : salesExtensionsFor(brand));
  const rawSend = (msg: ServerMessage) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(msg));
  };

  const suppressMonitorAgent = (holdMs = monitorBargeInHoldMs) => {
    const boundedHoldMs = Math.max(200, Math.min(Number(holdMs) || monitorBargeInHoldMs, 3000));
    suppressMonitorAgentUntil = Math.max(suppressMonitorAgentUntil, Date.now() + boundedHoldMs);
  };

  const shouldForwardAgentToMonitor = () => Date.now() >= suppressMonitorAgentUntil;

  // Plays one chunk of the bot's audio on the line.
  const playAgentAudio = (data: string) => {
    if (telephonyJobId) {
      // Phone line: filtered for 8 kHz so it does not crackle (see phone-audio.ts).
      const phone = phoneAudio.process(data);
      if (phone) {
        send({ type: 'audio', data: phone });
        // 24 kHz PCM16 = 48 bytes per ms.
        playoutEndsAt = Math.max(playoutEndsAt, Date.now()) + Buffer.byteLength(phone, 'base64') / 48;
      }
    } else {
      send({ type: 'audio', data });
      if (shouldForwardAgentToMonitor()) {
        broadcastMonitorAudio(telephonyJobId, { type: 'audio', role: 'agent', rate: 24000, data });
        recording?.add('agent', 24000, data);
      }
    }
  };
  // In the queue the bot's audio is held back (muted) per turn. When the turn is the briefing
  // (the bot heard a live rep before our greeting check did), it is played from its start.
  let queueTurnAudio: string[] = [];
  const BRIEFING_START = /xətdədir|xəttdədir|xetdedir|xettdedir|müştəri xət|musteri xet/i;

  // After the bot's goodbye the line goes quiet; the model then sometimes said things like
  // "no speech" in English. Nothing it says after the goodbye is played, unless the customer talks again.
  let afterGoodbye = false;
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


  let transferWaitStartedAt = 0;
  let transferRequestedAt = 0;
  let queueRedials = 0;
  const maxQueueRedials = Math.max(0, Math.min(Number(process.env.SALES_QUEUE_REDIALS || 3), 10));
  const beginTransfer = async () => {
    if (transferState !== 'pending') return;
    // Never move the customer to hold while they are still speaking (it cut them off mid-sentence).
    if (!transferWaitStartedAt) transferWaitStartedAt = Date.now();
    if (Date.now() - lastCustomerSpeechAt < 1000 && Date.now() - transferWaitStartedAt < 3000) {
      if (transferStartTimer) clearTimeout(transferStartTimer);
      transferStartTimer = setTimeout(() => void beginTransfer(), 300);
      return;
    }
    transferWaitStartedAt = 0;
    if (transferStartTimer) clearTimeout(transferStartTimer);
    transferStartTimer = null;
    transferState = 'dialing';
    clearFinalSilenceEndTimer();
    console.log(`Sales transfer started for telephony job ${telephonyJobId ?? 'none'} brand=${brand ?? '-'} (${transferRequestedAt ? Date.now() - transferRequestedAt : '?'} ms after the request)`);
    transferHandle = await startSalesTransfer(
      {
        telephonyJobId, customerId: customer.id, brand, callerId: customer.phone || null,
        // Shown on the rep's phone while it rings, so the rep knows a robocall customer is coming.
        callerName: `ArzoomCall ${isExcel ? (excelCtx?.segment === 'trade_in' ? String(excelCtx?.params?.model || 'Trade-in') : excelCtx?.segment === 'credit_offer' ? 'Kredit' : 'Servis') : 'Kredit'}`.slice(0, 20),
        extensions: isExcel ? transferExtensions() : pinnedReps,
      },
      {
        onConnected: (ext, briefed) => {
          transferState = 'connected';
          transferConnectedAt = new Date();
          transcriptLines.push(`[${isExcel && excelCtx?.segment !== 'trade_in' ? 'Servis nümayəndəsinə' : 'Satış təmsilçisinə'} qoşuldu: ${ext}]`);
          if (isExcel) {
            void recordCampaignResult({
              customerId: customer.id,
              telephonyJobId,
              outcome: 'transferred_to_rep',
              reason: `Müştəri təklifə razılaşdı və ${ext} daxili nömrəli ${excelCtx?.segment === 'trade_in' ? 'satış' : 'servis'} nümayəndəsinə qoşuldu.`,
            }).catch(() => {});
          } else void recordArzoomFeedback({
            customerId: customer.id,
            telephonyJobId,
            outcome: 'transferred_to_sales',
            reason: `Müştəri şərtlərlə razılaşdı və ${ext} daxili nömrəli satış təmsilçisinə qoşuldu.`,
          }).catch(() => {});
          // Warm hand-off: the bot tells the rep in one or two sentences who is on the line and
          // what they want, then leaves; the call stays up until the customer or the rep hangs up.
          const leave = () => {
            if (briefingTimer) clearTimeout(briefingTimer);
            briefingTimer = null;
            transferState = 'connected';
            send({ type: 'interrupted' });
            playoutEndsAt = 0;
            void transferHandle?.joinCustomer();
            if (!sessionClosed && session) {
              try {
                session.close();
              } catch {}
            }
          };
          // No private line to the rep: the customer would hear the briefing, so the bot leaves silently.
          if (!briefed) console.warn(`Sales transfer job ${telephonyJobId ?? 'none'}: no private briefing, bot leaves without briefing`);
          if (sessionClosed || !session || !briefed) return leave();
          const campaignText = isExcel
            ? excelCtx?.segment === 'trade_in'
              ? `${String(excelCtx?.params?.model || 'Corolla')} trade-in kampaniyası`
              : excelCtx?.segment === 'credit_offer' ? 'kredit (churn) kampaniyası' : 'servis kampaniyası'
            : 'ARZOOM kredit müraciəti';
          briefingText = `Nümayəndəyə cəmi 3 qısa cümlə de, artıq heç nə əlavə etmə. 1) Dərhal: "Salam, müştəri xəttdədir, ${campaignText}." 2) Bir cümlə ilə müştərinin istəyi: maşını barterlə (köhnəsini verib yenisini almaq) və ya kreditlə almaq istəyir, danışıqda müştəri hansını dedisə onu de, məsələn: "Müştəri köhnə maşınını verib yenisini barterlə almaq istəyir" və ya "Müştəri yeni maşını kreditlə almaq istəyir". Müştəri ikisindən heç birini aydın deməyibsə: "Müştəri barter və ya kredit şərtləri ilə maraqlanır." 3) "İndi sizi müştəri ilə birləşdirirəm." Sonra sus. Bilmədiyini uydurma, heç bir alət çağırma.`;
          // A single number is a queue: it answers at once with music, the rep comes later.
          const queue = transferExtensions().length === 1;
          try {
            if (queue) {
              transferState = 'awaiting_rep';
              session.sendClientContent({
                turns: `[Sistem] Zəng satış növbəsinə qoşuldu. Müştəri səni EŞİTMİR (gözləmə musiqisindədir). Növbədə musiqi və avtomatik elanlar eşidəcəksən: onlara heç nə demə. Canlı nümayəndə "Alo", "Salam", "Buyurun" deyən kimi DƏRHAL, gecikmədən danış. ${briefingText}`,
                turnComplete: true,
              });
              repHeard = '';
              startQueueBriefing = (by) => {
                if (transferState !== 'awaiting_rep' || sessionClosed || !session) return;
                transferState = 'briefing';
                if (briefingTimer) clearTimeout(briefingTimer);
                // The bot was told to start on the greeting and is often already briefing (muted until
                // now): play that turn from its start. Before, a muted briefing was lost and the rep
                // heard nothing for 25-30 s.
                const briefingHeld = BRIEFING_START.test(currentAgentTurn) && queueTurnAudio.length > 0;
                console.log(`Sales transfer job ${telephonyJobId ?? 'none'}: rep answered in the queue (${by === 'bot' ? 'bot heard the rep' : 'greeting'}), briefing${briefingHeld ? ' (already talking)' : ''}`);
                const held = queueTurnAudio;
                queueTurnAudio = [];
                if (briefingHeld) {
                  for (const chunk of held) playAgentAudio(chunk);
                  briefingTimer = setTimeout(leave, 30000);
                  return;
                }
                currentAgentTurn = '';
                try {
                  session.sendClientContent({
                    turns: `[Sistem] Satış nümayəndəsi indi xəttə çıxdı və salam verdi. Müştəri hələ səni EŞİTMİR. İndi yalnız nümayəndə ilə danışırsan. ${briefingText}`,
                    turnComplete: true,
                  });
                  briefingTimer = setTimeout(leave, 30000);
                } catch {
                  leave();
                }
              };
              briefingTimer = setTimeout(leave, queueWaitMs);
            } else {
              transferState = 'briefing';
              session.sendClientContent({
                turns: `[Sistem] Satış nümayəndəsi indi xəttə qoşuldu. Müştəri hələ səni və nümayəndəni EŞİTMİR (gözləmə musiqisindədir), indi yalnız nümayəndə ilə danışırsan. ${briefingText}`,
                turnComplete: true,
              });
              briefingTimer = setTimeout(leave, 25000);
            }
          } catch {
            leave();
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
              turns: isExcel
                ? '[Sistem] Nümayəndələr hazırda cavab vermir. Müştəridən gözlətdiyin üçün üzr istə, nümayəndənin ona tezliklə geri zəng edəcəyini de, record_campaign_result alətini outcome=wants_rep_contact ilə çağır, sonra qısa sağollaş və end_call çağır.'
                : '[Sistem] Satış təmsilçiləri hazırda cavab vermir. Müştəridən gözlətdiyin üçün üzr istə, filiala yaxınlaşa və ya *5665 nömrəsinə zəng edə biləcəyini, ya da təmsilçinin ona tezliklə geri zəng edəcəyini de. Sonra qısa sağollaş və end_call çağır.',
              turnComplete: true,
            });
          } catch {
            rawSend({ type: 'end_call', reason: 'transfer_failed' });
          }
        },
        onRepHangup: () => {
          // The queue (e.g. 6434) dropped the call before the customer was put through (no agent
          // picked up in time): dial it again instead of ending the customer's call.
          if (transferState === 'awaiting_rep' || transferState === 'briefing') {
            if (briefingTimer) clearTimeout(briefingTimer);
            briefingTimer = null;
            transferHandle = null;
            if (queueRedials < maxQueueRedials && !sessionClosed && session) {
              queueRedials += 1;
              console.log(`Sales queue dropped before the customer joined, redial ${queueRedials}/${maxQueueRedials} for job ${telephonyJobId ?? 'none'}`);
              transferState = 'pending';
              transferWaitStartedAt = Date.now() - 10000; // the customer is on hold: start at once
              void beginTransfer();
              return;
            }
            console.warn(`Sales queue dropped ${queueRedials + 1} times, giving up for job ${telephonyJobId ?? 'none'}`);
            transferState = 'idle';
            transcriptLines.push('[Satış təmsilçisinə qoşmaq alınmadı]');
            if (sessionClosed || !session) { rawSend({ type: 'end_call', reason: 'transfer_failed' }); return; }
            try {
              session.sendClientContent({
                turns: '[Sistem] Nümayəndələr hazırda cavab vermir. Müştəridən gözlətdiyin üçün üzr istə, nümayəndənin ona tezliklə geri zəng edəcəyini de, record_campaign_result alətini outcome=wants_rep_contact ilə çağır, sonra qısa sağollaş və end_call çağır.',
                turnComplete: true,
              });
            } catch { rawSend({ type: 'end_call', reason: 'transfer_failed' }); }
            return;
          }
          console.log(`Sales rep hung up, ending telephony job ${telephonyJobId ?? 'none'}`);
          rawSend({ type: 'end_call', reason: 'sales_rep_hangup' });
        },
      }
    );
  };

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
  const callMemoryContext = await buildCallMemoryContextBounded(customer, agent);
  if (isExcel) excelCtx = await excelCallContext(jobId, customer.id).catch(() => ({ segment: null, transferExtensions: [], params: null }));

  // The telephony side only passes audio while the customer seems to speak, so the model got
  // speech in bursts with no silence between them and could not tell when a phrase ended.
  // Gaps are filled with silence, so the model hears a continuous line.
  let lastCustomerAudioAt = Date.now();
  // Real speech only (line noise also reaches us), used to avoid cutting the customer off.
  let lastCustomerSpeechAt = 0;
  const SILENCE_100MS = Buffer.alloc(3200).toString('base64'); // 16 kHz PCM16, 100 ms
  const silenceFiller = setInterval(() => {
    if (sessionClosed || !session || transferState !== 'idle' || afterGoodbye) return;
    if (Date.now() - lastCustomerAudioAt < 150) return;
    try { session.sendRealtimeInput({ audio: { data: SILENCE_100MS, mimeType: 'audio/pcm;rate=16000' } }); } catch { /* closed */ }
  }, 100);
  clientWs.once('close', () => clearInterval(silenceFiller));

  const forwardCustomerAudio = (data: string) => {
    lastCustomerAudioAt = Date.now();
    // While the bot's own voice plays, its echo comes back on the line: that is not the customer.
    if (Date.now() > playoutEndsAt + 300 && pcm16RmsFromBase64(data) >= finalSilenceSpeechRms) lastCustomerSpeechAt = Date.now();
    if (transferState === 'awaiting_rep') {
      // The bot's line is in the queue now: what it hears is the queue or the rep, never the customer.
      if (!sessionClosed && session) {
        try { session.sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } }); } catch {}
      }
      return;
    }
    if (transferState === 'dialing' || transferState === 'briefing' || transferState === 'connected') {
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

  // Live model: GEMINI_LIVE_MODEL for everyone; GEMINI_LIVE_TEST_MODEL only for the numbers in
  // GEMINI_LIVE_TEST_PHONES (last digits are enough), to try a new model on a test call first.
  const testPhones = String(process.env.GEMINI_LIVE_TEST_PHONES || '').split(/[,\s]+/).map((p) => p.replace(/\D/g, '')).filter((p) => p.length >= 7);
  const phoneDigits = String(customer.phone || '').replace(/\D/g, '');
  const isTestPhone = !!process.env.GEMINI_LIVE_TEST_MODEL && testPhones.some((p) => phoneDigits.endsWith(p));
  const liveModel = (isTestPhone ? process.env.GEMINI_LIVE_TEST_MODEL : process.env.GEMINI_LIVE_MODEL) || 'gemini-3.8-live';
  // Optional test voice for the same numbers, e.g. a female voice with a female name.
  const testVoice = isTestPhone || (process.env.GEMINI_LIVE_TEST_VOICE && testPhones.some((p) => phoneDigits.endsWith(p)))
    ? String(process.env.GEMINI_LIVE_TEST_VOICE || '').trim() : '';
  // Voice and spoken name for every call (GEMINI_LIVE_VOICE, GEMINI_LIVE_AGENT_NAME); the test values above win on test numbers.
  const prodVoice = String(process.env.GEMINI_LIVE_VOICE || '').trim();
  const testAgentName = testVoice
    ? String(process.env.GEMINI_LIVE_TEST_AGENT_NAME || '').trim()
    : (prodVoice ? String(process.env.GEMINI_LIVE_AGENT_NAME || '').trim() : '');
  const voiceName = testVoice || prodVoice || (agent.gender === 'male' ? 'Charon' : 'Zephyr');
  if (isTestPhone || testVoice) console.log(`Live test model ${liveModel}, voice ${voiceName} for job ${telephonyJobId ?? 'none'}`);

  try {
    session = await ai.live.connect({
      model: liveModel,
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
              turns: buildInitialGreetingPrompt(customer, isExcel ? excelCtx?.segment ?? null : null, isExcel ? excelCtx?.params ?? null : null),
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
            // During a hand-off the bot only talks to the queue or the rep: no tool may end or change the call.
            if (transferState === 'pending' || transferState === 'dialing' || transferState === 'awaiting_rep' || transferState === 'briefing' || transferState === 'connected') {
              console.warn(`Ignored tool ${functionName} during transfer (${transferState}) for job ${telephonyJobId ?? 'none'}`);
              try {
                session?.sendToolResponse({ functionResponses: [{ id: functionCall.id, name: functionName, response: { output: { accepted: false, reason: 'transfer in progress' } } }] });
              } catch {}
              continue;
            }

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
              const exts = transferExtensions();
              const ok = transferState === 'idle' && !endCallRequested && exts.length > 0 && Boolean(telephonyJobId);
              if (!ok && transferState === 'idle') {
                void recordTransferIssue({
                  telephonyJobId, customerId: customer.id, brand,
                  status: exts.length ? 'call_gone' : 'not_configured',
                  reason: exts.length ? 'Zəng bitmək üzrə idi, ötürmə başlamadı' : 'Bu kampaniya/marka üçün nümayəndə nömrəsi yazılmayıb',
                });
              }
              if (ok) {
                transferRequestedAt = Date.now();
                transferState = 'pending';
                // Start once the hold sentence has been spoken (turnComplete); fallback after 4s.
                // The hold sentence is often spoken before the tool call, so no turnComplete follows:
                // start as soon as whatever is queued has played (it waited a fixed 4 s, heard as a gap).
                const startWhenQuiet = () => {
                  const left = msUntilPlayedOut();
                  if (left > 0) { transferStartTimer = setTimeout(startWhenQuiet, left + 300); return; }
                  void beginTransfer();
                };
                transferStartTimer = setTimeout(startWhenQuiet, 1200);
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
          // Every audio part of the turn is played (a message can carry more than one).
          for (const part of message.serverContent?.modelTurn?.parts ?? []) {
            const data = part?.inlineData?.data;
            if (!data) continue;
            lastModelAudioAt = Date.now();
            // Bot is muted while the customer is on hold or talking to the rep.
            // In the queue the bot is muted until a live rep has greeted (it answered queue music before);
            // its audio is kept in case this turn is the briefing.
            if (transferState === 'awaiting_rep') { queueTurnAudio.push(data); continue; }
            if (transferState === 'dialing' || transferState === 'connected' || afterGoodbye || foreignTurn) continue;
            playAgentAudio(data);
          }
          if (message.serverContent?.interrupted) {
            foreignTurn = false;
            queueTurnAudio = [];
            phoneAudio.reset();
            playoutEndsAt = 0;
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
          // The model sometimes drifts into another language (it answered in Spanish once). Stop that
          // turn at once, drop what is still queued and have it say the same thing in Azerbaijani.
          if (!foreignTurn && (transferState === 'idle' || transferState === 'briefing') && FOREIGN_SPEECH.test(currentAgentTurn)) {
            foreignTurn = true;
            console.warn(`Job ${telephonyJobId ?? 'none'}: bot spoke another language, correcting: ${currentAgentTurn.slice(0, 80)}`);
            phoneAudio.reset();
            playoutEndsAt = 0;
            send({ type: 'interrupted' });
            currentAgentTurn = '';
            try {
              session?.sendClientContent({
                turns: '[Sistem] Son cavabın müştəriyə çatmadı. Müştərinin son sözünə Azərbaycan dilində yenidən, qısa cavab ver. "Bağışlayın" demə, heç nə izah etmə, dil haqqında heç nə demə, müştərinin hansı dildə danışdığını şərh etmə.',
                turnComplete: true,
              });
            } catch {}
          }
          // The bot already started the briefing: it heard a live rep, even if the rep's words have not
          // reached our greeting check (late or unusual transcription). Play it at once instead of waiting.
          if (transferState === 'awaiting_rep' && BRIEFING_START.test(currentAgentTurn)) startQueueBriefing('bot');
          // Join only after the briefing's closing sentence ("...birləşdirirəm"): an earlier, unrelated
          // turn could finish first and joined the customer mid-briefing.
          if (message.serverContent?.turnComplete && transferState === 'briefing' && /birləşdir|birlesdir|qoşuram|qosuram/i.test(currentAgentTurn)) {
            if (briefingTimer) clearTimeout(briefingTimer);
            // Let the last words play out, then the bot leaves the call. Anything still queued is
            // dropped before the customer joins, so the customer never hears the briefing.
            briefingTimer = setTimeout(() => {
              briefingTimer = null;
              transferState = 'connected';
              send({ type: 'interrupted' });
              playoutEndsAt = 0;
              void transferHandle?.joinCustomer();
              if (!sessionClosed && session) {
                try {
                  session.close();
                } catch {}
              }
            }, msUntilPlayedOut() + 600);
          }
          if (message.serverContent?.turnComplete && transferState === 'pending') {
            if (transferStartTimer) clearTimeout(transferStartTimer);
            // Let the queued hold sentence finish playing before the hold music starts (it was cut off).
            transferStartTimer = setTimeout(() => void beginTransfer(), msUntilPlayedOut() + 500);
          }
          if (message.serverContent?.turnComplete && transferState === 'awaiting_rep') { currentAgentTurn = ''; queueTurnAudio = []; }
          if (message.serverContent?.turnComplete) foreignTurn = false;
          if (message.serverContent?.turnComplete && currentAgentTurn) {
            const completedAgentTurn = currentAgentTurn.trim();
            transcriptLines.push(`A: ${completedAgentTurn}`);
            if (endCallRequested) { afterGoodbye = true; scheduleEndCallAfterTurn(); }
            else if (transferState !== 'briefing' && transferState !== 'connected' && isFinalGoodbye(completedAgentTurn)) { afterGoodbye = true; scheduleFinalSilenceEnd(); }
            currentAgentTurn = '';
          } else if (message.serverContent?.turnComplete && endCallRequested) {
            scheduleEndCallAfterTurn();
          }
          const inputText = (message.serverContent as any)?.inputTranscription?.text;
          if (inputText && transferState === 'awaiting_rep') {
            // Only a live greeting starts the briefing; queue music and announcements do not.
            repHeard += ` ${inputText}`;
            if (REP_GREETING.test(repHeard)) startQueueBriefing('greeting');
          } else if (inputText) {
            clearFinalSilenceEndTimer();
            // The customer spoke again after the goodbye: the bot may answer.
            if (!endCallRequested && inputText.trim().length > 1) afterGoodbye = false;
            send({ type: 'transcription', role: 'user', text: inputText });
            transcriptLines.push(`C: ${inputText}`);
          }
        },
        onclose: (event) => {
          console.warn('Gemini session closed', (event as any)?.code, (event as any)?.reason);
          reportGeminiError((event as any)?.reason);
          sessionClosed = true;
          // During a transfer the call continues without the bot.
          if (transferState === 'dialing' || transferState === 'awaiting_rep' || transferState === 'briefing' || transferState === 'connected' || transferState === 'pending') return;
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
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          // Pins the spoken language (e.g. az-AZ) so the voice does not drift into a Turkish accent.
          // Off unless set: a model that refuses it would close the session.
          ...(process.env.GEMINI_SPEECH_LANGUAGE ? { languageCode: String(process.env.GEMINI_SPEECH_LANGUAGE).trim() } : {}),
        },
        // Pin the thinking level explicitly (env-configurable) rather than
        // relying on the model's default, since this is a preview model
        // and defaults can change between versions.
        // Only the 3.1 flash live model takes a thinking level; gemini-3.8-live refuses the session with it (1007).
        ...(liveModel.includes('flash-live') ? { thinkingConfig: { thinkingLevel: geminiThinkingLevel } } : {}),
        systemInstruction: await buildSystemInstruction(customer, agent, callMemoryContext, baseTemplateId, dynamicContext,
          isExcel ? { segment: excelCtx?.segment ?? null, canTransfer: (excelCtx?.transferExtensions.length ?? 0) > 0, params: excelCtx?.params ?? null } : null)
          + (testAgentName ? `\n\nSƏNİN ADIN: ${testAgentName} (qadın). Özünü təqdim edəndə və ya adını soruşanda yalnız bu adı de, başqa ad çəkmə. Təbii de: "Mənim adım ${testAgentName}", "Mən ${testAgentName}" kimi yarımçıq demə.` : ''),
        // Optional hint for the written transcript (short Azerbaijani words came out as Portuguese).
        // Off by default until confirmed on a test call: an unknown setup field would fail every call.
        inputAudioTranscription: process.env.GEMINI_TRANSCRIPTION_LANGUAGE_HINT === 'on' ? { languageCodes: ['az-AZ', 'ru-RU'] } : {},
        outputAudioTranscription: {},
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: geminiVadStartSensitivity,
            endOfSpeechSensitivity: geminiVadEndSensitivity,
            prefixPaddingMs: Math.max(40, Math.min(geminiVadPrefixPaddingMs, 300)),
            silenceDurationMs: Math.max(150, Math.min(geminiVadSilenceDurationMs, 1500)),
          },
        },
        tools: [{ functionDeclarations: [endCallFunctionDeclaration,
          ...(customer.sourceSystem === 'arzoom' || (isExcel && (excelCtx?.transferExtensions.length ?? 0) > 0) ? [transferFunctionDeclaration] : []),
          ...((customer.sourceSystem === 'arzoom'
          // ARZOOM applications: only the application result and the knowledge base. The old
          // debt-collection tools (update_status, request_callback) and WhatsApp are not used.
          ? (aiToolDeclarations as any[]).filter((d) => ['record_application_feedback', 'search_knowledge_base'].includes(d?.name))
          : isExcel
            ? (aiToolDeclarations as any[]).filter((d) => ['record_campaign_result', 'search_knowledge_base'].includes(d?.name))
            : (aiToolDeclarations as any[]).filter((d) => !['record_application_feedback', 'record_campaign_result'].includes(d?.name))) as any[])] }],
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
          summary: isArzoom || isExcel ? null : await summarizeTranscriptWithAi(finalTranscript),
        }).where(eq(calls.id, callId));
        if (isExcel) {
          await ensureCampaignResultFromTranscript({
            customerId: customer.id,
            telephonyJobId,
            startedAt,
            transcript: finalTranscript,
          }).catch((err) => console.error('Failed to save campaign result', err));
          if (telephonyJobId) {
            await db.execute(sql`
              UPDATE calls SET summary = (
                SELECT concat_ws(' — ', outcome_label, nullif(reason, '')) FROM campaign_results
                WHERE telephony_job_id = ${telephonyJobId} ORDER BY id DESC LIMIT 1
              ) WHERE id = ${callId}
            `).catch((err) => console.error('Failed to set campaign call summary', err));
          }
        }
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
