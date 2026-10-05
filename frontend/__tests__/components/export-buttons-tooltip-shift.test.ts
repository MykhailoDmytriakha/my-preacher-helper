import { tooltipShift } from '@/components/export-buttons/tooltipShift';
import { clampTooltipCentre } from '@/utils/tooltipPlacement';

describe('tooltip placement', () => {
  const box = (left: number, width: number) => ({ left, right: left + width });

  it('leaves a tooltip that fits where it is', () => {
    expect(tooltipShift(box(100, 120), 390)).toBe(0);
  });

  it('slides a tooltip that runs off the right edge back inside, 12px from it', () => {
    // The audio reason above the rightmost export button on a phone: 230..490 on a 390 screen.
    expect(tooltipShift(box(230, 260), 390)).toBe(-112);
  });

  it('slides a tooltip that runs off the left edge back inside', () => {
    expect(tooltipShift(box(-40, 200), 390)).toBe(52);
  });

  it('is the same rule the shared Tooltip places its panel by', () => {
    expect(clampTooltipCentre(360, 260, 390)).toBe(248);
    expect(clampTooltipCentre(60, 200, 390)).toBe(112);
    expect(clampTooltipCentre(160, 120, 390)).toBe(160);
  });
});
