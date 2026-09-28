import { act, fireEvent, render, screen } from '@testing-library/react';

import { usePageGestures } from '@/components/navigation/gestures/usePageGestures';
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
function Harness({ refresh, back, routeKey = '/studies', enabled = true }: {
  refresh: () => void; back: () => void; routeKey?: string; enabled?: boolean;
}) {
  const view = usePageGestures({ routeKey, enabled, onRefresh: refresh, onBack: back });
  return <div data-testid="page"><output data-testid="state">{view.kind}:{view.distance}</output><textarea aria-label="Draft" defaultValue="Keep my words" /></div>;
}
function setup() {
  const refresh = jest.fn(), back = jest.fn();
  const rendered = render(<Harness refresh={refresh} back={back} />);
  return { refresh, back, ...rendered };
}
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

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
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('allows back navigation while a requested reload has not left the document', async () => {
    const refresh = jest.fn(), back = jest.fn();
    render(<Harness refresh={refresh} back={back} />);
    start(); move(); end(); await flush();
    expect(screen.getByTestId('state')).toHaveTextContent('refreshing');
    start(); move(); end(); await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    start(10); move(40, 105); end(40, 105);
    expect(screen.getByTestId('state')).toHaveTextContent('refreshing');
    start(10); move(130, 105); end(130, 105);
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
    end(); expect(screen.getByTestId('state')).toHaveTextContent('idle');
    start(); fireEvent.touchMove(screen.getByTestId('page'), { touches: [touch(200, 270)], cancelable: false }); end();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('goes back from any free area, including after scrolling, but cancels short swipes and missing history', () => {
    const { back } = setup();
    start(200); move(360, 105); end(360, 105); expect(back).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, 'scrollY', { value: 400 });
    start(500); move(650, 105); end(650, 105); expect(back).toHaveBeenCalledTimes(2);
    start(500); move(540, 105); end(540, 105); expect(back).toHaveBeenCalledTimes(2);
    start(10); move(130, 105); end(130, 105); expect(back).toHaveBeenCalledTimes(3);
    Object.defineProperty(window.history, 'length', { value: 1 });
    start(10); move(130, 105); end(130, 105); expect(back).toHaveBeenCalledTimes(3);
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
    start(10); move(130, 105); end(130, 105);
    expect(back).toHaveBeenCalledTimes(1);
  });
});
