'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { isLiveCollectionDocument, useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useAppLocale } from '@/hooks/useAppLocale';
import { useAuth } from '@/providers/AuthProvider';
import { newClientId } from '@/utils/clientId';
import {
  buildLibrary, cleanList, cleanText, entryId, groupNamed, HARD_QUESTION_THEMES, HARD_QUESTIONS, moveInList, movePlan, rankForNewQuestion, readQuestion,
  readTheme, standsOnScripture, storedLists, type HardQuestionLibrary, type MoveTarget, type StoredEntry, type StoredLists,
} from '@/utils/hardQuestions';
import { rankForAppend, sortByRank } from '@/utils/listRank';
import { awaitWriteOperation, type WriteOperation } from '@/utils/recoverableWrite';

import type { HardQuestionPlacementOpening } from '@/data-engine/react.client';
import type { DocumentData } from '@/data-engine/types';
import type { HardQuestion, HardQuestionBasis, HardQuestionGroup } from '@/models/models';

const themeRef = (id: string) => ({ collection: HARD_QUESTION_THEMES, id });
const questionRef = (id: string) => ({ collection: HARD_QUESTIONS, id });
const now = () => new Date().toISOString();
const quiet = () => undefined;

export class HardQuestionGoneError extends Error {
  constructor() { super('HARD_QUESTION_GONE'); this.name = 'HardQuestionGoneError'; }
}

/** A question as the window writes it down; `newGroupTitle` — a group saved together with the question. */
export type NewQuestion = { title: string; themeId?: string; groupId?: string; newGroupTitle?: string };
type QuestionPatch = Record<string, DocumentData[string] | undefined>;

/** One entry of a stored list moved by the domain's one rule (`moveInList`); a list that cannot make the move stays as it is. */
const moveStored = (list: StoredEntry[], id: string, target: MoveTarget): StoredEntry[] => {
  const withIds = list.map((entry) => ({ id: entryId(entry) ?? '', entry }));
  return moveInList(withIds, id, target)?.map((each) => each.entry) ?? list;
};

/** A change to a theme's groups or bases, made on the stored lists whole (`storedLists`): one entry changes, the rest go back as they were. */
export type ThemeStructurePatch = (lists: StoredLists) => Partial<StoredLists>;

/**
 * HARD QUESTIONS ON THE ENGINE — the one door the section's screens write through.
 *
 * Reads: both collections, folded into one library by `utils/hardQuestions.ts` (themes in their
 * order, questions in their groups, what waits for an answer). Writes: each is one engine command,
 * kept on the device first and delivered when the network allows; the promise each action returns
 * proves the device has it, not that the server does (`awaitWriteOperation`).
 *
 * Changes to ONE document are queued here one after another (a question moved up three times, two
 * groups added in a row): separate one-shot commits on the same copy would each open an editor on
 * it and conflict with each other (`.howto/use-data-engine-in-a-screen.md`). The words of a
 * question or a theme are edited by a Save-button form on its own page (`useDataForm`), not here.
 */
export function useHardQuestions() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { locale } = useAppLocale();
  const themesCollection = useDataCollection(uid ? HARD_QUESTION_THEMES : null);
  const questionsCollection = useDataCollection(uid ? HARD_QUESTIONS : null);
  const actions = useDocumentActions();
  const queues = useRef(new Map<string, Promise<unknown>>());

  const library = useMemo<HardQuestionLibrary>(() => {
    const themes = (themesCollection.state?.documents ?? []).filter(isLiveCollectionDocument).map(row => readTheme(row.value, row.resource.id));
    const byId = new Map(themes.map(theme => [theme.id, theme]));
    const questions = (questionsCollection.state?.documents ?? []).filter(isLiveCollectionDocument)
      .flatMap(row => {
        const question = readQuestion(row.value, row.resource.id);
        if (row.pendingGroupCreation && (!question.themeId || !byId.get(question.themeId)?.groups?.some(group => group.id === question.groupId))) return [];
        return [question];
      });
    return buildLibrary(themes, questions);
  }, [themesCollection.state?.documents, questionsCollection.state?.documents]);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  /** Whether every theme is read: before that, a question whose theme is missing may stand in a theme not read yet. */
  const themesKnownRef = useRef(false);
  themesKnownRef.current = Boolean(themesCollection.state?.complete);

  /*
   * Ranks this device has just written and the list does not show yet. The next move is planned over
   * them, so two quick presses count from the same, real order rather than from a list that has not
   * caught up (Codex review, round 2). Each one leaves once the list shows it.
   */
  const pendingRanks = useRef(new Map<string, number>());
  useEffect(() => {
    for (const [id, rank] of pendingRanks.current) {
      const shown = library.questionById.get(id)?.rank ?? library.themeById.get(id)?.theme.rank;
      if (shown === undefined || shown === rank) pendingRanks.current.delete(id);
    }
  }, [library]);
  const withPending = useCallback(<T extends { id: string; rank: number }>(items: readonly T[]): T[] =>
    sortByRank(items.map((item) => (pendingRanks.current.has(item.id) ? { ...item, rank: pendingRanks.current.get(item.id)! } : item))), []);

  /** One document's changes, one after another; a failed change does not block the next. */
  const queued = useCallback(<T,>(key: string, run: () => Promise<T>): Promise<T> => {
    const previous = queues.current.get(key) ?? Promise.resolve();
    const next = previous.catch(quiet).then(run);
    queues.current.set(key, next);
    void next.finally(() => { if (queues.current.get(key) === next) queues.current.delete(key); }).catch(quiet);
    return next;
  }, []);

  const write = useCallback((operation: WriteOperation) => awaitWriteOperation(operation, quiet).then(() => undefined), []);

  const changeTheme = useCallback((themeId: string, change: ThemeStructurePatch) => queued(`theme:${themeId}`, () =>
    write(actions.commit(themeRef(themeId), (current: DocumentData | null) => {
      if (!current) throw new HardQuestionGoneError();
      return { ...current, ...change(storedLists(current)), updatedAt: now() } as unknown as DocumentData;
    }))), [actions, queued, write]);

  /**
   * `undefined` in the patch removes that field: a question moved out of a theme loses its theme. A patch that depends
   * on what the question holds is a function of the stored question, decided at the write — not of a list that may
   * show an older copy (Codex review 2026-11-27).
   */
  const changeQuestion = useCallback((questionId: string, patch: QuestionPatch | ((current: DocumentData) => QuestionPatch),
    opening?: HardQuestionPlacementOpening) => {
    const time = actions.captureActionTime() ?? null;
    return queued(`question:${questionId}`, () => write(actions.commit(questionRef(questionId), (current: DocumentData | null) => {
      if (!current) throw new HardQuestionGoneError();
      const next: DocumentData = { ...current, updatedAt: now() };
      for (const [field, value] of Object.entries(typeof patch === 'function' ? patch(current) : patch)) {
        if (value === undefined) delete next[field];
        else next[field] = value;
      }
      return next;
    }, { kind: 'document-metadata', time, hardQuestionPlacementOpening: opening })));
  }, [actions, queued, write]);

  const createTheme = useCallback(async (input: { title: string; intro?: string }): Promise<string> => {
    if (!uid) throw new Error('No signed-in person for this theme');
    const title = cleanText(input.title);
    if (!title) throw new Error('A theme needs a title');
    const id = newClientId();
    const at = now();
    const intro = cleanText(input.intro);
    await write(actions.create(themeRef(id), {
      userId: uid, title, ...(intro ? { intro } : {}), rank: rankForAppend(libraryRef.current.themes.map((view) => view.theme)),
      // Empty lists from the start: two devices adding the first group or basis append to one common list.
      groups: [], bases: [],
      createdAt: at, updatedAt: at,
    }));
    return id;
  }, [actions, uid, write]);

  /*
   * Groups and bases live inside the theme document: each change is one command on it.
   *
   * A new group goes last and resolves to its id. Named like a group the theme has, it is that group: its id comes
   * back and nothing is written (`groupNamed`) — a question written «into a new group» a second time after a failed
   * first try lands in the group the first try made, not in a twin. The write itself only ever adds: a repeat of the
   * command finds its own group already there, and a group made meanwhile on another device under the same name is
   * left beside it — two groups to merge by hand, not a question dropped out of its group.
   */
  const addGroup = useCallback(async (themeId: string, title: string): Promise<string> => {
    const kept = cleanText(title);
    if (!kept) throw new Error('A group needs a title');
    const known = groupNamed(libraryRef.current.themeById.get(themeId)?.theme.groups, kept);
    if (known) return known.id;
    const group: HardQuestionGroup = { id: newClientId(), title: kept };
    await changeTheme(themeId, ({ groups }) => ({ groups: groups.some((each) => entryId(each) === group.id) ? groups : [...groups, { ...group }] }));
    return group.id;
  }, [changeTheme]);

  const createQuestion = useCallback(async (input: NewQuestion): Promise<string> => {
    if (!uid) throw new Error('No signed-in person for this question');
    const title = cleanText(input.title);
    if (!title) throw new Error('A question needs its words');
    const id = newClientId();
    const at = now();
    // The theme and group as the screen chose them, even if the list has not read that theme yet: a
    // pointer to something gone reads as «без темы»/«без группы» anyway (Codex review, round 2).
    const themeId = input.themeId || undefined;
    const newGroup = themeId ? cleanText(input.newGroupTitle) : undefined;
    const words = (groupId: string | undefined): DocumentData => ({
      userId: uid, title, ...(themeId ? { themeId } : {}), ...(groupId ? { groupId } : {}),
      rank: rankForNewQuestion(libraryRef.current, themeId, groupId), createdAt: at, updatedAt: at,
    });
    const visibleGroups = themeId ? libraryRef.current.themeById.get(themeId)?.theme.groups : undefined;
    const existing = newGroup ? groupNamed(visibleGroups, newGroup)?.id : input.groupId;
    const group = newGroup && !existing ? { id: newClientId(), title: newGroup } : undefined;
    const groupId = existing || group?.id;
    if (themeId && groupId) {
      await queued('theme:' + themeId, () => write(actions.createHardQuestionWithGroup(questionRef(id), words(groupId), group && { group })));
    } else await write(actions.create(questionRef(id), words(undefined)));
    return id;
  }, [actions, queued, uid, write]);

  const removeQuestion = useCallback((questionId: string) => queued(`question:${questionId}`, () => write(actions.remove(questionRef(questionId)))), [actions, queued, write]);

  /**
   * Removes a theme — and only the theme: its questions stay in the section, «без темы», where each can be
   * moved or deleted on its own. The natural action of the project: a question can live without a theme, so
   * removing the theme changes only that pointer. A cascade that deleted the questions too was taken out
   * after two review rounds (2026-11-25): it could delete a question already moved to another theme, or
   * leave the theme gone with its questions half deleted.
   */
  const removeTheme = useCallback((themeId: string) => queued(`theme:${themeId}`, () => write(actions.remove(themeRef(themeId)))), [actions, queued, write]);

  const setThemeRank = useCallback((themeId: string, rank: number) => queued(`theme:${themeId}`, () => write(actions.commit(themeRef(themeId), (current: DocumentData | null) => {
    if (!current) throw new HardQuestionGoneError();
    return { ...current, rank, updatedAt: now() };
  }))), [actions, queued, write]);

  /**
   * Writes a move's ranks one by one, each remembered until the list shows it. A rank that is refused
   * leaves at once: kept, it would plan the next move over an order the list never takes, and an arrow
   * would then do nothing (Codex review, 2026-11-26).
   */
  const writeRanks = useCallback(async (changes: { id: string; rank: number }[], save: (id: string, rank: number) => Promise<unknown>) => {
    for (const change of changes) {
      pendingRanks.current.set(change.id, change.rank);
      try {
        await save(change.id, change.rank);
      } catch (error) {
        if (pendingRanks.current.get(change.id) === change.rank) pendingRanks.current.delete(change.id);
        throw error;
      }
    }
  }, []);

  /** Moves a theme among the themes (an arrow or a drag); the plan is made when the move's turn comes, from the newest list. */
  const moveTheme = useCallback((themeId: string, target: MoveTarget) => queued('themes:order', () =>
    writeRanks(movePlan(withPending(libraryRef.current.themes.map((view) => view.theme)), themeId, target), setThemeRank)),
  [queued, setThemeRank, withPending, writeRanks]);

  /**
   * The list a question is moved within: the one the screen shows it in — its group as the theme reads
   * (questions of two removed groups share one «without a group»), or the questions without a theme.
   * Null while its theme is not read yet: planned over another list, a move would write a rank from
   * the wrong neighbours (Codex review, 2026-11-26).
   */
  const listOfQuestion = useCallback((questionId: string): { key: string; questions: HardQuestion[] } | null => {
    const lib = libraryRef.current;
    const question = lib.questionById.get(questionId);
    if (!question) return null;
    const view = question.themeId ? lib.themeById.get(question.themeId) : undefined;
    if (question.themeId && !view && !themesKnownRef.current) return null;
    const bucket = view?.buckets.find((item) => item.questions.some((entry) => entry.id === questionId));
    return view && bucket ? { key: `${view.theme.id}:${bucket.key}`, questions: bucket.questions } : { key: ':', questions: lib.withoutTheme };
  }, []);

  /** Moves a question inside the list the screen shows it in, planned from the newest list. */
  const moveQuestion = useCallback((questionId: string, target: MoveTarget) => {
    const start = listOfQuestion(questionId);
    if (!start) return Promise.reject(new Error('The theme of this question is not read yet'));
    return queued(`order:${start.key}`, async () => {
      const list = listOfQuestion(questionId);
      if (!list) throw new Error('The theme of this question is not read yet');
      await writeRanks(movePlan(withPending(list.questions), questionId, target), (id, rank) => changeQuestion(id, { rank }));
    });
  }, [changeQuestion, listOfQuestion, queued, withPending, writeRanks]);

  /** Puts a question into another theme or group, at the end of it. */
  /**
   * Puts a question into a theme and group. The dialog supplies the place it opened from.
   * A queued commit can read a newer copy, so that later read cannot stand for the opening.
   */
  const placeQuestion = useCallback((questionId: string, themeId: string | undefined, groupId: string | undefined, shown?: HardQuestionPlacementOpening | string | null) => {
    const lib = libraryRef.current;
    const opening = shown && typeof shown === 'object' ? shown : undefined;
    const seen = opening ? opening.place.themeId : shown === undefined ? lib.questionById.get(questionId)?.themeId : shown;
    const view = themeId ? lib.themeById.get(themeId) : undefined;
    // A theme chosen and gone meanwhile is refused, not read as «without a theme» (Codex review 2026-11-27).
    if (themeId && !view) return Promise.reject(new HardQuestionGoneError());
    const keptTheme = view ? themeId : undefined;
    if (groupId && !view?.theme.groups?.some(group => group.id === groupId)) return Promise.reject(new HardQuestionGoneError());
    const keptGroup = groupId;
    const rank = rankForNewQuestion(lib, keptTheme, keptGroup);
    return changeQuestion(questionId, (current) => {
      const stored = typeof current.themeId === 'string' && current.themeId ? current.themeId : undefined;
      if (!opening && stored !== (seen || undefined) && stored !== keptTheme) throw new HardQuestionGoneError();
      // The question leaves the bases of a theme it no longer stands in — judged by the theme it is stored in.
      const stays = stored === keptTheme;
      return { themeId: keptTheme, groupId: keptGroup, rank, ...(stays ? {} : { basisIds: undefined }) };
    }, opening);
  }, [changeQuestion]);

  /* The rest of the groups and the bases: one command on the theme document each (a group is added above, by `addGroup`). */
  const renameGroup = useCallback((themeId: string, groupId: string, title: string) => {
    const kept = cleanText(title);
    if (!kept) return Promise.reject(new Error('A group needs a title'));
    return changeTheme(themeId, ({ groups }) => {
      // A group removed meanwhile (here or on another device) is said, not silently left unrenamed.
      if (!groups.some((group) => entryId(group) === groupId)) throw new HardQuestionGoneError();
      return { groups: groups.map((group) => (entryId(group) === groupId ? { ...group, title: kept } : group)) };
    });
  }, [changeTheme]);
  /** Removes a group; its questions stay in the theme, without a group. */
  const removeGroup = useCallback((themeId: string, groupId: string) =>
    changeTheme(themeId, ({ groups }) => ({ groups: groups.filter((group) => entryId(group) !== groupId) })), [changeTheme]);
  const moveGroup = useCallback((themeId: string, groupId: string, target: MoveTarget) =>
    changeTheme(themeId, ({ groups }) => ({ groups: moveStored(groups, groupId, target) })), [changeTheme]);

  const saveBasis = useCallback((themeId: string, basis: Omit<HardQuestionBasis, 'id'> & { id?: string }) => {
    const title = cleanText(basis.title);
    if (!title) return Promise.reject(new Error('A basis needs a title'));
    const text = cleanText(basis.text);
    const refs = cleanList(basis.scriptureRefs);
    // A basis stands on Scripture (the owner, 2026-11-26): the one rule the form also reads — a place a Bible opens.
    if (!standsOnScripture(refs, locale)) return Promise.reject(new Error('A basis needs at least one place of Scripture'));
    const id = basis.id ?? newClientId();
    const kept: HardQuestionBasis = { id, title, ...(text ? { text } : {}), scriptureRefs: refs };
    return changeTheme(themeId, ({ bases }) => ({
      bases: bases.some((item) => entryId(item) === id)
        // The basis edited keeps what this version does not read; its old short label goes (removed 2026-11-26).
        ? bases.map((item) => {
          if (entryId(item) !== id) return item;
          const { label: _label, text: _text, scriptureRefs: _refs, ...rest } = item;
          return { ...rest, ...kept };
        })
        : [...bases, { ...kept }],
    })).then(() => id);
  }, [changeTheme, locale]);
  /** Removes a basis; the answers that rested on it keep their words and simply stop pointing to it. */
  const removeBasis = useCallback((themeId: string, basisId: string) =>
    changeTheme(themeId, ({ bases }) => ({ bases: bases.filter((basis) => entryId(basis) !== basisId) })), [changeTheme]);
  const moveBasis = useCallback((themeId: string, basisId: string, target: MoveTarget) =>
    changeTheme(themeId, ({ bases }) => ({ bases: moveStored(bases, basisId, target) })), [changeTheme]);

  const loading = Boolean(uid) && (themesCollection.loading || questionsCollection.loading);
  return {
    library,
    loading,
    /** Both lists are known whole: only then is "no questions" a fact. */
    complete: Boolean(themesCollection.state?.complete && questionsCollection.state?.complete),
    themesState: themesCollection.state,
    questionsState: questionsCollection.state,
    ready: actions.ready,
    createTheme, removeTheme, moveTheme,
    createQuestion, removeQuestion, moveQuestion, placeQuestion,
    addGroup, renameGroup, removeGroup, moveGroup,
    saveBasis, removeBasis, moveBasis,
  };
}
