import { getFocusModeUrl, getStructureUrl, parseFocusModeFromUrl } from '../../app/utils/urlUtils';

describe('urlUtils', () => {
  describe('getFocusModeUrl', () => {
    it('should generate correct Focus mode URL with default base path', () => {
      const result = getFocusModeUrl('introduction', 'sermon123');
      
      expect(result).toBe('/structure?mode=focus&section=introduction&sermonId=sermon123');
    });

    it('should generate correct Focus mode URL with custom base path', () => {
      const result = getFocusModeUrl('main', 'sermon456', '/custom/structure');
      
      expect(result).toBe('/custom/structure?mode=focus&section=main&sermonId=sermon456');
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

    it('should always include sermonId parameter', () => {
      const result = getFocusModeUrl('introduction', 'sermon123');
      
      expect(result).toContain('sermonId=sermon123');
    });

    it('should handle empty string sermonId', () => {
      const result = getFocusModeUrl('introduction', '');
      
      expect(result).toBe('/structure?mode=focus&section=introduction&sermonId=');
    });

    it('should handle special characters in sermonId', () => {
      const result = getFocusModeUrl('introduction', 'sermon-123_456');
      
      expect(result).toBe('/structure?mode=focus&section=introduction&sermonId=sermon-123_456');
    });
  });

  describe('getStructureUrl', () => {
    it('should generate correct structure URL with default base path', () => {
      const result = getStructureUrl('sermon123');
      
      expect(result).toBe('/structure?sermonId=sermon123');
    });

    it('should generate correct structure URL with custom base path', () => {
      const result = getStructureUrl('sermon456', '/custom/structure');
      
      expect(result).toBe('/custom/structure?sermonId=sermon456');
    });

    it('should not include mode or section parameters', () => {
      const result = getStructureUrl('sermon123');
      
      expect(result).not.toContain('mode=');
      expect(result).not.toContain('section=');
      expect(result).toContain('sermonId=sermon123');
    });

    it('should handle empty string sermonId', () => {
      const result = getStructureUrl('');
      
      expect(result).toBe('/structure?sermonId=');
    });

    it('should handle special characters in sermonId', () => {
      const result = getStructureUrl('sermon-123_456');
      
      expect(result).toBe('/structure?sermonId=sermon-123_456');
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

    it('should parse Focus mode URL correctly', () => {
      const url = 'https://example.com/structure?mode=focus&section=introduction&sermonId=sermon123';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: 'focus',
        section: 'introduction',
        sermonId: 'sermon123'
      });
    });

    it('should parse URL with only some parameters', () => {
      const url = 'https://example.com/structure?mode=focus&sermonId=sermon123';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: 'focus',
        section: null,
        sermonId: 'sermon123'
      });
    });

    it('should parse URL with no parameters', () => {
      const url = 'https://example.com/structure';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: null,
        section: null,
        sermonId: null
      });
    });

    it('should handle URL with different parameter order', () => {
      const url = 'https://example.com/structure?sermonId=sermon123&section=main&mode=focus';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: 'focus',
        section: 'main',
        sermonId: 'sermon123'
      });
    });

    it('should handle URL with duplicate parameters (takes first occurrence)', () => {
      const url = 'https://example.com/structure?mode=focus&section=introduction&section=main&sermonId=sermon123';
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
      const url = 'https://example.com/structure?mode=focus&section=introduction&sermonId=sermon-123_456';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: 'focus',
        section: 'introduction',
        sermonId: 'sermon-123_456'
      });
    });

    it('should handle URL with query parameters that are not mode, section, or sermonId', () => {
      const url = 'https://example.com/structure?mode=focus&section=introduction&sermonId=sermon123&otherParam=value';
      const result = parseFocusModeFromUrl(url);
      
      expect(result).toEqual({
        mode: 'focus',
        section: 'introduction',
        sermonId: 'sermon123'
      });
    });
  });
});
