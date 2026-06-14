import { sanitizeMarkdown, isValidMarkdownContent, normalizePlanPointHeadings, decodeBasicHtmlEntities, normalizePlanArrows } from '../../app/utils/markdownUtils';

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

  describe('normalizePlanPointHeadings', () => {
    it('returns empty for null/undefined/empty input', () => {
      expect(normalizePlanPointHeadings(null as unknown as string)).toBe('');
      expect(normalizePlanPointHeadings(undefined as unknown as string)).toBe('');
      expect(normalizePlanPointHeadings('')).toBe('');
    });

    it('promotes top-level "Label:" line followed by a numbered list to ### heading', () => {
      const input = 'Первые шаги и парадоксы в Писании:\n1. Быт. 9:21\n2. Быт. 14:18';
      const expected = '### Первые шаги и парадоксы в Писании\n1. Быт. 9:21\n2. Быт. 14:18';
      expect(normalizePlanPointHeadings(input)).toBe(expected);
    });

    it('promotes top-level "Label:" line followed by a bullet list', () => {
      const input = 'Повседневность и необходимость:\n- Обычный продукт\n- Хлеб и вино';
      const expected = '### Повседневность и необходимость\n- Обычный продукт\n- Хлеб и вино';
      expect(normalizePlanPointHeadings(input)).toBe(expected);
    });

    it('strips trailing colon from existing ### heading', () => {
      const input = '### Важные акценты:\n- Песнь Песней';
      const expected = '### Важные акценты\n- Песнь Песней';
      expect(normalizePlanPointHeadings(input)).toBe(expected);
    });

    it('does not promote a line without trailing colon', () => {
      const input = 'Вино в Ветхом Завете: от быта до святыни\n\nПервые шаги:\n1. Быт. 9:21';
      const result = normalizePlanPointHeadings(input);
      expect(result).toContain('Вино в Ветхом Завете: от быта до святыни');
      expect(result).toContain('### Первые шаги');
    });

    it('does not promote a "Label:" line that is not followed by a list', () => {
      const input = 'Замечание:\nЭто просто абзац без списка под ним.';
      const result = normalizePlanPointHeadings(input);
      expect(result).toBe(input);
    });

    it('does not touch indented or list-internal pseudo-labels', () => {
      const input = '- Обычный продукт питания:\n  1. Нав. 9:4\n  2. Суд. 19:19';
      const result = normalizePlanPointHeadings(input);
      expect(result).toBe(input);
    });

    it('preserves code blocks untouched', () => {
      const input = '```\nLabel:\n1. one\n2. two\n```';
      const result = normalizePlanPointHeadings(input);
      expect(result).toBe(input);
    });

    it('handles the mixed-hierarchy example end-to-end', () => {
      const input = [
        'Вино в Ветхом Завете: от быта до святыни',
        '',
        'Первые шаги и парадоксы в Писании:',
        '1. Быт. 9:21',
        '2. Быт. 14:18',
        '',
        'Повседневность и необходимость:',
        '- Обычный продукт питания:',
        '  1. Нав. 9:4',
        '',
        '### Опасности и мудрость',
        '- Притчи',
        '',
        '### Важные акценты:',
        '- Песнь Песней',
      ].join('\n');

      const result = normalizePlanPointHeadings(input);

      expect(result).toContain('Вино в Ветхом Завете: от быта до святыни');
      expect(result).toContain('### Первые шаги и парадоксы в Писании');
      expect(result).not.toContain('Первые шаги и парадоксы в Писании:');
      expect(result).toContain('### Повседневность и необходимость');
      expect(result).toContain('### Опасности и мудрость');
      expect(result).toContain('### Важные акценты\n- Песнь Песней');
      expect(result).not.toContain('### Важные акценты:');
      expect(result).toContain('- Обычный продукт питания:');
    });

    it('leaves a flat cue sheet with no labels alone', () => {
      const input = [
        'Стабильность -> турбулентность -> стабильность',
        '',
        'Бог знает, мы не знаем',
        '',
        '1. Что у нас в сердце?',
        '2. Научились ходить верою',
      ].join('\n');
      const result = normalizePlanPointHeadings(input);
      expect(result).toBe(input);
    });
  });

  describe('decodeBasicHtmlEntities', () => {
    it('handles null/undefined/empty', () => {
      expect(decodeBasicHtmlEntities(null as any)).toBe('');
      expect(decodeBasicHtmlEntities(undefined as any)).toBe('');
      expect(decodeBasicHtmlEntities('')).toBe('');
    });

    it('decodes the common entities', () => {
      expect(decodeBasicHtmlEntities('a -&gt; b')).toBe('a -> b');
      expect(decodeBasicHtmlEntities('&lt;tag&gt;')).toBe('<tag>');
      expect(decodeBasicHtmlEntities('she said &quot;hi&quot;')).toBe('she said "hi"');
      expect(decodeBasicHtmlEntities('it&#39;s')).toBe("it's");
    });

    it('decodes &amp; LAST so a real &amp;gt; collapses to &gt;, not >', () => {
      expect(decodeBasicHtmlEntities('Tom &amp; Jerry')).toBe('Tom & Jerry');
      expect(decodeBasicHtmlEntities('&amp;gt;')).toBe('&gt;');
    });
  });

  describe('normalizePlanArrows', () => {
    it('handles null/undefined/empty', () => {
      expect(normalizePlanArrows(null as any)).toBe('');
      expect(normalizePlanArrows(undefined as any)).toBe('');
      expect(normalizePlanArrows('')).toBe('');
    });

    it('canonicalizes every arrow spelling to a single →', () => {
      expect(normalizePlanArrows('a -> b -> c')).toBe('a → b → c');
      expect(normalizePlanArrows('a -&gt; b')).toBe('a → b');
      expect(normalizePlanArrows('a => b')).toBe('a → b');
      expect(normalizePlanArrows('a —> b')).toBe('a → b');
      expect(normalizePlanArrows('a-->b')).toBe('a → b');
      expect(normalizePlanArrows('a->b')).toBe('a → b');
    });

    it('leaves a bare → untouched (idempotent)', () => {
      const already = 'a → b → c';
      expect(normalizePlanArrows(already)).toBe(already);
      expect(normalizePlanArrows(normalizePlanArrows('a -> b'))).toBe('a → b');
    });

    it('does not touch a lone > (e.g. a blockquote marker)', () => {
      expect(normalizePlanArrows('> a quote')).toBe('> a quote');
    });
  });
});
