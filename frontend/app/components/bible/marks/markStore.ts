import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { needsConnectionFailure, useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { refusalMessage } from '@/utils/actionFailureMessage';
import { decodeBookMarks, encodeBookMarks, type BookMarks, type OtherBookMarks } from '@/utils/bibleMarks';
import { isBibleId } from '@/utils/bibles';
import { bookSlug } from '@/utils/bibleText';

import type { BibleId } from '@/utils/bibles';

/*
 * THE MARKS ON EVERY DEVICE OF THE PERSON — kept through the app's data engine (`data-engine/README.md`):
 * one document per person, Bible and book in `bibleMarks`, under one fixed id, so two devices never make
 * two documents of one book. Its verses are a map: marks in different verses from two devices merge by
 * themselves; the same verse changed on two devices at once is a decision the engine asks the person
 * for. A stroke reaches the engine as a change of the document's newest copy, never as a value computed
 * from an older one. Offline, the engine keeps the stroke on the device and sends it later.
 *
 * Whether a stroke is the book's first is the engine's to know: `commit` reads the document itself (this
 * device's copy, else the server) and the stroke becomes a creation only where the document is absent
 * there. The list on the screen may not be read yet; a "create" decided from it would be refused once
 * another device has made the book's document, and the stroke lost. Only offline, in a book this device
 * has no copy of, the engine cannot ask: the read list says the book has no marks, so the stroke makes
 * the document. Should another device have made it meanwhile, the engine keeps both and asks the person.
 */
export const BIBLE_MARKS = 'bibleMarks';

export const marksDocumentId = (owner: string, bible: BibleId, bookId: string) => `${owner}_${bible}_${bookSlug(bookId)}`;

type StoredDocument = { verses?: unknown } & Record<string, unknown>;

export type BookMarksStore = {
  marks: BookMarks;
  /** A stroke: how it changes the book's marks; laid over the newest copy of the document. */
  save: (change: (marks: BookMarks) => BookMarks) => void;
  /** The engine is there and the person's marks are on the screen: strokes can be kept and judged. */
  ready: boolean;
  /** This book's marks in the person's other Bibles, from the same list: a sign at their verses here. */
  others: OtherBookMarks[];
};

export function useBookMarks(owner: string | null, bible: BibleId, bookId: string): BookMarksStore {
  const { t } = useTranslation();
  const collection = useDataCollection(owner ? BIBLE_MARKS : null);
  const actions = useDocumentActions();
  const id = owner ? marksDocumentId(owner, bible, bookId) : null;
  const row = collection.state?.documents?.find((document) => document.resource.id === id) ?? null;
  const stored = (row?.value ?? null) as StoredDocument | null;
  const marks = useMemo(() => decodeBookMarks(stored?.verses), [stored]);
  const documents = collection.state?.documents;
  // Keyed by value, not by the list's array: the list comes anew with every stroke here, and what reads
  // these (the ribbon's signs) is redrawn only when the other Bibles' marks change.
  const othersKey = useMemo(() => JSON.stringify((documents ?? []).flatMap((document) => {
    const value = document.value as StoredDocument | null;
    if (!value || value.book !== bookId || value.bible === bible || !isBibleId(value.bible)) return [];
    return [{ bible: value.bible, marks: decodeBookMarks(value.verses) }];
  })), [bible, bookId, documents]);
  const others = useMemo(() => JSON.parse(othersKey) as OtherBookMarks[], [othersKey]);
  // A kept stroke shows at once and stays until the engine's own copy of the document moves on.
  const [held, setHeld] = useState<{ marks: BookMarks; over: StoredDocument | null } | null>(null);
  const shown = held && held.over === stored ? held.marks : marks;

  const save = useCallback((change: (marks: BookMarks) => BookMarks) => {
    if (!owner || !id) return;
    const now = new Date().toISOString();
    const resource = { collection: BIBLE_MARKS, id };
    const fresh = () => ({ userId: owner, bible, book: bookId, verses: encodeBookMarks(change({})), createdAt: now, updatedAt: now });
    setHeld({ marks: change(shown), over: stored });
    actions.commit(resource, (current) => (current
      ? { ...current, verses: encodeBookMarks(change(decodeBookMarks(current.verses))), updatedAt: now }
      : fresh()))
      .catch((error: unknown) => {
        if (needsConnectionFailure(error) && !stored) return actions.create(resource, fresh());
        throw error;
      })
      // A refused stroke: the page returns to the stored marks and says why.
      .catch((error: unknown) => {
        setHeld(null);
        toast.error(refusalMessage(error, t, 'bible.marks.notKept'));
      });
  }, [actions, bible, bookId, id, owner, shown, stored, t]);

  // Until the list is read, a stroke could not tell paint from erase on marks it cannot see.
  return { marks: shown, save, ready: actions.ready && collection.state !== null && !collection.loading, others };
}
