# AI Agent Configuration & Setup

This guide walks you through configuring AI agents in the Callbot system, from initial setup to production deployment.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [AI API Configuration](#ai-api-configuration)
4. [Audio Setup](#audio-setup)
5. [Creating AI Agents](#creating-ai-agents)
6. [Integrating with Dialplan](#integrating-with-dialplan)
7. [Testing & Validation](#testing--validation)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Components
- **Callbot Backend** — Running and accessible
- **Asterisk Server** — With ARI (Asterisk REST Interface) enabled
- **AudioSocket** — Running for audio stream handling
- **AI Provider Account** — With active API key (Gemini, OpenAI, etc.)
- **Network Connectivity** — Between components and to AI provider

### Software Requirements
- Callbot v1.0+
- Asterisk 20+
- Node.js 18+

### Access Requirements
- Admin access to Callbot web interface
- SSH access to Asterisk server (for configuration validation)
- API credentials for your AI provider

---

## Initial Setup

### Step 1: Access the AI API Configuration Page

1. Log in to the Callbot web interface
2. Navigate to **Telephony → AI API** (in the left sidebar)
3. You'll see the AI API Configuration form

### Step 2: Configure Basic Settings

Fill in the following fields:

**Base URL**
```
https://generativelanguage.googleapis.com/v1beta
```
This is the endpoint for your AI provider (Gemini in this example).

**API Key**
```
AIzaSyDxxxxxxxxxxxxxxxxxxxxxxxxxx
```
Get this from your AI provider's dashboard. Keep it secure!

**Webhook Path** (optional)
```
/webhook/ai-events
```
Callbot will send event notifications to this path.

### Step 3: Configure Audio Settings

**AudioSocket Host**
```
localhost  (or your AudioSocket server IP)
```

**AudioSocket Port**
```
9090  (default port)
```

### Step 4: Configure Callbot Integration

**Callbot WebSocket URL**
```
ws://localhost:4000  (adjust port/host as needed)
```

**Callbot Agent ID** (optional)
```
my-callbot-instance-1
```

**Callbot Customer ID** (optional)
```
customer-001
```

### Step 5: Save Configuration

1. Click the **Save** button
2. Wait for success confirmation
3. The system will validate your credentials

### Step 6: Generate & Reload Configuration

1. Click the **🔄 Generate & Reload** button
2. This regenerates Asterisk configuration files
3. Asterisk is reloaded with new settings
4. Your AI infrastructure is now active

---

## AI API Configuration

### Configuration Fields Explained

#### Authentication

**API Key**
- **Type:** Secret string
- **Required:** Yes
- **How to Get:** From your AI provider dashboard
  - Gemini: Google Cloud Console → APIs & Services → Credentials
  - OpenAI: https://platform.openai.com/api-keys
  - Other: Consult provider documentation
- **Security:** Store in environment variables, not in code

#### Endpoints

**Base URL**
- **Type:** HTTPS URL
- **Required:** Yes
- **Examples:**
  - Gemini: `https://generativelanguage.googleapis.com/v1beta`
  - OpenAI: `https://api.openai.com/v1`
  - Azure: `https://{resource}.openai.azure.com/`
  - Local/Custom: `https://your-ai-server.com:8000`

**Webhook Path**
- **Type:** URL path
- **Required:** No
- **Purpose:** Receive event notifications
- **Example:** `/webhook/ai-events`
- **Events:** call-started, call-ended, handoff-triggered, error

#### Audio Configuration

**AudioSocket Host & Port**
- **Purpose:** Connect to audio streaming service
- **Host:** Hostname or IP of AudioSocket server
- **Port:** Typically 9090
- **Note:** AudioSocket is required for real-time audio streaming

#### Integration Points

**Callbot WebSocket URL**
- **Purpose:** Real-time communication with Callbot backend
- **Format:** `ws://host:port` or `wss://host:port` (secure)
- **Example:** `ws://localhost:4000`

**Callbot Agent ID & Customer ID**
- **Purpose:** Identify this instance in logs and analytics
- **Format:** Any unique string
- **Example:** `prod-ai-1`, `customer-acme`

#### Enable/Disable

**Enabled Checkbox**
- **Purpose:** Toggle AI functionality on/off globally
- **Use Case:** Quickly disable AI without reconfiguring everything
- **Note:** Check in UI, then Generate & Reload

---

## Audio Setup

### AudioSocket Configuration

AudioSocket is required for real-time audio streaming to AI providers.

#### Installation

AudioSocket is not a separate service — it's a TCP bridge built directly into the crmAI backend (`app/src/server.js`, `startAudioSocketBridge()`). It starts automatically with `crmAI-backend.service`; there's nothing extra to install or run.

#### Asterisk Integration

AudioSocket is configured via Asterisk dialplan:

```
[ai-agents]
exten => 1000,1,NoOp(AI Agent Handler)
    same => n,Answer()
    same => n,AudioSocket(ws://localhost:9090/audiostream)
    same => n,Hangup()
```

#### Audio Codec Selection

**Supported Codecs:**
- **ULAW** (μ-law) — Default, good compression, 8kHz
- **ALAW** (a-law) — Similar to ULAW, used in Europe
- **LINEAR16** — High quality, higher bandwidth, 16kHz
- **OPUS** — Modern codec, variable bitrate

**Recommendation:**
- Use **ULAW** for cost optimization
- Use **LINEAR16** for better quality (if bandwidth available)
- Use **OPUS** for modern providers with lower latency

### Sample Rate Configuration

- **8000 Hz** — Standard telephony, sufficient for voice
- **16000 Hz** — Higher quality, better for transcription

**Recommendation:** Use 8000 Hz for standard calls, 16000 Hz if transcription accuracy is critical.

---

## Creating AI Agents

### Via Web UI

#### Step 1: Navigate to Agents

1. Go to **Telephony → Agents** (or **Call Center → Agents**)
2. Click **+ Add Agent**
3. Select type: Choose **AI Agent**

#### Step 2: Configure Agent Details

**Agent Name**
```
Support Agent (or any descriptive name)
```

**Extension**
```
1000  (internal extension to reach this agent)
```

**Type**
```
AI  (or select from dropdown)
```

**Model**
```
gemini-2.0-flash  (choose based on your provider)
```

**System Prompt / Instructions**
```
You are a friendly customer support representative for Example Corp.
Your role is to:
1. Answer customer questions about our products and services
2. Help with basic troubleshooting
3. Collect customer information for followup
4. Escalate complex issues to human agents
5. Always be professional and helpful
```

**Settings (Optional)**
```json
{
  "temperature": 0.7,
  "max_tokens": 1024,
  "interruption_handling": "immediate",
  "silence_timeout_ms": 5000,
  "language": "en-US"
}
```

#### Step 3: Advanced Configuration (Optional)

**Knowledge Base** (if available)
```
Upload or reference documents this agent should know about
- Company FAQ
- Product documentation
- Troubleshooting guides
```

**Handoff Settings**
```
- Handoff Extension: 5000 (where to transfer when requesting human)
- Fallback Extension: 5001 (if handoff unavailable)
- Handoff Reason: Include reason in transfer note
```

**Monitoring & Alerts**
```
- Error Threshold: Trigger alert if >10% calls fail
- Performance Target: Resolve 80% of calls without escalation
- Alert Email: admin@example.com
```

#### Step 4: Save & Enable

1. Click **Save**
2. Enable the agent if not already enabled
3. Click **🔄 Generate & Reload** (required for changes to take effect)

### Via API

```bash
# Create an AI agent via REST API
curl -X POST http://localhost:8090/api/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "Support Agent",
    "extension": "1000",
    "type": "ai",
    "model": "gemini-2.0-flash",
    "instructions": "You are a helpful customer support agent...",
    "settings": {
      "temperature": 0.7,
      "max_tokens": 1024
    },
    "enabled": true
  }'
```

---

## Integrating with Dialplan

### Creating Dialplan Rules

#### Step 1: Access Dialplan Configuration

1. Go to **Telephony → Dialplan Rules**
2. Click **+ Add Rule**

#### Step 2: Configure Rule to Route to AI Agent

**Pattern**
```
^1[0-9]{3}$  (matches extensions 1000-1999)
```

**Priority**
```
1
```

**Route Type**
```
AI Agent  (select from dropdown)
```

**Route Target**
```
1000  (the AI agent extension you created)
```

**Description**
```
Route inbound to AI Support Agent
```

**Enabled**
```
✓ Checked
```

#### Step 3: Save & Generate

1. Click **Save**
2. Click **🔄 Generate & Reload**
3. Configuration is now active

### Advanced Routing

#### Pattern-Based Routing

```
Pattern: ^1234$           (exact extension)
Route Type: AI Agent
Route Target: billing-agent
Description: Billing inquiries
```

#### Time-Based Routing

```
Pattern: ^1XXX$
Route Type: IVR Menu
Route Target: business-hours-ivr  (contains routing logic)
```

Where the IVR menu contains:
- Business hours → Route to AI agent
- After hours → Route to voicemail

#### Priority-Based Routing

Configure multiple rules with different priorities:

```
Priority 1: ^SALES$ → Sales AI Agent
Priority 2: ^SUPPORT$ → Support AI Agent
Priority 3: ^.*$ → Default IVR Menu
```

---

## Testing & Validation

### Pre-Deployment Testing

#### Step 1: Verify API Connectivity

```bash
# Test AI API connectivity
curl -X POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent \
  -H "x-goog-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "parts": [{"text": "Hello"}]
    }]
  }'
```

Expected response: Valid JSON with generated content

#### Step 2: Test AudioSocket Connection

```bash
# Verify AudioSocket is running
telnet localhost 9090

# If successful, you'll see connection prompt
```

#### Step 3: Validate Asterisk Configuration

```bash
# SSH to Asterisk server
ssh asterisk-server

# Validate Asterisk configuration
asterisk -n -x "core show config parsed"

# Check if AudioSocket module is loaded
asterisk -n -x "module show like audiostream"

# Reload dialplan if changes made
asterisk -n -x "dialplan reload"
```

### Test Calls

#### Step 1: Initiate Test Call

1. From the Callbot UI, go to **Calls → Initiate Call**
2. Create a test call to your AI agent's extension
3. OR: Dial the extension from a connected phone

#### Step 2: Observe Call Flow

- **Call connects** → AI agent answers
- **Silence detection** → Agent starts listening
- **You speak** → Audio captured and sent to AI provider
- **Agent responds** → Response played back to you
- **Conversation continues** → Multiple turn exchanges

#### Step 3: Check Logs

```bash
# View Asterisk logs in real-time
sudo journalctl -u asterisk -f

# Or on server:
tail -f /var/log/asterisk/messages
```

### Validation Checklist

- [ ] API key is valid and working
- [ ] AudioSocket service is running
- [ ] Agent extension routes correctly
- [ ] Audio is captured and transmitted
- [ ] AI provider responds correctly
- [ ] Response audio is played back
- [ ] Call recording captures both sides
- [ ] Transcription is generated
- [ ] Agent can handle multiple turns
- [ ] Handoff to human works (if configured)

---

## Troubleshooting

### Common Issues

#### Issue: "No AI API key configured"

**Cause:** API key not saved in configuration

**Solution:**
1. Go to **Telephony → AI API**
2. Enter valid API key
3. Click **Save**
4. Click **🔄 Generate & Reload**

#### Issue: AudioSocket connection refused

**Cause:** AudioSocket not running or wrong host/port

**Solution:**
```bash
# AudioSocket is built into the crmAI backend — check that service instead
sudo systemctl status crmAI-backend
sudo journalctl -u crmAI-backend -f

# Verify in Callbot UI settings
# Check: AudioSocket Host = localhost (or correct IP)
# Check: AudioSocket Port matches CALLBOT_AUDIOSOCKET_PORT in app/.env
```

#### Issue: "No audio received from caller"

**Cause:** Asterisk AudioSocket configuration or codec mismatch

**Solution:**
1. Verify AudioSocket module loaded in Asterisk
2. Check dialplan includes `AudioSocket()` application
3. Verify codec settings match between Asterisk and AudioSocket
4. Check firewall allows traffic on port 9090

#### Issue: Agent responds slowly or times out

**Cause:** API latency or model selection

**Solution:**
1. Try a faster model (gemini-2.0-flash instead of gemini-1.5-pro)
2. Check network latency to AI provider
3. Reduce `max_tokens` in agent settings
4. Monitor API usage to avoid rate limiting

#### Issue: Transcription contains errors

**Cause:** Audio quality or language/accent issues

**Solution:**
1. Use LINEAR16 codec for better quality
2. Increase sample rate to 16000 Hz
3. Add domain-specific terms to agent knowledge base
4. Consider using acoustic model for better accent support

#### Issue: Agent not responding to user input

**Cause:** Silence detection timeout or agent instructions issue

**Solution:**
1. Increase `silence_timeout_ms` in agent settings
2. Review agent instructions for issues
3. Add more context to system prompt
4. Test with simpler prompts first

### Debug Mode

Enable debug logging for troubleshooting:

**In Asterisk:**
```bash
asterisk -n -x "core set debug 10"
asterisk -n -x "core set verbose 10"
```

**In Callbot Backend:**
Set environment variable:
```
DEBUG=callbot:*
```

**In `crmAI-backend.service` / `.env`:** add `Environment="DEBUG=callbot:*"` to `config/crmAI-backend.service` (or set `DEBUG=callbot:*` in the backend's `.env`), then `sudo systemctl daemon-reload && sudo systemctl restart crmAI-backend`.

### Monitoring

#### Key Metrics to Monitor

- **Call Success Rate** — Percentage of calls completed successfully
- **Average Call Duration** — Mean duration of AI agent calls
- **Handoff Rate** — Percentage of calls transferred to humans
- **API Response Time** — Latency from AI provider
- **Error Rate** — Percentage of failed calls

#### Log Files

```
Asterisk:    sudo journalctl -u asterisk
Callbot:     sudo journalctl -u callbot-backend
crmAI (AudioSocket): sudo journalctl -u crmAI-backend
AI Provider: Check provider's dashboard
```

---

## Production Deployment Checklist

- [ ] All credentials secured in environment variables
- [ ] API rate limits understood and monitored
- [ ] Backup AI provider configured (fallback)
- [ ] Call recording enabled for compliance
- [ ] Monitoring and alerting configured
- [ ] Load testing completed
- [ ] Failover procedures documented
- [ ] Staff trained on agent management
- [ ] Backup and recovery procedures in place
- [ ] Legal/compliance review completed

---

## Next Steps

- **Test Your Setup** — Follow the Testing & Validation section
- **Create More Agents** — Set up multiple agents for different purposes
- **Monitor Performance** — Use Statistics page to track metrics
- **Iterate & Improve** — Review calls and refine agent instructions

See [User Guide](./user-guide.md) for managing agents through the UI.
