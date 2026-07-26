'use client';

import { doc, onSnapshot, type DocumentData } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getClientDb } from '@/config/firebaseClientDb';

/**
 * Is the document open in this editor still the newest one?
 *
 * WHY A SEPARATE HOOK. The app already tells you when a NEW VERSION OF THE APP
 * ships. It never tells you that THE DOCUMENT YOU ARE LOOKING AT changed on
 * another device — which is the loss the owner actually hit: edit on the phone,
 * open the laptop showing yesterday's copy, save, edit gone.
 *
 * WHAT THIS DOES AND DOES NOT DO.
 * - It only OBSERVES. It never writes, never touches React Query, and never
 *   replaces what the editor is showing. Silently swapping text under someone who
 *   is typing is a worse bug than the one being fixed.
 * - Freshness has THREE states, not two. `unknown` is a real answer: offline,
 *   permission error, or before the first server snapshot arrives. Showing "fresh"
 *   then would be a lie.
 *
 * OWN WRITES MUST NOT RAISE THE FLAG. Firestore delivers a snapshot for this
 * client's own writes too, first with `hasPendingWrites` and again once the
 * server acknowledges. Both are ignored: pending ones by the metadata flag, and
 * acknowledged ones because the caller reports what it saved via `markSynced`.
 */
export type FreshnessState = 'fresh' | 'stale' | 'unknown';

export interface UseDocumentFreshnessOptions<T> {
  /** Firestore collection holding the document. */
  collection: string;
  /** Document id. Null/undefined disables the hook. */
  docId: string | null | undefined;
  /** Owner; null/undefined disables the hook (no listener without a signed-in user). */
  uid: string | null | undefined;
  /** Pulls the fields this editor cares about out of a raw snapshot. */
  select: (data: DocumentData) => T;
  /** What this editor last knew to be on the server; null while still loading. */
  known: T | null;
  /** False keeps the listener detached (editor not ready, feature off). */
  enabled: boolean;
}

export interface UseDocumentFreshnessResult<T> {
  state: FreshnessState;
  /** The newer server value, when `state === 'stale'`. Never applied for you. */
  remote: T | null;
  /** The document disappeared on another device. */
  remotelyDeleted: boolean;
  /** Caller confirmed it now holds this value — stop reporting it as newer. */
  markSynced: (value: T) => void;
}

export function useDocumentFreshness<T>({
  collection,
  docId,
  uid,
  select,
  known,
  enabled,
}: UseDocumentFreshnessOptions<T>): UseDocumentFreshnessResult<T> {
  const [state, setState] = useState<FreshnessState>('unknown');
  const [remote, setRemote] = useState<T | null>(null);
  const [remotelyDeleted, setRemotelyDeleted] = useState(false);

  // Serialised value the editor already accounts for. Kept in a ref so a new
  // keystroke never re-subscribes the listener.
  const knownRef = useRef<string | null>(null);
  knownRef.current = known === null || known === undefined ? null : JSON.stringify(known);

  const selectRef = useRef(select);
  selectRef.current = select;

  useEffect(() => {
    if (!enabled || !docId || !uid) {
      setState('unknown');
      setRemote(null);
      setRemotelyDeleted(false);
      return;
    }

    let active = true;
    const ref = doc(getClientDb(), collection, docId);

    const unsubscribe = onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!active) return;

        // Our own write on the way out — not news from anywhere.
        if (snapshot.metadata.hasPendingWrites) return;
        // A cached emission proves nothing about the server yet.
        if (snapshot.metadata.fromCache) {
          // A cached emission proves nothing about the server RIGHT NOW, even if a
          // server snapshot arrived earlier: the connection may since have dropped.
          // Keeping a stale "fresh" here is the lie this state exists to prevent.
          setState('unknown');
          return;
        }

        if (!snapshot.exists()) {
          setRemotelyDeleted(true);
          setState('stale');
          setRemote(null);
          return;
        }

        setRemotelyDeleted(false);
        const value = selectRef.current(snapshot.data());
        const serialised = JSON.stringify(value);

        if (knownRef.current === null || serialised === knownRef.current) {
          setState('fresh');
          setRemote(null);
          return;
        }

        setState('stale');
        setRemote(value);
      },
      () => {
        if (!active) return;
        // A listener error is terminal — Firestore sends nothing more. Saying
        // "fresh" here would claim knowledge we no longer have.
        setState('unknown');
        setRemote(null);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [collection, docId, uid, enabled]);

  const markSynced = useCallback((value: T) => {
    const serialised = JSON.stringify(value);
    setRemote((current) =>
      current !== null && JSON.stringify(current) === serialised ? null : current
    );
    setState((current) => (current === 'stale' ? 'fresh' : current));
  }, []);

  return { state, remote, remotelyDeleted, markSynced };
}
