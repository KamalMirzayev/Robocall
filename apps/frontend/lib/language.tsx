'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import en from '@/lib/i18n/en.json';
import az from '@/lib/i18n/az.json';

export type Locale = 'en' | 'az';

const dictionaries: Record<Locale, Record<string, unknown>> = { en, az };

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function lookup(dict: Record<string, unknown>, key: string): string | undefined {
  let value: unknown = dict;
  for (const part of key.split('.')) {
    if (typeof value !== 'object' || value === null || !(part in value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : undefined;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('az');

  // Restore saved language preference on mount
  useEffect(() => {
    const stored = localStorage.getItem('locale');
    if (stored === 'en' || stored === 'az') {
      setLocaleState(stored);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    localStorage.setItem('locale', next);
  };

  const t = (key: string): string => {
    return lookup(dictionaries[locale], key) ?? lookup(dictionaries.en, key) ?? key;
  };

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
