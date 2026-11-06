/**
 * Keep enough room for a thought after nested section/point padding and its action rail.
 * At tablet width a viewport breakpoint can leave only 60px of text. The container chooses
 * how many 24rem tracks fit; min(100%, ...) lets one track fit a narrow phone as well.
 * auto-fit collapses unused tracks when only two or three board sections are visible.
 */
export const structureThoughtGridClass = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))]';

/** Outline points use the same container fit, with room for their shorter text and controls. */
export const outlinePointGridClass = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))]';

/** The board keeps one focus column or the person's explicit vertical arrangement. */
export const boardLayoutClass = (visibleCount: number, isVertical: boolean): string => {
  if (visibleCount <= 1) return 'flex flex-col';
  if (isVertical) return 'flex flex-col gap-6';
  // Three 24rem sections and two 1rem gaps fit the 1184px board on a 1280px laptop.
  return `${structureThoughtGridClass} gap-x-4 gap-y-6`;
};

/** Both a pair and all three sections may be stacked; focus has no layout toggle. */
export const showLayoutToggle = (visibleCount: number): boolean => visibleCount >= 2;

/** Nested board surfaces leave readable text on phones and keep the established wide spacing. */
export const structureBodyPaddingClass = 'p-2 sm:p-4';
export const structureThoughtPaddingClass = 'p-2 sm:p-5';
export const structureSubPointInsetClass = 'ml-0 px-0 sm:ml-3 sm:px-3';
