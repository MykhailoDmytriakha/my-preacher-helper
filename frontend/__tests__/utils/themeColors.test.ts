import { SERMON_SECTION_COLORS, UI_COLORS, getSectionStyling, getTagStyling, getFocusModeButtonColors } from '../../app/utils/themeColors';

describe('themeColors', () => {
  describe('SERMON_SECTION_COLORS', () => {
    it('should define base colors for introduction, mainPart, and conclusion', () => {
      expect(SERMON_SECTION_COLORS.introduction.base).toBe('#d97706');
      expect(SERMON_SECTION_COLORS.mainPart.base).toBe('#2563eb');
      expect(SERMON_SECTION_COLORS.conclusion.base).toBe('#16a34a');
    });

    it('should define light colors for introduction, mainPart, and conclusion', () => {
      expect(SERMON_SECTION_COLORS.introduction.light).toBe('#f59e0b');
      expect(SERMON_SECTION_COLORS.mainPart.light).toBe('#3b82f6');
      expect(SERMON_SECTION_COLORS.conclusion.light).toBe('#22c55e');
    });

    it('should define dark colors for introduction, mainPart, and conclusion', () => {
      expect(SERMON_SECTION_COLORS.introduction.dark).toBe('#b45309');
      expect(SERMON_SECTION_COLORS.mainPart.dark).toBe('#1d4ed8');
      expect(SERMON_SECTION_COLORS.conclusion.dark).toBe('#15803d');
    });

    it('should define background classes for each section', () => {
      expect(SERMON_SECTION_COLORS.introduction.bg).toBe('bg-amber-50');
      expect(SERMON_SECTION_COLORS.mainPart.bg).toBe('bg-blue-50');
      expect(SERMON_SECTION_COLORS.conclusion.bg).toBe('bg-green-50');
    });

    it('should define dark mode background classes for each section', () => {
      expect(SERMON_SECTION_COLORS.introduction.darkBg).toBe('bg-amber-900/40');
      expect(SERMON_SECTION_COLORS.mainPart.darkBg).toBe('bg-blue-900/20');
      expect(SERMON_SECTION_COLORS.conclusion.darkBg).toBe('bg-green-900/30');
    });

    it('should define border classes including updated mainPart values', () => {
      expect(SERMON_SECTION_COLORS.introduction.border).toBe('border-amber-200');
      expect(SERMON_SECTION_COLORS.introduction.darkBorder).toBe('border-amber-800');

      // Updated borders for mainPart
      expect(SERMON_SECTION_COLORS.mainPart.border).toBe('border-blue-200');
      expect(SERMON_SECTION_COLORS.mainPart.darkBorder).toBe('border-blue-800');

      expect(SERMON_SECTION_COLORS.conclusion.border).toBe('border-green-200');
      expect(SERMON_SECTION_COLORS.conclusion.darkBorder).toBe('border-green-800');
    });
  });

  describe('getSectionStyling', () => {
    it('should return correct styling for introduction section', () => {
      const styling = getSectionStyling('introduction');
      
      expect(styling.headerBg).toBe('bg-amber-50 dark:bg-amber-900/40');
      expect(styling.headerHover).toBe('hover:bg-amber-100 dark:hover:bg-amber-900/40');
      expect(styling.border).toBe('border-amber-200 dark:border-amber-800');
      expect(styling.dragBg).toBe('bg-amber-200 dark:bg-amber-700');
      expect(styling.badge).toContain('bg-amber-100 text-amber-800 dark:bg-amber-800 dark:text-amber-200');
    });

    it('should return correct styling for mainPart section', () => {
      const styling = getSectionStyling('mainPart');
      
      expect(styling.headerBg).toBe('bg-blue-50 dark:bg-blue-900/20');
      expect(styling.headerHover).toBe('hover:bg-blue-100 dark:hover:bg-blue-900/40');
      expect(styling.border).toBe('border-blue-200 dark:border-blue-800');
      expect(styling.dragBg).toBe('bg-blue-200 dark:bg-blue-700');
      expect(styling.badge).toContain('bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200');
    });

    it('should return correct styling for conclusion section', () => {
      const styling = getSectionStyling('conclusion');
      
      expect(styling.headerBg).toBe('bg-green-50 dark:bg-green-900/30');
      expect(styling.headerHover).toBe('hover:bg-green-100 dark:hover:bg-green-900/40');
      expect(styling.border).toBe('border-green-200 dark:border-green-800');
      expect(styling.dragBg).toBe('bg-green-200 dark:bg-green-700');
      expect(styling.badge).toContain('bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200');
    });
  });

  describe('getTagStyling', () => {
    it('should return correct tag styling for introduction tags', () => {
      const styling = getTagStyling('introduction');
      
      expect(styling.bg).toBe('bg-amber-50 dark:bg-amber-900/60');
      expect(styling.text).toBe('text-amber-800 dark:text-amber-200');
    });

    it('should return correct tag styling for mainPart tags', () => {
      const styling = getTagStyling('mainPart');
      
      expect(styling.bg).toBe('bg-blue-50 dark:bg-blue-900/60');
      expect(styling.text).toBe('text-blue-800 dark:text-blue-200');
    });

    it('should return correct tag styling for conclusion tags', () => {
      const styling = getTagStyling('conclusion');
      
      expect(styling.bg).toBe('bg-green-50 dark:bg-green-900/60');
      expect(styling.text).toBe('text-green-800 dark:text-green-200');
    });
  });

  describe('getFocusModeButtonColors', () => {
    it('should return correct button colors for introduction section', () => {
      const colors = getFocusModeButtonColors('introduction');
      
      expect(colors.bg).toBe('bg-amber-500');
      expect(colors.hover).toBe('hover:bg-amber-600');
      expect(colors.text).toBe('text-white');
    });

    it('should return correct button colors for mainPart section', () => {
      const colors = getFocusModeButtonColors('mainPart');
      
      expect(colors.bg).toBe('bg-blue-500');
      expect(colors.hover).toBe('hover:bg-blue-600');
      expect(colors.text).toBe('text-white');
    });

    it('should return correct button colors for conclusion section', () => {
      const colors = getFocusModeButtonColors('conclusion');
      
      expect(colors.bg).toBe('bg-green-500');
      expect(colors.hover).toBe('hover:bg-green-600');
      expect(colors.text).toBe('text-white');
    });
  });

  describe('UI_COLORS', () => {
    describe('button structure', () => {
      it('should define correct structure button colors', () => {
        expect(UI_COLORS.button.structure.bg).toBe('bg-amber-600');
        expect(UI_COLORS.button.structure.hover).toBe('hover:bg-amber-700');
        expect(UI_COLORS.button.structure.darkBg).toBe('bg-amber-500');
        expect(UI_COLORS.button.structure.darkHover).toBe('hover:bg-amber-400');
        expect(UI_COLORS.button.structure.text).toBe('text-white');
      });
    });

    describe('button plan', () => {
      it('should define correct plan button colors', () => {
        expect(UI_COLORS.button.plan.bg).toBe('bg-blue-600');
        expect(UI_COLORS.button.plan.hover).toBe('hover:bg-blue-700');
        expect(UI_COLORS.button.plan.darkBg).toBe('bg-blue-500');
        expect(UI_COLORS.button.plan.darkHover).toBe('hover:bg-blue-400');
        expect(UI_COLORS.button.plan.text).toBe('text-white');
      });
    });

    describe('button switcher', () => {
      it('should define correct switcher button colors', () => {
        expect(UI_COLORS.button.switcher.gradient).toBe('from-amber-500 to-blue-500');
        expect(UI_COLORS.button.switcher.darkGradient).toBe('from-amber-400 to-blue-400');
        expect(UI_COLORS.button.switcher.border).toBe('border-gray-200');
        expect(UI_COLORS.button.switcher.darkBorder).toBe('border-gray-700');
        expect(UI_COLORS.button.switcher.bg).toBe('bg-white');
        expect(UI_COLORS.button.switcher.darkBg).toBe('bg-gray-800');
        expect(UI_COLORS.button.switcher.activeText).toBe('text-white');
        expect(UI_COLORS.button.switcher.inactiveText).toBe('text-gray-700');
        expect(UI_COLORS.button.switcher.darkInactiveText).toBe('text-gray-200');
      });
    });
  });
}); 
