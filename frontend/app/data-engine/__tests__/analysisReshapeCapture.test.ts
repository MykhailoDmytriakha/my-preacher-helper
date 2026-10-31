import { captureAnalysisReshape } from '../analysisReshape';
import type { DocumentData, ResourceSnapshot } from '../types';

const note = (id: string, verse: number, owner = 'owner'): ResourceSnapshot => ({
  resource: { collection: 'studyNotes', id },
  metadata: { protocol: 1, generation: `${id}-generation`, revision: 1, deleted: false },
  value: { userId: owner, title: id, content: `words-${id}`,
    scriptureRefs: [{ id: `${id}-ref`, bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: verse, toVerse: verse }],
    analysis: { bible: 'rst', words: 1, cuts: [], links: {}, relations: {} }, tags: [], type: 'analysis', isDraft: false },
});

const changed = (snapshot: ResourceSnapshot, content: string, verse: number): DocumentData => ({
  ...snapshot.value!, content,
  scriptureRefs: [{ id: (snapshot.value!.scriptureRefs as DocumentData[])[0].id as string,
    bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: verse, toVerse: verse }],
  analysis: { ...(snapshot.value!.analysis as DocumentData), words: 1, cuts: [] },
});

describe('analysis reshape capture preflight', () => {
  it('refuses a stale expected authored frame before producing any captures and preserves the caller objects', () => {
    const source = note('source', 2), target = note('target', 3);
    const expected = source.value!;
    const references = expected.scriptureRefs;
    const before = JSON.stringify([source, target]);
    expect(() => captureAnalysisReshape('owner', 'action', [
      { resource: source.resource, expected: changed(source, 'stale displayed words', 1), value: changed(source, 'reshaped', 2) },
      { resource: target.resource, expected: target.value, value: changed(target, 'joined', 2) },
    ], [source, target], [])).toThrow('resolve-version-first');
    expect(expected.scriptureRefs).toBe(references);
    expect(JSON.stringify([source, target])).toBe(before);
  });

  it.each([
    ['foreign owner', note('target', 3, 'someone-else')],
    ['deleted recipient', { ...note('target', 3), metadata: { ...note('target', 3).metadata!, deleted: true } }],
  ])('refuses a %s without returning a partial capture', (_reason, target) => {
    const source = note('source', 2);
    expect(() => captureAnalysisReshape('owner', 'action', [
      { resource: source.resource, expected: source.value, value: changed(source, 'source stays complete', 2) },
      { resource: target.resource, expected: target.value, value: changed(target, 'join', 2) },
    ], [source, target], [])).toThrow();
  });

  it('captures the source first and preserves existing saved recipient reference IDs while changing its authored frame', () => {
    const source = note('source', 2), target = note('target', 3);
    const targetRefs = target.value!.scriptureRefs;
    const captures = captureAnalysisReshape('owner', 'action', [
      { resource: source.resource, expected: source.value, value: changed(source, 'remaining source words', 2) },
      { resource: target.resource, expected: target.value, value: changed(target, 'joined removed words', 2) },
    ], [source, target], []);
    expect(captures).toHaveLength(2);
    expect(captures[0].editorId).toContain('source');
    expect(captures[1].editorId).toContain('target');
    expect((captures[1].captured.draft!.scriptureRefs as DocumentData[])[0].id).toBe('target-ref');
    expect(source.value!.content).toBe('words-source');
    expect(target.value!.scriptureRefs).toBe(targetRefs);
  });
});
