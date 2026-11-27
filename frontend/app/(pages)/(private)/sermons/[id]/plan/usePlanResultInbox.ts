import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { checkPlanInboxResult, closePlanInboxResult, listPlanResultInbox, queuedPlanInboxClosures, recordPlanInboxClosure } from './planResultInbox.client';

import type { PlanInboxScope } from './planResultInbox.client';
import type { PlanInboxItem, PlanResultMode } from '@/utils/planResultOrigin';

type Lookup = Promise<PlanInboxItem[] | undefined>;
type Entries = { scope: PlanInboxScope; items?: PlanInboxItem[]; closed: Set<string> };

export function usePlanResultInbox(ownerId: string | undefined, sermonId: string | undefined, mode: PlanResultMode,
  knownOperations: () => string[]) {
  const scope = useMemo(() => ownerId && sermonId ? { ownerId, sermonId, mode } : undefined, [ownerId, sermonId, mode]);
  const [entries, setEntries] = useState<Entries>();
  const currentKnown = useRef(knownOperations);
  currentKnown.current = knownOperations;
  const active = useRef<{ scope: PlanInboxScope; refresh: () => Lookup; inFlight: () => Lookup | undefined; closing: Set<string> } | undefined>(undefined);
  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    const closing = new Set(queuedPlanInboxClosures(scope));
    let fetching: Lookup | undefined;
    const refresh = () => {
      if (fetching) return fetching;
      if (controller.signal.aborted) return Promise.resolve(undefined);
      const queued = queuedPlanInboxClosures(scope);
      queued.forEach(id => closing.add(id));
      for (const id of queued) void closePlanInboxResult(scope, id).catch(() => undefined);
      fetching = listPlanResultInbox(scope, controller.signal, currentKnown.current()).then(({ items, closed }) => {
        if (controller.signal.aborted) return undefined;
        closed.forEach(id => closing.add(id));
        const visible = items.filter(item => !closing.has(item.id));
        setEntries({ scope, items: visible, closed: new Set(closing) });
        return visible;
      }, () => {
        if (!controller.signal.aborted && closing.size) setEntries(previous => ({
          scope, items: previous?.scope === scope ? previous.items?.filter(item => !closing.has(item.id)) : undefined,
          closed: new Set(closing),
        }));
        return undefined;
      }).finally(() => { fetching = undefined; });
      return fetching;
    };
    const changed = () => { if (document.visibilityState === 'visible') void refresh(); };
    active.current = { scope, refresh, inFlight: () => fetching, closing };
    void refresh();
    window.addEventListener('online', changed);
    document.addEventListener('visibilitychange', changed);
    return () => {
      active.current = undefined;
      controller.abort();
      window.removeEventListener('online', changed);
      document.removeEventListener('visibilitychange', changed);
    };
  }, [scope]);

  const check = useCallback(async (id: string) => {
    const current = active.current;
    if (!scope || current?.scope !== scope) return;
    try {
      await checkPlanInboxResult(scope, id);
    } finally {
      if (active.current === current) await current.refresh();
    }
  }, [scope]);

  const close = useCallback(async (id: string) => {
    if (!scope) return;
    const current = active.current;
    await recordPlanInboxClosure(scope, id);
    if (active.current !== current || current?.scope !== scope) return;
    current.closing.add(id);
    setEntries(previous => ({
      scope, items: previous?.scope === scope ? previous.items?.filter(item => item.id !== id) : undefined,
      closed: new Set(current.closing),
    }));
  }, [scope]);

  const waitForLookup = useCallback(() => globalThis.crypto?.subtle && active.current?.scope === scope
    ? active.current?.inFlight() : undefined, [scope]);
  const current = entries?.scope === scope ? entries : undefined;
  return { items: current?.items, closed: current?.closed, check, close, waitForLookup };
}
