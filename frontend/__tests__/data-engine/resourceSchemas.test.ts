import { validateResourceDocument } from '@/data-engine/resourceSchemas';

import type { DocumentData } from '@/data-engine/types';

const times = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const owner = { userId: 'owner' };
const outline = { introduction: [], main: [], conclusion: [] };
const fixtures: Record<string, DocumentData> = {
  sermons: { ...owner, title: 'Title', verse: 'John 1:1', date: '2026-01-01', thoughts: [] },
  studyNotes: { ...owner, ...times, content: '', scriptureRefs: [], tags: [], isDraft: true },
  studyMaterials: { ...owner, ...times, title: 'Title', type: 'study', noteIds: [] },
  groups: { ...owner, ...times, title: '', status: 'draft', templates: [], flow: [] },
  series: { ...owner, ...times, theme: '', bookOrTopic: '', sermonIds: [], status: 'draft' },
  prayerRequests: { ...owner, ...times, title: 'Prayer', status: 'active', updates: [] },
  prayerCategories: { ...owner, createdAt: times.createdAt, name: 'Category' },
  serviceOrders: { ...owner, ...times, title: 'Order', steps: [], rank: 0 },
  councils: { ...owner, ...times, title: '', status: 'preparing', topics: [] },
  planTemplates: { ...owner, ...times, name: 'Template', structure: outline },
  tags: { ...owner, name: 'Tag', color: '#123456', required: false },
  users: { enablePrepMode: true },
};

describe('pure resource document validation', () => {
  it.each(Object.entries(fixtures))('accepts the existing %s factory shape without changing it', (collection, value) => {
    const before = JSON.stringify(value);
    expect(() => validateResourceDocument(collection, value, { kind: 'create' })).not.toThrow();
    expect(JSON.stringify(value)).toBe(before);
  });

  it.each(Object.keys(fixtures).filter(collection => collection !== 'users'))('rejects missing required create fields for %s', collection => {
    expect(() => validateResourceDocument(collection, {}, { kind: 'create' })).toThrow();
  });

  it.each([
    ['sermons', 'title', {}], ['sermons', 'thoughts', {}], ['sermons', 'planText', { point: 3 }],
    ['studyNotes', 'content', []], ['studyNotes', 'tags', 'text'], ['studyNotes', 'isDraft', 'yes'],
    ['studyMaterials', 'type', 'invalid'], ['groups', 'status', 'held'], ['groups', 'flow', [null]],
    ['series', 'items', [{ id: 'one', type: 'private', refId: 'r', position: 1 }]],
    ['prayerRequests', 'status', 'finished'], ['prayerCategories', 'color', 4],
    ['serviceOrders', 'rank', '1'], ['serviceOrders', 'catalogKey', 'made-up'],
    ['councils', 'topics', [{ id: 'topic', title: 'Topic', questions: {}, options: [] }]],
    ['planTemplates', 'structure', { introduction: [], main: [] }], ['tags', 'required', 1],
    ['users', 'preferredText', { providerId: 'untrusted', modelId: 'expensive' }],
    ['users', 'firstDayOfWeek', 'friday'], ['users', 'enablePrepMode', {}],
  ])('rejects malformed %s.%s', (collection, field, wrong) => {
    expect(() => validateResourceDocument(collection as string, { ...fixtures[collection as string], [field as string]: wrong } as DocumentData, { kind: 'update', changedFields: [field as string] })).toThrow();
  });

  it('keeps unknown fields and untouched malformed legacy fields intact during an unrelated update', () => {
    const legacy = { title: 'Changed', thoughts: 'legacy encoding', unknownHistory: { private: true }, rev: { core: 8 } };
    const original = JSON.stringify(legacy);
    expect(() => validateResourceDocument('sermons', legacy, { kind: 'update', changedFields: ['title'] })).not.toThrow();
    expect(JSON.stringify(legacy)).toBe(original);
    expect(() => validateResourceDocument('sermons', legacy, { kind: 'update', changedFields: ['thoughts'] })).toThrow();
  });

  it('rejects deletion of a required field but permits deletion of an optional field', () => {
    expect(() => validateResourceDocument('sermons', {}, { kind: 'update', changedFields: ['title'] })).toThrow();
    expect(() => validateResourceDocument('sermons', {}, { kind: 'update', changedFields: ['church'] })).not.toThrow();
  });

  it.each([
    ['sermons', 'scratch', { id: 'same', text: 'Text', createdAt: 'now' }],
    ['sermons', 'thoughts', { id: 'same', text: 'Text', tags: [], date: 'now' }],
    ['studyNotes', 'scriptureRefs', { id: 'same', book: 'John', chapter: 1 }],
    ['series', 'items', { id: 'same', type: 'sermon', refId: 'sermon', position: 0 }],
    ['prayerRequests', 'updates', { id: 'same', text: 'Text', createdAt: 'now' }],
    ['serviceOrders', 'steps', { id: 'same', title: 'Text' }],
    ['councils', 'topics', { id: 'same', title: 'Text', questions: [], options: [] }],
  ])('rejects ambiguous duplicate child IDs in %s.%s', (collection, field, child) => {
    expect(() => validateResourceDocument(collection as string, { [field as string]: [child, child] } as DocumentData, { kind: 'update', changedFields: [field as string] })).toThrow();
  });

  it('rejects duplicate outline IDs across sections and subpoints', () => {
    const invalidOutline = { introduction: [{ id: 'one', text: 'Intro' }], main: [{ id: 'main', text: 'Main', subPoints: [{ id: 'one', text: 'Duplicate', position: 0 }] }], conclusion: [] };
    expect(() => validateResourceDocument('sermons', { outline: invalidOutline }, { kind: 'update', changedFields: ['outline'] })).toThrow();
  });

  it('validates nested preparation and council data', () => {
    const preparation = { exegeticalPlan: [{ id: 'root', title: 'Root', children: [{ id: 'leaf', title: 'Leaf' }] }], spiritual: { readAndPrayedConfirmed: true }, homileticPlan: { sermonPlan: [{ id: 'one', title: 'One' }] } };
    expect(() => validateResourceDocument('sermons', { preparation }, { kind: 'update', changedFields: ['preparation'] })).not.toThrow();
    expect(() => validateResourceDocument('sermons', { preparation: { spiritual: { readAndPrayedConfirmed: 'yes' } } }, { kind: 'update', changedFields: ['preparation'] })).toThrow();
    expect(() => validateResourceDocument('councils', { topics: [{ id: 'topic', title: 'Topic', questions: [{ id: 'q', question: 'First' }, { id: 'q', question: 'Second' }], options: [] }] }, { kind: 'update', changedFields: ['topics'] })).toThrow();
  });

  it('preserves creation-only admission caps without imposing them on historical updates', () => {
    const large = { ...fixtures.sermons, scratch: Array.from({ length: 301 }, (_, index) => ({ id: `s${index}`, text: 'Text', createdAt: 'now' })) };
    expect(() => validateResourceDocument('sermons', large, { kind: 'create' })).toThrow('Too many scratch');
    expect(() => validateResourceDocument('sermons', large, { kind: 'update', changedFields: ['scratch'] })).not.toThrow();
    expect(() => validateResourceDocument('sermons', { ...fixtures.sermons, sourceNoteIds: Array.from({ length: 21 }, (_, index) => `note${index}`) }, { kind: 'create' })).toThrow('Too many source');
  });

  it('allows staged audio metadata before any generated audio exists', () => {
    expect(() => validateResourceDocument('sermons', { audioMetadata: { mode: 'raw', chunksCount: 1, lastOptimized: 'now' } }, { kind: 'update', changedFields: ['audioMetadata'] })).not.toThrow();
    expect(() => validateResourceDocument('sermons', { audioChunks: [{ text: 'Body', sectionId: 'mainPart', createdAt: 'now', index: 0 }] }, { kind: 'update', changedFields: ['audioChunks'] })).not.toThrow();
  });

  it('allows valid JSON maps at the Firestore depth limit and refuses deeper maps', () => {
    let value: DocumentData = { text: 'leaf' };
    for (let index = 0; index < 20; index++) value = { nested: value };
    expect(() => validateResourceDocument('users', value, { kind: 'update', changedFields: [] })).not.toThrow();
    expect(() => validateResourceDocument('users', { nested: value }, { kind: 'update', changedFields: [] })).toThrow('nesting depth');
  });

  it.each([
    { legacy: [[1]] }, { legacy: NaN }, { legacy: undefined }, { legacy: { ['__reserved__']: 1 } },
    { legacy: { ['x'.repeat(1501)]: true } },
  ])('refuses values Firestore cannot persist', value => {
    expect(() => validateResourceDocument('users', value as DocumentData, { kind: 'update', changedFields: [] })).toThrow();
  });

  it('rejects unknown resources and unknown changed fields with a typed validation error', () => {
    expect(() => validateResourceDocument('unknown', {}, { kind: 'create' })).toThrow('Unknown resource');
    try {
      validateResourceDocument('users', { paidTier: 'tier4' }, { kind: 'update', changedFields: ['paidTier'] });
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid-argument' });
    }
    expect(() => validateResourceDocument('users', null as unknown as DocumentData, { kind: 'create' })).toThrow('document object');
  });
});
