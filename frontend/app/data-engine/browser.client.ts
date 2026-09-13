'use client';

import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '@/services/firebaseAuth.service';
import { newClientId } from '@/utils/clientId';

import { createIndexedDbCheckpoints } from './checkpoint.client';
import { createIndexedDbCollectionCursors } from './collectionCursors.client';
import { CollectionReader } from './collections';
import { createIndexedDbCommitStore } from './commits.client';
import { DataEngine } from './engine';
import { createIndexedDbJournal } from './journal.client';
import { createIndexedDbManualScopes } from './manualScopes.client';
import { ResourceObserver } from './observer';
import { DataEngineRuntime } from './runtime';
import { createIndexedDbSnapshots } from './snapshots.client';
import { createFirestoreObservationSource } from './source.client';
import { createHttpEngineTransport } from './transport.client';

import type { ResourceRef } from './types';

export interface BrowserDataEngine {
  engine: DataEngine;
  dispose(): void;
  /** Stable for this factory lifetime only; recovery across reload is explicit. */
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
    commits: createIndexedDbCommitStore(), manualScopes: createIndexedDbManualScopes(),
  });
  let active = true;
  let owner: string | null = null;
  let generation = 0;
  let retrying = false;
  let stopAuth: (() => void) | undefined;
  const online = () => navigator.onLine;
  const visible = () => document.visibilityState === 'visible';
  const connectivityChanged = () => { if (active) engine.setOnline(online()); };
  const visibilityChanged = () => { if (active) engine.setVisible(visible()); };
  // Apply browser restrictions before auth can synchronously activate delivery.
  connectivityChanged();
  visibilityChanged();
  window.addEventListener('online', connectivityChanged);
  window.addEventListener('offline', connectivityChanged);
  document.addEventListener('visibilitychange', visibilityChanged);
  const timer = window.setInterval(() => {
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
  return { engine, dispose, editorId: (resource, slot = 'default') => JSON.stringify([tabId, resource.collection, resource.id, slot]) };
}
