export const FIN_REGEX = /^[A-Za-z0-9]{7}$/;

/** PKS API response row – reflects current contract (v2). */
export type PksRow = {
  organization?: string | null;
  muqavile_no?: string | null;
  musterinin_asa?: string | null;
  /** 7-character alphanumeric FIN code (text). */
  fin?: string | null;
  comment_template_name?: string | null;
  status_category?: string | null;
  odenis_ayliq?: string | number | null;
  emekdas?: string | null;
  rehber?: string | null;
  magaza?: string | null;
  kateqoriya?: string | null;
  status?: string | null;
  comment?: string | null;
  last_payment_date?: string | null;
  last_payment_amount?: string | number | null;
  mobile_phone?: string | null;
  days_due?: string | number | null;
  active_contract_count?: string | number | null;
  last_3_payment_dates?: string | null;
  last_3_payment_amounts?: string | null;
  total_paid_last_90_days?: string | number | null;
  kept_promise_count_90d?: string | number | null;
  broken_promise_count_90d?: string | number | null;
  collector_organization?: string | null;
  source_organization?: string | null;
  /**
   * @deprecated Removed in current API contract. Use comment_template_name.
   * Kept for backward-compatibility detection only — never read for business logic.
   */
  cari_borc?: string | number | null;
};

/**
 * Validates a FIN value against the 7-character alphanumeric format.
 * Returns the trimmed FIN string if valid, or null if absent/invalid.
 * Logs a warning for non-null values that fail validation.
 */
export function validateFin(value: unknown): string | null {
  const text = (String(value ?? '').trim()) || null;
  if (!text) return null;
  if (!FIN_REGEX.test(text)) {
    console.warn(`[PKS] Invalid FIN "${text}": expected exactly 7 alphanumeric characters ([A-Za-z0-9]{7}). Discarding.`);
    return null;
  }
  return text;
}
