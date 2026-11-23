import { liveNodeIds } from '@/utils/planTextStorage';

import { matchesPlanCellVersion, planCellOpening, readPlanCellText, settledPlanCellView } from './sermonPlanCellSession';

import type { PlanCellOpening } from './sermonPlanCellSession';
import type { SessionCheckpoint } from './session';
import type { Sermon } from '@/models/models';
import type { PlanDraftBinding } from '@/utils/planDraftCapture.client';

export interface PlanCellEmergencyAddress {
  owner: string;
  sermonId: string;
  nodeId: string;
  writerId: string;
}

export interface PlanCellEmergencyStorage {
  write(address: PlanCellEmergencyAddress, text: string, renew: boolean): PlanDraftBinding | undefined;
  clearRefusal(address: PlanCellEmergencyAddress, text: string): void;
  retire(binding: PlanDraftBinding, text: string): boolean;
}

interface PendingCell {
  opening: PlanCellOpening;
  text: string;
  writerId: string;
  action: number;
  pending: boolean;
  bound: boolean;
  renew: boolean;
  backup?: { binding: PlanDraftBinding; text: string };
  adopted?: Set<() => void>;
  isSourceStored?: () => boolean;
}

/** Synchronous last copies owned by one plan editor opening. */
export class PlanCellEmergency {
  private readonly cells = new Map<string, PendingCell>();
  private readonly waitingAlternatives = new Set<() => boolean>();
  private sequence = 0;
  private action = 0;

  constructor(private readonly owner: string, private readonly editorId: string, private readonly storage: PlanCellEmergencyStorage) {}

  admit(opening: PlanCellOpening, text: string, previous?: string, isSourceStored?: () => boolean) {
    const prior = this.cells.get(opening.nodeId);
    const sameOpening = prior && prior.text === previous
      && prior.opening.generation === opening.generation
      && (prior.opening.generation !== null || opening.generation !== null || prior.opening.legacyBirth === opening.legacyBirth);
    const action = ++this.action;
    const cell: PendingCell = sameOpening ? { ...prior, opening, text, action, pending: true, renew: prior.renew || prior.bound, isSourceStored }
      : { opening, text, action, writerId: JSON.stringify([this.editorId, ++this.sequence]), pending: true, bound: false, renew: false, isSourceStored };
    this.cells.set(opening.nodeId, cell);
    // A request already holds the old token. The next edit must fence its words
    // before an earlier transfer can retire the old copy.
    if (cell.renew) this.write(cell);
    if (!isSourceStored) return;
    const isCurrent = () => this.cells.get(opening.nodeId)?.action === action;
    return {
      isCurrent,
      restore: () => {
        if (!isCurrent()) return;
        if (prior) this.cells.set(opening.nodeId, prior);
        else this.cells.delete(opening.nodeId);
      },
    };
  }

  covers(nodeId: string, text: string): boolean {
    return this.cells.get(nodeId)?.text === text;
  }

  preserve(): void {
    for (const cell of this.cells.values()) if (cell.pending) this.write(cell);
    for (const preserve of this.waitingAlternatives) preserve();
  }

  /** An unchosen alternative has a separate address from the working cell. */
  hold(sermonId: string, nodeId: string, text: string) {
    const address = { owner: this.owner, sermonId, nodeId, writerId: JSON.stringify([this.editorId, ++this.sequence]) };
    const beforeChoice = this.action;
    let backup: PlanDraftBinding | undefined;
    let released = false;
    const preserve = (): boolean => {
      if (released) { release(); return false; }
      backup ??= this.storage.write(address, text, false);
      if (backup) this.waitingAlternatives.delete(preserve);
      return Boolean(backup);
    };
    const release = () => {
      released = true;
      this.storage.clearRefusal(address, text);
      if (!backup || this.storage.retire(backup, text)) {
        backup = undefined;
        this.waitingAlternatives.delete(preserve);
      } else {
        this.waitingAlternatives.add(preserve);
      }
    };
    this.waitingAlternatives.add(preserve);
    return {
      preserve, release,
      followAdmittedCell: () => {
        const cell = this.cells.get(nodeId);
        if (!cell || cell.text !== text || cell.action <= beforeChoice) return;
        if (cell.pending) (cell.adopted ??= new Set()).add(release);
        else release();
      },
    };
  }

  bind(cells: Readonly<Record<string, string>>): PlanDraftBinding[] {
    return Object.entries(cells).flatMap(([id, text]) => {
      const cell = this.cells.get(id);
      if (!cell || cell.text !== text) return [];
      if (cell.pending) this.write(cell);
      if (cell.renew || cell.backup?.text !== text) return [];
      cell.bound = true;
      return [cell.backup.binding];
    });
  }

  stored(checkpoint: SessionCheckpoint, allowConfirmed = true): void {
    const confirmed = allowConfirmed ? settledPlanCellView(checkpoint)?.draft : undefined;
    let live: Set<string> | undefined;
    for (const [id, cell] of this.cells) {
      if ((!cell.pending && !cell.backup) || !matchesPlanCellVersion(checkpoint.confirmed, cell.opening)) continue;
      if (checkpoint.planCellDrafts?.[id]?.text !== cell.text || !planCellOpening(checkpoint, id, cell.text)) {
        if (!confirmed) continue;
        live ??= liveNodeIds((confirmed as unknown as Sermon).outline);
        if (!live.has(id) || readPlanCellText(confirmed, id) !== cell.text) continue;
      }
      this.settle(cell);
    }
  }

  /** The exact words have a durable independent copy, or the newest edit already matches storage. */
  settleRetained(nodeId: string, text: string): void {
    const cell = this.cells.get(nodeId);
    if (cell?.text === text) this.settle(cell);
  }

  private settle(cell: PendingCell): void {
    cell.pending = false;
    cell.adopted?.forEach(release => release());
    cell.adopted = undefined;
    this.storage.clearRefusal(this.address(cell), cell.text);
    if (cell.backup && this.storage.retire(cell.backup.binding, cell.backup.text)) {
      cell.backup = undefined;
      cell.bound = false;
      cell.renew = false;
    }
  }

  private write(cell: PendingCell): void {
    if (cell.isSourceStored?.() || (!cell.renew && cell.backup?.text === cell.text)) return;
    const binding = this.storage.write(this.address(cell), cell.text, cell.renew);
    if (!binding) return;
    cell.backup = { binding, text: cell.text };
    cell.bound = false;
    cell.renew = false;
  }

  private address(cell: PendingCell): PlanCellEmergencyAddress {
    const { nodeId, sermonId } = cell.opening;
    return { owner: this.owner, sermonId, nodeId, writerId: cell.writerId };
  }
}
