'use client';

import { createContext, useContext, useEffect } from 'react';

import { useOutlineConflict } from '@/components/plan-editor/useOutlineConflict';

import type { ReactNode } from 'react';

export type OutlineConflictController = ReturnType<typeof useOutlineConflict>;

interface OutlineConflictScopeValue {
  owner: string | null;
  sermonId: string;
  controller: OutlineConflictController;
}

const OutlineConflictScopeContext = createContext<OutlineConflictScopeValue | null>(null);

export function OutlineConflictScopeProvider({ owner, sermonId, controller, children }: OutlineConflictScopeValue & { children: ReactNode }) {
  return <OutlineConflictScopeContext.Provider value={{ owner, sermonId, controller }}>{children}</OutlineConflictScopeContext.Provider>;
}

/** Reuse a page-owned controller when present, while keeping the modal's hook order stable. */
export function useOutlineConflictForEditor(owner: string, sermonId: string, isOpen: boolean): OutlineConflictController {
  const scope = useContext(OutlineConflictScopeContext);
  const shared = scope?.owner === owner && scope.sermonId === sermonId ? scope.controller : null;
  // Empty owner makes the fallback hook inert when the page already owns this conflict session.
  const fallback = useOutlineConflict(shared ? '' : owner, sermonId);
  const controller = shared ?? fallback;
  const holdSelection = controller.holdSelection;
  useEffect(() => {
    if (!isOpen) return;
    return holdSelection();
  }, [holdSelection, isOpen, owner, sermonId]);
  return controller;
}
