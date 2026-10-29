'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { telephonyApi, type AsteriskLogsResponse } from '@/lib/telephony-api-client';
import { useLanguage } from '@/lib/language';

type LevelFilter = 'ALL' | 'ERROR' | 'WARNING' | 'NOTICE' | 'VERBOSE' | 'DEBUG';
type LogFile = 'messages.log' | 'queue_log';
type SortColumn = 'time' | 'level' | 'source' | 'message';
type SortDirection = 'asc' | 'desc';

function levelBadgeClass(level: string): string {
  if (level === 'ERROR') return 'bg-red-500/20 text-red-300 border-red-500/30';
  if (level === 'WARNING') return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  if (level === 'NOTICE') return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
  if (level === 'DEBUG' || level === 'VERBOSE') return 'bg-violet-500/20 text-violet-300 border-violet-500/30';
  return 'bg-slate-600/30 text-slate-300 border-slate-500/40';
}

export default function AsteriskLogsPage() {
  const { t } = useLanguage();
  const [file, setFile] = useState<LogFile>('messages.log');
  const [level, setLevel] = useState<LevelFilter>('ALL');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [sinceMinutes, setSinceMinutes] = useState<number>(120);
  const [limit, setLimit] = useState<number>(200);
  const [maxBytes, setMaxBytes] = useState<number>(2 * 1024 * 1024);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [sortColumn, setSortColumn] = useState<SortColumn>('time');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const [data, setData] = useState<AsteriskLogsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>('');

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await telephonyApi.getAsteriskLogs({
        file,
        level,
        q: query,
        source,
        sinceMinutes,
        limit,
        maxBytes,
      });
      setData(response);
      setLastUpdatedAt(new Date().toLocaleString());
    } catch (err) {
      console.error(err);
      setError(t('asteriskLogs.loadError'));
    } finally {
      setLoading(false);
    }
  }, [file, level, query, source, sinceMinutes, limit, maxBytes]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchLogs().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchLogs]);

  const rows = useMemo(() => {
    const items = [...(data?.items || [])];
    const direction = sortDirection === 'asc' ? 1 : -1;

    const compareText = (a: string, b: string) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' });

    items.sort((a, b) => {
      if (sortColumn === 'time') {
        const left = a.timestamp ? Date.parse(a.timestamp) : 0;
        const right = b.timestamp ? Date.parse(b.timestamp) : 0;
        return (left - right) * direction;
      }
      if (sortColumn === 'level') {
        return compareText(a.level || '', b.level || '') * direction;
      }
      if (sortColumn === 'source') {
        return compareText(a.source || '', b.source || '') * direction;
      }
      return compareText(a.message || a.raw || '', b.message || b.raw || '') * direction;
    });

    return items;
  }, [data, sortColumn, sortDirection]);

  const toggleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortColumn(column);
    setSortDirection(column === 'time' ? 'desc' : 'asc');
  };

  const sortLabel = (column: SortColumn): string => {
    if (sortColumn !== column) return t('asteriskLogs.sort');
    return sortDirection === 'asc' ? t('asteriskLogs.sortAsc') : t('asteriskLogs.sortDesc');
  };

  const sortIcon = (column: SortColumn): string => {
    if (sortColumn !== column) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">{t('asteriskLogs.heading')}</h1>
          <p className="text-sm text-gray-400 mt-1">{t('asteriskLogs.subheading')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchLogs()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium"
          >
            {t('asteriskLogs.refreshNow')}
          </button>
          <label className="flex items-center gap-2 px-3 py-2 rounded border border-slate-700 bg-slate-800 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-blue-500"
            />
            {t('asteriskLogs.autoRefresh')}
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 bg-slate-800 border border-slate-700 rounded-lg p-4">
        <label className="text-sm text-gray-300">
          {t('asteriskLogs.logFile')}
          <select
            value={file}
            onChange={(e) => setFile(e.target.value as LogFile)}
            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
          >
            <option value="messages.log">messages.log</option>
            <option value="queue_log">queue_log</option>
          </select>
        </label>

        <label className="text-sm text-gray-300">
          {t('asteriskLogs.level')}
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as LevelFilter)}
            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
          >
            <option value="ALL">ALL</option>
            <option value="ERROR">ERROR</option>
            <option value="WARNING">WARNING</option>
            <option value="NOTICE">NOTICE</option>
            <option value="VERBOSE">VERBOSE</option>
            <option value="DEBUG">DEBUG</option>
          </select>
        </label>

        <label className="text-sm text-gray-300">
          {t('asteriskLogs.containsText')}
          <input
            type="text"
            placeholder={t('asteriskLogs.containsTextPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
          />
        </label>

        <label className="text-sm text-gray-300">
          {t('asteriskLogs.sourceModule')}
          <input
            type="text"
            placeholder={t('asteriskLogs.sourceModulePlaceholder')}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
          />
        </label>

        <label className="text-sm text-gray-300">
          {t('asteriskLogs.sinceMinutes')}
          <input
            type="number"
            min={0}
            max={10080}
            value={sinceMinutes}
            onChange={(e) => setSinceMinutes(Number(e.target.value || 0))}
            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
          />
        </label>

        <label className="text-sm text-gray-300">
          {t('asteriskLogs.rows')}
          <input
            type="number"
            min={1}
            max={1000}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value || 200))}
            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
          />
        </label>

        <label className="text-sm text-gray-300">
          {t('asteriskLogs.readWindowBytes')}
          <input
            type="number"
            min={65536}
            max={8388608}
            step={65536}
            value={maxBytes}
            onChange={(e) => setMaxBytes(Number(e.target.value || 2 * 1024 * 1024))}
            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
          />
        </label>

        <div className="text-sm text-gray-400 flex items-end">
          {lastUpdatedAt ? `${t('asteriskLogs.lastUpdate')} ${lastUpdatedAt}` : t('asteriskLogs.waitingFirstResponse')}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 text-sm text-gray-300 flex flex-wrap gap-4">
          <span>{t('asteriskLogs.displayed')} {rows.length}</span>
          <span>{t('asteriskLogs.scanned')} {data?.scannedLineCount ?? 0}</span>
          <span>{t('asteriskLogs.file')} {data?.file ?? file}</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400">{t('asteriskLogs.loadingLogs')}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-gray-400">{t('asteriskLogs.noLogsMatched')}</div>
        ) : (
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="text-left text-gray-300 border-b border-slate-700">
                  <th className="px-4 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort('time')}
                      className="inline-flex items-center gap-2 hover:text-white"
                      title={sortLabel('time')}
                    >
                      <span>{t('asteriskLogs.time')}</span>
                      <span className="text-xs text-gray-400">{sortIcon('time')}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort('level')}
                      className="inline-flex items-center gap-2 hover:text-white"
                      title={sortLabel('level')}
                    >
                      <span>{t('asteriskLogs.level')}</span>
                      <span className="text-xs text-gray-400">{sortIcon('level')}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort('source')}
                      className="inline-flex items-center gap-2 hover:text-white"
                      title={sortLabel('source')}
                    >
                      <span>{t('asteriskLogs.source')}</span>
                      <span className="text-xs text-gray-400">{sortIcon('source')}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort('message')}
                      className="inline-flex items-center gap-2 hover:text-white"
                      title={sortLabel('message')}
                    >
                      <span>{t('asteriskLogs.message')}</span>
                      <span className="text-xs text-gray-400">{sortIcon('message')}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item, index) => (
                  <tr key={`${item.timestamp || 'na'}-${index}`} className="border-b border-slate-700/70 align-top">
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                      {item.timestamp ? new Date(item.timestamp).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded border text-xs font-medium ${levelBadgeClass(item.level)}`}>
                        {item.level || t('asteriskLogs.na')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{item.source || '-'}</td>
                    <td className="px-4 py-3 text-gray-200 break-all">{item.message || item.raw}</td>
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
