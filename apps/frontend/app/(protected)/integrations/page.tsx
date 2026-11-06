'use client';

import { useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { Check, Eye, EyeOff } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useLanguage } from '@/lib/language';

type Group = 'ai' | 'knowledge' | 'whatsapp' | 'webhook' | 'pks';

interface SettingRow {
  key: string;
  group: Group;
  secret: boolean;
  set: boolean;
  source: 'panel' | 'env' | null;
  value: string | null;
  hint: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface KbStatus {
  configured: boolean;
  chunks: number;
  loadedAt: string | null;
  error: string | null;
}

const GROUPS: Group[] = ['ai', 'knowledge', 'whatsapp', 'webhook', 'pks'];

function errorText(err: unknown, fallback: string) {
  return (err as AxiosError<{ error?: string }>)?.response?.data?.error || fallback;
}

function SettingField({ row, onSaved }: { row: SettingRow; onSaved: (data: { settings: SettingRow[]; knowledgeBase: KbStatus }) => void }) {
  const { t } = useLanguage();
  const [value, setValue] = useState(row.secret ? '' : row.value ?? '');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (next: string) => {
    try {
      setBusy(true);
      setError(null);
      setSaved(false);
      const { data } = await apiClient.put(`/callbot/settings/${row.key}`, { value: next });
      onSaved(data);
      if (row.secret) setValue('');
      setSaved(true);
    } catch (err) {
      setError(errorText(err, t('integrations.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const dirty = row.secret ? value.trim() !== '' : value.trim() !== (row.value ?? '');

  return (
    <div className="py-4 border-t border-slate-700 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <label className="text-sm text-gray-300">{t(`integrations.keys.${row.key}`)}</label>
        <span
          className={`inline-flex px-2 py-0.5 rounded text-[11px] ${
            row.set ? 'bg-green-500/20 text-green-300' : 'bg-slate-600/40 text-gray-400'
          }`}
        >
          {row.set ? (row.source === 'env' ? t('integrations.fromEnv') : t('integrations.set')) : t('integrations.notSet')}
          {row.hint ? ` · ${row.hint}` : ''}
        </span>
      </div>
      <form
        className="flex flex-col sm:flex-row gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) save(value.trim());
        }}
      >
        <div className="relative flex-1">
          <input
            type={row.secret && !show ? 'password' : 'text'}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            placeholder={row.secret ? (row.set ? t('integrations.replacePlaceholder') : t('integrations.pastePlaceholder')) : 'https://'}
            autoComplete="off"
            spellCheck={false}
            className="w-full px-3 py-2 pr-10 bg-slate-700 border border-slate-600 rounded-lg text-white font-mono text-sm"
          />
          {row.secret && (
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white"
              aria-label={t('integrations.toggleVisibility')}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={!dirty || busy}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-[#fff] text-sm disabled:opacity-50"
        >
          {busy ? t('integrations.saving') : t('integrations.save')}
        </button>
        {row.source === 'panel' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => save('')}
            className="px-4 py-2 rounded-lg border border-slate-600 text-gray-300 hover:bg-slate-700 text-sm"
          >
            {t('integrations.clear')}
          </button>
        )}
      </form>
      <div className="mt-1.5 text-xs text-gray-500 flex items-center gap-2 flex-wrap">
        {saved && (
          <span className="inline-flex items-center gap-1 text-green-300">
            <Check size={12} /> {t('integrations.saved')}
          </span>
        )}
        {error && <span className="text-red-300">{error}</span>}
        {row.updatedAt && (
          <span>
            {t('integrations.updated')} {new Date(row.updatedAt).toLocaleString()}
            {row.updatedBy ? ` · ${row.updatedBy}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [kb, setKb] = useState<KbStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [geminiTest, setGeminiTest] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState<'gemini' | 'kb' | null>(null);

  const apply = (data: { settings: SettingRow[]; knowledgeBase: KbStatus }) => {
    setRows(data.settings);
    setKb(data.knowledgeBase);
  };

  useEffect(() => {
    apiClient
      .get('/callbot/settings')
      .then(({ data }) => apply(data))
      .catch((err) => setError(errorText(err, t('integrations.loadFailed'))))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const testGemini = async () => {
    setTesting('gemini');
    try {
      const { data } = await apiClient.post('/callbot/settings/test/gemini');
      setGeminiTest(data);
    } catch (err) {
      setGeminiTest({ ok: false, error: errorText(err, 'error') });
    } finally {
      setTesting(null);
    }
  };

  const testKb = async () => {
    setTesting('kb');
    try {
      const { data } = await apiClient.post('/callbot/settings/test/knowledge-base');
      setKb(data);
    } finally {
      setTesting(null);
    }
  };

  if (user && user.role !== 'admin') {
    return <div className="p-8 text-center text-gray-400">{t('integrations.adminOnly')}</div>;
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">{t('integrations.heading')}</h1>
        <p className="text-gray-400 mt-1">{t('integrations.subtitle')}</p>
      </div>

      {error && <div className="p-3 rounded-lg border border-red-500 bg-red-500/10 text-red-300 text-sm">{error}</div>}
      {loading && <div className="p-8 text-center text-gray-400">{t('integrations.loading')}</div>}

      {!loading &&
        GROUPS.map((group) => {
          const groupRows = rows.filter((r) => r.group === group);
          if (!groupRows.length) return null;
          return (
            <section key={group} className="bg-slate-800 border border-slate-700 rounded-lg p-5">
              <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
                <div>
                  <h2 className="text-lg font-semibold text-white">{t(`integrations.groups.${group}.title`)}</h2>
                  <p className="text-sm text-gray-400 mt-1">{t(`integrations.groups.${group}.text`)}</p>
                </div>
                {group === 'ai' && (
                  <div className="flex items-center gap-2">
                    {geminiTest && (
                      <span className={`text-xs ${geminiTest.ok ? 'text-green-300' : 'text-red-300'}`}>
                        {geminiTest.ok ? t('integrations.testOk') : `${t('integrations.testFailed')} ${geminiTest.error ?? ''}`}
                      </span>
                    )}
                    <button
                      onClick={testGemini}
                      disabled={testing === 'gemini'}
                      className="px-3 py-1.5 rounded-lg border border-slate-600 text-gray-300 hover:bg-slate-700 text-xs"
                    >
                      {testing === 'gemini' ? t('integrations.testing') : t('integrations.test')}
                    </button>
                  </div>
                )}
                {group === 'knowledge' && kb && (
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${kb.error ? 'text-red-300' : kb.chunks ? 'text-green-300' : 'text-gray-400'}`}>
                      {!kb.configured
                        ? t('integrations.kbOff')
                        : kb.error
                          ? `${t('integrations.testFailed')} ${kb.error}`
                          : `${kb.chunks} ${t('integrations.kbChunks')}`}
                    </span>
                    <button
                      onClick={testKb}
                      disabled={testing === 'kb' || !kb.configured}
                      className="px-3 py-1.5 rounded-lg border border-slate-600 text-gray-300 hover:bg-slate-700 text-xs disabled:opacity-50"
                    >
                      {testing === 'kb' ? t('integrations.testing') : t('integrations.reload')}
                    </button>
                  </div>
                )}
              </div>
              {groupRows.map((row) => (
                <SettingField key={row.key} row={row} onSaved={apply} />
              ))}
            </section>
          );
        })}
    </div>
  );
}
