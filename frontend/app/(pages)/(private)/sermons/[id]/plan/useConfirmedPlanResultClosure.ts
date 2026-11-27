import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { clearDraftIfMatches, draftKey, findDraftCopies, saveDraft } from '@/utils/durableDraft';

import type { PlanInboxScope } from './planResultInbox.client';
import type { PlanResultMode } from '@/utils/planResultOrigin';

type PlanWords = Readonly<Record<string, string>>;
type AcceptedResult = { id: string; cells: PlanWords };
type Waiting = { scope: PlanInboxScope; items: AcceptedResult[] };

const aggregate = (mode: PlanResultMode) => 'plan-result-confirmation-' + mode;
const keyFor = ({ ownerId, sermonId, mode }: PlanInboxScope, id: string) => draftKey(ownerId, sermonId, aggregate(mode), id);

function storedAcceptances({ ownerId, sermonId, mode }: PlanInboxScope): AcceptedResult[] {
  return findDraftCopies<AcceptedResult>(ownerId, sermonId, aggregate(mode)).flatMap(({ value }) =>
    value && typeof value.id === 'string' && value.cells && Object.values(value.cells).every(word => typeof word === 'string')
      ? [value] : []);
}

/** The editor may finish local capture before the command reaches Firestore. */
export function useConfirmedPlanResultClosure(
  ownerId: string | undefined, sermonId: string | undefined, mode: PlanResultMode, confirmed: PlanWords | undefined,
  close: (id: string) => Promise<void>,
) {
  const scope = useMemo(() => ownerId && sermonId ? { ownerId, sermonId, mode } : undefined, [ownerId, sermonId, mode]);
  const [waiting, setWaiting] = useState<Waiting>();
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const sending = useRef(new Set<string>());

  useEffect(() => {
    if (!scope) return;
    const stored = storedAcceptances(scope);
    if (!stored.length) return;
    setWaiting(previous => {
      const existing = previous?.scope === scope ? previous.items : [];
      const restored = stored.filter(item => !existing.some(current => current.id === item.id));
      return { scope, items: [...existing, ...restored] };
    });
  }, [scope]);

  const remember = useCallback((id: string, cells: PlanWords) => {
    if (!scope) return;
    const intent = { id, cells };
    saveDraft(keyFor(scope, id), intent);
    if (activeScope.current !== scope) return;
    setWaiting(previous => {
      const items = previous?.scope === scope ? previous.items : [];
      if (items.some(item => item.id === id)) return previous;
      return { scope, items: [...items, intent] };
    });
  }, [scope]);

  useEffect(() => {
    if (!scope || waiting?.scope !== scope || !confirmed) return;
    for (const intent of waiting.items) {
      const { id, cells } = intent;
      const key = keyFor(scope, id);
      if (sending.current.has(key) || !Object.entries(cells).every(([cell, words]) => confirmed[cell] === words)) continue;
      sending.current.add(key);
      // The close queue records its own durable intent before this confirmation record is retired.
      void close(id).then(() => {
        clearDraftIfMatches(key, intent);
        if (activeScope.current === scope) setWaiting(previous => previous?.scope === scope
          ? { scope, items: previous.items.filter(item => item.id !== id) } : previous);
      }, () => undefined).finally(() => sending.current.delete(key));
    }
  }, [close, confirmed, scope, waiting]);
  return remember;
}
