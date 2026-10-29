'use client';

import { useEffect, useMemo, useState } from 'react';
import callbotApi from '@/lib/callbot-api';
import { telephonyApi } from '@/lib/telephony-api-client';
import { useLanguage, type Locale } from '@/lib/language';
import { UsageDailyChart } from '@/components/UsageDailyChart';

interface UsageData {
  month: string;
  baseFeeAzn: number;
  currency: string;
  usage: {
    totalAnsweredCalls: number;
    totalMinutes: number;
    totalUsageCostAzn: number;
    totalCostAzn: number;
  };
  byCampaign: Array<{
    campaignId: number;
    campaignName: string;
    answeredCalls: number;
    minutes: number;
    usageCostAzn: number;
  }>;
  bySource: Array<{
    source: 'campaign' | 'manual' | 'external_api';
    answeredCalls: number;
    minutes: number;
    usageCostAzn: number;
  }>;
  byTrunk: Array<{
    trunkId: string | null;
    answeredCalls: number;
    minutes: number;
    usageCostAzn: number;
  }>;
  daily: Array<{
    date: string;
    sources: Record<'campaign' | 'manual' | 'external_api', { minutes: number; calls: number; costAzn: number }>;
    totalMinutes: number;
    totalCostAzn: number;
  }>;
}

// Not sourced from Intl.DateTimeFormat: Chrome's (and other browsers') bundled ICU data has
// no long-month-name data for 'az-AZ', so toLocaleDateString(..., { month: 'long' }) silently
// falls back to a generic "M08"-style label instead of throwing — verified in a real browser
// (Chrome 151), not just Node. Spelling the month names out here sidesteps that gap entirely.
const MONTH_NAMES: Record<Locale, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  az: ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'],
};
type GroupBy = 'campaign' | 'source' | 'trunk';

export default function UsagePage() {
  const { t, locale } = useLanguage();
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [groupBy, setGroupBy] = useState<GroupBy>('campaign');
  const [trunkNames, setTrunkNames] = useState<Record<string, string>>({});

  const sourceLabels: Record<'campaign' | 'manual' | 'external_api', string> = {
    campaign: t('usage.sourceCampaign'),
    manual: t('usage.sourceManual'),
    external_api: t('usage.sourceExternalApi'),
  };

  const trunkLabel = (trunkId: string | null) => {
    if (!trunkId) return t('usage.trunkAutoSelected');
    return trunkNames[trunkId] || trunkId;
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    callbotApi
      .getUsage(month)
      .then((result) => {
        setData(result);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t('common.loading'));
      })
      .finally(() => setLoading(false));
  }, [month]);

  // Trunk names live in the telephony service's own database, unreachable from /api/usage
  // (see billing.ts's TrunkUsage comment) — resolved here via the same trunks list the
  // /telephony page already fetches. Independent of month, so fetched once.
  useEffect(() => {
    telephonyApi.getSIPTrunks()
      .then((trunks) => {
        setTrunkNames(Object.fromEntries(trunks.map((trunk) => [trunk.id, trunk.name])));
      })
      .catch((err) => console.error('Failed to load SIP trunks for usage labels:', err));
  }, []);

  const monthOpts = useMemo(() => {
    const now = new Date();
    const monthNames = MONTH_NAMES[locale] || MONTH_NAMES.en;
    const options: { value: string; label: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
      const value = d.toISOString().slice(0, 7);
      const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
      options.push({ value, label });
    }
    return options;
  }, [locale]);

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">{t('usage.heading')}</h1>
          <p className="text-gray-400 mt-1">{t('usage.subheading')}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          >
            {monthOpts.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <a
            href={`/api/callbot/usage/export.xlsx?month=${month}`}
            className="px-4 py-2 rounded border border-slate-600 text-gray-300 hover:bg-slate-700"
          >
            {t('usage.export')}
          </a>
        </div>
      </div>

      {loading && (
        <div className="text-center py-16 text-gray-400">{t('usage.loading')}</div>
      )}

      {error && (
        <div className="rounded border border-red-700 bg-red-950/40 px-4 py-3 text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded border border-slate-700 bg-slate-900/40 p-4">
              <p className="text-xs text-gray-400 mb-1">{t('usage.baseFee')}</p>
              <p className="text-white text-xl font-semibold">
                {data.baseFeeAzn} {data.currency}
              </p>
            </div>
            <div className="rounded border border-slate-700 bg-slate-900/40 p-4">
              <p className="text-xs text-gray-400 mb-1">{t('usage.answeredCalls')}</p>
              <p className="text-white text-xl font-semibold">
                {data.usage.totalAnsweredCalls.toLocaleString()}
              </p>
            </div>
            <div className="rounded border border-slate-700 bg-slate-900/40 p-4">
              <p className="text-xs text-gray-400 mb-1">{t('usage.billableMinutes')}</p>
              <p className="text-white text-xl font-semibold">
                {data.usage.totalMinutes.toLocaleString()}
              </p>
            </div>
            <div className="rounded border border-slate-700 bg-slate-900/40 p-4">
              <p className="text-xs text-gray-400 mb-1">{t('usage.usageCost')}</p>
              <p className="text-white text-xl font-semibold">
                {data.usage.totalUsageCostAzn.toFixed(2)} {data.currency}
              </p>
            </div>
            <div className="rounded border border-emerald-700 bg-emerald-950/30 p-4">
              <p className="text-xs text-emerald-300 mb-1">{t('usage.total')}</p>
              <p className="text-emerald-200 text-xl font-semibold">
                {data.usage.totalCostAzn.toFixed(2)} {data.currency}
              </p>
            </div>
          </div>

          {/* Pricing info */}
          <div className="rounded border border-slate-700 bg-slate-900/40 p-3 text-sm text-gray-400">
            <span className="text-gray-300">{t('usage.pricingInfo')}</span>{' '}
            {data.baseFeeAzn} {data.currency}{t('usage.pricingDetail')}
          </div>

          {/* Daily cost, stacked by source */}
          <UsageDailyChart data={data.daily} currency={data.currency} />

          {/* Breakdown, grouped by campaign, source (campaign / manual / external API), or trunk */}
          <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-900/60 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-gray-300">
                {groupBy === 'campaign' ? t('usage.perCampaign') : groupBy === 'source' ? t('usage.perSource') : t('usage.perTrunk')}
              </span>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">{t('usage.groupBy')}</label>
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                  className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-sm text-white"
                >
                  <option value="campaign">{t('usage.groupByCampaign')}</option>
                  <option value="source">{t('usage.groupBySource')}</option>
                  <option value="trunk">{t('usage.groupByTrunk')}</option>
                </select>
              </div>
            </div>
            {groupBy === 'campaign' && (
              data.byCampaign.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-400">
                  {t('usage.noBillableCalls')}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/60 text-gray-300">
                    <tr>
                      <th className="text-left px-4 py-3">{t('usage.campaign')}</th>
                      <th className="text-right px-4 py-3">{t('usage.calls')}</th>
                      <th className="text-right px-4 py-3">{t('usage.minutes')}</th>
                      <th className="text-right px-4 py-3">{t('usage.cost')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCampaign.map((c) => (
                      <tr key={c.campaignId} className="border-t border-slate-700 hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-white">{c.campaignName}</td>
                        <td className="px-4 py-3 text-right text-gray-300">{c.answeredCalls.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-gray-300">{c.minutes.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-gray-300">
                          {c.usageCostAzn.toFixed(2)} {data.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
            {groupBy === 'source' && (
              data.bySource.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-400">
                  {t('usage.noBillableCalls')}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/60 text-gray-300">
                    <tr>
                      <th className="text-left px-4 py-3">{t('usage.source')}</th>
                      <th className="text-right px-4 py-3">{t('usage.calls')}</th>
                      <th className="text-right px-4 py-3">{t('usage.minutes')}</th>
                      <th className="text-right px-4 py-3">{t('usage.cost')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bySource.map((s) => (
                      <tr key={s.source} className="border-t border-slate-700 hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-white">{sourceLabels[s.source] ?? s.source}</td>
                        <td className="px-4 py-3 text-right text-gray-300">{s.answeredCalls.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-gray-300">{s.minutes.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-gray-300">
                          {s.usageCostAzn.toFixed(2)} {data.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
            {groupBy === 'trunk' && (
              data.byTrunk.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-400">
                  {t('usage.noBillableCalls')}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/60 text-gray-300">
                    <tr>
                      <th className="text-left px-4 py-3">{t('usage.trunk')}</th>
                      <th className="text-right px-4 py-3">{t('usage.calls')}</th>
                      <th className="text-right px-4 py-3">{t('usage.minutes')}</th>
                      <th className="text-right px-4 py-3">{t('usage.cost')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byTrunk.map((tr) => (
                      <tr key={tr.trunkId ?? 'auto'} className="border-t border-slate-700 hover:bg-slate-700/40">
                        <td className="px-4 py-3 text-white">{trunkLabel(tr.trunkId)}</td>
                        <td className="px-4 py-3 text-right text-gray-300">{tr.answeredCalls.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-gray-300">{tr.minutes.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-gray-300">
                          {tr.usageCostAzn.toFixed(2)} {data.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
