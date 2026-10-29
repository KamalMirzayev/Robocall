'use client';

import { useLanguage } from '@/lib/language';

export function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();

  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-600 text-xs font-medium">
      <button
        type="button"
        onClick={() => setLocale('en')}
        aria-pressed={locale === 'en'}
        className={`px-2.5 py-1 transition ${
          locale === 'en' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
        }`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLocale('az')}
        aria-pressed={locale === 'az'}
        className={`px-2.5 py-1 transition ${
          locale === 'az' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
        }`}
      >
        AZ
      </button>
    </div>
  );
}
