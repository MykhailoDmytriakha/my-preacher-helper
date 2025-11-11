import { runScenarios } from '../../test-utils/scenarioRunner';
import { SERMON_SECTION_COLORS, UI_COLORS, getSectionStyling, getTagStyling, getFocusModeButtonColors } from '../../app/utils/themeColors';

describe('themeColors', () => {
  describe('SERMON_SECTION_COLORS', () => {
    it('defines expected palette values', async () => {
      await runScenarios(
        [
          {
            name: 'base/light/dark colors',
            run: () => {
              expect(SERMON_SECTION_COLORS.introduction.base).toBe('#d97706');
              expect(SERMON_SECTION_COLORS.mainPart.light).toBe('#3b82f6');
              expect(SERMON_SECTION_COLORS.conclusion.dark).toBe('#15803d');
            }
          },
          {
            name: 'background classes',
            run: () => {
              expect(SERMON_SECTION_COLORS.introduction.bg).toBe('bg-amber-50');
              expect(SERMON_SECTION_COLORS.mainPart.darkBg).toBe('bg-blue-900/20');
            }
          },
          {
            name: 'border classes',
            run: () => {
              expect(SERMON_SECTION_COLORS.mainPart.border).toBe('border-blue-200');
              expect(SERMON_SECTION_COLORS.mainPart.darkBorder).toBe('border-blue-800');
              expect(SERMON_SECTION_COLORS.conclusion.darkBorder).toBe('border-green-800');
            }
          }
        ]
      );
    });
  });

  describe('getSectionStyling', () => {
    it('maps styling per section', async () => {
      await runScenarios(
        ['introduction', 'mainPart', 'conclusion'].map((section) => ({
          name: `${section} styling`,
          run: () => {
            const styling = getSectionStyling(section as any);
            expect(styling.headerBg).toContain('bg-');
            expect(styling.border).toContain('border-');
            expect(styling.badge).toContain('bg-');
          }
        }))
      );
    });
  });

  describe('getTagStyling', () => {
    it('returns tag styling per section', async () => {
      await runScenarios(
        ['introduction', 'mainPart', 'conclusion'].map((section) => ({
          name: `${section} tag styling`,
          run: () => {
            const styling = getTagStyling(section as any);
            expect(styling.bg).toContain('bg-');
            expect(styling.text).toContain('text-');
          }
        }))
      );
    });
  });

  describe('getFocusModeButtonColors', () => {
    it('returns focus mode button tokens', async () => {
      await runScenarios(
        ['introduction', 'mainPart', 'conclusion'].map((section) => ({
          name: `${section} button colors`,
          run: () => {
            const colors = getFocusModeButtonColors(section as any);
            expect(colors.bg).toContain('bg-');
            expect(colors.hover).toContain('hover:bg-');
            expect(colors.text).toBe('text-white');
          }
        }))
      );
    });
  });

  describe('UI_COLORS', () => {
    it('defines palette for structure/plan/switcher buttons', async () => {
      await runScenarios(
        [
          {
            name: 'structure button colors',
            run: () => {
              expect(UI_COLORS.button.structure.bg).toBe('bg-amber-600');
              expect(UI_COLORS.button.structure.text).toBe('text-white');
            }
          },
          {
            name: 'plan button colors',
            run: () => {
              expect(UI_COLORS.button.plan.bg).toBe('bg-blue-600');
              expect(UI_COLORS.button.plan.darkHover).toBe('hover:bg-blue-400');
            }
          },
          {
            name: 'switcher gradients and borders',
            run: () => {
              expect(UI_COLORS.button.switcher.gradient).toBe('from-amber-500 to-blue-500');
              expect(UI_COLORS.button.switcher.darkBorder).toBe('border-gray-700');
            }
          }
        ]
      );
    });
  });
});
