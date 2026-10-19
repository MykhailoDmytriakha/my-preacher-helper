import { outlineRecoveryValue } from '@/utils/outlineRecovery';
import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

const resources = { en, ru, uk };
const translate = (language: keyof typeof resources) => (key: string): string => {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], resources[language]);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${language} outline label: ${key}`);
  return value;
};
const sample = () => ({ introduction: [{ id: 'point', text: 'Authored heading\nExact second line', note: 'Remember these words', isReviewed: false,
  subPoints: [{ id: 'later', text: 'Later heading', position: 3 }, { id: 'first', text: 'First heading', position: -2, note: 'Subpoint reminder' }] }], main: [], conclusion: [] });

describe.each(['en', 'ru', 'uk'] as const)('outline recovery in %s', language => {
  const t = translate(language);
  it('uses familiar sections while retaining exact authored words, notes and review state in visible order', () => {
    const outline = sample();
    const prior = JSON.stringify(outline);
    expect(outlineRecoveryValue(t, outline)).toBe([
      t('structure.introduction'), '- Authored heading', '  Exact second line', '  Remember these words',
      `  ${t('structure.markedAsUnreviewed')}`, '  - First heading', '    Subpoint reminder', '  - Later heading', '',
      t('structure.mainPart'), '', t('structure.conclusion'),
    ].join('\n'));
    expect(JSON.stringify(outline)).toBe(prior);
    outline.introduction[0].isReviewed = true;
    expect(outlineRecoveryValue(t, outline)).toContain(t('structure.markedAsReviewed'));
  });
  it('shows all named sections for an explicit complete clear instead of hiding the outline', () => {
    expect(outlineRecoveryValue(t, { introduction: [], main: [], conclusion: [] })).toBe([
      t('structure.introduction'), t('structure.mainPart'), t('structure.conclusion'),
    ].join('\n\n'));
  });
});

it.each([
  null, [], 'Unknown words', { introduction: [], main: [] },
  { introduction: [], main: [], conclusion: [], futurePart: 'Unknown authored words' },
  { introduction: [{ id: 'point', text: 'Heading', futureWords: 'Retain this extension' }], main: [], conclusion: [] },
  { introduction: [{ id: 'point', text: 'Heading', note: { text: 'Unknown note shape' } }], main: [], conclusion: [] },
  { introduction: [{ id: 'point', text: 'Heading', isReviewed: 'unknown' }], main: [], conclusion: [] },
  { introduction: [{ id: 'point', text: 'Heading', subPoints: [{ id: 'child', text: 'Child', position: 0, futureWords: 'Retain child extension' }] }], main: [], conclusion: [] },
  { introduction: [{ id: 'point', text: 'Heading', subPoints: [{ id: 'child', text: 'Child' }] }], main: [], conclusion: [] },
  { introduction: [{ id: 'point', text: 'Heading' }], main: [{ id: 'point', text: 'Duplicate identity words' }], conclusion: [] },
  { introduction: ['thought-id'], main: [], conclusion: [] },
])('preserves the entire unsupported value for the raw fallback: %p', value => {
  expect(outlineRecoveryValue(translate('en'), value)).toBe(value);
});

it('does not sort or mutate frozen stored points and subpoints', () => {
  const outline = sample();
  outline.introduction.forEach(point => { point.subPoints.forEach(Object.freeze); Object.freeze(point.subPoints); Object.freeze(point); });
  Object.freeze(outline.introduction); Object.freeze(outline.main); Object.freeze(outline.conclusion); Object.freeze(outline);
  expect(outlineRecoveryValue(translate('en'), outline)).toContain('First heading\n    Subpoint reminder\n  - Later heading');
  expect(outline.introduction[0].subPoints.map(point => point.id)).toEqual(['later', 'first']);
});
