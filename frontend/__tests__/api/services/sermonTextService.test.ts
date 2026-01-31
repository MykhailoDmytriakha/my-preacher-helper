import { Sermon, Thought } from '@/models/models';
import { extractSermonText, getSectionThoughts } from '@/api/services/sermonTextService';

describe('sermonTextService', () => {
    const mockThought = (id: string, text: string, tags: string[] = [], outlinePointId?: string): Thought => ({
        id,
        text,
        tags,
        outlinePointId,
        date: new Date().toISOString(),
    });

    const mockSermon: Partial<Sermon> = {
        title: 'Test Sermon',
        verse: 'John 3:16',
        thoughts: [
            mockThought('t1', 'Intro Thought', ['introduction']),
            mockThought('t2', 'Main Thought', ['main']),
            mockThought('t3', 'Conclusion Thought', ['conclusion']),
        ],
    };

    describe('getSectionThoughts', () => {
        it('should use Tags (fallback) when no outline or structure exists', () => {
            const result = getSectionThoughts(mockSermon as Sermon, 'introduction');
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('t1');
        });

        it('should use Structure (manual order) if it exists', () => {
            const sermonWithStructure = {
                ...mockSermon,
                structure: {
                    introduction: ['t1'],
                    main: ['t2'],
                    conclusion: ['t3']
                }
            };
            const result = getSectionThoughts(sermonWithStructure as unknown as Sermon, 'mainPart');
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('t2');
        });

        it('should use Outline (highest priority) if it exists', () => {
            const sermonWithOutline = {
                ...mockSermon,
                outline: {
                    introduction: [{ id: 'p1', text: 'Point 1' }],
                    mainPart: [],
                    conclusion: []
                },
                thoughts: [
                    mockThought('t1', 'Tagged Thought', ['introduction']),
                    mockThought('t2', 'Outline Thought', ['introduction', 'main'], 'p1'),
                ]
            };
            const result = getSectionThoughts(sermonWithOutline as unknown as Sermon, 'introduction');
            // Should have Outline thought first, then tagged but unassigned
            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('t2');
            expect(result[1].id).toBe('t1');
        });
    });

    describe('extractSermonText', () => {
        it('should extract full sermon text when no target section is specified', () => {
            const text = extractSermonText(mockSermon as Sermon);
            expect(text).toContain('Проповедь: Test Sermon');
            expect(text).toContain('Текст Писания: John 3:16');
            expect(text).toContain('Вступление:');
            expect(text).toContain('- Intro Thought');
            expect(text).toContain('Основная часть:');
            expect(text).toContain('- Main Thought');
            expect(text).toContain('Заключение:');
            expect(text).toContain('- Conclusion Thought');
        });

        it('should extract only specific section text when target section is specified', () => {
            const text = extractSermonText(mockSermon as Sermon, 'mainPart');
            expect(text).not.toContain('Проповедь:');
            expect(text).not.toContain('Вступление:');
            expect(text).toContain('Основная часть:');
            expect(text).toContain('- Main Thought');
        });

        it('should include title/verse for introduction target section', () => {
            const text = extractSermonText(mockSermon as Sermon, 'introduction');
            expect(text).toContain('Проповедь: Test Sermon');
            expect(text).toContain('Вступление:');
        });
    });
});
