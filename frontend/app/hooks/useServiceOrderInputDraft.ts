import { isReturnedServiceOrderInput, readServiceOrderInputComparison, readServiceOrderInputValue, useDataDocument, useRecoveryDiscovery, type ServiceOrderInput } from '@/data-engine/react.client';

const SLOT = 'service-order-input';
const words = (value: unknown) => Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '';

/** The engine stages the input and owns its pause, queue admission, and departure. */
export function useServiceOrderInputDraft(orderId: string) {
  const document = useDataDocument(orderId ? { collection: 'serviceOrders', id: orderId } : null,
    { slot: SLOT, autoSave: false, readOnlyCopy: true });
  const ready = Boolean(document.state?.checkpoint.draft && !document.readOnly);
  const stage = (edit: ServiceOrderInput) => document.update(current => {
    if (!current) return current;
    if (edit.field === 'orderTitle') return { ...current, title: edit.value };
    const steps = current.steps;
    if (!Array.isArray(steps)) return current;
    return { ...current, steps: steps.map(step => step && typeof step === 'object' && !Array.isArray(step) && step.id === edit.stepId
      ? { ...step, [edit.field]: edit.value } : step) };
  }, { action: { kind: 'service-order-input', input: edit } });
  const latest = document.remote ?? document.confirmed;
  const recovery = useRecoveryDiscovery({
    identity: document.recoveryIdentity,
    enabled: !document.loading && document.status !== null && !document.restored,
    version: JSON.stringify([document.status?.phase, latest?.metadata?.revision]),
    list: async () => (await document.listRecoverable({ slot: SLOT })).flatMap(source => {
      const { checkpoint } = source.record;
      const inputs = Object.values(checkpoint.serviceOrderInputs ?? {});
      if (!inputs.length) return [];
      return [{ id: source.id, title: words(checkpoint.draft?.title) || orderId,
        preview: inputs.map(input => 'raw' in input ? input.raw ?? words(input.value) : words(input.value)).join('\n').slice(0, 500),
        discard: () => document.discardRecovery(source) }];
    }),
    recover: document.recover,
  });
  const checkpoint = document.state?.checkpoint;
  const inputs = Object.values(checkpoint?.serviceOrderInputs ?? {});
  const recoveredInputs = Object.entries(checkpoint?.serviceOrderInputs ?? {}).filter(([, input]) => {
    if (document.restored || input.retainedOnly) return true;
    if (checkpoint && document.state?.result?.kind === 'conflict' && isReturnedServiceOrderInput(checkpoint, input)) return true;
    if (input.version) return false;
    const stored = readServiceOrderInputComparison(latest, input)?.value;
    return stored !== undefined && JSON.stringify(stored) !== JSON.stringify(input.before);
  });
  return { ready, stage, inputs, latest, flush: document.flushServiceOrderInputs, recovery, subject: document.recoveryIdentity, restored: document.restored, status: document.status,
    error: document.error, errorWords: document.errorWords, refresh: document.retry, save: document.saveServiceOrderInput,
    recoveredFields: recoveredInputs.flatMap(([key, input]) => {
      const stored = readServiceOrderInputValue(latest?.value ?? null, input);
      const available = !input.retainedOnly && stored !== undefined && (!input.version || latest?.metadata?.generation === input.version.generation);
      if (available && JSON.stringify(stored) === JSON.stringify(input.value)) return [];
      const originalValue = JSON.stringify(stored) === JSON.stringify(input.before);
      const mayUseLocal = input.field !== 'orderTitle' || Boolean(input.value.trim());
      const compared = available && !input.version && !originalValue ? readServiceOrderInputComparison(latest, input) : undefined;
      const returned = available && document.state?.result?.kind === 'conflict' && checkpoint && isReturnedServiceOrderInput(checkpoint, input);
      const choose = returned ? {
        local: () => document.keepLocal(checkpoint),
        stored: () => document.acceptRemote(checkpoint),
      } : compared ? {
        local: () => document.saveServiceOrderInput(input, compared),
        stored: () => document.useStoredServiceOrderInput(input, compared),
      } : undefined;
      return [{ key, input, stored: words(stored), mine: 'raw' in input ? input.raw ?? words(input.value) : words(input.value),
        available, mayApply: available && !choose && (Boolean(input.version) || originalValue) && mayUseLocal, mayUseLocal, choose }];
    }),
  };
}
