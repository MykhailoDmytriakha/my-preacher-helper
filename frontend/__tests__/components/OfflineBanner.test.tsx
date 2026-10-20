import { act, render, screen } from '@testing-library/react';
import React from 'react';

import { OfflineBanner } from '@/components/OfflineBanner';
import { STATUS_SETTLE_MS } from '@/hooks/useLasting';
import { __resetServerAvailabilityForTests, reportServerAvailable, reportServerUnavailable } from '@/utils/serverAvailability';

import en from '../../locales/en/translation.json';
import ru from '../../locales/ru/translation.json';
import uk from '../../locales/uk/translation.json';

const mockIsOnline = jest.fn();
jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: () => {
    const isOnline = mockIsOnline();
    return { isOnline, offlineShown: !isOnline };
  },
}));

let mockSignedIn = true;
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockSignedIn ? { uid: 'owner-1' } : null, loading: false, isAuthenticated: mockSignedIn }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('OfflineBanner', () => {
  it('says it through the translation layer, not in hardcoded English', () => {
    /**
     * Found in the browser: the banner read "Working in offline mode…" in a fully Russian
     * interface — at the exact moment a person most needs to understand what is happening
     * to the text they just typed. Every user-visible string belongs in locales/{en,ru,uk}.
     */
    mockIsOnline.mockReturnValue(false);

    render(<OfflineBanner />);

    expect(screen.getByText('connection.offlineBanner')).toBeInTheDocument();
    expect(screen.queryByText(/Working in offline mode/i)).not.toBeInTheDocument();
  });

  it('stays out of the way while the connection is up', () => {
    mockIsOnline.mockReturnValue(true);

    const { container } = render(<OfflineBanner />);

    expect(container).toBeEmptyDOMElement();
  });
});

/*
 * BUG-20261019-outage-said-as-two-check-lines: the server answers, but cannot give the person's data
 * (the database's daily quota spent). One line says it for the whole app, once it lasts.
 */
describe('OfflineBanner while the server cannot give data', () => {
  beforeEach(() => { jest.useFakeTimers(); __resetServerAvailabilityForTests(); });
  afterEach(() => { jest.useRealTimers(); __resetServerAvailabilityForTests(); });

  it('says the server is unavailable once its refusal lasts, and goes quiet when it gives data again', () => {
    mockIsOnline.mockReturnValue(true);
    const { container } = render(<OfflineBanner />);
    act(() => { reportServerUnavailable(1); });
    expect(container).toBeEmptyDOMElement();
    act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
    expect(screen.getByText('connection.serverUnavailableBanner')).toBeInTheDocument();
    act(() => { reportServerAvailable(2); });
    expect(container).toBeEmptyDOMElement();
  });

  it('says "offline" rather than "server unavailable" when there is no connection at all', () => {
    mockIsOnline.mockReturnValue(false);
    render(<OfflineBanner />);
    act(() => { reportServerUnavailable(1); });
    act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
    expect(screen.getByText('connection.offlineBanner')).toBeInTheDocument();
    expect(screen.queryByText('connection.serverUnavailableBanner')).not.toBeInTheDocument();
  });

  // Codex review (round 4): after signing out, a late refusal of the previous account's request could
  // bring the line back on the landing page, where nothing reads data to take it back. Without a
  // signed-in person there is no data on screen to speak about.
  it('says nothing about the server to a person who is not signed in', () => {
    mockIsOnline.mockReturnValue(true);
    mockSignedIn = false;
    try {
      const { container } = render(<OfflineBanner />);
      act(() => { reportServerUnavailable(1); });
      act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
      expect(container).toBeEmptyDOMElement();
    } finally {
      mockSignedIn = true;
    }
  });

  it('has the line in every language', () => {
    for (const locale of [en, ru, uk]) expect(locale.connection.serverUnavailableBanner).toBeTruthy();
  });
});
