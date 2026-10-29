export interface Agent {
  id: string | number;
  name: string;
  role?: string;
  gender?: 'male' | 'female';
  toneTemplateId?: string;
  phoneWhatsapp?: string;
  companyName?: string;
  description?: string;
  enabled?: boolean | number;
  createdByUserId?: number;
  created_at?: string;
  updated_at?: string;
}

export interface Customer {
  id: string | number;
  name: string;
  surname?: string;
  fatherName?: string;
  phone: string;
  email?: string;
  debtAmount?: string | number;
  overdueDays?: number;
  organization?: string;
  contractNo?: string;
  sourceFullName?: string;
  fin?: string;
  monthlyPayment?: string | number;
  employeeCode?: string;
  reference?: string;
  branch?: string;
  category?: string;
  pksStatus?: string;
  pksComment?: string;
  commentTemplateName?: string;
  pksStatusCategory?: string;
  activeContractCount?: number;
  last3PaymentDates?: string;
  last3PaymentAmounts?: string;
  totalPaidLast90Days?: string | number;
  keptPromiseCount90d?: number;
  brokenPromiseCount90d?: number;
  collectorOrganization?: string;
  sourceOrganization?: string;
  lastPaymentDate?: string;
  lastPaymentAmount?: string | number;
  mobilePhone?: string;
  sourceSystem?: string;
  sourceRecordKey?: string;
  importedAt?: string;
  lastSyncedAt?: string;
  sourcePayloadHash?: string;
  status?: 'active' | 'inactive' | 'completed';
  createdAt?: string;
  updatedAt?: string;
  // Legacy snake_case support
  debt_amount?: number;
  overdue_days?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CampaignImportPreviewResponse {
  campaignId: number;
  filters: Record<string, string>;
  totalRows: number;
  totalPages: number;
  pageSize: number;
  queryTimeMs: number;
  sample: Array<Record<string, unknown>>;
}

export interface CampaignImportExecuteResponse {
  campaignId: number;
  filters: Record<string, string>;
  pageSize: number;
  importedRows: number;
  createdCustomers?: number;
  updatedCustomers?: number;
  attachedRows: number;
  alreadyAttachedRows?: number;
  skippedBySuccessfulCallYesterday?: number;
  pagesProcessed: number;
  cappedByMaxPages: boolean;
  orderByMonthlyPaymentDesc?: boolean;
  skipNextDayAfterSuccess?: boolean;
}

export interface CampaignImportJobStartResponse {
  jobId: number;
  campaignId: number;
  status: 'queued';
}

export interface CampaignImportJobResponse {
  jobId: number;
  campaignId: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  totalPages: number | null;
  pagesFetched: number;
  rowsFetched: number;
  customersCreated: number;
  customersUpdated: number;
  attachedRows: number;
  lastError: string | null;
  result: CampaignImportExecuteResponse | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CampaignNewMatchesImportResponse {
  campaignId: number;
  newMatchesFound: number;
  createdCustomers: number;
  updatedCustomers: number;
  attachedRows: number;
  alreadyAttachedRows: number;
  skippedBySuccessfulCallYesterday: number;
  pagesProcessed: number;
  cappedByMaxPages: boolean;
}

export interface Campaign {
  id: number;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
  maxAttempts: number;
  retryIntervalHours: number;
  orderByMonthlyPaymentDesc?: boolean;
  skipNextDayAfterSuccess?: boolean;
  dailyCustomerRefresh?: boolean;
  newCustomerMatchesCount?: number;
  newCustomerMatchesCheckedAt?: string | null;
  runWeekdays: string[];
  runWindowStart: string;
  runWindowEnd: string;
  baseTemplateId?: string;
  agentId?: number;
  trunkId?: string;
  runStartDate?: string;
  runEndDate?: string;
  totalCustomers: number;
  completedCalls: number;
  successfulCalls: number;
  createdAt: string;
  updatedAt?: string;
}

export interface CampaignCallHistoryItem {
  id: number;
  customerId?: number | null;
  customerName?: string | null;
  fin?: string | null;
  phone?: string | null;
  status: 'pending' | 'calling' | 'failed' | 'completed' | string;
  attemptNumber: number;
  updatedAt?: string | null;
  lastCallId?: number | null;
  lastCallStartedAt?: string | null;
  lastCallEndedAt?: string | null;
  lastCallDurationSeconds?: number | null;
  lastCallSummary?: string | null;
  lastCallDescription?: string | null;
}

export interface CampaignCallsResponse {
  items: CampaignCallHistoryItem[];
  total: number;
  campaignId: number;
}

export interface Call {
  id: string | number;
  agent_id: string | number;
  customer_id: string | number;
  agentId?: string | number | null;
  customerId?: string | number | null;
  agentName?: string | null;
  customerName?: string | null;
  customerSurname?: string | null;
  customerFin?: string | null;
  customerContractNo?: string | null;
  customerMobilePhone?: string | null;
  duration: number;
  durationSeconds?: number;
  transcript?: string;
  summary?: string;
  description?: string;
  recording_path?: string;
  status: 'active' | 'completed' | 'failed';
  started_at: string;
  ended_at?: string;
  created_at?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface LiveCall {
  id: string;
  agent: Agent;
  customer: Customer;
  duration: number;
  status: 'ringing' | 'active' | 'held' | 'ended';
  transcript?: string;
  started_at: string;
}

export interface Recording {
  id: string | number;
  call_id?: string | number;
  path?: string;
  url?: string;
  duration?: number;
  created_at?: string;
  updated_at?: string;
  agent_name?: string;
  agent_number?: string;
  customer_name?: string;
  customer_number?: string;
}
