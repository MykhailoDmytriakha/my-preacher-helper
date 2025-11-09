'use client';

import { useTranslation } from 'react-i18next';
import '@locales/i18n';

const focusKeys = ['design', 'build', 'export'] as const;

export default function GroupsPage() {
  const { t } = useTranslation();
  const focusItems = focusKeys.map((key) => t(`workspaces.groups.items.${key}`));

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-purple-500">
          {t('workspaces.groups.badge')}
        </p>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {t('workspaces.groups.title')}
        </h1>
        <p className="text-base text-gray-600 dark:text-gray-300 max-w-2xl">
          {t('workspaces.groups.description')}
        </p>
      </header>

      <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white/40 p-6 shadow-sm dark:bg-gray-900/40">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('workspaces.groups.listTitle')}
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-gray-700 dark:text-gray-300">
          {focusItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl bg-purple-50 p-6 text-purple-900 dark:bg-purple-950/40 dark:text-purple-100">
        <p className="font-medium">{t('workspaces.groups.ctaTitle')}</p>
        <p className="text-sm opacity-80">{t('workspaces.groups.ctaDescription')}</p>
      </div>
    </section>
  );
}
