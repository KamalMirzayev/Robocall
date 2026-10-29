import { useState, useEffect } from 'react';
import telephonyApi from '@/lib/telephony-api-client';
import { SIPAccount, SIPTrunk, DialplanRule, IVRMenu } from '@/types/telephony';

/**
 * Hook to fetch SIP accounts with loading and error states
 */
export function useSIPAccounts() {
  const [accounts, setAccounts] = useState<SIPAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAccounts = async () => {
      setLoading(true);
      try {
        const data = await telephonyApi.getSIPAccounts();
        setAccounts(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch SIP accounts');
      } finally {
        setLoading(false);
      }
    };

    fetchAccounts();
  }, []);

  return { accounts, loading, error };
}

/**
 * Hook to fetch SIP trunks with loading and error states
 */
export function useSIPTrunks() {
  const [trunks, setTrunks] = useState<SIPTrunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTrunks = async () => {
      setLoading(true);
      try {
        const data = await telephonyApi.getSIPTrunks();
        setTrunks(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch SIP trunks');
      } finally {
        setLoading(false);
      }
    };

    fetchTrunks();
  }, []);

  return { trunks, loading, error };
}

/**
 * Hook to fetch dialplan rules with loading and error states
 */
export function useDialplanRules() {
  const [rules, setRules] = useState<DialplanRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRules = async () => {
      setLoading(true);
      try {
        const data = await telephonyApi.getDialplanRules();
        setRules(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch dialplan rules');
      } finally {
        setLoading(false);
      }
    };

    fetchRules();
  }, []);

  return { rules, loading, error };
}

/**
 * Hook to fetch IVR menus with loading and error states
 */
export function useIVRMenus() {
  const [menus, setMenus] = useState<IVRMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMenus = async () => {
      setLoading(true);
      try {
        const data = await telephonyApi.getIVRMenus();
        setMenus(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch IVR menus');
      } finally {
        setLoading(false);
      }
    };

    fetchMenus();
  }, []);

  return { menus, loading, error };
}

export default {
  useSIPAccounts,
  useSIPTrunks,
  useDialplanRules,
  useIVRMenus,
};
