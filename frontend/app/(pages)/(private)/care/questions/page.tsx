'use client';

import { ArrowsUpDownIcon, ChevronRightIcon, MagnifyingGlassIcon, PlusIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { ScriptureLinksInWindow } from '@/components/bible/VerseWindow';
import { CareSectionHeader } from '@/components/care/CareSectionHeader';
import { NewQuestionDialog, NewThemeDialog } from '@/components/hardQuestions/dialogs';
import {
  BackLink, CountChip, FIELD, ListLabel, PANEL, PRIMARY_BUTTON, questionPath, QuestionRow, QUIET_BUTTON, QUIET_PRESSED, ROSE, ROW, SECONDARY_BUTTON, themePath,
} from '@/components/hardQuestions/parts';
import { ReturnedGroupQuestion, ReturnedHardQuestionOrder } from '@/components/hardQuestions/ReturnedGroupQuestion';
import { ThemeCard } from '@/components/hardQuestions/ThemeCard';
import { ListReadFeedback } from '@/components/ListReadFeedback';
import { ReorderArrows } from '@/components/ui/ReorderArrows';
import { DragHandle, SortableList } from '@/components/ui/SortableList';
import { DataCollectionStatus } from '@/data-engine/DataCollectionStatus';
import { useAppLocale } from '@/hooks/useAppLocale';
import { useHardQuestions } from '@/hooks/useHardQuestions';
import { useSearchInputQuery } from '@/hooks/useSearchInputQuery';
import { plainLine, searchLibrary, type SearchHit, type ThemeView } from '@/utils/hardQuestions';
import { listReadState } from '@/utils/listReadState';
import { useTranslation } from '@locales/useTranslation';

import '@locales/i18n';

type Dialog = { kind: 'question'; text?: string } | { kind: 'theme' };

/**
 * HARD QUESTIONS — the questions people ask the pastor and the answers he once thought through.
 *
 * The first thing is the search: asked again, he types the words he heard (or the place of
 * Scripture) and the worked answer is there. Below it, what waits for an answer — written down when
 * there was no time — and the themes in his order. A question without a theme stays visible at the
 * bottom. A pastor who starts empty sees what the section is for and two ways in: a theme or a
 * question. (Loading a whole document of questions was taken out on the owner's word, 2026-11-26.)
 */
export default function HardQuestionsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { locale } = useAppLocale();
  const section = useHardQuestions();
  const { library } = section;
  const search = useSearchInputQuery('q');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [arranging, setArranging] = useState(false);
  const query = search.value.trim();
  const hits = query ? searchLibrary(library, query, locale) : [];
  const readState = listReadState(
    { loading: section.loading, complete: Boolean(section.themesState?.complete), error: section.themesState?.error ?? null },
    { loading: section.loading, complete: Boolean(section.questionsState?.complete), error: section.questionsState?.error ?? null },
  );
  const empty = section.complete && !library.themes.length && !library.total;
  const failed = () => toast.error(t('hardQuestions.saveFailed'));

  const whereWords = (hit: SearchHit): string => {
    const theme = hit.theme?.title ?? t('hardQuestions.withoutTheme');
    if (hit.question.short?.trim() && (hit.where === 'title' || hit.where === 'alternate')) return `${theme} · ${plainLine(hit.question.short)}`;
    return `${theme} · ${t(`hardQuestions.search.where.${hit.where}`)}`;
  };

  return (
    <div className="mx-auto w-full max-w-4xl pb-10">
      <BackLink href="/care">{t('careWord.backToCare')}</BackLink>
      <CareSectionHeader
        title={t('care.sections.questions.title')}
        titleClassName={ROSE.title}
        icon={<QuestionMarkCircleIcon className="h-7 w-7 shrink-0" strokeWidth={1.5} aria-hidden="true" />}
        description={t('hardQuestions.subtitle')}
        // A new theme beside «+ Вопрос», at the top — not under the last theme (the owner, 2026-11-27).
        actions={!empty ? (
          <>
            <button type="button" onClick={() => setDialog({ kind: 'theme' })} className={QUIET_BUTTON}>
              <PlusIcon className="h-4 w-4" aria-hidden="true" />{t('hardQuestions.addTheme')}
            </button>
            <button type="button" onClick={() => setDialog({ kind: 'question' })} className={PRIMARY_BUTTON}>
              <PlusIcon className="h-4 w-4" aria-hidden="true" />{t('hardQuestions.addQuestion')}
            </button>
          </>
        ) : undefined}
      />

      <div className="mt-3"><DataCollectionStatus state={section.themesState} /><DataCollectionStatus state={section.questionsState} /></div>
      <ListReadFeedback state={readState} />
      <ReturnedGroupQuestion />
      <ReturnedHardQuestionOrder />

      {empty ? (
        <section className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-gray-300 px-6 py-10 text-center dark:border-gray-700">
          <QuestionMarkCircleIcon className={`h-10 w-10 ${ROSE.icon} opacity-70`} strokeWidth={1.2} aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold text-gray-900 dark:text-gray-50">{t('hardQuestions.empty.title')}</h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-gray-600 dark:text-gray-400">{t('hardQuestions.empty.text')}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => setDialog({ kind: 'theme' })} className={PRIMARY_BUTTON}>
              <PlusIcon className="h-4 w-4" aria-hidden="true" />{t('hardQuestions.addTheme')}
            </button>
            <button type="button" onClick={() => setDialog({ kind: 'question' })} className={SECONDARY_BUTTON}>
              {t('hardQuestions.empty.justQuestion')}
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="relative mt-6">
            <label htmlFor="hq-search" className="sr-only">{t('hardQuestions.search.label')}</label>
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 dark:text-gray-400" aria-hidden="true" />
            <input id="hq-search" ref={search.inputRef} type="search" value={search.value} onChange={(event) => search.setValue(event.target.value)}
              placeholder={t('hardQuestions.search.placeholder')} autoComplete="off" className={`${FIELD} h-11 pl-11`} />
          </div>

          {query ? (
            <section aria-labelledby="hq-found" className="mt-6">
              <ListLabel id="hq-found" title={t('hardQuestions.search.found')} count={hits.length} countLabel={t('hardQuestions.counts.questions', { count: hits.length })} />
              {hits.length ? (
                <div className={`${PANEL} mt-2.5 divide-y divide-gray-100 dark:divide-gray-800`}>
                  {hits.map((hit) => (
                    <QuestionRow key={hit.question.id} question={hit.question} href={questionPath(hit.question, Boolean(hit.theme))} sub={whereWords(hit)} />
                  ))}
                </div>
              ) : (
                <div className="mt-2.5 rounded-2xl border border-dashed border-gray-300 p-4 dark:border-gray-700">
                  <p className="text-sm text-gray-700 dark:text-gray-300">{section.complete ? t('hardQuestions.search.none') : t('hardQuestions.search.notYet')}</p>
                  <button type="button" onClick={() => setDialog({ kind: 'question', text: query })} className={`${QUIET_BUTTON} -ml-3 mt-1`}>
                    <PlusIcon className="h-4 w-4" aria-hidden="true" />{t('hardQuestions.search.record')}
                  </button>
                </div>
              )}
            </section>
          ) : (
            <>
              {library.waiting.length > 0 && (
                <section aria-labelledby="hq-waiting" className="mt-7">
                  <ListLabel id="hq-waiting" title={t('hardQuestions.waiting')} count={library.waiting.length} countLabel={t('hardQuestions.counts.questions', { count: library.waiting.length })} />
                  <div className="mt-2.5 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-dashed border-gray-300 dark:divide-gray-800 dark:border-gray-700">
                    {library.waiting.map((question) => {
                      const theme = question.themeId ? library.themeById.get(question.themeId)?.theme : undefined;
                      return <QuestionRow key={question.id} question={question} href={questionPath(question, Boolean(theme))} sub={theme?.title ?? t('hardQuestions.withoutTheme')} />;
                    })}
                  </div>
                </section>
              )}

              <section aria-labelledby="hq-themes" className="mt-7">
                <ListLabel id="hq-themes" title={t('hardQuestions.themes')} count={library.themes.length} countLabel={t('hardQuestions.counts.themes', { count: library.themes.length })}
                  action={library.themes.length > 1 ? (
                    <button type="button" onClick={() => setArranging((value) => !value)} aria-pressed={arranging}
                      className={`${QUIET_BUTTON} min-h-9 ${arranging ? QUIET_PRESSED : ''}`}>
                      <ArrowsUpDownIcon className="h-4 w-4" aria-hidden="true" />{arranging ? t('common.done') : t('hardQuestions.arrange')}
                    </button>
                  ) : undefined} />
                {library.themes.length > 0 && (arranging ? (
                  <SortableList items={library.themes.map((view) => ({ id: view.theme.id, view }))} className={`${PANEL} mt-2.5 divide-y divide-gray-100 dark:divide-gray-800`}
                    onMove={(id, onto, side) => section.moveTheme(id, { onto, side }).catch(failed)}
                    renderItem={({ view }, index, handle, overlay) => (
                      <ThemeRow view={view} overlay={overlay}
                        leading={<DragHandle label={`${t('hardQuestions.drag')}: ${view.theme.title}`} handle={handle} />}
                        trailing={<ReorderArrows canMoveUp={index > 0} canMoveDown={index < library.themes.length - 1}
                          onMoveUp={() => void section.moveTheme(view.theme.id, -1).catch(failed)} onMoveDown={() => void section.moveTheme(view.theme.id, 1).catch(failed)}
                          upLabel={t('common.moveUp')} downLabel={t('common.moveDown')} />} />
                    )} />
                ) : (
                  // Each theme with its bases and their places in sight; a place opens over the list (`ThemeCard`).
                  <ScriptureLinksInWindow>
                    <ul className="mt-2.5 flex flex-col gap-3">
                      {library.themes.map((view) => <li key={view.theme.id}><ThemeCard view={view} /></li>)}
                    </ul>
                  </ScriptureLinksInWindow>
                ))}
              </section>

              {library.withoutTheme.length > 0 && (
                <section aria-labelledby="hq-loose" className="mt-7">
                  <ListLabel id="hq-loose" title={t('hardQuestions.withoutTheme')} count={library.withoutTheme.length} countLabel={t('hardQuestions.counts.questions', { count: library.withoutTheme.length })} />
                  <div className={`${PANEL} mt-2.5 divide-y divide-gray-100 dark:divide-gray-800`}>
                    {library.withoutTheme.map((question) => (
                      <QuestionRow key={question.id} question={question} href={questionPath(question, false)} sub={question.short ? plainLine(question.short) : undefined} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {dialog?.kind === 'question' && (
        <NewQuestionDialog library={library} initialText={dialog.text} onClose={() => setDialog(null)} onCreate={async (input, then) => {
          try {
            const id = await section.createQuestion(input);
            setDialog(null);
            // Going on to answer: no search to clear — the search lives in the address, and clearing it
            // here would write the list's address over the new question's (live walk, 2026-11-25).
            if (then === 'answer') router.push(`${questionPath({ id, themeId: input.themeId }, Boolean(input.themeId))}?edit=1`);
            else {
              search.setValue('');
              if (!input.themeId || (!input.groupId && !input.newGroupTitle?.trim())) toast.success(t('hardQuestions.recorded'));
            }
          } catch { failed(); }
        }} />
      )}
      {dialog?.kind === 'theme' && (
        <NewThemeDialog onClose={() => setDialog(null)} onCreate={async (input) => {
          try {
            const id = await section.createTheme(input);
            setDialog(null);
            router.push(themePath(id));
          } catch { failed(); }
        }} />
      )}
    </div>
  );
}

/** A theme while the list is being arranged: its title and count, to drag by its grip or step with its arrows. */
function ThemeRow({ view, leading, trailing, overlay = false }: { view: ThemeView; leading?: ReactNode; trailing?: ReactNode; overlay?: boolean }) {
  const { t } = useTranslation();
  const count = view.questions.length;
  return (
    <div className={`flex items-stretch bg-white dark:bg-gray-900 ${overlay ? 'rounded-2xl border border-gray-300 shadow-xl dark:border-gray-600' : ''}`}>
      {leading && <span className="flex items-center pl-1">{leading}</span>}
      <Link href={themePath(view.theme.id)} className={`${ROW} min-w-0 flex-1`}>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="min-w-0 text-base font-semibold text-gray-900 dark:text-gray-50">{view.theme.title}</span>
          <CountChip count={count} label={t('hardQuestions.counts.questions', { count })} />
        </span>
        <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
      </Link>
      {trailing && <span className="flex items-center pr-2">{trailing}</span>}
    </div>
  );
}
