'use client';

import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useLanguage } from '@/lib/language';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push('/calls');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="text-slate-400">{t('authLayout.loading')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {children}
    </div>
  );
}
