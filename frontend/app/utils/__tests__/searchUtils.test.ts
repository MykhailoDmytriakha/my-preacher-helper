import { extractSearchSnippets } from '../searchUtils';

describe('extractSearchSnippets (Character Based)', () => {
    const longParagraph = `This is a very long paragraph that simulates a real note content without line breaks.It continues for quite a while to test the character windowing logic.We want to find the word TARGET inside this mess of text.It should extract context around it perfectly.Here is another TARGET for overlap testing.And finally one more TARGET way at the end.`;

    it('should extract context around a match in a long paragraph', () => {
        // Search for first TARGET
        // "...want to find the word TARGET inside this mess..."
        const snippets = extractSearchSnippets(longParagraph, 'TARGET', 20);
        expect(snippets.length).toBeGreaterThanOrEqual(2); // Should be 2 or 3 depending on exact spacing
        // Let's check logic:
        // 1. "...find the word TARGET inside this..."
        // 2. "...is another TARGET for overlap..."
        // 3. "...one more TARGET way at the..."
        // They are separated by:
        // 1->2: " mess of text. It should extract context around it perfectly. Here " (approx 70 chars)
        // 2->3: " testing. And finally " (approx 20 chars)

        // With 20 chars context:
        // Merge threshold is "start <= lastRange.end + 20"
        // So if gap is small, they merge.

        // Gap 1->2 is ~70 chars -> Likely distinctive.
        // Gap 2->3 is ~25 chars -> Might merge or distinct depending on boundaries.

        expect(snippets[0]).toContain('TARGET');
    });

    it('should snap to word boundaries', () => {
        const text = "The quick brown fox jumps over the lazy dog";
        // Search for "brown" with small context (2 chars)
        // Without snap: "k brown f"
        // With snap: "quick brown fox" (expands to nearest space)
        const snippets = extractSearchSnippets(text, 'brown', 2);
        expect(snippets[0]).toContain('quick brown fox');
        expect(snippets[0]).not.toBe('k brown f');
    });

    it('should merge nearby matches', () => {
        const text = "word1 ... small gap ... word1";
        // Gap is small
        const snippets = extractSearchSnippets(text, 'word1', 10);
        expect(snippets).toHaveLength(1);
        expect(snippets[0]).toBe(text);
    });

    it('should separate distant matches', () => {
        // Use spaces to ensure word boundary logic doesn't treat the gap as one giant word
        const text = `word1 ${'a '.repeat(100)} word1`;
        const snippets = extractSearchSnippets(text, 'word1', 10);
        expect(snippets).toHaveLength(2);
    });

    it('should handle match at exact start', () => {
        const text = "Start matches here.";
        const snippets = extractSearchSnippets(text, 'Start', 10);
        expect(snippets[0]).toMatch(/^Start matches/); // Should not have leading space or cut chars
    });
});
