import { isEngineOwned } from '../engineOwnedCollections';
import { getResourcePolicy } from '../protocol';
import { validateResourceDocument } from '../resourceSchemas';

/**
 * The pastor's own places in a topic of the word for the occasion (`hooks/useOccasionPlaces.ts`):
 * one document per place, written only through the engine, made and removed, never edited.
 */
const place = (overrides: Record<string, unknown> = {}) => ({
  userId: 'owner',
  occasionId: 'assurance',
  ref: { bible: 'rst', book: 'Romans', chapter: 8, fromVerse: 16 },
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  ...overrides,
});

describe('occasionPlaces — the pastor\'s own places', () => {
  it('is a collection the engine owns, its person writing the topic and the place and removing them', () => {
    expect(isEngineOwned('occasionPlaces')).toBe(true);
    const policy = getResourcePolicy('occasionPlaces');
    expect(policy.ownerField).toBe('userId');
    expect(policy.allowDelete).toBe(true);
    expect(policy.writableFields).toEqual(expect.arrayContaining(['occasionId', 'ref']));
  });

  it('keeps a place with its Bible, a chapter and optional verses', () => {
    expect(() => validateResourceDocument('occasionPlaces', place(), { kind: 'create' })).not.toThrow();
    expect(() => validateResourceDocument('occasionPlaces', place({ ref: { bible: 'kjv', book: 'Psalms', chapter: 23 } }), { kind: 'create' })).not.toThrow();
    expect(() => validateResourceDocument('occasionPlaces', place({ ref: { bible: 'ubio', book: 'John', chapter: 14, fromVerse: 1, toVerse: 3 } }), { kind: 'create' })).not.toThrow();
  });

  it('refuses a place that does not say where it stands: no Bible, an unknown Bible, no chapter, no topic', () => {
    expect(() => validateResourceDocument('occasionPlaces', place({ ref: { book: 'Romans', chapter: 8 } }), { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('occasionPlaces', place({ ref: { bible: 'nrsv', book: 'Romans', chapter: 8 } }), { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('occasionPlaces', place({ ref: { bible: 'rst', book: 'Romans' } }), { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('occasionPlaces', place({ occasionId: '' }), { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('occasionPlaces', place({ note: 'words' }), { kind: 'create' })).toThrow('Unknown field in new document');
  });
});
