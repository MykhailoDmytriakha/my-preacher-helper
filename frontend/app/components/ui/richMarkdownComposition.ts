export interface ObservedTextAppend {
    before: string;
    after: string;
}

export interface CompositionOpening {
    markdown: string;
    draft: string;
    observed: string;
    append?: ObservedTextAppend;
}

type CompositionDecision =
    | { kind: 'restore'; text: string }
    | { kind: 'adopt'; text: string }
    | { kind: 'publish'; text: string }
    | { kind: 'compare'; text: string };

/** Apply a proven paragraph append to the text actually entered in its opening. */
export function rebaseParagraphAppend(append: ObservedTextAppend, typed: string): string | undefined {
    const { before, after } = append;
    if (before !== '' && !after.startsWith(before + '\n\n')) return undefined;
    const suffix = before === '' ? after : after.slice(before.length + 2);
    return [typed, suffix].filter(Boolean).join('\n\n');
}

/** A confirmed composition and an authored append can settle before the controlled echo. */
export function appendToComposition(opening: string, observed: string, confirmed: string, append?: ObservedTextAppend): string | undefined {
    if (confirmed === opening || append?.before !== opening || (observed !== append.before && observed !== append.after)) return;
    const merged = rebaseParagraphAppend(append, confirmed);
    return merged === confirmed ? undefined : merged;
}

export function decideComposition(
    opening: CompositionOpening,
    observed: string,
    confirmed: string,
    append?: ObservedTextAppend,
): CompositionDecision {
    const outsideChange = observed !== opening.observed && observed !== opening.draft && observed !== opening.markdown;
    const editedWhileComposing = confirmed !== opening.markdown;
    if (!outsideChange) {
        return editedWhileComposing ? { kind: 'publish', text: confirmed } : { kind: 'restore', text: confirmed };
    }
    if (confirmed === observed || (!editedWhileComposing && opening.draft === opening.observed)) {
        return { kind: 'adopt', text: observed };
    }
    const priorOrigin = opening.append?.after === opening.draft ? opening.append.before : undefined;
    if (append && append !== opening.append && append.after === observed &&
        (append.before === opening.draft || append.before === priorOrigin)) {
        const merged = rebaseParagraphAppend({ before: opening.draft, after: observed }, confirmed);
        if (merged !== undefined) return { kind: 'publish', text: merged };
    }
    // An exact extension at a paragraph boundary keeps the whole opening and its own new
    // words. Everything else may replace the same words and needs an explicit choice.
    if (opening.draft === opening.markdown && opening.markdown !== '' && observed.startsWith(opening.markdown + '\n\n')) {
        return { kind: 'publish', text: confirmed + observed.slice(opening.markdown.length) };
    }
    return { kind: 'compare', text: confirmed };
}
