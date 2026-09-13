import { commandFingerprint, validateCommand } from './protocol';

import type { CommandResult, DataCommand, EngineTransport, JournalEntry, JournalStore } from './types';

export type RuntimeEvent =
  | { kind: 'journal'; owner: string; entries: JournalEntry[] }
  | { kind: 'result'; owner: string; result: CommandResult };

interface RuntimeOptions {
  journal: JournalStore;
  transport: EngineTransport;
  now?: () => number;
}

/** One browser executor. The server enforces identity and dependencies across tabs. */
export class DataEngineRuntime {
  private owner: string | null = null;
  private generation = 0;
  private listeners = new Set<(event: RuntimeEvent) => void>();
  private drains = new Map<string, Promise<void>>();
  private drainRequested = new Set<string>();
  private submissions: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: RuntimeOptions) {}

  setOwner(owner: string | null): void {
    if (owner !== this.owner) {
      this.owner = owner;
      this.generation += 1;
    }
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async list(): Promise<JournalEntry[]> {
    const owner = this.owner;
    const generation = this.generation;
    if (!owner) return [];
    const entries = await this.options.journal.list(owner);
    return this.current(owner, generation) ? entries : [];
  }

  submit(command: DataCommand): Promise<{ kind: 'queued'; operationId: string }> {
    const frozen = JSON.parse(JSON.stringify(command)) as DataCommand;
    const generation = this.generation;
    const operation = this.submissions.catch(() => undefined).then(async () => {
      validateCommand(frozen);
      if (!this.current(frozen.owner, generation)) throw new Error('Account changed');
      const entries = await this.options.journal.list(frozen.owner);
      const existing = entries.find((entry) => entry.command.operationId === frozen.operationId);
      if (existing && commandFingerprint(existing.command) !== commandFingerprint(frozen)) {
        throw new Error('Operation identity cannot be reused for another command');
      }
      if (!existing) {
        const entry: JournalEntry = { command: frozen, state: 'queued', createdAt: (this.options.now ?? Date.now)(), attempts: 0 };
        await this.options.journal.put(entry);
        entries.push(entry);
        if (this.drains.has(frozen.owner)) this.drainRequested.add(frozen.owner);
      }
      this.emit({ kind: 'journal', owner: frozen.owner, entries }, generation);
      return { kind: 'queued' as const, operationId: frozen.operationId };
    });
    this.submissions = operation;
    return operation;
  }

  /** Call only after the acknowledged projection has itself been durably stored. */
  async finalize(operationId: string): Promise<void> {
    const owner = this.owner;
    const generation = this.generation;
    if (!owner) throw new Error('Authentication required');
    const entry = (await this.options.journal.list(owner)).find(item => item.command.operationId === operationId);
    if (entry && entry.state !== 'acknowledged') throw new Error('Cannot finalize an unacknowledged command');
    await this.options.journal.remove(owner, operationId);
    await this.publishJournal(owner, generation);
  }

  /** Explicit recovery may retire a terminal refusal; unknown outcomes stay replayable. */
  async discard(operationId: string): Promise<void> {
    const owner = this.owner;
    const generation = this.generation;
    if (!owner) throw new Error('Authentication required');
    const entry = (await this.options.journal.list(owner)).find(item => item.command.operationId === operationId);
    if (entry && entry.state !== 'refused' && entry.state !== 'conflict') throw new Error('Cannot discard an unresolved command');
    await this.options.journal.remove(owner, operationId);
    await this.publishJournal(owner, generation);
  }

  async drain(attempted = new Set<string>(), canDeliver = () => true): Promise<void> {
    const owner = this.owner;
    const generation = this.generation;
    if (!owner) return;
    const existing = this.drains.get(owner);
    if (existing) return existing;
    const operation = Promise.resolve().then(async () => {
      do {
        this.drainRequested.delete(owner);
        await this.drainOwner(owner, generation, attempted, canDeliver);
      } while (this.current(owner, generation) && this.drainRequested.has(owner));
    });
    this.drains.set(owner, operation);
    try { await operation; } finally { this.drains.delete(owner); }
  }

  private current(owner: string, generation: number): boolean {
    return owner === this.owner && generation === this.generation;
  }

  private emit(event: RuntimeEvent, generation: number): void {
    if (!this.current(event.owner, generation)) return;
    // Consumer rendering errors must never change delivery or trigger another send.
    this.listeners.forEach((listener) => { try { listener(event); } catch { /* Isolate subscribers. */ } });
  }

  private async publishJournal(owner: string, generation: number): Promise<void> {
    const entries = await this.options.journal.list(owner);
    this.emit({ kind: 'journal', owner, entries }, generation);
  }

  private async drainOwner(owner: string, generation: number, attempted: Set<string>, canDeliver: () => boolean): Promise<void> {
    const entries = await this.options.journal.list(owner);
    const resources = new Map<string, JournalEntry[]>();
    entries.forEach((entry) => {
      const key = JSON.stringify(entry.command.resource);
      resources.set(key, [...(resources.get(key) ?? []), entry]);
    });
    const outcomes = await Promise.allSettled([...resources.values()].map(async (queue) => {
      for (const entry of queue) {
        if (!this.current(owner, generation) || !canDeliver()) return;
        if (attempted.has(entry.command.operationId)) continue;
        attempted.add(entry.command.operationId);
        if (entry.state === 'acknowledged' || entry.state === 'conflict' || entry.state === 'refused') {
          if (entry.result) this.emit({ kind: 'result', owner, result: entry.result }, generation);
          continue;
        }
        const remaining = await this.options.journal.list(owner);
        const dependencies = entry.command.dependsOn.filter((id) => remaining.some((item) => item.command.operationId === id && item.state !== 'acknowledged'));
        if (dependencies.length) {
          await this.options.journal.put({ ...entry, state: 'blocked', result: { kind: 'blocked', operationId: entry.command.operationId, dependencies } });
          continue;
        }
        await this.deliver(entry, owner, generation);
      }
    }));
    await this.publishJournal(owner, generation);
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  private async deliver(entry: JournalEntry, owner: string, generation: number): Promise<void> {
    const sending: JournalEntry = { ...entry, state: 'sending', attempts: entry.attempts + 1 };
    await this.options.journal.put(sending);
    if (!this.current(owner, generation)) return;
    let result: CommandResult;
    try {
      result = await this.options.transport.send(entry.command);
      if (result.operationId !== entry.command.operationId) throw new Error('Unexpected operation result');
    } catch {
      await this.options.journal.put({ ...sending, state: 'unknown' });
      return;
    }
    // Persist the old owner's outcome, but never publish it to another account.
    await this.options.journal.put({ ...sending, result, state: result.kind === 'deleted' ? 'conflict' : result.kind });
    this.emit({ kind: 'result', owner, result }, generation);
  }
}
