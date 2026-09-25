'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RecoveryDiscoveryOptions<T> {
  identity: object;
  enabled: boolean;
  version: string;
  list: () => Promise<T[]>;
  recover: (id: string) => Promise<void>;
}

/** Discover previous work automatically; only an explicit action may restore it. */
export function useRecoveryDiscovery<T>({ identity, enabled, version, list, recover }: RecoveryDiscoveryOptions<T>) {
  const latest = useRef({ identity, enabled, list, recover });
  latest.current = { identity, enabled, list, recover };
  const mounted = useRef(false);
  const sequence = useRef(0);
  const [state, setState] = useState<{ identity: object; choices: T[]; loading: boolean; error: string | null } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current += 1; }; }, []);
  const current = useCallback(() => mounted.current && latest.current.identity === identity && latest.current.enabled, [identity]);
  const refresh = useCallback(async () => {
    if (!current()) return;
    const request = ++sequence.current;
    setState(previous => ({ identity, choices: previous?.identity === identity ? previous.choices : [], loading: true, error: null }));
    try {
      const choices = await latest.current.list();
      if (current() && sequence.current === request) setState({ identity, choices, loading: false, error: null });
    } catch (error) {
      if (current() && sequence.current === request) setState(previous => ({ identity, choices: previous?.identity === identity ? previous.choices : [], loading: false,
        error: error instanceof Error ? error.message : 'Could not read saved drafts' }));
    }
  }, [current, identity]);
  useEffect(() => { if (enabled) void refresh(); }, [enabled, version, refresh]);
  const restore = useCallback(async (id: string) => {
    if (!current()) throw new Error('The active recovery document changed');
    await latest.current.recover(id);
    if (current()) await refresh();
  }, [current, refresh]);
  const shown = state?.identity === identity ? state : null;
  return { choices: shown?.choices ?? [], loading: enabled && (shown?.loading ?? true), error: shown?.error ?? null, refresh, recover: restore };
}
