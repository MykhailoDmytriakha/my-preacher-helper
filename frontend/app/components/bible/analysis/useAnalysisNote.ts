'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PHASES_TAKING_CHANGES, useDataDocument } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { newClientId } from '@/utils/clientId';
import { analysisMarkdown, EMPTY_ANALYSIS, passageWords, settled, type AnalysisState, type Relation } from '@/utils/passageAnalysis';

import type { PickedPassage } from '../verseCopy/passagePick';
import type { DocumentData } from '@/data-engine/types';
import type { ScriptureReference, StudyAnalysis, StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';

/** What the reader asked to open: a passage just chosen, or an analysis already made. */
/** `editing` — reopened in «Правка» (after its verses were changed, or from the address), or `false` — in «Просмотр». */
export type AnalysisOpening = { kind: 'new'; passage: PickedPassage } | { kind: 'open'; id: string; editing?: boolean };

/** The note's own form: its drafts are this screen's, not another editor's of the same note. */
const ANALYSIS_SLOT = 'analysis';

export const passageOfReference = (reference: ScriptureReference | undefined): PickedPassage | null => {
  if (!reference || reference.chapter === undefined || reference.fromVerse === undefined) return null;
  return { chapter: reference.chapter, fromVerse: reference.fromVerse, toChapter: reference.toChapter ?? reference.chapter, toVerse: reference.toVerse ?? reference.fromVerse };
};
const samePassage = (a: PickedPassage | null, b: PickedPassage) => Boolean(a) && a!.chapter === b.chapter && a!.fromVerse === b.fromVerse && a!.toChapter === b.toChapter && a!.toVerse === b.toVerse;
/** «1:3–14», «1:7», «1:15–2:10». */
export const passageSpan = (p: PickedPassage) => (p.chapter === p.toChapter ? `${p.chapter}:${p.fromVerse}${p.toVerse !== p.fromVerse ? `–${p.toVerse}` : ''}` : `${p.chapter}:${p.fromVerse}–${p.toChapter}:${p.toVerse}`);
/** The same parts, ties and links of meaning, whatever order they were made in. */
const sameAnalysis = (a: AnalysisState, b: AnalysisState) => JSON.stringify([...a.cuts].sort((x, y) => x - y)) === JSON.stringify([...b.cuts].sort((x, y) => x - y))
  && JSON.stringify(Object.entries(a.links).sort()) === JSON.stringify(Object.entries(b.links).sort())
  && JSON.stringify(a.relations) === JSON.stringify(b.relations)
  && JSON.stringify(a.drawn ?? []) === JSON.stringify(b.drawn ?? []);
/** An analysis as the note keeps it — read back by `storedState`; the only writer of that shape. */
export const storedAnalysis = (state: AnalysisState, bible: BibleId, words: number): StudyAnalysis => ({
  bible, words, cuts: state.cuts,
  links: Object.fromEntries(Object.entries(state.links).map(([key, word]) => [String(key), word])),
  relations: Object.fromEntries(state.relations.map(({ a, b, dir, color }) => [`${a}-${b}`, { dir, color }])),
  // Kept only when there is one: an analysis with no drawn tie keeps the shape it had before the field.
  ...(state.drawn?.length ? { drawn: state.drawn } : {}),
});
export const storedState = (note: StudyNote | undefined, total: number): AnalysisState => analysisState(note?.analysis, total);
/** An analysis as the note keeps it, read back into its parts, ties and links of meaning for a passage of `total` words. */
export function analysisState(stored: StudyAnalysis | undefined, total: number): AnalysisState {
  if (!stored) return EMPTY_ANALYSIS;
  const relations = Object.entries(stored.relations ?? {}).flatMap(([key, { dir, color }]) => {
    const [a, b] = key.split('-').map(Number);
    return [{ a, b, dir, color: color as Relation['color'] }];
  });
  return settled({ cuts: stored.cuts ?? [], links: Object.fromEntries(Object.entries(stored.links ?? {}).map(([key, word]) => [Number(key), word])), relations, drawn: stored.drawn ?? [] }, total);
}

/**
 * A PASSAGE'S ANALYSIS AS A STUDY NOTE (case 2026-10-12-block-diagram, 3.4): finds the note asked for, or one already made
 * on exactly this passage in this Bible, and reads its parts once they arrive. The first change makes the note («что-то
 * изменил — значит, уже разобрано», the owner, 2026-10-29).
 *
 * ONE FORM OF THE ENGINE FOR THE NOTE (`.howto/use-data-engine-in-a-screen.md`, as the Bible marks keep their book): every
 * change is committed at once onto the form's newest draft, kept on the device before the network is asked, and the
 * requests chain. Before, each change was a one-shot action on a copy, and a change of the same note arriving meanwhile
 * was taken in as soon as this screen's own write had left — its own older write coming back too, so a colour picked
 * snapped back (the owner, 30.10: «выбранный цвет сбивается»), and a refusal left only «закройте разбор». Now the screen
 * takes the form's draft in only while none of its own changes is on the way, and a refusal or a conflict is the form's,
 * answered here with the engine's own choices (`sync`).
 */
export function useAnalysisNote({ opening, text, bookId, bible, locale }: { opening: AnalysisOpening; text: BookText; bookId: string; bible: BibleId; locale: AppLocale }) {
  const { t } = useTranslation();
  const engine = useStudyNotesEngine(true);
  // The note this screen writes to, once it has one: asked for, found on the passage and read, or made here. Only that
  // note is read back — an analysis of the same passage found later is another note, never one to write over.
  const [ownId, setOwnId] = useState<string | null>(opening.kind === 'open' ? opening.id : null);
  const noteId = useRef<string | null>(ownId);
  const found = useMemo(() => {
    if (ownId) return engine.notes.find((note) => note.id === ownId);
    if (opening.kind === 'open') return undefined;
    return engine.notes.find((note) => note.type === 'analysis' && note.analysis?.bible === bible && note.scriptureRefs[0]?.book === bookId
      && samePassage(passageOfReference(note.scriptureRefs[0]), opening.passage));
  }, [engine.notes, opening, ownId, bible, bookId]);
  // A note made here opens its form only once its creation is kept on this device: opened before, it could find neither
  // the document nor its creation and wait for a connection (Codex, 30.10). It is this screen's note from the start.
  const [kept, setKept] = useState(true);
  const resource = useMemo(() => (ownId && kept ? { collection: 'studyNotes', id: ownId } : null), [ownId, kept]);
  const form = useDataDocument(resource, { slot: ANALYSIS_SLOT, readOnlyCopy: true });
  // One copy of the note gives both the passage and its parts — the form's draft once it is open, the list's copy before:
  // a passage from one version and parts from another would lay the parts on the wrong verses (Codex, 30.10). An analysis
  // of the passage found after the person began here is not this screen's and is never read into it (Codex, 30.10).
  const touched = useRef(false);
  const shown = ownId || !touched.current ? found : undefined;
  const copy = (form.data as { scriptureRefs?: ScriptureReference[]; analysis?: StudyAnalysis } | null) ?? shown ?? null;
  const passage = opening.kind === 'new' ? opening.passage : passageOfReference(copy?.scriptureRefs?.[0]);
  const span = passage ? passageSpan(passage) : '';
  const words = useMemo(() => (passage ? passageWords(text, passage) : []), [text, span]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = words.length;
  const abbrev = getLocalizedAbbrev(bookId, locale);
  const place = `${abbrev}${span ? ` ${span}` : ''}`;

  const writable = Boolean(form.state) && !form.readOnly && PHASES_TAKING_CHANGES.has(form.status?.phase ?? '');
  const stored = copy?.analysis;
  // Every stored part of the analysis: a change of the drawn ties alone is a change too (Codex, 31.10).
  const storedKey = stored ? JSON.stringify([stored.cuts, stored.links, stored.relations ?? null, stored.drawn ?? null]) : '';
  // Nothing is changed before the person's analyses are read, nor on a note whose form cannot take it: a change made
  // first would make a second analysis of a passage already analysed, or write over work the screen never showed
  // (Codex's hunt, 2026-10-30). Read means asked of the server too, while it answers: the list on this device may lack
  // the analysis made elsewhere (Codex, 30.10). Without the server, or after 8 s of an answer that does not come (a
  // frozen device store), it is what this device has — a second analysis at worst, never one written over.
  // This device refused to keep the note just made: the work is only on the screen, and nothing more is taken until it is
  // kept — a second change would make a second note, refused or not (Codex, 30.10).
  const [refused, setRefused] = useState(false);
  const [waitedOut, setWaitedOut] = useState(false);
  const listPending = engine.loading || engine.checking;
  useEffect(() => {
    setWaitedOut(false);
    if (!listPending) return undefined;
    const timer = setTimeout(() => setWaitedOut(true), 8000);
    return () => clearTimeout(timer);
  }, [listPending]);
  const ready = ownId ? writable : !refused && (!listPending || waitedOut) && !found;

  const [state, setState] = useState<AnalysisState>(EMPTY_ANALYSIS);
  const [history, setHistory] = useState<AnalysisState[]>([]);
  const [opensForViewing, setOpensForViewing] = useState(false);
  const loaded = useRef(false);
  // A new opening on a passage already analysed takes that note — unless the person began here first.
  useEffect(() => {
    if (ownId || !found || touched.current) return;
    noteId.current = found.id;
    setOwnId(found.id);
  }, [found, ownId]);
  useEffect(() => {
    if (loaded.current || !ownId || !stored || !total) return;
    loaded.current = true;
    if (touched.current) return;
    const read = analysisState(stored, total);
    setState(read);
    setOpensForViewing(read.cuts.length > 0);
  }, [ownId, storedKey, total]); // eslint-disable-line react-hooks/exhaustive-deps

  // This screen's changes laid on the form and not yet in its draft; the draft is taken in only at zero.
  const onTheWay = useRef(0);
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const stateRef = useRef(state);
  stateRef.current = state;
  const takeIn = useCallback(() => {
    if (!loaded.current || !total || onTheWay.current || !storedRef.current) return;
    const read = analysisState(storedRef.current, total);
    if (sameAnalysis(read, stateRef.current)) return;
    setState(read);
    // An undo here would bring back a step from before that change, over it.
    setHistory([]);
  }, [total]);
  useEffect(() => { takeIn(); }, [storedKey, takeIn]);

  const valueOf = useCallback((next: AnalysisState) => ({ analysis: storedAnalysis(next, bible, total), content: analysisMarkdown(words, next) }), [bible, total, words]);
  // A change made while the note just made here has no open form yet waits for it; it goes when the form opens.
  const waiting = useRef<AnalysisState | null>(null);
  const lay = useCallback((next: AnalysisState) => {
    if (!writable) { waiting.current = next; return; }
    onTheWay.current += 1;
    const fields = valueOf(next) as unknown as DocumentData;
    void form.commit((value): DocumentData | null => (value ? { ...value, ...fields, updatedAt: new Date().toISOString() } : value))
      .catch(() => undefined) // the form says it: `sync`
      .finally(() => { onTheWay.current -= 1; takeIn(); });
  }, [form, takeIn, valueOf, writable]);
  useEffect(() => {
    if (!writable || !waiting.current) return;
    const next = waiting.current;
    waiting.current = null;
    lay(next);
  }, [lay, writable]);

  // The note this device said it refused may have been queued all the same (Codex, 30.10): once it shows in the list it
  // is taken, never made a second time.
  const refusedId = useRef<string | null>(null);
  const create = useCallback((next: AnalysisState) => {
    if (!passage) return;
    // Taken as it is: it holds the work made before the refusal, after which nothing more was taken, and maybe more
    // made elsewhere since — nothing of the screen is laid over it (Codex, 30.10).
    const queuedNote = refusedId.current ? engine.notes.find((note) => note.id === refusedId.current) : undefined;
    if (queuedNote) {
      refusedId.current = null;
      noteId.current = queuedNote.id;
      loaded.current = true;
      waiting.current = null;
      setRefused(false);
      setOwnId(queuedNote.id);
      return;
    }
    const reference: ScriptureReference = {
      id: newClientId(), bible, book: bookId, chapter: passage.chapter, fromVerse: passage.fromVerse,
      ...(passage.toChapter !== passage.chapter ? { toChapter: passage.toChapter } : {}), toVerse: passage.toVerse,
    };
    setRefused(false);
    const created = engine.createNote({ userId: engine.uid ?? '', title: t('analysis.title', { place }), scriptureRefs: [reference], tags: [], type: 'analysis', ...valueOf(next) });
    waiting.current = null;
    noteId.current = created.note.id;
    loaded.current = true;
    setKept(false);
    setOwnId(created.note.id);
    // Changes made before the form opens wait for it. A creation refused leaves the work on the screen and says so: the
    // next change, or «Сохранить ещё раз», makes the note again (Codex, 30.10: closing then lost it without a word).
    void created.acceptance.then(() => setKept(true), () => {
      if (noteId.current !== created.note.id) return;
      noteId.current = null;
      refusedId.current = created.note.id;
      setOwnId(null);
      setKept(true);
      setRefused(true);
    });
  }, [bible, bookId, engine, passage, place, t, valueOf]);
  // Kept after all: the screen takes it and says nothing more.
  const queued = refused && refusedId.current ? engine.notes.some((note) => note.id === refusedId.current) : false;
  useEffect(() => { if (queued) create(stateRef.current); }, [queued, create]);

  /** The note this device refused made again from what the screen shows. */
  const saveAgain = useCallback(() => { if (!noteId.current) create(stateRef.current); }, [create]);

  // The screen going while a change still waits for the new note's form: it goes as one action.
  const flush = useCallback(() => {
    const next = waiting.current;
    if (!next || !noteId.current) return;
    waiting.current = null;
    void engine.updateNote({ id: noteId.current, updates: valueOf(next) }).result.catch(() => undefined);
  }, [engine, valueOf]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  const change = useCallback((next: AnalysisState) => {
    if (!ready) return;
    touched.current = true;
    setHistory((list) => [...list, state]);
    setState(next);
    if (noteId.current) lay(next); else create(next);
  }, [create, lay, ready, state]);
  // Like a change, an undo waits for a form that can take it: queued over a decision, it would come back over the version
  // the person chose (Codex, 30.10).
  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!ready || !last || !noteId.current) return;
    setHistory(history.slice(0, -1));
    setState(last);
    lay(last);
  }, [history, lay, ready]);

  return {
    passage, words, total, abbrev, place, state, change, undo, canUndo: ready && history.length > 0, flush, opensForViewing,
    /** The person's analyses are read and the note's form can take a change. */
    ready,
    /** The note the analysis is kept in, once there is one. */
    noteId: () => noteId.current,
    /** The same, as a value a screen can follow: null until the note is found or made. */
    id: ownId,
    /** The note's form, for its status: shown only when something needs the person. */
    sync: resource ? form : null,
    /** The note asked for is on no copy this device can reach: neither in the read list nor in a form. */
    missing: opening.kind === 'open' && !engine.loading && !found && !form.data && !form.loading,
    /** The passage's words in this Bible are not the ones the analysis was made on. */
    changedText: Boolean(stored && stored.words !== total),
    /** This device refused to keep the new analysis: what is on the screen is not saved; `saveAgain` tries once more. */
    refused,
    saveAgain,
  };
}
