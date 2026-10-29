'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useLanguage } from '@/lib/language';

type ToolName = 'request_callback' | 'send_whatsapp_msg' | 'search_knowledge_base' | 'update_status';

type SamplesResponse = Record<ToolName, Record<string, unknown>>;

const toolMeta: Array<{ name: ToolName; titleKey: string; descriptionKey: string }> = [
  {
    name: 'request_callback',
    titleKey: 'aiBotTools.tools.requestCallback.title',
    descriptionKey: 'aiBotTools.tools.requestCallback.description',
  },
  {
    name: 'send_whatsapp_msg',
    titleKey: 'aiBotTools.tools.sendWhatsapp.title',
    descriptionKey: 'aiBotTools.tools.sendWhatsapp.description',
  },
  {
    name: 'search_knowledge_base',
    titleKey: 'aiBotTools.tools.searchKnowledgeBase.title',
    descriptionKey: 'aiBotTools.tools.searchKnowledgeBase.description',
  },
  {
    name: 'update_status',
    titleKey: 'aiBotTools.tools.updateStatus.title',
    descriptionKey: 'aiBotTools.tools.updateStatus.description',
  },
];

export default function AIBotToolsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isAdmin = user?.role === 'admin';

  const [selectedTool, setSelectedTool] = useState<ToolName>('update_status');
  const [dryRun, setDryRun] = useState(true);
  const [argsText, setArgsText] = useState('{}');
  const [samples, setSamples] = useState<Partial<SamplesResponse>>({});
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [running, setRunning] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const currentSample = useMemo(() => {
    const sample = samples[selectedTool] || {};
    return JSON.stringify(sample, null, 2);
  }, [samples, selectedTool]);

  useEffect(() => {
    let cancelled = false;
    const loadSamples = async () => {
      try {
        setLoadingSamples(true);
        const res = await fetch('/api/callbot/ai-tools/test/samples', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SamplesResponse;
        if (!cancelled) {
          setSamples(data);
          setArgsText(JSON.stringify(data[selectedTool] || {}, null, 2));
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(t('aiBotTools.errorLoadSamples'));
        }
      } finally {
        if (!cancelled) setLoadingSamples(false);
      }
    };
    loadSamples();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!samples[selectedTool]) return;
    setArgsText(JSON.stringify(samples[selectedTool] || {}, null, 2));
  }, [selectedTool, samples]);

  const handleRunTest = async () => {
    try {
      setRunning(true);
      setError(null);
      setResponseText('');

      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(argsText || '{}');
      } catch {
        throw new Error(t('aiBotTools.errorInvalidArgs'));
      }

      const res = await fetch('/api/callbot/ai-tools/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          toolName: selectedTool,
          dryRun,
          args: parsedArgs,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(payload?.error || `HTTP ${res.status}`));
      }

      setResponseText(JSON.stringify(payload, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiBotTools.errorRunTest'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">{t('aiBotTools.heading')}</h1>
        <p className="text-gray-400 mt-2">
          {t('aiBotTools.subtitle')}
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-500 bg-red-500/10 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-slate-800 border border-slate-700 rounded-lg p-5">
          <h2 className="text-lg font-semibold text-white mb-4">{t('aiBotTools.registryTitle')}</h2>
          <div className="space-y-3">
            {toolMeta.map((tool) => (
              <div key={tool.name} className="border border-slate-700 rounded-lg p-4 bg-slate-900/30">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-white font-medium">{t(tool.titleKey)}</p>
                    <p className="text-xs text-gray-400 mt-1">{tool.name}</p>
                  </div>
                  <button
                    onClick={() => setSelectedTool(tool.name)}
                    className={`px-3 py-1.5 rounded text-sm ${selectedTool === tool.name ? 'bg-blue-600 text-white' : 'bg-slate-700 text-gray-200 hover:bg-slate-600'}`}
                  >
                    {t('aiBotTools.selectButton')}
                  </button>
                </div>
                <p className="text-sm text-gray-300 mt-2">{t(tool.descriptionKey)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 h-fit">
          <h2 className="text-base font-semibold text-white">{t('aiBotTools.adminTestTitle')}</h2>
          <p className="text-xs text-gray-400 mt-1">{t('aiBotTools.adminTestHint')}</p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('aiBotTools.selectedToolLabel')}</label>
              <select
                value={selectedTool}
                onChange={(e) => setSelectedTool(e.target.value as ToolName)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
              >
                {toolMeta.map((tool) => (
                  <option key={tool.name} value={tool.name}>{tool.name}</option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              {t('aiBotTools.dryRunLabel')}
            </label>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs text-gray-400 mb-1">{t('aiBotTools.argsJsonLabel')}</label>
                <button
                  type="button"
                  onClick={() => setArgsText(currentSample)}
                  className="text-xs text-blue-300 hover:text-blue-200"
                  disabled={loadingSamples}
                >
                  {loadingSamples ? t('aiBotTools.loading') : t('aiBotTools.useSample')}
                </button>
              </div>
              <textarea
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                className="w-full min-h-44 px-3 py-2 bg-slate-900 border border-slate-600 rounded text-gray-100 text-xs font-mono"
              />
            </div>

            <button
              onClick={handleRunTest}
              disabled={running || !isAdmin}
              className="w-full px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
            >
              {running ? t('aiBotTools.running') : t('aiBotTools.runTest')}
            </button>

            {!isAdmin && (
              <p className="text-xs text-amber-300">{t('aiBotTools.adminRequired')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-2">{t('aiBotTools.responseTitle')}</h3>
        <pre className="text-xs text-gray-200 bg-slate-900 rounded p-3 overflow-auto max-h-96 whitespace-pre-wrap break-words">
          {responseText || t('aiBotTools.noResponseYet')}
        </pre>
      </div>
    </div>
  );
}
