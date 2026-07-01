/**
 * Tests the narration-transition weaving — the exact ordered chunk list (and thus the
 * exact text, in order) that reaches the TTS engine.
 *
 * The generate route sends each chunk's `.text` to TTS in list order, so asserting the
 * flattened text sequence of `weaveTransitionChunks` == "what gets spoken, in order".
 */

import {
    weaveTransitionChunks,
    EMPTY_TRANSITIONS,
    type SegmentBody,
    type SermonTransitions,
} from '@/api/services/sermonTransitions';

import type { AudioChunk, SermonSection } from '@/types/audioGeneration.types';

function body(text: string, section: SermonSection): AudioChunk {
    return { text, sectionId: section, createdAt: 'now', index: 0 };
}

function seg(id: string, section: SermonSection, ...texts: string[]): SegmentBody {
    return { id, section, bodyChunks: texts.map(t => body(t, section)) };
}

/** The ordered text that would be voiced (this is exactly what each TTS request receives). */
const spokenText = (chunks: AudioChunk[]) => chunks.map(c => c.text);

describe('weaveTransitionChunks — the text that reaches TTS', () => {
    const segments: SegmentBody[] = [
        seg('intro-sec', 'introduction', 'Intro body'),
        seg('p1', 'mainPart', 'Point one body'),
        seg('p2', 'mainPart', 'Point two body'),
        seg('concl', 'conclusion', 'Conclusion body'),
    ];

    const transitions: SermonTransitions = {
        intro: 'Welcome to the sermon.',
        outro: 'Amen.',
        bridges: {
            'intro-sec': 'UNUSED first-segment bridge',
            p1: 'Now, our first point.',
            p2: 'Now, our second point.',
            concl: 'And finally, in closing.',
        },
    };

    it('weaves intro → body → bridge → body → … → outro in the exact spoken order', () => {
        const woven = weaveTransitionChunks(segments, transitions, 'T');

        expect(spokenText(woven)).toEqual([
            'Welcome to the sermon.',   // intro (global opening)
            'Intro body',
            'Now, our first point.',    // bridge into p1
            'Point one body',
            'Now, our second point.',   // bridge into p2
            'Point two body',
            'And finally, in closing.', // bridge into conclusion
            'Conclusion body',
            'Amen.',                    // outro
        ]);
    });

    it('does NOT emit a bridge before the first segment (the intro opens it)', () => {
        const woven = weaveTransitionChunks(segments, transitions, 'T');
        expect(spokenText(woven)).not.toContain('UNUSED first-segment bridge');
    });

    it('tags transition chunks with kind/role and body chunks as kind body', () => {
        const woven = weaveTransitionChunks(segments, transitions, 'T');

        const intro = woven[0];
        expect(intro).toMatchObject({ kind: 'transition', role: 'intro', text: 'Welcome to the sermon.' });

        const bridge = woven.find(c => c.text === 'Now, our first point.');
        expect(bridge).toMatchObject({ kind: 'transition', role: 'bridge', sectionId: 'mainPart' });

        const outro = woven[woven.length - 1];
        expect(outro).toMatchObject({ kind: 'transition', role: 'outro', sectionId: 'conclusion' });

        expect(woven.find(c => c.text === 'Point one body')).toMatchObject({ kind: 'body' });
    });

    it('omits the global intro/outro when their sections are out of scope (partial re-optimize)', () => {
        const mainOnly: SegmentBody[] = [seg('p1', 'mainPart', 'Point one body'), seg('p2', 'mainPart', 'Point two body')];
        const woven = weaveTransitionChunks(mainOnly, transitions, 'T', { includeIntro: false, includeOutro: false });

        expect(spokenText(woven)).toEqual([
            'Point one body',
            'Now, our second point.', // bridge still separates points 1→2
            'Point two body',
        ]);
        expect(woven.some(c => c.role === 'intro' || c.role === 'outro')).toBe(false);
    });

    it('with EMPTY transitions, the untouched body text still reaches TTS in order (graceful degradation)', () => {
        const woven = weaveTransitionChunks(segments, EMPTY_TRANSITIONS, 'T');

        expect(spokenText(woven)).toEqual([
            'Intro body',
            'Point one body',
            'Point two body',
            'Conclusion body',
        ]);
        expect(woven.every(c => c.kind === 'body')).toBe(true);
    });

    it('drops segments with no body so an empty part is never announced', () => {
        const withEmpty: SegmentBody[] = [
            seg('intro-sec', 'introduction', 'Intro body'),
            seg('p-empty', 'mainPart'), // no body chunks
            seg('p2', 'mainPart', 'Point two body'),
        ];
        const woven = weaveTransitionChunks(withEmpty, transitions, 'T');

        // p-empty contributes neither a body nor a bridge.
        expect(spokenText(woven)).toEqual([
            'Welcome to the sermon.',
            'Intro body',
            'Now, our second point.', // bridge into p2 (the next non-empty segment)
            'Point two body',
            'Amen.',
        ]);
    });

    it('returns an empty list when there is nothing to voice', () => {
        expect(weaveTransitionChunks([], transitions, 'T')).toEqual([]);
        expect(weaveTransitionChunks([seg('x', 'mainPart')], transitions, 'T')).toEqual([]);
    });
});
