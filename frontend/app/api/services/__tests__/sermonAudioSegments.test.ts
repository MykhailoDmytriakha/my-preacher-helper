/**
 * Tests the sermon → narratable-segment split.
 *
 * The split runs over the section's VISUAL-ORDER thoughts and cuts a new segment on every
 * (point, sub-point) change, so:
 *  - audio order always matches the Structure page (guaranteed by construction),
 *  - each sub-point becomes its own segment (→ its own bridge),
 *  - a point's direct thoughts resuming after a sub-point are a `continuation` (no bridge,
 *    so the point isn't re-announced).
 *
 * Section/outline lookups are mocked (SECTION_CONFIG stays real via requireActual).
 */

const mockGetOutlinePoints = jest.fn();
const mockGetThoughts = jest.fn();

jest.mock('@/api/services/sermonTextService', () => {
    const actual = jest.requireActual('@/api/services/sermonTextService');
    return {
        __esModule: true,
        ...actual,
        getSectionOutlinePoints: (...args: unknown[]) => mockGetOutlinePoints(...args),
        getSectionThoughtsInVisualOrder: (...args: unknown[]) => mockGetThoughts(...args),
    };
});

import { buildGenerationSegments } from '@/api/services/sermonAudioSegments';

import type { Sermon, Thought } from '@/models/models';

const sermon = { id: 's', title: 'T', verse: 'V' } as Sermon;

const th = (id: string, outlinePointId: string | null, subPointId: string | null = null): Thought =>
    ({ id, text: `thought ${id}`, outlinePointId, subPointId } as Thought);

const shape = (segs: ReturnType<typeof buildGenerationSegments>) =>
    segs.map(s => ({ id: s.id, level: s.level, title: s.title, thoughts: s.thoughts.map(t => t.id) }));

beforeEach(() => {
    mockGetOutlinePoints.mockReset();
    mockGetThoughts.mockReset();
});

describe('buildGenerationSegments — sub-point splitting (visual order preserved)', () => {
    it('cuts a segment per sub-point while keeping the point + sub-points in visual order', () => {
        const points = [
            { id: 'p1', text: 'Point one', subPoints: [{ id: 'sa', text: 'Sub A', position: 1 }, { id: 'sb', text: 'Sub B', position: 2 }] },
            { id: 'p2', text: 'Point two', subPoints: [] },
        ];
        // Visual order: point-direct, then sub A (×2), then sub B, then point 2.
        const thoughts = [th('t1', 'p1'), th('t2', 'p1', 'sa'), th('t3', 'p1', 'sa'), th('t4', 'p1', 'sb'), th('t5', 'p2')];
        mockGetOutlinePoints.mockImplementation((_s: Sermon, sec: string) => (sec === 'mainPart' ? points : []));
        mockGetThoughts.mockImplementation((_s: Sermon, sec: string) => (sec === 'mainPart' ? thoughts : []));

        expect(shape(buildGenerationSegments(sermon, ['mainPart']))).toEqual([
            { id: 'p1', level: 'point',    title: 'Point one', thoughts: ['t1'] },
            { id: 'sa', level: 'subpoint', title: 'Sub A',     thoughts: ['t2', 't3'] },
            { id: 'sb', level: 'subpoint', title: 'Sub B',     thoughts: ['t4'] },
            { id: 'p2', level: 'point',    title: 'Point two', thoughts: ['t5'] },
        ]);
    });

    it('marks direct thoughts resuming AFTER a sub-point as a continuation (order preserved, not re-announced)', () => {
        const points = [{ id: 'p1', text: 'Point one', subPoints: [{ id: 'sa', text: 'Sub A', position: 1 }] }];
        // Visual order interleaves: direct → sub → direct.
        const thoughts = [th('before', 'p1'), th('sub', 'p1', 'sa'), th('after', 'p1')];
        mockGetOutlinePoints.mockImplementation((_s: Sermon, sec: string) => (sec === 'mainPart' ? points : []));
        mockGetThoughts.mockImplementation((_s: Sermon, sec: string) => (sec === 'mainPart' ? thoughts : []));

        const segs = buildGenerationSegments(sermon, ['mainPart']);
        // Order stays before → sub → after; the trailing direct run is a continuation.
        expect(segs.map(s => s.thoughts.map(t => t.id))).toEqual([['before'], ['sub'], ['after']]);
        expect(segs.map(s => s.level)).toEqual(['point', 'subpoint', 'continuation']);
        expect(segs[2].id).not.toBe('p1'); // distinct id so it never picks up the point's bridge
    });

    it('treats a stray subPointId (no matching sub-point) as direct point content', () => {
        const points = [{ id: 'p1', text: 'P1', subPoints: [] }];
        mockGetOutlinePoints.mockImplementation((_s: Sermon, sec: string) => (sec === 'mainPart' ? points : []));
        mockGetThoughts.mockImplementation((_s: Sermon, sec: string) => (sec === 'mainPart' ? [th('t1', 'p1', 'ghost')] : []));

        expect(shape(buildGenerationSegments(sermon, ['mainPart']))).toEqual([
            { id: 'p1', level: 'point', title: 'P1', thoughts: ['t1'] },
        ]);
    });

    it('with no outline points, the whole section is one point-level segment', () => {
        mockGetOutlinePoints.mockReturnValue([]);
        mockGetThoughts.mockImplementation((_s: Sermon, sec: string) => (sec === 'introduction' ? [th('t1', null)] : []));

        const segs = buildGenerationSegments(sermon, ['introduction']);
        expect(segs).toHaveLength(1);
        expect(segs[0]).toMatchObject({ section: 'introduction', level: 'point', thoughts: [{ id: 't1' }] });
    });

    it('collects thoughts not assigned to any point as an "Additional" segment', () => {
        const points = [{ id: 'p1', text: 'P1', subPoints: [] }];
        mockGetOutlinePoints.mockImplementation((_s: Sermon, sec: string) => (sec === 'mainPart' ? points : []));
        mockGetThoughts.mockImplementation((_s: Sermon, sec: string) => (sec === 'mainPart' ? [th('t1', 'p1'), th('t2', null)] : []));

        const orphan = buildGenerationSegments(sermon, ['mainPart']).find(s => s.id === 'mainPart-orphans');
        expect(orphan).toMatchObject({ level: 'point', thoughts: [{ id: 't2' }] });
    });
});
