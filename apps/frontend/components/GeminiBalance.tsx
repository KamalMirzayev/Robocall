'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import callbotApi from '@/lib/callbot-api';
import { useLanguage } from '@/lib/language';
import type { GeminiBalance as Balance } from '@/types/callbot';

// Remaining Gemini balance (entered balance minus estimated spend since), refreshed every minute.
const REFRESH_MS = 60_000;

function usd(n: number) {
  return '$' + n.toFixed(2);
}

export default function GeminiBalance({ variant = 'compact' }: { variant?: 'compact' | 'card' }) {
  const { t } = useLanguage();
  const [b, setB] = useState<Balance | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => callbotApi.getGeminiBalance().then((d) => {
      if (alive && d) setB(d);
    });
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!b) return null;
  const low = b.configured && b.remainingUsd !== undefined && b.startingBalanceUsd ? b.remainingUsd < b.startingBalanceUsd * 0.15 : false;
  const tone = !b.configured ? 'text-slate-300' : low ? 'text-rose-400' : 'text-emerald-400';
  const main = b.configured ? usd(b.remainingUsd ?? 0) : t('geminiBalance.notSet');

  if (variant === 'compact') {
    return (
      <Link href="/admin" className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2" title={t('geminiBalance.hint')}>
        <p className="text-[11px] text-[#8f9ac4]">{t('geminiBalance.title')}</p>
        <p className={`text-sm font-bold tabular-nums ${tone}`}>{main}</p>
        <p className="text-[11px] text-[#6f7aa3]">{t('geminiBalance.today')}: {usd(b.todaySpentUsd)}</p>
      </Link>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-5 shadow-lg">
      <p className="text-sm text-slate-400">{t('geminiBalance.title')}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${tone}`}>{main}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        {b.configured ? (
          <>
            <div><p className="text-xs text-slate-500">{t('geminiBalance.starting')}</p><p className="tabular-nums text-slate-200">{usd(b.startingBalanceUsd ?? 0)}</p></div>
            <div><p className="text-xs text-slate-500">{t('geminiBalance.spentSince')}</p><p className="tabular-nums text-slate-200">{usd(b.spentSinceSetUsd ?? 0)}</p></div>
          </>
        ) : null}
        <div><p className="text-xs text-slate-500">{t('geminiBalance.today')}</p><p className="tabular-nums text-slate-200">{usd(b.todaySpentUsd)}</p></div>
        <div><p className="text-xs text-slate-500">{t('geminiBalance.lastHour')}</p><p className="tabular-nums text-slate-200">{usd(b.lastHourSpentUsd)}</p></div>
      </div>
      {b.configured && b.hoursLeftAtCurrentRate != null ? (
        <p className="mt-2 text-xs text-slate-400">{t('geminiBalance.hoursLeft').replace('{h}', String(Math.round(b.hoursLeftAtCurrentRate)))}</p>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">
        {b.configured && b.setAt ? `${t('geminiBalance.setAt')} ${new Date(b.setAt).toLocaleString('az-AZ', { timeZone: 'Asia/Baku' })}. ` : ''}
        {t('geminiBalance.hint')}
      </p>
    </div>
  );
}
