import { matchesSermonQuery, tokenizeQuery, getThoughtSnippets } from '../../app/utils/sermonSearch';
import { Sermon } from '../../app/models/models';

describe('sermonSearch', () => {
    const mockSermon: Sermon = {
        id: 'sermon1',
        title: 'Title of the great sermon',
        verse: 'John 3:16',
        date: '2023-01-01',
        userId: 'user1',
        thoughts: [
            {
                id: 't1',
                text: 'First thought text about faith',
                tags: ['intro', 'faith'],
                date: '2023-01-01T10:00:00Z'
            },
            {
                id: 't2',
                text: 'Second thought text about hope',
                tags: ['main'],
                date: '2023-01-01T11:00:00Z'
            }
        ]
    };

    const mockT = (key: string) => {
        const translations: Record<string, string> = {
            'tags.introduction': 'Вступление',
            'tags.mainPart': 'Основная часть',
            'tags.conclusion': 'Заключение'
        };
        return translations[key] || key;
    };

    describe('tokenizeQuery', () => {
        it('splits query by whitespace and converts to lower case', () => {
            expect(tokenizeQuery('Hello   World')).toEqual(['hello', 'world']);
        });

        it('filters out empty tokens', () => {
            expect(tokenizeQuery('  ')).toEqual([]);
        });
    });

    describe('matchesSermonQuery', () => {
        it('matches by canonical tag ID', () => {
            const tokens = tokenizeQuery('intro');
            expect(matchesSermonQuery(mockSermon, tokens)).toBe(true);
        });

        it('matches by localized name when "t" function is provided', () => {
            const tokens = tokenizeQuery('вступление');
            expect(matchesSermonQuery(mockSermon, tokens, undefined, mockT)).toBe(true);
        });

        it('does not match by localized name when "t" function is missing', () => {
            const tokens = tokenizeQuery('вступление');
            expect(matchesSermonQuery(mockSermon, tokens)).toBe(false);
        });

        it('matches case-insensitively for localized names', () => {
            const tokens = tokenizeQuery('ВСТУПЛЕНИЕ');
            expect(matchesSermonQuery(mockSermon, tokens, undefined, mockT)).toBe(true);
        });

        it('returns true if tokens are empty', () => {
            expect(matchesSermonQuery(mockSermon, [])).toBe(true);
        });

        it('matches in title or verse', () => {
            expect(matchesSermonQuery(mockSermon, ['great', 'sermon'])).toBe(true);
            expect(matchesSermonQuery(mockSermon, ['john', '3:16'])).toBe(true);
        });

        it('does not match in title/verse if disabled in options', () => {
            expect(matchesSermonQuery(mockSermon, ['great'], { searchInTitleVerse: false })).toBe(false);
        });

        it('matches in thought texts', () => {
            expect(matchesSermonQuery(mockSermon, ['first', 'faith'])).toBe(true);
        });

        it('does not match in thought texts if disabled in options', () => {
            expect(matchesSermonQuery(mockSermon, ['first'], { searchInThoughts: false })).toBe(false);
        });

        it('returns false if nothing matches', () => {
            expect(matchesSermonQuery(mockSermon, ['unmatched'])).toBe(false);
        });

        it('handles sermons with empty thoughts safely', () => {
            const emptySermon: Sermon = { ...mockSermon, thoughts: [] };
            expect(matchesSermonQuery(emptySermon, ['faith'])).toBe(false);
        });
    });

    describe('getThoughtSnippets', () => {
        it('returns empty array if query is empty', () => {
            expect(getThoughtSnippets(mockSermon, '   ')).toEqual([]);
        });

        it('returns snippet wrapping matched thought text', () => {
            const snippets = getThoughtSnippets(mockSermon, 'faith');
            expect(snippets).toHaveLength(1);
            expect(snippets[0].text).toContain('First thought text about faith');
            expect(snippets[0].tags).toEqual(['faith']); // text matched, and 'faith' tag matched the query token
        });

        it('returns tags and truncated fallback text if only tags matched', () => {
            // contextChars=5 => maxLength=10. The text is 30 chars, so it will truncate and append ellipsis.
            const snippets = getThoughtSnippets(mockSermon, 'вступление', Infinity, 5, undefined, mockT);
            expect(snippets).toHaveLength(1);
            expect(snippets[0].tags).toEqual(['intro']);
            expect(snippets[0].text).toBe('First thou…');
        });

        it('limits number of snippets based on maxSnippets', () => {
            const snippets = getThoughtSnippets(mockSermon, 'thought', 1);
            expect(snippets).toHaveLength(1); // 'thought' is in both t1 and t2, but capped at 1
            expect(snippets[0].text).toContain('First thought');
        });

        it('collapses formatting and linebreaks in snippet', () => {
            const sermonWithBreaks: Sermon = {
                ...mockSermon,
                thoughts: [{
                    id: 't3',
                    text: 'Long\ntext\r\nwith\nbreaks',
                    date: '2023-01-01T10:00:00Z',
                    tags: []
                }]
            };
            const snippets = getThoughtSnippets(sermonWithBreaks, 'long');
            expect(snippets).toHaveLength(1);
            expect(snippets[0].text).toMatch(/Longtextwithbreaks/); // Due to replace logic joining letters across newlines
        });

        it('handles null/undefined fields safely', () => {
            const sketchySermon: Sermon = {
                id: 's', title: 's', date: 's', userId: 's', verse: undefined as unknown as string,
                thoughts: [
                    { id: '1', date: 's', text: undefined as unknown as string, tags: undefined as unknown as string[] }
                ]
            };
            // Nothing should fail and nothing should match "foo"
            expect(getThoughtSnippets(sketchySermon, 'foo')).toEqual([]);
        });
    });
});
