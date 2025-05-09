import { SERMON_SECTION_COLORS, getSectionStyling, getTagStyling } from '../../app/utils/themeColors';

describe('themeColors', () => {
  describe('SERMON_SECTION_COLORS', () => {
    it('should define base colors for introduction, mainPart, and conclusion', () => {
      expect(SERMON_SECTION_COLORS.introduction.base).toBe('#2563eb');
      expect(SERMON_SECTION_COLORS.mainPart.base).toBe('#7e22ce');
      expect(SERMON_SECTION_COLORS.conclusion.base).toBe('#16a34a');
    });

    it('should define light colors for introduction, mainPart, and conclusion', () => {
      expect(SERMON_SECTION_COLORS.introduction.light).toBe('#3b82f6');
      expect(SERMON_SECTION_COLORS.mainPart.light).toBe('#a855f7');
      expect(SERMON_SECTION_COLORS.conclusion.light).toBe('#22c55e');
    });

    it('should define dark colors for introduction, mainPart, and conclusion', () => {
      expect(SERMON_SECTION_COLORS.introduction.dark).toBe('#1d4ed8');
      expect(SERMON_SECTION_COLORS.mainPart.dark).toBe('#6b21a8');
      expect(SERMON_SECTION_COLORS.conclusion.dark).toBe('#15803d');
    });

    it('should define background classes for each section', () => {
      expect(SERMON_SECTION_COLORS.introduction.bg).toBe('bg-blue-50');
      expect(SERMON_SECTION_COLORS.mainPart.bg).toBe('bg-purple-50');
      expect(SERMON_SECTION_COLORS.conclusion.bg).toBe('bg-green-50');
    });

    it('should define dark mode background classes for each section', () => {
      expect(SERMON_SECTION_COLORS.introduction.darkBg).toBe('bg-blue-900/20');
      expect(SERMON_SECTION_COLORS.mainPart.darkBg).toBe('bg-purple-900/20');
      expect(SERMON_SECTION_COLORS.conclusion.darkBg).toBe('bg-green-900/20');
    });
  });

  describe('getSectionStyling', () => {
    it('should return correct styling for introduction section', () => {
      const styling = getSectionStyling('introduction');
      
      expect(styling.headerBg).toBe('bg-blue-50 dark:bg-blue-900/20');
      expect(styling.headerHover).toBe('hover:bg-blue-100 dark:hover:bg-blue-800/30');
      expect(styling.border).toBe('border-blue-200 dark:border-blue-800');
      expect(styling.dragBg).toBe('bg-blue-50 dark:bg-blue-900/20');
      expect(styling.badge).toContain('bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200');
    });

    it('should return correct styling for mainPart section', () => {
      const styling = getSectionStyling('mainPart');
      
      expect(styling.headerBg).toBe('bg-purple-50 dark:bg-purple-900/20');
      expect(styling.headerHover).toBe('hover:bg-purple-100 dark:hover:bg-purple-800/30');
      expect(styling.border).toBe('border-purple-200 dark:border-purple-800');
      expect(styling.dragBg).toBe('bg-purple-50 dark:bg-purple-900/20');
      expect(styling.badge).toContain('bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-200');
    });

    it('should return correct styling for conclusion section', () => {
      const styling = getSectionStyling('conclusion');
      
      expect(styling.headerBg).toBe('bg-green-50 dark:bg-green-900/20');
      expect(styling.headerHover).toBe('hover:bg-green-100 dark:hover:bg-green-800/30');
      expect(styling.border).toBe('border-green-200 dark:border-green-800');
      expect(styling.dragBg).toBe('bg-green-50 dark:bg-green-900/20');
      expect(styling.badge).toContain('bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200');
    });
  });

  describe('getTagStyling', () => {
    it('should return correct tag styling for introduction tags', () => {
      const styling = getTagStyling('introduction');
      
      expect(styling.bg).toBe('bg-blue-50 dark:bg-blue-900');
      expect(styling.text).toBe('text-blue-800 dark:text-blue-200');
    });

    it('should return correct tag styling for mainPart tags', () => {
      const styling = getTagStyling('mainPart');
      
      expect(styling.bg).toBe('bg-purple-50 dark:bg-purple-900');
      expect(styling.text).toBe('text-purple-800 dark:text-purple-200');
    });

    it('should return correct tag styling for conclusion tags', () => {
      const styling = getTagStyling('conclusion');
      
      expect(styling.bg).toBe('bg-green-50 dark:bg-green-900');
      expect(styling.text).toBe('text-green-800 dark:text-green-200');
    });
  });
}); 