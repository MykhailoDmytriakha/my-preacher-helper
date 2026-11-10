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
        const before = opening.draft;
        if (before === '' || observed.startsWith(before + '\n\n')) {
            const suffix = before === '' ? observed : observed.slice(before.length + 2);
            return { kind: 'publish', text: [confirmed, suffix].filter(Boolean).join('\n\n') };
        }
    }
    // An exact extension at a paragraph boundary keeps the whole opening and its own new
    // words. Everything else may replace the same words and needs an explicit choice.
    if (opening.draft === opening.markdown && opening.markdown !== '' && observed.startsWith(opening.markdown + '\n\n')) {
        return { kind: 'publish', text: confirmed + observed.slice(opening.markdown.length) };
    }
    return { kind: 'compare', text: confirmed };
}
