'use client';

import { useState } from 'react';
import { useRecordings } from '@/hooks/useCallbot';
import { formatDate } from '@/lib/date-format';
import { useLanguage } from '@/lib/language';

export default function RecordingsPage() {
  const { t } = useLanguage();
  const { recordings, loading, error } = useRecordings();
  const [activeRecordingId, setActiveRecordingId] = useState<string | number | null>(null);

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-white mb-4">{t('recordings.heading')}</h1>
        <div className="bg-slate-800 rounded-lg p-8 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-400">{t('recordings.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-white mb-4">{t('recordings.heading')}</h1>
        <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-400">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-white mb-4">{t('recordings.callRecordings')}</h1>

      <div className="bg-slate-800 rounded-lg overflow-hidden">
        {recordings.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            {t('recordings.noRecordings')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-700 border-b border-slate-600">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('recordings.table.recordingId')}</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('recordings.table.callId')}</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('recordings.table.customer')}</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('recordings.table.mobileNumber')}</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('recordings.table.agent')}</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('recordings.table.duration')}</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('recordings.table.created')}</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('recordings.table.action')}</th>
                </tr>
              </thead>
              <tbody>
                {recordings.map((recording) => (
                  <tr key={recording.id} className="border-b border-slate-700 hover:bg-slate-700/50 transition">
                    <td className="px-6 py-4 text-gray-400">{recording.id}</td>
                    <td className="px-6 py-4 text-gray-400">{recording.call_id || '-'}</td>
                    <td className="px-6 py-4 text-gray-300">{recording.customer_name || '-'}</td>
                    <td className="px-6 py-4 text-gray-300">{recording.customer_number || '-'}</td>
                    <td className="px-6 py-4 text-gray-300">{recording.agent_name || '-'}</td>
                    <td className="px-6 py-4 text-gray-400">{recording.duration ? `${Math.floor(recording.duration / 60)}m` : '-'}</td>
                    <td className="px-6 py-4 text-gray-400">{recording.created_at ? formatDate(recording.created_at) : '-'}</td>
                    <td className="px-6 py-4">
                      {!recording.url ? (
                        <span className="text-gray-500 text-xs">{t('recordings.noAudio')}</span>
                      ) : activeRecordingId === recording.id ? (
                        <div className="space-y-2">
                          <audio controls autoPlay preload="none" src={recording.url} className="h-8 max-w-[260px]" />
                          <button
                            onClick={() => setActiveRecordingId(null)}
                            className="px-2 py-1 bg-slate-600 hover:bg-slate-500 text-white rounded text-xs font-medium transition"
                          >
                            {t('recordings.close')}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setActiveRecordingId(recording.id)}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition"
                        >
                          {t('recordings.play')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
