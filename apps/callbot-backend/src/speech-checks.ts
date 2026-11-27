// Word checks on what the bot said, shared by the live call guard and the daily audit.

/** Turkey-Turkish words and suffixes that do not belong in Azerbaijani speech. */
export const TURKISH_WORDS = /(?<![\p{L}])(evet|şimdi|simdi|nasıl|değil|degil|lütfen|lutfen|efendim|ederim|teşekkürler|araç|araba|bilgi|fiyat|kredi|hemen|tamam|ödeme|odeme|görüşme|yardımcı|istiyor\p{L}*|\p{L}+(?:iyor|ıyor|uyor|üyor)\p{L}*|kadar|ne kadar)(?![\p{L}])/giu;

/** Spanish, Portuguese or English slipping into the bot's speech. */
export const OTHER_LANGUAGE = /[áéíóúñ¿¡ãõâê]|\b(entiendo|comunique|gustaría|representante|vehículo|usted|gracias|señor|claro que|por favor|okay|sorry|of course|i understand|thank you)\b/i;

/** Amounts with a fraction ("1.105,55 AZN") or the words for it. */
export const FRACTION_AMOUNT = /\d[\d .]*,\d{1,2}\s*(azn|manat)|\bqəpik|\btam\s+\S+\s+(yüz|on|iyirmi|otuz|qırx|əlli|altmış|yetmiş|səksən|doxsan)/i;

/** The bot asking which language to speak: forbidden. */
export const LANGUAGE_QUESTION = /hansı dildə|(azərbaycan|rus) dilində danışa bilərik|dilində danışaq/i;

/** Internal words that must never be said to a customer. */
export const TECHNICAL_WORDS = /\[sistem\]|\balət\b|funksiya|outcome|bilik bazası|knowledge base|search_knowledge_base|transfer_to_sales|record_\w+/i;

export function uniqueMatches(text: string, re: RegExp): string[] {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  return [...new Set((text.match(new RegExp(re.source, flags)) || []).map((w) => w.toLowerCase().trim()))];
}
