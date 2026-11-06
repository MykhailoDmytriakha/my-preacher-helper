import { boardLayoutClass, showLayoutToggle } from '../sectionLayout';

describe('boardLayoutClass', () => {
  it('1 visible section -> a single focus column (regardless of layout pref)', () => {
    expect(boardLayoutClass(1, false)).toBe('flex flex-col');
    expect(boardLayoutClass(1, true)).toBe('flex flex-col');
  });

  it('2 visible sections -> container-fit tracks when horizontal, stacked when vertical', () => {
    expect(boardLayoutClass(2, false)).toBe('grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-x-4 gap-y-6');
    expect(boardLayoutClass(2, true)).toBe('flex flex-col gap-6');
  });

  it('3 visible sections -> container-fit tracks when horizontal, stacked when vertical', () => {
    expect(boardLayoutClass(3, false)).toBe('grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-x-4 gap-y-6');
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
