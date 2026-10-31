import { prepareAtomicDomainCommand } from '../domainPolicy';

import type { DataCommand, DocumentData, ResourceSnapshot } from '../types';

const note = (id: string, chapter: number, fromVerse: number, toVerse = fromVerse): ResourceSnapshot => ({
  resource: { collection: 'studyNotes', id }, value: {
    userId: 'owner', type: 'analysis', title: `Title ${id}`, content: `Content ${id}`, tags: ['tag'], isDraft: false,
    createdAt: 'created', updatedAt: 'updated', scriptureRefs: [{ id: `ref-${id}`, bible: 'rst', book: 'Ephesians', chapter, fromVerse, toVerse }],
    analysis: { bible: 'rst', words: 4, cuts: [], links: {}, relations: {} },
  }, metadata: { protocol: 1, generation: `gen-${id}`, revision: 2, deleted: false },
});
const nextFrame = (snapshot: ResourceSnapshot, title = snapshot.value!.title): DocumentData => ({
  ...snapshot.value!, title, content: `Reshaped ${snapshot.resource.id}`,
  scriptureRefs: [{ ...(snapshot.value!.scriptureRefs as DocumentData[])[0], fromVerse: 2, toVerse: 2 }],
  analysis: { bible: 'rst', words: 2, cuts: [], links: {}, relations: {} },
});

describe('analysis reshape domain preparation', () => {
  it('pins all three authored frame roots for each existing participant and includes only a touched title', () => {
    const source = note('source', 1, 1, 2);
    const recipient = note('recipient', 1, 3);
    const sourceDraft = nextFrame(source, 'Renamed source');
    const recipientDraft = nextFrame(recipient);
    recipientDraft.tags = ['new unsent tag'];

    const command = prepareAtomicDomainCommand('owner', 'operation', [
      { confirmed: source, draft: sourceDraft }, { confirmed: recipient, draft: recipientDraft },
    ]) as Extract<DataCommand, { kind: 'relation' }>;

    expect(command).toMatchObject({ kind: 'relation', relation: 'analysis-reshape', resource: source.resource, generation: 'gen-source' });
    if (command.kind !== 'relation' || command.relation !== 'analysis-reshape') throw new Error('Expected an analysis reshape relation');
    expect(command.edits).toHaveLength(2);
    expect(command.edits[0]).toMatchObject({ resource: source.resource, generation: 'gen-source' });
    expect(command.edits[1]).toMatchObject({ resource: recipient.resource, generation: 'gen-recipient' });
    const paths = command.edits.map(edit => edit.changes.map(change => change.path[0]));
    expect(paths[0]).toEqual(expect.arrayContaining(['analysis', 'content', 'scriptureRefs', 'title']));
    expect(paths[1]).toEqual(expect.arrayContaining(['analysis', 'content', 'scriptureRefs']));
    expect(paths[1]).not.toContain('title');
    expect(paths.flat()).not.toContain('tags');
    expect(paths.flat()).not.toContain('updatedAt');
    for (const [index, participant] of [source, recipient].entries()) {
      const edit = command.edits[index];
      for (const field of ['analysis', 'content', 'scriptureRefs']) {
        expect(edit.changes.find(change => change.path[0] === field)).toEqual({
          path: [field], before: { exists: true, value: participant.value![field] }, after: { exists: true, value: (index ? recipientDraft : sourceDraft)[field] },
        });
      }
    }
  });

  it('encodes a new recipient as a full create while keeping the existing source first', () => {
    const source = note('source', 1, 1, 2);
    const absent: ResourceSnapshot = { resource: { collection: 'studyNotes', id: 'new-note' }, value: null, metadata: null };
    const sourceDraft = nextFrame(source);
    const created: DocumentData = { userId: 'owner', type: 'analysis', title: 'New note', content: 'Words', tags: [], isDraft: false,
      createdAt: 'created', updatedAt: 'updated', scriptureRefs: [{ id: 'new-ref', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 3, toVerse: 3 }],
      analysis: { bible: 'rst', words: 4, cuts: [], links: {}, relations: {} } };

    const command = prepareAtomicDomainCommand('owner', 'operation', [
      { confirmed: source, draft: sourceDraft }, { confirmed: absent, draft: created },
    ]) as Extract<DataCommand, { kind: 'relation' }>;

    expect(command).toMatchObject({ relation: 'analysis-reshape', resource: source.resource, edits: [
      { resource: source.resource, generation: 'gen-source' },
      { resource: absent.resource, generation: null, changes: [], create: created },
    ] });
  });

  it.each([
    ['too few participants', []],
    ['too many participants', ['third', 'fourth']],
  ])('rejects %s', (_label, extraIds) => {
    const source = note('source', 1, 1, 2);
    const recipient = note('recipient', 1, 3);
    const participants = [{ confirmed: source, draft: nextFrame(source) }, { confirmed: recipient, draft: nextFrame(recipient) },
      ...extraIds.map(id => { const extra = note(id, 1, 4); return { confirmed: extra, draft: nextFrame(extra) }; })];
    const chosen = extraIds.length === 0 ? participants.slice(0, 1) : participants;
    expect(() => prepareAtomicDomainCommand('owner', 'operation', chosen)).toThrow();
  });
});
