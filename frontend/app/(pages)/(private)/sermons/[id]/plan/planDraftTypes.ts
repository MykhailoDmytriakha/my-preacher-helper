import type { DurableDraft } from '@/utils/durableDraft';

/** Logical plan node and the exact backup that supplies its retained words. */
export interface PlanDraftCopy {
  id: string;
  text: string;
  key: string;
  /** Snapshot of the selected physical source, independent of its display fields. */
  sourceRecord: DurableDraft<string>;
}

/** A current unsaved cell has no physical key until its backup lands. */
export interface PlanOrphanCell {
  id: string;
  text: string;
  copyKey?: string;
}

export function planOrphanIdentity(cell: PlanOrphanCell): string {
  return cell.copyKey ?? JSON.stringify([cell.id, cell.text]);
}
