'use client';

import { ArrowsUpDownIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { ScriptureLinksInWindow } from '@/components/bible/VerseWindow';
import { ActionsMenu } from '@/components/hardQuestions/ActionsMenu';
import { BasisPlaces } from '@/components/hardQuestions/BasisPlaces';
import { GroupDialog, NewQuestionDialog } from '@/components/hardQuestions/dialogs';
import {
  BackLink, BASIS_DOT, basisPath, DANGER_BUTTON, HelpMark, ListLabel, PANEL, PRIMARY_BUTTON, questionPath, QuestionRow, QUIET_BUTTON, QUIET_PRESSED,
  sectionPath,
} from '@/components/hardQuestions/parts';
import { ReturnedGroupQuestion } from '@/components/hardQuestions/ReturnedGroupQuestion';
import { EditBasisDialog, NewBasisDialog, THEME_FORM_FIELDS, THEME_FORM_SLOT, ThemeEditDialog } from '@/components/hardQuestions/themeForms';
import { EngineReadingStatus, OrphanDraftWords, UnsavedDraftNotice, useRouteSegment } from '@/components/hardQuestions/useEngineForm';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import { usePublishShellTitle } from '@/components/navigation/shellTitles';
import { RecordUnavailable } from '@/components/RecordUnavailable';
import ConfirmModal from '@/components/ui/ConfirmModal';
import hoverActions from '@/components/ui/HoverActions.module.css';
import { ReorderArrows } from '@/components/ui/ReorderArrows';
import { DragHandle, SortableList } from '@/components/ui/SortableList';
import { DataCollectionStatus } from '@/data-engine/DataCollectionStatus';
import { DataDocumentProvider, useDataDocument } from '@/data-engine/react.client';
import { useConfirm } from '@/hooks/useConfirm';
import { useHardQuestions } from '@/hooks/useHardQuestions';
import { buildLibrary, placeOf, readTheme, type BasisUse, type QuestionBucket } from '@/utils/hardQuestions';
import { useTranslation } from '@locales/useTranslation';

import '@locales/i18n';

type Dialog =
  | { kind: 'question'; groupId?: string }
  | { kind: 'edit'; recoverId?: string }
  | { kind: 'group'; groupId?: string; title?: string }
  | { kind: 'basis' }
  | { kind: 'edit-basis'; basisId: string; requestId?: string }
  | { kind: 'remove' };

/**
 * ONE THEME — a teaching, not a folder: its opening words, its bases (the positions with their
 * places of Scripture on which its answers rest), then its questions by group, numbered as the
 * theme reads («see question 13» in an answer finds the 13th). One view: a second one, «Читать целиком»
 * (the whole theme as one text), was removed at the owner's word, 2026-11-26.
 *
 * Everything here is changed in place: questions are added into a group (its header's «+»); a group is made from
 * the theme's «⋯» menu («Новая группа», brought into sight once made — `useGroupArrival`) or named in the new question's
 * window; groups and bases are added, renamed, removed and rearranged («Переставить» on the bases' line, where the owner
 * moved it from the theme's header, 2026-11-26: a basis or a question is dragged by its grip, or stepped
 * with its arrows; a group with its arrows). Removing a group, a basis or the theme never removes a question: it stays,
 * without a group, a basis or a theme.
 */
/** How long a group made from the theme's menu stays lit once brought into sight. */
const GROUP_LIT_MS = 2200;

/**
 * A group made from the theme's menu lands last — on a long theme, screens below the button (the owner could not find the
 * old «+ Группа» under the last group, 2026-11-26: it stood 5.8 screens down). Once the new group is on the page it
 * is brought to the middle of the screen and lit a moment, so the eye sees where it stood. A group named like one the
 * theme has is that group (`addGroup`): it is the one brought.
 */
function useGroupArrival(groupIds: readonly string[]) {
  const [arrival, setArrival] = useState<string | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  const shown = arrival !== null && groupIds.includes(arrival);
  useEffect(() => {
    if (!arrival || !shown) return undefined;
    const bring = window.setTimeout(() => {
      const target = Array.from(window.document.querySelectorAll<HTMLElement>('[data-group-id]')).find((each) => each.dataset.groupId === arrival);
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target?.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' });
      setLit(arrival);
      setArrival(null);
    }, 50);
    return () => window.clearTimeout(bring);
  }, [arrival, shown]);
  useEffect(() => {
    if (!lit) return undefined;
    const leave = window.setTimeout(() => setLit(null), GROUP_LIT_MS);
    return () => window.clearTimeout(leave);
  }, [lit]);
  return { lit, arrive: setArrival };
}

export default function HardQuestionThemePage() {
  const themeId = useRouteSegment('themeId', 2);
  return (
    <ScriptureLinksInWindow>
      {themeId ? (
        <DataDocumentProvider resource={{ collection: 'hardQuestionThemes', id: themeId }} options={{ readOnlyCopy: true }}>
          <ThemeWorkspace themeId={themeId} />
        </DataDocumentProvider>
      ) : null}
    </ScriptureLinksInWindow>
  );
}

function ThemeWorkspace({ themeId }: { themeId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const document = useDataDocument({ collection: 'hardQuestionThemes', id: themeId });
  const section = useHardQuestions();
  const { library } = section;
  // The theme from the list, else from its own document: a copy of the theme on the device is shown even
  // while the list is not read yet (Codex review, 2026-11-25).
  const docTheme = useMemo(() => (document.data ? readTheme(document.data, themeId) : null), [document.data, themeId]);
  const view = library.themeById.get(themeId)
    ?? (docTheme ? buildLibrary([docTheme], [...library.questionById.values()]).themeById.get(themeId) ?? null : null);
  const [arranging, setArranging] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [removing, setRemoving] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const resource = useMemo(() => ({ collection: 'hardQuestionThemes', id: themeId }), [themeId]);
  const groupArrival = useGroupArrival((view?.theme.groups ?? []).map((group) => group.id));
  usePublishShellTitle('hardQuestionThemes', themeId, view?.theme ?? null);

  const failed = () => toast.error(t('hardQuestions.saveFailed'));
  const attempt = (work: Promise<unknown>) => { void work.catch(failed); };

  const gone = document.presence.kind === 'absent';
  const withThemeEditor = (page: ReactNode) => (
    <>
      {page}
      {dialog?.kind === 'edit' && <ThemeEditDialog themeId={themeId} recoverId={dialog.recoverId} gone={gone} onClose={() => setDialog(null)} />}
    </>
  );

  if (gone || !view) {
    const absent = gone || document.presence.kind === 'deleting';
    return withThemeEditor(
      <div className="mx-auto w-full max-w-4xl">
        <div>
          <RecordUnavailable presence={document.presence} checking={!absent && (document.loading || section.loading)} pageLoading={document.loading || section.loading}
            onBack={() => router.push(sectionPath)} onRetry={() => document.retry()} />
          {/* A theme removed elsewhere keeps the words its form left unsent here, to copy — as the question's and the
              basis's pages do (Codex review 2026-11-27). */}
          <ReturnedGroupQuestion themeId={themeId} />
          {absent && dialog?.kind !== 'edit' && <OrphanDraftWords resource={resource} slot={THEME_FORM_SLOT} selection={THEME_FORM_FIELDS} />}
        </div>
      </div>
    );
  }

  const { theme } = view;
  const groupsCount = (theme.groups ?? []).length;
  const removeGroup = async (bucket: QuestionBucket) => {
    if (!bucket.group) return;
    const ok = await confirm({
      title: { key: 'hardQuestions.theme.removeGroupTitle', values: { title: bucket.group.title } },
      description: bucket.questions.length ? { key: 'hardQuestions.theme.removeGroupKeeps', values: { count: String(bucket.questions.length) } } : { key: 'hardQuestions.theme.removeGroupEmpty' },
      confirmText: { key: 'common.delete' },
    });
    if (ok) attempt(section.removeGroup(themeId, bucket.group.id));
  };
  const removeTheme = async () => {
    setRemoving(true);
    try {
      await section.removeTheme(themeId);
      router.replace(sectionPath);
    } catch {
      setRemoving(false);
      failed();
    }
  };

  let number = 0;
  return withThemeEditor(
    <div className="mx-auto w-full max-w-4xl pb-10">
      <BackLink href={sectionPath}>{t('hardQuestions.title')}</BackLink>
      <EngineReadingStatus document={document} onReview={() => setDialog({ kind: 'edit' })}
        onReviewBasis={(basisId, requestId) => setDialog({ kind: 'edit-basis', basisId, requestId })}
        reviewing={dialog?.kind === 'edit' || dialog?.kind === 'edit-basis'} />
      <DataCollectionStatus state={section.questionsState} />
      <ReturnedGroupQuestion themeId={themeId} />
      {!document.readOnly && dialog?.kind !== 'edit' && (
        <UnsavedDraftNotice resource={resource} slot={THEME_FORM_SLOT} selection={THEME_FORM_FIELDS} onResume={(draftId) => setDialog({ kind: 'edit', recoverId: draftId })} />
      )}

      {/* The theme's own actions (the owner chose this from a board, 2026-11-26): «+ Вопрос», the one done often, in
          sight; a new group, the theme's edit and its removal behind «⋯» — the same on a mouse and on touch. A phone
          puts the two under the counts; a wider screen beside the title. */}
      <header className="mt-3 grid gap-x-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <h1 className="min-w-0 break-words text-2xl font-extrabold tracking-tight text-gray-900 sm:col-start-1 sm:row-start-1 sm:text-3xl dark:text-gray-50">{theme.title}</h1>
        <p className="mt-1.5 text-sm text-gray-600 sm:col-start-1 sm:row-start-2 dark:text-gray-400">
          {[t('hardQuestions.counts.questions', { count: view.questions.length }),
            groupsCount ? t('hardQuestions.counts.groups', { count: groupsCount }) : null,
            (theme.bases ?? []).length ? t('hardQuestions.counts.bases', { count: (theme.bases ?? []).length }) : null,
            view.waiting ? t('hardQuestions.counts.waiting', { count: view.waiting }) : null].filter(Boolean).join(' · ')}
        </p>
        <div className="mt-3 flex items-center justify-between gap-1 sm:col-start-2 sm:row-start-1 sm:mt-0 sm:justify-end">
          <button type="button" onClick={() => setDialog({ kind: 'question' })} disabled={document.readOnly} className={`${PRIMARY_BUTTON} shrink-0`}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" />{t('hardQuestions.addQuestion')}
          </button>
          <ActionsMenu label={t('hardQuestions.theme.actions')} disabled={document.readOnly} actions={[
            { key: 'group', label: t('hardQuestions.dialogs.newGroup'), icon: PlusIcon, onSelect: () => setDialog({ kind: 'group' }) },
            { key: 'edit', label: t('hardQuestions.theme.edit'), icon: PencilSquareIcon, onSelect: () => setDialog({ kind: 'edit' }) },
            { key: 'remove', label: t('hardQuestions.theme.remove'), icon: TrashIcon, onSelect: () => setDialog({ kind: 'remove' }), danger: true },
          ]} />
        </div>
      </header>

      {theme.intro && <MarkdownDisplay content={theme.intro} className="mt-5 text-[15px] leading-relaxed" />}

      {/* A section's own actions show while the pointer is over the section — its heading and all below it (the
          owner, 2026-11-26: «эти кнопки появляются при наведении на секцию»); on touch they stay; «Готово» stays. */}
      <section aria-labelledby="hq-bases" className={`mt-10 ${hoverActions.row}`}>
        <ListLabel id="hq-bases" chapter title={t('hardQuestions.theme.bases')}
          count={view.bases.length} countLabel={t('hardQuestions.counts.bases', { count: view.bases.length })}
          help={<HelpMark label={t('hardQuestions.theme.basesHelpLabel')} text={t('hardQuestions.theme.basesHelp')} />}
          action={(
            <span className={`flex items-center ${arranging ? '' : hoverActions.actions}`}>
              {/* Arranges the whole theme — its bases, groups and questions; on a phone the arrows alone say it. */}
              <button type="button" onClick={() => setArranging((value) => !value)} aria-pressed={arranging} disabled={document.readOnly}
                className={`${QUIET_BUTTON} min-h-9 px-2 sm:px-3 ${arranging ? QUIET_PRESSED : ''}`}>
                <ArrowsUpDownIcon className="h-4 w-4" aria-hidden="true" />
                <span className={arranging ? undefined : 'sr-only sm:not-sr-only'}>{arranging ? t('common.done') : t('hardQuestions.arrange')}</span>
              </button>
              <button type="button" onClick={() => setDialog({ kind: 'basis' })} disabled={document.readOnly} className={`${QUIET_BUTTON} min-h-9`}>
                <PlusIcon className="h-4 w-4" aria-hidden="true" />{t('hardQuestions.theme.addBasis')}
              </button>
            </span>
          )} />
        {view.bases.length ? (
          <>
            {arranging ? (
              <SortableList items={view.bases.map((use) => ({ id: use.basis.id, use }))} layout="grid" className="mt-2.5 grid gap-2.5 sm:grid-cols-2"
                onMove={(id, onto, side) => section.moveBasis(themeId, id, { onto, side }).catch(failed)}
                renderItem={({ use }, index, handle, overlay) => (
                  <BasisCard themeId={themeId} use={use} overlay={overlay}
                    leading={<DragHandle label={`${t('hardQuestions.drag')}: ${use.basis.title}`} handle={handle} />}
                    trailing={<ReorderArrows canMoveUp={index > 0} canMoveDown={index < view.bases.length - 1}
                      onMoveUp={() => attempt(section.moveBasis(themeId, use.basis.id, -1))} onMoveDown={() => attempt(section.moveBasis(themeId, use.basis.id, 1))}
                      upLabel={t('common.moveUp')} downLabel={t('common.moveDown')} />} />
                )} />
            ) : (
              <ul className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                {view.bases.map((use) => <li key={use.basis.id}><BasisCard themeId={themeId} use={use} /></li>)}
              </ul>
            )}
          </>
        ) : (
          <p className="mt-2 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-[13px] leading-relaxed text-gray-600 dark:border-gray-700 dark:text-gray-400">
            {t('hardQuestions.theme.noBases')}
          </p>
        )}
      </section>

      {view.buckets.map((bucket, bucketIndex) => {
        const groups = theme.groups ?? [];
        const groupIndex = bucket.group ? groups.findIndex((group) => group.id === bucket.group?.id) : -1;
        const title = bucket.group ? bucket.group.title : groupsCount ? t('hardQuestions.withoutGroup') : t('hardQuestions.theme.questions');
        const addLabel = bucket.group ? t('hardQuestions.theme.addToGroupNamed', { title: bucket.group.title })
          : groupsCount ? t('hardQuestions.theme.addWithoutGroup') : t('hardQuestions.theme.addToTheme');
        // Numbered through the groups, as the theme reads: the first question here follows the last one above.
        const first = number;
        number += bucket.questions.length;
        return (
          <section key={bucket.key} aria-labelledby={`hq-bucket-${bucketIndex}`} data-group-id={bucket.group?.id}
            className={`mt-14 rounded-2xl outline outline-2 outline-offset-8 transition-[outline-color] duration-500 ${hoverActions.row} ${
              bucket.group && groupArrival.lit === bucket.group.id ? 'outline-rose-400/70 dark:outline-rose-400/60' : 'outline-transparent'}`}>
            <ListLabel id={`hq-bucket-${bucketIndex}`} chapter title={title}
              count={bucket.questions.length} countLabel={t('hardQuestions.counts.questions', { count: bucket.questions.length })}
              action={arranging ? (bucket.group ? (
                <ReorderArrows canMoveUp={groupIndex > 0} canMoveDown={groupIndex < groups.length - 1}
                  onMoveUp={() => attempt(section.moveGroup(themeId, bucket.group!.id, -1))} onMoveDown={() => attempt(section.moveGroup(themeId, bucket.group!.id, 1))}
                  upLabel={t('hardQuestions.theme.groupUp')} downLabel={t('hardQuestions.theme.groupDown')} />
              ) : undefined) : (
                // The group's edit, delete and «+» wait for the pointer over the group; arranging keeps its arrows in sight.
                <span className={`flex items-center ${hoverActions.actions}`}>
                  {bucket.group && (
                    <span className="flex">
                      <button type="button" onClick={() => setDialog({ kind: 'group', groupId: bucket.group!.id, title: bucket.group!.title })} disabled={document.readOnly}
                        aria-label={t('hardQuestions.theme.renameGroup', { title: bucket.group.title })} className={`${QUIET_BUTTON} min-h-9 px-2`}>
                        <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => void removeGroup(bucket)} disabled={document.readOnly}
                        aria-label={t('hardQuestions.theme.removeGroup', { title: bucket.group.title })} className={`${DANGER_BUTTON} min-h-9 px-2`}>
                        <TrashIcon className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </span>
                  )}
                  {/* A question into this group: the «+» at the header's edge (the owner, 2026-11-26). */}
                  <button type="button" onClick={() => setDialog({ kind: 'question', groupId: bucket.group?.id })} disabled={document.readOnly}
                    aria-label={addLabel} title={addLabel} className={`${QUIET_BUTTON} min-h-9 px-2`}>
                    <PlusIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
              )} />
            {bucket.questions.length ? (
              <div className={`${PANEL} mt-2.5 divide-y divide-gray-100 dark:divide-gray-800`}>
                {arranging ? (
                  <SortableList items={bucket.questions} className="divide-y divide-gray-100 dark:divide-gray-800"
                    onMove={(id, onto, side) => section.moveQuestion(id, { onto, side }).catch(failed)}
                    renderItem={(question, index, handle, overlay) => (
                      <QuestionRow question={question} href={questionPath(question)} number={first + index + 1} bases={placeOf(library, question).bases}
                        className={overlay ? 'rounded-2xl border border-gray-300 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-900' : 'bg-white dark:bg-gray-900'}
                        leading={<DragHandle label={`${t('hardQuestions.drag')}: ${question.title}`} handle={handle} />}
                        trailing={(
                          <span className="flex items-center pr-2">
                            <ReorderArrows canMoveUp={index > 0} canMoveDown={index < bucket.questions.length - 1}
                              onMoveUp={() => attempt(section.moveQuestion(question.id, -1))} onMoveDown={() => attempt(section.moveQuestion(question.id, 1))}
                              upLabel={t('common.moveUp')} downLabel={t('common.moveDown')} />
                          </span>
                        )} />
                    )} />
                ) : bucket.questions.map((question, index) => (
                  <QuestionRow key={question.id} question={question} href={questionPath(question)} number={first + index + 1} bases={placeOf(library, question).bases} />
                ))}
              </div>
            ) : (
              <p className="mt-2.5 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-[13px] text-gray-600 dark:border-gray-700 dark:text-gray-400">
                {t('hardQuestions.theme.noQuestionsHere')}
              </p>
            )}
          </section>
        );
      })}

      {dialog?.kind === 'question' && (
        <NewQuestionDialog library={library} initialThemeId={themeId} initialGroupId={dialog.groupId ?? ''} currentTheme={theme} onClose={() => setDialog(null)}
          onCreate={async (input, then) => {
            try {
              const id = await section.createQuestion(input);
              setDialog(null);
              if (then === 'answer') router.push(`${questionPath({ id, themeId: input.themeId }, Boolean(input.themeId))}?edit=1`);
              else if (!input.themeId || (!input.groupId && !input.newGroupTitle?.trim())) toast.success(t('hardQuestions.recorded'));
            } catch { failed(); }
          }} />
      )}
      {dialog?.kind === 'edit-basis' && <EditBasisDialog themeId={themeId} basisId={dialog.basisId} reviewRequestId={dialog.requestId} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'group' && (
        <GroupDialog initialTitle={dialog.title} groupId={dialog.groupId} groups={theme.groups ?? []} onClose={() => setDialog(null)} onSave={async (title) => {
          try {
            if (dialog.groupId) {
              await section.renameGroup(themeId, dialog.groupId, title);
              setDialog(null);
            } else {
              const id = await section.addGroup(themeId, title);
              setDialog(null);
              groupArrival.arrive(id);
            }
          } catch { failed(); }
        }} />
      )}
      {dialog?.kind === 'basis' && (
        <NewBasisDialog onClose={() => setDialog(null)} onCreate={async (basis) => {
          try {
            await section.saveBasis(themeId, basis);
            setDialog(null);
          } catch { failed(); }
        }} />
      )}
      <ConfirmModal isOpen={dialog?.kind === 'remove'} onClose={() => { if (!removing) setDialog(null); }} onConfirm={() => void removeTheme()}
        title={t('hardQuestions.theme.removeTitle', { title: theme.title })}
        description={view.questions.length ? t('hardQuestions.theme.removeKeeps', { count: view.questions.length }) : t('hardQuestions.theme.removeEmpty')}
        confirmText={t('common.delete')} cancelText={t('common.cancel')} isDeleting={removing} closeDisabled={removing} />
      {confirmDialog}
    </div>
  );
}

/**
 * One basis on the theme's page: its title, its places of Scripture, how many answers rest on it. The whole card opens
 * the basis (its title link is stretched over it); its places lie above that link and open in the verse window.
 */
function BasisCard({ themeId, use, leading, trailing, overlay = false }: {
  themeId: string; use: BasisUse; leading?: ReactNode; trailing?: ReactNode; overlay?: boolean;
}) {
  const { t } = useTranslation();
  const { basis, questions } = use;
  return (
    <div className={`relative flex h-full items-stretch rounded-xl border bg-white transition dark:bg-gray-900 ${overlay
      ? 'border-gray-300 shadow-xl dark:border-gray-600'
      : 'border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700'}`}>
      {leading && <span className="relative z-10 flex items-center pl-1">{leading}</span>}
      <div className="min-w-0 flex-1 px-4 py-3">
        {/* The dot stands at the first line of a title that wraps on a phone, not between its lines. */}
        <Link href={basisPath(themeId, basis.id)}
          className="flex items-start gap-2 text-[15px] font-semibold leading-snug text-gray-900 after:absolute after:inset-0 after:rounded-xl after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-rose-500/40 dark:text-gray-50">
          <span className={`mt-[0.4em] h-2 w-2 shrink-0 rounded-full ${BASIS_DOT}`} aria-hidden="true" /><span className="min-w-0">{basis.title}</span>
        </Link>
        <BasisPlaces refs={basis.scriptureRefs} className="pointer-events-none relative z-10 mt-0.5" />
        <span className="mt-1 block text-[13px] text-gray-600 dark:text-gray-400">{t('hardQuestions.theme.restingOn', { count: questions.length })}</span>
      </div>
      {trailing && <span className="relative z-10 flex items-center pr-1">{trailing}</span>}
    </div>
  );
}
