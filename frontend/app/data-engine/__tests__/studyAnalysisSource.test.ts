import { prepareDomainCommand } from '../domainPolicy';
import { ANALYSIS_RESHAPE_FRAME, applyCommand, diffFields, readField } from '../protocol';

import type { DataCommand, DocumentData, ResourceSnapshot } from '../types';

const resource = { collection: 'studyNotes', id: 'analysis-source' };
const reference = { id: 'ref-source', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 1, toVerse: 2 };
const analysis = { bible: 'rst', words: 8, cuts: [3], links: {}, relations: {} };
const note = (patch: DocumentData = {}): DocumentData => ({
  userId: 'owner', title: 'Ephesians 1:1–2', content: 'Analysis', scriptureRefs: [reference], tags: [],
  type: 'analysis', analysis, isDraft: true, createdAt: '2026-10-30T10:00:00.000Z', updatedAt: '2026-10-30T10:00:00.000Z',
  ...patch,
});
const snapshot = (value: DocumentData | null, generation: string | null = 'generation-1'): ResourceSnapshot => ({
  resource, value, metadata: generation ? { protocol: 1, generation, revision: 1, deleted: false } : null,
});
const serverUpdate = (before: DocumentData, after: DocumentData): DataCommand => ({
  protocol: 1, operationId: 'source-change', owner: 'owner', resource, generation: 'generation-1', dependsOn: [],
  kind: 'update', changes: before.type === 'analysis' && diffFields(before, after).some(change => ANALYSIS_RESHAPE_FRAME.some(field => change.path[0] === field))
    // An external command still exercises server admission independently of client preparation.
    ? [...diffFields(before, after).filter(change => !ANALYSIS_RESHAPE_FRAME.some(field => change.path[0] === field)),
      ...ANALYSIS_RESHAPE_FRAME.map(field => ({ path: [field], before: readField(before, [field]), after: readField(after, [field]) }))]
    : diffFields(before, after),
});

describe('Analysis word-source identity at the shared command boundary', () => {
  const canonical = note();

  it.each([
    ['word Bible', { ...canonical, analysis: { ...analysis, bible: 'kjv' } }],
    ['canonical reference book', { ...canonical, scriptureRefs: [{ ...reference, book: 'Galatians' }] }],
  ] as [string, DocumentData][])('refuses changing the %s of an existing analysis', (_label, changed) => {
    expect(applyCommand(serverUpdate(canonical, changed), snapshot(canonical)))
      .toMatchObject({ kind: 'refused', code: 'invalid-document' });
  });

  it.each([
    ['word Bible', { ...canonical, analysis: { ...analysis, bible: 'kjv' } }],
    ['canonical reference book', { ...canonical, scriptureRefs: [{ ...reference, book: 'Galatians' }] }],
  ] as [string, DocumentData][])('does not prepare an offline command changing the %s', (_label, changed) => {
    expect(() => prepareDomainCommand('owner', 'offline-source-change', snapshot(canonical), changed)).toThrow();
  });

  it('cannot detach existing word indices by changing only the note type', () => {
    const detached: DocumentData = { ...canonical, type: 'note' };
    expect(applyCommand(serverUpdate(canonical, detached), snapshot(canonical))).toMatchObject({ kind: 'refused', code: 'invalid-document' });

    const removed = prepareDomainCommand('owner', 'delete-analysis', snapshot(canonical), null).command;
    expect(applyCommand(removed, snapshot(canonical))).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
  });

  it('does not queue a type change that detaches existing word indices', () => {
    expect(() => prepareDomainCommand('owner', 'detach-source', snapshot(canonical), { ...canonical, type: 'note' })).toThrow();
  });

  it('allows edits and verse-numbering changes while the word source stays the same', () => {
    const edited: DocumentData = { ...canonical, content: 'Edited analysis', analysis: { ...analysis, cuts: [4] } };
    expect(applyCommand(serverUpdate(canonical, edited), snapshot(canonical))).toMatchObject({ kind: 'acknowledged' });
    expect(prepareDomainCommand('owner', 'offline-content-edit', snapshot(canonical), edited).command.kind).toBe('update');

    const renumbered: DocumentData = { ...canonical, scriptureRefs: [{ ...reference, bible: 'kjv' }] };
    expect(applyCommand(serverUpdate(canonical, renumbered), snapshot(canonical))).toMatchObject({ kind: 'acknowledged' });
    expect(prepareDomainCommand('owner', 'offline-renumber', snapshot(canonical), renumbered).command.kind).toBe('update');
  });

  it('allows creating a new analysis whose word source is KJV', () => {
    const kjv: DocumentData = note({
      analysis: { ...analysis, bible: 'kjv' },
      scriptureRefs: [{ ...reference, bible: 'kjv' }],
    });
    const absent = snapshot(null, null);
    const command = prepareDomainCommand('owner', 'new-kjv-analysis', absent, kjv).command;
    expect(command).toMatchObject({ kind: 'create', value: kjv });
    expect(applyCommand(command, absent)).toMatchObject({ kind: 'acknowledged' });
  });

  it('keeps unrelated ordinary-note edits working without analysis identity fields', () => {
    const ordinary = note({ type: 'note' }); delete ordinary.analysis;
    const renamed: DocumentData = { ...ordinary, title: 'Ordinary note renamed' };
    expect(applyCommand(serverUpdate(ordinary, renamed), snapshot(ordinary))).toMatchObject({ kind: 'acknowledged' });
    expect(prepareDomainCommand('owner', 'ordinary-title', snapshot(ordinary), renamed).command.kind).toBe('update');
  });

  it('continues to allow unrelated edits to malformed legacy analysis identity', () => {
    const legacy = note({ analysis: { ...analysis, bible: '' }, scriptureRefs: [{ ...reference, book: '' }] });
    const renamed: DocumentData = { ...legacy, title: 'Legacy title edited' };
    expect(applyCommand(serverUpdate(legacy, renamed), snapshot(legacy))).toMatchObject({ kind: 'acknowledged' });
    expect(prepareDomainCommand('owner', 'legacy-title', snapshot(legacy), renamed).command.kind).toBe('update');
  });
});
