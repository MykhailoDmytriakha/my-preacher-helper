import { CHIP_TONES, type ChipTone } from '@/utils/themeColors';

export type { ChipTone };

export type ChipSize = 'xs' | 'sm' | 'md';

/**
 * How loud the label is. It is a PROP and not something a caller appends, because Tailwind
 * orders its own rules and `.font-medium` is written after `.font-bold`: a caller passing
 * `font-bold` in `className` would lose silently, and did — eight calendar and navigation
 * labels rendered at weight 500 while their source said 700.
 */
export type ChipWeight = 'medium' | 'bold';

/**
 * The shape, with no colour, no size and no weight in it — everything a chip is before it
 * makes any of those three choices. Nothing here may conflict with a caller's `className`.
 */
export const CHIP_SHAPE_CLASSES =
  'inline-flex min-w-0 items-center rounded-full transition-all duration-150';

export const CHIP_SIZE_CLASSES: Record<ChipSize, string> = {
  /**
   * The micro label: a calendar row's PREACHED / PLANNED, where a whole day has to fit on
   * one line, and the "Beta" flag beside a navigation item.
   */
  xs: 'gap-1 px-1.5 py-0.5 text-[10px]',
  /**
   * Dense rows — tags on a thought card, chips inside a list item. Same pill, less air.
   */
  sm: 'gap-1 px-2 py-0.5 text-xs',
  /**
   * The app's chip. The size the Scripture reference on a study note has always been, and
   * now the size of every other content label.
   */
  md: 'gap-1 px-3 py-1 text-xs',
};

const CHIP_WEIGHT_CLASSES: Record<ChipWeight, string> = {
  medium: 'font-medium',
  bold: 'font-bold',
};

export interface ChipClassOptions {
  tone?: ChipTone;
  size?: ChipSize;
  weight?: ChipWeight;
  selected?: boolean;
  /** Adds the hover plate and the pointer. Leave off for a label nobody can press. */
  interactive?: boolean;
}

/**
 * The chip's class string, for the places that cannot render `<Chip>` itself.
 *
 * It lives in `utils/` rather than beside the component because `getTagStyle` — a pure
 * helper feeding nine call sites that each wire their own add/remove — needs the shape and
 * must not drag a React component and its icon set in behind it. Letting it borrow the
 * shape from here is what makes a thought tag and a Scripture reference the same object on
 * screen without rewriting nine components at once.
 *
 * Reach for `<Chip>` anywhere else: this returns a string, so it cannot give you the ✕, the
 * keyboard contract, or the accessible name.
 */
export function buildChipClasses({
  tone = 'neutral',
  size = 'md',
  weight = 'medium',
  selected = false,
  interactive = false,
}: ChipClassOptions = {}): string {
  const palette = CHIP_TONES[tone];
  const stateClasses = selected
    ? palette.selected
    : `${palette.base} ${interactive ? palette.hover : ''}`;

  return [
    CHIP_SHAPE_CLASSES,
    CHIP_SIZE_CLASSES[size],
    CHIP_WEIGHT_CLASSES[weight],
    stateClasses,
    interactive ? 'cursor-pointer' : '',
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
