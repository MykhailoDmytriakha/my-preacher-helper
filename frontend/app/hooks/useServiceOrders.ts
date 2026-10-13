import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServiceOrdersEngine } from '@/hooks/useServiceOrdersEngine';

/**
 * The pastor's orders of service — a reference book, one document per rite — read from and
 * written through the data engine. The list, the rite's own page and the breadcrumb all use this.
 */
export function useServiceOrders(userId?: string | null, options?: { enabled?: boolean }) {
  const { uid: resolvedUid } = useResolvedUid();
  return useServiceOrdersEngine(userId ?? resolvedUid ?? null, options?.enabled !== false);
}

export type ServiceOrdersApi = ReturnType<typeof useServiceOrdersEngine>;
