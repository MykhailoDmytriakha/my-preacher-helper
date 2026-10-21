import { act, fireEvent, render, screen } from '@testing-library/react';

import PageGestures from '@/components/navigation/PageGestures';

const mockBack = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ back: mockBack }), useSearchParams: () => new URLSearchParams() }));
jest.mock('@/hooks/useShellPathname', () => ({ useShellPathname: () => '/sermons' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/utils/appDiagnostics', () => ({ recordDiagnostic: jest.fn() }));

const originalLocation = window.location;
const reload = jest.fn();
const point = (x: number, y: number) => ({ identifier: 1, clientX: x, clientY: y });
function drag(target: Element, fromX: number, fromY: number, toX: number, toY: number) {
  fireEvent.touchStart(target, { touches: [point(fromX, fromY)] });
  fireEvent.touchMove(target, { touches: [point(toX, toY)] });
  fireEvent.touchEnd(target, { touches: [], changedTouches: [point(toX, toY)] });
}
beforeEach(() => {
  jest.useFakeTimers(); reload.mockClear(); mockBack.mockClear();
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({ matches: query.includes('standalone') }));
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPad' });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  Object.defineProperty(window.history, 'length', { configurable: true, value: 2 });
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload } });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  jest.clearAllTimers(); jest.useRealTimers();
});

// The pull to reload was removed (owner, 2026-10-20): it got in the way more than it helped.
it.each([40, 600, 1190])('leaves a pull at the top at x=%s alone: nothing reloads and the page stays put', x => {
  const { container } = render(<><PageGestures /><div data-testid="content">Page content</div></>);
  drag(screen.getByTestId('content'), x, 100, x, 280);
  act(() => { jest.advanceTimersByTime(1000); });
  expect(reload).not.toHaveBeenCalled();
  expect(container.querySelector('[data-page-gesture]')).toHaveAttribute('data-page-gesture', 'idle');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it.each(['button', 'link'])('keeps the click of a %s a pull started on', role => {
  const click = jest.fn();
  render(<><PageGestures /><button onClick={click}>Action</button><a href="/settings" onClick={click}>Settings</a></>);
  drag(screen.getByRole(role), 40, 100, 40, 280);
  fireEvent.click(screen.getByRole(role), { detail: 1 });
  expect(click).toHaveBeenCalledTimes(1);
});

it('preserves ordinary button taps and accepts a swipe back starting on an SVG icon', () => {
  const click = jest.fn();
  render(<><PageGestures /><button onClick={click}><svg><circle data-testid="icon" /></svg>Action</button></>);
  const icon = screen.getByTestId('icon');
  fireEvent.touchStart(icon, { touches: [point(600, 100)] });
  expect(fireEvent.touchMove(icon, { touches: [point(602, 100)] })).toBe(true);
  fireEvent.touchEnd(icon, { touches: [], changedTouches: [point(602, 100)] });
  fireEvent.click(icon, { detail: 1 });
  expect(click).toHaveBeenCalledTimes(1);
  drag(icon, 600, 100, 900, 102);
  act(() => { jest.advanceTimersByTime(200); });
  expect(mockBack).toHaveBeenCalledTimes(1);
  fireEvent.click(icon, { detail: 1 });
  expect(click).toHaveBeenCalledTimes(1);
});

describe('the whole page travels with the finger', () => {
  function renderPage() {
    const { container } = render(
      <div data-testid="shell">
        <PageGestures data-study-workspace="" className="min-h-screen"><main data-testid="content">Page content</main></PageGestures>
      </div>,
    );
    return { surface: container.querySelector('[data-page-gesture]') as HTMLElement, shell: screen.getByTestId('shell') };
  }

  it('is the page root itself, so layout rules on its direct children keep working', () => {
    const { surface } = renderPage();
    expect(surface).toHaveAttribute('data-study-workspace', '');
    expect(surface).toHaveClass('min-h-screen');
    expect(surface.firstElementChild).toBe(screen.getByTestId('content'));
    expect(surface.style.position).toBe('');
  });

  it('moves the page sideways without a transform and clips the widened document only while moving', () => {
    const { surface, shell } = renderPage();
    const content = screen.getByTestId('content');
    fireEvent.touchStart(content, { touches: [point(200, 300)] });
    act(() => { jest.advanceTimersByTime(300); }); // a slow drag: neither a flick nor past the threshold on release
    fireEvent.touchMove(content, { touches: [point(280, 302)] });
    fireEvent.touchMove(content, { touches: [point(340, 302)] });
    expect(surface.style.position).toBe('relative');
    expect(surface.style.left).toBe('140px');
    expect(surface.style.top).toBe('');
    expect(surface.style.getPropertyValue('--page-gesture-x')).toBe('140px');
    fireEvent.touchMove(content, { touches: [point(260, 302)] });
    act(() => { jest.advanceTimersByTime(300); });
    expect(surface.style.transform).toBe('');
    expect(shell.style.overflowX).toBe('clip');
    fireEvent.touchEnd(content, { touches: [], changedTouches: [point(260, 302)] });
    expect(surface).toHaveAttribute('data-page-gesture', 'settling');
    act(() => { jest.advanceTimersByTime(250); });
    expect(surface.style.position).toBe('');
    expect(shell.style.overflowX).toBe('');
  });

  it('slides the page out before going back', () => {
    const { surface } = renderPage();
    const content = screen.getByTestId('content');
    fireEvent.touchStart(content, { touches: [point(200, 300)] });
    fireEvent.touchMove(content, { touches: [point(500, 302)] });
    fireEvent.touchEnd(content, { touches: [], changedTouches: [point(500, 302)] });
    expect(surface.style.left).toBe(`${window.innerWidth}px`);
    expect(mockBack).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(200); });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
