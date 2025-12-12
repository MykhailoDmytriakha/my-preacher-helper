import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DocumentIcon, LightBulbIcon, MicrophoneIcon, SwitchViewIcon } from '@components/Icons';

export default function FeatureCards() {
  const { t } = useTranslation();

  const cards = useMemo(
    () => [
      {
        icon: <MicrophoneIcon className="h-5 w-5 text-blue-600 dark:text-blue-300" />,
        title: t('featureCards.recordingTitle'),
        description: t('featureCards.recordingDescription'),
        accent: 'from-blue-500/10 via-blue-500/5 to-transparent',
        badge: t('landing.valueCapture'),
      },
      {
        icon: <LightBulbIcon className="h-5 w-5 text-amber-600 dark:text-amber-300" />,
        title: t('featureCards.structuringTitle'),
        description: t('featureCards.structuringDescription'),
        accent: 'from-amber-500/10 via-amber-500/5 to-transparent',
        badge: t('landing.valueStructure'),
      },
      {
        icon: <DocumentIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />,
        title: t('featureCards.analysisTitle'),
        description: t('featureCards.analysisDescription'),
        accent: 'from-emerald-500/10 via-emerald-500/5 to-transparent',
        badge: t('landing.valueDeliver'),
      },
      {
        icon: <SwitchViewIcon className="h-5 w-5 text-purple-600 dark:text-purple-300" />,
        title: t('featureCards.handOffTitle'),
        description: t('featureCards.handOffDescription'),
        accent: 'from-purple-500/10 via-purple-500/5 to-transparent',
        badge: t('featureCards.handOffBadge'),
      },
    ],
    [t]
  );

  return (
    <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
      {cards.map((card) => (
        <div
          key={card.title}
          className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-md shadow-blue-50 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-blue-100 dark:border-white/10 dark:bg-white/5 dark:shadow-none"
        >
          <div className={`absolute inset-0 bg-gradient-to-br ${card.accent} opacity-80 transition group-hover:opacity-100 dark:opacity-60`} />
          <div className="relative space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm shadow-blue-100 dark:bg-white/10">
                {card.icon}
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm dark:bg-white/10 dark:text-white">
                <span suppressHydrationWarning={true}>{card.badge}</span>
              </span>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
                <span suppressHydrationWarning={true}>{card.title}</span>
              </h3>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                <span suppressHydrationWarning={true}>{card.description}</span>
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}