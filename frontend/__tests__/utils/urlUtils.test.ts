import { getFocusModeUrl, getStructureUrl, parseFocusModeFromUrl } from '../../app/utils/urlUtils';

describe('urlUtils', () => {
  describe('getFocusModeUrl', () => {
    it('should generate correct Focus mode URL with default base path', () => {
      const result = getFocusModeUrl('introduction', 'sermon123');
      
      expect(result).toBe('/sermons/sermon123/structure?mode=focus&section=introduction');
    });

    it('should generate correct Focus mode URL with custom base path', () => {
      const result = getFocusModeUrl('main', 'sermon456', '/custom/structure');
      
      expect(result).toBe('/custom/structure?mode=focus&section=main');
    });

    it('should handle different section types', () => {
      const introUrl = getFocusModeUrl('introduction', 'sermon123');
      const mainUrl = getFocusModeUrl('main', 'sermon123');
      const conclusionUrl = getFocusModeUrl('conclusion', 'sermon123');
      
      expect(introUrl).toContain('section=introduction');
      expect(mainUrl).toContain('section=main');
      expect(conclusionUrl).toContain('section=conclusion');
    });

    it('should always include mode=focus parameter', () => {
      const result = getFocusModeUrl('introduction', 'sermon123');
      
      expect(result).toContain('mode=focus');
    });

    it('should handle empty string sermonId', () => {
      const result = getFocusModeUrl('introduction', '');
      
      expect(result).toBe('/structure?mode=focus&section=introduction');
    });

    it('should handle special characters in sermonId', () => {
      const result = getFocusModeUrl('introduction', 'sermon-123_456');
      
      expect(result).toBe('/sermons/sermon-123_456/structure?mode=focus&section=introduction');
    });
  });

  describe('getStructureUrl', () => {
    it('should generate correct structure URL with default base path', () => {
      const result = getStructureUrl('sermon123');
      
      expect(result).toBe('/sermons/sermon123/structure');
    });

    it('should generate correct structure URL with custom base path', () => {
      const result = getStructureUrl('sermon456', '/custom/structure');
      
      expect(result).toBe('/custom/structure');
    });

    it('should not include mode or section parameters', () => {
      const result = getStructureUrl('sermon123');
      
      expect(result).not.toContain('mode=');
      expect(result).not.toContain('section=');
      expect(result).toBe('/sermons/sermon123/structure');
    });

    it('should handle empty string sermonId', () => {
      const result = getStructureUrl('');
      
      expect(result).toBe('/structure');
    });

    it('should handle special characters in sermonId', () => {
      const result = getStructureUrl('sermon-123_456');
      
      expect(result).toBe('/sermons/sermon-123_456/structure');
    });
  });

  describe('parseFocusModeFromUrl', () => {
    beforeEach(() => {
      // Mock window.location.origin for tests
      Object.defineProperty(window, 'location', {
        value: { origin: 'https://example.com' },
        writable: true
      });
    });

    it('should parse Focus mode URL correctly for nested structure route', () => {
      const url = 'https://example.com/sermons/sermon123/structure?mode=focus&section=introduction';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: 'focus',
        section: 'introduction',
        sermonId: 'sermon123'
      });
    });

    it('should parse URL with only some parameters', () => {
      const url = 'https://example.com/sermons/sermon123/structure?mode=focus';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: 'focus',
        section: null,
        sermonId: 'sermon123'
      });
    });

    it('should parse URL with no parameters but sermon in path', () => {
      const url = 'https://example.com/sermons/sermon123/structure';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: null,
        section: null,
        sermonId: 'sermon123'
      });
    });

    it('should fall back to query-based sermonId for legacy URLs', () => {
      const url = 'https://example.com/structure?mode=focus&sermonId=sermon123';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: 'focus',
        section: null,
        sermonId: 'sermon123'
      });
    });

    it('should handle URL with different parameter order', () => {
      const url = 'https://example.com/sermons/sermon123/structure?section=main&mode=focus';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: 'focus',
        section: 'main',
        sermonId: 'sermon123'
      });
    });

    it('should handle URL with duplicate parameters (takes first occurrence)', () => {
      const url = 'https://example.com/sermons/sermon123/structure?mode=focus&section=introduction&section=main';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: 'focus',
        section: 'introduction', // First occurrence
        sermonId: 'sermon123'
      });
    });

    it('should handle URL with empty parameter values', () => {
      const url = 'https://example.com/structure?mode=&section=&sermonId=';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: '',
        section: '',
        sermonId: ''
      });
    });

    it('should handle malformed URL gracefully', () => {
      const malformedUrl = 'not-a-valid-url';
      const result = parseFocusModeFromUrl(malformedUrl);
      
      expect(result).toEqual({
        mode: null,
        section: null,
        sermonId: null
      });
    });

    it('should handle URL with special characters in parameters', () => {
      const url = 'https://example.com/sermons/sermon-123_456/structure?mode=focus&section=introduction';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: 'focus',
        section: 'introduction',
        sermonId: 'sermon-123_456'
      });
    });

    it('should handle URL with query parameters that are not mode, section, or sermonId', () => {
      const url = 'https://example.com/sermons/sermon123/structure?mode=focus&section=introduction&otherParam=value';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: 'focus',
        section: 'introduction',
        sermonId: 'sermon123'
      });
    });
  });
});
