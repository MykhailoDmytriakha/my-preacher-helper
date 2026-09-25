'use client';

import { useEffect, useRef } from 'react';

import { useDataDocument } from '@/data-engine/react.client';

import type { DocumentData } from '@/data-engine/types';
import type { Council } from '@/models/models';

interface EngineCouncilCreatorProps {
  council: Council;
  onCreated: (id: string) => void;
  onFailed: (message: string) => void;
}

/**
 * ONE COUNCIL BEING BORN.
 *
 * A create needs its document id before the network, so the screen makes the id, mounts this,
 * and this owns the rest. It renders nothing: it is a lifecycle, not a view.
 *
 * `commit` rather than `update`, and autosave off, because a create is one whole intended value,
 * not a draft that grows: the request must survive unmount and reload exactly as submitted.
 * The id belongs to the resource, never to the stored fields — a document that carries its own
 * id inside can disagree with the address it lives at.
 */
export function EngineCouncilCreator({ council, onCreated, onFailed }: EngineCouncilCreatorProps) {
  const document = useDataDocument({ collection: 'councils', id: council.id }, { create: true, autoSave: false });
  const commit = document.commit;
  // One council, one submission. A re-render, a parent's new callback or a returning tab must
  // not send the same id twice; the engine would refuse the twin, but the person would see an error.
  const submitted = useRef<string | null>(null);
  const report = useRef({ onCreated, onFailed });
  report.current = { onCreated, onFailed };

  /**
   * WHOSE ANSWER STILL MATTERS: this council, in a mounted component. Readiness flips as the
   * create lands, so the effect re-runs while the request is in the air — and a cancellation tied
   * to that re-run swallows the answer. The screen then never learns the council exists: its form
   * stays half-open and the button dies. Found in a browser, with every test green.
   */
  const awaiting = useRef<string | null>(null);
  useEffect(() => () => { awaiting.current = null; }, []);

  useEffect(() => {
    // The editor opens asynchronously. Submitting before it exists is refused, and the council is
    // simply never created — the other half of the same lesson.
    if (document.loading || submitted.current === council.id) return;
    submitted.current = council.id;
    awaiting.current = council.id;
    const { id, ...fields } = council;
    void commit(() => fields as unknown as DocumentData)
      .then(() => { if (awaiting.current === id) { awaiting.current = null; report.current.onCreated(id); } })
      .catch((error: unknown) => {
        if (awaiting.current !== id) return;
        // The council does not exist, so the id is free again: the person may press once more.
        awaiting.current = null;
        submitted.current = null;
        report.current.onFailed(error instanceof Error ? error.message : 'council-create-failed');
      });
  }, [council, commit, document.loading]);

  return null;
}
