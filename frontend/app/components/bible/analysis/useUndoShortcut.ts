'use client';

import { useEffect, useRef, type RefObject } from 'react';

import { keyboardReaches } from '@/hooks/modalLayers';

const TYPING = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

/**
 * ⌘Z — Ctrl+Z on Windows, Linux and a Chromebook — undoes as «Отменить» does, while `active` (the owner, 30.10: «добавь
 * поддержку cmd z в режиме правки»). The key is known by its place, not its letter: on a Russian layout it reads «я».
 * Typing keeps its own undo, and a window over this one keeps the keys (`scope` — an element inside this window).
 */
export function useUndoShortcut(active: boolean, undo: () => void, scope: RefObject<HTMLElement | null>): void {
  const latest = useRef(undo);
  latest.current = undo;
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyZ' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if ((event.target as Element | null)?.closest?.(TYPING) || !keyboardReaches(scope.current)) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, scope]);
}
