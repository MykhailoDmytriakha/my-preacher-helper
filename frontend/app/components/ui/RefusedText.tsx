'use client';

import { useTranslation } from '@locales/useTranslation';

export function RefusedText({ versions }: { versions: readonly string[] }) {
  const { t } = useTranslation();
  return <details className="mt-1 text-sm text-gray-700 dark:text-gray-300">
    <summary className="cursor-pointer font-medium">{t('dataSync.refusedInputText')}</summary>
    {versions.map(text => <pre key={text} className="mt-1 whitespace-pre-wrap break-words select-text rounded-md border border-gray-200 p-2 font-sans dark:border-gray-700">
      {text || t('dataSync.emptyField')}
    </pre>)}
  </details>;
}
