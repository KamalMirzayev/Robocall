'use client';

import { useLanguage } from '@/lib/language';

export default function AIBotPage() {
  const { t } = useLanguage();

  const links = [
    { href: '/ai-bot/intents', title: t('aiBot.links.intents.title'), desc: t('aiBot.links.intents.desc') },
    { href: '/ai-bot/responses', title: t('aiBot.links.responses.title'), desc: t('aiBot.links.responses.desc') },
    { href: '/ai-bot/scenarios', title: t('aiBot.links.scenarios.title'), desc: t('aiBot.links.scenarios.desc') },
    { href: '/ai-bot/status-categories', title: t('aiBot.links.statusCategories.title'), desc: t('aiBot.links.statusCategories.desc') },
    { href: '/ai-bot/tools', title: t('aiBot.links.tools.title'), desc: t('aiBot.links.tools.desc') },
  ];

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">{t('aiBot.heading')}</h1>
        <p className="text-gray-400 mt-2">
          {t('aiBot.subtitle')}
        </p>
      </div>

      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-3">{t('aiBot.instructionTemplatesTitle')}</h2>
        <p className="text-sm text-gray-400">
          {t('aiBot.instructionTemplatesDesc')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {links.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="bg-slate-800 border border-slate-700 hover:border-slate-500 rounded-lg p-5 transition"
          >
            <h3 className="text-white font-semibold">{item.title}</h3>
            <p className="text-sm text-gray-400 mt-1">{item.desc}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
