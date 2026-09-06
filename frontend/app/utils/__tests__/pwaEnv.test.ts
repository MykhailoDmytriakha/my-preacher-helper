import { isIPadDevice, isStandalonePwa, isIPadStandalonePwa } from '../pwaEnv';

describe('pwaEnv', () => {
  describe('isIPadDevice', () => {
    it('detects iPad from classic iPad user agent', () => {
      const ua = 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
      expect(isIPadDevice(ua, 5)).toBe(true);
      expect(isIPadDevice(ua, 0)).toBe(true);
    });

    it('detects iPadOS in desktop-class mode (Macintosh UA with touch points > 1)', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
      expect(isIPadDevice(ua, 5)).toBe(true);
    });

    it('rejects macOS desktop Safari with Macintosh UA and no touch points', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
      expect(isIPadDevice(ua, 0)).toBe(false);
    });

    it('rejects iPhone user agent', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
      expect(isIPadDevice(ua, 5)).toBe(false);
    });

    it('rejects Windows Chrome user agent', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      expect(isIPadDevice(ua, 0)).toBe(false);
    });

    it('handles empty parameters safely', () => {
      expect(isIPadDevice('', 0)).toBe(false);
    });
  });

  describe('isStandalonePwa', () => {
    const originalMatchMedia = window.matchMedia;

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
      delete (navigator as { standalone?: boolean }).standalone;
    });

    it('returns true when display-mode: standalone matches', () => {
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }));

      expect(isStandalonePwa()).toBe(true);
    });

    it('returns true when navigator.standalone is true (iOS legacy)', () => {
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }));
      Object.defineProperty(navigator, 'standalone', {
        value: true,
        configurable: true,
        writable: true,
      });

      expect(isStandalonePwa()).toBe(true);
    });

    it('returns false in ordinary browser tab', () => {
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }));

      expect(isStandalonePwa()).toBe(false);
    });
  });

  describe('isIPadStandalonePwa', () => {
    afterEach(() => {
      delete (navigator as { standalone?: boolean }).standalone;
    });

    it('returns true when device is iPad and display mode is standalone', () => {
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
      }));
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
        configurable: true,
      });
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 5,
        configurable: true,
      });

      expect(isIPadStandalonePwa()).toBe(true);
    });
  });
});
