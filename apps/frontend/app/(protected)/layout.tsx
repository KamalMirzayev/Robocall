'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Bot,
  Code2,
  FileText,
  KeyRound,
  ListTree,
  LogOut,
  Megaphone,
  Menu,
  Mic,
  Network,
  Phone,
  ScrollText,
  Server,
  Shield,
  Users,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useIdleTimeout } from '@/lib/use-idle-timeout';
import { useLanguage } from '@/lib/language';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

type NavItem = { href: string; label: string; icon: typeof Phone };

const mainNav: NavItem[] = [
  { href: '/calls', label: 'protectedLayout.navCalls', icon: Phone },
  { href: '/campaigns', label: 'protectedLayout.navCampaigns', icon: Megaphone },
  { href: '/agents', label: 'protectedLayout.navAgents', icon: Bot },
  { href: '/customers', label: 'protectedLayout.navCustomers', icon: Users },
  { href: '/recordings', label: 'protectedLayout.navRecordings', icon: Mic },
];

const telephonyNav: NavItem[] = [
  { href: '/telephony', label: 'protectedLayout.accountsTrunks', icon: Server },
  { href: '/ivr', label: 'protectedLayout.ivrMenus', icon: ListTree },
  { href: '/dialplan', label: 'protectedLayout.dialplanRules', icon: Network },
  { href: '/statistics', label: 'protectedLayout.statistics', icon: BarChart3 },
  { href: '/usage', label: 'protectedLayout.navUsage', icon: Wallet },
  { href: '/telephony/asterisk-logs', label: 'protectedLayout.asteriskLogs', icon: ScrollText },
  { href: '/telephony/external-api', label: 'protectedLayout.externalApiAccess', icon: KeyRound },
];

const aiBotNav: NavItem[] = [
  { href: '/ai-bot/instruction-templates', label: 'protectedLayout.instructionTemplates', icon: FileText },
  { href: '/ai-bot/dynamic-context-codes', label: 'protectedLayout.dynamicContextCodes', icon: Code2 },
  { href: '/ai-bot/tools', label: 'protectedLayout.aiBotTools', icon: Wrench },
];

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading, logout, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-white">{t('protectedLayout.loading')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const isActive = (href: string) =>
    pathname === href || (href !== '/telephony' && pathname.startsWith(`${href}/`));

  const navLink = (item: NavItem) => (
    <a
      key={item.href}
      href={item.href}
      className={`nav-item${isActive(item.href) ? ' active' : ''}`}
      onClick={() => setSidebarOpen(false)}
    >
      <item.icon />
      {t(item.label)}
    </a>
  );

  const initial = (user?.username || '?').charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-slate-900">
      {/* Mobile top bar */}
      <div className="side md:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label={t('protectedLayout.openMenu')}
          className="icon-btn"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="logoplate">
          <img src="/logo.png" alt="Arzoom" />
        </span>
        <div className="w-8" />
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
        className={`side fixed md:sticky md:top-0 md:h-screen inset-y-0 left-0 z-50 w-64 flex flex-col transform transition-transform duration-200 ease-in-out md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 pt-5 pb-3 flex items-start justify-between">
          <div>
            <span className="logoplate">
              <img src="/logo.png" alt="Arzoom" />
            </span>
            <p className="brand-sub mt-3">{t('protectedLayout.brandSub')}</p>
          </div>
          <span className="md:hidden">
            <button
              onClick={() => setSidebarOpen(false)}
              aria-label={t('protectedLayout.closeMenu')}
              className="icon-btn"
            >
              <X className="h-5 w-5" />
            </button>
          </span>
        </div>

        <nav className="flex-1 px-3 pb-4 overflow-y-auto">
          <p className="sec">{t('protectedLayout.mainSection')}</p>
          <div className="space-y-1">{mainNav.map(navLink)}</div>
          {/* Asterisk/PBX config and AI-engineering are admin-only domains. */}
          {user?.role === 'admin' && (
            <>
              <p className="sec">{t('protectedLayout.telephonySection')}</p>
              <div className="space-y-1">{telephonyNav.map(navLink)}</div>
              <p className="sec">{t('protectedLayout.aiBotSection')}</p>
              <div className="space-y-1">{aiBotNav.map(navLink)}</div>
            </>
          )}
          <div className="mt-3 space-y-1">
            {navLink({ href: '/admin', label: 'protectedLayout.admin', icon: Shield })}
          </div>
        </nav>

        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between px-1">
            <LanguageSwitcher />
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#6f7aa3]">v2.0.1</span>
              <ThemeToggle className="icon-btn" label={t('protectedLayout.themeToggle')} />
            </div>
          </div>
          <div className="me">
            <span className="av">{initial}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-bold text-[#fff]">{user?.username}</p>
              {user && (
                <p className="truncate text-xs capitalize text-[#8f9ac4]">
                  {t('protectedLayout.role')}: {user.role}
                </p>
              )}
            </div>
            <button
              onClick={async () => {
                await logout();
                router.push('/login');
              }}
              aria-label={t('protectedLayout.logout')}
              title={t('protectedLayout.logout')}
              className="icon-btn"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 overflow-auto bg-slate-900 pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
