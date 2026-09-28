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
  window.matchMedia = jest.fn().mockImplementation(() => ({ matches: true }));
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

it.each([10, 600, 1190])('reloads the document immediately after a top pull at x=%s', async x => {
  render(<><PageGestures /><div data-testid="content">Page content</div></>);
  drag(screen.getByTestId('content'), x, 100, x, 280);
  await act(async () => { await Promise.resolve(); });
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('gestures.refreshing');
});

it.each(['button', 'link'])('starts a pull on a %s without turning it into a click', async role => {
  const click = jest.fn();
  render(<><PageGestures /><button onClick={click}>Action</button><a href="/settings" onClick={click}>Settings</a></>);
  drag(screen.getByRole(role), 10, 100, 10, 280);
  await act(async () => { await Promise.resolve(); });
  expect(reload).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole(role), { detail: 1 });
  expect(click).not.toHaveBeenCalled();
});

it('preserves ordinary button taps and accepts pulls starting on an SVG icon', () => {
  const click = jest.fn();
  render(<><PageGestures /><button onClick={click}><svg><circle data-testid="icon" /></svg>Action</button></>);
  const icon = screen.getByTestId('icon');
  fireEvent.touchStart(icon, { touches: [point(1190, 100)] });
  expect(fireEvent.touchMove(icon, { touches: [point(1190, 102)] })).toBe(true);
  fireEvent.touchEnd(icon, { touches: [], changedTouches: [point(1190, 102)] });
  fireEvent.click(icon, { detail: 1 });
  expect(click).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
  drag(icon, 1190, 100, 1190, 280);
  expect(reload).toHaveBeenCalledTimes(1);
  fireEvent.click(icon, { detail: 1 });
  expect(click).toHaveBeenCalledTimes(1);
});
