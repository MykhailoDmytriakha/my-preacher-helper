'use client';

import { useTranslation } from 'react-i18next';
import '@locales/i18n';

const roadmapKeys = ['plan', 'track', 'share'] as const;

export default function SeriesPage() {
  const { t } = useTranslation();
  const roadmapItems = roadmapKeys.map((key) => t(`workspaces.series.items.${key}`));

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-500">
          {t('workspaces.series.badge')}
        </p>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {t('workspaces.series.title')}
        </h1>
        <p className="text-base text-gray-600 dark:text-gray-300 max-w-2xl">
          {t('workspaces.series.description')}
        </p>
      </header>

      <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white/40 p-6 shadow-sm dark:bg-gray-900/40">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('workspaces.series.listTitle')}
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-gray-700 dark:text-gray-300">
          {roadmapItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl bg-gradient-to-r from-blue-50 to-purple-50 p-6 text-blue-900 dark:from-blue-950/50 dark:to-purple-950/50 dark:text-blue-100">
        <p className="font-medium">{t('workspaces.series.ctaTitle')}</p>
        <p className="text-sm opacity-80">{t('workspaces.series.ctaDescription')}</p>
      </div>
    </section>
  );
}
