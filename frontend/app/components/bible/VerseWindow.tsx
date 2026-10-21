'use client';

import { useCallback, useState, type ReactNode } from 'react';

import { useOpenInBible } from '@/hooks/useOpenInBible';

import { ScriptureLinks } from './ScriptureLinks';
import { VerseSheet, type SheetReference } from './VerseSheet';

import type { AppLocale } from '@/utils/appLocale';

type VerseWindowOptions = {
  /** The window offers the Bible page; false where leaving would lose words saved nowhere yet (a plan point being edited). */
  toBible?: boolean;
  /** What is being edited is saved before the Bible page opens; a save that refuses keeps the person here (`useOpenInBible`). */
  beforeSwitch?: () => Promise<boolean>;
};

/**
 * A PRESSED REFERENCE OPENS OVER THE PAGE (the owner, 2026-10-21: a reference in a sermon's thoughts
 * took him to the Bible — "let it just open in a window"). The passage is read in the verse window
 * (`VerseSheet`) and the page under it stays as it was; the Bible page is one press away, from the
 * window, with its way back here. `open` takes the reference pressed, `sheet` is drawn by the screen.
 */
export function useVerseWindow({ toBible = true, beforeSwitch }: VerseWindowOptions = {}) {
  const [verse, setVerse] = useState<SheetReference | null>(null);
  const { openReference } = useOpenInBible(beforeSwitch);
  const close = useCallback(() => setVerse(null), []);
  const sheet = (
    <VerseSheet
      reference={verse}
      onClose={close}
      // Closed once the page is left: a save that refuses keeps the window, and the place read in it.
      openInBible={toBible ? (target) => { void openReference(target).then((left) => { if (left) setVerse(null); }); } : undefined}
    />
  );
  return { open: setVerse, sheet };
}

/**
 * `ScriptureLinks` for a page a person prepares on — a sermon, its plan, a group, the notes: the
 * references in the text inside, and a verse opened through `useScriptureLinks`, open over the page.
 */
export function ScriptureLinksInWindow({ writtenIn, children, ...options }: VerseWindowOptions & { writtenIn?: AppLocale | null; children: ReactNode }) {
  const verseWindow = useVerseWindow(options);
  return (
    <ScriptureLinks onOpen={verseWindow.open} writtenIn={writtenIn}>
      {children}
      {verseWindow.sheet}
    </ScriptureLinks>
  );
}
