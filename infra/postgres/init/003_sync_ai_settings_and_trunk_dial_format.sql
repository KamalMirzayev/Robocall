-- Run this against the robocall_crm database (e.g. in pgAdmin, connected to crm_ai)
-- to bring an already-provisioned server's DB in line with the ai_settings /
-- sip_trunks changes made in app/src/server.js. Idempotent — safe to run
-- more than once. Mirrors what ensureSchema() in server.js now runs on
-- every crmAI-backend boot, so this is only needed if you want it applied
-- immediately without restarting that service.

BEGIN;

-- 1. ai_settings: make sure all columns this code expects exist
--    (older schemas may predate some of these).
ALTER TABLE ai_settings
  ADD COLUMN IF NOT EXISTS callbot_ws_url TEXT NOT NULL DEFAULT 'wss://api.robocall.az/ws/gemini',
  ADD COLUMN IF NOT EXISTS callbot_agent_id INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS callbot_customer_id INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS audiosocket_host TEXT NOT NULL DEFAULT '127.0.0.1',
  ADD COLUMN IF NOT EXISTS audiosocket_port INTEGER NOT NULL DEFAULT 10000;

-- 2. ai_settings: seed the id=1 row if it's missing. Without this row,
--    startCallbotAriCall() reads ai?.enabled as undefined and silently
--    hangs up every answered call with no log line. enabled=false is the
--    safe default — an operator must explicitly enable it and set the
--    real base_url / callbot_ws_url / api_key via the AI API settings page.
INSERT INTO ai_settings (id, enabled) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- 3. sip_trunks: per-trunk outbound dial format (local 0XXXXXXXXX vs
--    international 994XXXXXXXXX), replacing the old single global
--    CALLBOT_PROVIDER_DIAL_FORMAT env var that couldn't differ per trunk.
ALTER TABLE sip_trunks
  ADD COLUMN IF NOT EXISTS dial_format TEXT NOT NULL DEFAULT 'local';

COMMIT;

-- After running this, check the current state:
-- SELECT id, base_url, callbot_ws_url, enabled FROM ai_settings;
-- SELECT id, name, trunk_type, dial_format FROM sip_trunks;
--
-- If ai_settings.enabled is false or base_url/callbot_ws_url are still
-- placeholders, set the real values via Telephony -> AI API in the UI
-- (or UPDATE ai_settings ... WHERE id=1 directly) before expecting calls
-- to reach the bot. Same for any trunk that needs dial_format = 'intl'.
