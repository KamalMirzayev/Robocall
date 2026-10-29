/**
 * Billing configuration and cost calculation.
 *
 * Pricing model: Hybrid (Base Subscription + Pay-Per-Minute)
 * - Monthly base fee: 150 AZN (server hosting + platform management)
 * - Usage fee: 0.20 AZN/minute (telephony + AI API, ~100% markup)
 *
 * Only answered calls (duration_seconds > 0) are billable.
 * Partial minutes are rounded up: ceil(seconds / 60).
 */
export const BILLING_CONFIG = {
    monthlyBaseFeeAzn: 150,
    usagePerMinuteAzn: 0.2,
    currency: 'AZN',
};
/** Compute billable cost for a single call. Returns 0 for unreached calls. */
export function calculateCallCost(durationSeconds) {
    if (durationSeconds <= 0)
        return 0;
    const minutes = Math.ceil(durationSeconds / 60);
    return Math.round(minutes * BILLING_CONFIG.usagePerMinuteAzn * 100) / 100;
}
/** Compute billable minutes (ceiling) from seconds. */
export function billableMinutes(durationSeconds) {
    if (durationSeconds <= 0)
        return 0;
    return Math.ceil(durationSeconds / 60);
}
