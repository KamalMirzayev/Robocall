# Backend Integration Setup

## Architecture

The frontend now has complete backend integration infrastructure:

### API Proxy Routes
- **`/api/callbot/*`** → Proxies to Callbot backend (port 4000)
- **`/api/telephony-panel/*`** → Proxies to the telephony backend (port 8090)

### API Clients
- **`callbotApi`** - Type-safe client for Callbot endpoints
- **`telephonyApi`** - Type-safe client for telephony endpoints

### Data Hooks
- **`useCallbot.ts`** - React hooks: `useCalls()`, `useAgents()`, `useCustomers()`, `useRecordings()`
- **`useTelephony.ts`** - React hooks: `useSIPAccounts()`, `useSIPTrunks()`, `useDialplanRules()`, `useIVRMenus()`

### Mock Service
- **`mockService`** - Provides mock data for development when backends are offline

## How to Use

### Example 1: Fetch Calls
```typescript
'use client';

import { useCalls } from '@/hooks/useCallbot';

export function MyComponent() {
  const { calls, loading, error } = useCalls();

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <ul>
      {calls.map(call => (
        <li key={call.id}>{call.id} - {call.status}</li>
      ))}
    </ul>
  );
}
```

### Example 2: Direct API Call
```typescript
import callbotApi from '@/lib/callbot-api';

const agents = await callbotApi.getAgents();
const newAgent = await callbotApi.createAgent({
  name: 'John Doe',
  gender: 'male',
  tone: 'professional',
});
```

### Example 3: Using Mock Data
```typescript
import mockService from '@/lib/mock-service';

const calls = await mockService.getCalls(); // Simulates 500ms delay
```

## Backend Configuration

### Environment Variables
```env
NEXT_PUBLIC_CALLBOT_API=http://localhost:4000
NEXT_PUBLIC_TELEPHONY_API=http://localhost:8090
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

### Expected Endpoints

#### Callbot Backend (port 4000)
- `GET /calls` - List all calls
- `GET /calls/:id` - Get call details
- `PUT /calls/:id` - Update call
- `GET /agents` - List all agents
- `POST /agents` - Create agent
- `PUT /agents/:id` - Update agent
- `DELETE /agents/:id` - Delete agent
- `GET /customers` - List all customers
- `POST /customers` - Create customer
- `PUT /customers/:id` - Update customer
- `GET /recordings` - List recordings
- `GET /recordings/:id` - Get recording details

#### Telephony Backend (port 8090)
- `GET /sip-accounts` - List SIP accounts
- `POST /sip-accounts` - Create SIP account
- `PUT /sip-accounts/:id` - Update SIP account
- `DELETE /sip-accounts/:id` - Delete SIP account
- `GET /sip-trunks` - List SIP trunks
- `POST /sip-trunks` - Create SIP trunk
- `PUT /sip-trunks/:id` - Update SIP trunk
- `DELETE /sip-trunks/:id` - Delete SIP trunk
- `GET /dialplan-rules` - List dialplan rules
- `POST /dialplan-rules` - Create rule
- `PUT /dialplan-rules/:id` - Update rule
- `DELETE /dialplan-rules/:id` - Delete rule
- `GET /ivr-menus` - List IVR menus
- `POST /ivr-menus` - Create IVR menu
- `PUT /ivr-menus/:id` - Update IVR menu
- `DELETE /ivr-menus/:id` - Delete IVR menu

## Testing Without Backends

When backends are offline, use mock data for development:

```typescript
// Use mock service directly
import { mockCalls, mockAgents } from '@/lib/mock-service';

// Or modify API clients to fall back to mock on error:
// Components will automatically show loading states while "fetching"
```

## Authentication

All proxy requests use server-side session cookies — the browser never holds a telephony cookie; the proxy re-authenticates with the telephony backend on the server using `TELEPHONY_ADMIN_*` env vars.

## Error Handling

- Network errors are caught and logged to console
- API clients return empty arrays or null on error
- Hooks provide error state: `{ data, loading, error }`
- Use error boundaries in components for UI error handling

## Next Steps

1. **Start Callbot Backend**: `sudo systemctl start robocall-api` (prod) or `cd apps/callbot-backend && npm run dev` (dev)
2. **Start Telephony Backend**: `sudo systemctl start robocall-telephony` (prod) or `cd apps/telephony && npm start` (dev)
3. **Components will automatically fetch real data** once backends respond
4. **Test endpoints** using the frontend UI or curl:

```bash
# Test Callbot proxy
curl http://localhost:3001/api/callbot/calls

# Test telephony proxy
curl http://localhost:3001/api/telephony-panel/sip-accounts
```

## Key Files

- `/app/api/callbot/[...path]/route.ts` - Callbot proxy
- `/app/api/telephony-panel/[...path]/route.ts` - telephony proxy
- `/lib/callbot-api.ts` - Callbot API client
- `/lib/telephony-api-client.ts` - telephony API client
- `/lib/mock-service.ts` - Mock data
- `/hooks/useCallbot.ts` - Callbot hooks
- `/hooks/useTelephonyHooks.ts` - telephony hooks
