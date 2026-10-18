import { act, renderHook } from '@testing-library/react';

import { deviceChoice } from '@/utils/deviceChoice';

type Prefs = { on: boolean; size: number };
const DEFAULTS: Prefs = { on: false, size: 1 };
const parse = (raw: string | null): Prefs => {
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<Prefs>;
    return { on: value.on ?? DEFAULTS.on, size: value.size ?? DEFAULTS.size };
  } catch {
    return DEFAULTS;
  }
};

const choiceOf = (key: string, onOtherTab?: () => void) => deviceChoice({ key, parse, fallback: DEFAULTS, onOtherTab });

/** The event a browser gives this page when another tab wrote the record. */
const heard = (key: string | null, area: Storage = window.localStorage) =>
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: key ? area.getItem(key) : null, storageArea: area }));

/** Another tab of the app — its own copy of the store — makes a choice, and this page hears of it. */
function otherTabSaves(key: string, change: Partial<Prefs>) {
  choiceOf(key).save(change);
  heard(key);
}

describe('a choice kept on this device', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('reads storage once and writes every change through', () => {
    window.localStorage.setItem('test:once', JSON.stringify({ on: true }));
    const choice = choiceOf('test:once');
    expect(choice.read()).toEqual({ on: true, size: 1 });
    expect(choice.read()).toBe(choice.read());
    expect(choice.save({ size: 3 })).toBe('kept');
    expect(parse(window.localStorage.getItem('test:once'))).toEqual({ on: true, size: 3 });
    // A record changed behind the page's back, with no event, is not taken mid-visit.
    window.localStorage.setItem('test:once', JSON.stringify({ on: false, size: 9 }));
    expect(choice.read()).toEqual({ on: true, size: 3 });
    choice.resetForTests();
    expect(choice.read()).toEqual({ on: false, size: 9 });
  });

  it('keeps the choice for the visit when storage refuses it, and says so', () => {
    const choice = choiceOf('test:refused');
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      expect(choice.save({ on: true })).toBe('memory-only');
    } finally {
      setItem.mockRestore();
    }
    expect(choice.read()).toEqual({ on: true, size: 1 });
  });

  it('takes what another tab chose, and what storage holds when another tab cleared it', () => {
    const onOtherTab = jest.fn();
    const choice = choiceOf('test:tabs', onOtherTab);
    const { result } = renderHook(() => choice.useChoice());
    act(() => {
      choice.save({ on: true });
    });
    act(() => otherTabSaves('other:key', { size: 7 }));
    expect(onOtherTab).not.toHaveBeenCalled();
    act(() => otherTabSaves('test:tabs', { size: 5 }));
    expect(result.current).toEqual({ on: true, size: 5 });
    act(() => {
      window.localStorage.clear();
      heard(null);
    });
    expect(result.current).toEqual(DEFAULTS);
    expect(onOtherTab).toHaveBeenCalledTimes(2);
  });

  // Codex, 2026-10-17: a screen closed while another tab changed the choice must not write the old one back.
  it('hears another tab while no screen shows the choice', () => {
    const choice = choiceOf('test:closed');
    const { unmount } = renderHook(() => choice.useChoice());
    act(() => {
      choice.save({ on: true });
    });
    unmount();
    otherTabSaves('test:closed', { on: false });
    choice.save({ size: 2 });
    expect(parse(window.localStorage.getItem('test:closed'))).toEqual({ on: false, size: 2 });
  });

  // Codex, 2026-10-17: an event is queued with its own moment's value; it must not undo a newer choice
  // here — saved, refused by storage, or read back wrong.
  it.each([
    ['saved', () => undefined],
    ['refused by storage', () => jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); })],
    ['while reads give the old record', () => jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify({ on: false }))],
  ])('an older event from another tab does not undo a newer choice %s', (_name, fault) => {
    const choice = choiceOf('test:late');
    const { result } = renderHook(() => choice.useChoice());
    choiceOf('test:late').save({ on: false, size: 4 });
    const older = new StorageEvent('storage', { key: 'test:late', newValue: window.localStorage.getItem('test:late'), storageArea: window.localStorage });
    const spy = fault();
    try {
      act(() => {
        choice.save({ on: true });
      });
      act(() => {
        window.dispatchEvent(older);
      });
      expect(result.current.on).toBe(true);
    } finally {
      spy?.mockRestore();
    }
  });

  // Codex, 2026-10-17: right after a release a tab still runs the earlier code and writes records without
  // the moment; a page that has not chosen anything yet follows them.
  it('a page that has not chosen yet follows a tab running the earlier version', () => {
    window.localStorage.setItem('test:legacy', JSON.stringify({ on: false }));
    const choice = choiceOf('test:legacy');
    const { result } = renderHook(() => choice.useChoice());
    act(() => {
      window.localStorage.setItem('test:legacy', JSON.stringify({ on: true }));
      heard('test:legacy');
    });
    expect(result.current.on).toBe(true);
  });

  // Codex, 2026-10-17: a read that failed must not stand in for the record, or the next save writes defaults.
  it('a first read that failed is tried again, so a later save keeps what was stored', () => {
    window.localStorage.setItem('test:failed-read', JSON.stringify({ on: true, size: 1 }));
    const choice = choiceOf('test:failed-read');
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      expect(choice.read()).toBe(DEFAULTS);
    } finally {
      getItem.mockRestore();
    }
    choice.save({ size: 2 });
    expect(parse(window.localStorage.getItem('test:failed-read'))).toEqual({ on: true, size: 2 });
  });

  it('a change of another kind of storage leaves the choice alone', () => {
    const choice = choiceOf('test:session');
    const { result } = renderHook(() => choice.useChoice());
    act(() => {
      choice.save({ on: true });
    });
    act(() => {
      window.sessionStorage.clear();
      heard(null, window.sessionStorage);
    });
    expect(result.current.on).toBe(true);
  });

  it('the server and hydration draw the fallback', () => {
    const choice = choiceOf('test:server');
    const windowSpy = jest.spyOn(globalThis, 'window', 'get').mockReturnValue(undefined as unknown as Window & typeof globalThis);
    try {
      expect(choice.read()).toBe(DEFAULTS);
    } finally {
      windowSpy.mockRestore();
    }
  });
});
