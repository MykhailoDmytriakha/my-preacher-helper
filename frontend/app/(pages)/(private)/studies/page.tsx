'use client';

import { useTranslation } from 'react-i18next';
import '@locales/i18n';

const highlightKeys = ['collect', 'send', 'export'] as const;

export default function StudiesPage() {
  const { t } = useTranslation();
  const highlightItems = highlightKeys.map((key) => t(`workspaces.studies.items.${key}`));

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-500">
          {t('workspaces.studies.badge')}
        </p>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {t('workspaces.studies.title')}
        </h1>
        <p className="text-base text-gray-600 dark:text-gray-300 max-w-2xl">
          {t('workspaces.studies.description')}
        </p>
      </header>

      <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white/40 p-6 shadow-sm dark:bg-gray-900/40">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('workspaces.studies.listTitle')}
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-gray-700 dark:text-gray-300">
          {highlightItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl bg-emerald-50 p-6 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
        <p className="font-medium">{t('workspaces.studies.ctaTitle')}</p>
        <p className="text-sm opacity-80">{t('workspaces.studies.ctaDescription')}</p>
      </div>
    </section>
  );
}
