import { Sermon, Thought } from '@/models/models';
import {
    extractSermonContent,
    extractSectionContent,
} from '@/api/clients/openAIHelpers';

describe('openAIHelpers', () => {
    // Helper to create a basic sermon structure
    const createSermon = (overrides: Partial<Sermon> = {}): Sermon => ({
        id: 'test-sermon-1',
        title: 'Test Sermon',
        userId: 'user-1',
        date: new Date().toISOString(),
        verse: 'John 3:16',
        thoughts: [],
        ...overrides,
    });

    // Helper to create a thought
    const createThought = (id: string, text: string, tags: string[] = []): Thought => ({
        id,
        text,
        tags,
        date: new Date().toISOString(),
    });

    describe('extractSermonContent', () => {
        describe('unstructured sermons', () => {
            it('should extract all thoughts when there is no structure', () => {
                const sermon = createSermon({
                    thoughts: [
                        createThought('1', 'First thought with meaningful content'),
                        createThought('2', 'Second thought with meaningful content'),
                    ],
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('First thought with meaningful content');
                expect(result).toContain('Second thought with meaningful content');
            });

            it('should filter out very short thoughts (<=10 chars)', () => {
                const sermon = createSermon({
                    thoughts: [
                        createThought('1', 'Short'),
                        createThought('2', 'This is a meaningful thought with enough content'),
                    ],
                });

                const result = extractSermonContent(sermon);

                expect(result).not.toContain('Short');
                expect(result).toContain('This is a meaningful thought with enough content');
            });

            it('should include tags in the output for unstructured thoughts', () => {
                const sermon = createSermon({
                    thoughts: [
                        createThought('1', 'Thought with tags', ['introduction', 'theology']),
                    ],
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('[introduction, theology]');
                expect(result).toContain('Thought with tags');
            });

            it('should return fallback message when sermon has minimal content', () => {
                const sermon = createSermon({
                    thoughts: [createThought('1', 'Hi')],
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('Test Sermon');
                expect(result).toContain('John 3:16');
                expect(result).toContain('early stages of development');
            });
        });

        describe('structured sermons', () => {
            it('should extract introduction thoughts by UUID', () => {
                const thoughts = [
                    createThought('10000000-0000-0000-0000-000000000001', 'Introduction thought one'),
                    createThought('10000000-0000-0000-0000-000000000002', 'Introduction thought two'),
                    createThought('20000000-0000-0000-0000-000000000001', 'Main point one'),
                ];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: ['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002'],
                        main: ['20000000-0000-0000-0000-000000000001'],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('Introduction:');
                expect(result).toContain('Introduction thought one');
                expect(result).toContain('Introduction thought two');
            });

            it('should extract main thoughts by UUID', () => {
                const thoughts = [
                    createThought('20000000-0000-0000-0000-000000000001', 'Main point one'),
                    createThought('20000000-0000-0000-0000-000000000002', 'Main point two'),
                ];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: [],
                        main: ['20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002'],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('Main Part:');
                expect(result).toContain('Main point one');
                expect(result).toContain('Main point two');
            });

            it('should extract conclusion thoughts by UUID', () => {
                const thoughts = [
                    createThought('30000000-0000-0000-0000-000000000001', 'Conclusion thought one'),
                    createThought('30000000-0000-0000-0000-000000000002', 'Conclusion thought two'),
                ];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: [],
                        main: [],
                        conclusion: ['30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'],
                        ambiguous: [],
                    },
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('Conclusion:');
                expect(result).toContain('Conclusion thought one');
                expect(result).toContain('Conclusion thought two');
            });

            it('should extract ambiguous thoughts by UUID', () => {
                const thoughts = [
                    createThought('40000000-0000-0000-0000-000000000001', 'Ambiguous thought one'),
                    createThought('40000000-0000-0000-0000-000000000002', 'Ambiguous thought two'),
                ];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: [],
                        main: [],
                        conclusion: [],
                        ambiguous: ['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002'],
                    },
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('Additional Thoughts:');
                expect(result).toContain('Ambiguous thought one');
                expect(result).toContain('Ambiguous thought two');
            });

            it('should handle text content directly (non-UUID)', () => {
                const sermon = createSermon({
                    thoughts: [],
                    structure: {
                        introduction: ['Direct text content one'],
                        main: ['Direct text content two'],
                        conclusion: ['Direct text content three'],
                        ambiguous: [],
                    },
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('Direct text content one');
                expect(result).toContain('Direct text content two');
                expect(result).toContain('Direct text content three');
            });

            it('should handle mixed UUID and text content', () => {
                const thoughts = [createThought('50000000-0000-0000-0000-000000000001', 'Thought from UUID')];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: ['50000000-0000-0000-0000-000000000001', 'Direct text content'],
                        main: [],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('Thought from UUID');
                expect(result).toContain('Direct text content');
            });

            it('should not duplicate thoughts used in multiple sections', () => {
                const thoughts = [createThought('60000000-0000-0000-0000-000000000001', 'Shared thought')];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: ['60000000-0000-0000-0000-000000000001'],
                        main: ['60000000-0000-0000-0000-000000000001'], // Same thought referenced again
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSermonContent(sermon);

                // Should appear only once
                const matches = result.match(/Shared thought/g);
                expect(matches).toHaveLength(1);
            });

            it('should fallback to tag-based filtering when UUIDs cannot be resolved', () => {
                const thoughts = [
                    createThought('1', 'Intro by tag', ['introduction']),
                    createThought('2', 'Main by tag', ['основная часть']),
                ];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: ['90000000-0000-0000-0000-000000000001'],
                        main: ['90000000-0000-0000-0000-000000000002'],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('Intro by tag');
                expect(result).toContain('Main by tag');
            });

            it('should use intro tag fallback (вступление, introduction, вступ)', () => {
                const thoughts = [
                    createThought('1', 'Intro RU', ['вступление']),
                    createThought('2', 'Intro EN', ['introduction']),
                    createThought('3', 'Intro Short', ['вступ']),
                ];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: ['90000000-0000-0000-0000-000000000004'],
                        main: [],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('Intro RU');
                expect(result).toContain('Intro EN');
                expect(result).toContain('Intro Short');
            });

            it('should use main tag fallback (основная часть, main, main part)', () => {
                const thoughts = [
                    createThought('1', 'Main RU', ['основная часть']),
                    createThought('2', 'Main EN', ['main']),
                    createThought('3', 'Main EN Long', ['main part']),
                ];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: [],
                        main: ['90000000-0000-0000-0000-000000000004'],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('Main RU');
                expect(result).toContain('Main EN');
                expect(result).toContain('Main EN Long');
            });

            it('should use conclusion tag fallback (заключение, conclusion, заключ)', () => {
                const thoughts = [
                    createThought('1', 'Conclusion RU', ['заключение']),
                    createThought('2', 'Conclusion EN', ['conclusion']),
                    createThought('3', 'Conclusion Short', ['заключ']),
                ];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: [],
                        main: [],
                        conclusion: ['90000000-0000-0000-0000-000000000004'],
                        ambiguous: [],
                    },
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('Conclusion RU');
                expect(result).toContain('Conclusion EN');
                expect(result).toContain('Conclusion Short');
            });
        });

        describe('edge cases', () => {
            it('should handle empty sermon with no thoughts', () => {
                const sermon = createSermon();

                const result = extractSermonContent(sermon);

                expect(result).toContain('early stages of development');
            });

            it('should handle sermon with structure but no thoughts array', () => {
                const sermon = createSermon({
                    thoughts: undefined,
                    structure: {
                        introduction: ['some-text'],
                        main: [],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('some-text');
            });

            it('should handle all sections being empty', () => {
                const sermon = createSermon({
                    structure: {
                        introduction: [],
                        main: [],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSermonContent(sermon);

                expect(result).toContain('early stages of development');
            });
        });
    });

    describe('extractSectionContent', () => {
        describe('parameter validation', () => {
            it('should throw error for invalid section', () => {
                const sermon = createSermon();

                expect(() => extractSectionContent(sermon, 'invalid')).toThrow(
                    'Invalid section: invalid'
                );
            });

            it('should accept "introduction" section', () => {
                const sermon = createSermon({
                    structure: {
                        introduction: ['Intro text'],
                        main: [],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                expect(() => extractSectionContent(sermon, 'introduction')).not.toThrow();
            });

            it('should accept "main" section', () => {
                const sermon = createSermon({
                    structure: {
                        introduction: [],
                        main: ['Main text'],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                expect(() => extractSectionContent(sermon, 'main')).not.toThrow();
            });

            it('should accept "conclusion" section', () => {
                const sermon = createSermon({
                    structure: {
                        introduction: [],
                        main: [],
                        conclusion: ['Conclusion text'],
                        ambiguous: [],
                    },
                });

                expect(() => extractSectionContent(sermon, 'conclusion')).not.toThrow();
            });

            it('should handle case-insensitive section names', () => {
                const sermon = createSermon({
                    structure: {
                        introduction: ['Test'],
                        main: [],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                expect(() => extractSectionContent(sermon, 'INTRODUCTION')).not.toThrow();
                expect(() => extractSectionContent(sermon, 'Introduction')).not.toThrow();
            });
        });

        describe('structured sermon extraction', () => {
            it('should extract only introduction section when requested', () => {
                const thoughts = [
                    createThought('10000000-0000-0000-0000-000000000001', 'Intro content'),
                    createThought('20000000-0000-0000-0000-000000000001', 'Main content'),
                    createThought('30000000-0000-0000-0000-000000000003', 'Conclusion content'),
                ];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: ['10000000-0000-0000-0000-000000000001'],
                        main: ['20000000-0000-0000-0000-000000000001'],
                        conclusion: ['30000000-0000-0000-0000-000000000003'],
                        ambiguous: [],
                    },
                });

                const result = extractSectionContent(sermon, 'introduction');

                expect(result).toContain('Introduction:');
                expect(result).toContain('Intro content');
                expect(result).not.toContain('Main content');
                expect(result).not.toContain('Conclusion content');
            });

            it('should extract only main section when requested', () => {
                const thoughts = [
                    createThought('10000000-0000-0000-0000-000000000001', 'Intro content'),
                    createThought('20000000-0000-0000-0000-000000000001', 'Main content'),
                    createThought('30000000-0000-0000-0000-000000000003', 'Conclusion content'),
                ];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: ['10000000-0000-0000-0000-000000000001'],
                        main: ['20000000-0000-0000-0000-000000000001'],
                        conclusion: ['30000000-0000-0000-0000-000000000003'],
                        ambiguous: [],
                    },
                });

                const result = extractSectionContent(sermon, 'main');

                expect(result).toContain('Main Part:');
                expect(result).toContain('Main content');
                expect(result).not.toContain('Intro content');
                expect(result).not.toContain('Conclusion content');
            });

            it('should extract only conclusion section when requested', () => {
                const thoughts = [
                    createThought('10000000-0000-0000-0000-000000000001', 'Intro content'),
                    createThought('20000000-0000-0000-0000-000000000001', 'Main content'),
                    createThought('30000000-0000-0000-0000-000000000003', 'Conclusion content'),
                ];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: ['10000000-0000-0000-0000-000000000001'],
                        main: ['20000000-0000-0000-0000-000000000001'],
                        conclusion: ['30000000-0000-0000-0000-000000000003'],
                        ambiguous: [],
                    },
                });

                const result = extractSectionContent(sermon, 'conclusion');

                expect(result).toContain('Conclusion:');
                expect(result).toContain('Conclusion content');
                expect(result).not.toContain('Intro content');
                expect(result).not.toContain('Main content');
            });

            it('should resolve UUIDs to thoughts', () => {
                const thoughts = [createThought('70000000-0000-0000-0000-000000000001', 'Content from UUID')];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: ['70000000-0000-0000-0000-000000000001'],
                        main: [],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSectionContent(sermon, 'introduction');

                expect(result).toContain('Content from UUID');
            });

            it('should handle direct text content', () => {
                const sermon = createSermon({
                    structure: {
                        introduction: ['Direct text here'],
                        main: [],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSectionContent(sermon, 'introduction');

                expect(result).toContain('Direct text here');
            });

            it('should fallback to tag-based filtering', () => {
                const thoughts = [createThought('1', 'Tagged intro', ['introduction'])];

                const sermon = createSermon({
                    thoughts,
                    structure: {
                        introduction: ['90000000-0000-0000-0000-000000000003'],
                        main: [],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSectionContent(sermon, 'introduction');

                expect(result).toContain('Tagged intro');
            });
        });

        describe('unstructured sermon extraction', () => {
            it('should filter by introduction tags when no structure', () => {
                const thoughts = [
                    createThought('1', 'Intro thought', ['introduction']),
                    createThought('2', 'Main thought', ['main']),
                ];

                const sermon = createSermon({ thoughts });

                const result = extractSectionContent(sermon, 'introduction');

                expect(result).toContain('Intro thought');
                expect(result).not.toContain('Main thought');
            });

            it('should filter by main tags when no structure', () => {
                const thoughts = [
                    createThought('1', 'Intro thought', ['introduction']),
                    createThought('2', 'Main thought', ['main']),
                ];

                const sermon = createSermon({ thoughts });

                const result = extractSectionContent(sermon, 'main');

                expect(result).toContain('Main thought');
                expect(result).not.toContain('Intro thought');
            });

            it('should filter by conclusion tags when no structure', () => {
                const thoughts = [
                    createThought('1', 'Main thought', ['main']),
                    createThought('2', 'Conclusion thought', ['conclusion']),
                ];

                const sermon = createSermon({ thoughts });

                const result = extractSectionContent(sermon, 'conclusion');

                expect(result).toContain('Conclusion thought');
                expect(result).not.toContain('Main thought');
            });

            it('should include tags in output for unstructured thoughts', () => {
                const thoughts = [
                    createThought('1', 'Intro with tags', ['introduction', 'greeting']),
                ];

                const sermon = createSermon({ thoughts });

                const result = extractSectionContent(sermon, 'introduction');

                expect(result).toContain('[introduction, greeting]');
                expect(result).toContain('Intro with tags');
            });

            it('should filter out very short thoughts (<= 10 chars)', () => {
                const thoughts = [
                    createThought('1', 'Hi', ['introduction']),
                    createThought('2', 'This is a meaningful introduction', ['introduction']),
                ];

                const sermon = createSermon({ thoughts });

                const result = extractSectionContent(sermon, 'introduction');

                expect(result).not.toContain('Hi');
                expect(result).toContain('This is a meaningful introduction');
            });
        });

        describe('fallback messages', () => {
            it('should show fallback message when section is empty', () => {
                const sermon = createSermon({
                    structure: {
                        introduction: [],
                        main: [],
                        conclusion: [],
                        ambiguous: [],
                    },
                });

                const result = extractSectionContent(sermon, 'introduction');

                expect(result).toContain('Test Sermon');
                expect(result).toContain('John 3:16');
                expect(result).toContain('early stages of development');
                expect(result).toContain('introduction section');
            });

            it('should show section-specific fallback message', () => {
                const sermon = createSermon();

                const introResult = extractSectionContent(sermon, 'introduction');
                const mainResult = extractSectionContent(sermon, 'main');
                const conclusionResult = extractSectionContent(sermon, 'conclusion');

                expect(introResult).toContain('introduction section');
                expect(mainResult).toContain('main section');
                expect(conclusionResult).toContain('conclusion section');
            });
        });

        describe('edge cases', () => {
            it('should handle sermon with no thoughts', () => {
                const sermon = createSermon({ thoughts: undefined });

                const result = extractSectionContent(sermon, 'introduction');

                expect(result).toContain('early stages of development');
            });

            it('should handle empty thoughts array', () => {
                const sermon = createSermon({ thoughts: [] });

                const result = extractSectionContent(sermon, 'main');

                expect(result).toContain('early stages of development');
            });
        });
    });
});
