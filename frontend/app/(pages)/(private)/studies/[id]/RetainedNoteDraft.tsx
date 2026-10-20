'use client';

import { Chip } from '@/components/ui/Chip';
import { FoldableMarkdown } from '@/components/ui/FoldableMarkdown';
import { useAppLocale } from '@/hooks/useAppLocale';
import { useClipboard } from '@/hooks/useClipboard';
import { formatStudyNoteForCopy } from '@/utils/studyNoteUtils';
import { useTranslation } from '@locales/useTranslation';

import ScriptureRefBadge from '../ScriptureRefBadge';

import type { NoteDraftPayload } from './noteDraft';

/** A kept copy is readable without adopting it into an absent record or discarding its backup. */
export function RetainedNoteDraft({ draft }: { draft: NoteDraftPayload }) {
  const { t } = useTranslation(), { locale } = useAppLocale();
  const { copyToClipboard, isCopied } = useClipboard();
  const copy = () => copyToClipboard([
    formatStudyNoteForCopy({ ...draft, id: '', userId: '', materialIds: [], relatedSermonIds: [],
      createdAt: '', updatedAt: '', isDraft: true }, locale),
    draft.tags.join(', '),
  ].filter(Boolean).join('\n\n'));
  return <section className="space-y-4 rounded-xl border border-amber-300 p-4 dark:border-amber-700" data-retained-note>
    <h2 className="font-semibold">{t('recordAvailability.keptCopy')}</h2>
    <p className="text-sm text-gray-600 dark:text-gray-300">{t('recordAvailability.keptCopyHelp')}</p>
    {draft.title && <h3 className="text-xl font-bold break-words">{draft.title}</h3>}
    {draft.content && <FoldableMarkdown content={draft.content} />}
    <div className="flex flex-wrap gap-2">{draft.tags.map(tag => <Chip key={tag} tone="emerald">{tag}</Chip>)}</div>
    <div className="flex flex-wrap gap-2">{draft.scriptureRefs.map(ref => <ScriptureRefBadge key={ref.id} reference={ref} />)}</div>
    <button type="button" onClick={() => { void copy(); }} className="rounded-lg border px-3 py-2">{t(isCopied ? 'common.copied' : 'common.copy')}</button>
  </section>;
}
