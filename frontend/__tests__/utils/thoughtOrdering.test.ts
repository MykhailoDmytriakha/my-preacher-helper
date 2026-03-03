import {
    normalizeStructure,
    resolveSectionFromOutline,
    resolveSectionFromTags,
    resolveSectionForNewThought,
    findThoughtSectionInStructure,
    canonicalizeStructure,
    getPreachOrderedThoughtsBySection,
    getPreachOrderedThoughts,
    getThoughtsForOutlinePoint,
    insertThoughtIdInStructure,
    replaceThoughtIdInStructure,
    removeThoughtIdFromStructure,
} from '@/utils/thoughtOrdering';
import type { Sermon, Thought } from '@/models/models';

const buildThought = (overrides: Partial<Thought> = {}): Thought => ({
    id: 't1',
    text: 'Thought',
    date: new Date('2024-01-01T10:00:00Z').toISOString(),
    tags: [],
    ...overrides,
} as Thought);

const buildSermon = (overrides: Partial<Sermon> = {}): Pick<Sermon, 'thoughts' | 'structure' | 'thoughtsBySection' | 'outline'> => ({
    thoughts: [],
    outline: { introduction: [], main: [], conclusion: [] },
    structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
    ...overrides,
});

describe('thoughtOrdering', () => {
    describe('normalizeStructure', () => {
        it('handles undefined/null safely', () => {
            const empty = { introduction: [], main: [], conclusion: [], ambiguous: [] };
            expect(normalizeStructure(undefined)).toEqual(empty);
            expect(normalizeStructure(null)).toEqual(empty);
        });

        it('parses JSON string if provided', () => {
            const parsed = normalizeStructure('{"introduction":["t1"]}');
            expect(parsed.introduction).toEqual(['t1']);
            expect(parsed.main).toEqual([]);
        });

        it('dedupes and filters falsy values', () => {
            const parsed = normalizeStructure({
                introduction: ['t1', 't2', 't1', null as any],
                main: [],
                conclusion: [],
                ambiguous: []
            });
            expect(parsed.introduction).toEqual(['t1', 't2']);
        });
    });

    describe('resolveSectionFromOutline', () => {
        it('returns null if no outlinePointId or no outline', () => {
            expect(resolveSectionFromOutline(null, 'p1')).toBeNull();
            expect(resolveSectionFromOutline(buildSermon(), undefined)).toBeNull();
        });

        it('resolves correct section', () => {
            const sermon = buildSermon({
                outline: {
                    introduction: [{ id: 'intro1', text: 'i' }],
                    main: [{ id: 'main1', text: 'm' }],
                    conclusion: []
                }
            });
            expect(resolveSectionFromOutline(sermon, 'intro1')).toBe('introduction');
            expect(resolveSectionFromOutline(sermon, 'main1')).toBe('main');
            expect(resolveSectionFromOutline(sermon, 'unknown')).toBeNull();
        });
    });

    describe('resolveSectionFromTags', () => {
        it('returns null if tags are empty or no distinct structural tags', () => {
            expect(resolveSectionFromTags(undefined)).toBeNull();
            expect(resolveSectionFromTags([])).toBeNull();
            expect(resolveSectionFromTags(['random'])).toBeNull(); // not a structural tag
            expect(resolveSectionFromTags(['intro', 'main'])).toBeNull(); // mixed tags = null
        });

        it('resolves correct section from valid tags', () => {
            expect(resolveSectionFromTags(['intro'])).toBe('introduction');
            expect(resolveSectionFromTags(['mainPart'])).toBe('main');
            expect(resolveSectionFromTags(['conclusion'])).toBe('conclusion');
        });
    });

    describe('resolveSectionForNewThought', () => {
        it('prefers outline section over tags', () => {
            const sermon = buildSermon({
                outline: { introduction: [{ id: 'p1', text: '' }], main: [], conclusion: [] }
            });
            expect(resolveSectionForNewThought({ sermon, outlinePointId: 'p1', tags: ['main'] })).toBe('introduction');
        });

        it('falls back to tags or ambiguous', () => {
            expect(resolveSectionForNewThought({ sermon: null, tags: ['main'] })).toBe('main');
            expect(resolveSectionForNewThought({ sermon: null, tags: [] })).toBe('ambiguous');
        });
    });

    describe('findThoughtSectionInStructure', () => {
        it('finds section or returns null', () => {
            const structure = { introduction: [], main: ['t1'], conclusion: [], ambiguous: [] };
            expect(findThoughtSectionInStructure(structure, 't1')).toBe('main');
            expect(findThoughtSectionInStructure(structure, 't2')).toBeNull();
        });
    });

    describe('canonicalizeStructure', () => {
        it('reorders and preserves items based on outline, dates, and current structure', () => {
            const sermon = buildSermon({
                thoughts: [
                    buildThought({ id: 't1', date: '2024-01-01', outlinePointId: 'p2' }),
                    buildThought({ id: 't2', date: '2024-01-02', outlinePointId: 'p1' }),
                    buildThought({ id: 't3', date: '2024-01-03' }),
                    buildThought({ id: 't4', date: 'invalid' }),
                ],
                outline: {
                    introduction: [],
                    main: [{ id: 'p1', text: '' }, { id: 'p2', text: '' }],
                    conclusion: []
                },
                structure: {
                    introduction: ['t3'],
                    main: ['t1', 't2', 't4'],
                    conclusion: [],
                    ambiguous: []
                }
            });

            const can = canonicalizeStructure(sermon);
            // t2 belongs to p1, t1 belongs to p2. Since p1 comes before p2 in main, t2 should precede t1.
            expect(can.main).toEqual(['t2', 't1', 't4']);
            expect(can.introduction).toEqual(['t3']);
        });
    });

    describe('getPreachOrderedThoughtsBySection', () => {
        it('returns ordered thoughts without orphans if includeOrphans is false', () => {
            const t1 = buildThought({ id: 't1' });
            const t2 = buildThought({ id: 't2' });
            const sermon = buildSermon({
                thoughts: [t1, t2],
                structure: { introduction: ['t2'], main: [], conclusion: [], ambiguous: [] } // t1 is orphan in intro
            });
            // with orphans
            expect(getPreachOrderedThoughtsBySection(sermon, 'introduction')).toHaveLength(1); // wait default is true but let's see. t1 is not assigned to any section so it's ambiguous orphan
            expect(getPreachOrderedThoughtsBySection(sermon, 'introduction', { includeOrphans: false })).toHaveLength(1);
        });

        it('includes outline orphans mapped to section', () => {
            const t1 = buildThought({ id: 't1', outlinePointId: 'p1' });
            const sermon = buildSermon({
                thoughts: [t1],
                outline: { main: [{ id: 'p1', text: '' }], introduction: [], conclusion: [] },
                structure: { introduction: [], main: [], conclusion: [], ambiguous: [] }
            });
            const res = getPreachOrderedThoughtsBySection(sermon, 'main');
            expect(res).toHaveLength(1);
            expect(res[0].id).toBe('t1');
        });
    });

    describe('getPreachOrderedThoughts', () => {
        it('assembles all sections sequentially', () => {
            const t1 = buildThought({ id: 't1' });
            const t2 = buildThought({ id: 't2' });
            const sermon = buildSermon({
                thoughts: [t1, t2],
                structure: { introduction: ['t1'], main: [], conclusion: [], ambiguous: ['t2'] }
            });
            const all = getPreachOrderedThoughts(sermon);
            expect(all).toHaveLength(2);
            expect(all[0].id).toBe('t1');
            expect(all[1].id).toBe('t2');
        });
    });

    describe('getThoughtsForOutlinePoint', () => {
        it('returns ordered thoughts specific to an outline point', () => {
            const sermon = buildSermon({
                thoughts: [
                    buildThought({ id: 't1', outlinePointId: 'p1' }),
                    buildThought({ id: 't2', outlinePointId: 'p2' }),
                ],
                outline: { main: [{ id: 'p1', text: '' }, { id: 'p2', text: '' }], introduction: [], conclusion: [] },
            });
            const res = getThoughtsForOutlinePoint(sermon, 'p1');
            expect(res).toHaveLength(1);
            expect(res[0].id).toBe('t1');
        });
    });

    describe('Structure manipulation', () => {
        const startStructure = { introduction: [], main: ['t1'], conclusion: [], ambiguous: [] };

        it('insertThoughtIdInStructure removes from old section and appends if no target index', () => {
            const s = insertThoughtIdInStructure({
                structure: startStructure, section: 'introduction', thoughtId: 't1'
            });
            expect(s.introduction).toEqual(['t1']);
            expect(s.main).toEqual([]);
        });

        it('insertThoughtIdInStructure inserts after same outline point group if hints given', () => {
            const thoughts = [
                buildThought({ id: 't1', outlinePointId: 'p1' }),
                buildThought({ id: 't2', outlinePointId: 'p1' }),
            ];
            const thoughtsById = new Map(thoughts.map(t => [t.id, t]));
            const s = insertThoughtIdInStructure({
                structure: { introduction: [], main: ['t1', 't3'], conclusion: [], ambiguous: [] },
                section: 'main',
                thoughtId: 't2',
                outlinePointId: 'p1',
                thoughtsById
            });
            // 't1' is in 'main' and has 'p1'. new 't2' has 'p1'. Should insert after 't1'.
            expect(s.main).toEqual(['t1', 't2', 't3']);
        });

        it('replaceThoughtIdInStructure preserves order', () => {
            const s = replaceThoughtIdInStructure({
                structure: startStructure, fromThoughtId: 't1', toThoughtId: 't2'
            });
            expect(s.main).toEqual(['t2']);
        });

        it('removeThoughtIdFromStructure removes completely', () => {
            const s = removeThoughtIdFromStructure(startStructure, 't1');
            expect(s.main).toEqual([]);
        });
    });
});
