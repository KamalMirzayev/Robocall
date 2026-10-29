import { SIPAccount, SIPTrunk, DialplanRule, IVRMenu } from '@/types/telephony';

/**
 * Telephony API Client
 * Uses the frontend's API proxy routes to handle authentication and CORS
 * Telephony uses /api/state for fetching all data, and individual POST/PUT/DELETE for modifications
 */

const TELEPHONY_PROXY_BASE = '/api/telephony-panel';

export interface StateData {
  accounts: SIPAccount[];
  trunks: SIPTrunk[];
  ivrs: IVRMenu[];
  rules: DialplanRule[];
}

export interface AsteriskLogItem {
  timestamp: string | null;
  level: string;
  pid: string;
  source: string;
  message: string;
  raw: string;
}

export interface AsteriskLogsResponse {
  file: string;
  filePath: string;
  count: number;
  scannedLineCount: number;
  filters: {
    file: string;
    level: string;
    q: string;
    source: string;
    limit: number;
    maxBytes: number;
    sinceMinutes: number;
  };
  items: AsteriskLogItem[];
}

export interface InstructionTemplate {
  id: string;
  tenant_id: string;
  version: string;
  name: string;
  description: string | null;
  content: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  customer_category: string | null;
}

export interface CreateInstructionTemplateInput {
  tenant_id?: string;
  version?: string;
  name: string;
  description?: string;
  content: string;
  is_active?: boolean;
  created_by?: string;
  customer_category?: string;
}

async function fetchTelephony(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${TELEPHONY_PROXY_BASE}${path}`;
  
  const finalOptions: RequestInit = {
    credentials: 'include', // Include cookies in requests
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  return fetch(url, finalOptions);
}

export const telephonyApi = {
  // Get all state data at once
  async getState(): Promise<StateData> {
    try {
      const response = await fetchTelephony('/state');
      if (!response.ok) {
        console.error(`Failed to fetch telephony state: HTTP ${response.status}`);
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to fetch telephony state:', error);
      return { accounts: [], trunks: [], ivrs: [], rules: [] };
    }
  },

  // SIP Accounts
  async getSIPAccounts(): Promise<SIPAccount[]> {
    try {
      const state = await telephonyApi.getState();
      return state.accounts;
    } catch (error) {
      console.error('Failed to fetch SIP accounts:', error);
      return [];
    }
  },

  async getSIPAccount(id: string): Promise<SIPAccount | null> {
    try {
      const state = await telephonyApi.getState();
      return state.accounts.find(a => a.id === id) || null;
    } catch (error) {
      console.error(`Failed to fetch SIP account ${id}:`, error);
      return null;
    }
  },

  async createSIPAccount(account: Omit<SIPAccount, 'id' | 'created_at' | 'updated_at'>): Promise<SIPAccount | null> {
    try {
      const response = await fetchTelephony('/accounts', {
        method: 'POST',
        body: JSON.stringify(account),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Failed to create SIP account:', error);
      return null;
    }
  },

  async updateSIPAccount(id: string, data: Partial<SIPAccount>): Promise<SIPAccount | null> {
    try {
      const response = await fetchTelephony(`/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Failed to update SIP account ${id}:`, error);
      return null;
    }
  },

  async deleteSIPAccount(id: string): Promise<boolean> {
    try {
      const response = await fetchTelephony(`/accounts/${id}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch (error) {
      console.error(`Failed to delete SIP account ${id}:`, error);
      return false;
    }
  },

  // SIP Trunks
  async getSIPTrunks(): Promise<SIPTrunk[]> {
    try {
      const state = await telephonyApi.getState();
      return state.trunks;
    } catch (error) {
      console.error('Failed to fetch SIP trunks:', error);
      return [];
    }
  },

  async getSIPTrunk(id: string): Promise<SIPTrunk | null> {
    try {
      const state = await telephonyApi.getState();
      return state.trunks.find(t => t.id === id) || null;
    } catch (error) {
      console.error(`Failed to fetch SIP trunk ${id}:`, error);
      return null;
    }
  },

  async createSIPTrunk(trunk: Omit<SIPTrunk, 'id' | 'created_at' | 'updated_at'>): Promise<SIPTrunk | null> {
    try {
      const response = await fetchTelephony('/trunks', {
        method: 'POST',
        body: JSON.stringify(trunk),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Failed to create SIP trunk:', error);
      return null;
    }
  },

  async updateSIPTrunk(id: string, data: Partial<SIPTrunk>): Promise<SIPTrunk | null> {
    try {
      const response = await fetchTelephony(`/trunks/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Failed to update SIP trunk ${id}:`, error);
      return null;
    }
  },

  async deleteSIPTrunk(id: string): Promise<boolean> {
    try {
      const response = await fetchTelephony(`/trunks/${id}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch (error) {
      console.error(`Failed to delete SIP trunk ${id}:`, error);
      return false;
    }
  },

  // Dialplan Rules
  async getDialplanRules(): Promise<DialplanRule[]> {
    try {
      const state = await telephonyApi.getState();
      return state.rules.sort((a, b) => a.priority - b.priority);
    } catch (error) {
      console.error('Failed to fetch dialplan rules:', error);
      return [];
    }
  },

  async getDialplanRule(id: string): Promise<DialplanRule | null> {
    try {
      const state = await telephonyApi.getState();
      return state.rules.find(r => r.id === id) || null;
    } catch (error) {
      console.error(`Failed to fetch dialplan rule ${id}:`, error);
      return null;
    }
  },

  async createDialplanRule(rule: Omit<DialplanRule, 'id' | 'created_at' | 'updated_at'>): Promise<DialplanRule | null> {
    try {
      const response = await fetchTelephony('/rules', {
        method: 'POST',
        body: JSON.stringify(rule),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Failed to create dialplan rule:', error);
      return null;
    }
  },

  async updateDialplanRule(id: string, data: Partial<DialplanRule>): Promise<DialplanRule | null> {
    try {
      const response = await fetchTelephony(`/rules/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Failed to update dialplan rule ${id}:`, error);
      return null;
    }
  },

  async deleteDialplanRule(id: string): Promise<boolean> {
    try {
      const response = await fetchTelephony(`/rules/${id}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch (error) {
      console.error(`Failed to delete dialplan rule ${id}:`, error);
      return false;
    }
  },

  // IVR Menus
  async getIVRMenus(): Promise<IVRMenu[]> {
    try {
      const state = await telephonyApi.getState();
      return state.ivrs;
    } catch (error) {
      console.error('Failed to fetch IVR menus:', error);
      return [];
    }
  },

  async getIVRMenu(id: string): Promise<IVRMenu | null> {
    try {
      const state = await telephonyApi.getState();
      return state.ivrs.find(i => i.id === id) || null;
    } catch (error) {
      console.error(`Failed to fetch IVR menu ${id}:`, error);
      return null;
    }
  },

  async createIVRMenu(menu: Omit<IVRMenu, 'id' | 'created_at' | 'updated_at'>): Promise<IVRMenu | null> {
    try {
      const response = await fetchTelephony('/ivrs', {
        method: 'POST',
        body: JSON.stringify(menu),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Failed to create IVR menu:', error);
      return null;
    }
  },

  async updateIVRMenu(id: string, data: Partial<IVRMenu>): Promise<IVRMenu | null> {
    try {
      const response = await fetchTelephony(`/ivrs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Failed to update IVR menu ${id}:`, error);
      return null;
    }
  },

  async deleteIVRMenu(id: string): Promise<boolean> {
    try {
      const response = await fetchTelephony(`/ivrs/${id}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch (error) {
      console.error(`Failed to delete IVR menu ${id}:`, error);
      return false;
    }
  },

  // Render and reload Asterisk configuration
  async render(): Promise<any> {
    try {
      const response = await fetchTelephony('/render', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Failed to render Asterisk configuration:', error);
      throw error;
    }
  },

  async getAsteriskLogs(params: {
    file?: string;
    level?: string;
    q?: string;
    source?: string;
    limit?: number;
    maxBytes?: number;
    sinceMinutes?: number;
  } = {}): Promise<AsteriskLogsResponse> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      searchParams.set(key, String(value));
    });

    const query = searchParams.toString();
    const response = await fetchTelephony(`/asterisk/logs${query ? `?${query}` : ''}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  },

  async getInstructionTemplates(params: {
    tenant_id?: string;
    q?: string;
    limit?: number;
  } = {}): Promise<InstructionTemplate[]> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      searchParams.set(key, String(value));
    });

    const query = searchParams.toString();
    const response = await fetchTelephony(`/instruction-templates${query ? `?${query}` : ''}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  },

  async createInstructionTemplate(input: CreateInstructionTemplateInput): Promise<InstructionTemplate> {
    const response = await fetchTelephony('/instruction-templates', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = String(payload?.error || `HTTP ${response.status}`);
      throw new Error(message);
    }
    return response.json();
  },
};

export default telephonyApi;
