/** Local presence is presentation evidence, never permission to remove a saved copy. */
export type RecoveryPresenceKind = 'checkpoint' | 'manual' | 'membership';

export interface RecoveryPresencePort {
  hold(owner: string, kind: RecoveryPresenceKind, id: string): () => void;
  /** Unknown capability or a failed query must preserve the recovery offer. */
  held(owner: string, kind: RecoveryPresenceKind, id: string): Promise<boolean | null>;
}

/** Identity ancestry hides a recovered source while its continuation is open. */
export interface RecoverySource { id: string; }
export const recoveryPresenceKey = (owner: string, kind: RecoveryPresenceKind, id: string): string =>
  JSON.stringify(['data-engine-recovery', owner, kind, id]);
export const recoverySources = (sources: readonly RecoverySource[] = [], id?: string): RecoverySource[] =>
  [...new Set([...sources.map(source => source.id), ...(id ? [id] : [])])].map(id => ({ id }));

export interface RecoveryPresenceLease {
  add(ids: readonly string[]): void;
  release(): void;
  releaseAfter(work: Promise<unknown>): void;
}

/** One owner of local counts and optional browser evidence; no persistence or delivery authority. */
export class RecoveryPresence {
  private readonly counts = new Map<string, number>();
  constructor(private readonly port?: RecoveryPresencePort) {}

  hold(owner: string, kind: RecoveryPresenceKind, ids: readonly string[]): RecoveryPresenceLease {
    const releases = new Map<string, () => void>();
    let released = false;
    const add = (values: readonly string[]) => {
      if (released) return;
      for (const id of values) {
        if (releases.has(id)) continue;
        const key = recoveryPresenceKey(owner, kind, id);
        this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
        let stop: (() => void) | undefined;
        try { stop = this.port?.hold(owner, kind, id); } catch { /* Missing browser evidence never removes a copy. */ }
        releases.set(id, () => {
          const count = this.counts.get(key) ?? 0;
          if (count <= 1) this.counts.delete(key); else this.counts.set(key, count - 1);
          try { stop?.(); } catch { /* Releasing presentation evidence cannot fail document cleanup. */ }
        });
      }
    };
    const release = () => {
      if (released) return;
      released = true;
      for (const stop of releases.values()) stop();
      releases.clear();
    };
    add(ids);
    return { add, release, releaseAfter: work => { void work.then(release, release); } };
  }

  async held(owner: string, kind: RecoveryPresenceKind, id: string): Promise<boolean | null> {
    if (this.counts.has(recoveryPresenceKey(owner, kind, id))) return true;
    try { return await this.port?.held(owner, kind, id) ?? null; }
    catch { return null; }
  }
}
