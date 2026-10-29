# AI Agent API Documentation

Complete REST API reference for integrating with AI agents in the Callbot system.

## Table of Contents
1. [API Overview](#api-overview)
2. [Authentication](#authentication)
3. [Base URLs](#base-urls)
4. [AI API Configuration](#ai-api-configuration-endpoints)
5. [Agents Endpoints](#agents-endpoints)
6. [Calls Endpoints](#calls-endpoints)
7. [Error Handling](#error-handling)
8. [Rate Limiting](#rate-limiting)
9. [Webhooks](#webhooks)
10. [Code Examples](#code-examples)

---

## API Overview

The AI Agent API provides programmatic access to:
- Configure AI provider connections
- Create and manage AI agents
- View and analyze AI agent calls
- Track performance metrics
- Configure call routing

### Base Features
- RESTful design with JSON payloads
- Session-based authentication (cookies)
- Comprehensive error reporting
- Real-time and historical data access

---

## Authentication

### Session-Based Authentication

The API uses HTTP cookies for authentication (not JWT tokens).

#### Login to Callbot

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "username": "admin",
    "password": "password"
  }'
```

Response:
```json
{
  "success": true,
  "user": {
    "id": "user-123",
    "username": "admin",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

#### Use Cookie in Subsequent Requests

All API calls must include the session cookie:

```bash
curl -X GET http://localhost:4000/api/agents \
  -b cookies.txt
```

Or with `curl` and automatic cookie handling:

```bash
curl -X GET http://localhost:4000/api/agents \
  -b "robocall_session=abc123def456"
```

### Authorization

- **Admin Role** — Full access to all endpoints
- **Agent Role** — View assigned agents only
- **Customer Role** — View own interactions only

API returns `401 Unauthorized` if not authenticated.

---

## Base URLs

### Callbot Backend
```
http://localhost:4000/api
```

### crmAI Backend (AI Configuration)
```
http://localhost:8090/api
```

All examples use the appropriate base URL.

---

## AI API Configuration Endpoints

### Get Current Configuration

```
GET /config/ai-api
```

Fetch the current AI API configuration settings.

**Request:**
```bash
curl -X GET http://localhost:8090/api/config/ai-api \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
  "apiKey": "AIzaSy...",
  "webhookPath": "/webhook/ai-events",
  "audiosocket": {
    "host": "localhost",
    "port": 9090
  },
  "callbot": {
    "wsUrl": "ws://localhost:4000",
    "agentId": "prod-ai-1",
    "customerId": "customer-001"
  },
  "enabled": true,
  "createdAt": "2026-07-08T10:00:00Z",
  "updatedAt": "2026-07-08T12:30:00Z"
}
```

### Update Configuration

```
POST /config/ai-api
```

Update AI API configuration settings.

**Request:**
```bash
curl -X POST http://localhost:8090/api/config/ai-api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
    "apiKey": "AIzaSy...",
    "webhookPath": "/webhook/ai-events",
    "audiosocket": {
      "host": "localhost",
      "port": 9090
    },
    "enabled": true
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Configuration updated successfully",
  "config": { /* updated config */ }
}
```

### Render & Reload Configuration

```
POST /render
```

Generate Asterisk configuration files and reload the system.

**Request:**
```bash
curl -X POST http://localhost:8090/api/render \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Asterisk configuration generated and reloaded",
  "timestamp": "2026-07-08T12:35:00Z",
  "configFiles": [
    "pjsip_dynamic.conf",
    "extensions_dynamic.conf"
  ]
}
```

---

## Agents Endpoints

### List All Agents

```
GET /agents
```

Retrieve all AI agents.

**Query Parameters:**
- `type=ai` — Filter by agent type (ai, human, bot)
- `enabled=true` — Filter by enabled status
- `limit=10` — Results per page (default: 20)
- `offset=0` — Pagination offset

**Request:**
```bash
curl -X GET "http://localhost:4000/api/agents?type=ai&enabled=true" \
  -b cookies.txt
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "agent-001",
      "name": "Support Agent",
      "extension": "1000",
      "type": "ai",
      "model": "gemini-2.0-flash",
      "instructions": "You are a helpful...",
      "enabled": true,
      "settings": {
        "temperature": 0.7,
        "max_tokens": 1024
      },
      "stats": {
        "totalCalls": 42,
        "avgDuration": 180,
        "successRate": 0.88
      },
      "createdAt": "2026-07-01T10:00:00Z"
    },
    // ... more agents
  ],
  "total": 5,
  "limit": 20,
  "offset": 0
}
```

### Get Agent Details

```
GET /agents/:agentId
```

Retrieve details for a specific agent.

**Request:**
```bash
curl -X GET http://localhost:4000/api/agents/agent-001 \
  -b cookies.txt
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "agent-001",
    "name": "Support Agent",
    "extension": "1000",
    "type": "ai",
    "model": "gemini-2.0-flash",
    "instructions": "You are a friendly customer support agent...",
    "enabled": true,
    "settings": {
      "temperature": 0.7,
      "max_tokens": 1024,
      "silenceTimeoutMs": 5000
    },
    "stats": {
      "totalCalls": 42,
      "activeCalls": 2,
      "avgDuration": 180,
      "successRate": 0.88,
      "lastCallAt": "2026-07-08T12:25:00Z"
    }
  }
}
```

### Create Agent

```
POST /agents
```

Create a new AI agent.

**Request Body:**
```json
{
  "name": "Billing Support",
  "extension": "1001",
  "type": "ai",
  "model": "gemini-2.0-flash",
  "instructions": "You are a billing support specialist. Help customers with invoices, payments, and account questions.",
  "enabled": true,
  "settings": {
    "temperature": 0.7,
    "max_tokens": 1024,
    "silenceTimeoutMs": 5000,
    "language": "en-US"
  }
}
```

**Request:**
```bash
curl -X POST http://localhost:4000/api/agents \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "name": "Billing Support",
    "extension": "1001",
    "type": "ai",
    "model": "gemini-2.0-flash",
    "instructions": "You are a billing support specialist...",
    "enabled": true
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Agent created successfully",
  "data": {
    "id": "agent-002",
    "name": "Billing Support",
    "extension": "1001",
    // ... full agent object
  }
}
```

### Update Agent

```
PUT /agents/:agentId
```

Update an existing agent.

**Request:**
```bash
curl -X PUT http://localhost:4000/api/agents/agent-001 \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "name": "Premium Support Agent",
    "instructions": "New instructions...",
    "settings": {
      "temperature": 0.8,
      "max_tokens": 2048
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Agent updated successfully",
  "data": { /* updated agent */ }
}
```

### Delete Agent

```
DELETE /agents/:agentId
```

Delete an AI agent.

**Request:**
```bash
curl -X DELETE http://localhost:4000/api/agents/agent-001 \
  -b cookies.txt
```

**Response:**
```json
{
  "success": true,
  "message": "Agent deleted successfully"
}
```

---

## Calls Endpoints

### List AI Agent Calls

```
GET /calls
```

Retrieve calls handled by AI agents.

**Query Parameters:**
- `agentId=agent-001` — Filter by agent ID
- `status=completed` — Filter by status (active, completed, failed)
- `startDate=2026-07-01` — Start date (ISO 8601)
- `endDate=2026-07-08` — End date (ISO 8601)
- `limit=50` — Results per page
- `offset=0` — Pagination offset

**Request:**
```bash
curl -X GET "http://localhost:4000/api/calls?agentId=agent-001&status=completed" \
  -b cookies.txt
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "call-12345",
      "agentId": "agent-001",
      "callerId": "caller-456",
      "customerId": "customer-789",
      "startTime": "2026-07-08T12:00:00Z",
      "endTime": "2026-07-08T12:03:30Z",
      "duration": 210,
      "status": "completed",
      "outcome": "resolved",
      "handedOffToAgent": false,
      "recordingUrl": "/recordings/call-12345.mp3",
      "transcriptUrl": "/transcripts/call-12345.json",
      "summary": {
        "topic": "Billing inquiry",
        "resolution": "Explained invoice charges",
        "sentiment": "satisfied"
      }
    },
    // ... more calls
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

### Get Call Details

```
GET /calls/:callId
```

Retrieve full details for a specific call.

**Request:**
```bash
curl -X GET http://localhost:4000/api/calls/call-12345 \
  -b cookies.txt
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "call-12345",
    "agentId": "agent-001",
    "agentName": "Support Agent",
    "callerId": "caller-456",
    "callerNumber": "+1234567890",
    "customerId": "customer-789",
    "customerName": "John Doe",
    "startTime": "2026-07-08T12:00:00Z",
    "endTime": "2026-07-08T12:03:30Z",
    "duration": 210,
    "status": "completed",
    "outcome": "resolved",
    "handedOffToAgent": false,
    "handoffReason": null,
    "recordingUrl": "/recordings/call-12345.mp3",
    "transcriptUrl": "/transcripts/call-12345.json",
    "summary": {
      "topic": "Billing inquiry",
      "resolution": "Explained invoice charges",
      "sentiment": "satisfied",
      "key_points": [
        "Customer asked about invoice #INV-2026-001",
        "Explained late fee of $25",
        "Offered payment plan"
      ]
    },
    "metrics": {
      "silencePercentage": 35,
      "avgResponseTime": 2500,
      "turnCount": 8,
      "transcriptionConfidence": 0.92
    }
  }
}
```

### Get Call Transcript

```
GET /calls/:callId/transcript
```

Retrieve the full transcript for a call.

**Request:**
```bash
curl -X GET http://localhost:4000/api/calls/call-12345/transcript \
  -b cookies.txt
```

**Response:**
```json
{
  "success": true,
  "data": {
    "callId": "call-12345",
    "timestamp": "2026-07-08T12:00:00Z",
    "turns": [
      {
        "speaker": "customer",
        "text": "Hi, I'm calling about my invoice",
        "timestamp": 0,
        "confidence": 0.95
      },
      {
        "speaker": "agent",
        "text": "Hello! I'd be happy to help you with your invoice. Can you provide your account number?",
        "timestamp": 2500
      },
      {
        "speaker": "customer",
        "text": "Sure, it's ACC-123456",
        "timestamp": 5000,
        "confidence": 0.98
      },
      // ... more turns
    ]
  }
}
```

### Get Agent Statistics

```
GET /agents/:agentId/stats
```

Retrieve performance statistics for an agent.

**Query Parameters:**
- `period=week` — Time period (today, week, month, all)
- `includeComparison=true` — Include comparison to previous period

**Request:**
```bash
curl -X GET "http://localhost:4000/api/agents/agent-001/stats?period=week" \
  -b cookies.txt
```

**Response:**
```json
{
  "success": true,
  "data": {
    "agentId": "agent-001",
    "agentName": "Support Agent",
    "period": "week",
    "startDate": "2026-07-01",
    "endDate": "2026-07-08",
    "metrics": {
      "totalCalls": 42,
      "completedCalls": 37,
      "failedCalls": 5,
      "avgDuration": 210,
      "totalDuration": 7770,
      "successRate": 0.881,
      "handoffRate": 0.095,
      "avgResponseTime": 2500,
      "avgSilencePercentage": 35
    },
    "sentiment": {
      "veryPositive": 15,
      "positive": 18,
      "neutral": 8,
      "negative": 1,
      "avgSentimentScore": 0.78
    },
    "topTopics": [
      {
        "topic": "Billing inquiry",
        "count": 18,
        "resolutionRate": 0.944
      },
      {
        "topic": "Technical support",
        "count": 12,
        "resolutionRate": 0.833
      }
    ]
  }
}
```

---

## Error Handling

### Error Response Format

All errors follow this structure:

```json
{
  "success": false,
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "Agent with ID 'invalid-id' not found",
    "details": "Check agent ID and try again",
    "statusCode": 404
  }
}
```

### Common Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `UNAUTHORIZED` | 401 | Not authenticated |
| `FORBIDDEN` | 403 | Authenticated but not authorized |
| `AGENT_NOT_FOUND` | 404 | Agent doesn't exist |
| `INVALID_AGENT_CONFIG` | 400 | Invalid agent configuration |
| `API_KEY_INVALID` | 401 | Invalid AI provider API key |
| `AUDIOSOCKET_UNAVAILABLE` | 503 | AudioSocket service not running |
| `CALL_NOT_FOUND` | 404 | Call record doesn't exist |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Rate Limiting

### Limits

- **Standard Users** — 100 requests/minute
- **Admin Users** — 1000 requests/minute
- **Service Accounts** — Custom limits

### Rate Limit Headers

Response headers include rate limit info:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1656421200
```

### Handling Rate Limits

When rate limited (429 response):

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Retry after 60 seconds",
    "retryAfter": 60
  }
}
```

**Best Practice:** Implement exponential backoff when retrying.

---

## Webhooks

### Webhook Events

AI Agent system sends POST requests to your webhook endpoint with these events:

#### call-started
```json
{
  "event": "call-started",
  "callId": "call-12345",
  "agentId": "agent-001",
  "callerId": "caller-456",
  "timestamp": "2026-07-08T12:00:00Z"
}
```

#### call-completed
```json
{
  "event": "call-completed",
  "callId": "call-12345",
  "agentId": "agent-001",
  "duration": 210,
  "outcome": "resolved",
  "timestamp": "2026-07-08T12:03:30Z"
}
```

#### handoff-triggered
```json
{
  "event": "handoff-triggered",
  "callId": "call-12345",
  "agentId": "agent-001",
  "reason": "Customer requested human agent",
  "targetExtension": "5000",
  "timestamp": "2026-07-08T12:02:00Z"
}
```

#### error
```json
{
  "event": "error",
  "callId": "call-12345",
  "agentId": "agent-001",
  "error": "API timeout",
  "timestamp": "2026-07-08T12:01:30Z"
}
```

### Webhook Configuration

Set webhook path in AI API configuration:

```
POST /config/ai-api
{
  "webhookPath": "/webhook/ai-events"
}
```

Your endpoint receives POST requests at:
```
https://your-domain.com/webhook/ai-events
```

### Webhook Retry Policy

- Initial attempt: Immediate
- Retry 1: After 5 seconds
- Retry 2: After 30 seconds
- Retry 3: After 5 minutes
- Final attempt: After 1 hour

---

## Code Examples

### Python

```python
import requests
import json

class CallbotAIClient:
    def __init__(self, base_url, username, password):
        self.base_url = base_url
        self.session = requests.Session()
        self.login(username, password)
    
    def login(self, username, password):
        response = self.session.post(
            f"{self.base_url}/auth/login",
            json={"username": username, "password": password}
        )
        response.raise_for_status()
    
    def list_agents(self, agent_type="ai", limit=20):
        response = self.session.get(
            f"{self.base_url}/agents",
            params={"type": agent_type, "limit": limit}
        )
        return response.json()
    
    def create_agent(self, name, extension, model, instructions):
        response = self.session.post(
            f"{self.base_url}/agents",
            json={
                "name": name,
                "extension": extension,
                "type": "ai",
                "model": model,
                "instructions": instructions,
                "enabled": True
            }
        )
        return response.json()
    
    def get_agent_stats(self, agent_id, period="week"):
        response = self.session.get(
            f"{self.base_url}/agents/{agent_id}/stats",
            params={"period": period}
        )
        return response.json()

# Usage
client = CallbotAIClient(
    "http://localhost:4000/api",
    "admin",
    "password"
)

agents = client.list_agents()
print(f"Found {len(agents['data'])} AI agents")

agent = client.create_agent(
    "Billing Support",
    "1001",
    "gemini-2.0-flash",
    "Help customers with billing inquiries..."
)
print(f"Created agent: {agent['data']['id']}")

stats = client.get_agent_stats(agent['data']['id'])
print(f"Agent stats: {json.dumps(stats, indent=2)}")
```

### Node.js / JavaScript

```javascript
class CallbotAIClient {
  constructor(baseUrl, username, password) {
    this.baseUrl = baseUrl;
    this.cookies = null;
    this.login(username, password);
  }

  async login(username, password) {
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include'
    });
    
    if (!response.ok) throw new Error('Login failed');
    return response.json();
  }

  async listAgents(type = 'ai', limit = 20) {
    const params = new URLSearchParams({ type, limit });
    const response = await fetch(
      `${this.baseUrl}/agents?${params}`,
      { credentials: 'include' }
    );
    return response.json();
  }

  async createAgent(name, extension, model, instructions) {
    const response = await fetch(`${this.baseUrl}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, extension, type: 'ai', model, instructions, enabled: true
      }),
      credentials: 'include'
    });
    return response.json();
  }

  async getAgentStats(agentId, period = 'week') {
    const params = new URLSearchParams({ period });
    const response = await fetch(
      `${this.baseUrl}/agents/${agentId}/stats?${params}`,
      { credentials: 'include' }
    );
    return response.json();
  }
}

// Usage
const client = new CallbotAIClient(
  'http://localhost:4000/api',
  'admin',
  'password'
);

const agents = await client.listAgents();
console.log(`Found ${agents.data.length} AI agents`);

const agent = await client.createAgent(
  'Billing Support',
  '1001',
  'gemini-2.0-flash',
  'Help customers with billing inquiries...'
);
console.log(`Created agent: ${agent.data.id}`);
```

### cURL

```bash
# Set base URL and credentials
BASE_URL="http://localhost:4000/api"
USERNAME="admin"
PASSWORD="password"

# Login
curl -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}"

# List agents
curl -X GET "$BASE_URL/agents?type=ai" \
  -b cookies.txt

# Create agent
curl -X POST "$BASE_URL/agents" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "name": "Support Agent",
    "extension": "1000",
    "type": "ai",
    "model": "gemini-2.0-flash",
    "instructions": "You are a helpful support agent",
    "enabled": true
  }'

# Get agent stats
curl -X GET "$BASE_URL/agents/agent-001/stats?period=week" \
  -b cookies.txt
```

---

## Next Steps

- See [Configuration & Setup](./configuration.md) for implementation details
- See [User Guide](./user-guide.md) for UI-based management
- Check [Features Overview](./features.md) for capability details
