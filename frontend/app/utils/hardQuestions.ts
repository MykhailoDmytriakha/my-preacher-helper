import { namesAPlace, referenceFromTyped, referencesInText } from '@/utils/bibleLink';
import { keptLine, lineKey, normalizeWord } from '@/utils/bibleSearch/words';
import { RANK_STEP, rankForAppend, rankForMove, sortByRank } from '@/utils/listRank';
import { scriptureReferencesOverlap } from '@/utils/scriptureReferenceNumbering';

import type { HardQuestion, HardQuestionBasis, HardQuestionGroup, HardQuestionTheme } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

/**
 * HARD QUESTIONS — the one module that knows how the section's records fit together
 * (`/care/questions`; the model is `HardQuestionTheme` / `HardQuestion` in models.ts).
 *
 * Screens never decide here-and-there what "waiting for an answer" means, which questions stand in
 * which group, what a search finds or where a new question lands: they call this module. Writes go
 * through `hooks/useHardQuestions.ts` and the data engine; this file is pure.
 *
 * Pointers are read leniently ON PURPOSE. A question names its theme, group and bases by id, and
 * whatever it names may be gone — deleted on another device, or deleted here a moment ago while the
 * question's own write is still on its way. Such a question is never hidden: it stands "without a
 * theme" or "without a group", and a basis that is gone is simply not shown. That is what lets
 * removing a theme, a group or a basis stay one write instead of a cascade over every question.
 */

export const HARD_QUESTION_THEMES = 'hardQuestionThemes';
export const HARD_QUESTIONS = 'hardQuestions';

type Raw = Record<string, unknown> | null | undefined;

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const rankOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN);
const withId = (value: unknown): value is { id: string } & Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' && Boolean((value as { id: string }).id);

/**
 * A STORED ENTRY OF A THEME'S LIST, WHOLE — a group or a basis exactly as the document keeps it, with any field this
 * version does not read (a basis's old `label`, a field a later version adds). The screens read `readTheme`, which
 * leaves such fields out; a write that changes one entry works on these, so every other entry goes back untouched
 * (Codex review 2026-11-27: removing one basis through the read view erased the other bases' fields).
 */
export type StoredEntry = Record<string, unknown>;
export type StoredLists = { groups: StoredEntry[]; bases: StoredEntry[] };
export function storedLists(value: Raw): StoredLists {
  const list = (field: 'groups' | 'bases'): StoredEntry[] => {
    const raw = value?.[field];
    return Array.isArray(raw) ? raw.filter((entry): entry is StoredEntry => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)) : [];
  };
  return { groups: list('groups'), bases: list('bases') };
}
export const entryId = (entry: StoredEntry): string | undefined => (typeof entry.id === 'string' && entry.id ? entry.id : undefined);

/** A theme as the screens read it: every list present, every unreadable entry left out. */
export function readTheme(value: Raw, id: string): HardQuestionTheme {
  const raw = value ?? {};
  const groups: HardQuestionGroup[] = (Array.isArray(raw.groups) ? raw.groups : []).filter(withId)
    .map((group) => ({ id: group.id, title: text(group.title) ?? '' }));
  // A basis is called by its title everywhere: its short label was removed at the owner's word (2026-11-26), and a
  // label an older document still holds is not read (the form drops it at the next save).
  const bases: HardQuestionBasis[] = (Array.isArray(raw.bases) ? raw.bases : []).filter(withId)
    .map((basis) => ({
      id: basis.id,
      title: text(basis.title) ?? '',
      ...(text(basis.text) ? { text: text(basis.text) } : {}),
      ...(texts(basis.scriptureRefs).length ? { scriptureRefs: texts(basis.scriptureRefs) } : {}),
    }));
  return {
    id,
    userId: text(raw.userId) ?? '',
    title: text(raw.title) ?? '',
    ...(text(raw.intro) ? { intro: text(raw.intro) } : {}),
    rank: rankOf(raw.rank),
    groups,
    bases,
    createdAt: text(raw.createdAt) ?? '',
    updatedAt: text(raw.updatedAt) ?? '',
  };
}

/** A question as the screens read it. */
export function readQuestion(value: Raw, id: string): HardQuestion {
  const raw = value ?? {};
  const optional = (field: 'themeId' | 'groupId' | 'short' | 'detail' | 'differ') =>
    (text(raw[field]) ? { [field]: text(raw[field]) } : {});
  return {
    id,
    userId: text(raw.userId) ?? '',
    title: text(raw.title) ?? '',
    ...optional('themeId'),
    ...optional('groupId'),
    rank: rankOf(raw.rank),
    ...(texts(raw.alternates).length ? { alternates: texts(raw.alternates) } : {}),
    ...optional('short'),
    ...optional('detail'),
    ...optional('differ'),
    ...(texts(raw.scriptureRefs).length ? { scriptureRefs: texts(raw.scriptureRefs) } : {}),
    ...(texts(raw.basisIds).length ? { basisIds: texts(raw.basisIds) } : {}),
    createdAt: text(raw.createdAt) ?? '',
    updatedAt: text(raw.updatedAt) ?? '',
  };
}

/** No short answer and no detail yet: the question was written down to be answered later. */
export const isWaiting = (question: Pick<HardQuestion, 'short' | 'detail'>): boolean =>
  !question.short?.trim() && !question.detail?.trim();

/**
 * Markdown read as one plain line, for a quiet line under a question in a list: emphasis marks,
 * link addresses and line breaks go, the words stay («**Коротко.** Да» → «Коротко. Да»).
 */
export function plainLine(markdown: string): string {
  // One line is all a list shows; reading the whole answer made a long one quadratic (Codex review).
  return markdown.slice(0, 600)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`)(?=\S)([^]*?\S)\1/g, '$2')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text as kept: no spaces at the ends, nothing at all when nothing was written. */
export function cleanText(value: string | undefined | null): string | undefined {
  const kept = (value ?? '').trim();
  return kept ? kept : undefined;
}

/** A list as kept: each entry trimmed, empty ones dropped, a repeat (compared as search compares words) kept once. */
export function cleanList(values: readonly string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of values ?? []) {
    const entry = keptLine(value);
    const key = normalizeWord(entry);
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    kept.push(entry);
  }
  return kept;
}

/**
 * The group of a theme already called by this name, compared as search compares words («Дома» and «дома  »
 * are one name). A theme keeps one group per name: a new group named like one it has is that group, and a
 * rename onto another group's name is refused. `exceptId` — the group being renamed.
 */
export function groupNamed(groups: readonly HardQuestionGroup[] | undefined, title: string, exceptId?: string): HardQuestionGroup | undefined {
  const key = lineKey(title);
  if (!key) return undefined;
  return (groups ?? []).find((group) => group.id !== exceptId && lineKey(group.title) === key);
}

/** One group of a theme on the screen, or the questions of the theme that stand in no group. */
export type QuestionBucket = {
  key: string;
  /** null: the questions without a group (or every question of a theme that has no groups). */
  group: HardQuestionGroup | null;
  questions: HardQuestion[];
};

export type BasisUse = { basis: HardQuestionBasis; questions: HardQuestion[] };

export type ThemeView = {
  theme: HardQuestionTheme;
  buckets: QuestionBucket[];
  /** Every question of the theme in the order the screen shows them. */
  questions: HardQuestion[];
  waiting: number;
  bases: BasisUse[];
};

export type HardQuestionLibrary = {
  themes: ThemeView[];
  /** Questions with no theme, or whose theme is gone. */
  withoutTheme: HardQuestion[];
  /** Every question waiting for an answer, the newest first: what was asked last is on top. */
  waiting: HardQuestion[];
  total: number;
  themeById: Map<string, ThemeView>;
  questionById: Map<string, HardQuestion>;
};

export const UNGROUPED_KEY = 'ungrouped';

/** The buckets of one theme: its groups in their order, then the questions that stand in none. */
function bucketsOf(theme: HardQuestionTheme, questions: HardQuestion[]): QuestionBucket[] {
  const groups = theme.groups ?? [];
  const known = new Set(groups.map((group) => group.id));
  const buckets: QuestionBucket[] = groups.map((group) => ({
    key: group.id, group, questions: sortByRank(questions.filter((question) => question.groupId === group.id)),
  }));
  const loose = sortByRank(questions.filter((question) => !question.groupId || !known.has(question.groupId)));
  // A theme with no groups shows its questions as one list, even empty; with groups, the loose
  // questions follow them and the bucket appears only when it holds something.
  if (!groups.length || loose.length) buckets.push({ key: UNGROUPED_KEY, group: null, questions: loose });
  return buckets;
}

/** The whole section as the screens show it. */
export function buildLibrary(themes: readonly HardQuestionTheme[], questions: readonly HardQuestion[]): HardQuestionLibrary {
  const sortedThemes = sortByRank([...themes]);
  const known = new Set(sortedThemes.map((theme) => theme.id));
  const byTheme = new Map<string, HardQuestion[]>();
  const withoutTheme: HardQuestion[] = [];
  for (const question of questions) {
    if (question.themeId && known.has(question.themeId)) byTheme.set(question.themeId, [...(byTheme.get(question.themeId) ?? []), question]);
    else withoutTheme.push(question);
  }
  const views = sortedThemes.map<ThemeView>((theme) => {
    const own = byTheme.get(theme.id) ?? [];
    const buckets = bucketsOf(theme, own);
    const ordered = buckets.flatMap((bucket) => bucket.questions);
    return {
      theme,
      buckets,
      questions: ordered,
      waiting: ordered.filter(isWaiting).length,
      bases: (theme.bases ?? []).map((basis) => ({ basis, questions: ordered.filter((question) => question.basisIds?.includes(basis.id)) })),
    };
  });
  const waiting = [...questions].filter(isWaiting)
    .sort((a, b) => (b.createdAt.localeCompare(a.createdAt)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    themes: views,
    withoutTheme: sortByRank(withoutTheme),
    waiting,
    total: questions.length,
    themeById: new Map(views.map((view) => [view.theme.id, view])),
    questionById: new Map(questions.map((question) => [question.id, question])),
  };
}

/** Where a question stands: its theme, its group and the bases it rests on that still exist. */
export function placeOf(library: HardQuestionLibrary, question: HardQuestion) {
  const view = question.themeId ? library.themeById.get(question.themeId) ?? null : null;
  const group = view && question.groupId ? (view.theme.groups ?? []).find((item) => item.id === question.groupId) ?? null : null;
  const bases = view ? (question.basisIds ?? []).flatMap((id) => (view.theme.bases ?? []).filter((basis) => basis.id === id)) : [];
  return { view, group, bases };
}

/** The bucket a question would join: a group of its theme, or the loose questions. */
export function bucketOf(view: ThemeView | null, groupId: string | undefined): QuestionBucket | null {
  if (!view) return null;
  const known = (view.theme.groups ?? []).some((group) => group.id === groupId);
  return view.buckets.find((bucket) => (known ? bucket.key === groupId : bucket.key === UNGROUPED_KEY)) ?? null;
}

/** The rank for a question added at the end of its group (or of the loose questions). */
export function rankForNewQuestion(library: HardQuestionLibrary, themeId: string | undefined, groupId: string | undefined): number {
  const view = themeId ? library.themeById.get(themeId) ?? null : null;
  if (!view) return rankForAppend(library.withoutTheme);
  return rankForAppend(bucketOf(view, groupId)?.questions ?? []);
}

/**
 * WHERE AN ITEM OF A LIST GOES — one rule for the arrows and the drag. An arrow says «one place up or
 * down» (`-1`, `1`). A drag says what the eye saw at the drop: the item lands just before or just after
 * the item it was dropped on (`{ onto, side }`) — before it when it travelled up, after it when it
 * travelled down. The side is fixed at the drop, so a move still waiting in the queue behind an arrow
 * keeps meaning «after B», not «at B's old index» (Codex review, 2026-11-26). Both are read when the
 * move's turn comes, against the newest list: two quick presses go two places.
 */
export type MoveTarget = -1 | 1 | { onto: string; side: 'before' | 'after' };

function moveIndexes(items: readonly { id: string }[], id: string, target: MoveTarget): { from: number; to: number } | null {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return null;
  let to: number;
  if (typeof target === 'number') to = from + target;
  else {
    const onto = items.findIndex((item) => item.id === target.onto);
    if (onto < 0 || onto === from) return null;
    // The place of the item dropped on once the moved one is lifted out of the list.
    const among = onto - (from < onto ? 1 : 0);
    to = target.side === 'after' ? among + 1 : among;
  }
  return to < 0 || to >= items.length || to === from ? null : { from, to };
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * WHAT A MOVE WRITES. Usually one rank: the midpoint between the new neighbours, on the moved item
 * alone. When there is no room between them — two devices added at the same rank, or a gap halved
 * until it is spent — a midpoint cannot be found, and the list is spread out again in its new order
 * (`listRank.ts` names that repair); a move that did nothing was the alternative (Codex review,
 * 2026-11-25). Nothing at an edge. `items` are in the order the screen shows them.
 */
export function rankMovePlan<T extends { id: string; rank: number }>(items: readonly T[], id: string, target: MoveTarget):
  { changes: { id: string; rank: number }[]; repair: { order: T[]; movedIndex: number } | null } {
  const indexes = moveIndexes(items, id, target);
  if (!indexes) return { changes: [], repair: null };
  const rank = rankForMove([...items], id, indexes.to);
  if (rank !== null) return { changes: [{ id, rank }], repair: null };
  const order = moved(items, indexes.from, indexes.to);
  const changes = order.map((item, position) => ({ id: item.id, rank: (position + 1) * RANK_STEP }))
    .filter((change, position) => order[position].rank !== change.rank);
  return { changes, repair: { order, movedIndex: indexes.to } };
}

export function movePlan(items: readonly { id: string; rank: number }[], id: string, target: MoveTarget): { id: string; rank: number }[] {
  return rankMovePlan(items, id, target).changes;
}

/** A theme's own list (its groups, its bases) after a move: the same items, one of them in its new place. */
export function moveInList<T extends { id: string }>(list: readonly T[], id: string, target: MoveTarget): T[] | null {
  const indexes = moveIndexes(list, id, target);
  return indexes ? moved(list, indexes.from, indexes.to) : null;
}

/* ─────────────────────────────── search ─────────────────────────────── */

export type SearchHit = {
  question: HardQuestion;
  theme: HardQuestionTheme | null;
  /** Where the words were found first: the screen says it when it is not the question itself. */
  where: 'title' | 'alternate' | 'scripture' | 'basis' | 'answer' | 'theme';
};

const WHERE_ORDER: SearchHit['where'][] = ['title', 'alternate', 'scripture', 'basis', 'answer', 'theme'];

/**
 * The places one typed entry names. «1 Кор 11:4, 14» is two verses, not 4–14: the entry is read as text,
 * where a comma lists and a dash spans (`referencesInText`); a lone reference falls back to the typed
 * reading (Codex review, round 2).
 */
export function typedPlaces(entry: string, locale: AppLocale): (ScriptureRefShape & { bible: BibleId })[] {
  const listed = referencesInText(entry, locale).map((found) => found.reference);
  if (listed.length) return listed;
  const typed = referenceFromTyped(entry, { locale });
  return typed ? [typed] : [];
}

/**
 * A search line read as places — only when it is nothing but places, read as a typed list is read («1 Кор 11:4, 14» is
 * two verses, not 4–14). «одежда Рим 8:28» is words with a place in them: searched by its words (Codex review
 * 2026-11-27 — a place alone must not find a question the words do not).
 */
function searchedPlaces(query: string, locale: AppLocale): ScriptureRefShape[] {
  // «(Рим 8:28)», as an answer writes it, is the place inside.
  const line = query.replace(/^\((.*)\)$/, '$1').trim();
  if (!/\d/.test(line)) return [];
  const listed = referencesInText(line, locale);
  const rest = listed.reduceRight((text, found) => text.slice(0, found.start) + text.slice(found.end), line);
  if (listed.length && rest.replace(/[\s,;.]+/g, '') === '') return listed.map((found) => found.reference);
  // Not a list that covers the line: the whole line as one typed place («Рим 13, 12»), else words.
  const typed = referenceFromTyped(line, { locale });
  return typed ? [typed] : [];
}

/** The places one listed entry names that a Bible can open; none when the app cannot read it («Рим 25»). */
export function readablePlaces(entry: string, locale: AppLocale): (ScriptureRefShape & { bible: BibleId })[] {
  return typedPlaces(entry, locale).filter((place) => place.chapter !== undefined && namesAPlace(place));
}

/**
 * A BASIS STANDS ON SCRIPTURE (the owner, 2026-11-26: «Основание не может быть без места Писания. Должно быть как
 * минимум одно или множество»): its list names at least one place a Bible can open. A basis kept before the rule
 * is not touched; it is only saved again with a place.
 */
export function standsOnScripture(refs: readonly string[] | undefined, locale: AppLocale): boolean {
  return (refs ?? []).some((ref) => readablePlaces(ref, locale).length > 0);
}

/** The places of Scripture a question names: its list of places and every reference in its answer. */
const placesCache = new WeakMap<HardQuestion, Map<AppLocale, ScriptureRefShape[]>>();
export function placesOf(question: HardQuestion, locale: AppLocale): ScriptureRefShape[] {
  const known = placesCache.get(question)?.get(locale);
  if (known) return known;
  const typed = (question.scriptureRefs ?? []).flatMap((ref) => typedPlaces(ref, locale));
  const inText = [question.short, question.detail, question.differ].flatMap((value) =>
    (value ? referencesInText(value, locale).map((found) => found.reference) : []));
  const places = [...typed, ...inText];
  const byLocale = placesCache.get(question) ?? new Map<AppLocale, ScriptureRefShape[]>();
  byLocale.set(locale, places);
  placesCache.set(question, byLocale);
  return places;
}

/** The places a basis names: its list of places and every reference in its words. */
const basisPlacesCache = new WeakMap<HardQuestionBasis, Map<AppLocale, ScriptureRefShape[]>>();
function basisPlaces(basis: HardQuestionBasis, locale: AppLocale): ScriptureRefShape[] {
  const known = basisPlacesCache.get(basis)?.get(locale);
  if (known) return known;
  const typed = (basis.scriptureRefs ?? []).flatMap((ref) => typedPlaces(ref, locale));
  const places = [...typed, ...(basis.text ? referencesInText(basis.text, locale).map((found) => found.reference) : [])];
  const byLocale = basisPlacesCache.get(basis) ?? new Map<AppLocale, ScriptureRefShape[]>();
  byLocale.set(locale, places);
  basisPlacesCache.set(basis, byLocale);
  return places;
}

/**
 * WHAT A SEARCH FINDS. A line that reads as a place of Scripture ("1 Тим 2:9", "Втор 22") finds the
 * questions that name an overlapping place — in their list, in the words of the answer, or in a basis
 * the answer rests on — across the numbering of different Bibles. Every line also finds the questions
 * holding every one of its words: in the question, its other wordings, the answer, the theme, the
 * group, and the bases it rests on (their titles and their words). Both kinds of match are kept, the
 * question's own words ranking first, so typing what was asked puts that question on top.
 */
export function searchLibrary(library: HardQuestionLibrary, query: string, locale: AppLocale): SearchHit[] {
  const line = keptLine(query);
  if (!line) return [];
  const all = [...library.themes.flatMap((view) => view.questions), ...library.withoutTheme];
  const references = searchedPlaces(line, locale);
  const words = normalizeWord(line).split(' ').filter(Boolean);
  const has = (value: string | undefined) => {
    const haystack = normalizeWord(value ?? '');
    return words.every((word) => haystack.includes(word));
  };
  const hits: SearchHit[] = [];
  for (const question of all) {
    const { view, group, bases } = placeOf(library, question);
    const theme = view?.theme ?? null;
    const fields: Record<SearchHit['where'], string> = {
      title: question.title,
      alternate: (question.alternates ?? []).join(' \n '),
      scripture: (question.scriptureRefs ?? []).join(' \n '),
      basis: bases.map((basis) => `${basis.title} ${basis.text ?? ''} ${(basis.scriptureRefs ?? []).join(' ')}`).join(' \n '),
      answer: [question.short, question.detail, question.differ].filter(Boolean).join(' \n '),
      theme: [theme?.title, group?.title].filter(Boolean).join(' \n '),
    };
    const byWords = WHERE_ORDER.find((field) => has(fields[field]))
      ?? (has(Object.values(fields).join(' \n ')) ? 'answer' : undefined);
    const overlaps = (place: ScriptureRefShape) => references.some((reference) => scriptureReferencesOverlap(place, reference));
    const byPlace = references.length > 0 && (
      placesOf(question, locale).some(overlaps) || bases.some((basis) => basisPlaces(basis, locale).some(overlaps)));
    if (byWords === 'title' || byWords === 'alternate') hits.push({ question, theme, where: byWords });
    else if (byPlace) hits.push({ question, theme, where: 'scripture' });
    else if (byWords) hits.push({ question, theme, where: byWords });
  }
  return hits.sort((a, b) => WHERE_ORDER.indexOf(a.where) - WHERE_ORDER.indexOf(b.where));
}
