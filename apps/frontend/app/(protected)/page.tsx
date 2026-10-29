'use client';

import { useLanguage } from '@/lib/language';

export default function DashboardPage() {
  const { t } = useLanguage();

  return (
    <div className="p-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">{t('dashboard.controlCenter')}</p>
          <h1 className="mt-2 text-3xl font-bold text-white">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm text-slate-400">{t('dashboard.subtitle')}</p>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-6 shadow-lg">
          <p className="text-sm text-gray-400">{t('dashboard.activeCalls')}</p>
          <p className="mt-2 text-3xl font-bold text-white">0</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-6 shadow-lg">
          <p className="text-sm text-gray-400">{t('dashboard.totalAgents')}</p>
          <p className="mt-2 text-3xl font-bold text-white">0</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-6 shadow-lg">
          <p className="text-sm text-gray-400">{t('dashboard.customers')}</p>
          <p className="mt-2 text-3xl font-bold text-white">0</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-6 shadow-lg">
          <p className="text-sm text-gray-400">{t('dashboard.systemStatus')}</p>
          <p className="mt-2 text-sm font-medium text-green-400">● {t('dashboard.online')}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold text-white">{t('dashboard.quickNavigation')}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <a href="/calls" className="rounded-lg border border-slate-600 bg-slate-700/70 p-4 text-white transition hover:border-slate-500 hover:bg-slate-600/80">
            {t('dashboard.liveCalls')}
          </a>
          <a href="/agents" className="rounded-lg border border-slate-600 bg-slate-700/70 p-4 text-white transition hover:border-slate-500 hover:bg-slate-600/80">
            {t('dashboard.agents')}
          </a>
          <a href="/customers" className="rounded-lg border border-slate-600 bg-slate-700/70 p-4 text-white transition hover:border-slate-500 hover:bg-slate-600/80">
            {t('dashboard.customers')}
          </a>
          <a href="/recordings" className="rounded-lg border border-slate-600 bg-slate-700/70 p-4 text-white transition hover:border-slate-500 hover:bg-slate-600/80">
            {t('dashboard.recordings')}
          </a>
          <a href="/telephony" className="rounded-lg border border-slate-600 bg-slate-700/70 p-4 text-white transition hover:border-slate-500 hover:bg-slate-600/80">
            {t('dashboard.telephonyTools')}
          </a>
          <a href="/admin" className="rounded-lg border border-slate-600 bg-slate-700/70 p-4 text-white transition hover:border-slate-500 hover:bg-slate-600/80">
            {t('dashboard.admin')}
          </a>
        </div>
      </div>
    </div>
  );
}
