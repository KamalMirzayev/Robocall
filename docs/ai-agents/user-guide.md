# AI Agent User Guide

This guide shows how to create, configure, and manage AI agents using the Callbot web interface.

## Table of Contents
1. [Getting Started](#getting-started)
2. [Accessing AI Agent Features](#accessing-ai-agent-features)
3. [Creating an AI Agent](#creating-an-ai-agent)
4. [Managing Agents](#managing-agents)
5. [Viewing Call Analytics](#viewing-call-analytics)
6. [Integration with Call Routing](#integration-with-call-routing)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Prerequisites
- Admin access to Callbot web interface
- AI API configured (see [Configuration & Setup](./configuration.md))
- At least one AI provider account active (Gemini, OpenAI, etc.)

### Initial Setup
Before creating agents, ensure your AI API is configured:
1. Go to **Telephony → AI API**
2. Fill in all required fields (Base URL, API Key, AudioSocket settings)
3. Click **Save**
4. Click **🔄 Generate & Reload**

---

## Accessing AI Agent Features

### Web Interface Navigation

From the main dashboard, locate the left sidebar menu:

```
┌─────────────────────────┐
│ Callbot Dashboard       │
├─────────────────────────┤
│ Dashboard               │ ← Overview statistics
│ Call Management         │
│   ├─ Live Calls         │ ← Active calls
│   ├─ Call History       │ ← Past calls
│   └─ Initiate Call      │ ← Make outbound calls
│ Call Center             │
│   ├─ Agents             │ ← Create/manage agents (AI & Human)
│   ├─ Customers          │ ← Manage customer contacts
│   └─ Recordings         │ ← View call recordings
│ Telephony               │
│   ├─ SIP Accounts       │ ← Account configuration
│   ├─ SIP Trunks         │ ← Trunk configuration
│   ├─ IVR Menus          │ ← Menu configuration
│   ├─ Dialplan Rules     │ ← Routing configuration
│   ├─ Statistics         │ ← System statistics
│   └─ AI API Config      │ ← AI provider settings ✨
└─────────────────────────┘
```

### Quick Access
- **Create AI Agent:** Call Center → Agents → "Add Agent"
- **View AI Calls:** Call Management → Call History → Filter by agent
- **Agent Statistics:** Telephony → Statistics
- **AI Configuration:** Telephony → AI API Config

---

## Creating an AI Agent

### Step 1: Navigate to Agents

1. Click **Call Center** in the sidebar
2. Click **Agents**
3. Click **+ Add Agent** button (top right)

### Step 2: Select Agent Type

A dialog appears with options:

```
Select Agent Type:
  ○ Human Agent
  ○ AI Agent ← Select this
  ○ Bot (IVR)
```

Select **AI Agent**.

### Step 3: Fill in Basic Information

**Agent Name**
- **Field:** Text input
- **Example:** "Support Agent", "Billing Support", "Sales Team"
- **Best Practice:** Use descriptive names
- **Required:** Yes

**Extension**
- **Field:** Numeric input (4 digits)
- **Example:** 1000, 1001, 1234
- **Note:** This is the internal extension to reach the agent
- **Required:** Yes
- **Must be unique:** Yes

**Model**
- **Field:** Dropdown menu
- **Options:** Varies based on your AI provider
  - Gemini: gemini-2.0-flash, gemini-1.5-pro, etc.
  - OpenAI: gpt-4, gpt-3.5-turbo, etc.
  - Custom: Your custom models if available
- **Default:** gemini-2.0-flash (fastest)
- **Required:** Yes

### Step 4: Define Agent Behavior

**System Instructions / Prompt**
- **Field:** Large text area
- **Purpose:** Define how the agent behaves
- **Example:**
  ```
  You are a friendly customer support representative for Example Corp.
  
  Your responsibilities:
  1. Answer questions about products and services
  2. Help with basic troubleshooting
  3. Collect customer information
  4. Escalate complex issues to a human agent
  
  Always be professional, empathetic, and solution-focused.
  If you cannot help, offer to transfer to a human representative.
  
  Key Information:
  - Business hours: Mon-Fri 9am-5pm EST
  - For urgent issues, press 0 to speak with an agent immediately
  ```
- **Formatting Tips:**
  - Use numbered lists for tasks
  - Break into paragraphs for clarity
  - Be specific about constraints and preferences
  - Include guardrails (what not to do)
- **Required:** Yes

### Step 5: Advanced Settings (Optional)

Click **Show Advanced Options** to reveal:

**Temperature**
- **Range:** 0.0 (deterministic) to 2.0 (random)
- **Default:** 0.7
- **Use Case:**
  - **Low (0.0-0.3):** Factual responses (FAQ, tech support)
  - **Medium (0.5-0.9):** Balanced (general customer service)
  - **High (1.2-2.0):** Creative responses (brainstorming, suggestions)

**Max Tokens**
- **Range:** 256 to 4096
- **Default:** 1024
- **Note:** Limits response length; higher = longer responses but higher latency

**Silence Timeout**
- **Range:** 1000 to 30000 milliseconds
- **Default:** 5000 (5 seconds)
- **Use Case:** How long agent waits for caller input before assuming silence

**Language**
- **Options:** en-US, es-ES, fr-FR, de-DE, etc.
- **Default:** en-US
- **Note:** Affects speech recognition and text generation

**Enabled**
- **Default:** ✓ Checked
- **Note:** Uncheck to disable agent without deleting it

### Step 6: Save Agent

1. Review all settings
2. Click **Save** button
3. Wait for success message

### Step 7: Generate & Reload (Important!)

After creating the agent, regenerate Asterisk configuration:

1. Navigate to **Telephony → Agents** or stay on current page
2. Click **🔄 Generate & Reload** button (purple, with refresh icon)
3. Wait for success message: "Asterisk configuration generated and reloaded"

Without this step, the agent won't be reachable.

---

## Managing Agents

### View All Agents

Go to **Call Center → Agents** to see a table with all agents:

| Name | Extension | Type | Status | Calls (24h) | Avg Duration | Last Activity |
|------|-----------|------|--------|-----------|--------------|---|
| Support Agent | 1000 | AI | Enabled ✓ | 42 | 3m 30s | 5 mins ago |
| Billing Support | 1001 | AI | Enabled ✓ | 28 | 2m 45s | 15 mins ago |
| Sales | 1002 | Human | Enabled ✓ | 12 | 8m 15s | 2 hours ago |

### Edit Agent

**To edit an agent:**

1. Click the agent name or **Edit** button
2. Modify any fields
3. Click **Save**
4. Navigate to **Telephony** and click **Generate & Reload**

**What can be edited:**
- ✅ Name
- ✅ System instructions
- ✅ Model
- ✅ Settings (temperature, max tokens, etc.)
- ✅ Enabled status

**What cannot be edited after creation:**
- ❌ Extension (delete and recreate to change)
- ❌ Type (human → AI requires deletion)

### Enable/Disable Agent

**Quick Toggle:**
1. In the agents table, find the agent
2. Click the **Enabled/Disabled** toggle
3. Click **Generate & Reload**

**Benefit:** Disable agents temporarily without deleting them

### Delete Agent

**To delete an agent:**

1. Click the agent row
2. Click **Delete** button (red, trash icon)
3. Confirm deletion in popup
4. Click **Generate & Reload**

**Warning:** Deleting is permanent. All agent configurations are lost.

---

## Viewing Call Analytics

### Statistics Dashboard

Go to **Telephony → Statistics** to see system-wide metrics:

```
┌─────────────────────────────────────┐
│ Telephony Configuration             │
├─────────────────────────────────────┤
│ SIP Accounts: 2  │  Trunks: 3       │
│ IVR Menus: 4    │  Dialplan: 8     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Call Center                         │
├─────────────────────────────────────┤
│ Total Calls: 142  │ Active: 5       │
│ Completed: 137    │ Recordings: 98  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Resources                           │
├─────────────────────────────────────┤
│ Agents (7) - 3 Active              │
│ Customers (45) - 12 Active         │
└─────────────────────────────────────┘
```

### Agent-Specific Statistics

**View individual agent performance:**

1. Go to **Call Center → Agents**
2. Click on an agent
3. Scroll to "Performance" section

**Metrics displayed:**
- **Total Calls (24h):** Number of calls handled
- **Average Duration:** Mean call length
- **Success Rate:** % of calls resolved without escalation
- **Handoff Rate:** % of calls transferred to humans
- **Last Activity:** When agent was last active
- **Trend:** Showing improvement/decline

### Call History

View all calls handled by AI agents:

1. Go to **Call Management → Call History**
2. Filter by:
   - **Date Range:** Today, This Week, This Month, Custom
   - **Agent Type:** AI Agent, Human Agent, IVR
   - **Status:** Active, Completed, Failed
3. Click on a call to view details

**Call Details Include:**
- Call duration and timestamp
- Agent and customer information
- Full transcript of conversation
- Recording link
- Auto-generated summary
- Customer sentiment analysis

### Viewing Call Recordings

Access recorded calls:

1. Go to **Call Management → Recordings**
2. Search by:
   - Date range
   - Agent name
   - Customer name
   - Call duration
3. Click recording to:
   - Play audio
   - View transcript
   - Download recording
   - Export transcript

---

## Integration with Call Routing

### Creating a Dialplan Rule to Route to AI Agent

Once you've created an AI agent, route calls to it using dialplan rules:

#### Step 1: Go to Dialplan Configuration

1. Click **Telephony → Dialplan Rules**
2. Click **+ Add Rule**

#### Step 2: Configure Routing

**Pattern**
```
^1[0-9]{3}$     (matches extensions 1000-1999)
or
^SUPPORT$       (matches the word "support")
or
^.*$            (matches any extension - use for catch-all)
```

**Priority**
```
1  (higher priority rules execute first)
```

**Route Type**
```
Select "AI Agent" from dropdown
```

**Route Target**
```
1000  (the extension of your AI agent)
```

**Description**
```
Route support calls to AI support agent
```

#### Step 3: Save & Deploy

1. Click **Save**
2. Navigate back to **Telephony**
3. Click **🔄 Generate & Reload**

#### Step 4: Test

1. Dial the pattern from a phone (e.g., extension 1000)
2. Agent should answer
3. Converse with agent
4. Check call history

### Example Routing Scenarios

**Scenario 1: All support calls to AI agent**
```
Pattern: ^SUPPORT$
Route Type: AI Agent
Route Target: 1000 (Support Agent)
```

**Scenario 2: Sales qualification with AI**
```
Pattern: ^SALES$
Route Type: AI Agent
Route Target: 1001 (Sales Qualifier)
```

**Scenario 3: After-hours IVR with AI fallback**
```
Pattern: ^1[0-9]{3}$
Route Type: IVR Menu
Route Target: business-hours-ivr
(IVR menu contains logic to route to AI agent after hours)
```

---

## Best Practices

### Agent Design

✅ **Do:**
- Create specific agents for specific purposes
- Use clear, descriptive names
- Write detailed system prompts (2-3 paragraphs minimum)
- Test thoroughly before production
- Monitor performance regularly

❌ **Don't:**
- Create one generic "agent" for all purposes
- Use vague instructions
- Deploy without testing
- Ignore call failures
- Set temperature too high (results in unpredictable behavior)

### System Prompts

**Good Example:**
```
You are Sarah, a friendly billing support specialist for Example Corp.
Your primary role is to:
1. Help customers understand their invoices and charges
2. Process payment arrangements
3. Answer questions about billing policies
4. Escalate disputes to the billing manager

Always maintain a professional yet warm tone. If a customer is upset, 
acknowledge their frustration and show empathy. For complex issues beyond 
your scope (technical billing errors, fraud), immediately offer to transfer 
to a human specialist at extension 5000.

Key facts you should know:
- We offer 30-day payment terms for business customers
- Late fees are 1.5% per month
- We accept credit cards, ACH, and wire transfers
- Peak support hours are 9am-5pm EST Mon-Fri
```

**Poor Example:**
```
You are a support agent.
Help customers with questions.
Transfer to 5000 if needed.
```

### Monitoring & Improvement

1. **Review Calls Weekly:** Listen to 5-10 recent calls
2. **Identify Patterns:** What causes escalations or failures?
3. **Refine Instructions:** Update system prompt based on learnings
4. **Test Changes:** Validate updated agent behavior
5. **Track Metrics:** Monitor success rate, handoff rate, sentiment

### Security Best Practices

- Keep API keys secure (use environment variables)
- Don't share agent credentials with non-admin users
- Rotate API keys regularly (monthly recommended)
- Enable audit logging in Callbot settings
- Comply with data retention policies (GDPR, CCPA, etc.)

---

## Troubleshooting

### Common Issues

#### Agent doesn't answer calls

**Problem:** Calls to agent extension go unanswered

**Solutions:**
1. Verify agent is enabled
   - Go to **Agents**, check if agent has green "Enabled" badge
2. Verify AI API is configured
   - Go to **Telephony → AI API**, ensure all fields are filled
3. Verify AudioSocket is running
   - AudioSocket is built into the crmAI backend: `sudo systemctl status crmAI-backend`
4. Regenerate configuration
   - Go to **Telephony**, click **🔄 Generate & Reload**
5. Check Asterisk logs
   - Run: `sudo journalctl -u asterisk -n 50`

#### Agent responds but doesn't understand

**Problem:** Agent gives irrelevant or nonsensical responses

**Solutions:**
1. Review system prompt
   - Go to agent settings, review instructions for clarity
2. Lower temperature
   - Go to Advanced Settings, reduce temperature (e.g., 0.7 → 0.5)
3. Add more context
   - Expand system prompt with specific examples
4. Test with simpler requests
   - Ensure agent handles basic queries first
5. Check API connectivity
   - Test connection to AI provider (see Configuration guide)

#### Calls drop or disconnect unexpectedly

**Problem:** Agent calls disconnect mid-conversation

**Solutions:**
1. Check AudioSocket logs
   - AudioSocket runs inside the crmAI backend: `sudo journalctl -u crmAI-backend -n 50`
2. Verify network connectivity
   - Test latency to AI provider
   - Check firewall rules for port 9090
3. Review silence timeout
   - If agent timeout too low, may disconnect prematurely
   - Go to agent settings, increase `silenceTimeoutMs`
4. Check API rate limits
   - May be hitting rate limit from AI provider
   - See API documentation for rate limit information

#### Call recordings are empty or missing

**Problem:** Calls complete but recording is missing or has no audio

**Solutions:**
1. Verify recording is enabled
   - Check backend configuration
2. Verify AudioSocket is capturing audio
   - Monitor AudioSocket logs during call
3. Check storage permissions
   - Ensure recordings directory is writable
4. Verify call completed successfully
   - Check call status in call history

#### "Generate & Reload" fails with error

**Problem:** Clicking "Generate & Reload" shows error message

**Solutions:**
1. Check error message details
   - Usually indicates configuration issue
2. Verify Asterisk is running
   - Run: `sudo systemctl status asterisk`
3. Review recent configuration changes
   - Dialplan syntax errors are common
4. Check backend logs
   - Run: `sudo journalctl -u callbot-backend -n 50`
5. Restart services if needed
   - `sudo systemctl restart callbot-backend asterisk`

### Getting Help

If issues persist:

1. **Check Logs:**
   ```bash
   sudo journalctl -u callbot-backend -f
   sudo journalctl -u asterisk -f
   sudo journalctl -u crmAI-backend -f   # AudioSocket runs inside this service
   ```

2. **Review Configuration:**
   - Go to **Telephony → AI API** and verify all settings
   - Go to **Telephony → Agents** and verify agent is enabled

3. **Test Manually:**
   - Use cURL or API client to test endpoints
   - See [API Documentation](./api.md) for examples

4. **Contact Support:**
   - Email: support@example.com
   - Include logs and error messages

---

## Advanced Topics

### Custom Knowledge Bases

Some AI providers support custom knowledge bases. To use:

1. Prepare documents (FAQ, policies, product info)
2. Upload to your AI provider's dashboard
3. Reference in agent system prompt:
   ```
   You have access to our FAQ and product documentation.
   Use this information to answer customer questions accurately.
   ```

### Multi-Language Support

For multilingual agents:

1. Create separate agents for each language
2. Set language in agent settings
3. Translate system prompts
4. Route calls based on caller's language preference

### Advanced Handoff

For sophisticated handoff logic:

1. Create IVR menu with handoff decision logic
2. Route from AI agent to IVR based on conditions
3. IVR routes to appropriate human agent

---

## Next Steps

- Review [Configuration & Setup](./configuration.md) for detailed setup instructions
- See [Features Overview](./features.md) for advanced capabilities
- Check [API Documentation](./api.md) for programmatic access
