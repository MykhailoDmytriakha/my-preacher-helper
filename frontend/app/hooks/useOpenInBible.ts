'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { useAppLocale } from '@/hooks/useAppLocale';
import { bibleHref } from '@/utils/bibleLink';

import type { ScriptureRefShape } from '@/utils/scriptureReference';

/**
 * LEAVING A PAGE FOR THE BIBLE — the one way: the passage opens there, and its way back is this very
 * page, its query too ("?source=note" is what keeps a plan's note editor open). A page that edits
 * text passes `beforeSwitch`: what is being edited is saved first, and a save that refuses or fails
 * keeps the person where they are — the editor says why.
 */
export function useOpenInBible(beforeSwitch?: () => Promise<boolean>, fallbackPath = '') {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams()?.toString();
  const { locale } = useAppLocale();
  const here = `${pathname ?? fallbackPath}${query ? `?${query}` : ''}`;

  const openHref = useCallback(
    (href: string) => {
      if (!beforeSwitch) {
        router.push(href);
        return;
      }
      void beforeSwitch().then((saved) => { if (saved) router.push(href); }, () => undefined);
    },
    [beforeSwitch, router]
  );

  const openReference = useCallback(
    (reference: ScriptureRefShape) => {
      const href = bibleHref(reference, { locale, from: here });
      if (href) openHref(href);
    },
    [here, locale, openHref]
  );

  return { here, locale, openHref, openReference };
}

export default useOpenInBible;
