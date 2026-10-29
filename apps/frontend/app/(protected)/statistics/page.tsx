'use client';

import { useTelephony } from '@/hooks/useTelephony';
import { useCallsStats, useAgents, useCustomersPage, useRecordings } from '@/hooks/useCallbot';
import { useLanguage } from '@/lib/language';

export default function StatisticsPage() {
  const { t } = useLanguage();
  const { accounts, trunks, ivrs, rules } = useTelephony();
  const { total: totalCalls, active: activeCalls, completed: completedCalls } = useCallsStats();
  const { agents } = useAgents();
  // pageSize: 1 — only .total is used here; avoids fetching all ~33k customers just for a count.
  const { total: totalCustomers } = useCustomersPage(1);
  const { recordings } = useRecordings();

  // Calculate statistics
  const stats = {
    telephony: {
      accounts: accounts?.length || 0,
      trunks: trunks?.length || 0,
      ivrs: ivrs?.length || 0,
      rules: rules?.length || 0,
    },
    callbot: {
      totalCalls,
      activeCalls,
      completedCalls,
      agents: agents?.length || 0,
      activeAgents: agents?.filter((a) => a.enabled)?.length || 0,
      customers: totalCustomers,
      recordings: recordings?.length || 0,
    },
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-white mb-8">{t('statistics.title')}</h1>

      {/* Telephony Configuration Stats */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-4">{t('statistics.telephonyConfiguration')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="text-gray-400 text-sm font-medium mb-2">{t('statistics.sipAccounts')}</div>
            <div className="text-3xl font-bold text-blue-400">{stats.telephony.accounts}</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="text-gray-400 text-sm font-medium mb-2">{t('statistics.sipTrunks')}</div>
            <div className="text-3xl font-bold text-green-400">{stats.telephony.trunks}</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="text-gray-400 text-sm font-medium mb-2">{t('statistics.ivrMenus')}</div>
            <div className="text-3xl font-bold text-purple-400">{stats.telephony.ivrs}</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="text-gray-400 text-sm font-medium mb-2">{t('statistics.dialplanRules')}</div>
            <div className="text-3xl font-bold text-yellow-400">{stats.telephony.rules}</div>
          </div>
        </div>
      </div>

      {/* Call Center Stats */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-4">{t('statistics.callCenter')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="text-gray-400 text-sm font-medium mb-2">{t('statistics.totalCalls')}</div>
            <div className="text-3xl font-bold text-blue-400">{stats.callbot.totalCalls}</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="text-gray-400 text-sm font-medium mb-2">{t('statistics.activeCalls')}</div>
            <div className="text-3xl font-bold text-green-400">{stats.callbot.activeCalls}</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="text-gray-400 text-sm font-medium mb-2">{t('statistics.completedCalls')}</div>
            <div className="text-3xl font-bold text-purple-400">{stats.callbot.completedCalls}</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="text-gray-400 text-sm font-medium mb-2">{t('statistics.recordings')}</div>
            <div className="text-3xl font-bold text-yellow-400">{stats.callbot.recordings}</div>
          </div>
        </div>
      </div>

      {/* Agents & Customers Stats */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">{t('statistics.resources')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="text-gray-400 text-sm font-medium mb-2">{t('statistics.agents')}</div>
            <div className="text-3xl font-bold text-blue-400">{stats.callbot.agents}</div>
            <div className="text-xs text-gray-500 mt-2">
              {stats.callbot.activeAgents} {t('statistics.active')}
            </div>
          </div>
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="text-gray-400 text-sm font-medium mb-2">{t('statistics.customers')}</div>
            <div className="text-3xl font-bold text-green-400">{stats.callbot.customers}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
