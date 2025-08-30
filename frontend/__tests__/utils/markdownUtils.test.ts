import { sanitizeMarkdown, isValidMarkdownContent } from '../../app/utils/markdownUtils';

describe('markdownUtils', () => {
  describe('sanitizeMarkdown', () => {
    it('should handle null and undefined input', () => {
      expect(sanitizeMarkdown(null as any)).toBe('');
      expect(sanitizeMarkdown(undefined as any)).toBe('');
    });

    it('should handle empty string', () => {
      expect(sanitizeMarkdown('')).toBe('');
    });

    it('should remove null characters', () => {
      expect(sanitizeMarkdown('Hello\0World')).toBe('HelloWorld');
    });

    it('should fix malformed asterisk patterns', () => {
      expect(sanitizeMarkdown('**Hello****World**')).toBe('**Hello**World**');
      expect(sanitizeMarkdown('***Hello***')).toBe('***Hello***');
    });

    it('should remove control characters', () => {
      expect(sanitizeMarkdown('Hello\x00\x1F\x7FWorld')).toBe('HelloWorld');
    });

    it('should trim whitespace', () => {
      expect(sanitizeMarkdown('  Hello World  ')).toBe('Hello World');
    });

    it('should handle the problematic Russian string from the error', () => {
      const problematicString = '* **Благодарим Бога**: *за прошедший год, за второй выезд, за новые семьи*,* **Позитивная динамика**: *Есть улучшения и ответы на молитвы*';
      const sanitized = sanitizeMarkdown(problematicString);
      expect(sanitized).toBe('* **Благодарим Бога**: *за прошедший год, за второй выезд, за новые семьи*,* **Позитивная динамика**: *Есть улучшения и ответы на молитвы*');
      expect(typeof sanitized).toBe('string');
    });
  });

  describe('isValidMarkdownContent', () => {
    it('should return false for null and undefined', () => {
      expect(isValidMarkdownContent(null as any)).toBe(false);
      expect(isValidMarkdownContent(undefined as any)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidMarkdownContent('')).toBe(false);
    });

    it('should return true for valid markdown', () => {
      expect(isValidMarkdownContent('**Hello World**')).toBe(true);
      expect(isValidMarkdownContent('*Hello World*')).toBe(true);
      expect(isValidMarkdownContent('Hello World')).toBe(true);
    });

    it('should return false for problematic patterns', () => {
      expect(isValidMarkdownContent('**Hello****World**')).toBe(false);
      expect(isValidMarkdownContent('***Hello***')).toBe(true);
      expect(isValidMarkdownContent('Hello\x00World')).toBe(false);
    });
  });
});
