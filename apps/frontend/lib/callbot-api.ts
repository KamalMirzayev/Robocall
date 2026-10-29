import apiClient from './api-client';
import { AxiosError } from 'axios';
import {
  Call,
  Agent,
  Customer,
  Recording,
  Campaign,
  CampaignCallsResponse,
  CampaignImportPreviewResponse,
  CampaignImportExecuteResponse,
  CampaignNewMatchesImportResponse,
  CampaignImportJobStartResponse,
  CampaignImportJobResponse,
} from '@/types/callbot';

/**
 * Callbot API Client
 * Provides type-safe methods for interacting with Callbot backend
 */

export interface InstructionTemplate {
  id: string;
  tenant_id: string;
  version: string;
  name: string;
  description: string | null;
  content: string;
  template_type: 'base' | 'tone' | 'system';
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  customer_category: string | null;
  // Stable slug external callers (e.g. the mobile-app call-trigger API) reference as
  // `templateKey` instead of the internal uuid — see routes/external-calls.ts.
  external_key: string | null;
}

export interface CreateInstructionTemplateInput {
  tenant_id?: string;
  version?: string;
  name: string;
  description?: string;
  content: string;
  template_type?: 'base' | 'tone' | 'system';
  is_active?: boolean;
  created_by?: string;
  customer_category?: string;
  external_key?: string;
}

// One row per external server-to-server integration (e.g. a customer's mobile-app
// backend) allowed to call the external call-trigger API — see routes/api-clients.ts.
export interface ExternalApiClient {
  id: number;
  name: string;
  defaultAgentId: number | null;
  defaultWebhookUrl: string | null;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

// Only present in the response right after creation — the raw key/secret are never
// retrievable again once this response is gone.
export interface ExternalApiClientCreated extends ExternalApiClient {
  apiKey: string;
  webhookSecret: string;
}

export interface ExternalApiClientInput {
  name: string;
  defaultAgentId?: number | null;
  defaultWebhookUrl?: string | null;
  active?: boolean;
}

// A registry of known "missing field" / offer codes external callers pass as
// dynamicContext instead of arbitrary free text — see routes/dynamic-context-codes.ts.
export interface DynamicContextCode {
  id: number;
  code: string;
  phrase: string;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DynamicContextCodeInput {
  code: string;
  phrase: string;
  description?: string | null;
  active?: boolean;
}

// Backend currently returns camelCase fields from SQL aliases. Normalize to legacy
// snake_case keys expected by existing UI. Shared by getCalls() (fetch-everything) and
// getCallsPage() (single-page) so both return identically-shaped Call objects.
function normalizeCall(item: any): Call {
  return {
    id: item.id,
    agent_id: item.agent_id ?? item.agentId,
    customer_id: item.customer_id ?? item.customerId,
    agentId: item.agentId ?? item.agent_id ?? null,
    customerId: item.customerId ?? item.customer_id ?? null,
    agentName: item.agentName ?? null,
    customerName: item.customerName ?? null,
    customerSurname: item.customerSurname ?? null,
    customerFin: item.customerFin ?? null,
    customerContractNo: item.customerContractNo ?? null,
    customerMobilePhone: item.customerMobilePhone ?? null,
    duration: Number(item.duration ?? item.durationSeconds ?? 0),
    durationSeconds: Number(item.durationSeconds ?? item.duration ?? 0),
    transcript: item.transcript,
    summary: item.summary,
    description: item.description,
    recording_path: item.recording_path ?? item.recordingPath,
    status: item.status ?? (item.endedAt || item.ended_at ? 'completed' : 'active'),
    started_at: item.started_at ?? item.startedAt,
    ended_at: item.ended_at ?? item.endedAt,
    created_at: item.created_at ?? item.startedAt,
    startedAt: item.startedAt ?? item.started_at,
    endedAt: item.endedAt ?? item.ended_at,
  } as Call;
}

export const callbotApi = {
  extractErrorMessage(error: unknown, fallback: string): string {
    const axiosError = error as AxiosError<{ error?: string; detail?: string; message?: string }>;
    const backendPayload = axiosError?.response?.data;
    const backendMessage = backendPayload?.error || backendPayload?.detail || backendPayload?.message;
    if (backendMessage) return backendMessage;
    if (axiosError?.message) return axiosError.message;
    return fallback;
  },

  // Calls
  async getCalls(filters?: { agent_id?: string; status?: string }): Promise<Call[]> {
    try {
      // Backend paginates this endpoint (default pageSize 10, max 1000), so a single
      // request only returns one page. Page through all results here — used only by
      // callers that genuinely need the whole table (e.g. calls/page.tsx's Intentions
      // tab, which groups across all calls); prefer getCallsPage() for a single page.
      const pageSize = 1000;
      let page = 1;
      let rows: any[] = [];
      let total = 0;

      while (true) {
        const response = await apiClient.get<Call[] | { data?: Call[]; items?: any[]; total?: number }>(
          '/callbot/calls',
          { params: { ...filters, page, pageSize } }
        );
        const payload: any = response.data;
        const pageRows: any[] = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.items)
            ? payload.items
            : Array.isArray(payload?.data)
              ? payload.data
              : [];

        rows = rows.concat(pageRows);
        total = Array.isArray(payload) ? rows.length : Number(payload?.total ?? rows.length);

        if (pageRows.length < pageSize || rows.length >= total) break;
        page += 1;
      }

      return rows.map(normalizeCall);
    } catch (error) {
      console.error('Failed to fetch calls:', error);
      return [];
    }
  },

  // Single-page fetch for calls/page.tsx's History tab — the customers-page-style paginated
  // display, as opposed to getCalls() above which deliberately fetches everything.
  async getCallsPage(params: { page: number; pageSize: number; agent_id?: string; status?: string }): Promise<{ data: Call[]; total: number; page: number; pageSize: number }> {
    try {
      const response = await apiClient.get<{ items: any[]; total: number; page: number; pageSize: number }>('/callbot/calls', { params });
      return { data: response.data.items.map(normalizeCall), total: response.data.total, page: response.data.page, pageSize: response.data.pageSize };
    } catch (error) {
      console.error('Failed to fetch calls page:', error);
      return { data: [], total: 0, page: params.page, pageSize: params.pageSize };
    }
  },

  // Lightweight aggregate for the statistics page — avoids getCalls()'s full-list fetch
  // (which pages through the entire calls table) just to compute these three counts.
  async getCallsStats(): Promise<{ total: number; active: number; completed: number }> {
    try {
      const response = await apiClient.get<{ total: number; active: number; completed: number }>('/callbot/calls/stats');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch calls stats:', error);
      return { total: 0, active: 0, completed: 0 };
    }
  },

  async getCall(callId: string): Promise<Call | null> {
    try {
      const response = await apiClient.get<Call>(`/callbot/calls/${callId}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch call ${callId}:`, error);
      return null;
    }
  },

  async updateCall(callId: string, data: Partial<Call>): Promise<Call | null> {
    try {
      const response = await apiClient.put<Call>(`/callbot/calls/${callId}`, data);
      return response.data;
    } catch (error) {
      console.error(`Failed to update call ${callId}:`, error);
      return null;
    }
  },

  // Agents
  async getAgents(): Promise<Agent[]> {
    try {
      const response = await apiClient.get<Agent[] | { data: Agent[] }>('/callbot/agents');
      const data = Array.isArray(response.data) ? response.data : response.data?.data || [];
      return data;
    } catch (error) {
      console.error('Failed to fetch agents:', error);
      return [];
    }
  },

  async getAgent(agentId: string): Promise<Agent | null> {
    try {
      const response = await apiClient.get<Agent>(`/callbot/agents/${agentId}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch agent ${agentId}:`, error);
      return null;
    }
  },

  async createAgent(agent: Omit<Agent, 'id'>): Promise<Agent | null> {
    try {
      const response = await apiClient.post<Agent>('/callbot/agents', agent);
      return response.data;
    } catch (error) {
      console.error('Failed to create agent:', error);
      return null;
    }
  },

  async updateAgent(agentId: string, data: Partial<Agent>): Promise<Agent | null> {
    try {
      const response = await apiClient.put<Agent>(`/callbot/agents/${agentId}`, data);
      return response.data;
    } catch (error) {
      console.error(`Failed to update agent ${agentId}:`, error);
      return null;
    }
  },

  async deleteAgent(agentId: string): Promise<boolean> {
    try {
      const response = await apiClient.delete(`/callbot/agents/${agentId}`);
      // 204 No Content and 200 OK are both successful responses
      // Axios treats 2xx status codes as success
      return response.status === 204 || response.status === 200 || true;
    } catch (error: any) {
      // Debug: Log the full error structure
      console.error('deleteAgent error object:', error);
      console.error('error.response:', error?.response);
      console.error('error.response.data:', error?.response?.data);
      
      // Axios wraps the error, extract the message properly
      let errorMsg = 'Failed to delete agent';
      
      // Check response data first (from server) - handle both object and string responses
      if (error?.response?.data) {
        const data = error.response.data;
        // If data is an object with error property
        if (typeof data === 'object' && data.error) {
          errorMsg = data.error;
        }
        // If data is an object with message property
        else if (typeof data === 'object' && data.message) {
          errorMsg = data.message;
        }
        // If data is a string
        else if (typeof data === 'string') {
          errorMsg = data;
        }
      } else if (error?.message) {
        errorMsg = error.message;
      }
      
      console.error(`Final error message for deleteAgent ${agentId}:`, errorMsg);
      throw new Error(errorMsg);
    }
  },

  // Customers
  async getCustomers(): Promise<Customer[]> {
    try {
      const response = await apiClient.get<Customer[] | { data: Customer[] }>('/callbot/customers');
      const data = Array.isArray(response.data) ? response.data : response.data?.data || [];
      return data;
    } catch (error) {
      console.error('Failed to fetch customers:', error);
      return [];
    }
  },

  // Paginated (and optionally searched) variant for the customers list page and
  // CustomerSearchSelect — the full list is ~33k rows and was rendering unpaginated on every
  // load. getCustomers() above is left as-is (returns everything) for callers that still need
  // the whole list (statistics aggregation, campaigns/page.tsx).
  async getCustomersPage(params: { page: number; pageSize: number; search?: string }): Promise<{ data: Customer[]; total: number; page: number; pageSize: number }> {
    try {
      const response = await apiClient.get<{ data: Customer[]; total: number; page: number; pageSize: number }>('/callbot/customers', { params });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch customers page:', error);
      return { data: [], total: 0, page: params.page, pageSize: params.pageSize };
    }
  },

  async getCustomer(customerId: string): Promise<Customer | null> {
    try {
      const response = await apiClient.get<Customer>(`/callbot/customers/${customerId}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch customer ${customerId}:`, error);
      return null;
    }
  },

  async createCustomer(customer: Omit<Customer, 'id'>): Promise<Customer | null> {
    try {
      const response = await apiClient.post<Customer>('/callbot/customers', customer);
      return response.data;
    } catch (error) {
      console.error('Failed to create customer:', error);
      return null;
    }
  },

  async updateCustomer(customerId: string, data: Partial<Customer>): Promise<Customer | null> {
    try {
      const response = await apiClient.put<Customer>(`/callbot/customers/${customerId}`, data);
      return response.data;
    } catch (error) {
      console.error(`Failed to update customer ${customerId}:`, error);
      return null;
    }
  },

  async deleteCustomer(customerId: string): Promise<boolean> {
    try {
      await apiClient.delete(`/callbot/customers/${customerId}`);
      return true;
    } catch (error) {
      console.error(`Failed to delete customer ${customerId}:`, error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Delete customer request failed'));
    }
  },

  async deleteCustomersByFilters(payload: {
    importedDays?: number;
    organizations?: string[];
    campaignId?: number;
  }): Promise<{
    matchedCount: number;
    deletedCustomers: number;
    deletedCampaignCalls: number;
    filters?: {
      importedDays?: number | null;
      organizations?: string[];
      campaignId?: number | null;
    };
  } | null> {
    try {
      const response = await apiClient.post('/callbot/customers/delete/batch', payload);
      return response.data;
    } catch (error) {
      console.error('Failed to batch delete customers:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Batch delete request failed'));
    }
  },

  async previewCampaignPksImport(
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
  ): Promise<CampaignImportPreviewResponse | null> {
    try {
      const response = await apiClient.post<CampaignImportPreviewResponse>(
        `/callbot/campaigns/${campaignId}/import/pks/preview`,
        payload
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to preview PKS import for campaign ${campaignId}:`, error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Preview request failed'));
    }
  },

  async executeCampaignPksImport(
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
  ): Promise<CampaignImportJobStartResponse | null> {
    try {
      const response = await apiClient.post<CampaignImportJobStartResponse>(
        `/callbot/campaigns/${campaignId}/import/pks/execute`,
        payload
      );
      return response.data;
    } catch (error) {
      // 409 Conflict means a job is already running — return the existing jobId
      const axiosError = error as AxiosError<{ error?: string; jobId?: number }>;
      if (axiosError?.response?.status === 409 && axiosError.response.data?.jobId) {
        return {
          jobId: axiosError.response.data.jobId,
          campaignId: Number(campaignId),
          status: 'queued',
        };
      }
      console.error(`Failed to execute PKS import for campaign ${campaignId}:`, error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Import request failed'));
    }
  },

  async getCampaignPksImportJob(
    campaignId: string,
    jobId: number
  ): Promise<CampaignImportJobResponse | null> {
    try {
      const response = await apiClient.get<CampaignImportJobResponse>(
        `/callbot/campaigns/${campaignId}/import/pks/jobs/${jobId}`
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch PKS import job ${jobId}:`, error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Import status request failed'));
    }
  },

  async executeCampaignDatabaseImport(
    campaignId: string,
    customerIds: number[]
  ): Promise<CampaignImportExecuteResponse | null> {
    try {
      const response = await apiClient.post<CampaignImportExecuteResponse>(
        `/callbot/campaigns/${campaignId}/import/database`,
        { customerIds }
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to execute database import for campaign ${campaignId}:`, error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Database import failed'));
    }
  },

  async importCampaignNewPksMatches(
    campaignId: string | number
  ): Promise<CampaignNewMatchesImportResponse | null> {
    try {
      const response = await apiClient.post<CampaignNewMatchesImportResponse>(
        `/callbot/campaigns/${campaignId}/pks/import-new-matches`,
        {}
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to import new PKS matches for campaign ${campaignId}:`, error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Import of new matches failed'));
    }
  },

  // PKS distinct values for filter dropdowns
  async getPksDistinctValues(column: string): Promise<string[]> {
    try {
      const response = await apiClient.get<{ column: string; values: string[] }>(
        '/callbot/campaigns/pks/distinct-values',
        { params: { column } }
      );
      return Array.isArray(response.data?.values) ? response.data.values : [];
    } catch (error) {
      console.error(`Failed to fetch distinct values for column ${column}:`, error);
      return [];
    }
  },

  // Campaigns CRUD
  async getCampaigns() {
    try {
      const response = await apiClient.get('/callbot/campaigns');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch campaigns:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to fetch campaigns'));
    }
  },

  async getCampaign(campaignId: string | number): Promise<Campaign> {
    try {
      const response = await apiClient.get<Campaign>(`/callbot/campaigns/${campaignId}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch campaign ${campaignId}:`, error);
      throw new Error(callbotApi.extractErrorMessage(error, `Failed to fetch campaign`));
    }
  },

  async getCampaignCalls(campaignId: string | number): Promise<CampaignCallsResponse> {
    try {
      const response = await apiClient.get<CampaignCallsResponse>(`/callbot/campaigns/${campaignId}/calls`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch campaign calls ${campaignId}:`, error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to fetch campaign calls'));
    }
  },

  async createCampaign(payload: {
    name: string;
    description?: string;
    status?: string;
    maxAttempts?: number;
    retryIntervalHours?: number;
    orderByMonthlyPaymentDesc?: boolean;
    skipNextDayAfterSuccess?: boolean;
    dailyCustomerRefresh?: boolean;
    runWeekdays?: string[];
    runWindowStart?: string;
    runWindowEnd?: string;
    runStartDate?: string;
    runEndDate?: string;
    agentId?: number;
    trunkId?: string;
    trunkIds?: string[];
    baseTemplateId?: string;
  }) {
    try {
      const response = await apiClient.post('/callbot/campaigns', payload);
      return response.data;
    } catch (error) {
      console.error('Failed to create campaign:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to create campaign'));
    }
  },

  async updateCampaign(
    campaignId: string | number,
    payload: {
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
      runStartDate?: string;
      runEndDate?: string;
      agentId?: number;
      trunkId?: string;
      trunkIds?: string[];
      baseTemplateId?: string;
    }
  ) {
    try {
      const response = await apiClient.put(`/callbot/campaigns/${campaignId}`, payload);
      return response.data;
    } catch (error) {
      console.error(`Failed to update campaign ${campaignId}:`, error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to update campaign'));
    }
  },

  async deleteCampaign(campaignId: string | number) {
    try {
      const response = await apiClient.delete(`/callbot/campaigns/${campaignId}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to delete campaign ${campaignId}:`, error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to delete campaign'));
    }
  },

  // Recordings
  async getRecordings(callId?: string): Promise<Recording[]> {
    try {
      const response = await apiClient.get<Recording[] | { data: Recording[] }>('/callbot/recordings', {
        params: callId ? { call_id: callId } : undefined,
      });
      const data = Array.isArray(response.data) ? response.data : response.data?.data || [];

      const toFrontendRecordingUrl = (value: unknown): string | undefined => {
        const raw = typeof value === 'string' ? value.trim() : '';
        if (!raw) return undefined;
        if (raw.startsWith('/api/callbot/')) return raw;
        if (raw.startsWith('/api/recordings/')) return `/api/callbot${raw.slice('/api'.length)}`;
        if (raw.startsWith('/recordings/')) return `/api/callbot${raw}`;
        return raw;
      };

      // Support both legacy schema (id/call_id/created_at) and new schema
      // (jobId/durationSeconds/startedAt/recordingUrl) returned by backend.
      return (data as any[]).map((item) => {
        const playbackUrl = toFrontendRecordingUrl(item.url ?? item.recordingUrl ?? item.downloadUrl ?? item.path);
        return {
          id: item.id ?? item.jobId,
          call_id: item.call_id ?? item.jobId,
          path: playbackUrl,
          url: playbackUrl,
          duration: item.duration ?? item.durationSeconds,
          created_at: item.created_at ?? item.startedAt ?? item.endedAt,
          updated_at: item.updated_at ?? item.endedAt,
          agent_name: item.agent_name ?? item.source?.name,
          agent_number: item.agent_number ?? item.source?.number,
          customer_name: item.customer_name ?? item.destination?.name,
          customer_number: item.customer_number ?? item.destination?.number,
        };
      });
    } catch (error) {
      console.error('Failed to fetch recordings:', error);
      return [];
    }
  },

  async getRecording(recordingId: string): Promise<Recording | null> {
    try {
      const response = await apiClient.get<Recording>(`/callbot/recordings/${recordingId}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch recording ${recordingId}:`, error);
      return null;
    }
  },

  // Instruction Templates (AI/campaign content; stored in the callbot database)
  async getInstructionTemplates(params: {
    tenant_id?: string;
    q?: string;
    limit?: number;
  } = {}): Promise<InstructionTemplate[]> {
    try {
      const response = await apiClient.get<InstructionTemplate[]>('/callbot/instruction-templates', { params });
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error('Failed to fetch instruction templates:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to fetch instruction templates'));
    }
  },

  async createInstructionTemplate(input: CreateInstructionTemplateInput): Promise<InstructionTemplate> {
    try {
      const response = await apiClient.post<InstructionTemplate>('/callbot/instruction-templates', input);
      return response.data;
    } catch (error) {
      console.error('Failed to create instruction template:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to create instruction template'));
    }
  },

  async updateInstructionTemplate(id: string, input: Partial<CreateInstructionTemplateInput>): Promise<InstructionTemplate> {
    try {
      const response = await apiClient.put<InstructionTemplate>(`/callbot/instruction-templates/${id}`, input);
      return response.data;
    } catch (error) {
      console.error('Failed to update instruction template:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to update instruction template'));
    }
  },

  // Usage / billing
  async getUsage(month: string): Promise<{
    month: string;
    baseFeeAzn: number;
    currency: string;
    usage: { totalAnsweredCalls: number; totalMinutes: number; totalUsageCostAzn: number; totalCostAzn: number };
    byCampaign: Array<{ campaignId: number; campaignName: string; answeredCalls: number; minutes: number; usageCostAzn: number }>;
    bySource: Array<{ source: 'campaign' | 'manual' | 'external_api'; answeredCalls: number; minutes: number; usageCostAzn: number }>;
    byTrunk: Array<{ trunkId: string | null; answeredCalls: number; minutes: number; usageCostAzn: number }>;
    daily: Array<{
      date: string;
      sources: Record<'campaign' | 'manual' | 'external_api', { minutes: number; calls: number; costAzn: number }>;
      totalMinutes: number;
      totalCostAzn: number;
    }>;
  } | null> {
    try {
      const response = await apiClient.get('/callbot/usage', { params: { month } });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch usage data:', error);
      return null;
    }
  },

  // External API access (server-to-server integrations, e.g. a mobile app's backend) —
  // admin-only, see routes/api-clients.ts.
  async getExternalApiClients(): Promise<ExternalApiClient[]> {
    try {
      const response = await apiClient.get<ExternalApiClient[]>('/callbot/api-clients');
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error('Failed to fetch API clients:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to fetch API clients'));
    }
  },

  // The API key and webhook secret in the response are shown ONLY here, once — the
  // server never stores or returns them again after this call.
  async createExternalApiClient(input: ExternalApiClientInput): Promise<ExternalApiClientCreated> {
    try {
      const response = await apiClient.post<ExternalApiClientCreated>('/callbot/api-clients', input);
      return response.data;
    } catch (error) {
      console.error('Failed to create API client:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to create API client'));
    }
  },

  async updateExternalApiClient(id: number, input: ExternalApiClientInput): Promise<ExternalApiClient> {
    try {
      const response = await apiClient.put<ExternalApiClient>(`/callbot/api-clients/${id}`, input);
      return response.data;
    } catch (error) {
      console.error('Failed to update API client:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to update API client'));
    }
  },

  // Revokes by deactivating (server-side soft-delete, keeps audit history intact) —
  // not a permanent delete.
  async revokeExternalApiClient(id: number): Promise<ExternalApiClient> {
    try {
      const response = await apiClient.delete<ExternalApiClient>(`/callbot/api-clients/${id}`);
      return response.data;
    } catch (error) {
      console.error('Failed to revoke API client:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to revoke API client'));
    }
  },

  // Dynamic context codes (see routes/dynamic-context-codes.ts)
  async getDynamicContextCodes(): Promise<DynamicContextCode[]> {
    try {
      const response = await apiClient.get<DynamicContextCode[]>('/callbot/dynamic-context-codes');
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error('Failed to fetch dynamic context codes:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to fetch dynamic context codes'));
    }
  },

  async createDynamicContextCode(input: DynamicContextCodeInput): Promise<DynamicContextCode> {
    try {
      const response = await apiClient.post<DynamicContextCode>('/callbot/dynamic-context-codes', input);
      return response.data;
    } catch (error) {
      console.error('Failed to create dynamic context code:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to create dynamic context code'));
    }
  },

  async updateDynamicContextCode(id: number, input: DynamicContextCodeInput): Promise<DynamicContextCode> {
    try {
      const response = await apiClient.put<DynamicContextCode>(`/callbot/dynamic-context-codes/${id}`, input);
      return response.data;
    } catch (error) {
      console.error('Failed to update dynamic context code:', error);
      throw new Error(callbotApi.extractErrorMessage(error, 'Failed to update dynamic context code'));
    }
  },
};

export default callbotApi;
