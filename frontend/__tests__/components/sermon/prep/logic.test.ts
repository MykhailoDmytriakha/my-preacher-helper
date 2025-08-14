import { getActiveStepId } from '@/components/sermon/prep/logic';

describe('prep logic: getActiveStepId', () => {
  it('returns spiritual when readAndPrayed is false/undefined', () => {
    expect(getActiveStepId({} as any)).toBe('spiritual');
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: false } } as any)).toBe('spiritual');
  });

  it('returns textContext when readAndPrayed is true but readWholeBookOnce is false', () => {
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true } } as any)).toBe('textContext');
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: false } } as any)).toBe('textContext');
  });

  it('returns exegeticalPlan when both spiritual and readWholeBookOnce are true', () => {
    // With stricter gating, still textContext until notes and repeated words are provided
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: true } } as any)).toBe('textContext');
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: true, contextNotes: '' } } as any)).toBe('textContext');
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: true, contextNotes: 'Some context' } } as any)).toBe('textContext');
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: true, contextNotes: 'Some context', repeatedWords: [] } } as any)).toBe('textContext');
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: true, contextNotes: 'Some context', repeatedWords: ['love', 'faith'] } } as any)).toBe('exegeticalPlan');
  });
});


