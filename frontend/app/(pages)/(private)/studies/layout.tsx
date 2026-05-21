'use client';

import { type ReactNode } from 'react';

import NotePreviewProvider from './components/NotePreviewProvider';

/**
 * Studies-only layout shim that installs the `NotePreviewProvider`. The
 * provider intercepts clicks on `a[data-wikilink-id]` chips anywhere inside
 * studies pages and opens the note in a read-only modal instead of
 * navigating. Cmd/Ctrl+click still falls through to native navigation.
 */
export default function StudiesLayout({ children }: { children: ReactNode }) {
  return <NotePreviewProvider>{children}</NotePreviewProvider>;
}
