import { protectedSermonRecoveryKind, SERMON_NOTE_CHOICE_RECOVERY_PREFIX } from './editorIdentity';

export const CHECKPOINT_ROW = 'checkpoint';
const SERMON_NOTE_CHOICE_ROW = 'sermon-note-choice-checkpoint';
const protectedSermonRows = {
  'sermon-header': 'sermon-header-choice-checkpoint',
  'sermon-church': 'sermon-church-choice-checkpoint',
  'sermon-preparation-check': 'sermon-preparation-check-choice-checkpoint',
  'sermon-thought-placement': 'sermon-thought-placement-choice-checkpoint',
  'sermon-thought-removal': 'sermon-thought-removal-choice-checkpoint',
  'sermon-thought-lock': 'sermon-thought-lock-choice-checkpoint',
  'sermon-placed-sketch': 'sermon-placed-sketch-choice-checkpoint',
  'sermon-amended-sketch': 'sermon-amended-sketch-choice-checkpoint',
  'sermon-scratch-removal': 'sermon-scratch-removal-choice-checkpoint',
  'sermon-scratch-text': 'sermon-scratch-text-choice-checkpoint',
} as const;

export const PROTECTED_CHECKPOINT_ROW_KINDS = [SERMON_NOTE_CHOICE_ROW, ...Object.values(protectedSermonRows)];

function checkpointRowKind(editorId: string): string {
  const protection = protectedSermonRecoveryKind(editorId);
  if (protection) return protectedSermonRows[protection];
  return editorId.startsWith(SERMON_NOTE_CHOICE_RECOVERY_PREFIX) ? SERMON_NOTE_CHOICE_ROW : CHECKPOINT_ROW;
}

export const checkpointKey = (owner: string, editorId: string): IDBValidKey => [checkpointRowKind(editorId), owner, editorId];

/** Older collectors recognize this reference envelope even for checkpoints they cannot read. */
export function protectedCheckpointReference(owner: string, editorId: string): IDBValidKey | undefined {
  if (checkpointRowKind(editorId) === CHECKPOINT_ROW) return;
  return ['reference', owner, 'placed-sketch-checkpoint', editorId];
}
