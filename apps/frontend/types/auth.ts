export type UserRole = 'admin' | 'campaign_manager' | 'viewer';

export interface User {
  id: string;
  username: string;
  email?: string;
  role: UserRole;
  permissions?: string[];
}

export interface AuthToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  user?: User;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (role: UserRole | UserRole[]) => boolean;
  hasPermission: (permission: string) => boolean;
}
