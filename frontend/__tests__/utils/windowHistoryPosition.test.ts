import { HISTORY_ENTRY_KEY } from '@/utils/historyEntry';
import { installWindowHistoryPosition } from '@/utils/windowHistoryPosition.client';

const rawPush = window.history.pushState;
const rawReplace = window.history.replaceState;
const originalResizeObserver = globalThis.ResizeObserver;
const originalMutationObserver = globalThis.MutationObserver;
let x = 0;
let y = 0;
let height = 5000;
let navigationType = 'navigate';
let frames: Map<number, FrameRequestCallback>;
let observers: Set<() => void>;
let nextFrame = 0;
let stop: (() => void) | undefined;
let afterScroll: (() => void) | undefined;
let scroll: jest.SpyInstance;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

function flushFrames(count = 16) {
  for (let step = 0; step < count; step++) {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(step * 16));
  }
}

function geometry(nextHeight: number) {
  height = nextHeight;
  observers.forEach(notify => notify());
}

function readAt(top: number) {
  y = top;
  window.dispatchEvent(new Event('scroll'));
}

function traverse(state: unknown, href: string) {
  rawReplace.call(window.history, state, '', href);
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
}

function leaveList() {
  stop = installWindowHistoryPosition();
  const state = window.history.state;
  readAt(500);
  window.history.pushState({ __NA: true, tree: 'detail' }, '', '/sermons/one');
  return state;
}

beforeEach(() => {
  frames = new Map();
  observers = new Set();
  nextFrame = 0;
  x = 0; y = 0; height = 5000; navigationType = 'navigate';
  afterScroll = undefined;
  window.sessionStorage.clear();
  document.body.innerHTML = '';
  rawReplace.call(window.history, { __NA: true, tree: 'list' }, '', '/sermons?q=remember');
  for (const [key, get] of Object.entries({ scrollX: (): number => x, scrollY: (): number => y, innerHeight: (): number => 1000 })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(window, key));
    Object.defineProperty(window, key, { configurable: true, get });
  }
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => height });
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  Object.defineProperty(performance, 'getEntriesByType', {
    configurable: true, value: () => [{ type: navigationType }],
  });
  scroll = jest.spyOn(window, 'scrollTo').mockImplementation((options: ScrollToOptions | number, top?: number) => {
    if (typeof options === 'number') { x = options; y = top ?? 0; }
    else { x = options.left ?? x; y = options.top ?? y; }
    afterScroll?.();
    window.dispatchEvent(new Event('scroll'));
  });
  class GeometryObserver {
    constructor(private readonly callback: () => void) { observers.add(callback); }
    observe() {}
    disconnect() { observers.delete(this.callback); }
  }
  globalThis.ResizeObserver = GeometryObserver as unknown as typeof ResizeObserver;
  globalThis.MutationObserver = GeometryObserver as unknown as typeof MutationObserver;
});

afterEach(() => {
  stop?.(); stop = undefined;
  window.history.pushState = rawPush;
  window.history.replaceState = rawReplace;
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.MutationObserver = originalMutationObserver;
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(window, key, descriptor);
    else Reflect.deleteProperty(window, key);
  }
  Reflect.deleteProperty(document.documentElement, 'scrollHeight');
  Reflect.deleteProperty(performance, 'getEntriesByType');
  jest.restoreAllMocks();
});

describe('window history reading position', () => {
  it('restores a readable shorter document once the saved offset fits after its short fallback', () => {
    const state = leaveList();
    geometry(1000); readAt(0);
    traverse(state, '/sermons?q=remember');
    flushFrames();
    expect(y).toBe(0);
    geometry(1200); flushFrames();
    expect(y).toBe(0);
    // The saved offset fits a shorter final document; the old total height is not readiness.
    geometry(2000); flushFrames();
    expect(y).toBe(500);
    expect(window.location.search).toBe('?q=remember');
  });

  it('waits for the full-page wait to leave even when its geometry already fits', () => {
    const state = leaveList();
    document.body.innerHTML = '<main data-page-loading></main>';
    readAt(0); traverse(state, '/sermons?q=remember'); flushFrames();
    expect(y).toBe(0);
    document.body.innerHTML = '<main>Saved words</main>';
    geometry(5000); flushFrames();
    expect(y).toBe(500);
  });

  it('settles again when its own restored scroll collapses the study header', () => {
    const state = leaveList();
    readAt(0); traverse(state, '/sermons?q=remember');
    let collapsed = false;
    afterScroll = () => {
      if (!collapsed) { collapsed = true; height -= 46; y -= 46; }
    };
    flushFrames(24);
    expect(y).toBe(500);
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'])('lets newer %s input cancel an unfinished return', type => {
    const state = leaveList();
    geometry(1000); readAt(0); traverse(state, '/sermons?q=remember'); flushFrames();
    window.dispatchEvent(new Event(type)); readAt(166);
    geometry(5000); flushFrames();
    expect(y).toBe(166);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('gives each new visit a fresh identity, preserving router and explicit Bible state', () => {
    stop = installWindowHistoryPosition();
    const first = window.history.state[HISTORY_ENTRY_KEY];
    window.history.pushState({ ...window.history.state, tree: 'new' }, '', '/sermons?q=remember');
    expect(window.history.state).toMatchObject({ __NA: true, tree: 'new' });
    expect(window.history.state[HISTORY_ENTRY_KEY]).not.toBe(first);
    window.history.pushState({ bibleEntry: 'explicit-book-visit', bibleFrom: 'romans' }, '', '/bible?book=john');
    expect(window.history.state).toMatchObject({ bibleEntry: 'explicit-book-visit', bibleFrom: 'romans' });
    window.history.replaceState({ __NA: true, tree: 'updated' }, '', '/bible?book=john&verse=5');
    expect(window.history.state).toMatchObject({ bibleEntry: 'explicit-book-visit', __NA: true, tree: 'updated' });
  });

  it('leaves native fragment entries without app state alone, including their native scroll', () => {
    stop = installWindowHistoryPosition();
    const first = window.history.state;
    readAt(200);
    traverse(null, '/sermons?q=remember#reading');
    readAt(3480); flushFrames();
    expect(window.history.state).toBeNull();
    window.history.replaceState(null, '', '/sermons?q=remember#reading');
    expect(window.history.state).toBeNull();
    traverse(first, '/sermons?q=remember'); flushFrames();
    expect(y).toBe(200);
    traverse(null, '/sermons?q=remember#reading'); readAt(3480); flushFrames();
    expect(y).toBe(3480);
    expect(window.history.state).toBeNull();
  });

  it('does not compete with the Bible reader own verse restoration', () => {
    stop = installWindowHistoryPosition();
    window.history.pushState({ bibleEntry: 'book' }, '', '/bible?book=john');
    const book = window.history.state;
    readAt(1500);
    window.history.pushState({}, '', '/sermons');
    readAt(0); traverse(book, '/bible?book=john'); flushFrames();
    expect(y).toBe(0);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('cancels the previous return when the person starts another navigation', () => {
    const state = leaveList();
    geometry(1000); readAt(0); traverse(state, '/sermons?q=remember'); flushFrames();
    window.history.pushState({}, '', '/groups');
    geometry(5000); flushFrames();
    expect(y).toBe(0);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('reads popstate before a router replaces state during its own restoration', () => {
    const state = leaveList();
    readAt(0);
    const router = () => window.history.replaceState({ __NA: true, tree: 'restored' }, '');
    window.addEventListener('popstate', router);
    try {
      traverse(state, '/sermons?q=remember'); flushFrames();
      expect(y).toBe(500);
      expect(window.history.state).toMatchObject({ ...state, tree: 'restored' });
    } finally { window.removeEventListener('popstate', router); }
  });

  it('persists a visit before a full document leaves and restores it after a reload', () => {
    stop = installWindowHistoryPosition();
    readAt(700); window.dispatchEvent(new Event('pagehide'));
    stop(); stop = undefined;
    y = 0; navigationType = 'back_forward';
    stop = installWindowHistoryPosition(); flushFrames();
    expect(y).toBe(700);
  });

  it('continues within this document when browser storage refuses writes', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage refused'); });
    const state = leaveList();
    readAt(0); traverse(state, '/sermons?q=remember'); flushFrames();
    expect(y).toBe(500);
  });

  it('keeps only a bounded number of visit positions in tab storage', () => {
    stop = installWindowHistoryPosition();
    for (let index = 0; index < 110; index++) {
      readAt(index + 1);
      window.history.pushState({}, '', `/sermons/${index}`);
    }
    const positions = JSON.parse(window.sessionStorage.getItem('navigation:window-positions:v1') ?? '[]');
    expect(positions).toHaveLength(100);
    expect(positions[positions.length - 1]).toMatchObject({ y: 110 });
  });

  it('ignores malformed stored records without interfering with ordinary new navigation', () => {
    window.sessionStorage.setItem('navigation:window-positions:v1', JSON.stringify([
      { entry: 'bad', href: window.location.href, x: 0, y: -10, height: 5000 },
      null, { entry: 'bad', x: 0, y: 500 },
    ]));
    stop = installWindowHistoryPosition();
    window.history.pushState({}, '', '/sermons/one');
    readAt(0); flushFrames();
    expect(y).toBe(0);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('can unmount and mount again without duplicating ownership or losing the entry identity', () => {
    stop = installWindowHistoryPosition();
    const state = window.history.state;
    stop();
    stop = installWindowHistoryPosition();
    expect(window.history.state).toEqual(state);
    readAt(321); window.history.pushState({}, '', '/groups');
    readAt(0); traverse(state, '/sermons?q=remember'); flushFrames();
    expect(y).toBe(321);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('keeps ordinary navigation usable without navigation timing measurements', () => {
    Reflect.deleteProperty(performance, 'getEntriesByType');
    expect(() => { stop = installWindowHistoryPosition(); }).not.toThrow();
    window.history.pushState({}, '', '/groups');
    expect(window.location.pathname).toBe('/groups');
  });

  it('does not save rubber-band overscroll as an unreachable negative position', () => {
    stop = installWindowHistoryPosition();
    x = -20; readAt(-40);
    window.history.pushState({}, '', '/groups');
    const positions = JSON.parse(window.sessionStorage.getItem('navigation:window-positions:v1') ?? '[]');
    expect(positions[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('waits without spinning when a resized document cannot fit the saved horizontal position', () => {
    let contentWidth = 2000;
    Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, get: () => contentWidth });
    try {
      x = 500;
      const state = leaveList();
      x = 0; readAt(0); contentWidth = window.innerWidth;
      scroll.mockImplementation((options: ScrollToOptions) => { x = 0; y = options.top ?? y; });
      traverse(state, '/sermons?q=remember'); flushFrames(24);
      expect(frames.size).toBe(0);
      expect(scroll).not.toHaveBeenCalled();
      contentWidth = 2000;
      scroll.mockImplementation((options: ScrollToOptions) => { x = options.left ?? x; y = options.top ?? y; });
      geometry(5000); flushFrames();
      expect({ x, y }).toEqual({ x: 500, y: 500 });
    } finally { Reflect.deleteProperty(document.documentElement, 'scrollWidth'); }
  });

  it('disconnects observers and pending work, and leaves later router wrappers usable', () => {
    const state = leaveList();
    geometry(1000); readAt(0); traverse(state, '/sermons?q=remember');
    const installedPush = window.history.pushState;
    const laterRouter = function (...args: Parameters<History['pushState']>) {
      return installedPush.apply(window.history, args);
    };
    window.history.pushState = laterRouter;
    stop?.(); stop = undefined;
    expect(window.history.pushState).toBe(laterRouter);
    expect(observers.size).toBe(0);
    expect(frames.size).toBe(0);
    window.history.pushState({ afterUnmount: true }, '', '/groups');
    expect(window.history.state).toEqual({ afterUnmount: true });
    geometry(5000); flushFrames();
    expect(scroll).not.toHaveBeenCalled();
  });
});
