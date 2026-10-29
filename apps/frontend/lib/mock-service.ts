import { Call, Agent, Customer, Recording } from '@/types/callbot';
import { SIPAccount, SIPTrunk, DialplanRule, IVRMenu } from '@/types/telephony';

/**
 * Mock data service for development/testing
 * Used when backends are not available
 */

export const mockCalls: Call[] = [
  {
    id: 'call-001',
    agent_id: 'agent-001',
    customer_id: 'cust-001',
    duration: 450,
    transcript: 'Customer calling about billing issue. Agent resolved by sending invoice.',
    recording_path: '/recordings/call-001.wav',
    status: 'completed',
    started_at: new Date(Date.now() - 3600000).toISOString(),
    ended_at: new Date(Date.now() - 2700000).toISOString(),
  },
  {
    id: 'call-002',
    agent_id: 'agent-002',
    customer_id: 'cust-002',
    duration: 180,
    transcript: 'Inbound call requesting support. Agent pending response.',
    recording_path: '/recordings/call-002.wav',
    status: 'active',
    started_at: new Date(Date.now() - 300000).toISOString(),
  },
];

export const mockAgents: Agent[] = [
  {
    id: 'agent-001',
    name: 'John Smith',
    gender: 'male',
    enabled: true,
    role: 'Senior Agent',
  },
  {
    id: 'agent-002',
    name: 'Sarah Johnson',
    gender: 'female',
    enabled: true,
    role: 'Support Agent',
  },
  {
    id: 'agent-003',
    name: 'Mike Chen',
    gender: 'male',
    enabled: true,
    role: 'Support Agent',
  },
];

export const mockCustomers: Customer[] = [
  {
    id: 'cust-001',
    name: 'Alice Brown',
    phone: '+1-555-0101',
    email: 'alice@example.com',
    debt_amount: 250.00,
  },
  {
    id: 'cust-002',
    name: 'Bob Wilson',
    phone: '+1-555-0102',
    email: 'bob@example.com',
    debt_amount: 500.00,
  },
  {
    id: 'cust-003',
    name: 'Carol Martinez',
    phone: '+1-555-0103',
    email: 'carol@example.com',
    debt_amount: 0,
  },
];

export const mockRecordings: Recording[] = [
  {
    id: 'rec-001',
    call_id: 'call-001',
    agent_name: 'John Smith',
    agent_number: '101',
    customer_name: 'Customer One',
    customer_number: '+1234567890',
    duration: 450,
    path: '/recordings/call-001.wav',
    url: 'https://recordings.example.com/call-001.wav',
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'rec-002',
    call_id: 'call-002',
    agent_name: 'Sarah Johnson',
    agent_number: '102',
    customer_name: 'Customer Two',
    customer_number: '+0987654321',
    duration: 180,
    path: '/recordings/call-002.wav',
    url: 'https://recordings.example.com/call-002.wav',
    created_at: new Date(Date.now() - 300000).toISOString(),
  },
];

export const mockSIPAccounts: SIPAccount[] = [
  {
    id: 'sip-001',
    name: 'Agent 1 Account',
    extension: '101',
    secret: 'secure-password-1',
    account_type: 'local',
    caller_id: 'Agent 1 <101>',
    host: 'pbx.example.com',
    transport: 'udp',
    context: 'from-internal',
    enabled: true,
  },
  {
    id: 'sip-002',
    name: 'Agent 2 Account',
    extension: '102',
    secret: 'secure-password-2',
    account_type: 'local',
    caller_id: 'Agent 2 <102>',
    host: 'pbx.example.com',
    transport: 'udp',
    context: 'from-internal',
    enabled: true,
  },
];

export const mockSIPTrunks: SIPTrunk[] = [
  {
    id: 'trunk-001',
    name: 'Main SIP Provider',
    trunk_type: 'provider',
    host: 'sip.provider.com',
    port: 5060,
    username: 'trunk-user',
    secret: 'trunk-password',
    from_domain: 'sip.provider.com',
    outbound_prefix: '',
    enabled: true,
  },
  {
    id: 'trunk-002',
    name: 'GSM Gateway',
    trunk_type: 'gsm_gateway',
    host: 'gsm-gateway.local',
    port: 5060,
    username: 'gsm-user',
    secret: 'gsm-password',
    from_domain: 'gsm-gateway.local',
    enabled: true,
  },
];

export const mockDialplanRules: DialplanRule[] = [
  {
    id: 'rule-001',
    pattern: '2XXX',
    route_type: 'extension',
    route_target: '101',
    priority: 1,
    description: 'Route to Agent 1',
    enabled: true,
  },
  {
    id: 'rule-002',
    pattern: '3XXX',
    route_type: 'ivr',
    route_target: 'ivr-001',
    priority: 2,
    description: 'Route to Main IVR Menu',
    enabled: true,
  },
];

export const mockIVRMenus: IVRMenu[] = [
  {
    id: 'ivr-001',
    name: 'Main Menu',
    extension: '100',
    prompt: 'Welcome to our system. Press 1 for sales, 2 for support.',
    timeout_seconds: 10,
    invalid_target: '101',
    enabled: true,
    options: [
      {
        id: 'opt-001',
        ivr_id: 'ivr-001',
        digit: '1',
        target_type: 'extension',
        target: '101',
        label: 'Sales',
      },
      {
        id: 'opt-002',
        ivr_id: 'ivr-001',
        digit: '2',
        target_type: 'extension',
        target: '102',
        label: 'Support',
      },
    ],
  },
];

export const mockService = {
  // Simulate API delay
  async delay(ms = 500) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  // Callbot mocks
  async getCalls(): Promise<Call[]> {
    await this.delay();
    return mockCalls;
  },

  async getAgents(): Promise<Agent[]> {
    await this.delay();
    return mockAgents;
  },

  async getCustomers(): Promise<Customer[]> {
    await this.delay();
    return mockCustomers;
  },

  async getRecordings(): Promise<Recording[]> {
    await this.delay();
    return mockRecordings;
  },

  // telephony mocks
  async getSIPAccounts(): Promise<SIPAccount[]> {
    await this.delay();
    return mockSIPAccounts;
  },

  async getSIPTrunks(): Promise<SIPTrunk[]> {
    await this.delay();
    return mockSIPTrunks;
  },

  async getDialplanRules(): Promise<DialplanRule[]> {
    await this.delay();
    return mockDialplanRules;
  },

  async getIVRMenus(): Promise<IVRMenu[]> {
    await this.delay();
    return mockIVRMenus;
  },
};

export default mockService;
