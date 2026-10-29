'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDate } from '@/lib/date-format';
import InitiateCallForm from '@/components/InitiateCallForm';
import { useCallsPage, useAllCallsLazy } from '@/hooks/useCallbot';
import { useLanguage } from '@/lib/language';

type Tab = 'live' | 'history' | 'initiate' | 'intentions';

type LiveCall = {
  channelId: string;
  bridgeId?: string | null;
  externalChannelId?: string | null;
  jobId?: number | null;
  phone?: string;
  agentId?: number | null;
  customerId?: number | null;
  calledNumber?: string;
  startedAt: string;
  durationSeconds: number;
  rtpConnected: boolean;
  monitorCount?: number;
};

type LiveMonitorMessage =
  | { type: 'connected' }
  | { type: 'audio'; role?: 'agent' | 'customer' | 'mixed'; rate?: number; data: string }
  | { type: 'call_ended' }
  | { type: 'error'; error?: string };

function pcm16Base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const output = new Float32Array(Math.floor(binary.length / 2));
  for (let i = 0; i < output.length; i += 1) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    const value = (hi << 8) | lo;
    const signed = value >= 0x8000 ? value - 0x10000 : value;
    output[i] = Math.max(-1, Math.min(1, signed / 32768));
  }
  return output;
}

function resolveLiveMonitorWsBase(): string {
  // Construct WebSocket URL that goes through Nginx proxy
  // Browser: https://avr.fintechlab.cloud → wss://avr.fintechlab.cloud/ws/live-monitor/
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/ws/live-monitor`;
}

function durationLabel(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function CallsPage() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>('live');
  const [liveCalls, setLiveCalls] = useState<LiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listeningChannelId, setListeningChannelId] = useState<string>('');
  const [monitorStatus, setMonitorStatus] = useState<string>('');
  const {
    calls: historyCalls,
    total: historyTotal,
    page: historyPage,
    pageCount: historyPageCount,
    setPage: setHistoryPage,
    loading: historyLoading,
    error: historyError,
    refetch: refetchHistory,
  } = useCallsPage(50, activeTab === 'history');
  const {
    calls: allCallsForIntentions,
    loading: intentionsLoading,
    error: intentionsError,
    refetch: refetchIntentions,
  } = useAllCallsLazy(activeTab === 'intentions');

  // Group intentions by FIN (same person can have multiple customer records/contracts)
  type IntentionRow = {
    customerId: string | number;
    customerName: string;
    fin: string | null;
    contractNo: string | null;
    mobilePhone: string | null;
    date: string;
  };
  type IntentionGroup = {
    fin: string | null;
    rows: Map<string, IntentionRow>; // summary -> latest row for that summary
  };

  const intentionsByFin = allCallsForIntentions.reduce((acc, call) => {
    const customerId = call.customerId ?? call.customer_id;
    const customerName = [call.customerName, call.customerSurname].filter(Boolean).join(' ');
    const summary = call.summary || call.description;
    const startedAt = call.startedAt || call.started_at;
    const fin = call.customerFin || null;
    const contractNo = call.customerContractNo || null;
    const mobilePhone = call.customerMobilePhone || null;

    if (!customerId || !summary) return acc;

    const groupKey = fin || `customer-${customerId}`;
    if (!acc[groupKey]) {
      acc[groupKey] = { fin, rows: new Map() };
    }

    // Dedupe identical summary text within the group, keeping the most recent occurrence
    const existing = acc[groupKey].rows.get(summary);
    if (!existing || new Date(startedAt).getTime() > new Date(existing.date).getTime()) {
      acc[groupKey].rows.set(summary, { customerId, customerName, fin, contractNo, mobilePhone, date: startedAt });
    }
    return acc;
  }, {} as Record<string, IntentionGroup>);

  const intentionGroups = Object.values(intentionsByFin)
    .map((group) => ({
      fin: group.fin,
      rows: Array.from(group.rows.entries())
        .map(([summary, row]) => ({ summary, ...row }))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    }))
    .sort((a, b) => {
      const aLatest = a.rows[0] ? new Date(a.rows[0].date).getTime() : 0;
      const bLatest = b.rows[0] ? new Date(b.rows[0].date).getTime() : 0;
      return bLatest - aLatest;
    });

  const monitorSocketRef = useRef<WebSocket | null>(null);
  const monitorAudioContextRef = useRef<AudioContext | null>(null);
  const monitorNextPlayTimeRef = useRef<Record<string, number>>({});

  const fetchLiveCalls = async () => {
    if (activeTab !== 'live') return;
    if (!liveCalls.length) setLoading(true);
    try {
      const response = await fetch('/api/telephony-panel/live-calls', { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setLiveCalls(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('calls.errors.fetchLiveCalls'));
    } finally {
      setLoading(false);
    }
  };

  const stopLiveMonitor = (status?: string) => {
    if (monitorSocketRef.current) {
      monitorSocketRef.current.close();
      monitorSocketRef.current = null;
    }
    if (monitorAudioContextRef.current && monitorAudioContextRef.current.state !== 'closed') {
      monitorAudioContextRef.current.close().catch(() => {});
    }
    monitorAudioContextRef.current = null;
    monitorNextPlayTimeRef.current = {};
    setListeningChannelId('');
    if (status) setMonitorStatus(status);
  };

  const playLiveAudio = (message: Extract<LiveMonitorMessage, { type: 'audio' }>) => {
    const context = monitorAudioContextRef.current;
    if (!context || context.state === 'closed') return;
    const samples = pcm16Base64ToFloat32(message.data);
    if (!samples.length) return;

    const rate = Number(message.rate || 16000);
    const buffer = context.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(new Float32Array(samples), 0);

    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = message.role === 'agent' ? 0.9 : 1;
    source.buffer = buffer;
    source.connect(gain).connect(context.destination);

    const role = message.role || 'mixed';
    const now = context.currentTime;
    const startAt = Math.max(now + 0.03, monitorNextPlayTimeRef.current[role] || 0);
    source.start(startAt);
    monitorNextPlayTimeRef.current[role] = startAt + samples.length / rate;
  };

  const startLiveMonitor = async (call: LiveCall) => {
    stopLiveMonitor('');
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) {
      setMonitorStatus(t('calls.monitor.webAudioUnsupported'));
      return;
    }

    try {
      const audioContext = new AudioCtor({ sampleRate: 16000 });
      await audioContext.resume();
      monitorAudioContextRef.current = audioContext;

      const wsBase = resolveLiveMonitorWsBase();
      const ws = new WebSocket(`${wsBase}?channelId=${encodeURIComponent(call.channelId)}`);
      monitorSocketRef.current = ws;
      setListeningChannelId(call.channelId);
      setMonitorStatus(t('calls.monitor.connecting'));
      let connected = false;

      ws.addEventListener('message', (event) => {
        let message: LiveMonitorMessage | null = null;
        try {
          message = JSON.parse(event.data) as LiveMonitorMessage;
        } catch {
          return;
        }

        if (!message) return;
        if (message.type === 'connected') {
          connected = true;
          setMonitorStatus(t('calls.monitor.connected'));
          return;
        }
        if (message.type === 'audio') {
          playLiveAudio(message);
          return;
        }
        if (message.type === 'call_ended') {
          stopLiveMonitor(t('calls.monitor.callEnded'));
          return;
        }
        if (message.type === 'error') {
          stopLiveMonitor(message.error || t('calls.monitor.failedToJoin'));
        }
      });

      ws.addEventListener('close', () => {
        if (monitorSocketRef.current === ws) {
          stopLiveMonitor(t('calls.monitor.stopped'));
        }
      });

      ws.addEventListener('error', () => {
        if (monitorSocketRef.current === ws) {
          stopLiveMonitor(t('calls.monitor.failedToConnect'));
        }
      });
    } catch (err) {
      stopLiveMonitor(t('calls.monitor.failedToStart'));
      setError(err instanceof Error ? err.message : t('calls.monitor.failed'));
    }
  };

  useEffect(() => {
    if (activeTab !== 'live') return undefined;
    fetchLiveCalls();
    const timer = setInterval(() => {
      fetchLiveCalls();
    }, 3000);
    return () => clearInterval(timer);
  }, [activeTab]);

  useEffect(() => {
    return () => {
      stopLiveMonitor('');
    };
  }, []);

  if (loading && activeTab === 'live') {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-white mb-6">{t('calls.heading')}</h1>
        <div className="bg-slate-800 rounded-lg p-8 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-400">{t('calls.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && activeTab === 'live') {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-white mb-6">{t('calls.heading')}</h1>
        <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-400">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-white mb-6">{t('calls.heading')}</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-slate-700">
        <button
          onClick={() => setActiveTab('live')}
          className={`px-6 py-3 font-medium transition border-b-2 ${
            activeTab === 'live'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          {t('calls.tabs.live')}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-6 py-3 font-medium transition border-b-2 ${
            activeTab === 'history'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          {t('calls.tabs.history')}
        </button>
        <button
          onClick={() => setActiveTab('initiate')}
          className={`px-6 py-3 font-medium transition border-b-2 ${
            activeTab === 'initiate'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          {t('calls.tabs.initiate')}
        </button>
        <button
          onClick={() => setActiveTab('intentions')}
          className={`px-6 py-3 font-medium transition border-b-2 ${
            activeTab === 'intentions'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          {t('calls.tabs.intentions')}
        </button>
      </div>

      {/* Live Calls Tab */}
      {activeTab === 'live' && (
        <div className="bg-slate-800 rounded-lg overflow-hidden">
          {liveCalls.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              {t('calls.noActiveCalls')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-700 border-b border-slate-600">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.table.channel')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.table.agent')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.table.customer')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.table.phone')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.table.duration')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.table.started')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {liveCalls.map((call) => {
                    const isListening = listeningChannelId === call.channelId;
                    return (
                    <tr key={call.channelId} className="border-b border-slate-700 hover:bg-slate-700/50 transition">
                      <td className="px-6 py-4 text-gray-400">{call.channelId}</td>
                      <td className="px-6 py-4 text-gray-400">{call.agentId ?? '-'}</td>
                      <td className="px-6 py-4 text-gray-400">{call.customerId ?? '-'}</td>
                      <td className="px-6 py-4 text-gray-400">{call.phone || call.calledNumber || '-'}</td>
                      <td className="px-6 py-4 text-gray-400">{durationLabel(call.durationSeconds)}</td>
                      <td className="px-6 py-4 text-gray-400">{formatDate(call.startedAt)}</td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() => {
                            if (isListening) {
                              stopLiveMonitor(t('calls.monitor.stopped'));
                            } else {
                              startLiveMonitor(call);
                            }
                          }}
                          className={`px-3 py-1 rounded text-xs font-medium ${
                            isListening
                              ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                              : 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                          }`}
                        >
                          {isListening ? t('calls.stopListening') : t('calls.joinListen')}
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {monitorStatus && (
            <div className="px-6 py-3 border-t border-slate-700 text-sm text-gray-300">
              {monitorStatus}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-slate-800 rounded-lg overflow-hidden">
          <div className="flex justify-end px-6 pt-4">
            <button
              onClick={() => refetchHistory()}
              disabled={historyLoading}
              className="px-3 py-1.5 rounded border border-slate-600 text-gray-300 text-sm hover:bg-slate-700 disabled:opacity-40"
            >
              {t('calls.refresh')}
            </button>
          </div>
          {historyLoading ? (
            <div className="p-8 text-center text-gray-400">{t('calls.loadingHistory')}</div>
          ) : historyError ? (
            <div className="m-4 bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-400">
              {historyError}
            </div>
          ) : historyCalls.length === 0 ? (
            <div className="p-8 text-center text-gray-400">{t('calls.noHistory')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-700 border-b border-slate-600">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.historyTable.id')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.historyTable.agent')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.historyTable.customer')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.historyTable.started')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.historyTable.ended')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.historyTable.duration')}</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-300">{t('calls.historyTable.summary')}</th>
                  </tr>
                </thead>
                <tbody>
                  {historyCalls.map((call) => (
                    <tr key={String(call.id)} className="border-b border-slate-700 hover:bg-slate-700/50 transition align-top">
                      <td className="px-6 py-4 text-gray-400">{call.id}</td>
                      <td className="px-6 py-4 text-gray-300">{call.agentName || call.agentId || call.agent_id || '-'}</td>
                      <td className="px-6 py-4 text-gray-300">
                        {[call.customerName, call.customerSurname].filter(Boolean).join(' ') || call.customerId || call.customer_id || '-'}
                      </td>
                      <td className="px-6 py-4 text-gray-400">{call.startedAt || call.started_at ? formatDate(call.startedAt || call.started_at) : '-'}</td>
                      <td className="px-6 py-4 text-gray-400">{call.endedAt ?? call.ended_at ? formatDate((call.endedAt ?? call.ended_at) as string) : '-'}</td>
                      <td className="px-6 py-4 text-gray-400">{durationLabel(call.durationSeconds ?? call.duration ?? 0)}</td>
                      <td className="px-6 py-4 text-gray-400 max-w-xl whitespace-normal">{call.summary || call.description || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {historyTotal > 0 && (
                <div className="flex items-center justify-between px-6 py-3 border-t border-slate-700 text-sm text-gray-400">
                  <span>{t('customers.totalLabel')}: {historyTotal}</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setHistoryPage(historyPage - 1)}
                      disabled={historyPage <= 1}
                      className="px-3 py-1.5 rounded border border-slate-600 text-gray-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t('customers.previousPage')}
                    </button>
                    <span>{t('customers.pageLabel')} {historyPage} {t('customers.ofLabel')} {historyPageCount}</span>
                    <button
                      onClick={() => setHistoryPage(historyPage + 1)}
                      disabled={historyPage >= historyPageCount}
                      className="px-3 py-1.5 rounded border border-slate-600 text-gray-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t('customers.nextPage')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Initiate Call Tab */}
      {activeTab === 'initiate' && (
        <div className="bg-slate-800 rounded-lg p-8">
          <InitiateCallForm onSuccess={() => {
            setActiveTab('live');
            fetchLiveCalls();
          }} />
        </div>
      )}

      {/* Intentions Tab */}
      {activeTab === 'intentions' && (
        <div className="bg-slate-800 rounded-lg overflow-hidden">
          <div className="flex justify-end px-6 pt-4">
            <button
              onClick={() => refetchIntentions()}
              disabled={intentionsLoading}
              className="px-3 py-1.5 rounded border border-slate-600 text-gray-300 text-sm hover:bg-slate-700 disabled:opacity-40"
            >
              {t('calls.refresh')}
            </button>
          </div>
          {intentionsLoading ? (
            <div className="p-8 text-center text-gray-400">{t('calls.loadingIntentions')}</div>
          ) : intentionsError ? (
            <div className="m-4 bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-400">
              {intentionsError}
            </div>
          ) : intentionGroups.length === 0 ? (
            <div className="p-8 text-center text-gray-400">{t('calls.noIntentions')}</div>
          ) : (
            <div className="space-y-4 p-6">
              {intentionGroups.map((group) => (
                <div
                  key={group.fin ?? group.rows[0]?.customerId}
                  className="bg-slate-700 rounded-lg border border-slate-600 hover:border-slate-500 transition overflow-hidden"
                >
                  <div className="grid grid-cols-[1.2fr_140px_140px_150px_170px_2fr] gap-3 px-4 py-2 bg-slate-800/60 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    <div>{t('calls.intentionsTable.name')}</div>
                    <div>{t('calls.intentionsTable.fin')}</div>
                    <div>{t('calls.intentionsTable.contractNo')}</div>
                    <div>{t('calls.intentionsTable.mobileNumber')}</div>
                    <div>{t('calls.intentionsTable.date')}</div>
                    <div>{t('calls.intentionsTable.summary')}</div>
                  </div>
                  <div className="divide-y divide-slate-600/60">
                    {group.rows.map((row, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-[1.2fr_140px_140px_150px_170px_2fr] gap-3 px-4 py-3 text-sm text-gray-300"
                      >
                        <div className="text-white font-medium">
                          {row.customerName || `${t('calls.customerPrefix')}${row.customerId}`}
                        </div>
                        <div>{row.fin || '—'}</div>
                        <div>{row.contractNo || '—'}</div>
                        <div>{row.mobilePhone || '—'}</div>
                        <div className="text-gray-400">{formatDate(row.date)}</div>
                        <div>{row.summary}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
