import { useEffect, useReducer, useState } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { hasAiResultAttempt } from '@/utils/aiResultAttempt.client';

export function usePendingAiResultAttempt(enabled: boolean, { path, body }: { path: string; body: string }) {
  const { user } = useAuth();
  const ownerId = user?.uid;
  const scope = ownerId ? JSON.stringify([ownerId, path, body]) : undefined;
  const [storedScope, setStoredScope] = useState<string>();
  const [version, recheck] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    if (!enabled || !scope) return;
    let active = true;
    void hasAiResultAttempt(ownerId, path, body).then(found => {
      if (active) setStoredScope(found ? scope : undefined);
    });
    return () => { active = false; };
  }, [body, enabled, ownerId, path, scope, version]);

  return { canRecover: Boolean(enabled && scope && scope === storedScope), recheck };
}
