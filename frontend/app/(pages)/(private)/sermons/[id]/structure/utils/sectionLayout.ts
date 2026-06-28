// Pure layout decisions for the structure board, driven by how many sections are
// currently visible. Kept out of the page component so the rules are unit-testable.
//
//   1 visible  -> focus (single column, rich layout)
//   2 / 3      -> side by side, or stacked when the user picked the vertical layout
//
// The horizontal/vertical toggle is meaningful for any multi-column view (a pair
// can stack too), so it shows for 2+ sections — only the single-section focus view
// has no toggle.

export const boardLayoutClass = (visibleCount: number, isVertical: boolean): string => {
  if (visibleCount <= 1) return 'flex flex-col';
  if (isVertical) return 'flex flex-col gap-6';
  return visibleCount === 2
    ? 'grid grid-cols-1 md:grid-cols-2 gap-6'
    : 'grid grid-cols-1 md:grid-cols-3 gap-6';
};

export const showLayoutToggle = (visibleCount: number): boolean => visibleCount >= 2;
