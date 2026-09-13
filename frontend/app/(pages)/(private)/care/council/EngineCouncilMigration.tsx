'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { clearLocalCouncils, readLocalCouncils } from '@/services/councils.local';

import { EngineCouncilCreator } from './EngineCouncilCreator';

import type { Council } from '@/models/models';

interface EngineCouncilMigrationProps {
  owner: string;
  /** Ids the server itself returned; null until it has answered at all. */
  serverIds: Set<string> | null;
}

/**
 * COUNCILS FROM BEFORE THE DATABASE, carried through the engine.
 *
 * The legacy hook does this on its own road, which would plant unmarked documents inside a domain
 * the engine already owns — the mixed state that makes a list show what the database no longer
 * has. So while councils are migrated, the carry-over happens here instead, one council at a time
 * through the ordinary create path, and each arrives carrying the protocol marker.
 *
 * The browser copy is the only copy these councils have. It is cleared only after every one of
 * them has landed; a refusal leaves everything in place for the next opening.
 */
export function EngineCouncilMigration({ owner, serverIds }: EngineCouncilMigrationProps) {
  const pending = useMemo(() => {
    if (!serverIds) return null;
    const local = readLocalCouncils(owner);
    return local.filter(council => !serverIds.has(council.id)).map(council => ({ ...council, userId: owner }));
  }, [owner, serverIds]);

  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  const cleared = useRef(false);

  useEffect(() => {
    if (stopped || !pending || cleared.current || index < pending.length) return;
    cleared.current = true;
    // Nothing pending at all is not a carry-over: an empty browser copy has nothing to clear.
    if (pending.length) clearLocalCouncils(owner);
  }, [owner, pending, index, stopped]);

  if (stopped || !pending || index >= pending.length) return null;
  const council = pending[index] as Council;
  return <EngineCouncilCreator
    council={council}
    onCreated={() => setIndex(value => value + 1)}
    onFailed={() => setStopped(true)}
  />;
}
