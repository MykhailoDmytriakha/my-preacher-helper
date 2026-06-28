import { boardLayoutClass, showLayoutToggle } from '../sectionLayout';

describe('boardLayoutClass', () => {
  it('1 visible section -> a single focus column (regardless of layout pref)', () => {
    expect(boardLayoutClass(1, false)).toBe('flex flex-col');
    expect(boardLayoutClass(1, true)).toBe('flex flex-col');
  });

  it('2 visible sections -> side by side when horizontal, stacked when vertical', () => {
    expect(boardLayoutClass(2, false)).toBe('grid grid-cols-1 md:grid-cols-2 gap-6');
    expect(boardLayoutClass(2, true)).toBe('flex flex-col gap-6');
  });

  it('3 visible sections -> three columns when horizontal, stacked when vertical', () => {
    expect(boardLayoutClass(3, false)).toBe('grid grid-cols-1 md:grid-cols-3 gap-6');
    expect(boardLayoutClass(3, true)).toBe('flex flex-col gap-6');
  });
});

describe('showLayoutToggle', () => {
  it('is hidden for a single (focus) section', () => {
    expect(showLayoutToggle(1)).toBe(false);
  });

  it('is shown for a pair and for all three (a pair can stack too)', () => {
    expect(showLayoutToggle(2)).toBe(true);
    expect(showLayoutToggle(3)).toBe(true);
  });
});
