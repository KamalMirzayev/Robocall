export interface SIPAccount {
  id: string;
  name: string;
  extension: string;
  secret: string;
  account_type: 'local' | 'public';
  caller_id: string;
  host?: string;
  transport?: 'udp' | 'tcp' | 'tls';
  context?: string;
  codecs?: string;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SIPTrunk {
  id: string;
  name: string;
  trunk_type: 'gsm_gateway' | 'provider' | 'peer';
  host: string;
  port: number;
  username?: string;
  secret?: string;
  from_user?: string;
  from_domain?: string;
  inbound_context?: string;
  outbound_prefix?: string;
  codecs?: string;
  dial_format?: 'local' | 'intl';
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DialplanRule {
  id: string;
  priority: number;
  pattern: string;
  route_type: 'extension' | 'trunk' | 'ivr' | 'ai_agent' | 'hangup';
  route_target: string;
  description?: string;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface IVRMenu {
  id: string;
  name: string;
  extension: string;
  prompt: string;
  timeout_seconds: number;
  invalid_target: string;
  options?: IVROption[];
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface IVROption {
  id: string;
  ivr_id: string;
  digit: string;
  target_type: 'extension' | 'ivr' | 'ai_agent' | 'hangup';
  target: string;
  label?: string;
}

export interface SystemStatus {
  crm: 'online' | 'offline' | 'checking';
  asterisk: 'online' | 'offline' | 'checking';
  gsm: 'online' | 'offline' | 'checking';
  aiTokens: {
    status: 'ok' | 'low' | 'exceeded' | 'checking';
    budget?: number;
    used?: number;
    remaining?: number;
  };
}

export interface CallStatistics {
  date: string;
  total_calls: number;
  avg_duration: number;
  agent?: string;
  customer?: string;
  category?: string;
}
