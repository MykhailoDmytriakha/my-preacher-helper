import 'server-only';

import { acknowledgeAudioExport as acknowledge, beginAudioExportBatch as begin } from './audioExport.server';
import { createAudioExportStore, recordSharedNoteView as recordView } from './server';

import type { BeginAudioExportInput } from './audioExport.server';

export { AudioExportError, audioExportFingerprint } from './audioExport.server';

/** Public server operations expose outcomes, never persistence handles or injection seams. */
export function beginAudioExportBatch(input: BeginAudioExportInput) {
  return begin(input, { store: createAudioExportStore(input.userId, input.sermonId) });
}

export function acknowledgeAudioExport(userId: string, sermonId: string, exportId: string): Promise<void> {
  return acknowledge(userId, sermonId, exportId, { store: createAudioExportStore(userId, sermonId) });
}

/** Count only the still-live exact capability and publish its owner feed atomically. */
export function recordSharedNoteView(linkId: string, token: string): Promise<void> {
  return recordView(linkId, token);
}
