'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { analysisCreationScope, PHASES_TAKING_CHANGES, useDataDocument } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { newClientId } from '@/utils/clientId';
import { analysisMarkdown, analysisState, EMPTY_ANALYSIS, passageWords, storedAnalysis, storedState, type AnalysisState } from '@/utils/passageAnalysis';
import { analysisPassage, analysisSourceMatches, studyAnalysisSource } from '@/utils/studyAnalysisSource';

import type { PickedPassage } from '../verseCopy/passagePick';
import type { DocumentData } from '@/data-engine/types';
import type { ScriptureReference, StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';

/** What the reader asked to open: a passage just chosen, or an analysis already made. */
/** `editing` — reopened in «Правка» (after its verses were changed, or from the address), or `false` — in «Просмотр». */
export type AnalysisOpening = { kind: 'new'; passage: PickedPassage } | { kind: 'open'; id: string; editing?: boolean };

/** The note's own form: its drafts are this screen's, not another editor's of the same note. */
const ANALYSIS_SLOT = 'analysis';

export const passageOfReference = (reference: ScriptureReference | undefined, bible?: BibleId): PickedPassage | null => analysisPassage(reference, bible);
export { analysisState, storedAnalysis, storedState };
const samePassage = (a: PickedPassage | null, b: PickedPassage) => Boolean(a) && a!.chapter === b.chapter && a!.fromVerse === b.fromVerse && a!.toChapter === b.toChapter && a!.toVerse === b.toVerse;
/** Discovery never chooses an automatic transfer destination between several existing copies. */
function analysesForPassage(notes: readonly StudyNote[], book: string, bible: BibleId, passage: PickedPassage): StudyNote[] {
  return notes.filter(note => note.type === 'analysis' && note.analysis?.bible === bible && note.scriptureRefs[0]?.book === book
    && samePassage(passageOfReference(note.scriptureRefs[0], bible), passage));
}
function uniqueOtherAnalysis(notes: readonly StudyNote[], ownId: string | null, passage: PickedPassage | null, book: string, bible: BibleId): StudyNote | undefined {
  if (!ownId || !passage) return undefined;
  const candidates = analysesForPassage(notes, book, bible, passage).filter(note => note.id !== ownId);
  return candidates.length === 1 ? candidates[0] : undefined;
}
/** «1:3–14», «1:7», «1:15–2:10». */
export const passageSpan = (p: PickedPassage) => (p.chapter === p.toChapter ? `${p.chapter}:${p.fromVerse}${p.toVerse !== p.fromVerse ? `–${p.toVerse}` : ''}` : `${p.chapter}:${p.fromVerse}–${p.toChapter}:${p.toVerse}`);
/** The same parts, ties and links of meaning, whatever order they were made in. */
const sameAnalysis = (a: AnalysisState, b: AnalysisState) => JSON.stringify([...a.cuts].sort((x, y) => x - y)) === JSON.stringify([...b.cuts].sort((x, y) => x - y))
  && JSON.stringify(Object.entries(a.links).sort()) === JSON.stringify(Object.entries(b.links).sort())
  && JSON.stringify(a.relations) === JSON.stringify(b.relations);
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
  const currentEngine = useRef(engine); currentEngine.current = engine;
  const openingId = opening.kind === 'open' ? opening.id : null;
  // The note this screen writes to, once it has one: asked for, found on the passage and read, or made here. Only that
  // note is read back. Adopting an existing passage requires the engine's durable transfer proof.
  const [ownId, setOwnId] = useState<string | null>(opening.kind === 'open' ? opening.id : null);
  const noteId = useRef<string | null>(ownId);
  const found = useMemo(() => {
    if (ownId) return engine.notes.find((note) => note.id === ownId);
    if (opening.kind === 'open') return undefined;
    return analysesForPassage(engine.notes, bookId, bible, opening.passage)[0];
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
  const copy = (form.data as Partial<StudyNote> | null) ?? shown ?? null;
  const confirmed = form.confirmed?.value as Partial<StudyNote> | null | undefined;
  const sourceNote = confirmed ?? copy;
  const source = studyAnalysisSource(sourceNote);
  const sourceMatches = !copy ? text.id === bookId : analysisSourceMatches(sourceNote, bookId, bible, text) && analysisSourceMatches(copy, bookId, bible, text);
  const passage = opening.kind === 'new' ? opening.passage : passageOfReference(copy?.scriptureRefs?.[0], source?.bible ?? bible);
  const span = passage ? passageSpan(passage) : '';
  const words = useMemo(() => (passage && sourceMatches ? passageWords(text, passage) : []), [text, span, sourceMatches]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = words.length;
  const abbrev = getLocalizedAbbrev(bookId, locale);
  const place = `${abbrev}${span ? ` ${span}` : ''}`;

  const writable = sourceMatches && Boolean(passage && total) && Boolean(form.state) && !form.readOnly && PHASES_TAKING_CHANGES.has(form.status?.phase ?? '');
  const stored = copy?.analysis;
  const storedKey = stored ? JSON.stringify([stored.cuts, stored.links, stored.relations ?? null]) : '';
  // Nothing is changed before the person's analyses are read, nor on a note whose form cannot take it: a change made
  // first would make a second analysis of a passage already analysed, or write over work the screen never showed
  // (Codex's hunt, 2026-10-30). Read means asked of the server too, while it answers: the list on this device may lack
  // the analysis made elsewhere (Codex, 30.10). Without the server, or after 8 s of an answer that does not come (a
  // frozen device store), it uses this device's copy. Server admission and the shared transfer rule preserve
  // independently captured marks when an existing exact-passage analysis is discovered on reconnection.
  // This device refused to keep the note just made: the work is only on the screen, and nothing more is taken until it is
  // kept — a second change would make a second note, refused or not (Codex, 30.10).
  const [refused, setRefused] = useState(false);
  const [combining, setCombining] = useState(false);
  const combiningNow = useRef(false);
  const creationAttempt = useRef<{ id: string; reference: ScriptureReference } | null>(null);
  const creating = useRef(false);
  const adoptionSource = useRef<string | null>(null);
  const [recoveringAddress, setRecoveringAddress] = useState(Boolean(openingId));
  const releasedAdoption = useRef<string | null>(null);
  const [waitedOut, setWaitedOut] = useState(false);
  const listPending = engine.loading || engine.checking;
  useEffect(() => {
    setWaitedOut(false);
    if (!listPending) return undefined;
    const timer = setTimeout(() => setWaitedOut(true), 8000);
    return () => clearTimeout(timer);
  }, [listPending]);
  const ready = !combining && sourceMatches && Boolean(passage && total) && (ownId ? writable : !refused && (!listPending || waitedOut) && !found);

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
    if (!sourceMatches) return;
    if (!writable) { waiting.current = next; return; }
    onTheWay.current += 1;
    const fields = valueOf(next) as unknown as DocumentData;
    void form.commit((value): DocumentData | null => (value && analysisSourceMatches(value, bookId, bible, text) ? { ...value, ...fields, updatedAt: new Date().toISOString() } : value))
      .catch(() => undefined) // the form says it: `sync`
      .finally(() => { onTheWay.current -= 1; takeIn(); });
  }, [bible, bookId, form, sourceMatches, takeIn, text, valueOf, writable]);
  useEffect(() => {
    if (!writable || !waiting.current) return;
    const next = waiting.current;
    waiting.current = null;
    lay(next);
  }, [lay, writable]);

  useEffect(() => {
    if (!openingId || !engine.uid) { setRecoveringAddress(false); return; }
    let active = true;
    setRecoveringAddress(true);
    void currentEngine.current.recoverAnalysisCreation(openingId).then(captured => {
      if (!active || !captured) return;
      if (captured.id === openingId) { adoptionSource.current = openingId; return; }
      if (touched.current || onTheWay.current || waiting.current) return;
      adoptionSource.current = openingId;
      // The native transaction may have finished just before the previous page
      // stopped. Its retained proof, not a passage match or a stale URL, owns this move.
      noteId.current = captured.id; loaded.current = false; refusedId.current = null;
      setHistory([]); setOwnId(captured.id); setRefused(false); setKept(true);
    }, () => undefined).finally(() => { if (active) setRecoveringAddress(false); });
    return () => { active = false; };
  }, [engine.uid, openingId]);

  // The note this device said it refused may have been queued all the same (Codex, 30.10): once it shows in the list it
  // is taken, never made a second time.
  const refusedId = useRef<string | null>(null);
  const create = useCallback((next: AnalysisState) => {
    if (!passage || !sourceMatches) return;
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
    if (creating.current) return;
    const previousAttempt = creationAttempt.current;
    const attempt = previousAttempt ?? {
      id: newClientId(), reference: {
        id: newClientId(), bible, book: bookId, chapter: passage.chapter, fromVerse: passage.fromVerse,
        ...(passage.toChapter !== passage.chapter ? { endChapter: passage.toChapter } : {}), toVerse: passage.toVerse,
      },
    };
    creationAttempt.current = attempt; adoptionSource.current = attempt.id;
    creating.current = true;
    const capture = async () => {
      // The first capture may have committed before its caller was retired. Ask the shared
      // engine before a retry; a list projection is not the ownership proof.
      if (previousAttempt) {
        const captured = await engine.recoverAnalysisCreation(attempt.id);
        if (captured) {
          refusedId.current = null; noteId.current = captured.id; loaded.current = true;
          waiting.current = null; setRefused(false); setKept(true); setOwnId(captured.id);
          return;
        }
      }
      setRefused(false);
      const created = engine.createNote({ userId: engine.uid ?? '', title: t('analysis.title', { place }),
        scriptureRefs: [attempt.reference], tags: [], type: 'analysis', ...valueOf(next) },
      { id: attempt.id, captureScope: analysisCreationScope(attempt.id) });
      waiting.current = null;
      noteId.current = created.note.id;
      loaded.current = true;
      setKept(false); setOwnId(created.note.id);
      try { await created.acceptance; setKept(true); }
      catch {
        if (noteId.current !== created.note.id) return;
        noteId.current = null; refusedId.current = created.note.id;
        setOwnId(null); setKept(true); setRefused(true);
      }
    };
    void capture().catch(() => setRefused(true)).finally(() => { creating.current = false; });
  }, [bible, bookId, engine, passage, place, sourceMatches, t, valueOf]);
  // Kept after all: the screen takes it and says nothing more.
  const queued = refused && refusedId.current ? engine.notes.some((note) => note.id === refusedId.current) : false;
  useEffect(() => { if (queued) create(stateRef.current); }, [queued, create]);

  /** The note this device refused made again from what the screen shows. */
  const saveAgain = useCallback(() => { if (!noteId.current) create(stateRef.current); }, [create]);

  const duplicateRefusal = form.state?.result?.kind === 'refused' && form.state.result.code === 'analysis-exists';
  const existingAnalysis = uniqueOtherAnalysis(engine.notes, ownId, passage, bookId, bible);
  const [waitingCapture, setWaitingCapture] = useState(0);
  const attemptedWaitingCapture = useRef<string | null>(null);
  const attemptedTransfer = useRef<string | null>(null);
  const [creationReview, setCreationReview] = useState(false);
  const [combinationRetry, setCombinationRetry] = useState(0);
  const refreshedRefusal = useRef<string | null>(null);
  useEffect(() => {
    if (!duplicateRefusal || !ownId || existingAnalysis || refreshedRefusal.current === ownId) return;
    refreshedRefusal.current = ownId;
    void engine.refetch().then(() => setCreationReview(true), () => setCreationReview(true));
  }, [duplicateRefusal, engine, existingAnalysis, ownId]);
  useEffect(() => {
    if (!duplicateRefusal || !waiting.current || !form.state || form.readOnly || combiningNow.current || onTheWay.current) return;
    const key = JSON.stringify([ownId, waiting.current]);
    if (attemptedWaitingCapture.current === key) return;
    attemptedWaitingCapture.current = key;
    // These marks were already authored before the first form opened. Capture their
    // successor behind the refused create; never deliver them as a second creation.
    const next = waiting.current; waiting.current = null; onTheWay.current += 1;
    const fields = valueOf(next) as unknown as DocumentData;
    setCombining(true);
    void form.commit(value => value && analysisSourceMatches(value, bookId, bible, text)
      ? { ...value, ...fields, updatedAt: new Date().toISOString() } : value)
      .catch(() => { waiting.current ??= next; setCreationReview(true); })
      .finally(() => { onTheWay.current -= 1; setCombining(false); setWaitingCapture(value => value + 1); });
  }, [bible, bookId, combinationRetry, duplicateRefusal, form, ownId, text, valueOf]);
  useEffect(() => {
    if (!duplicateRefusal || !ownId || !existingAnalysis || combiningNow.current || onTheWay.current || waiting.current) return;
    const key = JSON.stringify([ownId, storedKey, existingAnalysis.id, existingAnalysis.analysis, existingAnalysis.updatedAt]);
    if (attemptedTransfer.current === key) return;
    attemptedTransfer.current = key; combiningNow.current = true; setCombining(true); setCreationReview(false);
    const sourceId = ownId;
    void engine.combineAnalysisCreation(sourceId, existingAnalysis.id, text).then(id => {
      if (noteId.current !== sourceId) return;
      adoptionSource.current = sourceId;
      noteId.current = id; refusedId.current = null; waiting.current = null;
      loaded.current = true; setHistory([]); setOwnId(id); setRefused(false);
    }, () => { if (noteId.current === sourceId) setCreationReview(true); })
      .finally(() => { combiningNow.current = false; setCombining(false); });
  }, [combinationRetry, duplicateRefusal, engine, existingAnalysis, ownId, storedKey, text, waitingCapture]);

  useEffect(() => {
    const sourceId = adoptionSource.current;
    if (!sourceId || !ownId || !kept || combining || !form.state) return;
    const key = JSON.stringify([sourceId, ownId]);
    if (releasedAdoption.current === key) return;
    releasedAdoption.current = key;
    // Release only the temporary hold. The engine verifies that this open form owns
    // the request; its checkpoint and ordinary delivery references continue protecting it.
    void engine.releaseAnalysisCreation(sourceId, ownId).catch(() => undefined);
  }, [combining, engine, form.state, kept, ownId]);

  const retryCombination = useCallback(() => {
    attemptedTransfer.current = null;
    attemptedWaitingCapture.current = null;
    refreshedRefusal.current = null;
    setCombinationRetry(value => value + 1);
    setCreationReview(false);
    void engine.refetch().catch(() => setCreationReview(true));
  }, [engine]);
  const openExistingAnalysis = useCallback(() => {
    if (!existingAnalysis || combiningNow.current || waiting.current || onTheWay.current) return;
    // Opening the canonical note is navigation, not a choice to discard the held local draft.
    noteId.current = existingAnalysis.id; loaded.current = false; waiting.current = null;
    setHistory([]); setOwnId(existingAnalysis.id); setCreationReview(false);
  }, [existingAnalysis]);

  // The screen going while a change still waits for the new note's form: it goes as one action.
  const flush = useCallback(() => {
    const next = waiting.current;
    if (!next || !noteId.current || !sourceMatches) return;
    waiting.current = null;
    void engine.updateNote({ id: noteId.current, updates: valueOf(next) }).result.catch(() => undefined);
  }, [engine, sourceMatches, valueOf]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  const change = useCallback((next: AnalysisState) => {
    if (!ready || combiningNow.current) return;
    touched.current = true;
    setHistory((list) => [...list, state]);
    setState(next);
    if (noteId.current) lay(next); else create(next);
  }, [create, lay, ready, state]);
  // Like a change, an undo waits for a form that can take it: queued over a decision, it would come back over the version
  // the person chose (Codex, 30.10).
  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!ready || combiningNow.current || !last || !noteId.current) return;
    setHistory(history.slice(0, -1));
    setState(last);
    lay(last);
  }, [history, lay, ready]);

  return {
    hasSavedParts: Boolean(stored?.cuts?.length),
    source, sourceReference: sourceNote?.scriptureRefs?.[0], sourceMatches, passage, words, total, abbrev, place, state, change, undo, canUndo: ready && history.length > 0, flush, opensForViewing,
    /** The person's analyses are read and the note's form can take a change. */
    ready,
    /** The note the analysis is kept in, once there is one. */
    noteId: () => noteId.current,
    /** The same, as a value a screen can follow: null until the note is found or made. */
    id: ownId,
    /** The note's form, for its status: shown only when something needs the person. */
    sync: resource ? form : null,
    /** The note asked for is on no copy this device can reach: neither in the read list nor in a form. */
    missing: opening.kind === 'open' && !recoveringAddress && !engine.loading && !found && !form.data && !form.loading,
    /** The passage's words in this Bible are not the ones the analysis was made on. */
    changedText: Boolean(stored && stored.words !== total),
    /** This device refused to keep the new analysis: what is on the screen is not saved; `saveAgain` tries once more. */
    refused,
    combining, creationReview, duplicateRefusal, existingAnalysis, retryCombination, openExistingAnalysis,
    canOpenExistingAnalysis: !waiting.current && !onTheWay.current,
    saveAgain,
  };
}
