import { act, fireEvent, render, screen } from '@testing-library/react';

import { LEAVE_MS, SETTLE_MS, usePageGestures } from '@/components/navigation/gestures/usePageGestures';
import { recordDiagnostic } from '@/utils/appDiagnostics';

jest.mock('@/utils/appDiagnostics', () => ({ recordDiagnostic: jest.fn() }));

const touch = (x: number, y: number, identifier = 1) => ({ clientX: x, clientY: y, identifier });
function start(x = 200, y = 100, target: Element = screen.getByTestId('page')) {
  fireEvent.touchStart(target, { touches: [touch(x, y)], changedTouches: [touch(x, y)] });
}
function move(x = 200, y = 270) {
  fireEvent.touchMove(screen.getByTestId('page'), { touches: [touch(x, y)], changedTouches: [touch(x, y)] });
}
function end(x = 200, y = 270) {
  fireEvent.touchEnd(screen.getByTestId('page'), { touches: [], changedTouches: [touch(x, y)] });
}
function Harness({ refresh, back, routeKey = '/studies', enabled = true, readOffset }: {
  refresh: () => void; back: () => void; routeKey?: string; enabled?: boolean; readOffset?: () => { x: number; y: number };
}) {
  const view = usePageGestures({ routeKey, enabled, onRefresh: refresh, onBack: back, readOffset });
  return <div data-testid="page"><output data-testid="state">{view.kind}:{view.distance}</output><textarea aria-label="Draft" defaultValue="Keep my words" /></div>;
}
function setup() {
  const refresh = jest.fn(), back = jest.fn();
  const rendered = render(<Harness refresh={refresh} back={back} />);
  return { refresh, back, ...rendered };
}
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const wait = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
const state = () => screen.getByTestId('state');
/** A finger moving at a steady pace reports every frame, as a real one does. */
function slide(fromX: number, toX: number, ms: number, y = 105) {
  const steps = Math.max(1, Math.round(ms / 16));
  for (let step = 1; step <= steps; step += 1) { wait(ms / steps); move(fromX + ((toX - fromX) * step) / steps, y); }
}

describe('Page touch gestures', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(recordDiagnostic).mockClear();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    Object.defineProperty(window.history, 'length', { configurable: true, value: 2 });
    window.matchMedia = jest.fn().mockImplementation(query => ({ matches: query === '(display-mode: standalone)' }));
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: false });
  });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); document.body.style.overflow = ''; });

  it('follows the pull and requests one document reload only on release', () => {
    const { refresh } = setup();
    start(); move(200, 160);
    expect(screen.getByTestId('state')).toHaveTextContent('pull:30');
    move(); expect(screen.getByTestId('state')).toHaveTextContent('pull:85');
    expect(refresh).not.toHaveBeenCalled();
    end();
    expect(screen.getByTestId('state')).toHaveTextContent('refreshing');
    expect(refresh).toHaveBeenCalledTimes(1);
    start(); move(); end();
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent(window, new Event('pagehide'));
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
  });

  it('cancels a short pull, a reversed pull and an interrupted touch', () => {
    const { refresh } = setup();
    start(); move(200, 140); end(200, 140);
    start(); move(); move(200, 120); end(200, 120);
    start(); move(); fireEvent.touchCancel(screen.getByTestId('page')); end();
    expect(state()).toHaveTextContent('settling');
    wait(SETTLE_MS);
    expect(state()).toHaveTextContent('idle');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('allows back navigation while a requested reload has not left the document', async () => {
    const refresh = jest.fn(), back = jest.fn();
    render(<Harness refresh={refresh} back={back} />);
    start(); move(); end(); await flush();
    expect(screen.getByTestId('state')).toHaveTextContent('refreshing');
    start(); move(); end(); await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    start(200); move(230, 105); end(230, 105);
    expect(state()).toHaveTextContent('refreshing');
    start(200); move(320, 105); end(320, 105); wait(LEAVE_MS);
    expect(back).toHaveBeenCalledTimes(1);
    expect(recordDiagnostic).toHaveBeenCalledWith('gesture', { source: 'back', result: 'released' });
  });

  it('does not turn ordinary scrolling or a diagonal movement into refresh', () => {
    const { refresh } = setup();
    Object.defineProperty(window, 'scrollY', { value: 200 });
    start(); Object.defineProperty(window, 'scrollY', { value: 0 }); move(); end();
    start(); move(350, 270); end(350, 270);
    start(); move(200, 50); move(); end();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
  });

  it('leaves fields, focused editing, nested scrolling and dialogs alone', () => {
    const { refresh } = setup();
    const field = screen.getByLabelText('Draft');
    start(200, 100, field); move(); end();
    field.focus(); start(); move(); end(); field.blur();
    const page = screen.getByTestId('page');
    page.style.overflowY = 'auto';
    Object.defineProperty(page, 'scrollHeight', { configurable: true, value: 500 });
    Object.defineProperty(page, 'clientHeight', { configurable: true, value: 200 });
    start(); move(); end(); page.style.overflowY = '';
    document.body.style.overflow = 'hidden'; start(); move(); end();
    expect(refresh).not.toHaveBeenCalled();
    expect(recordDiagnostic).toHaveBeenCalledWith('gesture', { source: 'start', result: 'blocked', code: 'focused-editor' });
    expect(recordDiagnostic).toHaveBeenCalledWith('gesture', { source: 'start', result: 'blocked', code: 'nested-gesture' });
    expect(recordDiagnostic).toHaveBeenCalledWith('gesture', { source: 'start', result: 'blocked', code: 'open-layer' });
  });

  it('cancels when a second finger joins or the browser owns a noncancelable move', () => {
    const { refresh } = setup();
    start(); move();
    fireEvent.touchStart(screen.getByTestId('page'), { touches: [touch(200, 270), touch(250, 270, 2)] });
    end(); wait(SETTLE_MS); expect(state()).toHaveTextContent('idle');
    start(); fireEvent.touchMove(screen.getByTestId('page'), { touches: [touch(200, 270)], cancelable: false }); end();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('goes back from any free area, including after scrolling, but cancels short swipes and missing history', () => {
    const { back, refresh, rerender } = setup();
    let page = 0;
    // Each successful swipe ends on the previous page, as the router delivers it.
    const swipe = (from: number, to: number) => {
      start(from); slide(from, to, 300); end(to, 105); wait(LEAVE_MS);
      rerender(<Harness refresh={refresh} back={back} routeKey={`/page-${++page}`} />);
    };
    swipe(200, 360); expect(back).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, 'scrollY', { value: 400 });
    swipe(500, 650); expect(back).toHaveBeenCalledTimes(2);
    swipe(500, 540); expect(back).toHaveBeenCalledTimes(2);
    Object.defineProperty(window.history, 'length', { value: 1 });
    swipe(200, 360); expect(back).toHaveBeenCalledTimes(2);
  });

  it.each(['pagehide', 'pageshow'])('clears reload feedback on %s even during another touch', event => {
    setup();
    start(); move(); end();
    start(10);
    fireEvent(window, new Event(event));
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
    end(10, 100);
  });

  it('does not resurrect a departed page refresh on the next page', async () => {
    const refresh = jest.fn(), back = jest.fn();
    const { rerender } = render(<Harness refresh={refresh} back={back} />);
    start(); move(); end(); await flush();
    rerender(<Harness refresh={refresh} back={back} routeKey="/series" />);
    start(10); end(10, 100);
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
    await act(async () => { await jest.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
  });

  it('recovers from a refused reload instead of keeping the spinner forever', async () => {
    const { refresh } = setup();
    refresh.mockImplementationOnce(() => { throw new Error('Reload refused'); });
    start(); move(); end();
    expect(screen.getByTestId('state')).toHaveTextContent('error');
    start(); move(); end();
    expect(screen.getByTestId('state')).toHaveTextContent('refreshing');
    await act(async () => { await jest.advanceTimersByTimeAsync(5000); });
    expect(screen.getByTestId('state')).toHaveTextContent('error');
    expect(recordDiagnostic).toHaveBeenCalledWith('gesture', { source: 'reload', result: 'failed', code: 'navigation-not-started' });
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep my words');
    start(); move(); end();
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('cancels on navigation and stays silent when disabled', () => {
    const { refresh, back, rerender } = setup();
    start(); move(); rerender(<Harness refresh={refresh} back={back} routeKey="/series" />); end();
    expect(refresh).not.toHaveBeenCalled();
    rerender(<Harness refresh={refresh} back={back} enabled={false} />);
    start(); move(); end(); expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['iPad browser', 'iPad', 5, false],
    ['desktop-class iPad browser', 'Macintosh', 5, false],
    ['iPhone PWA', 'iPhone', 5, true],
    ['Android PWA', 'Linux; Android', 5, true],
    ['Mac PWA', 'Macintosh', 0, true],
    ['Windows touch PWA', 'Windows NT', 10, true],
  ])('leaves both gestures untouched in %s', async (_name, userAgent, points, standalone) => {
    Object.defineProperty(navigator, 'userAgent', { value: userAgent });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: points });
    window.matchMedia = jest.fn().mockImplementation(() => ({ matches: standalone }));
    const { refresh, back } = setup();
    const event = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: [touch(10, 100)] });
    fireEvent(screen.getByTestId('page'), event);
    expect(event.defaultPrevented).toBe(false);
    move(130, 105); end(130, 105);
    start(); move(); end(); await flush();
    expect(refresh).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
  });

  it('supports classic iPad identification and the iOS standalone flag', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'iPad' });
    Object.defineProperty(navigator, 'standalone', { value: true });
    window.matchMedia = jest.fn().mockImplementation(() => ({ matches: false }));
    const { refresh, back } = setup();
    start(); move(); end(); await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    start(200); move(320, 105); end(320, 105); wait(LEAVE_MS);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("leaves the left edge to Safari's own swipe back, which slides the real previous page in", () => {
    const { back } = setup();
    const event = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: [touch(10, 300)] });
    fireEvent(screen.getByTestId('page'), event);
    expect(event.defaultPrevented).toBe(false);
    Object.defineProperty(window, 'scrollY', { value: 400 });
    expect(fireEvent.touchMove(screen.getByTestId('page'), { touches: [touch(60, 302)] })).toBe(true);
    move(200, 305); end(200, 305); wait(LEAVE_MS);
    expect(back).not.toHaveBeenCalled();
    expect(state()).toHaveTextContent('idle');
  });

  it('moves the page one to one with the finger and slides it away before going back', () => {
    const { back } = setup();
    start(200); move(330, 105);
    expect(state()).toHaveTextContent('back:130');
    move(720, 110);
    expect(state()).toHaveTextContent('back:520');
    end(720, 110);
    expect(state()).toHaveTextContent(`leaving:${window.innerWidth}`);
    expect(back).not.toHaveBeenCalled();
    wait(LEAVE_MS);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('goes back on a quick flick short of the threshold, and cancels a flick back to the left past it', () => {
    const { back, refresh, rerender } = setup();
    start(200); wait(16); move(215, 101); wait(16); move(250, 102); end(250, 102); wait(LEAVE_MS);
    expect(back).toHaveBeenCalledTimes(1);
    rerender(<Harness refresh={refresh} back={back} routeKey="/previous" />);
    start(200); slide(200, 250, 600); end(250, 105); wait(LEAVE_MS);
    expect(state()).toHaveTextContent('settling');
    start(200); slide(200, 500, 300); wait(16); move(440, 102); wait(16); move(380, 102); end(380, 102); wait(LEAVE_MS);
    expect(state()).toHaveTextContent('settling');
    start(200); slide(200, 500, 300); wait(300); end(500, 105); wait(LEAVE_MS);
    expect(back).toHaveBeenCalledTimes(2);
  });

  it('glides an abandoned swipe home, and a caught page continues from where it is drawn', () => {
    const refresh = jest.fn(), back = jest.fn();
    render(<Harness refresh={refresh} back={back} readOffset={() => ({ x: 50, y: 0 })} />);
    start(200); slide(200, 280, 300); end(280, 105);
    expect(state()).toHaveTextContent('settling');
    wait(20);
    start(300); move(310, 105);
    expect(state()).toHaveTextContent('back:50');
    move(320, 105);
    expect(state()).toHaveTextContent('back:60');
    wait(SETTLE_MS * 2);
    expect(state()).toHaveTextContent('back:60');
    wait(300); end(320, 105); wait(SETTLE_MS);
    expect(state()).toHaveTextContent('idle');
    expect(back).not.toHaveBeenCalled();
  });

  it('does not take a short drag and a pause for a flick', () => {
    const { back } = setup();
    start(200); wait(300); move(230, 101); wait(16); move(242, 101); wait(80); end(242, 101); wait(LEAVE_MS);
    expect(back).not.toHaveBeenCalled();
    expect(state()).toHaveTextContent('settling');
  });

  it('reads the lift point: a final move back to the left cancels a swipe past the threshold', () => {
    const { back } = setup();
    start(200); wait(300); move(400, 101); wait(16); end(310, 101); wait(LEAVE_MS);
    expect(back).not.toHaveBeenCalled();
    expect(state()).toHaveTextContent('settling');
  });

  it('presses nothing while the page is leaving, and stays when something opened over it', () => {
    const { back } = setup();
    const other = document.createElement('button');
    const pressed = jest.fn();
    other.addEventListener('click', pressed);
    document.body.appendChild(other);
    start(200); move(400, 105); end(400, 105);
    const tap = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(tap, 'touches', { value: [touch(300, 300)] });
    other.dispatchEvent(tap);
    expect(tap.defaultPrevented).toBe(true);
    fireEvent.click(other, { detail: 1 });
    expect(pressed).not.toHaveBeenCalled();
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    wait(LEAVE_MS);
    expect(back).not.toHaveBeenCalled();
    expect(state()).toHaveTextContent('settling');
    dialog.remove(); other.remove();
  });

  it('starts nothing at the left edge, not even a pull at the top, so Safari keeps its swipe', () => {
    const { refresh, back } = setup();
    start(10, 100);
    expect(fireEvent.touchMove(screen.getByTestId('page'), { touches: [touch(11, 102)] })).toBe(true);
    expect(fireEvent.touchMove(screen.getByTestId('page'), { touches: [touch(110, 105)] })).toBe(true);
    end(110, 105);
    start(10, 100); move(12, 280); end(12, 280); wait(LEAVE_MS);
    expect(refresh).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(state()).toHaveTextContent('idle');
  });

  it('glides home at once when going back kept the address', () => {
    const { back } = setup();
    start(200); move(400, 105); end(400, 105); wait(LEAVE_MS);
    expect(back).toHaveBeenCalledTimes(1);
    fireEvent(window, new PopStateEvent('popstate'));
    expect(state()).toHaveTextContent('settling');
  });

  it('returns a page whose back went nowhere and stops offering back on it until the next page', () => {
    const { back, refresh, rerender } = setup();
    start(200); move(400, 105); end(400, 105); wait(LEAVE_MS);
    expect(back).toHaveBeenCalledTimes(1);
    wait(1500);
    expect(state()).toHaveTextContent('settling');
    expect(recordDiagnostic).toHaveBeenCalledWith('gesture', { source: 'back', result: 'failed', code: 'no-previous-page' });
    wait(SETTLE_MS);
    start(200); move(400, 105); end(400, 105); wait(LEAVE_MS);
    expect(back).toHaveBeenCalledTimes(1);
    expect(state()).toHaveTextContent('idle');
    rerender(<Harness refresh={refresh} back={back} routeKey="/next" />);
    start(200); move(400, 105); end(400, 105); wait(LEAVE_MS);
    expect(back).toHaveBeenCalledTimes(2);
  });

  it('keeps the page away while the previous page renders after history moved', () => {
    const { back } = setup();
    start(200); move(400, 105); end(400, 105); wait(LEAVE_MS);
    window.history.pushState(null, '', '/previous');
    fireEvent(window, new PopStateEvent('popstate'));
    wait(1500 + SETTLE_MS);
    expect(state()).toHaveTextContent('leaving');
    expect(back).toHaveBeenCalledTimes(1);
    window.history.pushState(null, '', '/');
  });

  it('does not take steady ordinary motion for a flick', () => {
    const { back } = setup();
    start(200);
    for (let step = 1; step <= 6; step += 1) { wait(16); move(200 + step * 8, 105); }
    end(248, 105); wait(LEAVE_MS);
    expect(back).not.toHaveBeenCalled();
    expect(state()).toHaveTextContent('settling');
  });

  it('keeps a final step back to the left when the lift repeats its position', () => {
    const { back } = setup();
    start(200);
    for (let step = 1; step <= 14; step += 1) { wait(16); move(200 + step * 16, 105); }
    wait(16); move(412, 105); end(412, 105); wait(LEAVE_MS);
    expect(back).not.toHaveBeenCalled();
    expect(state()).toHaveTextContent('settling');
  });

  it('does not let a reload that never left interrupt a back already under way', () => {
    const { refresh, back } = setup();
    start(); move(); end();
    expect(refresh).toHaveBeenCalledTimes(1);
    wait(4900);
    start(200); move(400, 105); end(400, 105);
    wait(100);
    expect(state()).toHaveTextContent('leaving');
    const other = document.createElement('button');
    const pressed = jest.fn();
    other.addEventListener('click', pressed);
    document.body.appendChild(other);
    fireEvent.click(other, { detail: 1 });
    expect(pressed).not.toHaveBeenCalled();
    wait(100);
    expect(back).toHaveBeenCalledTimes(1);
    other.remove();
  });

  it.each(['lift', 'cancel', 'drift'])('never strands the reload spinner when it fails under a resting touch (%s)', ending => {
    setup();
    start(); move(); end();
    wait(4900);
    start(600, 400);
    wait(100);
    if (ending === 'lift') end(600, 400);
    if (ending === 'cancel') fireEvent.touchCancel(screen.getByTestId('page'));
    if (ending === 'drift') { move(560, 360); end(560, 360); }
    expect(state()).toHaveTextContent('error');
    wait(4000);
    expect(state()).toHaveTextContent('idle');
  });

  it('lets a drag that began before a reload failed finish without the notice ending it', () => {
    setup();
    start(); move(); end();
    wait(4950);
    start(200, 400); wait(100);
    move(260, 402);
    wait(4000);
    expect(state()).toHaveTextContent('back:60');
    wait(300); end(260, 402); wait(SETTLE_MS);
    expect(state()).toHaveTextContent('idle');
  });

  it('catches a page drawn close to home without a jump, and leaves a page gliding on the other axis alone', () => {
    const refresh = jest.fn(), back = jest.fn();
    let drawn = { x: 5, y: 0 };
    render(<Harness refresh={refresh} back={back} readOffset={() => drawn} />);
    start(200); slide(200, 260, 300); end(260, 105);
    wait(200);
    start(300); move(320, 105);
    expect(state()).toHaveTextContent('back:5');
    wait(300); end(320, 105); wait(SETTLE_MS);
    drawn = { x: 50, y: 0 };
    start(200); slide(200, 280, 300); end(280, 105);
    wait(20);
    start(600, 100); move(600, 160); move(600, 280); end(600, 280);
    expect(state()).toHaveTextContent('settling');
    expect(refresh).not.toHaveBeenCalled();
    wait(SETTLE_MS);
    expect(state()).toHaveTextContent('idle');
  });

  it('offers back again on a page whose back went nowhere once history grows', () => {
    const { back } = setup();
    start(200); move(400, 105); end(400, 105); wait(LEAVE_MS + 1500 + SETTLE_MS);
    expect(back).toHaveBeenCalledTimes(1);
    Object.defineProperty(window.history, 'length', { configurable: true, value: 3 });
    start(200); move(400, 105); end(400, 105); wait(LEAVE_MS);
    expect(back).toHaveBeenCalledTimes(2);
  });

  it('goes back at once and settles without gliding when the person asks for less motion', () => {
    window.matchMedia = jest.fn().mockImplementation(query => ({
      matches: query === '(display-mode: standalone)' || query === '(prefers-reduced-motion: reduce)',
    }));
    const { back } = setup();
    start(200); slide(200, 260, 300); end(260, 105);
    expect(state()).toHaveTextContent('idle');
    start(200); move(400, 105); end(400, 105); wait(0);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('does not pull a departing page back into view with a stray touch', () => {
    const { back } = setup();
    start(200); move(400, 105); end(400, 105);
    start(300); move(320, 106); move(100, 110);
    expect(state()).toHaveTextContent('leaving');
    end(100, 110); wait(LEAVE_MS);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('glides home when no previous page arrives after going back', () => {
    const { back } = setup();
    start(200); move(400, 105); end(400, 105); wait(LEAVE_MS);
    expect(back).toHaveBeenCalledTimes(1);
    wait(1500);
    expect(state()).toHaveTextContent('settling');
    wait(SETTLE_MS);
    expect(state()).toHaveTextContent('idle');
  });

  it('shows the page at rest when it comes back from the back-forward cache mid-departure', () => {
    const { back } = setup();
    start(200); move(400, 105); end(400, 105);
    fireEvent(window, new Event('pagehide'));
    fireEvent(window, new Event('pageshow'));
    expect(state()).toHaveTextContent('idle');
    wait(LEAVE_MS + 2000);
    expect(back).not.toHaveBeenCalled();
    expect(state()).toHaveTextContent('idle');
  });
});
