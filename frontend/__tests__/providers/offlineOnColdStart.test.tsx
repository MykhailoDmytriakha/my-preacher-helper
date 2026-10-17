import { render, screen, act } from '@testing-library/react';
import React from 'react';

import { OfflineBanner } from '@/components/OfflineBanner';
import { OfflineIndicator } from '@/components/navigation/OfflineIndicator';
import { STATUS_SETTLE_MS } from '@/hooks/useLasting';
import { ConnectionProvider } from '@/providers/ConnectionProvider';
import {
  __resetConnectivityForTests,
  reportServerReachable,
  reportServerUnreachable,
} from '@/utils/connectivity';
import '@testing-library/jest-dom';

/**
 * THE APP OPENED WITH THE WI-FI ALREADY OFF, AND SAID NOTHING ABOUT IT.
 *
 * Reported from the iPad PWA: Wi-Fi switched off first, app opened second. The screen
 * showed a long freshness diagnostic panel — "the device reports no internet", a check
 * timeline, a developer-details button — and no crossed-out Wi-Fi icon, no offline strip.
 * Exactly backwards: the loud element explained an internal detail, and the two built to
 * say "you are offline" stayed hidden.
 *
 * The cause was that connectivity lived in the transport and meant "did a request fail".
 * A session launched with no connection issues no requests, so it answered "online" all
 * session long.
 *
 * NOTE WHAT THE FIRST TEST DOES: it never dispatches an `offline` event. That event fires
 * on a TRANSITION and never fired in the reported session — a test that used it would be
 * checking a different bug. Resetting the store lets the cold-start case be exercised right
 * next to the UI it is supposed to drive.
 */
const setOnLine = (value: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en' } }),
}));

const renderOfflineUi = () =>
  render(
    <ConnectionProvider>
      <OfflineIndicator />
      <OfflineBanner />
    </ConnectionProvider>
  );

const offlineUi = () => ({
  icon: screen.queryByRole('button', { name: 'connection.offlineIconLabel' }),
  strip: screen.queryByText('connection.offlineBanner'),
});

describe('the app tells the person it is offline', () => {
  beforeEach(() => {
    __resetConnectivityForTests();
    setOnLine(true);
  });

  afterEach(() => {
    __resetConnectivityForTests();
    setOnLine(true);
  });

  it('shows the icon and the strip when it opens with the network already gone', () => {
    setOnLine(false);

    renderOfflineUi();

    const { icon, strip } = offlineUi();
    expect(icon).toBeInTheDocument();
    expect(strip).toBeInTheDocument();
  });

  it('shows them when the connection drops while the screen is open', () => {
    renderOfflineUi();

    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });

    const { icon, strip } = offlineUi();
    expect(icon).toBeInTheDocument();
    expect(strip).toBeInTheDocument();
  });

  it('stays quiet while the connection is up', () => {
    renderOfflineUi();

    const { icon, strip } = offlineUi();
    expect(icon).not.toBeInTheDocument();
    expect(strip).not.toBeInTheDocument();
  });

  it('does not declare itself back online just because the browser announced a network', () => {
    /**
     * A joined Wi-Fi with no route out — a café portal, a hotel landing page — still
     * reports `navigator.onLine === true` and still fires `online`. Believing the event
     * would clear the icon over a connection that reaches nothing. Only a request that comes
     * back may say we are online (the event makes the app knock; it does not answer for it).
     */
    jest.useFakeTimers();
    try {
      renderOfflineUi();

      act(() => {
        reportServerUnreachable();
      });
      // A request that did not reach is said once "no connection" has lasted (the owner, 2026-10-17).
      act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
      expect(offlineUi().icon).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      expect(offlineUi().icon).toBeInTheDocument();
      expect(offlineUi().strip).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears as soon as a request gets through', () => {
    // Owner's rule 2: the request reached our server, so there is a connection — no settling wait.
    jest.useFakeTimers();
    try {
      renderOfflineUi();

      act(() => { reportServerUnreachable(); });
      act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
      expect(offlineUi().icon).toBeInTheDocument();

      act(() => { reportServerReachable(); });

      expect(offlineUi().icon).not.toBeInTheDocument();
      expect(offlineUi().strip).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  // The owner, 2026-10-17: on a weak signal one write ran out of time and "Working offline" flashed for
  // seconds after a mark, while the server answered the knock. A request that did not reach is said only
  // once "no connection" has lasted; the phone saying it has no network is said at once (above).
  it('says nothing when one request did not reach and the next one did within the settle time', () => {
    jest.useFakeTimers();
    try {
      renderOfflineUi();

      act(() => { reportServerUnreachable(); });
      act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS - 1); });
      expect(offlineUi().icon).not.toBeInTheDocument();
      expect(offlineUi().strip).not.toBeInTheDocument();

      act(() => { reportServerReachable(); });
      act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
      expect(offlineUi().icon).not.toBeInTheDocument();
      expect(offlineUi().strip).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  // Codex review 2026-10-17: a request did not reach (nothing said yet), and a second later the Wi-Fi
  // went. The answer was "no" already, so the phone's event changed nothing the screen listened to,
  // and the line waited out the rest of the settle time while the phone said plainly: no network.
  it('says it at once when the network goes while a request that did not reach is still settling', () => {
    jest.useFakeTimers();
    try {
      renderOfflineUi();

      act(() => { reportServerUnreachable(); });
      act(() => { jest.advanceTimersByTime(1_000); });
      expect(offlineUi().icon).not.toBeInTheDocument();

      act(() => {
        setOnLine(false);
        window.dispatchEvent(new Event('offline'));
      });

      expect(offlineUi().icon).toBeInTheDocument();
      expect(offlineUi().strip).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  // Said once, it stays said until a request gets through: a joined Wi-Fi without internet must not
  // hide the line and bring it back when the settle time runs out.
  it('keeps saying it when the phone has a network again but nothing has reached the server yet', () => {
    jest.useFakeTimers();
    try {
      setOnLine(false);
      const { rerender } = renderOfflineUi();
      expect(offlineUi().icon).toBeInTheDocument();

      act(() => {
        setOnLine(true);
        window.dispatchEvent(new Event('online'));
      });
      rerender(
        <ConnectionProvider>
          <OfflineIndicator />
          <OfflineBanner />
        </ConnectionProvider>
      );

      expect(offlineUi().icon).toBeInTheDocument();
      expect(offlineUi().strip).toBeInTheDocument();

      act(() => { reportServerReachable(); });
      expect(offlineUi().icon).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('notices a network lost while the app was frozen in the background', () => {
    /**
     * An installed app suspended by the OS can miss the `offline` event entirely — the
     * mirror image of the reported bug. Coming back into view is the moment to re-read
     * the device rather than trust what was true before the freeze.
     */
    renderOfflineUi();
    expect(offlineUi().icon).not.toBeInTheDocument();

    act(() => {
      setOnLine(false); // happened while frozen: no event was delivered
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(offlineUi().icon).toBeInTheDocument();
    expect(offlineUi().strip).toBeInTheDocument();
  });
});

describe('the offline icon speaks the interface language', () => {
  beforeEach(() => {
    __resetConnectivityForTests();
    setOnLine(false);
  });

  afterEach(() => {
    __resetConnectivityForTests();
    setOnLine(true);
  });

  /**
   * With the freshness panel standing down offline, this icon carries the whole message —
   * so its tooltip and accessible name must come from the translation layer. They were
   * hardcoded English ("Offline Mode: Click to re-check connection") showing in a Russian
   * interface, the same defect already fixed once in the strip.
   */
  it('takes its tooltip and name from the locales, not from hardcoded English', () => {
    renderOfflineUi();

    const icon = screen.getByRole('button', { name: 'connection.offlineIconLabel' });
    expect(icon).toHaveAttribute('title', 'connection.offlineIconTitle');
    expect(screen.queryByText(/Offline Mode/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/re-check connection/i)).not.toBeInTheDocument();
  });
});
