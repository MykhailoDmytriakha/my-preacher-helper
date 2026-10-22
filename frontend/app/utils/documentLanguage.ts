import { textLanguage, type AppLocale } from '@/utils/appLocale';
import { readPlanText, renderPlanWithFallback } from '@/utils/planText';

import type { Group, Sermon, ServiceOrder, StudyNote } from '@/models/models';

/*
 * THE LANGUAGE A DOCUMENT IS WRITTEN IN, read off all of its words (`textLanguage`): a reference typed
 * in it that Russian and Ukrainian write alike ("1Цар" — 1 Samuel in Russian, 1 Kings in Ukrainian) is
 * read in its Bible when the text around the reference does not say (the owner, 2026-10-20, case
 * 2026-10-12-block-diagram, 2.2.1; `bibleLink.ts` → `writtenLanguage`). Null when the words do not say.
 */

/** A sermon's words: its title, verse, thoughts, the plan as it is shown and its scratch notes. */
export const sermonLanguage = (sermon: Sermon | null | undefined): AppLocale | null =>
  sermon
    ? textLanguage([
      sermon.title,
      sermon.verse ?? '',
      ...(sermon.thoughts ?? []).map((thought) => thought.text),
      ...Object.values(renderPlanWithFallback(sermon, readPlanText(sermon))),
      ...(sermon.scratch ?? []).map((note) => note.text),
    ].join('\n'))
    : null;

export const studyNoteLanguage = (note: Pick<StudyNote, 'title' | 'content'>): AppLocale | null =>
  textLanguage(`${note.title ?? ''}\n${note.content ?? ''}`);

/** A group's words: its title, description, blocks with their questions, and the leader's own titles and notes in its flow. */
export const groupLanguage = (group: Pick<Group, 'title' | 'description' | 'templates' | 'flow'> | null | undefined): AppLocale | null =>
  group
    ? textLanguage([
      group.title,
      group.description ?? '',
      ...(group.templates ?? []).flatMap((block) => [block.title, block.content, ...(block.questions ?? [])]),
      ...(group.flow ?? []).flatMap((item) => [item.instanceTitle ?? '', item.instanceNotes ?? '']),
    ].join('\n'))
    : null;

/** A service order's words: its title, summary and every step's title and body. */
export const serviceOrderLanguage = (order: Pick<ServiceOrder, 'title' | 'summary' | 'steps'> | null | undefined): AppLocale | null =>
  order
    ? textLanguage([order.title, order.summary ?? '', ...order.steps.map((step) => `${step.title}\n${step.body ?? ''}`)].join('\n'))
    : null;
