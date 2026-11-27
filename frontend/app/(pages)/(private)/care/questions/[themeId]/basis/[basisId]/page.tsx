'use client';

import { PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ScriptureLinksInWindow } from '@/components/bible/VerseWindow';
import { ActionsMenu } from '@/components/hardQuestions/ActionsMenu';
import { BackLink, BASIS_DOT, ListLabel, PANEL, questionPath, QuestionRow, QUIET_BUTTON, sectionPath, themePath } from '@/components/hardQuestions/parts';
import { ScripturePlaces } from '@/components/hardQuestions/ScripturePlaces';
import { basisFormFields, basisFormSlot, EditBasisDialog, ThemeEditDialog } from '@/components/hardQuestions/themeForms';
import { EngineReadingStatus, OrphanDraftWords, UnsavedDraftNotice, useRouteSegment } from '@/components/hardQuestions/useEngineForm';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import { usePublishShellTitle } from '@/components/navigation/shellTitles';
import { RecordUnavailable } from '@/components/RecordUnavailable';
import { DataDocumentProvider, useDataDocument } from '@/data-engine/react.client';
import { useConfirm } from '@/hooks/useConfirm';
import { useHardQuestions } from '@/hooks/useHardQuestions';
import { buildLibrary, plainLine, readTheme } from '@/utils/hardQuestions';
import { useTranslation } from '@locales/useTranslation';

import '@locales/i18n';

/**
 * ONE BASIS OF A THEME — a position with its places of Scripture, written once, and every question
 * of the theme whose answer rests on it. Editing it changes what all those answers point to;
 * removing it leaves their words as they are and only takes the pointer away. Laid out as the theme's page is
 * (the owner, 2026-11-26: «те же самые UI UX решения»): the same column, the title with the basis's dot and a line
 * of counts, its edit and removal behind «⋯», its sections as chapters with their counts, the questions numbered
 * as the theme numbers them, and a basis with no place says so (a basis stands on Scripture).
 */
export default function HardQuestionBasisPage() {
  const themeId = useRouteSegment('themeId', 2);
  const basisId = useRouteSegment('basisId', 4);
  return (
    <ScriptureLinksInWindow>
      {themeId && basisId ? (
        <DataDocumentProvider resource={{ collection: 'hardQuestionThemes', id: themeId }} options={{ readOnlyCopy: true }}>
          <BasisWorkspace themeId={themeId} basisId={basisId} />
        </DataDocumentProvider>
      ) : null}
    </ScriptureLinksInWindow>
  );
}

function BasisWorkspace({ themeId, basisId }: { themeId: string; basisId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const document = useDataDocument({ collection: 'hardQuestionThemes', id: themeId });
  const section = useHardQuestions();
  const docTheme = useMemo(() => (document.data ? readTheme(document.data, themeId) : null), [document.data, themeId]);
  const view = section.library.themeById.get(themeId)
    ?? (docTheme ? buildLibrary([docTheme], [...section.library.questionById.values()]).themeById.get(themeId) ?? null : null);
  const use = view?.bases.find((item) => item.basis.id === basisId) ?? null;
  const [editing, setEditing] = useState(false);
  const [reviewingTheme, setReviewingTheme] = useState(false);
  const [reviewBasis, setReviewBasis] = useState<{ id: string; requestId?: string } | null>(null);
  const [recoverId, setRecoverId] = useState<string | null>(null);
  const resource = useMemo(() => ({ collection: 'hardQuestionThemes', id: themeId }), [themeId]);
  const selection = useMemo(() => basisFormFields(basisId), [basisId]);
  const [removing, setRemoving] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  usePublishShellTitle('hardQuestionThemes', themeId, view?.theme ?? null);
  usePublishShellTitle('hardQuestionBases', basisId, use?.basis ?? null);
  const texts = useMemo(() => [use?.basis.text], [use?.basis.text]);
  const refs = useMemo(() => use?.basis.scriptureRefs ?? [], [use?.basis.scriptureRefs]);

  if (!view || !use) {
    const themeGone = !view && (document.presence.kind === 'absent' || document.presence.kind === 'deleting');
    const settled = Boolean(view) || themeGone || (!document.loading && !section.loading);
    return (
      <div className="mx-auto w-full max-w-4xl">
        {view && <BackLink href={themePath(themeId)}>{view.theme.title}</BackLink>}
        <div className={view ? 'mt-6' : ''}>
          {view && settled ? (
            // The theme is here, the basis is not: removed (here or on another device) — say so plainly.
            <>
              <p className="text-sm text-gray-700 dark:text-gray-300">{t('hardQuestions.basis.gone')}</p>
              <OrphanDraftWords resource={resource} slot={basisFormSlot(basisId)} selection={selection} />
            </>
          ) : (
            <>
              <RecordUnavailable presence={document.presence} checking={!themeGone && !settled} pageLoading={!settled}
                onBack={() => router.push(sectionPath)} onRetry={() => document.retry()} />
              {themeGone && <OrphanDraftWords resource={resource} slot={basisFormSlot(basisId)} selection={selection} />}
            </>
          )}
        </div>
      </div>
    );
  }

  const { basis, questions } = use;
  const remove = async () => {
    const ok = await confirm({
      title: { key: 'hardQuestions.basis.removeTitle', values: { title: basis.title } },
      description: questions.length ? { key: 'hardQuestions.basis.removeKeeps', values: { count: String(questions.length) } } : { key: 'hardQuestions.basis.removeEmpty' },
      confirmText: { key: 'common.delete' },
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await section.removeBasis(themeId, basisId);
      router.replace(themePath(themeId));
    } catch {
      setRemoving(false);
      toast.error(t('hardQuestions.saveFailed'));
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl pb-10">
      <BackLink href={themePath(themeId)}>{view.theme.title}</BackLink>
      <EngineReadingStatus document={document} onReview={() => setReviewingTheme(true)} onReviewBasis={(id, requestId) => setReviewBasis({ id, requestId })}
        reviewing={reviewingTheme || Boolean(reviewBasis)} />
      {!document.readOnly && !editing && (
        <UnsavedDraftNotice resource={resource} slot={basisFormSlot(basisId)} selection={selection} onResume={(draftId) => { setRecoverId(draftId); setEditing(true); }} />
      )}
      <header className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* The dot is the basis's sign on the theme's page and in the list; it stands at the title's first line. */}
          <h1 className="flex items-start gap-3 break-words text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl dark:text-gray-50">
            <span className={`mt-[0.42em] h-2.5 w-2.5 shrink-0 rounded-full ${BASIS_DOT}`} aria-hidden="true" />
            <span className="min-w-0">{basis.title}</span>
          </h1>
          <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">
            {[t('hardQuestions.basis.kind'), t('hardQuestions.counts.questions', { count: questions.length })].join(' · ')}
          </p>
        </div>
        <ActionsMenu label={t('hardQuestions.basis.actions')} disabled={document.readOnly || removing} actions={[
          { key: 'edit', label: t('hardQuestions.basis.editBasis'), icon: PencilSquareIcon, onSelect: () => setEditing(true) },
          { key: 'remove', label: t('hardQuestions.basis.removeBasis'), icon: TrashIcon, onSelect: () => void remove(), danger: true },
        ]} />
      </header>

      <div className="mt-6 flex flex-col gap-10">
        {basis.text ? (
          <MarkdownDisplay content={basis.text} className="text-[16px] leading-relaxed" />
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 px-4 py-3 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('hardQuestions.basis.noText')}</p>
            <button type="button" onClick={() => setEditing(true)} disabled={document.readOnly} className={`${QUIET_BUTTON} -ml-3`}>
              {t('hardQuestions.basis.writeText')}
            </button>
          </div>
        )}

        <ScripturePlaces chapter title={t('hardQuestions.basis.places')} refs={refs} texts={texts} empty={(
          // A basis stands on Scripture (2026-11-26): one kept without a place asks for it here.
          <div className="mt-2.5 rounded-xl border border-dashed border-gray-300 px-4 py-3 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('hardQuestions.theme.noPlaces')}</p>
            <button type="button" onClick={() => setEditing(true)} disabled={document.readOnly} className={`${QUIET_BUTTON} -ml-3`}>
              {t('hardQuestions.basis.addPlaces')}
            </button>
          </div>
        )} />

        <section aria-labelledby="hq-resting">
          <ListLabel id="hq-resting" chapter title={t('hardQuestions.basis.resting')} count={questions.length} countLabel={t('hardQuestions.counts.questions', { count: questions.length })} />
          {questions.length ? (
            <div className={`${PANEL} mt-2.5 divide-y divide-gray-100 dark:divide-gray-800`}>
              {/* Numbered as the theme numbers them, so «вопрос 13» means the same question here and there. */}
              {questions.map((question) => (
                <QuestionRow key={question.id} question={question} href={questionPath(question)} number={view.questions.indexOf(question) + 1}
                  sub={question.short ? plainLine(question.short) : undefined} />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('hardQuestions.basis.noneResting')}</p>
          )}
        </section>
      </div>

      {reviewBasis && <EditBasisDialog themeId={themeId} basisId={reviewBasis.id} reviewRequestId={reviewBasis.requestId} onClose={() => setReviewBasis(null)} />}
      {reviewingTheme && <ThemeEditDialog themeId={themeId} onClose={() => setReviewingTheme(false)} />}
      {editing && <EditBasisDialog themeId={themeId} basisId={basisId} recoverId={recoverId} onClose={() => { setEditing(false); setRecoverId(null); }} />}
      {confirmDialog}
    </div>
  );
}
