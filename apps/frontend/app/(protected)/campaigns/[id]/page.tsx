'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import callbotApi from '@/lib/callbot-api';
import { formatDate } from '@/lib/date-format';
import { useLanguage } from '@/lib/language';
import type { Campaign, CampaignCallHistoryItem } from '@/types/callbot';

function statusColor(status: CampaignCallHistoryItem['status'] | Campaign['status']): string {
  if (status === 'completed') return 'text-green-300';
  if (status === 'failed') return 'text-red-300';
  if (status === 'calling') return 'text-blue-300';
  if (status === 'active') return 'text-green-300';
  if (status === 'paused') return 'text-yellow-300';
  if (status === 'cancelled') return 'text-red-300';
  return 'text-gray-300';
}

export default function CampaignDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useLanguage();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignCalls, setCampaignCalls] = useState<CampaignCallHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importingMatches, setImportingMatches] = useState(false);
  const [importMatchesError, setImportMatchesError] = useState<string | null>(null);

  const campaignId = useMemo(() => Number(params?.id || 0), [params?.id]);

  useEffect(() => {
    if (!campaignId) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [campaignData, callsData] = await Promise.all([
          callbotApi.getCampaign(campaignId),
          callbotApi.getCampaignCalls(campaignId),
        ]);
        setCampaign(campaignData);
        setCampaignCalls(Array.isArray(callsData.items) ? callsData.items : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('campaignDetail.loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [campaignId]);

  const failedCalls = Math.max(0, (campaign?.completedCalls || 0) - (campaign?.successfulCalls || 0));

  if (loading) {
    return <div className="p-8 text-gray-400">{t('campaignDetail.loading')}</div>;
  }

  if (error) {
    return <div className="p-8 text-red-300">{error}</div>;
  }

  if (!campaign) {
    return <div className="p-8 text-gray-400">{t('campaignDetail.notFound')}</div>;
  }

  const updateStatus = async (status: Campaign['status']) => {
    try {
      const next = await callbotApi.updateCampaign(campaign.id, { status });
      setCampaign(next as Campaign);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('campaignDetail.updateFailed'));
    }
  };

  const fetchNewMatches = async () => {
    setImportingMatches(true);
    setImportMatchesError(null);
    try {
      await callbotApi.importCampaignNewPksMatches(campaign.id);
      const [campaignData, callsData] = await Promise.all([
        callbotApi.getCampaign(campaign.id),
        callbotApi.getCampaignCalls(campaign.id),
      ]);
      setCampaign(campaignData);
      setCampaignCalls(Array.isArray(callsData.items) ? callsData.items : []);
    } catch (err) {
      setImportMatchesError(err instanceof Error ? err.message : t('campaignDetail.newMatchesFetchFailed'));
    } finally {
      setImportingMatches(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/campaigns')}
            className="px-3 py-2 rounded border border-slate-600 text-gray-300 hover:bg-slate-700"
          >
            {t('campaignDetail.back')}
          </button>
          <div>
            <h1 className="text-3xl font-bold text-white">{campaign.name}</h1>
            <p className="text-gray-400">{campaign.description || t('campaignDetail.defaultDescription')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/callbot/campaigns/${campaign.id}/export.xlsx`}
            className="px-4 py-2 rounded border border-slate-600 text-gray-300 hover:bg-slate-700"
          >
            {t('campaignDetail.export')}
          </a>
          <button
            onClick={() => updateStatus('paused')}
            disabled={campaign.status !== 'active'}
            className="px-4 py-2 rounded border border-slate-600 text-gray-300 hover:bg-slate-700 disabled:opacity-50"
          >
            {t('campaignDetail.pause')}
          </button>
          <button
            onClick={() => updateStatus('active')}
            disabled={campaign.status === 'active' || campaign.status === 'completed' || campaign.status === 'cancelled'}
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            {t('campaignDetail.resume')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <p className="text-xs text-gray-400">{t('campaignDetail.totalCustomers')}</p>
          <p className="text-2xl text-white font-semibold">{campaign.totalCustomers}</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <p className="text-xs text-gray-400">{t('campaignDetail.completedCalls')}</p>
          <p className="text-2xl text-white font-semibold">{campaign.completedCalls}</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <p className="text-xs text-gray-400">{t('campaignDetail.successfulCalls')}</p>
          <p className="text-2xl text-white font-semibold">{campaign.successfulCalls}</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <p className="text-xs text-gray-400">{t('campaignDetail.failedCalls')}</p>
          <p className="text-2xl text-white font-semibold">{failedCalls}</p>
        </div>
      </div>

      {!!campaign.newCustomerMatchesCount && (
        <div className="bg-slate-800 border border-blue-700/50 rounded-lg p-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-white">
              <strong className="text-blue-300">{campaign.newCustomerMatchesCount}</strong>{' '}
              {t('campaignDetail.newMatchesTitle')}
            </p>
            {campaign.newCustomerMatchesCheckedAt && (
              <p className="text-xs text-gray-400 mt-1">
                {t('campaignDetail.newMatchesAsOf')} {formatDate(campaign.newCustomerMatchesCheckedAt)}
              </p>
            )}
            {importMatchesError && <p className="text-xs text-red-300 mt-1">{importMatchesError}</p>}
          </div>
          <button
            onClick={fetchNewMatches}
            disabled={importingMatches}
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap"
          >
            {importingMatches ? t('campaignDetail.newMatchesFetching') : t('campaignDetail.newMatchesFetch')}
          </button>
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-white mb-4">{t('campaignDetail.configuration')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">{t('campaignDetail.runWindow')}</p>
            <p className="text-white">{campaign.runWindowStart} - {campaign.runWindowEnd}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">{t('campaignDetail.maxAttempts')}</p>
            <p className="text-white">{campaign.maxAttempts}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">{t('campaignDetail.retryInterval')}</p>
            <p className="text-white">{campaign.retryIntervalHours} {t('campaignDetail.hours')}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">{t('campaignDetail.runDays')}</p>
            <p className="text-white">
              {campaign.runWeekdays && campaign.runWeekdays.length > 0
                ? campaign.runWeekdays.map(d => {
                  const dayMap: Record<string, string> = {
                    '1': t('campaignDetail.days.mon'), '2': t('campaignDetail.days.tue'),
                    '3': t('campaignDetail.days.wed'), '4': t('campaignDetail.days.thu'),
                    '5': t('campaignDetail.days.fri'), '6': t('campaignDetail.days.sat'),
                    '7': t('campaignDetail.days.sun')
                  };
                  return dayMap[d] || d;
                }).join(', ')
                : t('campaignDetail.allDays')}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">{t('campaignDetail.skipNextDay')}</p>
            <p className="text-white">{campaign.skipNextDayAfterSuccess ? t('campaignDetail.yes') : t('campaignDetail.no')}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">{t('campaignDetail.orderByPayment')}</p>
            <p className="text-white">{campaign.orderByMonthlyPaymentDesc ? t('campaignDetail.yes') : t('campaignDetail.no')}</p>
          </div>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-gray-300">
            <tr>
              <th className="text-left px-4 py-3">{t('campaignDetail.tableCustomer')}</th>
              <th className="text-left px-4 py-3">{t('campaignDetail.tableFin')}</th>
              <th className="text-left px-4 py-3">{t('campaignDetail.tablePhone')}</th>
              <th className="text-left px-4 py-3">{t('campaignDetail.tableStatus')}</th>
              <th className="text-left px-4 py-3">{t('campaignDetail.tableAttempt')}</th>
              <th className="text-left px-4 py-3">{t('campaignDetail.tableResult')}</th>
              <th className="text-left px-4 py-3">{t('campaignDetail.tableLastAttempt')}</th>
            </tr>
          </thead>
          <tbody>
            {campaignCalls.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">{t('campaignDetail.noRecords')}</td>
              </tr>
            )}
            {campaignCalls.map((row) => (
              <tr key={row.id} className="border-t border-slate-700">
                <td className="px-4 py-3 text-white">{row.customerName || '-'}</td>
                <td className="px-4 py-3 text-gray-300">{row.fin || '-'}</td>
                <td className="px-4 py-3 text-gray-300">{row.phone || '-'}</td>
                <td className={`px-4 py-3 ${statusColor(row.status)}`}>{row.status}</td>
                <td className="px-4 py-3 text-gray-300">#{row.attemptNumber}</td>
                <td className="px-4 py-3 text-gray-300">{row.lastCallSummary || row.lastCallDescription || '-'}</td>
                <td className="px-4 py-3 text-gray-300">{row.updatedAt ? formatDate(row.updatedAt) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
