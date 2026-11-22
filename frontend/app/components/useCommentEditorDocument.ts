'use client';

import { useState } from 'react';
import { v5 as uuidV5 } from 'uuid';

import { COMMENT_EDITOR_SLOT, newCommentEditorSlot } from '@/data-engine/commentEditorScope';
import { isWorkspaceRecoveryCopy, useDataDocument, useDataEngine } from '@/data-engine/react.client';
import { newClientId } from '@/utils/clientId';
import { commentDraftDocument } from '@/utils/commentDrafts';
import { serializeContent } from '@/utils/contentFingerprint';

import type { RecoveryCheckpoint } from '@/data-engine/controller';
import type { DocumentData } from '@/data-engine/types';
import type { CommentDraftTarget } from '@/utils/commentDrafts';
import type { DurableDraft } from '@/utils/durableDraft';

export function useCommentEditorDocument(target: CommentDraftTarget, choosesPlace: boolean) {
  const { browser, owner } = useDataEngine();
  const creating = target.kind === 'new';
  const [slot] = useState(() => creating ? newCommentEditorSlot(target.reference, choosesPlace) : COMMENT_EDITOR_SLOT);
  const [legacyAddress] = useState(() => commentDraftDocument(target, choosesPlace));
  const [address, setAddress] = useState<{ owner: string | null; id: string; source?: string }>(() => ({ owner, id: newClientId() }));
  if (address.owner !== owner) setAddress({ owner, id: newClientId() });
  const id = target.kind === 'edit' ? target.id : address.id;
  const document = useDataDocument(address.owner === owner ? { collection: 'studyNotes', id } : null, {
    slot, create: creating, autoSave: false, readOnlyCopy: !creating, recoverySourceId: creating ? address.source : undefined,
  });
  const listCopies = async () => {
    const copies = creating && browser ? await browser.engine.listNewCommentCopies(slot) : await document.listRecoverable();
    return copies.filter(({ record, answer }) => isWorkspaceRecoveryCopy(record, [slot]) || (creating && Boolean(answer)));
  };
  const restoreCopy = async (source: RecoveryCheckpoint) => {
    if (source.record.owner !== owner) throw new Error('The selected comment draft changed');
    if (!creating) return document.recover(source.id);
    setAddress({ owner, id: source.record.checkpoint.confirmed.resource.id, source: source.id });
  };
  const discardCopy = (source: RecoveryCheckpoint) =>
    creating && browser ? browser.engine.discardRecovery(source) : document.discardRecovery(source);

  const parkLegacyCreation = async (key: string, original: DurableDraft<unknown>, value: DocumentData) => {
    if (!creating || !browser || !owner) throw new Error('The new comment editor changed');
    const reserved = uuidV5(serializeContent(['study-comment-legacy', owner, key, original]), uuidV5.URL);
    return browser.engine.parkLegacyCommentCreation({ collection: 'studyNotes', id: reserved }, slot, value);
  };

  return { id, document, legacyAddress, sourceId: address.source, listCopies, restoreCopy, discardCopy, parkLegacyCreation };
}
