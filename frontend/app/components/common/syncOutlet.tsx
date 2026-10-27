'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface Outlets { nodes: ReadonlyMap<unknown, HTMLElement>; register(subject: unknown, element: HTMLElement): () => void }
const Context = createContext<Outlets | null>(null);

/** Move one existing question to its visible field; this registry owns no data or action state. */
export function SyncOutletProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<ReadonlyMap<unknown, HTMLElement>>(() => new Map());
  const register = useCallback((subject: unknown, element: HTMLElement) => {
    setNodes(previous => new Map(previous).set(subject, element));
    return () => setNodes(previous => {
      if (previous.get(subject) !== element) return previous;
      const next = new Map(previous); next.delete(subject); return next;
    });
  }, []);
  const value = useMemo(() => ({ nodes, register }), [nodes, register]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSyncOutlet(subject: unknown): HTMLElement | null {
  return useContext(Context)?.nodes.get(subject) ?? null;
}

export function SyncOutlet({ subject, active }: { subject: unknown; active: boolean }) {
  const node = useRef<HTMLDivElement>(null), register = useContext(Context)?.register;
  useLayoutEffect(() => {
    if (!active || !register || !node.current) return;
    return register(subject, node.current);
  }, [subject, active, register]);
  return <div ref={node} />;
}
