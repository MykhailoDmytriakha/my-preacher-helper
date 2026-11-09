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
