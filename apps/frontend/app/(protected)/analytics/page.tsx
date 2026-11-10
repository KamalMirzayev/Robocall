'use client';

import { useCallback, useEffect, useState } from 'react';
import callbotApi from '@/lib/callbot-api';
import { useLanguage } from '@/lib/language';
import type { CallAnalytics } from '@/types/callbot';

// Call analytics: attempts, answer rate, conversation outcomes, retry queue and sales
// transfers. Refreshes itself every 30 seconds.
const REFRESH_MS = 30_000;

const REP_NAMES: Record<string, string> = {
  '161': 'Raqif Amiraslanov', '162': 'Jeyhun Mammadli', '125': 'Rashad Khalilzade', '163': 'Rasim Babayev',
  '334': 'Kamran Feyzullayev', '305': 'Ergun Jalilov', '324': 'Tarlan Badalov', '306': 'Rashid Khalilov', '325': 'Nabat Tağızade',
  '514': 'Elchin Huseynov', '241': 'Amin Mukhtarzade', '220': 'Rufat Isbandiyarov',
};

const OUTCOME_COLORS: Record<string, string> = {
  agrees_will_visit: 'bg-emerald-500', agrees_will_call: 'bg-emerald-400', transferred_to_sales: 'bg-teal-400',
  docs_will_send: 'bg-sky-400', thinking: 'bg-amber-400', callback: 'bg-amber-300',
  wants_lower_monthly: 'bg-orange-400', wants_lower_down: 'bg-orange-500', wants_other_terms: 'bg-orange-300',
  docs_cannot: 'bg-rose-400', declined: 'bg-rose-500', wrong_person: 'bg-slate-400', other: 'bg-slate-500',
};

function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function fmtDuration(sec: number) {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtTime(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T').replace(/\+00$/, 'Z'));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('az-AZ', { timeZone: 'Asia/Baku', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-700 bg-slate-800/70 p-5 shadow-lg ${className}`}>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, hint, tone = 'text-white' }: { label: string; value: string | number; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-4 shadow-lg">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export default function AnalyticsPage() {
  const { t } = useLanguage();
  const [days, setDays] = useState(1);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [data, setData] = useState<CallAnalytics | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await callbotApi.getCallAnalytics({ days, campaignId });
    if (res) {
      setData(res);
      setError(false);
    } else {
      setError(true);
    }
    setLoading(false);
  }, [days, campaignId]);

  useEffect(() => {
    setLoading(true);
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const k = data?.kpi;
  const answerRate = k ? pct(k.answered, k.attempts - k.in_progress) : 0;
  const outcomesTotal = (data?.outcomes || []).reduce((n, o) => n + o.count, 0);
  const failuresTotal = (data?.failures || []).reduce((n, o) => n + o.count, 0);
  const transfersAnswered = (data?.transfers || []).reduce((n, o) => n + o.answered, 0);
  const dailyMax = Math.max(1, ...(data?.daily || []).map((d) => d.attempts));
  const hourMap = new Map((data?.hourly || []).map((h) => [h.hour, h]));
  const hours = Array.from({ length: 13 }, (_, i) => i + 9);
  const hourMax = Math.max(1, ...(data?.hourly || []).map((h) => h.attempts));
  const appStatus = (s: string | null) => (s ? t(`analytics.appStatus.${s}`).replace(`analytics.appStatus.${s}`, s) : '—');

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">{t('analytics.title')}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {t('analytics.subtitle')}
            {data ? ` · ${t('analytics.updated')} ${fmtTime(data.generatedAt)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-600">
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-sm ${days === d ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                {d === 1 ? t('analytics.today') : t('analytics.lastDays').replace('{n}', String(d))}
              </button>
            ))}
          </div>
          <select
            value={campaignId ?? ''}
            onChange={(e) => setCampaignId(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
          >
            <option value="">{t('analytics.allCampaigns')}</option>
            {(data?.campaigns || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button onClick={() => void load()} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700">
            {t('analytics.refresh')}
          </button>
        </div>
      </div>

      {error && !data ? <p className="text-rose-400">{t('analytics.loadError')}</p> : null}
      {loading && !data ? <p className="text-slate-400">{t('analytics.loading')}</p> : null}

      {data && k ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Kpi label={t('analytics.kpi.attempts')} value={k.attempts} hint={k.in_progress ? `${k.in_progress} ${t('analytics.kpi.inProgress')}` : undefined} />
            <Kpi label={t('analytics.kpi.answered')} value={k.answered} hint={`${answerRate}%`} tone="text-emerald-400" />
            <Kpi label={t('analytics.kpi.unanswered')} value={k.unanswered} tone="text-rose-400" />
            <Kpi label={t('analytics.kpi.customers')} value={`${k.reached_customers} / ${k.customers}`} hint={t('analytics.kpi.customersHint')} />
            <Kpi label={t('analytics.kpi.avgDuration')} value={fmtDuration(k.avg_duration)} />
            <Kpi label={t('analytics.kpi.totalMinutes')} value={Math.round(k.total_seconds / 60)} />
            <Kpi label={t('analytics.kpi.transfers')} value={transfersAnswered} tone="text-teal-300" />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title={t('analytics.outcomes')}>
              {outcomesTotal === 0 ? <p className="text-sm text-slate-500">{t('analytics.empty')}</p> : (
                <ul className="space-y-2">
                  {data.outcomes.map((o) => (
                    <li key={o.outcome}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-slate-200">{o.label}</span>
                        <span className="tabular-nums text-slate-400">{o.count} · {pct(o.count, outcomesTotal)}%</span>
                      </div>
                      <div className="h-2 rounded bg-slate-700">
                        <div className={`h-2 rounded ${OUTCOME_COLORS[o.outcome] || 'bg-slate-500'}`} style={{ width: `${pct(o.count, outcomesTotal)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title={t('analytics.queue')}>
              {data.queue.length === 0 ? <p className="text-sm text-slate-500">{t('analytics.empty')}</p> : (
                <div className="space-y-5">
                  {data.queue.map((q) => {
                    const parts = [
                      { key: 'completed', n: q.completed, cls: 'bg-emerald-500' },
                      { key: 'attempting', n: q.attempting, cls: 'bg-sky-400' },
                      { key: 'retrying', n: q.retrying, cls: 'bg-amber-400' },
                      { key: 'pending', n: q.pending, cls: 'bg-slate-400' },
                      { key: 'failed', n: q.failed, cls: 'bg-rose-500' },
                      { key: 'cancelled', n: q.cancelled, cls: 'bg-slate-600' },
                    ];
                    return (
                      <div key={q.id}>
                        <div className="mb-1 flex flex-wrap justify-between gap-2 text-sm">
                          <span className="font-medium text-slate-200">{q.name}</span>
                          <span className="text-slate-400">
                            {t('analytics.retryRule').replace('{h}', String(q.retry_interval_hours)).replace('{n}', String(q.max_attempts))}
                          </span>
                        </div>
                        <div className="flex h-3 overflow-hidden rounded bg-slate-700">
                          {parts.map((p) => p.n > 0 && <div key={p.key} className={p.cls} style={{ width: `${pct(p.n, q.total)}%` }} title={`${t(`analytics.queueStatus.${p.key}`)}: ${p.n}`} />)}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                          {parts.map((p) => (
                            <span key={p.key} className="flex items-center gap-1">
                              <span className={`inline-block h-2 w-2 rounded-sm ${p.cls}`} />
                              {t(`analytics.queueStatus.${p.key}`)}: <span className="tabular-nums text-slate-200">{p.n}</span>
                            </span>
                          ))}
                        </div>
                        {q.next_call_after ? (
                          <p className="mt-1 text-xs text-amber-300">{t('analytics.nextRetry')}: {fmtTime(q.next_call_after)}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card title={days === 1 ? t('analytics.byHour') : t('analytics.byDay')} className="xl:col-span-2">
              <div className="flex h-44 items-end gap-1 overflow-x-auto">
                {(days === 1 ? hours.map((h) => ({ key: `${h}:00`, attempts: hourMap.get(h)?.attempts || 0, answered: hourMap.get(h)?.answered || 0, max: hourMax }))
                  : data.daily.map((d) => ({ key: d.day.slice(5), attempts: d.attempts, answered: d.answered, max: dailyMax }))
                ).map((b) => (
                  <div key={b.key} className="flex min-w-[22px] flex-1 flex-col items-center gap-1" title={`${b.key}: ${b.answered}/${b.attempts}`}>
                    <span className="text-[10px] tabular-nums text-slate-400">{b.attempts || ''}</span>
                    <div className="relative w-full rounded-t bg-slate-600" style={{ height: `${Math.max(2, (b.attempts / b.max) * 130)}px` }}>
                      <div className="absolute bottom-0 w-full rounded-t bg-emerald-500" style={{ height: `${b.attempts ? (b.answered / b.attempts) * 100 : 0}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-500">{b.key}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />{t('analytics.kpi.answered')}</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-slate-600" />{t('analytics.kpi.unanswered')}</span>
              </div>
            </Card>

            <Card title={t('analytics.failures')}>
              {failuresTotal === 0 ? <p className="text-sm text-slate-500">{t('analytics.empty')}</p> : (
                <ul className="space-y-2 text-sm">
                  {data.failures.map((f) => (
                    <li key={f.reason} className="flex justify-between">
                      <span className="text-slate-200">{t(`analytics.failure.${f.reason}`)}</span>
                      <span className="tabular-nums text-slate-400">{f.count} · {pct(f.count, failuresTotal)}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title={t('analytics.transfers')} className="mb-6">
            {data.transfers.length === 0 ? <p className="text-sm text-slate-500">{t('analytics.empty')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-400">
                    <tr><th className="py-1 pr-4">{t('analytics.rep')}</th><th className="pr-4">{t('analytics.brand')}</th><th className="pr-4">{t('analytics.connected')}</th><th>{t('analytics.missed')}</th></tr>
                  </thead>
                  <tbody>
                    {data.transfers.map((r) => (
                      <tr key={r.extension} className="border-t border-slate-700">
                        <td className="py-1.5 pr-4 text-slate-200">{r.extension} {REP_NAMES[r.extension] || ''}</td>
                        <td className="pr-4 text-slate-300">{r.brand || '—'}</td>
                        <td className="pr-4 tabular-nums text-emerald-400">{r.answered}</td>
                        <td className="tabular-nums text-rose-400">{r.missed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t('analytics.recent')}>
            {data.recent.length === 0 ? <p className="text-sm text-slate-500">{t('analytics.empty')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="text-left text-xs text-slate-400">
                    <tr>
                      <th className="py-1 pr-3">{t('analytics.col.time')}</th>
                      <th className="pr-3">{t('analytics.col.customer')}</th>
                      <th className="pr-3">{t('analytics.col.status')}</th>
                      <th className="pr-3">{t('analytics.col.call')}</th>
                      <th className="pr-3">{t('analytics.col.outcome')}</th>
                      <th>{t('analytics.col.analysis')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r) => (
                      <tr key={r.id} className="border-t border-slate-700 align-top">
                        <td className="whitespace-nowrap py-2 pr-3 text-slate-400">{fmtTime(r.created_at)}</td>
                        <td className="pr-3 text-slate-200">
                          {r.customer_name || '—'}
                          <div className="text-xs text-slate-500">{r.application_id || r.phone}</div>
                        </td>
                        <td className="whitespace-nowrap pr-3 text-slate-300">{appStatus(r.application_status)}</td>
                        <td className="whitespace-nowrap pr-3">
                          {r.answered
                            ? <span className="text-emerald-400">{t('analytics.kpi.answered')} · {fmtDuration(r.duration_seconds || 0)}</span>
                            : r.status === 'failed' || r.status === 'ended'
                              ? <span className="text-rose-400">{t('analytics.kpi.unanswered')}</span>
                              : <span className="text-sky-300">{t('analytics.kpi.inProgress')}</span>}
                        </td>
                        <td className="pr-3 text-slate-200">{r.outcome_label || '—'}</td>
                        <td className="max-w-md text-xs text-slate-400">{r.reason || r.summary || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
