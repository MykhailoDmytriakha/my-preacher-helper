import type { SVGProps } from 'react';

/**
 * THE BIBLE'S SIGN — a closed book with a cross and a ribbon hanging below it (the owner's choice, 04.11), drawn like a
 * Heroicons outline icon (24×24, 1.5 stroke) so it sits in the navigation next to them. The open book is a sermon's sign
 * (`usageKinds.ts`): the menu, every door to the Bible and every place that means the Bible draw this one, so a new sign is
 * one change here. Unlike `components/Icons.tsx` it adds no size of its own: the bar
 * passes `h-4 w-4` or `h-[18px] w-[18px]`, and a built-in size would compete with it.
 */
export function BibleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true" {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.25 4.5A1.5 1.5 0 0 1 6.75 3h12v15h-12a1.5 1.5 0 0 0-1.5 1.5m0-15v15m0 0A1.5 1.5 0 0 0 6.75 21h12v-3M12 6.75v6.75M9.75 9h4.5M15 18v4.5l1.125-1.125L17.25 22.5V18"
      />
    </svg>
  );
}
