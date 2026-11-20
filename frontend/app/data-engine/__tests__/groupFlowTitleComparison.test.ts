import { GROUP_FLOW_TEXT_QUEUED, GROUP_FLOW_TEXT_SETTLED } from '../groupFlowTitleAction';
import { groupTextDecision, projectGroupTextDecisions, readGroupTextReview } from '../groupTextReview';
import { readGroupFlowFieldConflict } from '../rowConflictDetails';
import { withQueuedRowFieldProofs } from '../rowFieldAutosave';
import { DataSession, UNREADABLE_ROW_PROOF, UNREADABLE_SCALAR_PROOF } from '../session';

import type { ResourceSnapshot } from '../types';

describe('group flow title comparison', () => {
  const template = { id: 'block', title: 'Original', content: 'Words', createdAt: 'born', updatedAt: 'first' };
  const step = { id: 'step', templateId: template.id, instanceTitle: 'Old step', order: 1 };
  const value = { userId: 'owner', templates: [template], flow: [step] };
  const resource = { collection: 'groups', id: 'group' };
  const metadata = { protocol: 1 as const, generation: 'group', revision: 1, deleted: false };
  const opening: ResourceSnapshot = { resource, value, metadata };

  it('shows the local and stored title when the server reports a conflict after a return', () => {
    const base = { ...opening, value: { ...value, title: 'Original group name' } };
    const checkpoint = new DataSession(base).checkpoint();
    checkpoint.draft = { ...base.value, title: 'Recovered group name' };
    checkpoint.pending.save = { generation: 1, value: checkpoint.draft };
    checkpoint.remoteCandidate = { ...base, metadata: { ...metadata, revision: 3 } };
    checkpoint.conflicts = [{ path: ['title'], base: { exists: true, value: base.value.title },
      mine: { exists: true, value: 'Recovered group name' }, theirs: { exists: true, value: base.value.title } }];
    expect(readGroupFlowFieldConflict(checkpoint)).toMatchObject({ field: 'title', mine: 'Recovered group name', stored: 'Original group name' });
  });

  it('compares the displayed titles instead of stale words from the original conflict', () => {
    const checkpoint = new DataSession(opening).checkpoint();
    checkpoint.draft = { ...value, templates: [{ ...template, title: 'Latest local', updatedAt: 'local' }] };
    checkpoint.pending.save = { generation: 1, value: checkpoint.draft };
    checkpoint.remoteCandidate = { resource, metadata: { ...metadata, revision: 3 },
      value: { ...value, templates: [{ ...template, title: 'Latest stored', updatedAt: 'stored' }] } };
    checkpoint.conflicts = [{ path: ['templates', 'id:block', 'title'], base: { exists: true, value: template.title },
      mine: { exists: true, value: 'Old local' }, theirs: { exists: true, value: 'Old stored' } }];
    expect(readGroupFlowFieldConflict(checkpoint)).toMatchObject({ field: 'block', mine: 'Latest local', stored: 'Latest stored' });
    checkpoint.draft.templates = [{ ...template, title: 'Latest local', content: 'New local words', updatedAt: 'local' }];
    expect(readGroupFlowFieldConflict(checkpoint)).toMatchObject({ field: 'block', mine: 'Latest local', stored: 'Latest stored' });
    const review = readGroupTextReview(checkpoint)!;
    const projected = projectGroupTextDecisions(review, [groupTextDecision(review.remaining[0], 'remote')]);
    expect(projected?.templates).toMatchObject([{ title: 'Latest stored', content: 'New local words' }]);
  });

  it.each([
    { code: GROUP_FLOW_TEXT_SETTLED, content: 'Newer desktop words' },
    { code: GROUP_FLOW_TEXT_QUEUED, content: 'Phone words' },
  ])('keeps already ordered content through a later title choice: $code', ({ code, content }) => {
    const checkpoint = new DataSession(opening).checkpoint();
    const row = { ...template, title: 'Phone title', content: 'Phone words' };
    checkpoint.draft = { ...value, templates: [row] };
    const at = { earliestMs: 1_800_000_000_080, latestMs: 1_800_000_000_090 };
    const contentAction = { rowId: template.id, rowCreatedAt: template.createdAt, before: template.content,
      after: row.content, observedRevision: 1, time: at };
    checkpoint.pending.save = { generation: 1, value: checkpoint.draft, groupBlockContentActions: [contentAction] };
    checkpoint.remoteCandidate = { ...opening, metadata: { ...metadata, revision: 3 },
      value: { ...value, templates: [{ ...template, content: 'Desktop words' }] } };
    const field = (text: string) => ({ exists: true as const, value: text });
    checkpoint.conflicts = [
      { path: ['templates', 'id:block', 'title'], base: field(template.title), mine: field(row.title), theirs: field(template.title) },
      { path: ['templates', 'id:block', 'content'], code, base: field(template.content), mine: field(row.content), theirs: field('Desktop words') },
    ];

    const review = readGroupTextReview(checkpoint)!;
    expect(review.remaining).toHaveLength(1);
    expect(review.remaining[0]).toMatchObject({ field: 'block', mine: row.title, stored: template.title });
    const decision = groupTextDecision(review.remaining[0], 'remote');
    const chosen = projectGroupTextDecisions(review, [decision])!;
    expect(chosen.templates).toMatchObject([{ title: template.title, content: code === GROUP_FLOW_TEXT_SETTLED ? 'Desktop words' : content }]);

    const newer = { ...opening, metadata: { ...metadata, revision: 4 },
      value: { ...value, templates: [{ ...template, content: 'Newer desktop words' }] } };
    checkpoint.remoteCandidate = newer;
    checkpoint.draft = { ...checkpoint.draft, templates: [{ ...row, content: 'Unsaved newer text' }] };
    const unsavedReview = readGroupTextReview(checkpoint)!;
    expect(unsavedReview.remaining).toHaveLength(1);
    expect(projectGroupTextDecisions(unsavedReview, [decision])?.templates).toMatchObject([{ title: template.title, content }]);
    const laterDraft = { ...checkpoint.pending.save.value, flow: [{ ...step, instanceNotes: 'Later local notes' }] };
    checkpoint.pending.later = { generation: 2, value: laterDraft };
    checkpoint.draft = laterDraft;
    const pendingReview = readGroupTextReview(checkpoint)!;
    expect(pendingReview.requestId).toBe('save');
    expect(pendingReview.remaining).toHaveLength(1);
    expect(projectGroupTextDecisions(pendingReview, [decision])?.templates).toMatchObject([{ title: template.title, content }]);

    const queued = pendingReview.settled.flatMap(item => item.side === 'mine' ? [item.field] : []);
    const evidence = withQueuedRowFieldProofs(checkpoint, queued);
    expect(evidence.groupBlockContentDrafts?.[template.id]?.action).toEqual(code === GROUP_FLOW_TEXT_QUEUED ? contentAction : undefined);
  });

  it.each(['content', 'instanceNotes'] as const)('shows both exact versions of %s before resolving', leaf => {
    const blockText = leaf === 'content';
    const root = blockText ? 'templates' : 'flow';
    const row = blockText ? template : { ...step, instanceNotes: 'Opening notes' };
    const withWords = (words: string) => ({ ...value, [root]: [{ ...row, [leaf]: words }] });
    const base = { ...opening, value: { ...value, [root]: [row] } };
    const checkpoint = new DataSession(base).checkpoint();
    checkpoint.draft = withWords('Phone words');
    checkpoint.pending.save = { generation: 1, value: checkpoint.draft };
    checkpoint.remoteCandidate = { ...base, metadata: { ...metadata, revision: 2 }, value: withWords('Desktop words') };
    checkpoint.conflicts = [{ path: [root, 'id:' + row.id, leaf], base: { exists: true, value: 'Opening words' },
      mine: { exists: true, value: 'Phone words' }, theirs: { exists: true, value: 'Desktop words' } }];

    expect(readGroupFlowFieldConflict(checkpoint)).toMatchObject({
      field: blockText ? 'content' : 'notes', mine: 'Phone words', stored: 'Desktop words',
    });
    checkpoint.draft.description = 'Separate local edit';
    expect(readGroupFlowFieldConflict(checkpoint)).toMatchObject({ mine: 'Phone words', stored: 'Desktop words' });
  });

  it.each(['local', 'remote'] as const)('keeps the template and its last step together when choosing %s', side => {
    const other = { ...template, id: 'other', title: template.title };
    const otherStep = { ...step, id: 'other-step', templateId: other.id, order: 2 };
    const last = { ...template, id: 'last' };
    const lastStep = { ...step, id: 'last-step', templateId: last.id, order: 3 };
    const initial = { ...value, templates: [template, other, last], flow: [step, otherStep, lastStep] };
    const checkpoint = new DataSession({ ...opening, value: initial }).checkpoint();
    const local = { ...initial, templates: [{ ...template, content: 'Local block' }, last], flow: [step, { ...lastStep, order: 2 }] };
    const remoteOther = { ...other, content: 'Stored other block' };
    checkpoint.draft = local;
    checkpoint.pending.save = { generation: 1, value: local };
    checkpoint.remoteCandidate = { ...opening, metadata: { ...metadata, revision: 2 },
      value: { ...initial, templates: [{ ...template, content: 'Stored block' }, remoteOther, last] } };
    checkpoint.conflicts = [{
      path: ['templates', 'id:block', 'content'], base: { exists: true, value: template.content },
      mine: { exists: true, value: 'Local block' }, theirs: { exists: true, value: 'Stored block' },
    }];
    const first = readGroupTextReview(checkpoint)!;
    expect(first.remaining).toHaveLength(2);
    expect(readGroupFlowFieldConflict(checkpoint)).toMatchObject({ rowTitle: template.title, rowPosition: 1 });
    const selected = groupTextDecision(first.remaining[0], 'local');
    checkpoint.groupTextReview = { requestId: 'save', revision: 1, decisions: [selected] };
    const next = readGroupTextReview(checkpoint)!;
    expect(next.remaining[0]).toMatchObject({ removedBy: 'local', stored: 'Stored other block' });

    const projected = projectGroupTextDecisions(next, [selected, groupTextDecision(next.remaining[0], side)]);
    expect(projected).toMatchObject({
      templates: [{ ...template, content: 'Local block' }, ...(side === 'remote' ? [remoteOther] : []), last],
      flow: [step, ...(side === 'remote' ? [otherStep, lastStep] : [{ ...lastStep, order: 2 }])],
    });
  });

  it('shows the first exact field when two private group rows have unreadable observations', () => {
    const other = { ...template, id: 'second', title: 'Second' };
    const initial = { ...value, templates: [template, other] };
    const checkpoint = new DataSession({ ...opening, value: initial }).checkpoint();
    checkpoint.draft = { ...initial, templates: [{ ...template, title: 'Mine first' }, { ...other, title: 'Mine second' }] };
    checkpoint.remoteCandidate = { ...opening, value: initial, metadata: { ...metadata, revision: 3 } };
    checkpoint.unreadableRowProofs = [template, other].map(row => ({
      field: 'groupBlockTitleDrafts', rowId: row.id, birth: row.createdAt, generation: metadata.generation,
    }));
    checkpoint.conflicts = [template, other].map((row, index) => ({
      code: UNREADABLE_ROW_PROOF, path: ['templates', 'id:' + row.id, 'title'],
      base: { exists: true, value: row.title }, mine: { exists: true, value: index ? 'Mine second' : 'Mine first' },
      theirs: { exists: true, value: row.title },
    }));

    expect(readGroupFlowFieldConflict(checkpoint)).toMatchObject({
      field: 'block', mine: 'Mine first', stored: 'Original', rowId: template.id,
    });
  });

  it('keeps a saved match from hiding the remaining group field comparison', () => {
    const original = { ...value, title: 'Group', description: 'Old description' };
    const initial = { ...opening, value: original };
    const checkpoint = new DataSession(initial).checkpoint();
    checkpoint.draft = { ...original, title: 'Same new group title', description: 'Private description' };
    checkpoint.unreadableScalarProof = ['title', 'description'];
    checkpoint.remoteCandidate = { ...initial, metadata: { ...metadata, revision: 2 },
      value: { ...original, title: 'Same new group title' } };
    checkpoint.conflicts = ['title', 'description'].map(field => ({
      code: UNREADABLE_SCALAR_PROOF, path: [field],
      base: { exists: true, value: original[field as 'title' | 'description'] },
      mine: { exists: true, value: checkpoint.draft![field] },
      theirs: { exists: true, value: checkpoint.remoteCandidate!.value![field] },
    }));

    const session = DataSession.restore(checkpoint);
    expect(readGroupFlowFieldConflict(session.checkpoint())).toMatchObject({
      field: 'description', mine: 'Private description', stored: 'Old description',
    });
    expect(session.choosePrivateFields('local', null)).toBe(true);
    expect(session.checkpoint()).toMatchObject({
      conflicts: [], draft: { title: 'Same new group title', description: 'Private description' },
    });
  });

  it('keeps an explicit step clear visible and declines a replacement row', () => {
    const checkpoint = new DataSession(opening).checkpoint();
    const { instanceTitle: _old, ...cleared } = step;
    checkpoint.draft = { ...value, flow: [cleared] };
    checkpoint.pending.save = { generation: 1, value: checkpoint.draft };
    checkpoint.remoteCandidate = { resource, metadata: { ...metadata, revision: 2 },
      value: { ...value, flow: [{ ...step, instanceTitle: 'Stored step' }] } };
    checkpoint.conflicts = [{ path: ['flow', 'id:step', 'instanceTitle'], base: { exists: true, value: step.instanceTitle },
      mine: { exists: false }, theirs: { exists: true, value: 'Stored step' } }];
    expect(readGroupFlowFieldConflict(checkpoint)).toMatchObject({ field: 'step', mine: null, stored: 'Stored step' });
    checkpoint.remoteCandidate.value!.flow = [{ ...step, templateId: 'other-block' }];
    expect(readGroupFlowFieldConflict(checkpoint)).toBeUndefined();
  });
});
