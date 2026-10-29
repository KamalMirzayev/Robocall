-- Create robocall_crm database and schema
-- This script runs during PostgreSQL initialization

-- Abort immediately on any error. Critically, this makes a failed "\c robocall_crm"
-- stop the script instead of silently continuing on the previous (callbot)
-- connection and creating the CRM config tables in the wrong database.
\set ON_ERROR_STOP on

-- Create the robocall_crm database (idempotent: skip if it already exists)
SELECT 'CREATE DATABASE robocall_crm WITH ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'robocall_crm')
\gexec

-- Grant privileges to callbot user
GRANT ALL PRIVILEGES ON DATABASE robocall_crm TO callbot;

-- Connect to robocall_crm database to create schema
\c robocall_crm callbot

-- Safety guard: refuse to create the CRM config tables anywhere but robocall_crm.
DO $$
BEGIN
  IF current_database() <> 'robocall_crm' THEN
    RAISE EXCEPTION 'Expected to be connected to robocall_crm, but got %', current_database();
  END IF;
END
$$;

-- Create required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- AI Settings table
CREATE TABLE IF NOT EXISTS public.ai_settings (
    id integer DEFAULT 1 NOT NULL PRIMARY KEY,
    base_url text DEFAULT 'http://127.0.0.1:4000'::text NOT NULL,
    api_key text DEFAULT ''::text NOT NULL,
    webhook_path text DEFAULT '/api/telephony/webhook'::text NOT NULL,
    handoff_extension text DEFAULT ''::text NOT NULL,
    callbot_ws_url text DEFAULT 'ws://127.0.0.1:4000/ws/gemini'::text NOT NULL,
    callbot_agent_id integer DEFAULT 1 NOT NULL,
    callbot_customer_id integer DEFAULT 1 NOT NULL,
    audiosocket_host text DEFAULT '127.0.0.1'::text NOT NULL,
    audiosocket_port integer DEFAULT 10000 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_settings_id_check CHECK ((id = 1))
);

-- Seed row: without this, the table exists but is empty, and
-- startCallbotAriCall() in app/src/server.js silently deletes every
-- answered channel with no log line (ai_settings.enabled reads as
-- undefined/false). enabled=false here is the safe default; an operator
-- must explicitly turn it on (and set real base_url/callbot_ws_url/api_key)
-- via the AI API settings page.
INSERT INTO public.ai_settings (id, enabled) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- CRM Admin Auth table
CREATE TABLE IF NOT EXISTS public.crm_admin_auth (
    id integer DEFAULT 1 NOT NULL PRIMARY KEY,
    username text DEFAULT 'admin'::text NOT NULL,
    password_hash text DEFAULT ''::text NOT NULL,
    session_version integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_admin_auth_id_check CHECK ((id = 1))
);

-- SIP Accounts table
CREATE TABLE IF NOT EXISTS public.sip_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name text NOT NULL,
    extension text NOT NULL UNIQUE,
    secret text NOT NULL,
    account_type text NOT NULL CHECK (account_type IN ('local', 'public')),
    caller_id text DEFAULT ''::text NOT NULL,
    host text DEFAULT 'dynamic'::text NOT NULL,
    transport text DEFAULT 'udp'::text NOT NULL,
    context text DEFAULT 'from-internal'::text NOT NULL,
    codecs text DEFAULT 'ulaw,alaw'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- SIP Trunks table
CREATE TABLE IF NOT EXISTS public.sip_trunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name text NOT NULL,
    trunk_type text NOT NULL CHECK (trunk_type IN ('gsm_gateway', 'provider', 'peer')),
    host text NOT NULL,
    port integer DEFAULT 5060 NOT NULL,
    username text DEFAULT ''::text NOT NULL,
    secret text DEFAULT ''::text NOT NULL,
    from_user text DEFAULT ''::text NOT NULL,
    from_domain text DEFAULT ''::text NOT NULL,
    inbound_context text DEFAULT 'from-trunk'::text NOT NULL,
    outbound_prefix text DEFAULT ''::text NOT NULL,
    codecs text DEFAULT 'ulaw,alaw'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- IVR Menus table
CREATE TABLE IF NOT EXISTS public.ivr_menus (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name text NOT NULL,
    extension text NOT NULL UNIQUE,
    prompt text DEFAULT 'demo-congrats'::text NOT NULL,
    timeout_seconds integer DEFAULT 5 NOT NULL,
    invalid_target text DEFAULT 'hangup'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- IVR Options table (menu choices)
CREATE TABLE IF NOT EXISTS public.ivr_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    ivr_id uuid NOT NULL REFERENCES public.ivr_menus(id) ON DELETE CASCADE,
    digit text NOT NULL,
    target_type text NOT NULL CHECK (target_type IN ('extension', 'ivr', 'ai_agent', 'hangup')),
    target text DEFAULT ''::text NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    UNIQUE(ivr_id, digit)
);

-- Dialplan Rules table
CREATE TABLE IF NOT EXISTS public.dialplan_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    priority integer DEFAULT 100 NOT NULL,
    pattern text NOT NULL,
    route_type text NOT NULL CHECK (route_type IN ('extension', 'trunk', 'ivr', 'ai_agent', 'hangup')),
    route_target text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create indexes for performance (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_dialplan_rules_pattern ON public.dialplan_rules(pattern);
CREATE INDEX IF NOT EXISTS idx_dialplan_rules_priority ON public.dialplan_rules(priority);
CREATE INDEX IF NOT EXISTS idx_ivr_menus_extension ON public.ivr_menus(extension);
CREATE INDEX IF NOT EXISTS idx_sip_accounts_extension ON public.sip_accounts(extension);



