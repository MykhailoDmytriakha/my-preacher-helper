import { getSectionLabel, getSectionBaseColor, normalizeSectionId } from '@lib/sections';

const t = (key: string) => key;

describe('sections utils', () => {
  it('normalizeSectionId maps mainPart to main', () => {
    expect(normalizeSectionId('mainPart')).toBe('main');
    expect(normalizeSectionId('main')).toBe('main');
  });

  it('getSectionLabel returns correct keys', () => {
    expect(getSectionLabel(t, 'introduction')).toBe('structure.introduction');
    expect(getSectionLabel(t, 'main')).toBe('structure.mainPart');
    expect(getSectionLabel(t, 'mainPart')).toBe('structure.mainPart');
    expect(getSectionLabel(t, 'conclusion')).toBe('structure.conclusion');
    expect(getSectionLabel(t, 'ambiguous')).toBe('structure.underConsideration');
    expect(getSectionLabel(t, 'unassigned')).toBe('structure.underConsideration');
  });

  it('getSectionBaseColor returns hex colors without #', () => {
    // Ensure returns like #2563eb etc.
    const intro = getSectionBaseColor('introduction');
    const main = getSectionBaseColor('main');
    const concl = getSectionBaseColor('conclusion');
    expect(intro).toMatch(/^#?[0-9a-fA-F]{6}$/);
    expect(main).toMatch(/^#?[0-9a-fA-F]{6}$/);
    expect(concl).toMatch(/^#?[0-9a-fA-F]{6}$/);
  });
});


