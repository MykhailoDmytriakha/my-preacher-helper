/**
 * How the folding outline's headings are spaced and tinted.
 *
 * Two levers, deliberately kept apart:
 *
 *  - **air** — margin lives on the `<section>`, never on the heading itself. The heading's
 *    own margins are killed on purpose so it sits on the toggle row (`HEADING_RESET` in
 *    `FoldableMarkdown`), so the only place left to breathe is the section that owns it.
 *    Air is stepped by heading level: a top-level heading and a third-level one sharing
 *    one gap makes the tree unreadable.
 *  - **tone** — the colour has to carry `!`: the note page pins heading colour with
 *    `prose-headings:text-gray-900 dark:prose-headings:text-gray-50`, and a plain utility
 *    loses that fight on equal specificity.
 *
 * Tone is written as `[&_*]` rather than one rule per heading tag for a reason beyond
 * brevity: the wrapper holds exactly one heading line, and `MarkdownDisplay` remaps
 * markdown `#`…`####` onto `h3`…`h6`, so naming tags here would silently miss a level the
 * day that mapping changes. Every class below is a full literal — Tailwind's JIT scans
 * source text, so a class assembled at runtime is never generated.
 *
 * The green fades as the tree deepens, but only down to a floor. Measured on the rendered
 * colours, the deepest two steps used to sit at 4.32:1 on white and 3.65:1 on the dark
 * ground — under the 4.5:1 needed to read a small bold heading comfortably. Fading further
 * would trade legibility for a hierarchy the indent and the font size already carry, so it
 * stops here: 5.48 / 4.53 / 5.36 / 4.76 in light, 11.64 / 8.68 / 6.96 / 5.68 in dark.
 */

/** Air above a section — the deeper the heading, the tighter it sits to its parent. */
export const sectionAir = (level: number): string =>
    level <= 1 ? 'mt-10' : level === 2 ? 'mt-7' : level === 3 ? 'mt-5' : 'mt-4';

/** Tone of the heading — quieter the deeper it sits, down to the readability floor. */
export const headingTone = (level: number): string =>
    level <= 1
        ? '[&_*]:!text-emerald-700 dark:[&_*]:!text-emerald-300'
        : level === 2
          ? '[&_*]:!text-emerald-700/90 dark:[&_*]:!text-emerald-300/85'
          : level === 3
            ? '[&_*]:!text-emerald-800/85 dark:[&_*]:!text-emerald-400/85'
            : '[&_*]:!text-emerald-800/80 dark:[&_*]:!text-emerald-400/75';

/**
 * How far the fold arrow sits from the top of its row, by heading level.
 *
 * The arrow is a 16px glyph in a small button; the heading beside it is prose type whose
 * line box grows with the level. Aligned to the top of the row, the arrow floated above the
 * cap of a first-level heading. These offsets drop it onto the first line's optical centre,
 * and they are full literals because Tailwind's JIT scans source text.
 *
 * Under a finger the glyph is 20px instead of 16 (`FOLD_ARROW_TOUCH`), so its box starts 2px
 * higher and the centre stays where the mouse sees it. A finger is told by the pointer, not by
 * the width: an iPad is wider than a phone and still pressed with a finger.
 */
export const foldArrowOffset = (level: number): string =>
    level <= 1
        ? 'mt-2.5 [@media(pointer:coarse)]:mt-2'
        : level === 2
          ? 'mt-2 [@media(pointer:coarse)]:mt-1.5'
          : 'mt-1 [@media(pointer:coarse)]:mt-0.5';

/**
 * The arrow's size by pointer: a 20px glyph and a 40px reach for a finger (the reach is an
 * invisible layer around the button, so the row does not move), a 16px glyph for a mouse.
 */
export const FOLD_ARROW_TOUCH = {
    button: "relative [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-2 [@media(pointer:coarse)]:after:content-['']",
    glyph: 'h-4 w-4 [@media(pointer:coarse)]:h-5 [@media(pointer:coarse)]:w-5',
    /** The room a heading with nothing to fold keeps, so its text lines up with its neighbours. */
    spacer: 'w-5 [@media(pointer:coarse)]:w-6',
};

/** The fold arrow, so it does not stay grey beside a green heading. */
export const FOLD_ARROW_TONE =
    'text-emerald-600/50 hover:!text-emerald-700 dark:text-emerald-400/45 dark:hover:!text-emerald-300';
