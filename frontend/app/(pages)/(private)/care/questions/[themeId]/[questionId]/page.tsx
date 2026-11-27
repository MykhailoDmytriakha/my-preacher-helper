'use client';

import { ArrowsRightLeftIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ScriptureLinksInWindow } from '@/components/bible/VerseWindow';
import { ActionsMenu } from '@/components/hardQuestions/ActionsMenu';
import { BasisLine } from '@/components/hardQuestions/BasisPlaces';
import { MoveQuestionDialog } from '@/components/hardQuestions/dialogs';
import {
  BackLink, ListLabel, NO_THEME_SEGMENT, PRIMARY_BUTTON, questionPath, QUIET_BUTTON, sectionPath, themePath,
} from '@/components/hardQuestions/parts';
import { QUESTION_FORM_FIELDS, QUESTION_FORM_SLOT, QuestionEditor } from '@/components/hardQuestions/QuestionEditor';
import { ScripturePlaces } from '@/components/hardQuestions/ScripturePlaces';
import { EngineReadingStatus, OrphanDraftWords, UnsavedDraftNotice, useRouteSegment } from '@/components/hardQuestions/useEngineForm';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import { usePublishShellTitle } from '@/components/navigation/shellTitles';
import { RecordUnavailable } from '@/components/RecordUnavailable';
import { DataDocumentProvider, useDataDocument } from '@/data-engine/react.client';
import { useConfirm } from '@/hooks/useConfirm';
import { useHardQuestions } from '@/hooks/useHardQuestions';
import { isWaiting, placeOf, readQuestion } from '@/utils/hardQuestions';
import { useTranslation } from '@locales/useTranslation';

import '@locales/i18n';

/**
 * ONE HARD QUESTION — what the pastor opens when he is asked again: the short answer first (what
 * to say in a minute), the bases it rests on, the places of Scripture with their words, then the
 * detail and where churches decide differently. «Изменить» turns the page into its form.
 *
 * The address carries the question's theme (`/care/questions/<theme>/<question>`), so the trail
 * reads «Сложные вопросы / Одежда / …». A question moved to another theme, or whose theme is gone,
 * is sent to its right address; a question with no theme lives under `none`.
 *
 * Laid out as the theme's and the basis's pages (the owner, 2026-11-26): the same column; under the title its number
 * in the theme and its group; «Изменить» in sight — a question is where the answer is written, the action done
 * often — and moving and removing behind «⋯»; the bases it rests on listed with their places, as in the section's
 * list; its sections as chapters.
 */
export default function HardQuestionPage() {
  const questionId = useRouteSegment('questionId', 3);
  return (
    <ScriptureLinksInWindow>
      {questionId ? (
        <DataDocumentProvider resource={{ collection: 'hardQuestions', id: questionId }} options={{ readOnlyCopy: true }}>
          <QuestionWorkspace questionId={questionId} />
        </DataDocumentProvider>
      ) : null}
    </ScriptureLinksInWindow>
  );
}

function QuestionWorkspace({ questionId }: { questionId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const themeSegment = useRouteSegment('themeId', 2);
  const document = useDataDocument({ collection: 'hardQuestions', id: questionId });
  const section = useHardQuestions();
  const { library } = section;
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(searchParams?.get('edit') === '1');
  const [recoverId, setRecoverId] = useState<string | null>(null);
  const [reviewRequestId, setReviewRequestId] = useState<string>();
  const resource = useMemo(() => ({ collection: 'hardQuestions', id: questionId }), [questionId]);
  const [moving, setMoving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const question = useMemo(() => (document.data ? readQuestion(document.data, questionId) : null), [document.data, questionId]);
  // Kept by value: the places are read out of these words, and a new array each render would read them again.
  const answerTexts = useMemo(() => [question?.short, question?.detail, question?.differ], [question?.short, question?.detail, question?.differ]);
  const listedRefs = useMemo(() => question?.scriptureRefs ?? [], [question?.scriptureRefs]);
  const place = question ? placeOf(library, question) : null;
  const theme = place?.view?.theme ?? null;
  const backHref = theme ? themePath(theme.id) : sectionPath;
  usePublishShellTitle('hardQuestions', questionId, question);
  usePublishShellTitle('hardQuestionThemes', theme?.id ?? null, theme);

  // The right address for where the question stands now: its theme moved, or the theme is gone.
  const canonical = question && section.complete ? questionPath(question, Boolean(theme)) : null;
  useEffect(() => {
    if (!canonical || removing) return;
    const expected = canonical.split('/')[3];
    if (themeSegment && decodeURIComponent(expected) !== themeSegment) router.replace(canonical + (editing ? '?edit=1' : ''));
  }, [canonical, themeSegment, router, editing, removing]);

  const remove = async () => {
    if (!question) return;
    const ok = await confirm({
      title: { key: 'hardQuestions.question.removeTitle' },
      description: { key: 'hardQuestions.question.removeDescription', values: { title: question.title } },
      confirmText: { key: 'common.delete' },
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await section.removeQuestion(questionId);
      router.replace(backHref);
    } catch {
      setRemoving(false);
      toast.error(t('hardQuestions.saveFailed'));
    }
  };

  const absent = !question && (document.presence.kind === 'absent' || document.presence.kind === 'deleting');
  // Deleted while being edited: the form stays open with the words in it (Codex review, round 2).
  if (!question && editing) {
    return (
      <div className="mx-auto w-full max-w-4xl pb-10">
        <BackLink href={themeSegment && themeSegment !== NO_THEME_SEGMENT ? themePath(themeSegment) : sectionPath}>{t('hardQuestions.title')}</BackLink>
        <QuestionEditor questionId={questionId} bases={[]} recoverId={recoverId} gone={absent} onDone={() => { setEditing(false); setRecoverId(null); setReviewRequestId(undefined); }} />
      </div>
    );
  }
  if (!question) {
    return (
      // The shared placeholder carries its own way back; a second link beside it said the same twice.
      <div className="mx-auto w-full max-w-4xl">
        <div>
          <RecordUnavailable presence={document.presence} checking={!absent && document.loading} pageLoading={document.loading}
            onBack={() => router.push(themeSegment && themeSegment !== NO_THEME_SEGMENT ? themePath(themeSegment) : sectionPath)} onRetry={() => document.retry()} />
          {absent && <OrphanDraftWords resource={resource} slot={QUESTION_FORM_SLOT} selection={QUESTION_FORM_FIELDS} />}
        </div>
      </div>
    );
  }

  const waiting = isWaiting(question);
  // The number the theme gives it — the same «вопрос 13» as on the theme's and the basis's pages.
  const number = place?.view ? place.view.questions.findIndex((each) => each.id === question.id) + 1 : 0;
  const where = theme
    ? [number ? t('hardQuestions.question.numbered', { number }) : t('hardQuestions.question.kind'), place?.group?.title].filter(Boolean).join(' · ')
    : t('hardQuestions.withoutTheme');
  return (
    <div className="mx-auto w-full max-w-4xl pb-10">
      <BackLink href={backHref}>{theme ? theme.title : t('hardQuestions.title')}</BackLink>
      {!editing && (
        <>
          <EngineReadingStatus document={document} onReview={(requestId) => { setReviewRequestId(requestId); setEditing(true); }} />
          {!document.readOnly && (
            <UnsavedDraftNotice resource={resource} slot={QUESTION_FORM_SLOT} selection={QUESTION_FORM_FIELDS}
              onResume={(draftId) => { setRecoverId(draftId); setEditing(true); }} />
          )}
        </>
      )}

      {editing ? (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{where}</p>
      ) : (
        // As the theme's header: a phone puts the actions under the lines; a wider screen beside the title.
        <header className="mt-3 grid gap-x-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <h1 className="min-w-0 break-words text-2xl font-extrabold tracking-tight text-gray-900 sm:col-start-1 sm:row-start-1 sm:text-3xl dark:text-gray-50">{question.title}</h1>
          <div className="sm:col-start-1 sm:row-start-2">
            <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">{where}</p>
            {(question.alternates ?? []).length > 0 && (
              <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {t('hardQuestions.question.alsoAsked')}{' '}
                {(question.alternates ?? []).map((alternate) => `«${alternate}»`).join(', ')}
              </p>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-1 sm:col-start-2 sm:row-start-1 sm:mt-0 sm:justify-end">
            <button type="button" onClick={() => setEditing(true)} disabled={document.readOnly} className={QUIET_BUTTON}>
              <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />{t('hardQuestions.question.edit')}
            </button>
            <ActionsMenu label={t('hardQuestions.question.actions')} disabled={document.readOnly || removing} actions={[
              { key: 'move', label: t('hardQuestions.question.move'), icon: ArrowsRightLeftIcon, onSelect: () => setMoving(true) },
              { key: 'remove', label: t('hardQuestions.question.removeQuestion'), icon: TrashIcon, onSelect: () => void remove(), danger: true },
            ]} />
          </div>
        </header>
      )}

      {editing ? (
        <QuestionEditor questionId={questionId} bases={theme?.bases ?? []} recoverId={recoverId} reviewRequestId={reviewRequestId} onDone={() => {
          setEditing(false);
          setRecoverId(null);
          setReviewRequestId(undefined);
          if (searchParams?.get('edit')) router.replace(questionPath(question, Boolean(theme)));
        }} />
      ) : (
        <div className="mt-6 flex flex-col gap-10">
          {waiting && (
            <section className="rounded-2xl border border-dashed border-gray-300 p-5 dark:border-gray-700">
              <p className="text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">{t('hardQuestions.question.noAnswer')}</p>
              <button type="button" onClick={() => setEditing(true)} disabled={document.readOnly} className={`${PRIMARY_BUTTON} mt-4`}>
                {t('hardQuestions.question.startAnswer')}
              </button>
            </section>
          )}

          {question.short && (
            <section aria-labelledby="hq-short" className="rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4 dark:border-gray-700/80 dark:bg-gray-800/50">
              <h2 id="hq-short" className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('hardQuestions.question.short')}</h2>
              <MarkdownDisplay content={question.short} className="mt-1.5 text-[16px] leading-relaxed text-gray-900 dark:text-gray-50" />
            </section>
          )}

          {place && place.bases.length > 0 && theme && (
            <section aria-labelledby="hq-bases">
              <ListLabel id="hq-bases" chapter title={t('hardQuestions.question.restsOn')}
                count={place.bases.length} countLabel={t('hardQuestions.counts.bases', { count: place.bases.length })} />
              {/* Each basis with its places, as in the section's list: a place opens in the verse window. */}
              <ul className="mt-2.5 divide-y divide-gray-100 rounded-2xl border border-gray-200 px-4 py-1 dark:divide-gray-800/70 dark:border-gray-800">
                {place.bases.map((basis) => <BasisLine key={basis.id} themeId={theme.id} basis={basis} />)}
              </ul>
            </section>
          )}

          <ScripturePlaces chapter title={t('hardQuestions.basis.places')} refs={listedRefs} texts={answerTexts} />

          {!waiting && (
            <section aria-labelledby="hq-detail">
              <ListLabel id="hq-detail" chapter title={t('hardQuestions.question.detail')} />
              {question.detail ? (
                <MarkdownDisplay content={question.detail} className="mt-2 text-[15px] leading-relaxed" />
              ) : (
                <div className="mt-2">
                  <p className="text-sm text-gray-600 dark:text-gray-400">{t('hardQuestions.question.onlyShort')}</p>
                  <button type="button" onClick={() => setEditing(true)} disabled={document.readOnly} className={`${QUIET_BUTTON} -ml-3`}>
                    {t('hardQuestions.question.writeDetail')}
                  </button>
                </div>
              )}
            </section>
          )}

          {question.differ && (
            <section aria-labelledby="hq-differ" className="rounded-xl border border-dashed border-gray-300 px-4 py-3.5 dark:border-gray-700">
              <h2 id="hq-differ" className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('hardQuestions.question.differ')}</h2>
              <MarkdownDisplay content={question.differ} className="mt-1.5 text-sm" compact />
            </section>
          )}
        </div>
      )}

      {moving && (
        <MoveQuestionDialog library={library} question={question} onClose={() => setMoving(false)}
          onMove={async (themeId, groupId) => {
            try {
              await section.placeQuestion(questionId, themeId, groupId, question.themeId ?? null);
            } catch {
              // Not moved (removed elsewhere, or a save waiting on it): said, and the window stays with its choice.
              toast.error(t('hardQuestions.saveFailed'));
              return;
            }
            setMoving(false);
            router.replace(questionPath({ id: questionId, themeId }, Boolean(themeId)));
          }} />
      )}
      {confirmDialog}
    </div>
  );
}
