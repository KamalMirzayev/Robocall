'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useIdleTimeout } from '@/lib/use-idle-timeout';
import { useLanguage } from '@/lib/language';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading, logout, user } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  const handleIdle = useCallback(() => {
    // Navigate away first so any in-flight polling on the current page (e.g.
    // the live-calls tab) unmounts before its session cookie is cleared —
    // otherwise a 401 from that poll races our redirect and a global axios
    // interceptor hard-navigates to a bare /login, dropping the query param.
    router.push('/login?reason=timeout');
    logout().catch((error) => console.error('Idle logout error:', error));
  }, [logout, router]);

  // Background work (e.g. active campaigns) runs server-side via the
  // campaign scheduler and is unaffected by this frontend-only logout.
  useIdleTimeout(IDLE_TIMEOUT_MS, handleIdle, isAuthenticated);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white">{t('protectedLayout.loading')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-slate-900">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between bg-slate-800 border-b border-slate-700 px-4 py-3">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label={t('protectedLayout.openMenu')}
          className="text-gray-300 hover:text-white"
        >
          <Menu className="h-6 w-6" />
        </button>
        <h1 className="text-lg font-bold text-white">{t('protectedLayout.appName')}</h1>
        <div className="w-6" />
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-slate-800 border-r border-slate-700 flex flex-col transform transition-transform duration-200 ease-in-out md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-slate-700 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">{t('protectedLayout.appName')}</h1>
            <p className="text-sm text-gray-400 mt-1">{user?.username}</p>
            {user && <p className="text-xs text-gray-500 capitalize">{t('protectedLayout.role')}: {user.role}</p>}
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label={t('protectedLayout.closeMenu')}
            className="md:hidden text-gray-400 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <a href="/calls" className="block px-4 py-2 text-gray-300 hover:bg-slate-700 rounded transition">
            {t('protectedLayout.navCalls')}
          </a>
          <a href="/campaigns" className="block px-4 py-2 text-gray-300 hover:bg-slate-700 rounded transition">
            {t('protectedLayout.navCampaigns')}
          </a>
          <a href="/agents" className="block px-4 py-2 text-gray-300 hover:bg-slate-700 rounded transition">
            {t('protectedLayout.navAgents')}
          </a>
          <a href="/customers" className="block px-4 py-2 text-gray-300 hover:bg-slate-700 rounded transition">
            {t('protectedLayout.navCustomers')}
          </a>
          <a href="/recordings" className="block px-4 py-2 text-gray-300 hover:bg-slate-700 rounded transition">
            {t('protectedLayout.navRecordings')}
          </a>
          {/* Asterisk/PBX config and AI-engineering are admin-only domains. */}
          {user?.role === 'admin' && (
            <>
              <div className="pt-2 pb-2 border-t border-slate-700 mt-2">
                <p className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">{t('protectedLayout.telephonySection')}</p>
                <a href="/telephony" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  {t('protectedLayout.accountsTrunks')}
                </a>
                <a href="/ivr" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  {t('protectedLayout.ivrMenus')}
                </a>
                <a href="/dialplan" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  {t('protectedLayout.dialplanRules')}
                </a>
                <a href="/statistics" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  {t('protectedLayout.statistics')}
                </a>
                <a href="/usage" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  {t('protectedLayout.navUsage')}
                </a>
                <a href="/telephony/asterisk-logs" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  {t('protectedLayout.asteriskLogs')}
                </a>
                <a href="/telephony/external-api" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  {t('protectedLayout.externalApiAccess')}
                </a>
              </div>
              <div className="pt-2 pb-2 border-t border-slate-700 mt-2">
                <p className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">{t('protectedLayout.aiBotSection')}</p>
                {/* Hidden for later use */}
                {/* <a href="/ai-bot" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  Overview
                </a> */}
                <a href="/ai-bot/instruction-templates" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  {t('protectedLayout.instructionTemplates')}
                </a>
                <a href="/ai-bot/dynamic-context-codes" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  {t('protectedLayout.dynamicContextCodes')}
                </a>
                {/* <a href="/ai-bot/intents" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  Intents
                </a>
                <a href="/ai-bot/responses" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  Responses
                </a>
                <a href="/ai-bot/scenarios" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  Scenarios
                </a>
                <a href="/ai-bot/status-categories" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  Status Categories
                </a> */}
                <a href="/ai-bot/tools" className="block px-4 py-2 pl-6 text-gray-300 hover:bg-slate-700 rounded transition text-sm">
                  {t('protectedLayout.aiBotTools')}
                </a>
              </div>
            </>
          )}
          <a href="/admin" className="block px-4 py-2 text-gray-300 hover:bg-slate-700 rounded transition">
            {t('protectedLayout.admin')}
          </a>
        </nav>

        <div className="p-4 border-t border-slate-700">
          <div className="flex justify-center mb-3">
            <LanguageSwitcher />
          </div>
          <p className="text-center text-xs text-gray-500 mb-2">v2.0.1</p>
          <button
            onClick={async () => {
              await logout();
              router.push('/login');
            }}
            className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded transition"
          >
            {t('protectedLayout.logout')}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-slate-900 pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
