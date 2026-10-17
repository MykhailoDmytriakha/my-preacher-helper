import { act, fireEvent, render, screen } from '@testing-library/react';

import { AudioRecoveryPanel } from '@/components/audio-recorder/AudioRecorderControls';

const t = (key: string) => key;
const actions = { onRetry: jest.fn(), onRecordAgain: jest.fn(), onDiscard: jest.fn() };
const defaults = { show: true, audioUrl: 'blob:retained-source', errorMessage: 'Recognition failed', appliedVariant: 'mini' as const,
  retryCount: 0, maxRetries: 3, isProcessing: false, t, ...actions };
let placement = { edge: 46, width: 320, side: 'right' as 'right' | 'left' };
let reads = 0;
const originalWidth = window.innerWidth;
const viewport = (width: number) => Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });

beforeEach(() => {
  jest.clearAllMocks(); viewport(390); reads = 0; placement = { edge: 46, width: 320, side: 'right' };
  jest.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(0);
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'narrow-clip') return { left: 32, right: 288, top: 80, bottom: 800, width: 256, height: 720 } as DOMRect;
    if (this.dataset.testid !== 'audio-recovery-panel') return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
    reads += 1;
    const max = Number.parseFloat(this.style.maxWidth);
    const width = Math.min(placement.width, Number.isFinite(max) ? max : placement.width);
    const shift = Number.parseFloat(this.style.translate) || 0;
    const left = (placement.side === 'right' ? placement.edge - width : placement.edge) + shift;
    return { left, right: left + width, top: 120, bottom: 420, width, height: 300, x: left, y: 120 } as DOMRect;
  });
});
afterEach(() => { jest.restoreAllMocks(); viewport(originalWidth); });

it('keeps left-anchored microphone recovery actions inside the phone', () => {
  render(<AudioRecoveryPanel {...defaults} floating className="absolute right-0 w-[320px]" />);
  const panel = screen.getByTestId('audio-recovery-panel');
  expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(16);
  expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(374);
  fireEvent.click(screen.getByRole('button', { name: 'audio.recordAgain' }));
  expect(actions.onRecordAgain).toHaveBeenCalledTimes(1);
});

it('keeps a panel that opens to the right inside the phone', () => {
  placement = { edge: 300, width: 320, side: 'left' };
  render(<AudioRecoveryPanel {...defaults} floating className="absolute left-0 w-[320px]" />);
  expect(screen.getByTestId('audio-recovery-panel').getBoundingClientRect().right).toBeLessThanOrEqual(374);
});

it('shrinks a wider recording panel to the available narrow viewport', () => {
  viewport(280); placement = { edge: 42, width: 340, side: 'right' };
  render(<AudioRecoveryPanel {...defaults} floating />);
  const rect = screen.getByTestId('audio-recovery-panel').getBoundingClientRect();
  expect(rect.width).toBeLessThanOrEqual(248);
  expect(rect.left).toBeGreaterThanOrEqual(16);
  expect(rect.right).toBeLessThanOrEqual(264);
});

it('leaves an already fitting wide panel in its existing place', () => {
  viewport(1280); placement = { edge: 620, width: 320, side: 'right' };
  render(<AudioRecoveryPanel {...defaults} floating />);
  expect(screen.getByTestId('audio-recovery-panel').getBoundingClientRect().left).toBe(300);
});

it('recalculates after resize and scroll without accumulating the correction', () => {
  const { container } = render(<AudioRecoveryPanel {...defaults} floating />);
  const panel = screen.getByTestId('audio-recovery-panel');
  expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(16);
  const first = panel.style.translate;
  fireEvent.scroll(container); fireEvent.scroll(container);
  expect(panel.style.translate).toBe(first);
  viewport(820); placement = { edge: 750, width: 320, side: 'left' };
  fireEvent(window, new Event('resize'));
  expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(804);
});

it('does not reposition ordinary in-flow recovery cards', () => {
  render(<AudioRecoveryPanel {...defaults} />);
  const panel = screen.getByTestId('audio-recovery-panel');
  expect(panel.style.translate ?? '').toBe(''); expect(panel.style.maxWidth).toBe(''); expect(reads).toBe(0);
});

it('retires geometry listeners when the recovery panel unmounts', () => {
  const { unmount } = render(<AudioRecoveryPanel {...defaults} floating />);
  unmount(); const before = reads;
  fireEvent(window, new Event('resize')); fireEvent.scroll(document);
  expect(reads).toBe(before);
});


it('follows a containing layout resize while the immediate trigger keeps its size', () => {
  const OriginalObserver = global.ResizeObserver;
  const observed = new Set<Element>();
  let notify: ResizeObserverCallback;
  let observer: ResizeObserver;
  global.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { notify = callback; observer = this as unknown as ResizeObserver; }
    observe(target: Element) { observed.add(target); }
    disconnect() { observed.clear(); }
    unobserve(target: Element) { observed.delete(target); }
  } as unknown as typeof ResizeObserver;
  try {
    viewport(820); placement = { edge: 600, width: 320, side: 'right' };
    render(<div data-testid="responsive-layout"><div><AudioRecoveryPanel {...defaults} floating /></div></div>);
    const panel = screen.getByTestId('audio-recovery-panel');
    expect(panel.getBoundingClientRect().left).toBe(280);
    const layout = screen.getByTestId('responsive-layout');
    // A containing flex column changes width during its existing CSS transition;
    // the small immediate microphone wrapper keeps the same width throughout.
    placement.edge = 42;
    const entry: ResizeObserverEntry = { target: layout, contentRect: layout.getBoundingClientRect(),
      borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] };
    act(() => { if (observed.has(layout)) notify([entry], observer); });
    expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(16);
  } finally { global.ResizeObserver = OriginalObserver; }
});


it('keeps the whole panel inside the visible scroll column as well as the viewport', () => {
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'narrow-clip' ? 256 : 0;
  });
  render(<div data-testid="narrow-clip" style={{ overflowX: 'auto' }}><AudioRecoveryPanel {...defaults} floating /></div>);
  const rect = screen.getByTestId('audio-recovery-panel').getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(48);
  expect(rect.right).toBeLessThanOrEqual(272);
  expect(rect.width).toBeLessThanOrEqual(224);
});
