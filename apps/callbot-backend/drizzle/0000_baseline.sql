CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'agent' NOT NULL,
	"phone_whatsapp" varchar(50),
	"company_name" varchar(255),
	"gender" varchar(10) DEFAULT 'female',
	"tone" varchar(20) DEFAULT 'neutral',
	"tone_template_id" uuid,
	"description" text,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_token_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(40) DEFAULT 'gemini' NOT NULL,
	"model" varchar(120) NOT NULL,
	"operation" varchar(80) NOT NULL,
	"call_id" integer,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"candidate_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer,
	"customer_id" integer,
	"telephony_job_id" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"transcript" text,
	"summary" text,
	"description" text,
	"description_updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaign_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempt_number" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"retry_interval_hours" integer DEFAULT 24 NOT NULL,
	"order_by_monthly_payment_desc" boolean DEFAULT false NOT NULL,
	"skip_next_day_after_success" boolean DEFAULT false NOT NULL,
	"run_weekdays" varchar(50) DEFAULT '',
	"run_window_start" varchar(10) DEFAULT '09:00',
	"run_window_end" varchar(10) DEFAULT '19:00',
	"run_start_date" date,
	"run_end_date" date,
	"base_template_id" uuid,
	"agent_id" integer,
	"trunk_id" varchar(64),
	"total_customers" integer DEFAULT 0 NOT NULL,
	"completed_calls" integer DEFAULT 0 NOT NULL,
	"successful_calls" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"surname" varchar(255) NOT NULL,
	"father_name" varchar(255),
	"debt_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"overdue_days" integer DEFAULT 0 NOT NULL,
	"days_due" integer DEFAULT 0 NOT NULL,
	"phone" varchar(50),
	"organization" varchar(255),
	"contract_no" varchar(120),
	"source_full_name" varchar(255),
	"fin" varchar(20),
	"monthly_payment" numeric(12, 2),
	"employee_code" varchar(100),
	"reference" varchar(255),
	"branch" varchar(255),
	"category" varchar(100),
	"pks_status" varchar(120),
	"pks_comment" text,
	"comment_template_name" text,
	"pks_status_category" varchar(255),
	"active_contract_count" integer,
	"last_3_payment_dates" text,
	"last_3_payment_amounts" text,
	"total_paid_last_90_days" numeric(12, 2),
	"kept_promise_count_90d" integer,
	"broken_promise_count_90d" integer,
	"collector_organization" varchar(255),
	"source_organization" varchar(255),
	"last_payment_date" date,
	"last_payment_amount" numeric(12, 2),
	"mobile_phone" varchar(50),
	"source_system" varchar(40),
	"source_record_key" varchar(255),
	"imported_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"source_payload_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruction_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(50) DEFAULT 'default' NOT NULL,
	"version" varchar(50) DEFAULT 'v1' NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"content" text NOT NULL,
	"template_type" varchar(50) DEFAULT 'base' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(255),
	"customer_category" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "telephony_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"phone" varchar(50) NOT NULL,
	"outbound_channel" varchar(40) DEFAULT 'provider' NOT NULL,
	"trunk_id" varchar(64),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"worker_id" varchar(120),
	"claim_token" varchar(120),
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"channel_id" varchar(180),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_seconds" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_token_usage" ADD CONSTRAINT "ai_token_usage_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_calls" ADD CONSTRAINT "campaign_calls_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_calls" ADD CONSTRAINT "campaign_calls_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telephony_jobs" ADD CONSTRAINT "telephony_jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telephony_jobs" ADD CONSTRAINT "telephony_jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;