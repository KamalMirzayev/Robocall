/**
 * Telephony Authentication Handler
 * The telephony backend uses session cookies instead of JWT tokens
 * This module handles telephony-specific authentication
 */

const TELEPHONY_API_URL = process.env.NEXT_PUBLIC_TELEPHONY_API || 'http://localhost:8090';

export interface TelephonyAuthResponse {
  success: boolean;
  cookie?: string;
  error?: string;
}

export async function loginToTelephony(username: string, password: string): Promise<TelephonyAuthResponse> {
  try {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    const response = await fetch(`${TELEPHONY_API_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      credentials: 'include', // Include cookies
    });

    if (response.ok || response.status === 302) {
      // Store the session cookie
      const cookie = response.headers.get('set-cookie');
      if (cookie) {
        localStorage.setItem('robocall_crm_session', cookie as string);
      }
      return { success: true, cookie: cookie || undefined };
    }

    return {
      success: false,
      error: `Authentication failed: ${response.statusText}`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to authenticate with telephony: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function logoutFromTelephony(): Promise<void> {
  try {
    const session = localStorage.getItem('robocall_crm_session');
    if (session) {
      await fetch(`${TELEPHONY_API_URL}/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    }
  } catch (error) {
    console.error('Failed to logout from telephony:', error);
  } finally {
    localStorage.removeItem('robocall_crm_session');
  }
}

export function getTelephonySessionCookie(): string | null {
  return localStorage.getItem('robocall_crm_session');
}
