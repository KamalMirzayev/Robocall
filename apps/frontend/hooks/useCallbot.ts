import { useState, useEffect, useRef, useCallback } from 'react';
import callbotApi from '@/lib/callbot-api';
import {
  Call,
  Agent,
  Customer,
  Recording,
  CampaignImportExecuteResponse,
  CampaignImportPreviewResponse,
  CampaignImportJobResponse,
} from '@/types/callbot';

/**
 * Hook to fetch calls with loading and error states
 */
export function useCalls(filters?: { agent_id?: string; status?: string }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCalls = async () => {
    setLoading(true);
    try {
      const data = await callbotApi.getCalls(filters);
      setCalls(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch calls');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalls();
  }, [filters?.agent_id, filters?.status]);

  return { calls, loading, error, refetch: fetchCalls };
}

/**
 * Paginated variant of useCalls, for calls/page.tsx's History tab (~5k rows and growing —
 * useCalls() there was paging through the entire table on every mount/tab-click just to
 * render it unpaginated). `enabled` defers the first fetch until the tab is actually open.
 */
export function useCallsPage(pageSize = 50, enabled = true) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (targetPage: number) => {
    setLoading(true);
    try {
      const result = await callbotApi.getCallsPage({ page: targetPage, pageSize });
      setCalls(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch calls');
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    if (!enabled) return;
    fetchPage(page);
  }, [page, enabled, fetchPage]);

  return {
    calls,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    setPage,
    loading,
    error,
    refetch: () => fetchPage(page),
  };
}

/**
 * Fetches the FULL calls table once, lazily — only when `enabled` first turns true — for
 * calls/page.tsx's Intentions tab, which groups across every call and can't work off a
 * single page. Distinct from useCalls() (which always fetches on mount, tab-aware or not).
 */
export function useAllCallsLazy(enabled: boolean) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      setCalls(await callbotApi.getCalls());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch calls');
    } finally {
      setLoading(false);
      setHasFetched(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled || hasFetched) return;
    fetchAll();
  }, [enabled, hasFetched, fetchAll]);

  return { calls, loading, error, refetch: fetchAll };
}

/**
 * Lightweight calls-count aggregate (total/active/completed) for the statistics page — see
 * getCallsStats(). Use this instead of useCalls() when only the counts are needed.
 */
export function useCallsStats() {
  const [stats, setStats] = useState({ total: 0, active: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    try {
      setStats(await callbotApi.getCallsStats());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch call stats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return { ...stats, loading, error, refetch: fetchStats };
}

/**
 * Hook to fetch agents with loading and error states
 */
export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const data = await callbotApi.getAgents();
      setAgents(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  return { agents, loading, error, refetch: fetchAgents };
}

/**
 * Hook to fetch customers with loading and error states
 */
export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const data = await callbotApi.getCustomers();
      setCustomers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch customers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  return { customers, loading, error, refetch: fetchCustomers };
}

/**
 * Paginated variant of useCustomers, for the customers list page (~33k rows — too many to
 * fetch/render unpaginated, see useCustomers above for callers that need the full list).
 */
export function useCustomersPage(pageSize = 50) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (targetPage: number) => {
    setLoading(true);
    try {
      const result = await callbotApi.getCustomersPage({ page: targetPage, pageSize });
      setCustomers(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch customers');
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    fetchPage(page);
  }, [page, fetchPage]);

  return {
    customers,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    setPage,
    loading,
    error,
    refetch: () => fetchPage(page),
  };
}

/**
 * Hook to fetch recordings with loading and error states
 */
export function useRecordings(callId?: string) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecordings = async () => {
    setLoading(true);
    try {
      const data = await callbotApi.getRecordings(callId);
      setRecordings(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch recordings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, [callId]);

  return { recordings, loading, error, refetch: fetchRecordings };
}

export function useCampaignPksImport() {
  const [preview, setPreview] = useState<CampaignImportPreviewResponse | null>(null);
  const [result, setResult] = useState<CampaignImportExecuteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<CampaignImportJobResponse | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failCountRef = useRef(0);
  const jobIdRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setIsPolling(false);
    failCountRef.current = 0;
  }, []);

  const startPolling = useCallback((campaignId: string, jobId: number) => {
    stopPolling();
    setIsPolling(true);
    jobIdRef.current = jobId;
    failCountRef.current = 0;

    const poll = async () => {
      try {
        const status = await callbotApi.getCampaignPksImportJob(campaignId, jobId);
        if (!status) {
          failCountRef.current += 1;
          if (failCountRef.current >= 5) {
            stopPolling();
            setError('Lost connection to import job');
            setLoading(false);
          }
          return;
        }
        failCountRef.current = 0;
        setJob(status);

        if (status.status === 'completed') {
          stopPolling();
          setResult(status.result);
          setLoading(false);
        } else if (status.status === 'failed') {
          stopPolling();
          setError(status.lastError || 'Import job failed');
          setLoading(false);
        }
      } catch {
        failCountRef.current += 1;
        if (failCountRef.current >= 5) {
          stopPolling();
          setError('Lost connection to import job');
          setLoading(false);
        }
      }
    };

    // Poll immediately, then every 2 seconds
    poll();
    pollRef.current = setInterval(poll, 2000);
  }, [stopPolling]);

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  const resumeJob = useCallback((campaignId: string, jobId: number) => {
    setJob(null);
    setResult(null);
    setError(null);
    setLoading(true);
    startPolling(campaignId, jobId);
  }, [startPolling]);

  const runPreview = async (
    campaignId: string,
    payload: {
      filters: Record<string, string>;
      filterMode?: 'and' | 'or' | 'grouped';
      groupedFilters?: Array<{ column: string; operator: '=' | '!=' | '>' | '<' | '>=' | '<='; values: string[] }>;
      pageSize?: number;
      sampleSize?: number;
      campaign?: {
        name?: string;
        description?: string;
        status?: string;
        maxAttempts?: number;
        retryIntervalHours?: number;
        orderByMonthlyPaymentDesc?: boolean;
        skipNextDayAfterSuccess?: boolean;
        runWeekdays?: string[];
        runWindowStart?: string;
        runWindowEnd?: string;
      };
    }
  ) => {
    setLoading(true);
    setError(null);
    try {
      const data = await callbotApi.previewCampaignPksImport(campaignId, payload);
      if (!data) {
        setError('Preview request failed');
        return null;
      }
      setPreview(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview request failed');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const runExecute = async (
    campaignId: string,
    payload: {
      filters: Record<string, string>;
      filterMode?: 'and' | 'or' | 'grouped';
      groupedFilters?: Array<{ column: string; operator: '=' | '!=' | '>' | '<' | '>=' | '<='; values: string[] }>;
      pageSize?: number;
      maxPages?: number;
      totalPages?: number;
      previewConfirmed: boolean;
      campaign?: {
        name?: string;
        description?: string;
        status?: string;
        maxAttempts?: number;
        retryIntervalHours?: number;
        orderByMonthlyPaymentDesc?: boolean;
        skipNextDayAfterSuccess?: boolean;
        runWeekdays?: string[];
        runWindowStart?: string;
        runWindowEnd?: string;
      };
    }
  ) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await callbotApi.executeCampaignPksImport(campaignId, payload);
      if (!data) {
        setError('Import request failed');
        setLoading(false);
        return null;
      }
      // The backend now returns { jobId, status: 'queued' } — start polling
      startPolling(campaignId, data.jobId);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import request failed');
      setLoading(false);
      return null;
    }
  };

  const jobActive = job !== null && (job.status === 'queued' || job.status === 'running');

  return {
    preview,
    result,
    job,
    jobActive,
    isPolling,
    loading,
    error,
    runPreview,
    runExecute,
    resumeJob,
    stopPolling,
    clear: () => {
      setPreview(null);
      setResult(null);
      setError(null);
      setJob(null);
      stopPolling();
    },
  };
}

export default {
  useCalls,
  useCallsPage,
  useAllCallsLazy,
  useCallsStats,
  useAgents,
  useCustomers,
  useCustomersPage,
  useRecordings,
  useCampaignPksImport,
};
