/**
 * Extracts contextual snippets from content based on a search query.
 * Uses character-based windowing to handle long paragraphs correctly.
 * 
 * @param content The full text content to search within
 * @param query The search query to find
 * @param contextChars Number of characters to include before and after user match (approximate)
 * @returns Array of snippets
 */
export function extractSearchSnippets(
    content: string,
    query: string,
    contextChars: number = 100
): string[] {
    if (!content || !query) return [content];

    const queryLen = query.length;

    // Use RegExp for finding matches to avoid index drift (if toLowerCase changes length)
    // Escape special regex characters in query
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedQuery, 'gi');

    // Find all match indices on the ORIGINAL content
    const matchIndices: number[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        matchIndices.push(match.index);
    }

    if (matchIndices.length === 0) return [content];

    // Calculate ranges (start/end indices)
    const ranges: { start: number; end: number }[] = [];

    matchIndices.forEach(index => {
        // Determine draft boundaries
        let start = Math.max(0, index - contextChars);
        let end = Math.min(content.length, index + queryLen + contextChars);

        // Expand/Shrink to nearest word boundary (space) to avoid cutting words
        // Move start left until space or 0
        while (start > 0 && /\S/.test(content[start])) {
            start--;
        }
        // If we hit a space at start, move forward one char to exclude the space itself (cleaner)
        if (start > 0) start++;

        // Move end right until space or length
        while (end < content.length && /\S/.test(content[end])) {
            end++;
        }

        // Merge logic
        const lastRange = ranges[ranges.length - 1];

        // Check overlap: if current start is inside or close to last range
        // Allow small gap (e.g. 20 chars) to merge nearby snippets
        if (lastRange && start <= lastRange.end + 20) {
            lastRange.end = Math.max(lastRange.end, end);
        } else {
            ranges.push({ start, end });
        }
    });

    // Extract text
    return ranges.map(range => {
        // Add visual cues if text was truncated
        // (Though usually we handle this in UI with dividers, knowing it's a snippet implies truncation)
        return content.slice(range.start, range.end).trim();
    });
}
