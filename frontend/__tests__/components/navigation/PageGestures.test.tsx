import { act, fireEvent, render, screen } from '@testing-library/react';

import { usePageGestures } from '@/components/navigation/gestures/usePageGestures';

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
  refresh: () => Promise<void>; back: () => void; routeKey?: string; enabled?: boolean;
}) {
  const view = usePageGestures({ routeKey, enabled, onRefresh: refresh, onBack: back });
  return <div data-testid="page"><output data-testid="state">{view.kind}:{view.distance}</output><textarea aria-label="Draft" defaultValue="Keep my words" /></div>;
}
function setup() {
  const refresh = jest.fn(async () => undefined), back = jest.fn();
  const rendered = render(<Harness refresh={refresh} back={back} />);
  return { refresh, back, ...rendered };
}
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

describe('Page touch gestures', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    Object.defineProperty(window.history, 'length', { configurable: true, value: 2 });
    window.matchMedia = jest.fn().mockImplementation(query => ({ matches: query === '(display-mode: standalone)' }));
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: false });
  });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); document.body.style.overflow = ''; });

  it('follows the pull, arms after the threshold and refreshes only on release', async () => {
    let complete!: () => void;
    const refresh = jest.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    render(<Harness refresh={refresh} back={jest.fn()} />);
    start(); move(200, 160);
    expect(screen.getByTestId('state')).toHaveTextContent('pull:30');
    move(); expect(screen.getByTestId('state')).toHaveTextContent('pull:85');
    expect(refresh).not.toHaveBeenCalled();
    end(); await flush();
    expect(screen.getByTestId('state')).toHaveTextContent('refreshing');
    expect(refresh).toHaveBeenCalledTimes(1);
    start(); move(); end(); await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => complete());
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep my words');
  });

  it('cancels a short pull, a reversed pull and an interrupted touch', () => {
    const { refresh } = setup();
    start(); move(200, 140); end(200, 140);
    start(); move(); move(200, 120); end(200, 120);
    start(); move(); fireEvent.touchCancel(screen.getByTestId('page')); end();
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
    expect(refresh).not.toHaveBeenCalled();
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
  });

  it('cancels when a second finger joins or the browser owns a noncancelable move', () => {
    const { refresh } = setup();
    start(); move();
    fireEvent.touchStart(screen.getByTestId('page'), { touches: [touch(200, 270), touch(250, 270, 2)] });
    end(); expect(screen.getByTestId('state')).toHaveTextContent('idle');
    start(); fireEvent.touchMove(screen.getByTestId('page'), { touches: [touch(200, 270)], cancelable: false }); end();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('uses the installed-app left edge and cancels short swipes or missing history', () => {
    const { back } = setup();
    start(200); move(360, 105); end(360, 105); expect(back).not.toHaveBeenCalled();
    start(10); move(40, 105); end(40, 105); expect(back).not.toHaveBeenCalled();
    start(10); move(130, 105); end(130, 105); expect(back).toHaveBeenCalledTimes(1);
    Object.defineProperty(window.history, 'length', { value: 1 });
    start(10); move(130, 105); end(130, 105); expect(back).toHaveBeenCalledTimes(1);
  });

  it('reports read failure and times out silence without clearing the editor', async () => {
    const { refresh } = setup();
    refresh.mockRejectedValueOnce(new Error('Network failed'));
    start(); move(); end(); await flush();
    expect(screen.getByTestId('state')).toHaveTextContent('error');
    refresh.mockImplementationOnce(() => new Promise(() => undefined));
    start(); move(); end(); await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByTestId('state')).toHaveTextContent('error');
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep my words');
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
