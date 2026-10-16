import { diagnosticErrorCode, recordDiagnostic } from '@/utils/appDiagnostics';

import type { BookMarks } from '@/utils/bibleMarks';

/*
 * ONE WRITER PER BOOK — the strokes of a book reach the data engine one batch at a time (found on the
 * owner's iPad, 2026-10-16: words tapped quickly each became a change of the book's document, built on
 * the same copy before the one ahead was kept, and the engine answered "conflict" to the person's own
 * strokes — the banner showed the verses as code and the marks were gone). While a batch is on its way,
 * new strokes wait and go together in the next one, laid over the copy that already holds the first.
 *
 * Until the stored marks show a stroke, the page lays it over them itself (`overlay`): a stroke is a
 * paint or an erase of given words, so laying it again over marks that already hold it changes nothing,
 * and a list that comes back a step behind no longer makes a fresh mark blink away and back. A batch
 * refused only because the device's storage is not answering for a moment (an iPad does it for seconds
 * after a wake) waits and goes again; any other refusal takes the strokes off the page and says why.
 */
export type MarksChange = (marks: BookMarks) => BookMarks;
type Entry = { change: MarksChange; state: 'waiting' | 'sending' | 'kept'; keptAt: number };
type Send = (change: MarksChange) => Promise<void>;

const RETRY_MS = 1_500;
const RETRIES = 20;
/** A kept stroke the stored marks never came to show is let go: the engine's copy is the truth. */
const KEPT_GRACE_MS = 20_000;

/** The same marks whatever order their verses were written in. */
const canonical = (marks: BookMarks) => JSON.stringify(Object.keys(marks).sort().map((verse) => [verse, marks[verse].m ?? [], marks[verse].p ?? []]));
const sameMarks = (a: BookMarks, b: BookMarks) => canonical(a) === canonical(b);
const waitsForStorage = (error: unknown) => ['read-only', 'storage-silent'].includes(String((error as { code?: unknown } | null)?.code ?? ''));

export class MarkWriter {
  private entries: Entry[] = [];
  private running = false;
  private send: Send | null = null;
  private refused: ((error: unknown) => void) | null = null;
  private listeners = new Set<() => void>();
  private recheck = false;
  version = 0;

  constructor(private readonly now: () => number = Date.now, private readonly later: (run: () => void, ms: number) => void = (run, ms) => { setTimeout(run, ms); }) {}

  /** How the writer reaches the engine, and what it does with a refusal: the newest of the page's. */
  connect(send: Send, refused: (error: unknown) => void): void {
    this.send = send;
    this.refused = refused;
    this.pump();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getVersion = () => this.version;

  push(change: MarksChange): void {
    this.entries.push({ change, state: 'waiting', keptAt: 0 });
    this.changed();
    this.pump();
  }

  /** The marks to show: the stored ones with every stroke not yet seen in them, in order. */
  overlay(stored: BookMarks): BookMarks {
    return this.entries.reduce((marks, entry) => entry.change(marks), stored);
  }

  /** The stored marks moved: kept strokes they now hold, or that waited too long to show, are let go. */
  settle(stored: BookMarks): void {
    const kept = this.entries.filter((entry) => entry.state === 'kept');
    if (!kept.length) return;
    const shown = kept.reduce((marks, entry) => entry.change(marks), stored);
    const late = kept.every((entry) => this.now() - entry.keptAt > KEPT_GRACE_MS);
    if (!sameMarks(shown, stored) && !late) {
      // Nothing else may move when the grace ends (another device changed these words meanwhile):
      // look again then, so a kept stroke never covers newer stored marks for good.
      if (!this.recheck) {
        this.recheck = true;
        const newest = Math.max(...kept.map((entry) => entry.keptAt));
        this.later(() => { this.recheck = false; this.changed(); }, Math.max(0, newest + KEPT_GRACE_MS - this.now()) + 1);
      }
      return;
    }
    this.entries = this.entries.filter((entry) => entry.state !== 'kept');
    this.changed();
  }

  private changed() {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  private pump() {
    const send = this.send;
    if (this.running || !send) return;
    const batch = this.entries.filter((entry) => entry.state === 'waiting');
    if (!batch.length) return;
    this.running = true;
    batch.forEach((entry) => { entry.state = 'sending'; });
    const change: MarksChange = (marks) => batch.reduce((current, entry) => entry.change(current), marks);
    const attempt = (tries: number) => {
      // Whatever the send does — even throw at once — the writer is free again afterwards.
      let request: Promise<void>;
      try {
        request = (this.send ?? send)(change);
      } catch (error) {
        request = Promise.reject(error);
      }
      request.then(() => {
        const at = this.now();
        batch.forEach((entry) => { entry.state = 'kept'; entry.keptAt = at; });
        this.done();
      }, (error: unknown) => {
        if (waitsForStorage(error) && tries < RETRIES) {
          if (tries === 0) recordDiagnostic('mark', { result: 'waiting', code: diagnosticErrorCode(error) });
          this.later(() => attempt(tries + 1), RETRY_MS);
          return;
        }
        recordDiagnostic('mark', { result: 'refused', code: diagnosticErrorCode(error) });
        this.entries = this.entries.filter((entry) => !batch.includes(entry));
        try {
          this.refused?.(error);
        } finally {
          this.done();
        }
      });
    };
    attempt(0);
  }

  private done() {
    this.running = false;
    this.changed();
    this.pump();
  }
}

const writers = new Map<string, MarkWriter>();

/** The writer of one book's document; it outlives the page, so a batch on its way is never dropped. */
export function markWriterFor(documentId: string): MarkWriter {
  let writer = writers.get(documentId);
  if (!writer) {
    writer = new MarkWriter();
    writers.set(documentId, writer);
  }
  return writer;
}

/** Each test starts with no writer. */
export function forgetMarkWriters(): void {
  writers.clear();
}
