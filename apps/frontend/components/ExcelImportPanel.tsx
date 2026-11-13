'use client';

import { useState } from 'react';
import apiClient from '@/lib/api-client';

interface ImportResult {
  columns: Array<{ header: string; field: string | null }>;
  total: number;
  valid: number;
  invalidPhones: number;
  duplicates: number;
  doNotCall: number;
  alreadyInCampaign: number;
  added: number;
  sample: Array<{ name: string; phone: string | null; brand: string; model?: string; last_service_date: string; last_talk: string }>;
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Müştəri adı',
  phone: 'Telefon',
  brand: 'Marka',
  model: 'Model',
  last_service_date: 'Son servisə gəliş',
  last_talk: 'Son danışıq',
};

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Uploads an .xlsx customer list into a service / credit-offer campaign. The first call is a
// dry run that shows which columns were recognised; the second one adds the customers.
export default function ExcelImportPanel({ campaignId, onImported }: { campaignId: number; onImported?: () => void | Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (f: File, dryRun: boolean) => {
    const { data } = await apiClient.post<ImportResult>(`/callbot/campaigns/${campaignId}/import/excel`, { file: await toBase64(f), dryRun });
    return data;
  };

  const pick = async (f: File | null) => {
    setFile(f);
    setPreview(null);
    setDone(null);
    setError(null);
    if (!f) return;
    setBusy(true);
    try {
      setPreview(await send(f, true));
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Xəta');
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await send(file, false));
      await onImported?.();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Xəta');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        Excel (.xlsx) faylı seçin. Birinci sətir başlıq olmalıdır: müştəri adı, telefon, marka, model, son servisə gəliş tarixi, son danışıq.
        Başqa sütunlar da bota əlavə məlumat kimi verilir. Bir daha zəng edilməsini istəməyən və artıq bu kampaniyada olan nömrələr əlavə olunmur.
      </p>
      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => void pick(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-gray-300 file:mr-3 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-white"
      />
      {busy && <p className="text-sm text-gray-400">Yoxlanılır...</p>}
      {error && <p className="rounded bg-rose-500/15 px-3 py-2 text-sm text-rose-300">{error}</p>}

      {preview && !done && (
        <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/40 p-4 text-sm">
          <div className="flex flex-wrap gap-2">
            {preview.columns.filter((c) => c.header).map((c) => (
              <span key={c.header} className={`rounded px-2 py-1 text-xs ${c.field ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-gray-300'}`}>
                {c.header} → {c.field ? FIELD_LABELS[c.field] : 'əlavə məlumat'}
              </span>
            ))}
          </div>
          <p className="text-gray-300">
            Cəmi {preview.total} sətir: <b className="text-emerald-300">{preview.valid} əlavə olunacaq</b>
            {preview.invalidPhones ? `, ${preview.invalidPhones} səhv nömrə` : ''}
            {preview.duplicates ? `, ${preview.duplicates} təkrar` : ''}
            {preview.alreadyInCampaign ? `, ${preview.alreadyInCampaign} artıq kampaniyadadır` : ''}
            {preview.doNotCall ? `, ${preview.doNotCall} zəng istəmir` : ''}
          </p>
          {preview.sample.length > 0 && (
            <table className="w-full text-xs text-gray-300">
              <tbody>
                {preview.sample.map((r, i) => (
                  <tr key={i} className="border-t border-slate-700">
                    <td className="py-1 pr-2">{r.name}</td>
                    <td className="py-1 pr-2 tabular-nums">{r.phone}</td>
                    <td className="py-1 pr-2">{[r.brand, r.model].filter(Boolean).join(' ')}</td>
                    <td className="py-1 pr-2">{r.last_service_date}</td>
                    <td className="py-1">{r.last_talk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            type="button"
            disabled={busy || preview.valid === 0}
            onClick={() => void run()}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {preview.valid} müştərini kampaniyaya əlavə et
          </button>
        </div>
      )}
      {done && <p className="rounded bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{done.added} müştəri kampaniyaya əlavə olundu.</p>}
    </div>
  );
}
