import type { ScratchNote } from '@/models/models';

/**
 * Three-way merge of the scratch notes by note id.
 *
 * WHY, AND WHY IT NEVER REFUSES. Scratch is stored as one whole array, so the
 * laptop's save replaces the entire list — a note captured on the phone in the
 * morning simply disappears when the laptop, open since last night, saves anything
 * at all. That is a silent loss of exactly the kind this work exists to stop.
 *
 * A compare-and-set would stop it too, but it would have to REFUSE, and a refusal
 * needs somewhere to hold the rejected text plus a decision from the person. Every
 * screen that got one of those today grew a new way to lose text (BUGS.md, rounds
 * six and seven). A merge needs neither: notes are separate items with ids, so two
 * people adding different notes are not in conflict at all, and the only genuine
 * overlap — the same note edited in both places — is settled by keeping the local
 * text, which is exactly what happened before this function existed. Never worse
 * than the whole-array write, and better in every disjoint case.
 *
 *   `base`   — the list this screen started the operation from,
 *   `mine`   — the list it wants to store,
 *   `stored` — what the document actually holds right now.
 */
export function mergeScratch(
  base: ScratchNote[] | null | undefined,
  mine: ScratchNote[],
  stored: ScratchNote[] | null | undefined
): ScratchNote[] {
  const storedList = stored ?? [];
  if (!base) {
    // Nothing to compare against: keep the caller's list, as before.
    return mine;
  }

  const baseById = new Map(base.map((note) => [note.id, note]));
  const mineById = new Map(mine.map((note) => [note.id, note]));
  const storedById = new Map(storedList.map((note) => [note.id, note]));
  const sameText = (a?: { text: string }, b?: { text: string }) =>
    Boolean(a) && Boolean(b) && a?.text === b?.text;

  /**
   * Deleted here — and honoured ONLY when the other device left the note alone.
   *
   * If they rewrote it while this screen was deleting it, dropping the note destroys
   * words someone typed, silently. An absence must never outrank a written change,
   * so a note edited there survives a deletion here.
   */
  const deletedHere = base
    .filter((note) => !mineById.has(note.id))
    .filter((note) => {
      const stored = storedById.get(note.id);
      if (!stored) return true; // gone on both sides
      return sameText(baseById.get(note.id), stored);
    })
    .map((note) => note.id);

  const result: ScratchNote[] = [];
  const taken = new Set<string>();

  // This screen's list, in ITS order — it owns the notes it is holding.
  mine.forEach((note) => {
    result.push(note);
    taken.add(note.id);
  });

  // Anything the document has that this screen never saw: added on the other device
  // since the operation began. Kept — and appended, because this screen has no
  // opinion about where it belongs.
  storedList.forEach((note) => {
    if (taken.has(note.id)) return;
    if (deletedHere.includes(note.id)) return; // removed here, untouched there

    result.push(note);
    taken.add(note.id);
  });

  return result;
}
