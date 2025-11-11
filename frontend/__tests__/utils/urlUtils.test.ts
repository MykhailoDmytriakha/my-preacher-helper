import { getFocusModeUrl, getStructureUrl, parseFocusModeFromUrl } from '../../app/utils/urlUtils';
import { runScenarios } from '@test-utils/scenarioRunner';

describe('urlUtils', () => {
  describe('getFocusModeUrl', () => {
    it('aggregates all focus URL scenarios', async () => {
      await runScenarios([
        {
          name: 'default base path',
          run: () => {
            expect(getFocusModeUrl('introduction', 'sermon123')).toBe(
              '/sermons/sermon123/structure?mode=focus&section=introduction',
            );
          },
        },
        {
          name: 'custom base path',
          run: () => {
            expect(getFocusModeUrl('main', 'sermon456', '/custom/structure')).toBe(
              '/custom/structure?mode=focus&section=main',
            );
          },
        },
        {
          name: 'section variations and mode flag',
          run: () => {
            ['introduction', 'main', 'conclusion'].forEach((section) => {
              const url = getFocusModeUrl(section as any, 'sermon123');
              expect(url).toContain(`section=${section}`);
              expect(url).toContain('mode=focus');
            });
          },
        },
        {
          name: 'empty and special sermonIds',
          run: () => {
            expect(getFocusModeUrl('introduction', '')).toBe('/structure?mode=focus&section=introduction');
            expect(getFocusModeUrl('introduction', 'sermon-123_456')).toBe(
              '/sermons/sermon-123_456/structure?mode=focus&section=introduction',
            );
          },
        },
      ]);
    });
  });

  describe('getStructureUrl', () => {
    it('covers base path and parameter rules', async () => {
      await runScenarios([
        {
          name: 'default structure path',
          run: () => expect(getStructureUrl('sermon123')).toBe('/sermons/sermon123/structure'),
        },
        {
          name: 'custom path',
          run: () => expect(getStructureUrl('sermon456', '/custom/structure')).toBe('/custom/structure'),
        },
        {
          name: 'omits mode/section params',
          run: () => {
            const url = getStructureUrl('sermon123');
            expect(url).not.toContain('mode=');
            expect(url).not.toContain('section=');
          },
        },
        {
          name: 'empty and special sermonIds',
          run: () => {
            expect(getStructureUrl('')).toBe('/structure');
            expect(getStructureUrl('sermon-123_456')).toBe('/sermons/sermon-123_456/structure');
          },
        },
      ]);
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

    it('parses a wide variety of focus URLs in one consolidated test', async () => {
      const cases = [
        {
          name: 'nested structure route',
          url: 'https://example.com/sermons/sermon123/structure?mode=focus&section=introduction',
          expected: { mode: 'focus', section: 'introduction', sermonId: 'sermon123' },
        },
        {
          name: 'missing section parameter',
          url: 'https://example.com/sermons/sermon123/structure?mode=focus',
          expected: { mode: 'focus', section: null, sermonId: 'sermon123' },
        },
        {
          name: 'no query params',
          url: 'https://example.com/sermons/sermon123/structure',
          expected: { mode: null, section: null, sermonId: 'sermon123' },
        },
        {
          name: 'legacy query-based sermonId',
          url: 'https://example.com/structure?mode=focus&sermonId=sermon123',
          expected: { mode: 'focus', section: null, sermonId: 'sermon123' },
        },
        {
          name: 'different parameter order',
          url: 'https://example.com/sermons/sermon123/structure?section=main&mode=focus',
          expected: { mode: 'focus', section: 'main', sermonId: 'sermon123' },
        },
        {
          name: 'duplicate params keep first occurrence',
          url: 'https://example.com/sermons/sermon123/structure?mode=focus&section=introduction&section=main',
          expected: { mode: 'focus', section: 'introduction', sermonId: 'sermon123' },
        },
        {
          name: 'empty parameter values',
          url: 'https://example.com/structure?mode=&section=&sermonId=',
          expected: { mode: '', section: '', sermonId: '' },
        },
        {
          name: 'malformed URL fallback',
          url: 'not-a-valid-url',
          expected: { mode: null, section: null, sermonId: null },
        },
        {
          name: 'special characters in sermonId',
          url: 'https://example.com/sermons/sermon-123_456/structure?mode=focus&section=introduction',
          expected: { mode: 'focus', section: 'introduction', sermonId: 'sermon-123_456' },
        },
        {
          name: 'irrelevant query params ignored',
          url: 'https://example.com/sermons/sermon123/structure?mode=focus&section=introduction&otherParam=value',
          expected: { mode: 'focus', section: 'introduction', sermonId: 'sermon123' },
        },
      ];

      await runScenarios(
        cases.map(({ name, url, expected }) => ({
          name,
          run: () => expect(parseFocusModeFromUrl(url)).toEqual(expected),
        })),
      );
    });
  });
});
