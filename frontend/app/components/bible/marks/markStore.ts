import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDataCollection, useDataDocument } from '@/data-engine/react.client';
import { refusalMessage } from '@/utils/actionFailureMessage';
import { diagnosticErrorCode, recordDiagnostic } from '@/utils/appDiagnostics';
import { decodeBookMarks, encodeBookMarks, marksKey, type BookMarks, type OtherBookMarks } from '@/utils/bibleMarks';
import { isBibleId } from '@/utils/bibles';
import { bookSlug } from '@/utils/bibleText';

import type { DocumentData } from '@/data-engine/types';
import type { BibleId } from '@/utils/bibles';

/*
 * THE MARKS ON EVERY DEVICE OF THE PERSON — kept through the app's data engine (`data-engine/README.md`):
 * one document per person, Bible and book in `bibleMarks`, under one fixed id, so two devices never make
 * two documents of one book. Its verses are a map: marks in different verses from two devices merge by
 * themselves.
 *
 * ONE FORM OF THE ENGINE PER BOOK (`useDataDocument`), the engine's own way of editing one document
 * continuously: every stroke is a `commit` of that form, laid over its newest draft at once — strokes
 * made quickly build on each other and never on an older copy, and each is kept on the device before
 * the network is asked (the owner's iPad, 2026-10-16: strokes sent as separate one-shot changes were
 * built on the same copy and the server answered "conflict" to the person's own strokes; a writer that
 * waited for each delivery left the next strokes only in the page's memory). The form's draft is what
 * the page shows. A book its list, read whole, shows no document of is opened for creation: the first
 * stroke makes the document, offline too. A stroke is taken only while the form is open and can write
 * (`writable`): the page never shows a stroke it cannot keep (2026-10-16: strokes made before the form
 * opened were shown, held in the page's memory, and gone after a reload). While the form is a copy for
 * reading — the device's storage silent for seconds after an iPad wakes — the marks still show and the
 * reader says to wait. What still needs the person — a verse changed on two devices at once — is said
 * by the form's status (`sync`), never as code.
 */
export const BIBLE_MARKS = 'bibleMarks';
/** The marks' own form: its drafts are not a screen's typing. */
const MARKS_SLOT = 'bible-marks';

export const marksDocumentId = (owner: string, bible: BibleId, bookId: string) => `${owner}_${bible}_${bookSlug(bookId)}`;

type StoredDocument = { verses?: unknown } & Record<string, unknown>;
export type MarksChange = (marks: BookMarks) => BookMarks;

/**
 * The form's states a stroke may be laid on. Any other — a choice waiting for the person, a failed save, a
 * deleted document — could sweep a new stroke away with the draft it replaces, or never keep it.
 */
const STROKE_READY = new Set(['saved', 'draft', 'savingLocally', 'queued', 'sending', 'unknown', 'remoteChanged']);
/** A stroke's form closed under it (the reader was left): the stroke itself goes on to the server. */
const formLeft = (error: unknown) => error instanceof Error
  && (error.name === 'InactiveEditorError' || error.message === 'Editor is no longer active' || error.message === 'The active editor changed');

export type BookMarksStore = {
  marks: BookMarks;
  /** A stroke: how it changes the book's marks; laid over the form's newest draft. `lost` runs if it is not kept. */
  save: (change: MarksChange, lost?: () => void) => void;
  /** The person's marks are read and the book's form is open: the marks can be shown and judged. */
  ready: boolean;
  /** The form can write: a stroke is kept on the device the moment it is made. */
  writable: boolean;
  /** This book's marks in the person's other Bibles, from the same list: a sign at their verses here. */
  others: OtherBookMarks[];
  /** The book's form, for its status: shown only when something needs the person. */
  sync: ReturnType<typeof useDataDocument> | null;
};

export function useBookMarks(owner: string | null, bible: BibleId, bookId: string): BookMarksStore {
  const { t } = useTranslation();
  const collection = useDataCollection(owner ? BIBLE_MARKS : null);
  const id = owner ? marksDocumentId(owner, bible, bookId) : null;
  const documents = collection.state?.documents;
  const listRead = Boolean(owner) && collection.state !== null && !collection.loading;
  // Whether the book's first stroke makes its document is settled once, when the book opens with its
  // list read: changing it later would reopen the form under the person's hand. Online the form reads the
  // document itself (absent or not), so a list a moment behind another device can never open it for a
  // creation the server would refuse; only offline, where nothing can be read, does a whole list's
  // "no document" open the book for creation.
  const opening = useRef<{ id: string; create: boolean } | null>(null);
  if (id && listRead && opening.current?.id !== id) {
    const listed = documents?.some((document) => document.resource.id === id && document.value !== null) ?? false;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    opening.current = { id, create: offline && collection.state?.complete === true && !listed };
  }
  const create = opening.current?.id === id ? opening.current.create : false;
  const resource = useMemo(() => (id && listRead ? { collection: BIBLE_MARKS, id } : null), [id, listRead]);
  // Every stroke is committed at once; autosave stays on only as the engine's own guard for a draft
  // left unsent (it saves when the page is hidden or left).
  // While the device's storage is silent the form shows a copy for reading: the marks stay on the page.
  const form = useDataDocument(resource, { slot: MARKS_SLOT, create, readOnlyCopy: true });
  const stored = (form.data ?? null) as StoredDocument | null;
  const decoded = useMemo(() => decodeBookMarks(stored?.verses), [stored]);
  // The same marks stay the same object: the form hands a new copy at every step of a save (kept on the
  // device, queued, sent, answered), and the page draws the marks again only when they change.
  const same = useRef(decoded);
  if (marksKey(same.current) !== marksKey(decoded)) same.current = decoded;
  const formMarks = same.current;

  // Keyed by value, not by the list's array: the list comes anew with every stroke here, and what reads
  // these (the ribbon's signs) is redrawn only when the other Bibles' marks change.
  const othersKey = useMemo(() => JSON.stringify((documents ?? []).flatMap((document) => {
    const value = document.value as StoredDocument | null;
    if (!value || value.book !== bookId || value.bible === bible || !isBibleId(value.bible)) return [];
    return [{ bible: value.bible, marks: decodeBookMarks(value.verses) }];
  })), [bible, bookId, documents]);
  const others = useMemo(() => JSON.parse(othersKey) as OtherBookMarks[], [othersKey]);

  const latest = useRef({ form, owner, bible, bookId, t });
  latest.current = { form, owner, bible, bookId, t };
  const save = useCallback((change: MarksChange, lost?: () => void) => {
    const { form: current, owner: person, bible: bibleId, bookId: book, t: say } = latest.current;
    if (!person || !id) {
      lost?.();
      return;
    }
    const now = new Date().toISOString();
    current.commit((value): DocumentData => (value
      ? { ...value, verses: encodeBookMarks(change(decodeBookMarks(value.verses))), updatedAt: now }
      : { userId: person, bible: bibleId, book, verses: encodeBookMarks(change({})), createdAt: now, updatedAt: now }))
      .catch((error: unknown) => {
        if (formLeft(error)) return;
        lost?.();
        recordDiagnostic('mark', { result: 'refused', code: diagnosticErrorCode(error) });
        toast.error(refusalMessage(error, say, 'bible.marks.notKept'));
      });
  }, [id]);

  const open = listRead && form.state !== null;
  return {
    marks: formMarks,
    save,
    ready: open || (listRead && form.readOnly),
    writable: open && !form.readOnly && STROKE_READY.has(form.status?.phase ?? ''),
    others,
    sync: resource ? form : null,
  };
}
