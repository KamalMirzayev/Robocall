'use client';

import { useAuth } from '@/lib/auth';
import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { UserRole } from '@/types/auth';

export function ProtectedRoute({
  children,
  requiredRole,
}: {
  children: ReactNode;
  requiredRole?: UserRole | UserRole[];
}) {
  const { isAuthenticated, user, isLoading, hasRole } = useAuth();

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  if (!isAuthenticated) {
    redirect('/login');
  }

  if (requiredRole) {
    if (!hasRole(requiredRole)) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="text-2xl font-bold">Access Denied</h1>
            <p className="text-gray-600">You don't have permission to access this page.</p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}

export function RoleBasedRender({
  children,
  requiredRole,
  fallback = null,
}: {
  children: ReactNode;
  requiredRole?: UserRole | UserRole[];
  fallback?: ReactNode;
}) {
  const { hasRole } = useAuth();

  if (!requiredRole || hasRole(requiredRole)) {
    return <>{children}</>;
  }

  return fallback;
}
