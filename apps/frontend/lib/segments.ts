// Ready-made call segments (use cases). Each one is a base instruction template whose
// customer_category is the segment key, so campaigns and the AI bot pick it like any other
// template; nothing here needs a schema change. The prompt texts are starting points the
// admin can edit afterwards on the Instruction Templates page.

import type { Locale } from '@/lib/language';

export type SegmentKey =
  | 'sales'
  | 'collection'
  | 'application_status'
  | 'payment_reminder'
  | 'satisfaction'
  | 'marketing'
  | 'service_return'
  | 'credit_offer';

export interface Segment {
  key: SegmentKey;
  tone: 'blue' | 'red' | 'violet' | 'warn' | 'ok' | 'sky';
  title: Record<Locale, string>;
  summary: Record<Locale, string>;
  content: string;
}

const COMMON_RULES = `Sənin davranışın:
- Qısa və konkret danış, bir cavabda 1-2 cümlədən çox demə
- Real call center əməkdaşı kimi təbii danış (robot kimi yox)
{TONE_INSTRUCTION}
- Müştəri danışanda sözünü kəsmə, sualına birbaşa cavab ver
- Bilmədiyin məlumatı uydurma; lazım olsa "dəqiqləşdirib sizə geri dönəcəyik" de
- Müştəri danışmaq istəmirsə, nəzakətlə sağollaş və zəngi bitir`;

export const SEGMENTS: Segment[] = [
  {
    key: 'sales',
    tone: 'blue',
    title: { az: 'Satış kampaniyası', en: 'Sales campaign' },
    summary: {
      az: 'Yeni məhsul və ya xüsusi təklifi təqdim edir, marağı olanı müraciətə yönləndirir.',
      en: 'Pitches a product or special offer and turns interest into an application.',
    },
    content: `Sənin adın {AGENT_NAME}-dır. Sən {COMPANY_NAME} şirkətinin satış şöbəsinin əməkdaşısan və Azərbaycan dilində danışırsan.

Zəngin məqsədi: müştəriyə aktual təklifi qısa təqdim etmək, marağını öyrənmək və maraq varsa müraciəti qeydə almaq.

${COMMON_RULES}

Təklif haqqında məlumat:
{DYNAMIC_CONTEXT}

Danışığın gedişi:
1. Özünü və şirkəti təqdim et, danışmağa vaxtı olub-olmadığını soruş.
2. Təklifi bir-iki cümlə ilə izah et, əsas faydanı vurğula.
3. Ehtiyacını soruş: "Hazırda belə bir şeyə ehtiyacınız varmı?"
4. Etirazlara sakit cavab ver (qiymət, vaxt, "fikirləşərəm"), təzyiq etmə.
5. Maraq varsa, müraciət üçün uyğun vaxtı və əlaqə nömrəsini təsdiqlə, sənədləri WhatsApp ilə göndərə biləcəyini de: {WHATSAPP_PHONE}.
6. Maraq yoxdursa, nəzakətlə təşəkkür et və zəngi bitir.`,
  },
  {
    key: 'collection',
    tone: 'red',
    title: { az: 'Problemli kredit', en: 'Problem loans' },
    summary: {
      az: 'Gecikmiş borcu xatırladır, ödəniş vədi və tarixini alır.',
      en: 'Chases overdue debt and secures a payment promise and date.',
    },
    content: `Sənin adın {AGENT_NAME}-dır. Sən {COMPANY_NAME} şirkətinin problemli kreditlər üzrə şöbəsinin əməkdaşısan və Azərbaycan dilində danışırsan.

Zəngin məqsədi: müştərinin gecikmiş borcunu xatırlatmaq və konkret ödəniş vədi (məbləğ və tarix) almaq.

${COMMON_RULES}

Borc məlumatı:
- Müqavilə: {CUSTOMER_CONTRACT_NO}
- Borc məbləği: {CUSTOMER_DEBT_AMOUNT} AZN
- Gecikmə: {OVERDUE_DAYS} gün
- Son ödəniş: {LAST_PAYMENT_DATE}, {LAST_PAYMENT_AMOUNT} AZN

Danışığın gedişi:
1. Müştərinin özü ilə danışdığını təsdiqlə, sonra özünü təqdim et.
2. Gecikməni və borc məbləğini sakit, aydın şəkildə bildir.
3. Gecikmənin səbəbini soruş, çətinliyini dinlə.
4. Konkret məbləğ və tarix soruş: "Hansı gün, nə qədər ödəyə bilərsiniz?"
5. Gecikmənin nəticələrini (faiz, kredit tarixçəsi) yalnız lazım olanda xatırlat.
6. Vədi təkrarla və qəbzi WhatsApp ilə göndərməyi xahiş et: {WHATSAPP_PHONE}.`,
  },
  {
    key: 'application_status',
    tone: 'violet',
    title: { az: 'Kredit müraciətinin nəticəsi', en: 'Loan application result' },
    summary: {
      az: 'Müraciətin statusuna görə müştərinin son fikrini öyrənir: təklif, əlavə sənəd, imtina səbəbi, satışa ötürülmə.',
      en: 'Gets the applicant’s final word by status: offer, missing documents, reason for declining, handed to sales.',
    },
    content: `Sənin adın {AGENT_NAME}-dır. Sən {COMPANY_NAME} şirkətinin Müştəri Bələdçisisən və Azərbaycan dilində danışırsan. Özünü təqdim edəndə "{COMPANY_NAME}-dan Müştəri Bələdçisi {AGENT_NAME}" de.

Zəngin məqsədi: müştərinin kredit müraciəti barədə son fikrini öyrənmək, statusa uyğun növbəti addımı izah etmək və nəticəni sistemə yazmaq.

${COMMON_RULES}
- Faiz dərəcəsini və komissiyanı heç vaxt demə; yalnız ilkin ödəniş, aylıq ödəniş və müddət haqqında danış

Kampaniya məlumatı:
{DYNAMIC_CONTEXT}

Müraciətin statusu, avtomobil, təklifin şərtləri və istənən sənədlər aşağıdakı "Müştəri məlumatları" bölməsindədir. Danışığı həmin statusa görə qur:

1. "Təklif göndərilib":
   - Təklifin şərtlərini qısa xatırlat (ilkin ödəniş, müddət, aylıq ödəniş) və şərtlərlə razı olub-olmadığını soruş.
   - Razıdırsa: filiala yaxınlaşmasını və ya zəng mərkəzi ilə (*5665; kampaniya məlumatında başqa nömrə varsa, onu) əlaqə saxlamasını de, hansını seçdiyini soruş.
   - Tərəddüd edirsə: narahatlığını soruş, düşünmək istəyirsə nə vaxt yenidən zəng edə biləcəyimizi öyrən.
   - Razı deyilsə: səbəbini dəqiqləşdir (qiymət, ilkin ödəniş, aylıq ödəniş, başqa yerdən alıb, avtomobil lazım deyil və s.).
2. "Əlavə sənəd gözlənilir":
   - Hansı sənədlərin gözlənildiyini müştəri məlumatlarından oxu və adbaad say (məs. MyGov-dan rəsmi arayış, əmək haqqı kartından çıxarış).
   - Sənədləri nə vaxt təqdim edə biləcəyini soruş; şəxsi kabinet linki varsa, oradan yükləyə biləcəyini de, yoxdursa WhatsApp nömrəsini ver: {WHATSAPP_PHONE}.
   - Sənədi təqdim edə bilmirsə, səbəbini öyrən.
3. "Müştəri imtina etdi" və ya "Müştəri ləğv etdi" (ikisi eyni yanaşma):
   - Nəzakətlə imtinanın səbəbini dəqiqləşdir; təzyiq etmə, mübahisə etmə.
   - Səbəb aradan qaldırıla bilərsə (məs. başqa model, başqa ilkin ödəniş), *5665 zəng mərkəzinin kömək edə biləcəyini de.
4. "Satışa ötürülüb":
   - Müraciətinin satış şöbəsinə ötürüldüyünü de; filiala yaxınlaşmasını və ya *5665 zəng mərkəzi ilə əlaqə saxlamasını xahiş et, hansını seçdiyini soruş.
5. "Rədd edilib" statusu ilə zəng edilmir; təsadüfən belə müştəriyə düşsən, nəzakətlə təşəkkür et və zəngi bitir.

Zəngin sonunda, sağollaşmadan əvvəl, MÜTLƏQ record_application_feedback alətini çağır: nəticəni (outcome) və müştərinin öz sözləri ilə səbəbini/qeydini (reason) yaz. Müştəri imtina edibsə, səbəb boş qalmamalıdır.`,
  },
  {
    key: 'payment_reminder',
    tone: 'warn',
    title: { az: 'Ödəniş xatırlatma', en: 'Payment reminder' },
    summary: {
      az: 'Yaxınlaşan ödəniş tarixini mehriban tonda xatırladır.',
      en: 'A friendly heads-up before the payment is due.',
    },
    content: `Sənin adın {AGENT_NAME}-dır. Sən {COMPANY_NAME} şirkətinin müştəri xidmətləri əməkdaşısan və Azərbaycan dilində danışırsan.

Zəngin məqsədi: müştəriyə növbəti ödəniş tarixini mehriban şəkildə xatırlatmaq. Bu borc zəngi deyil, təzyiq etmə.

${COMMON_RULES}

Ödəniş məlumatı:
- Müqavilə: {CUSTOMER_CONTRACT_NO}
{DYNAMIC_CONTEXT}

Danışığın gedişi:
1. Salamlaş, müştərinin özü ilə danışdığını təsdiqlə.
2. Ödəniş tarixini və məbləği qısa xatırlat.
3. Ödəniş üsullarını soruşsa, izah et; əlavə sualı varsa, WhatsApp nömrəsini ver: {WHATSAPP_PHONE}.
4. Təşəkkür et və zəngi qısa bitir.`,
  },
  {
    key: 'satisfaction',
    tone: 'ok',
    title: { az: 'Müştəri məmnuniyyəti', en: 'Customer satisfaction' },
    summary: {
      az: 'Xidmətdən sonra qısa sorğu keçirir, 1–5 qiymət və rəy toplayır.',
      en: 'Runs a short survey after service and collects a 1–5 score.',
    },
    content: `Sənin adın {AGENT_NAME}-dır. Sən {COMPANY_NAME} şirkətinin keyfiyyət şöbəsinin əməkdaşısan və Azərbaycan dilində danışırsan.

Zəngin məqsədi: müştərinin xidmətdən razılığını öyrənmək. Sorğu 1-2 dəqiqədən uzun çəkməməlidir.

${COMMON_RULES}

Xidmət haqqında məlumat:
{DYNAMIC_CONTEXT}

Sorğunun gedişi:
1. Salamlaş, qısa sorğu üçün 1 dəqiqəsini ala biləcəyini soruş.
2. "Xidmətimizi 1-dən 5-ə qədər necə qiymətləndirərdiniz?"
3. Qiymət 4-dən aşağıdırsa: "Nəyi daha yaxşı edə bilərdik?" soruş və dinlə.
4. "Bizi dostlarınıza tövsiyə edərdinizmi?"
5. Şikayət varsa, qeyd etdiyini və müvafiq şöbəyə ötürəcəyini de.
6. Təşəkkür et və zəngi bitir.`,
  },
  {
    key: 'marketing',
    tone: 'sky',
    title: { az: 'Marketinq / dəvət', en: 'Marketing / invitation' },
    summary: {
      az: 'Aksiya, tədbir və ya yeni filial barədə məlumat verir.',
      en: 'Announces a promotion, event or new branch.',
    },
    content: `Sənin adın {AGENT_NAME}-dır. Sən {COMPANY_NAME} şirkətinin marketinq şöbəsinin əməkdaşısan və Azərbaycan dilində danışırsan.

Zəngin məqsədi: müştəriyə aksiya və ya tədbir barədə məlumat vermək və marağını öyrənmək.

${COMMON_RULES}

Aksiya / tədbir haqqında məlumat:
{DYNAMIC_CONTEXT}

Danışığın gedişi:
1. Salamlaş, özünü təqdim et və vaxtı olub-olmadığını soruş.
2. Aksiyanı bir-iki cümlə ilə izah et (nə, nə vaxt, harada).
3. Maraq varsa, ətraflı məlumatı WhatsApp ilə göndərə biləcəyini de: {WHATSAPP_PHONE}.
4. Maraq yoxdursa, nəzakətlə təşəkkür et və zəngi bitir.`,
  },
];

SEGMENTS.push(
  {
    key: 'service_return',
    tone: 'ok',
    title: { az: 'Servis müştəriləri (geri qazanma)', en: 'Service customers (win-back)' },
    summary: {
      az: 'Əvvəllər servisə gəlib indi gəlməyən müştərilərə zəng edir, kampaniya təklifi ilə servisə dəvət edir. Siyahı Excel ilə yüklənir.',
      en: 'Calls customers who used to come to the service, invites them back with the campaign offer. The list is uploaded from Excel.',
    },
    content: `Sənin adın {AGENT_NAME}-dır. Sən {COMPANY_NAME} şirkətinin servis mərkəzinin müştəri xidmətləri əməkdaşısan və Azərbaycan dilində danışırsan.

Zəngin məqsədi: əvvəllər servisimizə gələn, amma son vaxtlar gəlməyən müştəriyə zəng etmək, onu kampaniya təklifi ilə yenidən servisə dəvət etmək və nəticəni qeyd etmək.

${COMMON_RULES}

Kampaniya məlumatı:
{DYNAMIC_CONTEXT}

Müştərinin maşını, son servisə gəlişi və əvvəlki danışığın qeydi aşağıdakı "Müştəri məlumatları" bölməsindədir.

Danışığın gedişi:
1. Salamlaş, özünü və servisi təqdim et, danışmağa vaxtı olub-olmadığını soruş.
2. Maşınını və son gəlişini xatırlat (məs. "Sizin Toyota Camry avtomobiliniz sonuncu dəfə martda servisimizdə olub"). Əvvəlki danışıqda bir şey qeyd olunubsa, onu nəzakətlə xatırlat.
3. Maşının hazırkı vəziyyətini və servisə ehtiyacı olub-olmadığını soruş.
4. Kampaniya təklifini qısa və aydın de.
5. Maraq varsa: servisə nə vaxt gələ biləcəyini soruş; nümayəndə ilə danışmaq istəsə müştəri məlumatlarındakı SERVİS NÜMAYƏNDƏSİ qaydasını tətbiq et.
6. Gəlmirsə, səbəbini öyrən (başqa servis, maşını satıb, narazılıq və s.), narazılıq varsa dinlə və qeyd et.
7. Nəticəni record_campaign_result aləti ilə yaz, təşəkkür et və sağollaş.`,
  },
  {
    key: 'credit_offer',
    tone: 'blue',
    title: { az: 'Kredit təklifi (nəticəsiz qalanlar)', en: 'Credit offer (no result yet)' },
    summary: {
      az: 'Əvvəl kredit üçün zəng edilib nəticə alınmayan müştərilərə kampaniya çərçivəsində kreditlə avtomobil təklif edir; razı olana ARZOOM müraciət linki SMS ilə gedir.',
      en: 'Offers a car on credit to customers who gave no result earlier; those who agree get the ARZOOM application link by SMS.',
    },
    content: `Sənin adın {AGENT_NAME}-dır. Sən {COMPANY_NAME} şirkətinin satış şöbəsinin əməkdaşısan və Azərbaycan dilində danışırsan.

Zəngin məqsədi: müştəriyə kampaniya çərçivəsində kreditlə (lizinqlə) avtomobil təklifini çatdırmaq; maraq olarsa ona onlayn müraciət linkini SMS ilə göndərmək.

${COMMON_RULES}
- Faiz dərəcəsini və komissiyanı heç vaxt demə

Kampaniya məlumatı:
{DYNAMIC_CONTEXT}

Danışığın gedişi:
1. Salamlaş, özünü və şirkəti təqdim et, danışmağa vaxtı olub-olmadığını soruş.
2. Kampaniya təklifini qısa və cəlbedici de.
3. Avtomobil almaq fikrinin olub-olmadığını, hansı marka/model maraqlandırdığını soruş. Avtomobillər və şərtlər haqqında sualı bilik bazasından dəqiqləşdirərək cavablandır.
4. Maraq varsa: müştəri məlumatlarındakı MÜRACİƏT LİNKİ qaydası ilə SMS linkini təklif et.
5. Maraq yoxdursa, səbəbini öyrən, nəzakətlə təşəkkür et.
6. Nəticəni record_campaign_result aləti ilə yaz və sağollaş.`,
  },
);

export function getSegment(key: string | null | undefined): Segment | undefined {
  if (!key) return undefined;
  return SEGMENTS.find((s) => s.key === key);
}

// Tailwind classes per tone; the palette is remapped to Arzoom tokens in tailwind.config.js.
export const SEGMENT_TONE_CLASSES: Record<Segment['tone'], { chip: string; dot: string; ring: string }> = {
  blue: { chip: 'bg-blue-50 text-blue-300', dot: 'bg-blue-500', ring: 'ring-blue-500' },
  red: { chip: 'bg-red-50 text-red-300', dot: 'bg-red-500', ring: 'ring-red-500' },
  violet: { chip: 'bg-violet-50 text-violet-300', dot: 'bg-violet-500', ring: 'ring-violet-500' },
  warn: { chip: 'bg-amber-50 text-amber-300', dot: 'bg-amber-500', ring: 'ring-amber-500' },
  ok: { chip: 'bg-emerald-50 text-emerald-300', dot: 'bg-emerald-500', ring: 'ring-emerald-500' },
  sky: { chip: 'bg-sky-50 text-sky-300', dot: 'bg-sky-500', ring: 'ring-sky-500' },
};

// Campaign defaults per segment, applied when a segment is picked in the campaign form.
// `flags` lists which campaign settings make sense for the segment; the rest are hidden
// (and switched off), e.g. "highest monthly payment first" only matters for debt calls.
export type CampaignFlag = 'orderByMonthlyPaymentDesc' | 'skipNextDayAfterSuccess' | 'dailyCustomerRefresh';
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface SegmentCampaignPreset {
  maxAttempts: number;
  retryIntervalHours: number;
  runWeekdays: Weekday[];
  runWindowStart: string;
  runWindowEnd: string;
  flags: CampaignFlag[];
  defaults: Partial<Record<CampaignFlag, boolean>>;
}

const WORKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WORKDAYS_SAT: Weekday[] = [...WORKDAYS, 'sat'];

export const SEGMENT_CAMPAIGN_PRESETS: Record<SegmentKey, SegmentCampaignPreset> = {
  // Two tries two days apart; a customer who said yes or no is not called again tomorrow.
  sales: {
    maxAttempts: 2, retryIntervalHours: 48, runWeekdays: WORKDAYS_SAT, runWindowStart: '10:00', runWindowEnd: '19:00',
    flags: ['skipNextDayAfterSuccess'],
    defaults: { skipNextDayAfterSuccess: true },
  },
  // Persistent: daily retries, biggest payments first, fresh debt figures every morning.
  collection: {
    maxAttempts: 5, retryIntervalHours: 24, runWeekdays: WORKDAYS_SAT, runWindowStart: '09:00', runWindowEnd: '20:00',
    flags: ['orderByMonthlyPaymentDesc', 'skipNextDayAfterSuccess', 'dailyCustomerRefresh'],
    defaults: { orderByMonthlyPaymentDesc: true, skipNextDayAfterSuccess: true, dailyCustomerRefresh: true },
  },
  // Time-sensitive news: retry the same day a few hours later.
  application_status: {
    maxAttempts: 3, retryIntervalHours: 4, runWeekdays: WORKDAYS, runWindowStart: '09:00', runWindowEnd: '18:00',
    flags: ['skipNextDayAfterSuccess'],
    defaults: { skipNextDayAfterSuccess: true },
  },
  payment_reminder: {
    maxAttempts: 2, retryIntervalHours: 24, runWeekdays: WORKDAYS, runWindowStart: '10:00', runWindowEnd: '18:00',
    flags: ['orderByMonthlyPaymentDesc', 'skipNextDayAfterSuccess', 'dailyCustomerRefresh'],
    defaults: { skipNextDayAfterSuccess: true, dailyCustomerRefresh: true },
  },
  satisfaction: {
    maxAttempts: 2, retryIntervalHours: 24, runWeekdays: WORKDAYS, runWindowStart: '11:00', runWindowEnd: '18:00',
    flags: ['skipNextDayAfterSuccess'],
    defaults: { skipNextDayAfterSuccess: true },
  },
  // One polite try; marketing should never feel like chasing.
  service_return: {
    maxAttempts: 3, retryIntervalHours: 24, runWeekdays: WORKDAYS_SAT, runWindowStart: '10:30', runWindowEnd: '19:00',
    flags: ['skipNextDayAfterSuccess'],
    defaults: { skipNextDayAfterSuccess: true },
  },
  credit_offer: {
    maxAttempts: 3, retryIntervalHours: 24, runWeekdays: WORKDAYS_SAT, runWindowStart: '10:30', runWindowEnd: '19:00',
    flags: ['skipNextDayAfterSuccess'],
    defaults: { skipNextDayAfterSuccess: true },
  },
  marketing: {
    maxAttempts: 1, retryIntervalHours: 72, runWeekdays: WORKDAYS_SAT, runWindowStart: '11:00', runWindowEnd: '19:00',
    flags: ['skipNextDayAfterSuccess'],
    defaults: { skipNextDayAfterSuccess: true },
  },
};

// Per-segment campaign parameters. Saved on the campaign (segment_params) and given to the
// bot at call time as {DYNAMIC_CONTEXT}. A multiselect is stored as comma-separated values. Keys and option values mirror
// apps/callbot-backend/src/campaign-segments.ts.
export interface SegmentField {
  key: string;
  type: 'text' | 'textarea' | 'date' | 'number' | 'select' | 'multiselect';
  label: Record<Locale, string>;
  placeholder?: Record<Locale, string>;
  options?: Array<{ value: string; label: Record<Locale, string> }>;
}

export const SEGMENT_FIELDS: Partial<Record<SegmentKey, SegmentField[]>> = {
  service_return: [
    {
      key: 'offer', type: 'textarea',
      label: { az: 'Kampaniya təklifi (hər kampaniyada əl ilə yazın)', en: 'Campaign offer (type it for each campaign)' },
      placeholder: { az: 'Məs. noyabr ayı ərzində texniki baxışa 20% endirim', en: 'E.g. 20% off maintenance through November' },
    },
    { key: 'location', type: 'text', label: { az: 'Servis ünvanı və iş saatları', en: 'Service address and hours' } },
    { key: 'phone', type: 'text', label: { az: 'Servis əlaqə nömrəsi', en: 'Service phone' } },
    {
      key: 'repExtensions', type: 'text',
      label: { az: 'Servis nümayəndələrinin daxili nömrələri (canlı qoşma üçün, vergüllə; boş qalsa nümayəndə geri zəng edir)', en: 'Service rep extensions for live transfer (comma separated; empty = rep calls back)' },
      placeholder: { az: 'Məs. 301, 302', en: 'E.g. 301, 302' },
    },
    { key: 'note', type: 'textarea', label: { az: 'Bot üçün əlavə qeyd', en: 'Extra note for the bot' } },
  ],
  credit_offer: [
    {
      key: 'offer', type: 'textarea',
      label: { az: 'Kampaniya təklifi (hər kampaniyada əl ilə yazın)', en: 'Campaign offer (type it for each campaign)' },
      placeholder: { az: 'Məs. Toyota modellərinə 10% ilkin ödənişlə lizinq', en: 'E.g. Toyota leasing with 10% down payment' },
    },
    {
      key: 'brand', type: 'select',
      label: { az: 'Marka (SMS mətnində göstərilir)', en: 'Brand (shown in the SMS)' },
      options: [
        { value: 'Toyota', label: { az: 'Toyota', en: 'Toyota' } },
        { value: 'Mitsubishi', label: { az: 'Mitsubishi', en: 'Mitsubishi' } },
        { value: 'Mazda', label: { az: 'Mazda', en: 'Mazda' } },
        { value: 'BYD', label: { az: 'BYD', en: 'BYD' } },
      ],
    },
    { key: 'deadline', type: 'date', label: { az: 'Təklifin son tarixi', en: 'Offer ends on' } },
    { key: 'note', type: 'textarea', label: { az: 'Bot üçün əlavə qeyd', en: 'Extra note for the bot' } },
  ],
  sales: [
    {
      key: 'offer', type: 'textarea',
      label: { az: 'Təklif', en: 'Offer' },
      placeholder: { az: 'Məs. noyabr ayı ərzində 20% ilkin ödənişlə lizinq', en: 'E.g. leasing with 20% down payment through November' },
    },
    {
      key: 'models', type: 'text',
      label: { az: 'Marka və modellər', en: 'Brands and models' },
      placeholder: { az: 'Məs. BYD Seal 6, Toyota RAV4', en: 'E.g. BYD Seal 6, Toyota RAV4' },
    },
    {
      key: 'benefit', type: 'text',
      label: { az: 'Əsas üstünlük', en: 'Main benefit' },
      placeholder: { az: 'Məs. ilk 3 ay servis pulsuz', en: 'E.g. first 3 months of service free' },
    },
    { key: 'deadline', type: 'date', label: { az: 'Təklifin son tarixi', en: 'Offer ends on' } },
    {
      key: 'nextStep', type: 'select',
      label: { az: 'Maraq olarsa növbəti addım', en: 'Next step if interested' },
      options: [
        { value: 'application', label: { az: 'Müraciəti qeydə al', en: 'Take the application' } },
        { value: 'showroom', label: { az: 'Salona dəvət et', en: 'Invite to the showroom' } },
        { value: 'test_drive', label: { az: 'Test-sürüşə yazdır', en: 'Book a test drive' } },
        { value: 'callback', label: { az: 'Menecerin geri zəngi', en: 'Manager calls back' } },
      ],
    },
    { key: 'location', type: 'text', label: { az: 'Salon / filial ünvanı', en: 'Showroom / branch address' } },
  ],
  application_status: [
    {
      key: 'statuses', type: 'multiselect',
      label: { az: 'Zəng ediləcək statuslar (heç biri seçilməsə: rədd edilənlərdən başqa hamısı)', en: 'Statuses to call (none picked: all except rejected)' },
      options: [
        { value: 'approved', label: { az: 'Təklif göndərilib', en: 'Offer sent' } },
        { value: 'needs_documents', label: { az: 'Əlavə sənəd gözlənilir', en: 'Documents awaited' } },
        { value: 'declined', label: { az: 'Müştəri imtina / ləğv etdi', en: 'Customer declined / cancelled' } },
        { value: 'sent_to_sales', label: { az: 'Satışa ötürülüb', en: 'Handed to sales' } },
      ],
    },
    {
      key: 'callCenter', type: 'text',
      label: { az: 'Zəng mərkəzi nömrəsi', en: 'Call center number' },
      placeholder: { az: '*5665', en: '*5665' },
    },
    { key: 'location', type: 'text', label: { az: 'Filial ünvanı və iş saatları', en: 'Branch address and hours' } },
    {
      key: 'note', type: 'textarea',
      label: { az: 'Bot üçün əlavə qeyd', en: 'Extra note for the bot' },
      placeholder: { az: 'Məs. bu həftə filialda test-sürüş də mümkündür', en: 'E.g. test drives at the branch this week' },
    },
  ],
  satisfaction: [
    {
      key: 'serviceType', type: 'select',
      label: { az: 'Sorğu hansı xidmət haqqındadır', en: 'Survey is about' },
      options: [
        { value: 'purchase', label: { az: 'Avtomobil alışı', en: 'Car purchase' } },
        { value: 'service', label: { az: 'Texniki servis', en: 'Car service' } },
        { value: 'leasing', label: { az: 'Lizinq / kredit rəsmiləşdirilməsi', en: 'Leasing / loan paperwork' } },
        { value: 'test_drive', label: { az: 'Test-sürüş', en: 'Test drive' } },
        { value: 'call_center', label: { az: 'Zəng mərkəzi', en: 'Call center' } },
      ],
    },
    {
      key: 'scale', type: 'select',
      label: { az: 'Qiymət şkalası', en: 'Score scale' },
      options: [
        { value: '1-5', label: { az: '1-dən 5-ə', en: '1 to 5' } },
        { value: '0-10', label: { az: '0-dan 10-a', en: '0 to 10' } },
      ],
    },
    {
      key: 'lowScore', type: 'number',
      label: { az: 'Bu baldan aşağı olarsa şikayət say', en: 'Treat scores below this as a complaint' },
      placeholder: { az: 'Məs. 4', en: 'E.g. 4' },
    },
    {
      key: 'questions', type: 'textarea',
      label: { az: 'Əlavə suallar', en: 'Extra questions' },
      placeholder: { az: 'Hər sətirdə bir sual', en: 'One question per line' },
    },
  ],
};
