'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLanguage } from '@/lib/language';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const timedOut = searchParams.get('reason') === 'timeout';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(username, password);
      router.push('/calls');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.loginFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(380px,520px)_minmax(0,1fr)]">
      <div className="relative grid place-items-center border-r border-slate-700 bg-slate-800 px-6 py-10">
        <div className="absolute right-4 top-4">
          <LanguageSwitcher />
        </div>
        <div className="w-full max-w-[380px]">
          <span className="inline-flex rounded-[9px] bg-[#fff] px-[11px] py-[7px] ring-1 ring-slate-700">
            <img src="/logo.png" alt="Arzoom" className="block h-[19px]" />
          </span>
          <p className="eyebrow mt-8">{t('login.adminPortal')}</p>
          <h1 className="mt-2 text-[30px] font-bold leading-tight text-white">{t('login.title')}</h1>
          <p className="mt-2 text-sm text-slate-400">{t('login.subtitle')}</p>

          {timedOut && !error && (
            <div className="mt-6 rounded-[10px] border border-amber-500/40 bg-amber-950 p-3 text-sm text-amber-300">
              {t('login.timedOut')}
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-[10px] border border-red-500/40 bg-red-950 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
            <label className="grid gap-1.5 text-[12.5px] font-semibold text-slate-400">
              {t('login.username')}
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                autoComplete="username"
                className="w-full rounded-[9px] border border-slate-600 bg-slate-700 px-[13px] py-3 text-sm font-normal text-white placeholder-gray-400 outline-none focus:border-blue-500 disabled:opacity-50"
                placeholder={t('login.usernamePlaceholder')}
              />
            </label>

            <label className="grid gap-1.5 text-[12.5px] font-semibold text-slate-400">
              {t('login.password')}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="current-password"
                className="w-full rounded-[9px] border border-slate-600 bg-slate-700 px-[13px] py-3 text-sm font-normal text-white placeholder-gray-400 outline-none focus:border-blue-500 disabled:opacity-50"
                placeholder={t('login.passwordPlaceholder')}
              />
            </label>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-1 rounded-[10px] bg-blue-600 px-4 py-[13px] text-[15px] font-bold text-[#fff] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isLoading ? t('login.loggingIn') : t('login.loginButton')}
            </button>
          </form>
        </div>
      </div>

      <div className="engine hidden content-center gap-7 px-[clamp(24px,5vw,72px)] py-12 lg:grid">
        <div>
          <p className="eyebrow !text-[#9DB0FF]">{t('login.engineEyebrow')}</p>
          <h2 className="mt-2 max-w-[560px] text-[clamp(26px,2.6vw,38px)] font-bold leading-tight text-[#fff]">
            {t('login.engineTitle')}
          </h2>
          <p className="mt-2.5 max-w-[520px] text-[15px] text-[#A9B3DA]">{t('login.engineText')}</p>
        </div>
        <svg viewBox="0 0 760 260" className="h-auto w-full max-w-[760px]" aria-hidden="true">
          <rect x="20" y="90" width="150" height="80" rx="14" fill="#0F1530" stroke="#2D3758" />
          <text x="95" y="126" textAnchor="middle" fill="#DCE2FF" fontSize="14" fontWeight="700">Kampaniya</text>
          <text x="95" y="148" textAnchor="middle" fill="#8F9AC4" fontSize="12">1 240 nömrə</text>
          <path className="flow" d="M170 130 H300" stroke="#5273FF" strokeWidth="2" fill="none" />
          <circle cx="380" cy="130" r="72" fill="rgb(82 115 255 / .12)" stroke="#5273FF" />
          <circle cx="380" cy="130" r="46" fill="#151B32" stroke="#8E5BFF" />
          <text x="380" y="126" textAnchor="middle" fill="#FFFFFF" fontSize="15" fontWeight="800">AI</text>
          <text x="380" y="145" textAnchor="middle" fill="#9DB0FF" fontSize="11">Səsli agent</text>
          <path className="flow" d="M452 100 C520 60 560 50 600 50" stroke="#6FCF97" strokeWidth="2" fill="none" />
          <path className="flow" d="M452 130 H600" stroke="#E9BE62" strokeWidth="2" fill="none" />
          <path className="flow" d="M452 160 C520 200 560 210 600 210" stroke="#F08A80" strokeWidth="2" fill="none" />
          <rect x="600" y="30" width="140" height="40" rx="10" fill="#0F1530" stroke="#2D3758" />
          <text x="670" y="55" textAnchor="middle" fill="#9DE7BB" fontSize="12.5" fontWeight="700">Ödəniş vədi</text>
          <rect x="600" y="110" width="140" height="40" rx="10" fill="#0F1530" stroke="#2D3758" />
          <text x="670" y="135" textAnchor="middle" fill="#E9BE62" fontSize="12.5" fontWeight="700">Geri zəng</text>
          <rect x="600" y="190" width="140" height="40" rx="10" fill="#0F1530" stroke="#2D3758" />
          <text x="670" y="215" textAnchor="middle" fill="#F08A80" fontSize="12.5" fontWeight="700">Cavab yoxdur</text>
        </svg>
        <div className="flex flex-wrap gap-2.5">
          {['chipCalls', 'chipLang', 'chipRec'].map((key) => (
            <span
              key={key}
              className="rounded-full border border-[rgb(255_255_255/0.14)] bg-[rgb(255_255_255/0.05)] px-[13px] py-[7px] text-[12.5px] text-[#DCE2FF]"
            >
              {t(`login.${key}`)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
