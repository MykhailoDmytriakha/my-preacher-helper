import { groupTextDecision, projectGroupTextDecisions, readGroupTextReview } from '../groupTextReview';
import { readGroupFlowFieldConflict } from '../rowConflictDetails';
import { DataSession } from '../session';

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
    expect(readGroupFlowFieldConflict(checkpoint)).toBeUndefined();
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
