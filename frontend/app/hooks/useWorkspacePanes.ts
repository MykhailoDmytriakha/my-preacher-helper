"use client";

import { useLayoutEffect, type RefObject } from 'react';

type PaneKind = 'reader' | 'study';
type Claim = { holders: number; previous: string | null };
const claims = new WeakMap<HTMLElement, Map<PaneKind, Claim>>();

/** A view owns its flags until its last mounted holder leaves. */
function claim(element: HTMLElement, kind: PaneKind): () => void {
  let entries = claims.get(element);
  if (!entries) {
    entries = new Map();
    claims.set(element, entries);
  }
  const attribute = `data-${kind}-layout`;
  let entry = entries.get(kind);
  if (entry) entry.holders += 1;
  else {
    entry = { holders: 1, previous: element.getAttribute(attribute) };
    entries.set(kind, entry);
    element.setAttribute(attribute, '');
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.holders -= 1;
    if (entry.holders) return;
    if (entry.previous === null) element.removeAttribute(attribute);
    else element.setAttribute(attribute, entry.previous);
    entries.delete(kind);
    if (!entries.size) claims.delete(element);
  };
}

/**
 * Declare pane layout on the existing shell and its direct private workspace.
 * CSS must not discover it by searching every descendant after each DOM change.
 * The caller supplies an element it owns; a preview outside the shell claims nothing.
 */
export function useWorkspacePanes(content: RefObject<HTMLElement | null>, kind: PaneKind, active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return undefined;
    const workspace = content.current?.closest<HTMLElement>('[data-page-gesture]');
    const shell = workspace?.parentElement;
    if (!workspace || shell?.id !== 'app-shell') return undefined;
    const releaseShell = claim(shell, kind);
    const releaseWorkspace = claim(workspace, kind);
    return () => { releaseWorkspace(); releaseShell(); };
  }, [active, content, kind]);
}
