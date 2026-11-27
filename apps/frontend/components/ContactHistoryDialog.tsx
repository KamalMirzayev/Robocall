'use client';

import { useEffect, useState } from 'react';
import callbotApi from '@/lib/callbot-api';
import { useLanguage } from '@/lib/language';
import { formatDate } from '@/lib/date-format';
import type { ContactHistory, ContactHistoryCall, ContactHistoryFeedback } from '@/types/callbot';

// "Son əlaqə" details: each call with the result the bot recorded for it, the reason,
// the AI summary and the transcript, newest first.
export default function ContactHistoryDialog({ customerId, title, onClose }: { customerId: number; title: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [data, setData] = useState<ContactHistory | null>(null);
  const [openTranscript, setOpenTranscript] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    callbotApi.getContactHistory(customerId).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [customerId]);

  const fmt = (v: string | null | undefined) => (v ? formatDate(v) : '-');

  // Pair each result with its call (same telephony job, else the nearest call before it).
  const entries: Array<{ call: ContactHistoryCall | null; feedback: ContactHistoryFeedback[] }> = [];
  if (data) {
    const used = new Set<number>();
    for (const call of data.calls) {
      const fb = data.feedback.filter((f) => !used.has(f.id) && call.telephonyJobId != null && f.telephonyJobId === call.telephonyJobId);
      fb.forEach((f) => used.add(f.id));
      entries.push({ call, feedback: fb });
    }
    for (const f of data.feedback) {
      if (used.has(f.id)) continue;
      const at = new Date(f.createdAt).getTime();
      const host = entries.find((e) => e.call && new Date(e.call.startedAt).getTime() <= at);
      if (host) host.feedback.push(f);
      else entries.push({ call: null, feedback: [f] });
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{t('customers.arzoom.history.historyTitle')}</h2>
            <p className="text-sm text-gray-400">{title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">{t('customers.arzoom.history.close')}</button>
        </div>

        {!data && <p className="text-gray-400 text-sm">{t('customers.arzoom.history.loading')}</p>}
        {data && entries.length === 0 && <p className="text-gray-400 text-sm">{t('customers.arzoom.history.noHistory')}</p>}

        <div className="space-y-3">
          {entries.map((e, i) => (
            <div key={e.call ? `c${e.call.id}` : `f${i}`} className="border border-slate-700 rounded-md p-3 space-y-2">
              {e.call && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                  <span className="text-gray-200">{fmt(e.call.startedAt)}</span>
                  {e.call.durationSeconds != null && (
                    <span>{t('customers.arzoom.history.duration')}: {e.call.durationSeconds} {t('customers.arzoom.history.sec')}</span>
                  )}
                  {e.call.phone && <span>{e.call.phone}</span>}
                  {e.call.jobStatus && <span>{e.call.jobStatus}</span>}
                </div>
              )}

              {e.feedback.map((f) => (
                <div key={f.id} className="bg-slate-900/60 rounded p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-xs">{f.outcomeLabel}</span>
                    <span className="text-xs text-gray-500">{fmt(f.createdAt)}</span>
                    <span className={`text-xs ${f.pushedAt && !f.pushError ? 'text-green-400' : 'text-amber-400'}`}>
                      {f.pushedAt && !f.pushError ? t('customers.arzoom.history.sentToArzoom') : t('customers.arzoom.history.notSent')}
                    </span>
                  </div>
                  {f.reason && (
                    <p className="mt-1 text-gray-200 whitespace-pre-wrap">
                      <span className="text-gray-500">{t('customers.arzoom.history.reason')}: </span>
                      {f.reason}
                    </p>
                  )}
                </div>
              ))}

              {e.call?.summary && (
                <p className="text-sm text-gray-300 whitespace-pre-wrap">
                  <span className="text-gray-500">{t('customers.arzoom.history.summary')}: </span>
                  {e.call.summary}
                </p>
              )}
              {e.call?.transcript && (
                <div>
                  <button
                    className="text-xs text-blue-400 hover:underline"
                    onClick={() => setOpenTranscript(openTranscript === e.call!.id ? null : e.call!.id)}
                  >
                    {t('customers.arzoom.history.transcript')}
                  </button>
                  {openTranscript === e.call.id && (
                    <pre className="mt-1 text-xs text-gray-300 whitespace-pre-wrap bg-slate-900/60 rounded p-2 max-h-64 overflow-y-auto">{e.call.transcript}</pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
