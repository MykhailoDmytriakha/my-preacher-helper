'use client';

import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '@/services/firebaseAuth.service';
import { newClientId } from '@/utils/clientId';

import { createIndexedDbCheckpoints } from './checkpoint.client';
import { createIndexedDbCollectionCursors } from './collectionCursors.client';
import { CollectionReader } from './collections';
import { createIndexedDbCommitStore } from './commits.client';
import { editorIdentity } from './editorIdentity';
import { DataEngine } from './engine';
import { createIndexedDbJournal } from './journal.client';
import { createIndexedDbManualScopes } from './manualScopes.client';
import { createIndexedDbMembershipScopes } from './membershipScopes.client';
import { ResourceObserver } from './observer';
import { DataEngineRuntime } from './runtime';
import { createIndexedDbSnapshots } from './snapshots.client';
import { createFirestoreObservationSource } from './source.client';
import { createHttpEngineTransport } from './transport.client';

import type { ResourceRef } from './types';

/** A visible tab nobody has touched this long stops asking the server about quiet documents. */
const ATTENTION_MS = 10 * 60_000;
const ATTENTION_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

export interface BrowserDataEngine {
  engine: DataEngine;
  dispose(): void;
  /** Allocate once per editor opening; recovery of a previous lifetime is explicit. */
  editorId(resource: ResourceRef, slot?: string): string;
}

/** Create once per mounted provider and dispose on unmount. No module-level browser state. */
export function createBrowserDataEngine({ onError }: { onError?: (error: unknown) => void } = {}): BrowserDataEngine {
  if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('DataEngine requires a browser');
  const report = onError ?? ((error: unknown) => { console.error('DataEngine background operation failed', error); });
  const tabId = newClientId();
  const transport = createHttpEngineTransport();
  const runtime = new DataEngineRuntime({ journal: createIndexedDbJournal(), transport });
  const observer = new ResourceObserver({ source: createFirestoreObservationSource(), transport });
  const snapshots = createIndexedDbSnapshots();
  const collections = new CollectionReader({ transport, observer, snapshots, cursors: createIndexedDbCollectionCursors(), onError: report });
  const engine = new DataEngine({
    runtime, observer, transport, checkpoints: createIndexedDbCheckpoints(), collections,
    snapshots, operationId: newClientId, onError: report,
    commits: createIndexedDbCommitStore(), manualScopes: createIndexedDbManualScopes(), membershipScopes: createIndexedDbMembershipScopes(),
  });
  let active = true;
  let owner: string | null = null;
  let generation = 0;
  let retrying = false;
  let stopAuth: (() => void) | undefined;
  const online = () => navigator.onLine;
  const visible = () => document.visibilityState === 'visible';
  const connectivityChanged = () => { if (active) engine.setOnline(online()); };
  // Someone at the screen. A hidden tab already reads nothing. On a computer a screen can stay lit
  // all night and Chrome may call a covered window visible, so a visible tab nobody has touched for
  // ATTENTION_MS pauses its server checks, and the first touch or return asks again at once
  // (ResourceObserver.setAttended). A touch device never pauses: its screen goes dark by itself and
  // its battery ends any session, while a lit iPad untouched for long is a preacher reading — the
  // very case the checks are for, since there a listener can die without a word.
  const pausesWhenUntouched = (navigator.maxTouchPoints ?? 0) <= 1;
  let lastAttention = Date.now();
  let attended = true;
  const attentionSeen = () => {
    lastAttention = Date.now();
    if (active && !attended) { attended = true; collections.setAttended(true); }
  };
  const visibilityChanged = () => {
    if (!active) return;
    // Attention first, so the return to the tab is checked at once rather than after a backoff.
    if (visible()) attentionSeen();
    engine.setVisible(visible());
  };
  // Apply browser restrictions before auth can synchronously activate delivery.
  connectivityChanged();
  visibilityChanged();
  window.addEventListener('online', connectivityChanged);
  window.addEventListener('offline', connectivityChanged);
  document.addEventListener('visibilitychange', visibilityChanged);
  if (pausesWhenUntouched) for (const type of ATTENTION_EVENTS) window.addEventListener(type, attentionSeen, { capture: true, passive: true });
  const timer = window.setInterval(() => {
    if (active && pausesWhenUntouched && attended && Date.now() - lastAttention >= ATTENTION_MS) { attended = false; collections.setAttended(false); }
    if (!active || !owner || !online() || !visible() || retrying) return;
    retrying = true;
    const started = generation;
    void engine.retry().catch(error => {
      if (active && generation === started) report(error);
    }).finally(() => { retrying = false; });
  }, 60_000);
  const dispose = () => {
    if (!active) return;
    active = false;
    generation += 1;
    window.clearInterval(timer);
    window.removeEventListener('online', connectivityChanged);
    window.removeEventListener('offline', connectivityChanged);
    document.removeEventListener('visibilitychange', visibilityChanged);
    for (const type of ATTENTION_EVENTS) window.removeEventListener(type, attentionSeen, { capture: true });
    stopAuth?.();
    engine.dispose();
  };
  try {
    stopAuth = onAuthStateChanged(auth, user => {
      if (!active) return;
      const nextOwner = user?.uid ?? null;
      if (owner !== nextOwner) generation += 1;
      owner = nextOwner;
      // Engine owner/visibility/online setters already drain on eligible transitions.
      engine.setOwner(owner);
    }, error => { if (active) report(error); });
  } catch (error) {
    dispose();
    throw error;
  }
  // A clean checkpoint is compacted after ACK. Reusing its editor ID would restart
  // editGeneration at zero behind the durable dedupe watermark. Every page opening
  // therefore gets a new identity; DataDocumentProvider shares it within that page.
  return { engine, dispose, editorId: (resource, slot = 'default') => editorIdentity(tabId, resource, slot, newClientId()) };
}
