import { activatePreparedAudio, mergePreparedAudioSources, PreparedAudioChanged, preparedAudioCovers, preparedAudioVersion, putPreparedAudio, readPreparedAudioSources, replacePreparedAudioSections, requirePreparedAudio } from '../preparedAudioSources';
import type { AudioChunk, PreparedAudioSources } from '@/types/audioGeneration.types';

const chunk = (text: string): AudioChunk => ({ index: 0, sectionId: 'introduction', text, createdAt: '2026-10-01T00:00:00.000Z' });
const ai = [chunk('Saved AI words corrected by hand')];
const raw = [chunk('Original words')];
const legacy = { audioChunks: ai, audioMetadata: { mode: 'ai', voice: 'onyx', lastGenerated: 'earlier' } };

describe('independently saved speech sources', () => {
  it('reads old words without mutating the original or inventing section coverage', () => {
    const before = JSON.stringify(legacy), sources = readPreparedAudioSources(legacy);
    expect(sources.ai?.chunks).toEqual(ai); expect(sources.raw).toBeUndefined();
    expect(sources.ai?.revision).toBe(0); expect(sources.ai?.sections).toEqual(['introduction']);
    expect(preparedAudioCovers(sources.ai, ['introduction'])).toBe(true);
    expect(preparedAudioCovers(sources.ai, ['introduction', 'mainPart'])).toBe(false);
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it('preserves the only AI copy and metadata while activating Original for an old client', () => {
    const stored = activatePreparedAudio(legacy, 'raw', raw, ai);
    expect(stored.audioChunks).toEqual(raw); expect(stored.audioMetadata).toMatchObject({ mode: 'raw', voice: 'onyx', lastGenerated: 'earlier' });
    expect(stored.audioSources.ai?.chunks).toEqual(ai); expect(stored.audioSources.raw?.chunks).toEqual(raw);
    expect(readPreparedAudioSources(stored).ai?.chunks).toEqual(ai);
  });

  it('does not let an active-source baseline authorize overwriting a differing inactive source', () => {
    const stored = activatePreparedAudio(legacy, 'raw', raw, ai);
    const changed = putPreparedAudio(stored, 'ai', [chunk('Newer saved correction')], { id: 'ai-new', sections: ['introduction'] });
    const active = { ...changed, audioChunks: raw, audioMetadata: { ...changed.audioMetadata, mode: 'raw' } };
    expect(() => activatePreparedAudio(active, 'ai', ai, raw)).toThrow(PreparedAudioChanged);
    expect(readPreparedAudioSources(active).ai?.chunks[0].text).toBe('Newer saved correction');
  });

  it('advances only the written source from the latest stored revision and retains the other source', () => {
    const first = putPreparedAudio(legacy, 'ai', ai, { id: 'ai-set', sections: ['introduction', 'mainPart'] });
    const second = putPreparedAudio(first, 'raw', raw, { id: 'raw-set', sections: ['introduction'] });
    const third = putPreparedAudio(second, 'ai', [chunk('Manually edited')], { id: 'ai-set', sections: ['introduction', 'mainPart'] });
    expect(third.audioSources.ai).toMatchObject({ id: 'ai-set', revision: 2, sections: ['introduction', 'mainPart'] });
    expect(third.audioSources.raw).toEqual(second.audioSources.raw);
    expect(preparedAudioCovers(third.audioSources.ai, ['mainPart'])).toBe(true);
  });

  it('checks stable set identity and revision even when words and positions match', () => {
    const stored = putPreparedAudio(legacy, 'ai', ai, { id: 'replacement', sections: ['introduction'] });
    expect(() => requirePreparedAudio(stored, 'ai', { id: 'old-set', revision: 1 }, ai)).toThrow(PreparedAudioChanged);
    expect(() => requirePreparedAudio(stored, 'ai', { id: 'replacement', revision: 0 }, ai)).toThrow(PreparedAudioChanged);
    expect(requirePreparedAudio(stored, 'ai', preparedAudioVersion(stored.audioSources.ai!), ai)).toEqual(stored.audioSources.ai);
  });

  it('keeps a newer source when an older answer arrives and does not infer order from equal revisions', () => {
    const current: PreparedAudioSources = { ai: { id: 'new', revision: 4, sections: ['introduction'], chunks: ai } };
    const older: PreparedAudioSources = { ai: { id: 'old', revision: 3, sections: ['introduction'], chunks: raw } };
    expect(mergePreparedAudioSources(current, older)).toEqual(current);
    expect(mergePreparedAudioSources(current, { ai: { ...older.ai!, revision: 4 } })).toEqual(current);
    const extra: PreparedAudioSources = { raw: { id: 'raw', revision: 1, sections: ['introduction'], chunks: raw } };
    expect(mergePreparedAudioSources(current, extra)).toMatchObject({ ai: current.ai, raw: extra.raw });
  });

  it('never treats missing or invalid old mode as Original and never invents a prepared empty source', () => {
    expect(readPreparedAudioSources({ audioChunks: ai }).raw).toBeUndefined();
    expect(readPreparedAudioSources({ audioChunks: ai, audioMetadata: { mode: 'unknown' } }).raw).toBeUndefined();
    expect(readPreparedAudioSources({ audioChunks: [], audioMetadata: { mode: 'raw' } })).toEqual({});
    expect(preparedAudioCovers(undefined, ['introduction'])).toBe(false);
    expect(preparedAudioCovers(readPreparedAudioSources(legacy).ai, [])).toBe(false);
  });
  it('replaces selected sections while keeping a newer correction elsewhere and the inactive source', () => {
    const original = putPreparedAudio(legacy, 'ai', [...ai, { ...chunk('Old main'), index: 1, sectionId: 'mainPart' }], { id: 'ai-start', sections: ['introduction', 'mainPart'] });
    const opening = original.audioSources.ai!;
    const changedElsewhere = putPreparedAudio(original, 'ai', [...ai, { ...chunk('New main correction'), index: 1, sectionId: 'mainPart' }], { id: 'ai-start', sections: ['introduction', 'mainPart'] });
    const latest = putPreparedAudio(changedElsewhere, 'raw', raw, { id: 'raw-stored', sections: ['introduction'] });
    const next = replacePreparedAudioSections(latest, 'ai', opening, { id: 'ai-prepared', sections: ['introduction'], chunks: [chunk('New prepared intro')] });
    expect(next.audioSources.ai?.chunks.map(value => value.text)).toEqual(['New prepared intro', 'New main correction']);
    expect(next.audioSources.ai).toMatchObject({ id: 'ai-prepared', revision: 3, sections: ['introduction', 'mainPart'] });
    expect(next.audioSources.raw).toEqual(latest.audioSources.raw);
  });

  it('rejects a replaced generation or a correction in the sections being prepared', () => {
    const start = putPreparedAudio(legacy, 'ai', ai, { id: 'ai-start', sections: ['introduction'] });
    const replacement = { id: 'prepared', sections: ['introduction'] as const, chunks: raw };
    const sameWordsNewSet = putPreparedAudio(start, 'ai', ai, { id: 'ai-new', sections: ['introduction'] });
    expect(() => replacePreparedAudioSections(sameWordsNewSet, 'ai', start.audioSources.ai, replacement)).toThrow(PreparedAudioChanged);
    const corrected = putPreparedAudio(start, 'ai', [chunk('Corrected opening')], { id: 'ai-start', sections: ['introduction'] });
    expect(() => replacePreparedAudioSections(corrected, 'ai', start.audioSources.ai, replacement)).toThrow(PreparedAudioChanged);
  });

  it('records an explicitly prepared empty section without deleting the other saved words', () => {
    const next = replacePreparedAudioSections(legacy, 'ai', readPreparedAudioSources(legacy).ai, { id: 'ai-empty-main', sections: ['mainPart'], chunks: [] });
    expect(next.audioSources.ai?.chunks).toEqual(ai);
    expect(preparedAudioCovers(next.audioSources.ai, ['introduction', 'mainPart'])).toBe(true);
  });

});
