export type VersionedCopy = {
  rev?: Record<string, number>;
  updatedAt?: string;
};

/**
 * Answers the only question that can safely replace a locally stored document:
 * has the server proved that its copy is newer?
 *
 * A local cache entry can be either an old snapshot or an edit that has not been
 * accepted yet. Revision counters distinguish those cases when both copies carry
 * them. Older documents do not, so their accepted write timestamps are the
 * fallback. If neither signal answers the question, keeping the local copy is the
 * only choice that cannot discard unsaved work.
 */
export function serverCopyIsNewer<T extends VersionedCopy>(server: T, stored: T): boolean {
  const there = server.rev;
  const here = stored.rev;

  /**
   * A COPY WITH NO EVIDENCE CANNOT OUTVOTE ONE THAT HAS SOME — BUG-20260815-list-copy-hides-scratch.
   *
   * "Neither signal answers, so keep the local copy" is the right instinct when
   * BOTH sides are silent. When only the LOCAL side is silent it inverts into a
   * trap: sermons created by the API route carry neither `rev` nor `updatedAt`,
   * so a snapshot of one can never be beaten. Every later write raises the
   * server's revision, the local copy still has nothing to compare, and the
   * answer stays "not proven newer" forever. Measured live: server held four
   * scratch notes with `rev.scratch = 4`, the local snapshot held one with no
   * fields at all, and the screen showed the one — permanently.
   *
   * Unsaved local work is still safe: an optimistic copy is built from the
   * document it edits, so it inherits whatever markers that document had. Having
   * NOTHING means it descends from a document that never had them — an old
   * snapshot, not fresh work.
   */
  const serverHasEvidence = Boolean(there) || !Number.isNaN(Date.parse(server.updatedAt ?? ''));
  const storedHasEvidence = Boolean(here) || !Number.isNaN(Date.parse(stored.updatedAt ?? ''));
  if (serverHasEvidence && !storedHasEvidence) return true;

  if (there && here) {
    let serverAhead = false;
    for (const aggregate of new Set([...Object.keys(there), ...Object.keys(here)])) {
      const serverCount = there[aggregate] ?? 0;
      const storedCount = here[aggregate] ?? 0;
      // A higher local counter proves that this device holds work the server has
      // not accepted, so another aggregate cannot make replacement safe.
      if (storedCount > serverCount) return false;
      if (serverCount > storedCount) serverAhead = true;
    }
    return serverAhead;
  }

  const acceptedThere = Date.parse(server.updatedAt ?? '');
  const acceptedHere = Date.parse(stored.updatedAt ?? '');
  if (Number.isNaN(acceptedThere) || Number.isNaN(acceptedHere)) return false;
  return acceptedThere > acceptedHere;
}

/**
 * Chooses a server document only when it exists and proves that it is newer.
 * A document absent on one side is not evidence that the copy on the other side
 * should disappear: it may be a server-only document missing from an old list, or
 * a local creation that has not reached the server yet.
 */
export function selectReadableCopy<T extends VersionedCopy>(
  server: T | null | undefined,
  stored: T | null | undefined
): T | undefined {
  if (!stored) return server ?? undefined;
  if (!server) return stored;
  return serverCopyIsNewer(server, stored) ? server : stored;
}

/**
 * Reconciles a server list document by document instead of treating list presence
 * as a freshness signal. Server-only documents are added, local-only documents are
 * retained, and documents present on both sides use the same proof as detail reads.
 */
export function reconcileServerList<T extends VersionedCopy & { id: string }>(
  server: readonly T[],
  stored: readonly T[]
): T[] {
  const storedById = new Map(stored.map((item) => [item.id, item]));
  const reconciled = server.map(
    (serverItem) => selectReadableCopy(serverItem, storedById.get(serverItem.id)) as T
  );
  const serverIds = new Set(server.map((item) => item.id));
  stored.forEach((storedItem) => {
    if (!serverIds.has(storedItem.id)) reconciled.push(storedItem);
  });
  return reconciled;
}
