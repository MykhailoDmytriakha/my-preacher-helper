import { textLanguage, type AppLocale } from '@/utils/appLocale';
import { namesAPlace, referencesInText } from '@/utils/bibleLink';
import { groupLanguage, sermonLanguage, serviceOrderLanguage, studyNoteLanguage } from '@/utils/documentLanguage';
import { documentScreenHref } from '@/utils/documentScreenHref';
import { markdownPreviewText } from '@/utils/markdownUtils';
import { readPlanText, renderPlanWithFallback } from '@/utils/planText';
import { passagesIn, sameScriptureReference, scriptureReferencesOverlap, withNoteReferenceBibles, withStoredBible, type Passage } from '@/utils/scriptureReferenceNumbering';

import type { Group, Sermon, ServiceOrder, StudyAnalysis, StudyNote } from '@/models/models';
import type { BibleId } from '@/utils/bibles';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

export type ScriptureUsageKind = 'note' | 'comment' | 'analysis' | 'sermon' | 'group' | 'order';
export type ScriptureUsageMatch = 'same' | 'overlap' | 'text';
export type ScriptureUsage = {
  id: string;
  kind: ScriptureUsageKind;
  title: string;
  href: string;
  reference: ScriptureRefShape;
  match: ScriptureUsageMatch;
  excerpt: string;
  /** Full source unit for the preview: a note, or the matching sermon/group text. */
  content: string;
  /** The words naming the passage inside `content`, for the preview to find; absent when only a reference list names it. */
  mention?: string;
};
/**
 * One reference a document holds: in a list it keeps (`inText` false) or typed in its words. A note's
 * list entry is `listed`: its words carry no position, so the mention shown is looked up in the note's text.
 */
type Candidate = { reference: ScriptureRefShape; text: string; at: number; inText: boolean; raw?: string; listed?: boolean };
type UsageSources = {
  notes: readonly StudyNote[];
  sermons: readonly Sermon[];
  groups: readonly Group[];
  serviceOrders?: readonly ServiceOrder[];
  /** The note on screen, left out of its own list. */
  currentNoteId?: string;
  locale: AppLocale;
};

/** Where each kind lives, for its screen's address and the key it is remembered by. */
const COLLECTION_OF: Record<ScriptureUsageKind, string> = { note: 'studyNotes', comment: 'studyNotes', analysis: 'studyNotes', sermon: 'sermons', group: 'groups', order: 'serviceOrders' };

/** A document of the person's and every reference it holds — where each kind keeps its verses, read once. */
export type UsageDocument = {
  kind: ScriptureUsageKind; id: string; title: string; href: string; updatedAt: string; candidates: Candidate[];
  /** A comment's own words, drawn under the verse or the chapter it is written to; an analysis's parts as text. */
  body?: string;
  /** An analysis's ties and links of meaning, drawn with its parts (`body`) where it is listed. */
  analysis?: StudyAnalysis;
};

/** Stronger links first: the same reference, then an overlapping passage, then a mention in the text. */
const MATCH_ORDER: Record<ScriptureUsageMatch, number> = { same: 0, overlap: 1, text: 2 };

/**
 * A bounded excerpt around the actual mention, rather than an unrelated first paragraph, read as
 * plain words: Markdown marks and line breaks would fill a short row without saying anything.
 */
function excerpt(text: string, at = 0): string {
  const near = Math.max(0, at - 60);
  // Start on a word, not inside one; and at the top when only marks would be skipped.
  const onWord = near && /\S/.test(text[near - 1] ?? '') ? Math.min(at, text.indexOf(' ', near) + 1 || near) : near;
  const start = markdownPreviewText(text.slice(0, onWord)) ? onWord : 0;
  const end = Math.min(text.length, Math.max(at + 200, start + 260));
  return `${start ? '…' : ''}${markdownPreviewText(text.slice(start, end))}${end < text.length ? '…' : ''}`;
}

/** The references a text names, each in the Bible it was written in — the text's language, then its document's (`written`). */
function inText(text: string, locale: AppLocale, written: AppLocale | null): Candidate[] {
  return referencesInText(text, locale, written).map(found => ({ reference: found.reference, text, at: found.start, inText: true, raw: found.raw }));
}

/**
 * A document read once per version: finding the references in a library's words costs about half a
 * millisecond a page and a twentieth of one per reference found (measured 2026-10-21), and the lists come
 * anew with every step of a sync — 850 documents read again each time took 3.3 s. Kept by what the
 * reading depends on (the document and the language it is read in), so a changed document is read anew.
 */
const readDocuments = new Map<string, { signature: string; document: UsageDocument | null }>();
/** Documents kept at most: a long session that creates and deletes many lets the oldest go (Codex review, 2026-10-21). */
const READ_DOCUMENTS_KEPT = 4000;

function readOnce(key: string, source: unknown, locale: AppLocale, read: () => UsageDocument | null): UsageDocument | null {
  const signature = `${locale}\u0000${JSON.stringify(source)}`;
  const known = readDocuments.get(key);
  // A Map keeps the order things were put in: taken out and put back, a document read now is the newest.
  readDocuments.delete(key);
  const document = known?.signature === signature ? known.document : read();
  readDocuments.set(key, { signature, document });
  if (readDocuments.size > READ_DOCUMENTS_KEPT) readDocuments.delete(readDocuments.keys().next().value as string);
  return document;
}

/** Forgets the documents read — for tests that measure reading. */
export function forgetReadDocumentsForTests(): void {
  readDocuments.clear();
}

/**
 * Explicit uses only: a reference a document keeps or types. A source-note relationship or a similar
 * topic does not prove that the material contains the verse.
 */
export function usageDocuments(sources: UsageSources): UsageDocument[] {
  const { notes, sermons, groups, serviceOrders = [], currentNoteId, locale } = sources;
  const documents: UsageDocument[] = [];
  const add = (kind: ScriptureUsageKind, source: { id: string; updatedAt?: string }, read: () => { title: string; candidates: Candidate[]; body?: string; analysis?: StudyAnalysis }) => {
    const collection = COLLECTION_OF[kind];
    const document = readOnce(`${collection}/${source.id}`, source, locale, () => {
      const href = documentScreenHref({ collection, id: source.id });
      return href ? { kind, id: source.id, href, updatedAt: source.updatedAt ?? '', ...read() } : null;
    });
    if (document) documents.push(document);
  };
  notes.forEach(stored => {
    if (stored.id === currentNoteId) return;
    // A comment stands only where it is written to: a verse it names in its words is a link, not a second place —
    // "Связать с Пс 26:14" under Isaiah 40:31 must not stand grey under Psalm 26:14 too.
    const comment = stored.type === 'comment';
    // An analysis stands on the passage it analyses, and only there: its words are the passage's own.
    const analysis = stored.type === 'analysis';
    add(comment ? 'comment' : analysis ? 'analysis' : 'note', stored, () => {
      const note = withNoteReferenceBibles(stored, locale);
      const content = note.content ?? '';
      const listed = (note.scriptureRefs ?? []).map(reference => ({ reference, text: content, at: 0, inText: false, listed: true }));
      if (comment) return { title: note.title ?? '', candidates: listed, body: content };
      if (analysis) return { title: note.title ?? '', candidates: listed, body: content, ...(stored.analysis ? { analysis: stored.analysis } : {}) };
      return { title: note.title ?? '', candidates: [...listed, ...inText(content, locale, studyNoteLanguage(note))] };
    });
  });
  sermons.forEach(sermon => add('sermon', sermon, () => {
    const plan = renderPlanWithFallback(sermon, readPlanText(sermon));
    const written = sermonLanguage(sermon);
    return { title: sermon.title, candidates: [
      ...inText(sermon.verse ?? '', locale, written).map(candidate => ({ ...candidate, inText: false })),
      ...inText(Object.values(plan).join('\n\n'), locale, written),
      ...(sermon.thoughts ?? []).flatMap(thought => inText(thought.text, locale, written)),
      ...(sermon.scratch ?? []).flatMap(scratch => inText(scratch.text, locale, written)),
    ] };
  }));
  groups.forEach(group => add('group', group, () => {
    const groupWritten = groupLanguage(group);
    // What the meeting screen shows with its references as links (`groups/conduct/ConductBlock.tsx`): a block's
    // words and questions, and the leader's notes for one meeting. The group's words say the language, else the text's.
    return { title: group.title, candidates: [
      ...(group.templates ?? []).flatMap(block => {
        const text = `${block.title}\n${block.content}`;
        const questions = block.questions ?? [];
        const written = groupWritten ?? textLanguage([text, ...questions].join('\n'));
        return [
          ...(block.scriptureRefs ?? []).flatMap(raw => inText(raw, locale, written).map(candidate => ({ ...candidate, text, at: 0, inText: false, raw: undefined }))),
          ...inText(text, locale, written),
          // Each question on its own, as the meeting shows it: joined to the text, "Евр 4" followed by a
          // question read as a number inside prose, not a chapter (Codex review, round 2).
          ...questions.flatMap(question => inText(question, locale, written)),
        ];
      }),
      ...(group.flow ?? []).flatMap(item => (item.instanceNotes ? inText(item.instanceNotes, locale, groupWritten ?? textLanguage(item.instanceNotes)) : [])),
    ] };
  }));
  serviceOrders.forEach(order => add('order', order, () => {
    const orderWritten = serviceOrderLanguage(order);
    return { title: order.title, candidates: order.steps.flatMap(step => {
      // A step's kept passages and its words, as the order's page reads them.
      const text = `${step.title}\n${step.body ?? ''}`;
      const written = orderWritten ?? textLanguage(text);
      return [
        ...(step.scriptureRefs ?? []).flatMap(raw => inText(raw, locale, written).map(candidate => ({ ...candidate, text, at: 0, inText: false, raw: undefined }))),
        ...inText(text, locale, written),
      ];
    }) };
  }));
  return documents;
}

/** The mention in a document's words that names this reference itself, else one that overlaps it. */
const mentionOf = (documentMentions: readonly Candidate[], reference: ScriptureRefShape) =>
  documentMentions.find(mention => sameScriptureReference(reference, mention.reference))
    ?? documentMentions.find(mention => scriptureReferencesOverlap(reference, mention.reference));

/** The documents that use one passage, each once, by its strongest link to it. */
export function findScriptureUsage(target: ScriptureRefShape, sources: UsageSources): ScriptureUsage[] {
  const selected = withStoredBible(target, sources.locale);
  const matchOf = (candidate: Candidate): ScriptureUsageMatch =>
    candidate.inText ? 'text' : sameScriptureReference(selected, candidate.reference) ? 'same' : 'overlap';
  const results: Array<{ usage: ScriptureUsage; updatedAt: string }> = [];
  usageDocuments(sources).forEach(({ kind, id, title, href, updatedAt, candidates }) => {
    // A note's listed reference points at the words naming the opened passage itself, the very reference first.
    const typed = mentionOf(candidates.filter(candidate => candidate.inText), selected);
    const found = candidates
      .map(candidate => (candidate.listed ? { ...candidate, at: typed?.at ?? 0, raw: typed?.raw } : candidate))
      .filter(candidate => scriptureReferencesOverlap(selected, candidate.reference))
      .sort((a, b) => MATCH_ORDER[matchOf(a)] - MATCH_ORDER[matchOf(b)])[0];
    if (!found) return;
    results.push({ updatedAt, usage: { id, kind, title, href, reference: found.reference, match: matchOf(found),
      excerpt: excerpt(found.text, found.at), content: found.text, ...(found.raw ? { mention: found.raw } : {}) } });
  });
  return results
    .sort((a, b) => MATCH_ORDER[a.usage.match] - MATCH_ORDER[b.usage.match] || b.updatedAt.localeCompare(a.updatedAt))
    .map(({ usage }) => usage);
}

/**
 * One document on one passage of a book, in the numbering of the Bible being read: a sermon on Synodal
 * "Пс 22" stands on King James Psalm 23. A whole chapter has no verses (`passage.fromVerse` absent).
 */
export type BookUsageEntry = {
  /** Stable for the document and the passage: one document naming a passage twice stands there once. */
  key: string;
  kind: ScriptureUsageKind;
  id: string;
  title: string;
  href: string;
  updatedAt: string;
  passage: Passage;
  excerpt: string;
  /** A comment's own words, an analysis's parts as text (`UsageDocument.body`). */
  body?: string;
  /** An analysis's ties and links of meaning (`UsageDocument.analysis`). */
  analysis?: StudyAnalysis;
};

/** How kinds follow each other on one verse and on the minimap: the sermon first, then notes and comments, groups and service orders. */
export const SCRIPTURE_USAGE_KINDS: readonly ScriptureUsageKind[] = ['sermon', 'analysis', 'note', 'comment', 'group', 'order'];
const kindRank = (kind: ScriptureUsageKind) => SCRIPTURE_USAGE_KINDS.indexOf(kind);

const passageKey = (passage: Passage) => `${passage.chapter}:${passage.fromVerse ?? ''}-${passage.toChapter}:${passage.toVerse ?? ''}`;

/** Whether a passage holds the verse `chapter`:`verse`; a whole chapter holds each of its verses. */
export function passageCovers(passage: Passage, chapter: number, verse: number): boolean {
  if (chapter < passage.chapter || chapter > passage.toChapter) return false;
  if (passage.fromVerse === undefined) return true;
  if (chapter === passage.chapter && verse < passage.fromVerse) return false;
  return chapter !== passage.toChapter || verse <= (passage.toVerse ?? passage.fromVerse);
}

/** Whether every verse of `inner` lies in `outer` (another passage of the same document). */
function passageWithin(inner: Passage, outer: Passage): boolean {
  if (outer.fromVerse === undefined) return outer.chapter <= inner.chapter && inner.toChapter <= outer.toChapter;
  return inner.fromVerse !== undefined
    && passageCovers(outer, inner.chapter, inner.fromVerse)
    && passageCovers(outer, inner.toChapter, inner.toVerse ?? inner.fromVerse);
}

/**
 * Everything of the person's that points into one book, as the Bible `bible` numbers it, in the order of
 * the book: the reverse of `findScriptureUsage`, which asks for one passage. A reference to the whole
 * book names no place in it and is left out.
 */
export function bookUsage(documents: readonly UsageDocument[], bookId: string, bible: BibleId): BookUsageEntry[] {
  return documents.flatMap(document => documentInBook(document, bookId, bible)).sort((a, b) =>
    a.passage.chapter - b.passage.chapter
    || (a.passage.fromVerse ?? 0) - (b.passage.fromVerse ?? 0)
    || kindRank(a.kind) - kindRank(b.kind)
    || b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * One document's places in one book, kept with the document: a document is read once per version
 * (`readOnce`), so the same object comes back until it changes, and each book is laid out of it once —
 * laying a library of 850 documents on Hebrews again on every step of a sync took 300 ms.
 */
const laidOut = new WeakMap<UsageDocument, Map<string, BookUsageEntry[]>>();

function documentInBook(document: UsageDocument, bookId: string, bible: BibleId): BookUsageEntry[] {
  const books = laidOut.get(document) ?? new Map<string, BookUsageEntry[]>();
  laidOut.set(document, books);
  const key = `${bookId}|${bible}`;
  const known = books.get(key);
  if (known) return known;
  const entries = layDocument(document, bookId, bible);
  books.set(key, entries);
  return entries;
}

function layDocument({ kind, id, title, href, updatedAt, candidates, body, analysis }: UsageDocument, bookId: string, bible: BibleId): BookUsageEntry[] {
  const mentions = candidates.filter(candidate => candidate.inText);
  const own = new Map<string, BookUsageEntry>();
  candidates.forEach(candidate => {
    const { reference } = candidate;
    if (reference.book !== bookId || !reference.bible || !namesAPlace({ ...reference, bible: reference.bible })) return;
    const typed = candidate.listed ? mentionOf(mentions, candidate.reference) : candidate;
    const words = excerpt(candidate.text, typed?.at ?? 0);
    // A sermon's verse line is its reference alone: words that say nothing past the place are not shown.
    const said = /\p{L}/u.test(typed?.raw ? words.replace(typed.raw, '') : words) ? words : '';
    passagesIn(candidate.reference, bible).forEach(passage => {
      const key = `${kind}:${id}:${passageKey(passage)}`;
      if (!own.has(key)) own.set(key, { key, kind, id, title, href, updatedAt, passage, excerpt: said, ...(body !== undefined ? { body } : {}), ...(analysis ? { analysis } : {}) });
    });
  });
  // A document stands on a place once: a sermon on 4:9-11 whose thought names 4:10 is one badge, not two.
  const passages = [...own.values()];
  return passages.filter(entry => !passages.some(other => other !== entry && passageWithin(entry.passage, other.passage)));
}
