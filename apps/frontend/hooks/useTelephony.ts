import { useEffect, useState } from 'react';
import { SIPAccount, SIPTrunk, IVRMenu, DialplanRule } from '@/types/telephony';
import { telephonyApi } from '@/lib/telephony-api-client';

export interface TelephonyData {
  accounts: SIPAccount[];
  trunks: SIPTrunk[];
  ivrs: IVRMenu[];
  rules: DialplanRule[];
}

interface UseTelephonyReturn extends TelephonyData {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTelephony(): UseTelephonyReturn {
  const [data, setData] = useState<TelephonyData>({
    accounts: [],
    trunks: [],
    ivrs: [],
    rules: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [accounts, trunks, ivrs, rules] = await Promise.all([
        telephonyApi.getSIPAccounts(),
        telephonyApi.getSIPTrunks(),
        telephonyApi.getIVRMenus(),
        telephonyApi.getDialplanRules(),
      ]);
      setData({ accounts, trunks, ivrs, rules });
    } catch (err) {
      setError('Failed to load telephony data');
      console.error('Telephony fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return {
    ...data,
    loading,
    error,
    refresh: fetchData,
  };
}

export function useSIPAccounts() {
  const [accounts, setAccounts] = useState<SIPAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await telephonyApi.getSIPAccounts();
        setAccounts(data);
      } catch (err) {
        setError('Failed to load SIP accounts');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  return { accounts, loading, error };
}

export function useSIPTrunks() {
  const [trunks, setTrunks] = useState<SIPTrunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await telephonyApi.getSIPTrunks();
        setTrunks(data);
      } catch (err) {
        setError('Failed to load SIP trunks');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  return { trunks, loading, error };
}

export function useIVRMenus() {
  const [ivrs, setIVRs] = useState<IVRMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await telephonyApi.getIVRMenus();
        setIVRs(data);
      } catch (err) {
        setError('Failed to load IVR menus');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  return { ivrs, loading, error };
}

export function useDialplanRules() {
  const [rules, setRules] = useState<DialplanRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await telephonyApi.getDialplanRules();
        setRules(data);
      } catch (err) {
        setError('Failed to load dialplan rules');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  return { rules, loading, error };
}
