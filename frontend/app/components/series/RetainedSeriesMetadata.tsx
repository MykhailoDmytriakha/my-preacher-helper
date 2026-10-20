'use client';

import { useClipboard } from '@/hooks/useClipboard';
import { useTranslation } from '@locales/useTranslation';

import type { DocumentData } from '@/data-engine/types';

/** The form owns these words even when its parent record disappears; reading never submits them. */
export function RetainedSeriesMetadata({ value }: { value: DocumentData | null | undefined }) {
  const { t } = useTranslation(), { copyToClipboard, isCopied } = useClipboard();
  if (!value) return null;
  const fields = ['title', 'description', 'bookOrTopic', 'status', 'color'] as const;
  const rows = fields.flatMap(field => typeof value[field] === 'string' && value[field] !== ''
    ? [{ field, label: t(`workspaces.series.form.${field}`), value: field === 'status'
      ? t(`workspaces.series.form.statuses.${String(value[field])}`) : String(value[field]) }] : []);
  if (!rows.length) return null;
  return <section className="space-y-3 rounded-xl border border-amber-300 p-4 dark:border-amber-700" data-retained-series-metadata>
    <h2 className="font-semibold">{t('recordAvailability.keptCopy')}</h2>
    <p className="text-sm">{t('recordAvailability.keptCopyHelp')}</p>
    <dl className="space-y-3">{rows.map(row => <div key={row.field}><dt className="text-sm font-semibold">{row.label}</dt>
      <dd className="whitespace-pre-wrap break-words">{row.value}</dd></div>)}</dl>
    <button type="button" className="rounded-lg border px-3 py-2" onClick={() => { void copyToClipboard(rows.map(row => `${row.label}: ${row.value}`).join('\n\n')); }}>{t(isCopied ? 'common.copied' : 'common.copy')}</button>
  </section>;
}
