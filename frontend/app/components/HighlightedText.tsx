'use client';

import React, { memo, useMemo } from 'react';
import { HIGHLIGHT_COLORS } from '@/utils/themeColors';

interface HighlightedTextProps {
    /** The text content to search within */
    text: string;
    /** The search query to highlight */
    searchQuery: string;
    /** Custom class for the highlight span (default: yellow background) */
    highlightClassName?: string;
}

/**
 * HighlightedText - Highlights all occurrences of a search query within text.
 * 
 * Works like Chrome's Ctrl+F find functionality:
 * - Case-insensitive matching
 * - Highlights all occurrences
 * - Supports multi-word queries (AND search) by highlighting each token
 * - Yellow background by default
 * 
 * @example
 * <HighlightedText text="The Bible teaches us..." searchQuery="bible" />
 */
function HighlightedText({
    text,
    searchQuery,
    highlightClassName = `${HIGHLIGHT_COLORS.bg} ${HIGHLIGHT_COLORS.darkBg} ${HIGHLIGHT_COLORS.text} ${HIGHLIGHT_COLORS.ring} ${HIGHLIGHT_COLORS.weight} rounded px-0.5`,
}: HighlightedTextProps) {
    const parts = useMemo(() => {
        // If no query or empty text, return original text
        const tokens = searchQuery?.split(/\s+/).filter(Boolean) || [];
        if (tokens.length === 0 || !text) {
            return [{ text, highlighted: false }];
        }

        // Escape special regex characters in each token
        const escapedTokens = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

        // Create case-insensitive regex
        const regex = new RegExp(`(${escapedTokens.join('|')})`, 'gi');

        const tokenSet = new Set(tokens.map((token) => token.toLowerCase()));

        // Split text by the query, keeping the matched parts
        const splitParts = text.split(regex);

        return splitParts.map((part) => ({
            text: part,
            highlighted: tokenSet.has(part.toLowerCase()),
        }));
    }, [text, searchQuery]);

    // If nothing to highlight, return plain text
    if (parts.length === 1 && !parts[0].highlighted) {
        return <>{text}</>;
    }

    return (
        <>
            {parts.map((part, index) =>
                part.highlighted ? (
                    <mark
                        key={index}
                        className={highlightClassName}
                    >
                        {part.text}
                    </mark>
                ) : (
                    <React.Fragment key={index}>{part.text}</React.Fragment>
                )
            )}
        </>
    );
}

export default memo(HighlightedText);
