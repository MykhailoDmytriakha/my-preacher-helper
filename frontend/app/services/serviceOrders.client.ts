import type { ServiceOrder, ServiceOrderStep } from '@/models/models';

/**
 * Orders of service are read and written only through the data engine (engineOwnedCollections.ts);
 * what stays here is the collection name, its revision parts and how a stored document is shaped.
 */
export const SERVICE_ORDERS_COLLECTION = 'serviceOrders';

/**
 * Independently edited parts of an order. Kept apart so renaming it, rewriting one step and
 * dragging it up the list never collide: a false conflict teaches a person to click through
 * the dialog, which is worse than having no dialog at all.
 */
export const SERVICE_ORDER_META_AGGREGATE = 'meta';
export const SERVICE_ORDER_STEPS_AGGREGATE = 'steps';
export const SERVICE_ORDER_PLACEMENT_AGGREGATE = 'placement';

/**
 * What a document is allowed to be missing and still be usable. A rite written before a field
 * existed, a partial write, a value typed into the console: none of it should reach a screen a
 * pastor opens at a graveside as a crash.
 */
export function hydrateServiceOrder(data: Omit<ServiceOrder, 'id'>, id: string): ServiceOrder {
  const steps = Array.isArray(data.steps) ? data.steps : [];
  return {
    ...data,
    id,
    title: typeof data.title === 'string' ? data.title : '',
    steps: steps
      .filter((step): step is ServiceOrderStep => Boolean(step) && typeof step.id === 'string')
      .map((step) => ({
        ...step,
        title: typeof step.title === 'string' ? step.title : '',
        scriptureRefs: Array.isArray(step.scriptureRefs) ? step.scriptureRefs : [],
      })),
    rank: typeof data.rank === 'number' && Number.isFinite(data.rank) ? data.rank : Number.MAX_SAFE_INTEGER,
  };
}
