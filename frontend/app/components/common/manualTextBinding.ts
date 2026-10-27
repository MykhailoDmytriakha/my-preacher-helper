import type { RecoveryChoice, DataSyncStatusProps, TextComparison } from '@/data-engine/DataSyncStatus';
import type { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';

/** Presentation-only binding. The data engine owns the form baseline and persistence. */
export interface ManualValueBinding<T> {
  active: boolean;
  value: T;
  busy: boolean;
  begin(): Promise<void>;
  update(value: T): Promise<void>;
  save(value: T): Promise<void>;
  cancel(): Promise<void>;
}

export type ManualTextBinding = ManualValueBinding<string>;

/** An always-visible preparation control opens its canonical form before accepting input. */
export interface PreparationFieldBinding<T> extends ManualValueBinding<T> {
  subject: string;
  ready: boolean;
  dirty: boolean;
  canSave?: boolean;
  canBegin?: boolean;
  error: string | null;
  decision?: ManualFieldDecision;
  comparison?: TextComparison;
  recovery: ReturnType<typeof useRecoveryDiscovery<RecoveryChoice>>;
  retry(): Promise<void>;
}

export type PreparationTextBinding = PreparationFieldBinding<string>;

/** One field-specific question can own the page's existing synchronization surface. */
export interface ManualFieldDecision {
  comparison?: TextComparison;
  subject: unknown;
  status: DataSyncStatusProps['status'];
  error: string | null;
  keepLocal(): Promise<void>;
  acceptRemote(): Promise<void>;
  retry(): Promise<void>;
}
export function manualFormDecision(form: ReturnType<typeof useDataForm>, comparison?: TextComparison): ManualFieldDecision | undefined {
  if (!form.choiceRequired && !comparison) return undefined;
  const discard = Boolean(comparison && form.canDiscardStage);
  return { comparison, subject: form.recoveryIdentity, status: discard && form.status ? { ...form.status, canAcceptRemote: true } : form.status, error: form.localError ?? null,
    keepLocal: form.keepLocal, acceptRemote: discard ? form.discardStageAndAcceptRemote : form.acceptRemote, retry: form.retry };
}
