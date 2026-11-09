import {
  accountChoice, connectAccount, MOVE_UP_AFTER_MS, resetAccountChoicesForTests, setAccountReading, setAccountWriter,
  type AccountWriter,
} from '@/utils/accountChoice';

/*
 * THE READER'S SETTINGS IN THE ACCOUNT (the owner, 2026-11-02: «берём аккаунт»). While the settings bridge is connected the
 * screen shows what the settings editor holds, a change goes to the editor at once as the fields changed, and the device
 * keeps only a copy under the account's name and the record of the version before. Each case of Codex's three reviews of
 * 02.11 stands here.
 */
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
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const writerOf = (work: AccountWriter = async () => undefined) => jest.fn<ReturnType<AccountWriter>, Parameters<AccountWriter>>(work);

let made = 0;
let key = '';
/** A store of its own each test: the registry keeps one store per part, as the app's modules do. */
const storeOf = () => accountChoice({ part: 'trail', key, parse, fallback: DEFAULTS });
/** The editor holding `trail`, as the bridge says it. */
const editorHolds = (trail: Prefs | null, answered = true) => setAccountReading(trail ? { trail } : null, answered);

beforeEach(() => {
  jest.useRealTimers();
  window.localStorage.clear();
  resetAccountChoicesForTests();
  key = `test:account-${made += 1}`;
});

describe('a choice kept in the account', () => {
  it('hands a change to the editor as the fields changed, shown at once over the editor\'s copy', () => {
    const store = storeOf();
    connectAccount('A');
    const writer = writerOf();
    setAccountWriter(writer);
    editorHolds({ on: false, size: 3 });
    expect(store.save({ size: 100 })).toBe('kept');
    expect(store.read()).toEqual({ on: false, size: 100 });
    expect(writer).toHaveBeenLastCalledWith('trail', { size: 100 }, { on: false, size: 3 });
  });

  it('shows what the editor holds, not what the device recorded before', () => {
    window.localStorage.setItem(key, JSON.stringify({ on: false, size: 3 }));
    const store = storeOf();
    connectAccount('A');
    editorHolds({ on: true, size: 9 }, false);
    expect(store.read()).toEqual({ on: true, size: 9 });
  });

  // Codex r1: a change made before the editor could take it lived only in memory and was lost on reload.
  it('is unavailable while the account cannot be written, and changes nothing', () => {
    const store = storeOf();
    connectAccount('A');
    editorHolds({ on: false, size: 3 });
    expect(store.save({ size: 100 })).toBe('unavailable');
    expect(store.read()).toEqual({ on: false, size: 3 });
  });

  // Codex r2–r3: one account's change, or its copy kept when storage refused the owner's name, reached the next account.
  it('never shows one account\'s choice to another, its change on the way included', async () => {
    let finish = () => {};
    const store = storeOf();
    const disconnect = connectAccount('A');
    setAccountWriter(writerOf(() => new Promise<void>((resolve) => { finish = resolve; })));
    editorHolds({ on: true, size: 100 });
    store.save({ size: 77 });
    disconnect();
    connectAccount('B');
    const writerB = writerOf();
    setAccountWriter(writerB);
    expect(store.read()).toEqual(DEFAULTS);
    editorHolds(null);
    expect(store.read()).toEqual(DEFAULTS);
    store.save({ on: true });
    expect(writerB).toHaveBeenLastCalledWith('trail', { on: true }, {});
    finish();
    await flush();
  });

  it('draws the account\'s last part kept under its name while the editor opens', () => {
    window.localStorage.setItem(`${key}@A`, JSON.stringify({ on: true, size: 50 }));
    const store = storeOf();
    connectAccount('A');
    expect(store.read()).toEqual({ on: true, size: 50 });
  });

  it('keeps the account\'s part under the account\'s name, never over the earlier record', () => {
    window.localStorage.setItem(key, JSON.stringify({ on: false, size: 3 }));
    storeOf();
    connectAccount('A');
    editorHolds({ on: true, size: 9 });
    expect(parse(window.localStorage.getItem(`${key}@A`))).toEqual({ on: true, size: 9 });
    expect(parse(window.localStorage.getItem(key))).toEqual({ on: false, size: 3 });
  });

  it('moves the earlier record up once the server answered without the part, after a moment, and marks it moved', async () => {
    jest.useFakeTimers();
    window.localStorage.setItem(key, JSON.stringify({ on: true, size: 5 }));
    const store = storeOf();
    connectAccount('A');
    const writer = writerOf();
    setAccountWriter(writer);
    editorHolds(null, false);
    expect(store.read()).toEqual({ on: true, size: 5 });
    jest.advanceTimersByTime(MOVE_UP_AFTER_MS * 2);
    expect(writer).not.toHaveBeenCalled();
    editorHolds(null, true);
    jest.advanceTimersByTime(MOVE_UP_AFTER_MS - 1);
    expect(writer).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(writer).toHaveBeenCalledWith('trail', {}, { on: true, size: 5 });
    await Promise.resolve();
    await Promise.resolve();
    expect(window.localStorage.getItem(`${key}:moved`)).toBe('1');
  });

  it('sends nothing when the device never chose', () => {
    jest.useFakeTimers();
    storeOf();
    connectAccount('A');
    const writer = writerOf();
    setAccountWriter(writer);
    editorHolds(null);
    jest.advanceTimersByTime(MOVE_UP_AFTER_MS * 2);
    expect(writer).not.toHaveBeenCalled();
  });

  // Codex r1: a store loaded after the account answered with no `reading` never moved its record up.
  it('moves the record up when its store loads after the account answered without the part', () => {
    jest.useFakeTimers();
    connectAccount('A');
    const writer = writerOf();
    setAccountWriter(writer);
    editorHolds(null);
    window.localStorage.setItem(key, JSON.stringify({ on: true, size: 5 }));
    storeOf();
    jest.advanceTimersByTime(MOVE_UP_AFTER_MS);
    expect(writer).toHaveBeenCalledWith('trail', {}, { on: true, size: 5 });
  });

  it('does not move the record up when the part arrives within the moment', () => {
    jest.useFakeTimers();
    window.localStorage.setItem(key, JSON.stringify({ on: true, size: 5 }));
    const store = storeOf();
    connectAccount('A');
    const writer = writerOf();
    setAccountWriter(writer);
    editorHolds(null);
    editorHolds({ on: false, size: 2 });
    jest.advanceTimersByTime(MOVE_UP_AFTER_MS * 2);
    expect(writer).not.toHaveBeenCalled();
    expect(store.read()).toEqual({ on: false, size: 2 });
  });

  // Codex r2: the server's part waited outside the editor while a write was on its way.
  it('is unavailable while the server\'s copy of the part waits outside the editor, and moves nothing up', () => {
    jest.useFakeTimers();
    window.localStorage.setItem(key, JSON.stringify({ on: true, size: 5 }));
    const store = storeOf();
    connectAccount('A');
    const writer = writerOf();
    setAccountWriter(writer);
    // The editor holds another part, so `reading` itself is there: only the waiting copy of this part stands in the way.
    setAccountReading({ mine: { on: true, size: 1 } }, true, { trail: { on: false, size: 9 } });
    expect(store.save({ on: false })).toBe('unavailable');
    jest.advanceTimersByTime(MOVE_UP_AFTER_MS * 2);
    expect(writer).not.toHaveBeenCalled();
  });

  // Codex r3: `reading` absent from the editor while another part of it waited from the server — one conflict on the parent.
  it('creates nothing of `reading` while the editor has none of it and the server\'s waits', () => {
    const store = storeOf();
    connectAccount('A');
    setAccountWriter(writerOf());
    setAccountReading(null, true, { mine: { show: false } });
    expect(store.save({ size: 4 })).toBe('unavailable');
  });

  it('creates a part the editor does not hold only once the server has answered', () => {
    const store = storeOf();
    connectAccount('A');
    const writer = writerOf();
    setAccountWriter(writer);
    editorHolds(null, false);
    expect(store.save({ size: 4 })).toBe('unavailable');
    editorHolds({ on: false, size: 2 }, false);
    expect(store.save({ size: 4 })).toBe('kept');
    expect(writer).toHaveBeenCalledWith('trail', { size: 4 }, { on: false, size: 2 });
  });

  // Codex r2–r3: another tab's record — an event, or a read before navigation — ran ahead of this tab's editor.
  it('takes nothing from another tab\'s record: the newest is the editor\'s', () => {
    const store = storeOf();
    connectAccount('A');
    setAccountWriter(writerOf());
    editorHolds({ on: false, size: 1 });
    window.localStorage.setItem(key, JSON.stringify({ on: true, size: 1, __savedAt: Date.now() + 1000 }));
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: window.localStorage.getItem(key), storageArea: window.localStorage }));
    expect(store.read()).toEqual({ on: false, size: 1 });
    expect(store.readFresh()).toEqual({ on: false, size: 1 });
  });

  it('shows the editor\'s copy again when the change is refused', async () => {
    const store = storeOf();
    connectAccount('A');
    setAccountWriter(writerOf(async () => { throw new Error('refused'); }));
    editorHolds({ on: false, size: 1 });
    store.save({ on: true });
    expect(store.read()).toEqual({ on: true, size: 1 });
    await flush();
    expect(store.read()).toEqual({ on: false, size: 1 });
  });

  // Codex r3: the server's version taken after a conflict left the refused choice on the screen, and the next change sent it.
  it('follows the editor when its part goes away — nothing refused comes back', async () => {
    window.localStorage.setItem(`${key}:moved`, '1');
    const store = storeOf();
    connectAccount('A');
    const writer = writerOf();
    setAccountWriter(writer);
    editorHolds({ on: true, size: 1 });
    editorHolds(null);
    expect(store.read()).toEqual(DEFAULTS);
    store.save({ size: 50 });
    expect(writer).toHaveBeenLastCalledWith('trail', { size: 50 }, {});
    await flush();
  });

  it('keeps a choice on the device while no settings bridge is connected, as before', () => {
    const store = storeOf();
    expect(store.save({ size: 4 })).toBe('kept');
    expect(store.read()).toEqual({ on: false, size: 4 });
    expect(parse(window.localStorage.getItem(key))).toEqual({ on: false, size: 4 });
  });

  it('gives a store loaded after the account answered what it holds at once', () => {
    connectAccount('A');
    setAccountReading({ analysisHelp: { on: true, size: 7 } }, true);
    const store = accountChoice({ part: 'analysisHelp', key: `test:account-late-${made += 1}`, parse, fallback: DEFAULTS });
    expect(store.read()).toEqual({ on: true, size: 7 });
  });

  // Codex r4: a move whose mark storage refused let the same record go to a second account later.
  it('does not move the earlier record when its mark cannot be written', () => {
    jest.useFakeTimers();
    window.localStorage.setItem(key, JSON.stringify({ on: true, size: 5 }));
    storeOf();
    const real = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name: string, value: string) {
      if (name.endsWith(':moved')) throw new Error('QuotaExceededError');
      return real.call(this, name, value);
    });
    connectAccount('A');
    const writer = writerOf();
    setAccountWriter(writer);
    editorHolds(null);
    jest.advanceTimersByTime(MOVE_UP_AFTER_MS * 2);
    expect(writer).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  // Codex r4: the person took the server's version without the part, and the earlier record came back and went up again.
  it('never shows or moves the earlier record once an account has shown the part', () => {
    jest.useFakeTimers();
    window.localStorage.setItem(key, JSON.stringify({ on: true, size: 5 }));
    const store = storeOf();
    connectAccount('A');
    const writer = writerOf();
    setAccountWriter(writer);
    editorHolds({ on: false, size: 50 });
    editorHolds(null);
    expect(store.read()).toEqual(DEFAULTS);
    jest.advanceTimersByTime(MOVE_UP_AFTER_MS * 2);
    expect(writer).not.toHaveBeenCalled();
  });

  // Codex r4: a part the account no longer has was drawn again from its copy at the next opening.
  it('takes the account\'s copy away once the account is known to have no such part', () => {
    storeOf();
    connectAccount('A');
    editorHolds({ on: true, size: 100 });
    expect(window.localStorage.getItem(`${key}@A`)).not.toBeNull();
    editorHolds(null);
    expect(window.localStorage.getItem(`${key}@A`)).toBeNull();
  });

  it('keeps the earlier record superseded for the visit even when storage refuses the mark', () => {
    window.localStorage.setItem(key, JSON.stringify({ on: true, size: 5 }));
    const store = storeOf();
    const real = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name: string, value: string) {
      if (name.endsWith(':moved')) throw new Error('QuotaExceededError');
      return real.call(this, name, value);
    });
    connectAccount('A');
    setAccountWriter(writerOf());
    editorHolds({ on: false, size: 50 });
    editorHolds(null);
    expect(store.read()).toEqual(DEFAULTS);
    jest.restoreAllMocks();
  });

  // Codex r5: a refusal that came late took the mark back, and the record went up into a second account too.
  it('never takes the mark back, even when the move is refused', async () => {
    jest.useFakeTimers();
    window.localStorage.setItem(key, JSON.stringify({ on: true, size: 5 }));
    storeOf();
    connectAccount('A');
    setAccountWriter(writerOf(async () => { throw new Error('editor gone'); }));
    editorHolds(null);
    jest.advanceTimersByTime(MOVE_UP_AFTER_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(window.localStorage.getItem(`${key}:moved`)).toBe('1');
  });

  // Codex r5: superseded while storage refused the mark, the record came back at the next opening.
  it('writes the record down as superseded once storage takes the mark again', () => {
    window.localStorage.setItem(key, JSON.stringify({ on: true, size: 5 }));
    storeOf();
    const real = Storage.prototype.setItem;
    const refuse = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name: string, value: string) {
      if (name.endsWith(':moved')) throw new Error('QuotaExceededError');
      return real.call(this, name, value);
    });
    connectAccount('A');
    setAccountWriter(writerOf());
    editorHolds({ on: false, size: 50 });
    editorHolds(null);
    expect(window.localStorage.getItem(`${key}:moved`)).toBeNull();
    refuse.mockRestore();
    editorHolds(null);
    expect(window.localStorage.getItem(`${key}:moved`)).toBe('1');
  });

  // Codex r6: a change still on its way stayed on the screen after the person took the server's version, and the next toggle
  // of another field sent it up again.
  it('lets the editor\'s new copy of the part replace a change still on its way', async () => {
    window.localStorage.setItem(`${key}:moved`, '1');
    const store = storeOf();
    connectAccount('A');
    const writer = writerOf(() => new Promise<void>(() => {}));
    setAccountWriter(writer);
    editorHolds({ on: false, size: 50 });
    store.save({ size: 100 });
    expect(store.read()).toEqual({ on: false, size: 100 });
    editorHolds(null);
    expect(store.read()).toEqual(DEFAULTS);
    store.save({ on: true });
    expect(writer).toHaveBeenLastCalledWith('trail', { on: true }, {});
  });

  // Codex r6: superseded while storage refused the mark, nothing wrote it later — the record itself goes.
  it('takes the superseded record away where storage refuses its mark', () => {
    window.localStorage.setItem(key, JSON.stringify({ on: true, size: 5 }));
    storeOf();
    const real = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name: string, value: string) {
      if (name.endsWith(':moved')) throw new Error('QuotaExceededError');
      return real.call(this, name, value);
    });
    connectAccount('A');
    setAccountWriter(writerOf());
    editorHolds({ on: false, size: 50 });
    expect(window.localStorage.getItem(key)).toBeNull();
    jest.restoreAllMocks();
  });
});
