import { prepareDomainCommand } from '../domainPolicy';
import { applyCommand, diffFields } from '../protocol';
import { preservesSermonLinks } from '../sermonIntegrity';
import { capturePlanTextEvidence } from '../sermonPlanText';

import type { DataCommand, DocumentData, ResourceSnapshot } from '../types';
const resource = { collection: 'sermons', id: 'sermon' };
const thought = { id: 'thought', text: 'Text', tags: [], date: 'today', outlinePointId: 'point', subPointId: 'sub' };
const outline = { introduction: [], main: [{ id: 'point', text: 'Point', subPoints: [{ id: 'sub', text: 'Sub', position: 0 }] }], conclusion: [] };
const structure = { introduction: [], main: ['thought'], conclusion: [], ambiguous: [] };
const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'Romans 1', date: 'today', thoughts: [thought], outline, structure, thoughtsBySection: structure };
const snapshot = (data: DocumentData): ResourceSnapshot => ({ resource, value: data, metadata: null });
const command = (base: DocumentData, next: DocumentData): DataCommand => ({ protocol: 1, operationId: 'op', owner: 'owner',
  resource, generation: null, dependsOn: [], kind: 'update', changes: diffFields(base, next) });

it.each([
  ['point', { outline: { ...outline, main: [] } }],
  ['subpoint', { outline: { ...outline, main: [{ id: 'point', text: 'Point' }] } }],
  ['orphan subpoint', { thoughts: [{ ...thought, outlinePointId: null }] }],
  ['wrong subpoint', { thoughts: [{ ...thought, subPointId: 'different' }] }],
  ['missing thought', { thoughts: [] }],
  ['duplicate placement', { structure: { ...structure, introduction: ['thought'] } }],
  ['duplicate alias placement', { thoughtsBySection: { ...structure, conclusion: ['thought'] } }],
] as [string, DocumentData][])('refuses new %s damage without changing any field', (_label, patch) => {
  const next = { ...value, ...patch };
  expect(preservesSermonLinks(value, next)).toBe(false);
  expect(applyCommand(command(value, next), snapshot(value))).toMatchObject({ kind: 'refused', code: 'invalid-document' });
  expect(value.thoughts).toEqual([thought]);
});

it('accepts removing the outline and clearing its thought links and placement atomically', () => {
  const next = { ...value, outline: { ...outline, main: [] }, thoughts: [{ ...thought, outlinePointId: null, subPointId: null }],
    structure: { ...structure, main: [], ambiguous: ['thought'] }, thoughtsBySection: { ...structure, main: [], ambiguous: ['thought'] } };
  expect(applyCommand(command(value, next), snapshot(value))).toMatchObject({ kind: 'acknowledged', snapshot: { value: next } });
});

it('refuses the merged result when individually valid changes orphan a concurrently assigned thought', () => {
  const base = { ...value, thoughts: [] };
  const next = { ...base, outline: { ...outline, main: [] } };
  const current = { ...value };
  expect(applyCommand(command(base, next), snapshot(current))).toMatchObject({ kind: 'refused', code: 'invalid-document' });
});

it('preserves existing legacy damage for unrelated edits and permits repairing it', () => {
  const broken = { ...value, outline: null, structure: 'legacy', thoughtsBySection: { main: ['missing', 'missing'] } };
  expect(preservesSermonLinks(broken, { ...broken, title: 'Edited' })).toBe(true);
  expect(applyCommand(command(broken, { ...broken, title: 'Edited' }), snapshot(broken))).toMatchObject({ kind: 'acknowledged' });
  expect(preservesSermonLinks(broken, value)).toBe(true);
  expect(preservesSermonLinks(broken, { ...broken, thoughts: [{ ...thought, outlinePointId: 'new-missing' }] })).toBe(false);
});

it('checks new documents and permits unassigned thoughts without optional structures', () => {
  const create: DataCommand = { protocol: 1, operationId: 'op', owner: 'owner', resource, generation: null, dependsOn: [], kind: 'create', value };
  expect(applyCommand(create, { resource, value: null, metadata: null })).toMatchObject({ kind: 'acknowledged' });
  expect(applyCommand({ ...create, value: { ...value, outline: { ...outline, main: [] } } }, { resource, value: null, metadata: null })).toMatchObject({ kind: 'refused' });
  expect(preservesSermonLinks(null, { thoughts: [{ id: 'a' }] })).toBe(true);
  expect(preservesSermonLinks(null, { thoughts: [null, 'legacy'], outline: [], structure: null })).toBe(true);
});

it('does not let an existing duplicate excuse adding a third placement', () => {
  const broken = { ...value, structure: { ...structure, introduction: ['thought'] } };
  expect(preservesSermonLinks(broken, { ...broken, structure: { ...broken.structure, conclusion: ['thought'] } })).toBe(false);
  expect(preservesSermonLinks(broken, value)).toBe(true);
});

describe('plan text in an explicit outline removal', () => {
  const keptOutline = { ...outline, introduction: [{ id: 'kept', text: 'Keep this point' }] };
  const base = { ...value, thoughts: [], structure: { ...structure, main: [] }, thoughtsBySection: { ...structure, main: [] },
    outline: keptOutline, planText: { point: 'Observed paragraph', sub: 'Observed subpoint', kept: 'Neighboring paragraph' } };
  const removed = { ...base, outline: { ...keptOutline, main: [] } };
  const confirmed = (data: DocumentData): ResourceSnapshot => ({
    resource, value: data, metadata: { protocol: 1, generation: 'sermon-generation', revision: 1, deleted: false },
  });
  const deletion = () => prepareDomainCommand('owner', 'remove-point', confirmed(base), removed).command;

  it('retires both previously seen texts with the removed point in one accepted update', () => {
    expect(applyCommand(deletion(), confirmed(base))).toMatchObject({ kind: 'acknowledged', snapshot: {
      value: { outline: removed.outline, planText: { point: '', sub: '', kept: 'Neighboring paragraph' } },
    } });
  });

  it('keeps a different paragraph that was not seen by the device which removed the point', () => {
    const remote = { ...base, planText: { ...base.planText, point: 'Unseen paragraph' } };
    expect(applyCommand(deletion(), confirmed(remote))).toMatchObject({ kind: 'acknowledged', snapshot: {
      value: { outline: removed.outline, planText: { point: 'Unseen paragraph', sub: '', kept: 'Neighboring paragraph' } },
    } });
  });

  it('preserves an offline edit that cannot be ordered against an already accepted removal', () => {
    const stored = applyCommand(deletion(), confirmed(base));
    if (stored.kind !== 'acknowledged') throw new Error('Point was not removed');
    const laterDelivery = prepareDomainCommand('owner', 'offline-text', confirmed(base),
      { ...base, planText: { ...base.planText, point: 'Offline paragraph' } }).command;
    expect(applyCommand(laterDelivery, stored.snapshot)).toMatchObject({ kind: 'acknowledged', snapshot: {
      value: { outline: removed.outline, planText: { point: 'Offline paragraph', sub: '', kept: 'Neighboring paragraph' } },
    } });
  });

  it('preserves the same user’s unseen words when the removal was prepared after a predecessor ACK', () => {
    const remote = { ...base, planText: { ...base.planText, point: 'New in the ACK' } };
    const prepared = prepareDomainCommand('owner', 'rebased-removal', confirmed(remote),
      { ...remote, outline: removed.outline }, [], capturePlanTextEvidence({ before: base, after: removed }));
    expect(applyCommand(prepared.command, confirmed(remote))).toMatchObject({ kind: 'acknowledged', snapshot: {
      value: { outline: removed.outline, planText: { point: 'New in the ACK', sub: '', kept: 'Neighboring paragraph' } },
    } });
  });

  it('masks an observed legacy cell but accepts unknown words written from that legacy baseline', () => {
    const oldPlan: DocumentData = { ...base, plan: { main: { outlinePoints: { point: 'Observed legacy paragraph' } } } };
    delete oldPlan.planText;
    const oldSnapshot = confirmed(oldPlan);
    const removal = prepareDomainCommand('owner', 'remove-legacy-point', oldSnapshot, { ...oldPlan, outline: removed.outline }).command;
    const stored = applyCommand(removal, oldSnapshot);
    expect(stored).toMatchObject({ kind: 'acknowledged', snapshot: { value: { planText: { point: '' } } } });
    if (stored.kind !== 'acknowledged') throw new Error('Legacy point was not removed');
    const edit = prepareDomainCommand('owner', 'late-legacy-edit', oldSnapshot, { ...oldPlan, planText: { point: 'Offline paragraph' } }).command;
    expect(applyCommand(edit, stored.snapshot)).toMatchObject({ kind: 'acknowledged', snapshot: {
      value: { planText: { point: 'Offline paragraph' } },
    } });
  });

  it('does not let an older cleanup erase an orphan that it never explicitly discarded', () => {
    const oldClientBaseline = { ...removed, planText: { point: 'Unordered words', kept: 'Neighboring paragraph' } };
    const cleanup = prepareDomainCommand('owner', 'old-cleanup', confirmed(oldClientBaseline),
      { ...oldClientBaseline, planText: { kept: 'Neighboring paragraph' } }).command;
    expect(applyCommand(cleanup, confirmed(oldClientBaseline))).toMatchObject({ kind: 'acknowledged', snapshot: {
      value: { planText: { point: 'Unordered words', kept: 'Neighboring paragraph' } },
    } });
  });

  it('protects older combined outline and text updates without evidence', () => {
    const obsolete = command(base, { ...removed, planText: { kept: 'Neighboring paragraph' } });
    expect(applyCommand({ ...obsolete, generation: 'sermon-generation' }, confirmed(base))).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { outline: removed.outline, planText: base.planText } },
    });
  });

  it('suppresses the local text of a removed point when both actions share one command', () => {
    const combined = prepareDomainCommand('owner', 'combined-local-actions', confirmed(base), {
      ...removed, planText: { ...base.planText, point: 'Earlier local words', kept: 'Updated neighbor' },
    }).command;
    expect(applyCommand(combined, confirmed(base))).toMatchObject({
      kind: 'acknowledged', snapshot: { value: {
        outline: removed.outline, planText: { point: '', sub: '', kept: 'Updated neighbor' },
      } },
    });
    const remote = { ...base, planText: { ...base.planText, point: 'Unseen paragraph' } };
    expect(applyCommand(combined, confirmed(remote))).toMatchObject({
      kind: 'acknowledged', snapshot: { value: {
        outline: removed.outline, planText: { point: 'Unseen paragraph', sub: '', kept: 'Updated neighbor' },
      } },
    });
  });

  it('suppresses co-captured words even if the removed point had no previously saved text', () => {
    const blank: DocumentData = { ...base };
    delete blank.planText;
    const combined = prepareDomainCommand('owner', 'combined-first-words', confirmed(blank), {
      ...blank, outline: removed.outline, planText: { point: 'Earlier local words' },
    }).command;
    const result = applyCommand(combined, confirmed(blank));
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { outline: removed.outline } } });
    if (result.kind !== 'acknowledged') throw new Error('Removal refused');
    expect(result.snapshot.value?.planText).toBeUndefined();
  });

  it('lets the person discard the exact orphan but preserves replacement words and restored points', () => {
    const orphan = { ...removed, planText: { point: 'Shown paragraph', kept: 'Neighboring paragraph' } };
    const discard = prepareDomainCommand('owner', 'discard-orphan', confirmed(orphan),
      { ...orphan, planText: { ...orphan.planText, point: '' } }).command;

    expect(applyCommand(discard, confirmed(orphan))).toMatchObject({ kind: 'acknowledged', snapshot: {
      value: { planText: { point: '', kept: 'Neighboring paragraph' } },
    } });
    expect(applyCommand(discard, confirmed({ ...orphan, planText: { ...orphan.planText, point: 'Unseen replacement' } })))
      .toMatchObject({ kind: 'conflict', conflicts: [{ path: ['planText', 'point'], theirs: { value: 'Unseen replacement' } }] });
    expect(applyCommand(discard, confirmed({ ...orphan, outline: keptOutline })))
      .toMatchObject({ kind: 'conflict', conflicts: [{ path: ['planText', 'point'] }] });
  });
});
