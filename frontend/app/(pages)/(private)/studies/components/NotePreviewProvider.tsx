'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { WIKILINK_DATA_ATTR, WIKILINK_SELECTOR } from '@components/studies/node/wikilinkConstants';

import NotePreviewModal from './NotePreviewModal';

interface NotePreviewContextValue {
  /** Open the read-only preview modal for the given note id. */
  open: (noteId: string) => void;
}

const NotePreviewContext = createContext<NotePreviewContextValue | null>(null);

export function useNotePreview(): NotePreviewContextValue {
  const ctx = useContext(NotePreviewContext);
  if (!ctx) {
    // Default no-op when no provider is mounted (e.g. in isolated tests).
    return { open: () => undefined };
  }
  return ctx;
}

/**
 * Provider that opens a read-only note preview when the user clicks any
 * `a[data-wikilink-id]` chip — works uniformly for both MarkdownDisplay
 * read-mode links and tiptap wikilink nodes, without each render site
 * needing to know about the preview. Cmd/Ctrl+click and middle-click fall
 * through to default browser navigation (open in new tab/window).
 */
export function NotePreviewProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const open = useCallback((noteId: string) => setOpenId(noteId), []);
  const close = useCallback(() => setOpenId(null), []);

  const value = useMemo<NotePreviewContextValue>(() => ({ open }), [open]);

  useEffect(() => {
    const handleClick = (event: MouseEvent): void => {
      // Respect modifier-clicks — those mean "open elsewhere".
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button !== 0) return;

      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const chip = target.closest(WIKILINK_SELECTOR);
      if (!chip) return;

      const noteId = chip.getAttribute(WIKILINK_DATA_ATTR);
      if (!noteId) return;

      event.preventDefault();
      event.stopPropagation();
      setOpenId(noteId);
    };

    // Capture phase — fires before Next.js `<Link>`'s own click listener
    // on the anchor, so our preventDefault actually blocks navigation.
    // Bubble phase would arrive too late (router.push already triggered).
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  return (
    <NotePreviewContext.Provider value={value}>
      {children}
      {openId ? <NotePreviewModal noteId={openId} onClose={close} /> : null}
    </NotePreviewContext.Provider>
  );
}

export default NotePreviewProvider;
