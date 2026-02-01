import { Sermon, Thought } from '@/models/models';
import { getSortedThoughts } from '@/utils/sermonSorting';

describe('sermonSorting', () => {
    const mockThought = (id: string, text: string, tags: string[] = [], outlinePointId?: string): Thought => ({
        id,
        text,
        tags,
        outlinePointId,
        date: new Date().toISOString(),
    });

    const mockSermon: Partial<Sermon> = {
        thoughts: [
            mockThought('t1', 'Intro 1', ['introduction']),
            mockThought('t2', 'Intro 2', ['introduction']),
            mockThought('t3', 'Main 1', ['main']),
            mockThought('t4', 'Main 2', ['main']),
        ],
    };

    it('should sort by manual structure first', () => {
        const sermon = {
            ...mockSermon,
            structure: {
                introduction: ['t2', 't1'],
                main: [],
                conclusion: []
            }
        } as unknown as Sermon;

        const result = getSortedThoughts(sermon, 'introduction');
        expect(result[0].id).toBe('t2');
        expect(result[1].id).toBe('t1');
    });

    it('should sort by outline if no manual structure exists', () => {
        const sermon = {
            ...mockSermon,
            outline: {
                introduction: [{ id: 'p1', text: 'Point 1' }],
                main: [],
                conclusion: []
            },
            thoughts: [
                mockThought('t1', 'Tagged Intro', ['introduction']),
                mockThought('t2', 'Outline Intro', ['introduction'], 'p1'),
            ]
        } as unknown as Sermon;

        const result = getSortedThoughts(sermon, 'introduction');
        // Point 1 thoughts first, then orphans
        expect(result[0].id).toBe('t2');
        expect(result[1].id).toBe('t1');
    });

    it('should handle orphans sorted by date', () => {
        const now = new Date();
        const earlier = new Date(now.getTime() - 1000);

        const sermon = {
            thoughts: [
                { id: 't1', text: 'Later', tags: ['introduction'], date: now.toISOString() },
                { id: 't2', text: 'Earlier', tags: ['introduction'], date: earlier.toISOString() },
            ]
        } as unknown as Sermon;

        const result = getSortedThoughts(sermon, 'introduction');
        expect(result[0].id).toBe('t2');
        expect(result[1].id).toBe('t1');
    });

    it('should handle ambiguous section', () => {
        const sermon = {
            thoughts: [
                mockThought('t1', 'Main', ['main']),
                mockThought('t2', 'Ambiguous', []), // No structure tags
            ]
        } as unknown as Sermon;

        const result = getSortedThoughts(sermon, 'ambiguous');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('t2');
    });
});
