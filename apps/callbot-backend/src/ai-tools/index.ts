import { Type } from '@google/genai';

export type ToolName =
  | 'request_callback'
  | 'send_whatsapp_msg'
  | 'search_knowledge_base'
  | 'update_status';

export interface ToolContext {
  customer: {
    id: number;
    name: string;
    surname: string;
    phone: string | null;
  };
  agent: {
    id: number;
    name: string;
    companyName: string | null;
    phoneWhatsapp: string | null;
  };
  telephonyJobId: number | null;
  dryRun?: boolean;
}

const validStatusCategories = [
  'Əlaqə saxlamaq olmur',
  'Ödənişə söz verib',
  'Maraqlanmır / zəngi qəbul etmir',
  'Cavab vermir/Yalnız yazışır',
  'Ödənişə meyilldir, lakin maliyyə çətinliyi var, öhdəlikləri çoxdur',
  'Yenidən zəng etməyi xahiş etdi',
  'Ödənişdən imtina edir',
  'Məhkəməyə müraciət etməyi tələb edir',
  'Hissə-hissə ödəniş edir',
  'Ödənişi Təxirə saldı, tarix göstərdi',
  'Ailə üzvü ilə danışılıb',
  'Borc bağlanıb / tam ödənib',
  'Ailə üzvü ödənişə meyilldir',
  'Maaş, Pensiya gözləyir',
  'Müştəri həbsdədir',
  'Müştəri vəfat edib',
  'Ailə üzvü ödənişdən imtina edir',
  'İcra dayandırılıb',
  'İş yeri tapılmır',
  'Alimenti var',
  'Güc strukturu iş yeri var (DQ, MN, FHN, DSX təsdiqlədim)',
  'Ünvana Vizit',
  'Hüquqi müdafiəyə keçib, qərardan şikayət edib. Əmək haqqı yönəlmə məktubu ünvana çatmayıb',
  'Təqaüd alır, Təsdiq elədi',
  'Ünvana bildiriş göndərildi',
  'İş yerinə bildiriş göndərildi',
  'Ödəniş etdiyini bildirir',
  'Təklifə razılıq verdi',
  'Təklifdən imtina etdi',
  'Düşünmək istəyir',
  'Səhv nömrə',
] as const;

function boolValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizePhone(value: unknown): string {
  const digits = digitsOnly(value);
  if (!digits) return '';
  if (digits.startsWith('994') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `994${digits.slice(1)}`;
  if (digits.length === 9) return `994${digits}`;
  return digits;
}

function callRef(ctx: ToolContext): string {
  return `job:${ctx.telephonyJobId ?? 'none'}:customer:${ctx.customer.id}`;
}

async function postWebhook(type: string, payload: Record<string, unknown>, ctx: ToolContext) {
  const webhookUrl = cleanText(process.env.WEBHOOK_URL);
  if (!webhookUrl) return;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  const secret = cleanText(process.env.WEBHOOK_SECRET);
  if (secret) headers['X-AVR-WEBHOOK-SECRET'] = secret;

  await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      callRef: callRef(ctx),
      type,
      timestamp: new Date().toISOString(),
      payload,
    }),
  });
}

async function requestCallbackTool(args: Record<string, unknown>, ctx: ToolContext) {
  const agentType = cleanText(args.agent_type);
  const preferredTime = cleanText(args.preferred_time);
  const reason = cleanText(args.reason);
  const customerNotes = cleanText(args.customer_notes);

  if (!agentType || !preferredTime || !reason) {
    throw new Error('agent_type, preferred_time and reason are required');
  }

  if (ctx.dryRun) {
    return {
      ok: true,
      dryRun: true,
      event: 'callback_requested',
      payload: {
        agent_type: agentType,
        preferred_time: preferredTime,
        reason,
        customer_notes: customerNotes,
      },
    };
  }

  await postWebhook(
    'callback_requested',
    {
      agent_type: agentType,
      preferred_time: preferredTime,
      reason,
      customer_notes: customerNotes,
      customer_id: ctx.customer.id,
      customer_phone: ctx.customer.phone,
      customer_name: `${ctx.customer.name} ${ctx.customer.surname}`.trim(),
    },
    ctx
  );

  return {
    ok: true,
    message: 'Callback request queued',
  };
}

function whatsappTemplate(template: string, ctx: ToolContext): string {
  const company = cleanText(ctx.agent.companyName) || 'Şirkətimiz';
  if (template === 'payment_link') {
    return `Ödəniş etmək üçün ePay.az platformasından istifadə edə bilərsiniz. Hörmətlə, ${company}.`;
  }
  if (template === 'loan_offer_summary') {
    return `Sizin üçün yeni kredit təklifi mövcuddur. Ətraflı məlumat üçün operator sizinlə əlaqə saxlayacaq. Hörmətlə, ${company}.`;
  }
  return `Borc məlumatlarınız üzrə xülasə göndərildi. Ödəniş üçün ePay.az platformasından istifadə edə bilərsiniz. Hörmətlə, ${company}.`;
}

async function sendWhatsappTool(args: Record<string, unknown>, ctx: ToolContext) {
  const template = cleanText(args.template) || 'all_debts_summary';
  const phone = normalizePhone(args.phone || ctx.customer.phone);
  if (!phone) throw new Error('Customer phone is required to send WhatsApp message');

  if (ctx.dryRun) {
    return {
      ok: true,
      dryRun: true,
      template,
      phone,
      previewText: whatsappTemplate(template, ctx),
    };
  }

  const evolutionApiUrl = cleanText(process.env.EVOLUTION_API_URL);
  const evolutionApiKey = cleanText(process.env.EVOLUTION_API_KEY);
  const instance = cleanText(process.env.EVOLUTION_INSTANCE_NAME);

  if (evolutionApiUrl && evolutionApiKey && instance) {
    const response = await fetch(`${evolutionApiUrl.replace(/\/+$/, '')}/message/sendText/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: evolutionApiKey,
      },
      body: JSON.stringify({
        number: `${phone}@s.whatsapp.net`,
        text: whatsappTemplate(template, ctx),
      }),
    });

    if (!response.ok) {
      throw new Error(`WhatsApp API failed: HTTP ${response.status}`);
    }
  }

  await postWebhook(
    'whatsapp_sent',
    {
      template,
      phone,
      customer_id: ctx.customer.id,
    },
    ctx
  );

  return {
    ok: true,
    message: 'WhatsApp flow executed',
  };
}

async function searchKnowledgeBaseTool(args: Record<string, unknown>) {
  const query = cleanText(args.query);
  const limitRaw = Number(args.limit || 5);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.trunc(limitRaw), 10)) : 5;

  if (!query) throw new Error('query is required');

  const ragSearchUrl = cleanText(process.env.RAG_SEARCH_URL);
  if (!ragSearchUrl) {
    return { results: [], message: 'RAG_SEARCH_URL not configured' };
  }

  const url = new URL(ragSearchUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Knowledge search failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function updateStatusTool(args: Record<string, unknown>, ctx: ToolContext) {
  const note = cleanText(args.note);
  const category = cleanText(args.category);
  const customerId = cleanText(args.customer_id) || normalizePhone(ctx.customer.phone);

  if (!note || !category || !customerId) {
    throw new Error('note, category, customer_id are required');
  }
  if (!validStatusCategories.includes(category as (typeof validStatusCategories)[number])) {
    throw new Error('Invalid category');
  }

  if (ctx.dryRun) {
    return {
      ok: true,
      dryRun: true,
      category,
      note,
      customer_id: customerId,
    };
  }

  const instructionServiceUrl = cleanText(process.env.INSTRUCTION_SERVICE_URL);
  if (instructionServiceUrl) {
    await fetch(`${instructionServiceUrl.replace(/\/+$/, '')}/customer/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callRef: callRef(ctx),
        customer_id: customerId,
        status_category: category,
        status_note: note,
        status_updated_at: new Date().toISOString(),
      }),
    });
  }

  await postWebhook(
    'status_updated',
    {
      category,
      note,
      customer_id: customerId,
      telephony_job_id: ctx.telephonyJobId,
      auto_hangup: boolValue(process.env.UPDATE_STATUS_AUTO_HANGUP || 'off'),
    },
    ctx
  );

  return {
    ok: true,
    message: 'Status update submitted',
  };
}

export const aiToolDeclarations = [
  {
    name: 'request_callback',
    description: 'Schedule a callback request from a human agent instead of transferring the call.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        agent_type: { type: Type.STRING, description: "Agent type: 'collection_agent' or 'manager'" },
        preferred_time: { type: Type.STRING, description: 'Preferred callback time provided by customer' },
        reason: { type: Type.STRING, description: 'Reason for callback request' },
        customer_notes: { type: Type.STRING, description: 'Optional notes for callback agent' },
      },
      required: ['agent_type', 'preferred_time', 'reason'],
    },
  },
  {
    name: 'send_whatsapp_msg',
    description: 'Send a WhatsApp message template to the customer.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        template: {
          type: Type.STRING,
          description: 'Template name: payment_link, all_debts_summary, or loan_offer_summary',
        },
        phone: { type: Type.STRING, description: 'Optional destination phone, defaults to current customer phone' },
      },
      required: ['template'],
    },
  },
  {
    name: 'search_knowledge_base',
    description: 'Search knowledge base using semantic search backend.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search query text' },
        limit: { type: Type.NUMBER, description: 'Maximum number of results, default 5' },
      },
      required: ['query'],
    },
  },
  {
    name: 'update_status',
    description: 'Save end-of-call status note and category for the current customer.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        note: { type: Type.STRING, description: 'Status note in Azerbaijani' },
        category: { type: Type.STRING, description: 'Status category from configured list' },
        customer_id: { type: Type.STRING, description: 'Customer phone number' },
      },
      required: ['note', 'category', 'customer_id'],
    },
  },
];

const aiToolHandlers: Record<ToolName, (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>> = {
  request_callback: requestCallbackTool,
  send_whatsapp_msg: sendWhatsappTool,
  search_knowledge_base: searchKnowledgeBaseTool,
  update_status: updateStatusTool,
};

export function isAiToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(aiToolHandlers, name);
}

export async function executeAiTool(
  name: ToolName,
  args: Record<string, unknown> | undefined,
  ctx: ToolContext
): Promise<unknown> {
  const handler = aiToolHandlers[name];
  return handler(args || {}, ctx);
}
