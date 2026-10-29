import { pgTable, serial, varchar, text, integer, timestamp, decimal, date, boolean, uuid, jsonb } from 'drizzle-orm/pg-core';

export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  maxAttempts: integer('max_attempts').notNull().default(3),
  retryIntervalHours: integer('retry_interval_hours').notNull().default(24),
  orderByMonthlyPaymentDesc: boolean('order_by_monthly_payment_desc').notNull().default(false),
  skipNextDayAfterSuccess: boolean('skip_next_day_after_success').notNull().default(false),
  runWeekdays: varchar('run_weekdays', { length: 50 }).default(''),
  runWindowStart: varchar('run_window_start', { length: 10 }).default('09:00'),
  runWindowEnd: varchar('run_window_end', { length: 10 }).default('19:00'),
  runStartDate: date('run_start_date'),
  runEndDate: date('run_end_date'),
  baseTemplateId: uuid('base_template_id'),
  agentId: integer('agent_id').references(() => agents.id),
  trunkId: varchar('trunk_id', { length: 64 }),
  trunkIds: varchar('trunk_ids', { length: 500 }),
  totalCustomers: integer('total_customers').notNull().default(0),
  completedCalls: integer('completed_calls').notNull().default(0),
  successfulCalls: integer('successful_calls').notNull().default(0),
  // PKS customer-data refresh (see pks-customer-refresh.ts): the filters used for the
  // original PKS import, replayed daily to refresh already-attached customers and to
  // detect newly-matching customers without re-asking the user to redo the import.
  pksImportFilters: jsonb('pks_import_filters'),
  dailyCustomerRefresh: boolean('daily_customer_refresh').notNull().default(false),
  lastCustomerRefreshDate: date('last_customer_refresh_date'),
  lastCustomerRefreshAttemptAt: timestamp('last_customer_refresh_attempt_at', { withTimezone: true }),
  newCustomerMatchesCount: integer('new_customer_matches_count').notNull().default(0),
  newCustomerMatchesCheckedAt: timestamp('new_customer_matches_checked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const campaignCalls = pgTable('campaign_calls', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull().references(() => campaigns.id),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  attemptNumber: integer('attempt_number').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// AI instruction templates for campaigns. Moved here from the robocall_crm database
// (it is AI/campaign content, unrelated to Asterisk telephony provisioning).
export const instructionTemplates = pgTable('instruction_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: varchar('tenant_id', { length: 50 }).notNull().default('default'),
  version: varchar('version', { length: 50 }).notNull().default('v1'),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  content: text('content').notNull(),
  templateType: varchar('template_type', { length: 50 }).notNull().default('base'),
  isActive: boolean('is_active').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 255 }),
  customerCategory: varchar('customer_category', { length: 100 }),
  // Stable slug external callers (e.g. the mobile-app call-trigger API) reference instead of
  // the internal uuid, so template content/version can change without the caller changing.
  // Rows with an external_key set are addressed individually by key and are exempt from the
  // "only one active row per template_type" rule enforced in routes/instruction-templates.ts —
  // many purpose-specific external templates can be active at once (see external-calls.ts).
  externalKey: varchar('external_key', { length: 120 }),
});

export const agents = pgTable('agents', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull().default('agent'),
  phoneWhatsapp: varchar('phone_whatsapp', { length: 50 }),
  companyName: varchar('company_name', { length: 255 }),
  gender: varchar('gender', { length: 10 }).default('female'),
  tone: varchar('tone', { length: 20 }).default('neutral'),
  toneTemplateId: uuid('tone_template_id'),
  description: text('description'),
  enabled: integer('enabled').notNull().default(1),
  createdByUserId: integer('created_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  surname: varchar('surname', { length: 255 }).notNull(),
  fatherName: varchar('father_name', { length: 255 }),
  debtAmount: decimal('debt_amount', { precision: 10, scale: 2 }).notNull().default('0'),
  overdueDays: integer('overdue_days').notNull().default(0),
  daysDue: integer('days_due').notNull().default(0),
  phone: varchar('phone', { length: 50 }),
  organization: varchar('organization', { length: 255 }),
  contractNo: varchar('contract_no', { length: 120 }),
  sourceFullName: varchar('source_full_name', { length: 255 }),
  fin: varchar('fin', { length: 20 }),
  monthlyPayment: decimal('monthly_payment', { precision: 12, scale: 2 }),
  employeeCode: varchar('employee_code', { length: 100 }),
  reference: varchar('reference', { length: 255 }),
  branch: varchar('branch', { length: 255 }),
  category: varchar('category', { length: 100 }),
  pksStatus: varchar('pks_status', { length: 120 }),
  pksComment: text('pks_comment'),
  commentTemplateName: text('comment_template_name'),
  pksStatusCategory: varchar('pks_status_category', { length: 255 }),
  activeContractCount: integer('active_contract_count'),
  last3PaymentDates: text('last_3_payment_dates'),
  last3PaymentAmounts: text('last_3_payment_amounts'),
  totalPaidLast90Days: decimal('total_paid_last_90_days', { precision: 12, scale: 2 }),
  keptPromiseCount90d: integer('kept_promise_count_90d'),
  brokenPromiseCount90d: integer('broken_promise_count_90d'),
  collectorOrganization: varchar('collector_organization', { length: 255 }),
  sourceOrganization: varchar('source_organization', { length: 255 }),
  lastPaymentDate: date('last_payment_date'),
  lastPaymentAmount: decimal('last_payment_amount', { precision: 12, scale: 2 }),
  mobilePhone: varchar('mobile_phone', { length: 50 }),
  sourceSystem: varchar('source_system', { length: 40 }),
  sourceRecordKey: varchar('source_record_key', { length: 255 }),
  importedAt: timestamp('imported_at', { withTimezone: true }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  sourcePayloadHash: varchar('source_payload_hash', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const calls = pgTable('calls', {
  id: serial('id').primaryKey(),
  agentId: integer('agent_id').references(() => agents.id),
  customerId: integer('customer_id').references(() => customers.id),
  telephonyJobId: integer('telephony_job_id'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  durationSeconds: integer('duration_seconds'),
  transcript: text('transcript'),
  summary: text('summary'),
  description: text('description'),
  descriptionUpdatedAt: timestamp('description_updated_at', { withTimezone: true }),
});

export const telephonyJobs = pgTable('telephony_jobs', {
  id: serial('id').primaryKey(),
  agentId: integer('agent_id').notNull().references(() => agents.id),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  phone: varchar('phone', { length: 50 }).notNull(),
  outboundChannel: varchar('outbound_channel', { length: 40 }).notNull().default('provider'),
  trunkId: varchar('trunk_id', { length: 64 }),
  // Set directly by every job-creation call site (campaign-scheduler.ts, telephony.ts's
  // createTelephonyJob) — never inferred later by joining back to campaign_calls/
  // external_call_requests, which is what usage.ts used to do and got wrong whenever a
  // customer had calls from more than one source. One of 'campaign' | 'manual' | 'external_api'.
  source: varchar('source', { length: 20 }).notNull().default('manual'),
  // Set only when source = 'campaign'. Direct FK instead of the customer_id-based
  // campaign_calls join usage.ts previously relied on for per-campaign cost attribution.
  campaignId: integer('campaign_id').references(() => campaigns.id),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  workerId: varchar('worker_id', { length: 120 }),
  claimToken: varchar('claim_token', { length: 120 }),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  channelId: varchar('channel_id', { length: 180 }),
  // When set, this is the ONLY instruction template considered for the call (no fallback to
  // a campaign's or the global active base template) — see index.ts's /ws/gemini handler and
  // telephony.ts's GET /jobs/next pre-dial check. Used by the external call-trigger API so an
  // ad-hoc mobile-reminder call can never silently fall back to an unrelated (e.g. collections)
  // script. Jobs created by campaigns/manual-admin dialing leave this null and are unaffected.
  baseTemplateId: uuid('base_template_id'),
  // Free-form per-call text substituted into {DYNAMIC_CONTEXT} in the base template (e.g. which
  // onboarding step is missing, or which product is being offered). See template-variables.ts.
  dynamicContext: text('dynamic_context'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationSeconds: integer('duration_seconds'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Fire-and-poll PKS import jobs (see pks-import-jobs.ts). Created at startup via raw SQL
// in auth.ts ensureAuthSchema() — declared here purely so `drizzle-kit push` sees the table
// as known instead of proposing to drop it (same pattern as app_users/app_sessions below).
export const pksImportJobs = pgTable('pks_import_jobs', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).notNull().default('queued'), // queued | running | completed | failed
  request: jsonb('request').notNull(),
  result: jsonb('result'),
  totalPages: integer('total_pages'),
  pagesFetched: integer('pages_fetched').notNull().default(0),
  rowsFetched: integer('rows_fetched').notNull().default(0),
  customersCreated: integer('customers_created').notNull().default(0),
  customersUpdated: integer('customers_updated').notNull().default(0),
  attachedRows: integer('attached_rows').notNull().default(0),
  lastError: text('last_error'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiTokenUsage = pgTable('ai_token_usage', {
  id: serial('id').primaryKey(),
  provider: varchar('provider', { length: 40 }).notNull().default('gemini'),
  model: varchar('model', { length: 120 }).notNull(),
  operation: varchar('operation', { length: 80 }).notNull(),
  callId: integer('call_id').references(() => calls.id),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  candidateTokens: integer('candidate_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per external integration allowed to call the /api/external/v1 call-trigger API
// (e.g. a customer's mobile-app backend). Separate from TELEPHONY_WORKER_TOKEN (a single
// shared secret for the telephony worker) — this gives each caller its own identity, so a
// key can be revoked/rate-limited/audited independently. See api-auth.ts.
export const apiClients = pgTable('api_clients', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  keyHash: text('key_hash').notNull().unique(),
  webhookSecret: text('webhook_secret').notNull(),
  defaultAgentId: integer('default_agent_id').references(() => agents.id),
  defaultWebhookUrl: text('default_webhook_url'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
});

// Audit trail + idempotency ledger + webhook-dispatch source for calls triggered via the
// external call-trigger API. One row per accepted POST /api/external/v1/calls request.
export const externalCallRequests = pgTable('external_call_requests', {
  id: serial('id').primaryKey(),
  apiClientId: integer('api_client_id').notNull().references(() => apiClients.id),
  idempotencyKey: varchar('idempotency_key', { length: 200 }),
  telephonyJobId: integer('telephony_job_id').notNull().references(() => telephonyJobs.id),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  consentGiven: boolean('consent_given').notNull().default(false),
  consentTimestamp: timestamp('consent_timestamp', { withTimezone: true }),
  callbackUrl: text('callback_url'),
  // Cached copy of the telephony_jobs status, updated as the job progresses, so GET
  // /api/external/v1/calls/:id and rate-limit/idempotency lookups don't need a join.
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  failureReason: varchar('failure_reason', { length: 60 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// A registry of known "missing field" / offer codes external callers may pass as
// dynamicContext, instead of arbitrary free text — validated and resolved to a
// Robocall-authored phrase in the correct language/tone at request time. See
// routes/dynamic-context-codes.ts and routes/external-calls.ts. Deactivate rather than
// delete rows (same convention as instructionTemplates) — a resolved phrase is copied onto
// telephony_jobs.dynamic_context at request time, so removing a code here never orphans a
// past call's stored context.
export const dynamicContextCodes = pgTable('dynamic_context_codes', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  phrase: text('phrase').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// The following three tables are managed by auth.ts's ensureAuthSchema() via raw SQL
// (created/migrated at app startup), not via drizzle migrations. Declared here purely so
// `drizzle-kit push` sees them as known tables instead of proposing to drop them.
export const appUsers = pgTable('app_users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 80 }).notNull(),
  displayName: varchar('display_name', { length: 160 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 20 }).notNull().default('operator'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const appSessions = pgTable('app_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: integer('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  absoluteExpiresAt: timestamp('absolute_expires_at').notNull(),
});

// Unused by any current code path (superseded by app_sessions above) — kept as-is rather
// than dropped, since that's a data-owning decision for a human, not an automated push.
export const appUserSessions = pgTable('app_user_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
