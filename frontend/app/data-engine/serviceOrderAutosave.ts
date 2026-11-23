import { equalValues } from './fieldValues';
import { serviceOrderInputKey, ServiceOrderInputDecisionError } from './serviceOrderInput';

import type { ServiceOrderInput } from './serviceOrderInput';

const SERVICE_INPUT_PAUSE = 700;

export type ServiceOrderInputFilter = { field?: ServiceOrderInput['field']; stepId?: string };
type DeferredDelivery = { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void };
type ScheduledInput = { input: ServiceOrderInput; timer: ReturnType<typeof setTimeout>; deferred?: DeferredDelivery };

function deferDelivery(): DeferredDelivery {
  let resolve!: DeferredDelivery['resolve'];
  let reject!: DeferredDelivery['reject'];
  const promise = new Promise<void>((finish, fail) => { resolve = finish; reject = fail; });
  return { promise, resolve, reject };
}

/** Owns the pause and captured opening of each field for one engine editor. */
export class ServiceOrderAutosave {
  private readonly waiting = new Map<string, ScheduledInput>();
  private readonly captured = new Map<string, ServiceOrderInput>();
  private readonly saving = new Map<string, { input: ServiceOrderInput; captured: Promise<void> }>();

  constructor(
    private readonly isCurrent: (input: ServiceOrderInput) => boolean,
    private readonly send: (input: ServiceOrderInput) => Promise<void>,
    private readonly waitsForOpening: (input: ServiceOrderInput) => boolean,
  ) {}

  opening(input: ServiceOrderInput): ServiceOrderInput {
    const key = serviceOrderInputKey(input);
    const prior = this.waiting.has(key) ? undefined : this.captured.get(key);
    if (!prior || !equalValues(prior.value, input.before) || !prior.version
      || (input.version && input.version.generation !== prior.version.generation)
      || equalValues(input.before, input.value)) return input;
    return { ...input, version: input.version ?? prior.version, followsCaptured: true };
  }

  arrange(scope: ServiceOrderInput, input: ServiceOrderInput | undefined): void {
    const key = serviceOrderInputKey(scope);
    const held = this.waiting.get(key);
    if (held) {
      clearTimeout(held.timer);
      held.deferred?.resolve();
    }
    this.waiting.delete(key);
    if (!input || input.retainedOnly || (input.field === 'orderTitle' && !input.value.trim())) return;
    this.waiting.set(key, { input, timer: setTimeout(() => { void this.deliver(key).catch(() => undefined); }, SERVICE_INPUT_PAUSE) });
  }

  async flush(filter?: ServiceOrderInputFilter): Promise<void> {
    const matches = (input: ServiceOrderInput) => (!filter?.field || filter.field === input.field)
      && (filter?.stepId === undefined || ('stepId' in input && filter.stepId === input.stepId));
    const deliveries = [...this.waiting].filter(([, { input }]) => matches(input)).map(([key]) => this.deliver(key));
    const captures = [...this.saving.values()].filter(({ input }) => matches(input)).map(({ captured }) => captured);
    await Promise.all([...deliveries, ...captures]);
  }

  finishPredecessor(accepted: boolean): void {
    for (const [key, held] of [...this.waiting]) {
      if (!held.deferred) continue;
      if (accepted) void this.deliver(key).catch(() => undefined);
      else {
        this.waiting.delete(key);
        held.deferred.reject(new ServiceOrderInputDecisionError('An earlier service field needs review', 'resolve-version-first'));
      }
    }
  }

  dispose(): void {
    for (const { timer, deferred } of this.waiting.values()) {
      clearTimeout(timer);
      deferred?.reject(new ServiceOrderInputDecisionError('The service editor closed before this field was sent'));
    }
    this.waiting.clear();
    this.captured.clear();
  }

  private async deliver(key: string): Promise<void> {
    const held = this.waiting.get(key);
    if (!held) return;
    clearTimeout(held.timer);
    const current = this.isCurrent(held.input);
    // An observed field can be newer than the confirmed document while its previous request is in flight.
    if (current && this.waitsForOpening(held.input)) {
      held.deferred ??= deferDelivery();
      return held.deferred.promise;
    }
    this.waiting.delete(key);
    if (!current) { held.deferred?.resolve(); return; }
    this.captured.set(key, held.input);
    const captured = this.send(held.input);
    this.saving.set(key, { input: held.input, captured });
    try { await captured; held.deferred?.resolve(); }
    catch (error) {
      if (this.captured.get(key) === held.input) this.captured.delete(key);
      held.deferred?.reject(error);
      throw error;
    } finally {
      if (this.saving.get(key)?.captured === captured) this.saving.delete(key);
    }
  }
}
