'use client';

import { useLanguage } from '@/lib/language';

export default function AIBotIntentsPage() {
  const { t } = useLanguage();

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-3xl font-bold text-white">{t('aiBotIntents.heading')}</h1>
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <p className="text-gray-300">
          {t('aiBotIntents.description')}
        </p>
        <p className="text-sm text-gray-400 mt-2">
          {t('aiBotIntents.note')}
        </p>
      </div>
    </div>
  );
}
