/** Exact stored versions captured by a recovery fork, not author-action chronology. */
export interface RecoveryOrigin { id: string; version: string; }
export interface VersionedRecovery {
  recoveryVersion?: string;
  recoveryOrigins?: RecoveryOrigin[];
}

export function validateRecoveryOrigins(value: unknown): asserts value is RecoveryOrigin[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some(source => !source || typeof source.id !== 'string' || !source.id
    || typeof source.version !== 'string' || !source.version)) throw new Error('Invalid recovery source versions');
}

/** Conflicting version evidence cannot choose a source on the person's behalf. */
export function recoveryOrigins(previous: readonly RecoveryOrigin[] = [], added?: RecoveryOrigin): RecoveryOrigin[] {
  const versions = new Map<string, Set<string>>();
  for (const source of [...previous, ...(added ? [added] : [])]) {
    const known = versions.get(source.id) ?? new Set<string>();
    known.add(source.version); versions.set(source.id, known);
  }
  return [...versions].flatMap(([id, known]) => known.size === 1 ? [{ id, version: [...known][0] }] : []);
}
