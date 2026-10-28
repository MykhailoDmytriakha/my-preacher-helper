'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { useAppLocale } from '@/hooks/useAppLocale';
import { bibleHref } from '@/utils/bibleLink';
import { referenceBibleFor, withStoredBible } from '@/utils/scriptureReferenceNumbering';

import { useScriptureLinks } from './ScriptureLinks';

import type { AppLocale } from '@/utils/appLocale';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

/**
 * A PLACE A DOCUMENT STORES, OPENED — a note's or a comment's reference chip: over the page where the screen opens
 * references (`ScriptureLinks` — the verse window, with «Открыть в Библии»), else the Bible at it, its way back this
 * page. A reference kept before references named their Bible is read in `locale`, the language it was written in
 * (`withStoredBible`); the interface's language by default.
 */
export function useOpenStoredReference(locale?: AppLocale): (reference: ScriptureRefShape) => void {
  const links = useScriptureLinks();
  const router = useRouter();
  const { locale: appLocale } = useAppLocale();
  const reading = locale ?? appLocale;
  return useCallback((reference: ScriptureRefShape) => {
    if (links) {
      const stored = withStoredBible(reference, reading);
      links.onOpen({ ...stored, bible: stored.bible ?? referenceBibleFor(reading) });
      return;
    }
    const href = bibleHref(reference, { locale: reading, from: `${window.location.pathname}${window.location.search}` });
    if (href) router.push(href);
  }, [links, router, reading]);
}
