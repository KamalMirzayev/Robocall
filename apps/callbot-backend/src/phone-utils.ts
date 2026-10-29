// Shared phone-number helpers for the Azerbaijani numbering plan. Extracted from
// telephony.ts so other call-triggering paths (e.g. external-calls.ts) format phone
// numbers for dialing the same way instead of re-implementing this.

export function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function phoneVariants(value: unknown): string[] {
  const phone = digitsOnly(value);
  if (!phone) return [];

  const variants = new Set([phone]);
  if (phone.startsWith('994') && phone.length === 12) {
    variants.add(`0${phone.slice(3)}`);
    variants.add(phone.slice(3));
  }
  if (phone.startsWith('0') && phone.length === 10) {
    variants.add(`994${phone.slice(1)}`);
    variants.add(phone.slice(1));
  }
  if (phone.length === 9) {
    variants.add(`0${phone}`);
    variants.add(`994${phone}`);
  }
  return [...variants];
}

export function normalizePhone(value: unknown): string {
  const raw = String(value ?? '').trim();
  const digits = digitsOnly(raw);
  if (!digits) return '';
  if (digits.startsWith('994') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+994${digits.slice(1)}`;
  if (digits.length === 9) return `+994${digits}`;
  return raw;
}
