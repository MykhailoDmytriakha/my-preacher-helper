import '@testing-library/jest-dom';

import { getShareNotePath, getShareNoteUrl } from '@/utils/shareNoteUtils';

describe('shareNoteUtils', () => {
  const originalWindow = global.window;

  const setWindow = (value: any) => {
    Object.defineProperty(global, 'window', {
      value,
      configurable: true,
      writable: true,
    });
  };

  afterEach(() => {
    setWindow(originalWindow);
  });

  it('encodes the share note path', () => {
    expect(getShareNotePath('token 1/2')).toBe('/share/notes/token%201%2F2');
  });

  it('returns a relative path when window is undefined', () => {
    setWindow(undefined);

    expect(getShareNoteUrl('token-1')).toBe('/share/notes/token-1');
  });

  it('returns an absolute url when window is available', () => {
    expect(getShareNoteUrl('token-2')).toBe(`${window.location.origin}/share/notes/token-2`);
  });
});
