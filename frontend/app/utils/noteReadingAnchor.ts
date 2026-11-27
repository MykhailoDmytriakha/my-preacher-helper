const READING_BLOCKS = 'p,li,blockquote,pre,tr,dt,dd,figure,h1,h2,h3,h4,h5,h6';

type ReadingBlock = {
    index: number;
    tag: string;
    text: string | null;
    progress: number;
};

export type NoteReadingStart = {
    block: ReadingBlock | null;
    sectionId: string | null;
};

/** Both note views render the same Markdown, with different widths and header heights. */
export function noteReadingBlockAtLine(textRoot: HTMLElement | null, line: number): ReadingBlock | null {
    if (!textRoot) return null;
    type Candidate = { element: HTMLElement; index: number; rect: DOMRect };
    let previous: Candidate | undefined;
    let next: Candidate | undefined;
    for (const [index, element] of Array.from(textRoot.querySelectorAll<HTMLElement>(READING_BLOCKS)).entries()) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.top <= line) {
            if (!previous || rect.top >= previous.rect.top) previous = { element, index, rect };
        } else if (!next || rect.top < next.rect.top) {
            next = { element, index, rect };
        }
    }
    // Above the first block, keep the title at the top. In a gap inside the text,
    // continue at the next block rather than re-reading the previous one.
    if (!previous) return null;
    const { element, index, rect } = line >= previous.rect.bottom && next ? next : previous;
    return {
        index, tag: element.tagName, text: element.textContent,
        progress: Math.min(1, Math.max(0, (line - rect.top) / rect.height)),
    };
}

/** Move only the reading pane. The underlying note and its scroll owner stay in place. */
export function restoreNoteReadingBlock(
    scrollRoot: HTMLElement, textRoot: HTMLElement, block: ReadingBlock, offset: number,
): boolean {
    const target = textRoot.querySelectorAll<HTMLElement>(READING_BLOCKS).item(block.index);
    if (target?.tagName !== block.tag || target.textContent !== block.text) return false;
    const rect = target.getBoundingClientRect();
    if (rect.height <= 0) return false;
    const line = scrollRoot.getBoundingClientRect().top + offset;
    scrollRoot.scrollTop += rect.top + rect.height * block.progress - line;
    return true;
}
