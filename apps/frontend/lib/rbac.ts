import { UserRole } from '@/types/auth';

export const roleHierarchy: Record<UserRole, number> = {
  admin: 3,
  campaign_manager: 2,
  viewer: 1,
};

export const permissions: Record<UserRole, string[]> = {
  admin: [
    'view:all',
    'edit:all',
    'delete:all',
    'manage:users',
    'manage:telephony',
    'manage:ai-config',
    'manage:settings',
  ],
  campaign_manager: [
    'view:campaigns',
    'edit:campaigns',
    'view:customers',
    'edit:customers',
    'view:agents',
    'view:calls',
    'view:recordings',
    'view:statistics',
    'export:statistics',
  ],
  viewer: [
    'view:campaigns',
    'view:customers',
    'view:agents',
    'view:calls',
    'view:recordings',
    'view:statistics',
  ],
};

export function hasPermission(userRole: UserRole, permission: string): boolean {
  return permissions[userRole]?.includes(permission) || false;
}

export function canAccessFeature(userRole: UserRole, feature: string): boolean {
  const featurePermissions: Record<string, UserRole[]> = {
    'campaigns': ['admin', 'campaign_manager', 'viewer'],
    'customers': ['admin', 'campaign_manager', 'viewer'],
    'live-monitor': ['admin', 'campaign_manager', 'viewer'],
    'statistics': ['admin', 'campaign_manager', 'viewer'],
    // Asterisk/PBX config and AI agent/instruction engineering are admin-only domains.
    'telephony-tools': ['admin'],
    'ai-bot': ['admin'],
    'admin-panel': ['admin'],
    'user-management': ['admin'],
  };

  const allowedRoles = featurePermissions[feature] || [];
  return allowedRoles.includes(userRole);
}

export function canPerformAction(userRole: UserRole, action: string): boolean {
  const actionPermissions: Record<string, UserRole[]> = {
    'create:campaign': ['admin', 'campaign_manager'],
    'edit:campaign': ['admin', 'campaign_manager'],
    'delete:campaign': ['admin', 'campaign_manager'],
    'start:campaign': ['admin', 'campaign_manager'],
    'import:campaign-customers': ['admin', 'campaign_manager'],
    'create:customer': ['admin', 'campaign_manager'],
    'edit:customer': ['admin', 'campaign_manager'],
    'delete:customer': ['admin', 'campaign_manager'],
    'create:agent': ['admin'],
    'edit:agent': ['admin'],
    'delete:agent': ['admin'],
    'edit:instruction-template': ['admin'],
    'manual-call': ['admin'],
    'delete:recording': ['admin'],
    'edit:sip': ['admin'],
    'edit:trunk': ['admin'],
    'edit:dialplan': ['admin'],
    'edit:ivr': ['admin'],
    'export:excel': ['admin', 'campaign_manager', 'viewer'],
    'change:password': ['admin', 'campaign_manager', 'viewer'],
  };

  const allowedRoles = actionPermissions[action] || [];
  return allowedRoles.includes(userRole);
}
