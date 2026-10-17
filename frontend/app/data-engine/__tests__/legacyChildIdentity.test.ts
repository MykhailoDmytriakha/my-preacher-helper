import { applyCommand, diffFields } from '../protocol';
import type { DataCommand, DocumentData, Json, ResourceSnapshot } from '../types';

const node = (id: string, title = id, children?: Json[]): DocumentData => ({ id, title, ...(children ? { children } : {}) });
const sermon = (preparation: DocumentData): DocumentData => ({ userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-01-01', thoughts: [], preparation });
const twins = [node('old', 'First words'), node('old', 'Second words')];
const answer = (base: DocumentData, next: DocumentData, collection = 'sermons') => {
  const resource = { collection, id: 'record' };
  const command: DataCommand = { protocol: 1, owner: 'owner', operationId: 'edit', resource, generation: 'g1', dependsOn: [], kind: 'update', changes: diffFields(base, next) };
  const snapshot: ResourceSnapshot = { resource, value: base, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } };
  return applyCommand(command, snapshot);
};

describe('legacy child identities do not block ordinary work', () => {
  it.each([
    ['sibling exegetical points', { exegeticalPlan: twins, authorIntent: 'Old' }, { exegeticalPlan: twins, authorIntent: 'New words' }],
    ['nested exegetical points', { exegeticalPlan: [node('parent', 'Parent', twins)], authorIntent: 'Old' }, { exegeticalPlan: [node('parent', 'Parent', twins)], authorIntent: 'New words' }],
    ['homiletic points', { homileticPlan: { updatedPlan: twins, modernTranslation: 'Old' } }, { homileticPlan: { updatedPlan: twins, modernTranslation: 'New words' } }],
  ] as [string, DocumentData, DocumentData][])('saves an unrelated preparation field beside old duplicate %s', (_name, before, after) => {
    const base = sermon(before), original = JSON.stringify(base);
    expect(answer(base, sermon(after))).toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: after } } });
    expect(JSON.stringify(base)).toBe(original);
  });

  it('saves a council topic title beside unchanged duplicate questions', () => {
    const topic = { id: 'topic', title: 'Old', questions: [{ id: 'question', question: 'First' }, { id: 'question', question: 'Second' }], options: [] };
    const base = { userId: 'owner', title: 'Council', status: 'preparing', topics: [topic] }, next = { ...base, topics: [{ ...topic, title: 'New title' }] };
    expect(answer(base, next, 'councils')).toMatchObject({ kind: 'acknowledged', snapshot: { value: { topics: next.topics } } });
  });

  it('edits a unique outline point beside unchanged legacy duplicate points', () => {
    const outline = { introduction: [{ id: 'old', text: 'First words' }], main: [{ id: 'old', text: 'Second words' }], conclusion: [{ id: 'unique', text: 'Conclusion' }] };
    const base = { ...sermon({}), outline }, next = { ...base, outline: { ...outline, conclusion: [{ id: 'unique', text: 'Conclusion corrected' }] } };
    expect(answer(base, next)).toMatchObject({ kind: 'acknowledged', snapshot: { value: { outline: next.outline } } });
  });

  it('keeps a legacy nested duplicate associated with its parent after a parent reorder', () => {
    const first = node('first', 'First', twins), second = node('second');
    expect(answer(sermon({ exegeticalPlan: [first, second] }), sermon({ exegeticalPlan: [second, first] }))).toMatchObject({ kind: 'acknowledged' });
  });

  it('allows removing one old duplicate without rewriting the remaining words', () => {
    const next = sermon({ exegeticalPlan: [twins[1]], authorIntent: 'New words' });
    expect(answer(sermon({ exegeticalPlan: twins, authorIntent: 'Old' }), next)).toMatchObject({ kind: 'acknowledged', snapshot: { value: next } });
  });

  it.each([
    ['another duplicate identity', [node('new'), node('new'), ...twins]],
    ['an additional copy of the old identity', [...twins, node('old', 'Third words')]],
  ] as [string, Json[]][])('refuses %s even though a legacy duplicate already exists', (_name, plan) => {
    expect(answer(sermon({ exegeticalPlan: twins }), sermon({ exegeticalPlan: plan }))).toMatchObject({ kind: 'refused', code: 'invalid-document' });
  });

  it('does not grant an old duplicate to a different parent list', () => {
    const before = [node('first', 'First', twins), node('second')], after = [node('first'), node('second', 'Second', twins)];
    expect(answer(sermon({ exegeticalPlan: before }), sermon({ exegeticalPlan: after }))).toMatchObject({ kind: 'refused', code: 'invalid-document' });
  });

  it('still refuses a malformed field beside an old duplicate', () => {
    const old = { exegeticalPlan: twins, spiritual: { readAndPrayedConfirmed: 'invalid' }, authorIntent: 'Old' };
    expect(answer(sermon(old), sermon({ ...old, authorIntent: 'New' }))).toMatchObject({ kind: 'refused', code: 'invalid-document' });
  });

  it('never admits duplicates into a new document', () => {
    const resource = { collection: 'sermons', id: 'new' };
    const command: DataCommand = { protocol: 1, owner: 'owner', operationId: 'create', resource, generation: null, dependsOn: [], kind: 'create', value: sermon({ exegeticalPlan: twins }) };
    expect(applyCommand(command, { resource, value: null, metadata: null })).toMatchObject({ kind: 'refused', code: 'invalid-document' });
  });

  it('saves an unrelated field when duplicate parents hold unchanged nested duplicates', () => {
    const plan = [node('parent', 'First parent', twins), node('parent', 'Second parent', twins)];
    expect(answer(sermon({ exegeticalPlan: plan, authorIntent: 'Old' }), sermon({ exegeticalPlan: plan, authorIntent: 'New' }))).toMatchObject({ kind: 'acknowledged' });
  });

  it('does not guess an address when a duplicate moves between indistinguishable parent IDs', () => {
    const before = [node('parent', 'First parent', twins), node('parent', 'Second parent')];
    const after = [node('parent', 'First parent'), node('parent', 'Second parent', twins)];
    expect(answer(sermon({ exegeticalPlan: before }), sermon({ exegeticalPlan: after }))).toMatchObject({ kind: 'refused', code: 'invalid-document' });
  });

  it('does not let one old invalid meeting date excuse a second invalid date with the same ID', () => {
    const meetings = [{ id: 'meeting', date: '2', createdAt: '2026-01-01' }, { id: 'meeting', date: '2026-01-02', createdAt: '2026-01-01' }];
    const base = { userId: 'owner', meetingDates: meetings }, next = { ...base, meetingDates: meetings.map(row => ({ ...row, date: '2' })) };
    expect(answer(base, next, 'groups')).toMatchObject({ kind: 'refused', code: 'invalid-document' });
  });

  it('does not let one old orphaned thought excuse breaking another thought with the same ID', () => {
    const thoughts: DocumentData[] = [{ id: 'thought', text: 'First', tags: [], date: '2026-01-01', outlinePointId: 'missing' }, { id: 'thought', text: 'Second', tags: [], date: '2026-01-01' }];
    const base = { ...sermon({}), thoughts }, next = { ...base, thoughts: thoughts.map(row => ({ ...row, outlinePointId: 'missing' })) };
    expect(answer(base, next)).toMatchObject({ kind: 'refused', code: 'invalid-document' });
  });

  it('does not replace different legacy words with another copy addressed by the same ID', () => {
    expect(answer(sermon({ exegeticalPlan: twins }), sermon({ exegeticalPlan: [twins[0], twins[0]] }))).toMatchObject({ kind: 'refused', code: 'invalid-document' });
  });

  it('refuses an authored-word change to globally duplicated outline points', () => {
    const outline = { introduction: [{ id: 'old', text: 'First' }], main: [{ id: 'old', text: 'Second' }], conclusion: [] };
    const base = { ...sermon({}), outline }, next = { ...base, outline: { ...outline, main: [{ id: 'old', text: 'Changed' }] } };
    expect(answer(base, next)).toMatchObject({ kind: 'refused', code: 'invalid-document' });
  });

  it('lets an unrelated unique parent change beside unchanged ambiguous parent groups', () => {
    const parents = [node('parent', 'First parent', twins), node('parent', 'Second parent'), node('unique', 'Before')];
    const next = [node('unique', 'After'), parents[0], parents[1]];
    expect(answer(sermon({ exegeticalPlan: parents }), sermon({ exegeticalPlan: next }))).toMatchObject({ kind: 'acknowledged' });
  });

  it('does not allow ordinary material writes to bypass duplicate section membership protection', () => {
    const sections = [{ id: 'section', title: 'First', noteIds: ['note'] }, { id: 'section', title: 'Second', noteIds: ['note'] }];
    const base = { userId: 'owner', sections }, next = { ...base, sections: sections.map(row => ({ ...row, noteIds: [] })) };
    expect(answer(base, next, 'studyMaterials')).toMatchObject({ kind: 'refused', code: 'invalid-document' });
  });
});
