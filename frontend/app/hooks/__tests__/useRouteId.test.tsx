import { renderHook } from '@testing-library/react';
import { useParams } from 'next/navigation';

import { useRouteId } from '../useRouteId';

jest.mock('next/navigation', () => ({ useParams: jest.fn() }));
afterEach(() => { window.history.replaceState(null, '', '/'); });
it.each(['/sermons/local/plan', '/groups/local', '/series/local'])('retains the existing second-segment fallback at %s', path => {
  jest.mocked(useParams).mockReturnValue({}); window.history.replaceState(null, '', path);
  expect(renderHook(() => useRouteId()).result.current).toBe('local');
});
it.each(['/care/council/local', '/care/council/local/conduct', '/care/orders/local'])('resolves nested care identity at %s', path => {
  jest.mocked(useParams).mockReturnValue({}); window.history.replaceState(null, '', path);
  expect(renderHook(() => useRouteId(2)).result.current).toBe('local');
});
it('uses the router identity before the address fallback', () => {
  jest.mocked(useParams).mockReturnValue({ id: 'router-id' }); window.history.replaceState(null, '', '/care/council/fallback');
  expect(renderHook(() => useRouteId(2)).result.current).toBe('router-id');
});
