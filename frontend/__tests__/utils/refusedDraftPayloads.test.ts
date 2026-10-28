import {
  validOutlineConflict,
  validPrayerCoreConflict,
  validPrayerStatusConflict,
  validTemplateConflict,
} from '@/utils/refusedDraftPayloads';

const outline = {
  introduction: [{ id: 'intro', text: 'Open' }],
  main: [],
  conclusion: [],
};

const validValues = [
  [validPrayerCoreConflict, {
    actualRevision: 1,
    payload: { id: 'prayer-a', updates: { title: 'Prayer', description: 'Keep praying' }, envelopeExtra: true },
  }, 'prayer-a'],
  [validPrayerStatusConflict, {
    actualRevision: 0,
    payload: { id: 'prayer-a', status: 'answered', answerText: 'Thank you', ignoredEnvelopeField: 3 },
  }, 'prayer-a'],
  [validOutlineConflict, {
    actualRevision: 3,
    payload: { outline, serverOutline: outline, baseOutline: null, resolution: 'local', reviewWhole: true },
  }, 'sermon-a'],
  [validTemplateConflict, {
    actualRevision: 4,
    payload: { templateId: 'template-a', label: '', updates: { name: 'Sunday', structure: outline } },
  }, 'template-a'],
] as const;

describe('refused draft payload validators', () => {
  it.each(validValues)('accepts valid conflict payloads without changing them', (validator, value, documentId) => {
    const before = JSON.stringify(value);
    expect(validator(value, documentId)).toBe(true);
    expect(JSON.stringify(value)).toBe(before);
  });

  it('accepts a legacy outline conflict without baseOutline', () => {
    expect(validOutlineConflict({ actualRevision: 1, payload: { outline, serverOutline: outline } }, 'sermon-a')).toBe(true);
  });

  it('rejects a malformed primary outline even when its server and base outlines are valid', () => {
    expect(validOutlineConflict({
      actualRevision: 1,
      payload: { outline: { introduction: [null], main: [], conclusion: [] }, serverOutline: outline, baseOutline: outline },
    }, 'sermon-a')).toBe(false);
  });

  it('rejects null and missing primary outlines independently', () => {
    expect(validOutlineConflict({ actualRevision: 1, payload: { outline: null, serverOutline: outline, baseOutline: outline } }, 'sermon-a')).toBe(false);
    expect(validOutlineConflict({ actualRevision: 1, payload: { serverOutline: outline, baseOutline: outline } }, 'sermon-a')).toBe(false);
  });

  it.each([
    [validPrayerCoreConflict, { actualRevision: 1, payload: null }, 'prayer-a'],
    [validPrayerCoreConflict, { actualRevision: 1, payload: { id: 'prayer-a', updates: null } }, 'prayer-a'],
    [validOutlineConflict, { actualRevision: 1, payload: { serverOutline: { introduction: [null], main: [], conclusion: [] } } }, 'sermon-a'],
    [validPrayerCoreConflict, { actualRevision: 1, payload: { id: 'other', updates: {} } }, 'prayer-a'],
    [validTemplateConflict, { actualRevision: 1, payload: { templateId: 'other', label: 'A', updates: {} } }, 'template-a'],
    [validPrayerStatusConflict, { actualRevision: 1, payload: { id: 'prayer-a', status: 'pending' } }, 'prayer-a'],
    [validPrayerCoreConflict, { actualRevision: 1, payload: { id: 'prayer-a', updates: { title: { text: 'object' } } } }, 'prayer-a'],
    [validPrayerCoreConflict, { actualRevision: 1, payload: { id: 'prayer-a', updates: { tags: { value: ['tag'] } } } }, 'prayer-a'],
    [validTemplateConflict, { actualRevision: 1, payload: { templateId: 'template-a', label: 'A', updates: { name: { value: 'Name' } } } }, 'template-a'],
    [validPrayerCoreConflict, { actualRevision: 1.5, payload: { id: 'prayer-a', updates: {} } }, 'prayer-a'],
    [validPrayerCoreConflict, { actualRevision: -1, payload: { id: 'prayer-a', updates: {} } }, 'prayer-a'],
    [validPrayerCoreConflict, { actualRevision: 1, payload: { id: 'prayer-a', updates: { inventedField: 'x' } } }, 'prayer-a'],
    [validTemplateConflict, { actualRevision: 1, payload: { templateId: 'template-a', label: 'A', updates: { inventedField: 'x' } } }, 'template-a'],
  ] as const)('rejects invalid envelope, identity, or resource fields', (validator, value, documentId) => {
    expect(validator(value, documentId)).toBe(false);
  });

  it('rejects non-object conflict records and non-finite revisions', () => {
    expect(validPrayerCoreConflict(null, 'prayer-a')).toBe(false);
    expect(validPrayerCoreConflict([], 'prayer-a')).toBe(false);
    expect(validPrayerCoreConflict({ actualRevision: Number.POSITIVE_INFINITY, payload: { id: 'prayer-a', updates: {} } }, 'prayer-a')).toBe(false);
  });

  it('allows empty update maps', () => {
    expect(validPrayerCoreConflict({ actualRevision: 0, payload: { id: 'prayer-a', updates: {} } }, 'prayer-a')).toBe(true);
    expect(validTemplateConflict({ actualRevision: 0, payload: { templateId: 'template-a', label: 'A', updates: {} } }, 'template-a')).toBe(true);
  });

  it('does not mutate any input value', () => {
    const inputs: Array<[typeof validPrayerCoreConflict, unknown, string]> = [
      [validPrayerCoreConflict, { actualRevision: 1, payload: { id: 'prayer-a', updates: { title: 'Prayer' } } }, 'prayer-a'],
      [validPrayerStatusConflict, { actualRevision: 1, payload: { id: 'prayer-a', status: 'active', answerText: '' } }, 'prayer-a'],
      [validOutlineConflict, { actualRevision: 1, payload: { outline, serverOutline: null, baseOutline: outline } }, 'sermon-a'],
      [validTemplateConflict, { actualRevision: 1, payload: { templateId: 'template-a', label: 'A', updates: { structure: outline } } }, 'template-a'],
    ];
    inputs.forEach(([validator, value, documentId]) => {
      const before = JSON.stringify(value);
      expect(validator(value, documentId)).toBe(true);
      expect(JSON.stringify(value)).toBe(before);
    });
  });
});
