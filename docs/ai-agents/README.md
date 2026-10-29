# AI Agents Documentation

Welcome to the AI Agents documentation. This directory contains comprehensive guides for understanding, configuring, and using AI agents in the Callbot system.

## 📚 Documentation Index

### [Features Overview](./features.md)
Learn about AI agent capabilities, features, and use cases in call automation and handling.

### [Configuration & Setup](./configuration.md)
Step-by-step guide to configure AI agents, set up webhooks, and integrate with Callbot.

### [API Documentation](./api.md)
Complete REST API reference for AI agent endpoints, including request/response examples.

### [User Guide](./user-guide.md)
How to create, manage, and deploy AI agents through the web UI.

### [Databases: Separation of Concerns](./databases.md)
How the `callbot` and `crm_ai` databases divide responsibility, which app owns which tables, and the rule against cross-database duplicates.

---

## Quick Start

1. **Configure AI API** — Start in the [Configuration & Setup](./configuration.md) guide to set up your AI provider connection
2. **Create an Agent** — Follow the [User Guide](./user-guide.md) to create your first AI agent
3. **Integrate with Calls** — Use [API Documentation](./api.md) to integrate agents into your call flows
4. **Explore Features** — Review [Features Overview](./features.md) to understand all capabilities

---

## System Overview

AI agents in Callbot are intelligent virtual assistants that handle:
- **Inbound call routing** — Route calls to AI agents based on dialplan rules
- **Customer interactions** — Handle customer inquiries, support requests, IVR navigation
- **Call transcription & analysis** — Transcribe and analyze call audio in real-time
- **Multi-turn conversations** — Maintain context across multiple conversation turns
- **Handoff to humans** — Seamlessly transfer calls to human agents when needed
- **Call recording & summaries** — Generate call summaries and store recordings

### Architecture

```
┌─────────────┐
│ Incoming    │
│ Call        │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ Dialplan        │
│ Routes to AI    │
└──────┬──────────┘
       │
       ▼
┌──────────────────────────────┐
│ AI Agent Handler             │
│ - Receives audio stream      │
│ - Forwards to AI Provider    │
│ - Handles responses          │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ External AI Provider         │
│ - Gemini / OpenAI / etc      │
│ - Speech-to-Text             │
│ - LLM Processing             │
│ - Text-to-Speech             │
└──────────────────────────────┘
```

---

## Key Concepts

### AI Agent
An autonomous virtual assistant configured to handle specific call scenarios. Each agent has:
- **Name** — Unique identifier
- **Extension** — Internal extension to reach the agent
- **Type** — AI provider type (Gemini, OpenAI, custom)
- **Model** — Specific model to use (e.g., `gemini-2.0-flash`)
- **Instructions** — System prompt defining behavior
- **Settings** — Advanced configuration options

### AI API Configuration
Global settings for connecting to AI providers:
- **Base URL** — API endpoint for AI provider
- **API Key** — Authentication credential
- **Webhook Path** — Callback endpoint for events
- **RTP/Audio Settings** — Audio stream configuration
- **Enabled** — Toggle AI functionality on/off

### Call Integration Points

1. **Inbound Call** → Routed via dialplan to AI agent extension
2. **Audio Stream** → Sent to AI provider via configured connection
3. **AI Processing** → Provider processes audio, returns responses
4. **Response** → Played back to caller via audio channel
5. **Handoff/Disconnect** → Agent decides next action

---

## Common Tasks

### Set up AI agents for the first time
→ See [Configuration & Setup](./configuration.md) → "Initial Setup"

### Add a new AI agent
→ See [User Guide](./user-guide.md) → "Creating an Agent"

### Configure agent behavior
→ See [Features Overview](./features.md) → "Customization"

### Integrate agents into call flows
→ See [API Documentation](./api.md) → "Call Routing"

### Generate and deploy configuration
→ See [Configuration & Setup](./configuration.md) → "Generate & Reload"

---

## Support & Troubleshooting

For common issues and solutions, see the main [README.md](../../README.md) Troubleshooting section.

For detailed error messages and debugging, check application logs:
- **Backend logs** — `sudo journalctl -u callbot-backend -f`
- **Asterisk logs** — `sudo journalctl -u asterisk -f`

---

## Additional Resources

- [Callbot README](../../README.md) — Main project documentation
- [CODE_BASE_ANALYSIS.MD](../../CODE_BASE_ANALYSIS.MD) — Technical system analysis
- [Dialplan Configuration](../dialplan.md) — How dialplans route to AI agents
- [Call Management](../calls.md) — Recording and analyzing AI agent calls
- [Databases: Separation of Concerns](./databases.md) — `callbot` vs `crm_ai` ownership boundaries
