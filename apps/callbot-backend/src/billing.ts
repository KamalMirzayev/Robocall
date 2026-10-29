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
} as const;

/** Compute billable cost for a single call. Returns 0 for unreached calls. */
export function calculateCallCost(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const minutes = Math.ceil(durationSeconds / 60);
  return Math.round(minutes * BILLING_CONFIG.usagePerMinuteAzn * 100) / 100;
}

/** Compute billable minutes (ceiling) from seconds. */
export function billableMinutes(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return Math.ceil(durationSeconds / 60);
}

export interface UsageSummary {
  totalAnsweredCalls: number;
  totalMinutes: number;
  totalUsageCostAzn: number;
  totalCostAzn: number;
}

export interface CampaignUsage {
  campaignId: number;
  campaignName: string;
  answeredCalls: number;
  minutes: number;
  usageCostAzn: number;
}

// Mirrors telephony_jobs.source (schema.ts) — set directly at job-creation time, not
// inferred by joining back to campaign_calls/external_call_requests.
export type UsageSource = 'campaign' | 'manual' | 'external_api';

export interface SourceUsage {
  source: UsageSource;
  answeredCalls: number;
  minutes: number;
  usageCostAzn: number;
}

export interface DailyUsage {
  date: string; // YYYY-MM-DD, UTC day
  sources: Record<UsageSource, { minutes: number; calls: number; costAzn: number }>;
  totalMinutes: number;
  totalCostAzn: number;
}

export interface TrunkUsage {
  // sip_trunks lives in the telephony service's own database (robocall_crm), not this one, so
  // the name can't be joined here — the frontend resolves it via the same trunks list the
  // /telephony page already fetches. null = no trunk was pinned on the job (auto-selected by
  // the telephony worker at dial time, so which physical trunk carried it isn't recorded).
  trunkId: string | null;
  answeredCalls: number;
  minutes: number;
  usageCostAzn: number;
}

export interface UsageResponse {
  month: string;
  baseFeeAzn: number;
  currency: string;
  usage: UsageSummary;
  byCampaign: CampaignUsage[];
  bySource: SourceUsage[];
  byTrunk: TrunkUsage[];
  daily: DailyUsage[];
}
