'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { clearLocalCouncils, readLocalCouncils } from '@/services/councils.local';

import { EngineCouncilCreator } from './EngineCouncilCreator';

import type { Council } from '@/models/models';

interface EngineCouncilMigrationProps {
  owner: string;
  /** Ids the server itself returned; null until it has answered at all. */
  serverIds: Set<string> | null;
  /** A carry-over that stopped has to be said: these councils exist nowhere but this browser. */
  onRefused?: (message: string) => void;
}

/**
 * Only what a council is allowed to be. The browser copies were written by code that no longer
 * exists and are read back unvalidated; the legacy model carries `rev`, and the engine refuses a
 * NEW document with any field outside its schema — one stray key would stop the carry-over for
 * good, silently, with the only copy still in localStorage.
 */
function councilFields(council: Council, owner: string): Council {
  const { id, title, date, status, heldAt, topics, createdAt, updatedAt } = council;
  return {
    id, userId: owner, title, status, topics, createdAt, updatedAt,
    ...(date !== undefined ? { date } : {}), ...(heldAt !== undefined ? { heldAt } : {}),
  };
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
export function EngineCouncilMigration({ owner, serverIds, onRefused }: EngineCouncilMigrationProps) {
  const pending = useMemo(() => {
    if (!serverIds) return null;
    const local = readLocalCouncils(owner);
    return local.filter(council => !serverIds.has(council.id)).map(council => councilFields(council, owner));
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
    onFailed={message => { setStopped(true); onRefused?.(message); }}
  />;
}
