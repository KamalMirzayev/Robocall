'use client';

import { useEffect, useState } from 'react';
import apiClient from '@/lib/api-client';
import { useLanguage } from '@/lib/language';
import { SEGMENT_FIELDS } from '@/lib/segments';

interface ArzoomImportPanelProps {
  campaignId: number;
  // The campaign's own "statuses" parameter (comma-separated), used as the default pick.
  campaignStatuses?: string | null;
  onImported?: () => void | Promise<void>;
}

interface ImportResult {
  eligible: number;
  added: number;
  byStatus: Record<string, number>;
}

// Adds ARZOOM credit applications to a campaign by application status. Rejected
// applications are never offered: they are not called.
export default function ArzoomImportPanel({ campaignId, campaignStatuses, onImported }: ArzoomImportPanelProps) {
  const { t, locale } = useLanguage();
  const options = SEGMENT_FIELDS.application_status?.find((f) => f.key === 'statuses')?.options ?? [];
  const [picked, setPicked] = useState<string[]>(
    campaignStatuses ? campaignStatuses.split(',').filter(Boolean) : ['approved', 'needs_documents', 'declined', 'sent_to_sales']
  );
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (dryRun: boolean) => {
    const { data } = await apiClient.post<ImportResult>(`/callbot/campaigns/${campaignId}/import-arzoom`, { statuses: picked, dryRun });
    return data;
  };

  useEffect(() => {
    let cancelled = false;
    setDone(null);
    setError(null);
    if (!picked.length) {
      setPreview({ eligible: 0, added: 0, byStatus: {} });
      return;
    }
    call(true)
      .then((data) => !cancelled && setPreview(data))
      .catch((err) => !cancelled && setError(err?.response?.data?.error || err?.message || 'error'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.join(','), campaignId]);

  const runImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await call(false);
      setDone(data);
      await onImported?.();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">{t('campaigns.import.arzoomHint')}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const on = picked.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPicked((prev) => (on ? prev.filter((v) => v !== opt.value) : [...prev, opt.value]))}
              className={`px-3 py-1.5 rounded-full border text-xs font-medium transition ${
                on ? 'border-blue-500 bg-blue-50 text-blue-300' : 'border-slate-600 text-gray-300 hover:bg-slate-700'
              }`}
            >
              {opt.label[locale]}
              {preview?.byStatus[opt.value] ? ` · ${preview.byStatus[opt.value]}` : ''}
            </button>
          );
        })}
      </div>
      <div className="text-sm text-gray-300">
        {preview ? `${t('campaigns.import.arzoomEligible')}: ${preview.eligible}` : t('campaigns.import.arzoomCounting')}
      </div>
      {error && <div className="p-3 rounded-lg border border-red-500 bg-red-500/10 text-red-300 text-sm">{error}</div>}
      {done && (
        <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-sm">
          {t('campaigns.import.arzoomAdded')}: {done.added} ({t('campaigns.import.arzoomAlready')}: {done.eligible - done.added})
        </div>
      )}
      <button
        type="button"
        onClick={runImport}
        disabled={busy || !preview?.eligible}
        className="px-4 py-2 rounded-lg bg-green-700 hover:bg-green-800 text-[#fff] disabled:opacity-60"
      >
        {busy ? t('campaigns.import.arzoomImporting') : t('campaigns.import.arzoomImportButton')}
      </button>
    </div>
  );
}
