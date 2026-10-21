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
 * keeps the person where they are — the editor says why. Both ways answer whether the page was left.
 */
export function useOpenInBible(beforeSwitch?: () => Promise<boolean>, fallbackPath = '') {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams()?.toString();
  const { locale } = useAppLocale();
  const here = `${pathname ?? fallbackPath}${query ? `?${query}` : ''}`;

  const openHref = useCallback(
    (href: string): Promise<boolean> => {
      if (!beforeSwitch) {
        router.push(href);
        return Promise.resolve(true);
      }
      return beforeSwitch().then((saved) => {
        if (saved) router.push(href);
        return saved;
      }, () => false);
    },
    [beforeSwitch, router]
  );

  const openReference = useCallback(
    (reference: ScriptureRefShape): Promise<boolean> => {
      const href = bibleHref(reference, { locale, from: here });
      return href ? openHref(href) : Promise.resolve(false);
    },
    [here, locale, openHref]
  );

  return { here, locale, openHref, openReference };
}

export default useOpenInBible;
