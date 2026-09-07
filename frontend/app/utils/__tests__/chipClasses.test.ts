import { buildChipClasses, CHIP_SHAPE_CLASSES, CHIP_SIZE_CLASSES } from '@/utils/chipClasses';
import { CHIP_TONES, type ChipTone } from '@/utils/themeColors';

const TONES = Object.keys(CHIP_TONES) as ChipTone[];

describe('buildChipClasses', () => {
  it('gives every tone the identical shape', () => {
    for (const tone of TONES) {
      const classes = buildChipClasses({ tone });
      for (const token of CHIP_SHAPE_CLASSES.split(' ')) {
        expect(classes.split(' ')).toContain(token);
      }
    }
  });

  it('changes only the padding between the two sizes', () => {
    const small = buildChipClasses({ tone: 'emerald', size: 'sm' }).split(' ');
    const medium = buildChipClasses({ tone: 'emerald', size: 'md' }).split(' ');

    const onlyInSmall = small.filter((c) => !medium.includes(c));
    const onlyInMedium = medium.filter((c) => !small.includes(c));

    expect(new Set(onlyInSmall)).toEqual(
      new Set(CHIP_SIZE_CLASSES.sm.split(' ').filter((c) => !CHIP_SIZE_CLASSES.md.includes(c)))
    );
    expect(new Set(onlyInMedium)).toEqual(
      new Set(CHIP_SIZE_CLASSES.md.split(' ').filter((c) => !CHIP_SIZE_CLASSES.sm.includes(c)))
    );
  });

  it('offers hover and a pointer only when the chip can be pressed', () => {
    const idle = buildChipClasses({ tone: 'emerald' });
    const pressable = buildChipClasses({ tone: 'emerald', interactive: true });

    expect(idle).not.toContain('cursor-pointer');
    expect(idle).not.toContain('hover:');
    expect(pressable).toContain('cursor-pointer');
    expect(pressable).toContain(CHIP_TONES.emerald.hover.split(' ')[0]);
  });

  it('swaps the plate for the ring when the chip is the chosen one', () => {
    const chosen = buildChipClasses({ tone: 'emerald', selected: true });

    expect(chosen).toContain('ring-2');
    // The resting plate is replaced, not layered under the selected one.
    expect(chosen).not.toContain('bg-emerald-100');
  });

  it('contributes no colour for the hand-coloured family', () => {
    expect(buildChipClasses({ tone: 'custom' })).not.toMatch(/\bbg-[a-z]+-\d/);
  });

  it('falls back to a neutral chip of the app size when asked for nothing', () => {
    expect(buildChipClasses()).toBe(buildChipClasses({ tone: 'neutral', size: 'md' }));
  });
});
