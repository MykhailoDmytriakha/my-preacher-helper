import { extractSearchSnippets } from '../../app/utils/searchUtils';

describe('searchUtils', () => {
  describe('extractSearchSnippets', () => {
    it('returns empty array when content or query is empty', () => {
      expect(extractSearchSnippets('', 'test')).toEqual([]);
      expect(extractSearchSnippets('test content', '')).toEqual([]);
      expect(extractSearchSnippets('   ', 'test')).toEqual([]);
      expect(extractSearchSnippets('test content', '   ')).toEqual([]);
    });

    it('returns empty array when no matches are found', () => {
      expect(extractSearchSnippets('hello world', 'missing')).toEqual([]);
    });

    it('extracts a tight snippet around a single match with word boundaries', () => {
      const result = extractSearchSnippets('alpha beta gamma', 'beta', 0);
      expect(result).toEqual(['beta']);
    });

    it('merges nearby matches into a single snippet', () => {
      const content = 'alpha beta gamma beta delta';
      const result = extractSearchSnippets(content, 'beta', 1);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('beta');
      expect(result[0].match(/beta/g)?.length).toBeGreaterThanOrEqual(2);
    });
  });
});
