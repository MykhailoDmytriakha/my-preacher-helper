/**
 * A short title should read like a title; a long one must still fit the bar on one or
 * two lines. Stepping the size by length beats measuring: it is stable, has no layout
 * pass, and never lands between two sizes on a resize.
 */
export function noteTitleSizeClass(title: string): string {
    const length = (title || '').length;
    if (length <= 24) return 'text-2xl';
    if (length <= 40) return 'text-xl';
    if (length <= 64) return 'text-lg';
    if (length <= 100) return 'text-base';
    return 'text-sm';
}
