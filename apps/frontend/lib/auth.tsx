'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { User, AuthContextType, AuthToken, LoginRequest, UserRole } from '@/types/auth';
import { hasPermission, canAccessFeature, canPerformAction } from '@/lib/rbac';
import apiClient, { setAuthToken, clearAuthToken } from '@/lib/api-client';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore auth state from localStorage on mount
  useEffect(() => {
    try {
      const storedUser = localStorage.getItem('user');

      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
        // With session cookies, if user exists, set dummy token
        setToken('session');
      }
    } catch (error) {
      console.warn('Invalid local auth state, clearing session cache:', error);
      localStorage.removeItem('user');
      localStorage.removeItem('authToken');
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    try {
      setIsLoading(true);
      
      // Login to Callbot backend (sets session cookie)
      const response = await apiClient.post<{ user: User }>('/callbot/auth/login', {
        username,
        password,
      });

      const responseUser = response.data.user;

      setUser(responseUser || null);
      
      // With session cookies, we set a dummy token to indicate authentication
      setToken(responseUser ? 'session' : null);
      
      // Store user info in localStorage for display
      if (responseUser) {
        localStorage.setItem('user', JSON.stringify(responseUser));
      }

      // Also login to the telephony backend (sets separate session cookie)
      try {
        await fetch('/api/telephony-panel/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password }),
        });
      } catch (telephonyError) {
        console.warn('Telephony authentication optional, continuing:', telephonyError);
      }
    } catch (error) {
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      // Logout from Callbot backend
      await apiClient.post('/callbot/auth/logout', {});
    } catch (error) {
      console.error('Callbot logout error:', error);
    }

    // Also logout from the telephony backend (optional)
    try {
      await fetch('/api/telephony-panel/logout', { method: 'POST' });
    } catch (telephonyError) {
      console.warn('Telephony logout optional, continuing:', telephonyError);
    }

    // Clear local state
    setUser(null);
    setToken(null);
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
  };

  const hasRole = (role: UserRole | UserRole[]): boolean => {
    if (!user) return false;

    if (Array.isArray(role)) {
      return role.includes(user.role);
    }

    return user.role === role;
  };

  const contextValue: AuthContextType = {
    user,
    token,
    isAuthenticated: !!token && !!user,
    isLoading,
    login,
    logout,
    hasRole,
    hasPermission: (permission: string) =>
      user ? hasPermission(user.role, permission) : false,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
