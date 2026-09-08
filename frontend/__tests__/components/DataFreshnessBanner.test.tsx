import { fireEvent, render, screen } from '@testing-library/react';

import { DataFreshnessBanner } from '@/components/DataFreshnessBanner';
import {
  __resetConnectivityForTests,
  getConnectivityStatus,
  subscribeToConnectivity,
} from '@/utils/connectivity';
import '@testing-library/jest-dom';

import type { FreshnessDiagnostics, FreshnessEvent, FreshnessReason } from '@/hooks/useDocumentFreshness';

/**
 * Move connectivity the way the app really moves it. `apiClient` is the single writer:
 * it starts from the device state and listens for the device losing the network, so a
 * test that only rewrites `navigator.onLine` would be describing a state the app cannot
 * actually be in.
 */
let releaseStore: (() => void) | null = null;

const setDevice = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });
};

const goOffline = () => {
  __resetConnectivityForTests();
  setDevice(false);
  releaseStore?.();
  releaseStore = subscribeToConnectivity(() => {});
  getConnectivityStatus();
};

const goOnline = () => {
  __resetConnectivityForTests();
  setDevice(true);
  releaseStore?.();
  releaseStore = null;
};

/**
 * "I cannot tell whether this is current" must LOOK different from "this is
 * current". Showing nothing in that state is the quiet lie: the connection drops,
 * the listener goes cache-only, and the person keeps editing what may already be
 * someone else's yesterday — with the screen implying all is well.
 */
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => (vars?.entity ? `${key}:${vars.entity}` : key),
  }),
}));

describe('DataFreshnessBanner', () => {
  const noop = () => {};

  it('says the freshness is UNKNOWN rather than implying it is fresh', () => {
    render(<DataFreshnessBanner dirty={false} unknown entityKey="entitySermon" onDismiss={noop} />);

    expect(screen.getByText('freshness.unknownTitle')).toBeInTheDocument();
    expect(
      screen.getByText('freshness.unknownDescription:freshness.entitySermon')
    ).toBeInTheDocument();
  });

  it('offers no "load newer" while unknown — there is nothing known to load', () => {
    render(
      <DataFreshnessBanner dirty={false} unknown entityKey="entitySermon" onRefresh={noop} onDismiss={noop} />
    );

    expect(screen.queryByText('freshness.refreshAction')).not.toBeInTheDocument();
  });

  it('still says CHANGED when the server really holds something newer', () => {
    render(<DataFreshnessBanner dirty={false} entityKey="entityNote" onRefresh={noop} onDismiss={noop} />);

    expect(screen.getByText('freshness.title')).toBeInTheDocument();
    expect(screen.getByText('freshness.refreshAction')).toBeInTheDocument();
  });

  it('a deleted record wins over both', () => {
    render(<DataFreshnessBanner dirty={false} unknown deleted entityKey="entityNote" onDismiss={noop} />);

    expect(screen.getByText('freshness.deletedTitle')).toBeInTheDocument();
  });

  /**
   * BUG-20260810-freshness-banner-no-primary-action
   *
   * The default wording asks "load the newer version?" — but that button only
   * exists when a caller passes `onRefresh`, and callers deliberately omit it where
   * refreshing would destroy unsaved work. On production the owner met a question
   * with no way to say yes, and read it as a broken screen. A banner must never ask
   * something it cannot answer.
   */
  describe('when no refresh action is available', () => {
    it('does not ask to load the newer version', () => {
      render(<DataFreshnessBanner dirty={false} entityKey="entitySermon" onDismiss={noop} />);

      expect(
        screen.queryByText('freshness.description:freshness.entitySermon')
      ).not.toBeInTheDocument();
      expect(screen.queryByText('freshness.refreshAction')).not.toBeInTheDocument();
    });

    it('tells the person what they can do instead', () => {
      render(<DataFreshnessBanner dirty={false} entityKey="entitySermon" onDismiss={noop} />);

      expect(screen.getByText('freshness.title')).toBeInTheDocument();
      expect(
        screen.getByText('freshness.descriptionNoAction:freshness.entitySermon')
      ).toBeInTheDocument();
    });

    /**
     * BUG-20260810-freshness-no-soft-refresh
     *
     * Pulling a record takes a moment on a slow connection. A button that looks idle
     * while working invites a second and third press, and each one refetches.
     */
    it('shows the refresh is in flight and refuses a second press', () => {
      render(
        <DataFreshnessBanner
          dirty={false}
          entityKey="entitySermon"
          onRefresh={noop}
          refreshing
          onDismiss={noop}
        />
      );

      const button = screen.getByText('freshness.refreshingAction').closest('button');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText('freshness.refreshAction')).not.toBeInTheDocument();
    });

    it('is pressable again once the refresh is done', () => {
      render(
        <DataFreshnessBanner dirty={false} entityKey="entitySermon" onRefresh={noop} onDismiss={noop} />
      );

      const button = screen.getByText('freshness.refreshAction').closest('button');
      expect(button).toBeEnabled();
    });

    it('keeps asking — with the button — when a refresh really is offered', () => {
      render(
        <DataFreshnessBanner dirty={false} entityKey="entitySermon" onRefresh={noop} onDismiss={noop} />
      );

      expect(
        screen.getByText('freshness.description:freshness.entitySermon')
      ).toBeInTheDocument();
      expect(screen.getByText('freshness.refreshAction')).toBeInTheDocument();
    });
  });
});


describe('diagnostic evidence visible in a screenshot', () => {
  const origin: FreshnessEvent = { reason: 'cached', source: 'listener', at: 1_783_000_000_000 };
  const diagnostics: FreshnessDiagnostics = {
    lastServerResponseAt: origin.at - 120_000, lastServerResult: 'matching',
    persistentFailure: null,
    incident: { origin, events: [origin] },
  };
  const noop = () => {};

  it.each<FreshnessReason>(['initialCheck', 'cached', 'listenerStopped', 'accessDenied',
    'accountRequired', 'checkFailed', 'checkTimeout', 'pendingChanges'])(
    'shows the observed %s event without expanding history', (reason) => {
      const event = { ...origin, reason };
      render(<DataFreshnessBanner dirty={false} unknown diagnostics={{ ...diagnostics, incident: { origin: event, events: [event] } }} onDismiss={noop} />);
      const detail = screen.getByText('freshness.whatHappened').closest('details')!;
      expect(detail).not.toHaveAttribute('open');
      expect(screen.getAllByText(`freshness.reasons.${reason}`).some((node) => !detail.contains(node))).toBe(true);
      expect(screen.getAllByText('freshness.sources.listener').some((node) => !detail.contains(node))).toBe(true);
    });

  it('files an offline origin in the history instead of headlining it after reconnect', () => {
    /**
     * `offline` is the one reason this banner never headlines. While the connection is
     * down the banner is silent — the crossed-out Wi-Fi icon is the message — and once it
     * is back, the sticky origin would otherwise reprint "the device reports no internet"
     * over a working connection. The evidence still has to be findable, so it lives in
     * the expandable history.
     */
    const event: FreshnessEvent = { ...origin, reason: 'offline', source: 'device' };
    render(
      <DataFreshnessBanner
        dirty={false}
        unknown
        diagnostics={{ ...diagnostics, incident: { origin: event, events: [event] } }}
        onDismiss={noop}
      />
    );

    const detail = screen.getByText('freshness.whatHappened').closest('details')!;
    expect(screen.getByText('freshness.unknownTitle')).toBeInTheDocument();
    // The history entry interleaves a <time> element with the reason, so the text is
    // split across nodes — assert on the container's text, not on a single node.
    expect(detail).toHaveTextContent('freshness.reasons.offline');
    const outsideHistory = Array.from(screen.getByRole('status').querySelectorAll('p'))
      .filter((node) => !detail.contains(node))
      .map((node) => node.textContent)
      .join(' ');
    expect(outsideHistory).not.toContain('freshness.reasons.offline');
  });

  it('keeps the start, last proof and last attempt distinguishable', () => {
    const latest: FreshnessEvent = { reason: 'checkFailed', source: 'manual', at: origin.at + 60_000 };
    const { container } = render(<DataFreshnessBanner dirty={false} unknown diagnostics={{ ...diagnostics, incident: { origin, events: [origin, latest] } }} onDismiss={noop} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('freshness.lastServerResponse');
    const detail = status.querySelector('details')!;
    const visibleText = Array.from(status.querySelectorAll('p')).filter((node) => !detail.contains(node)).map((node) => node.textContent).join(' ');
    expect(visibleText).toContain('freshness.reasons.cached');
    expect(visibleText).toContain('freshness.reasons.checkFailed');
    expect(visibleText).toContain('freshness.sources.manual');
    expect(container.querySelector(`time[datetime="${new Date(origin.at).toISOString()}"]`)).toBeInTheDocument();
    expect(container.querySelector(`time[datetime="${new Date(diagnostics.lastServerResponseAt!).toISOString()}"]`)).toBeInTheDocument();
  });

  it('offers read-only retry, including after a previously confirmed deletion', () => {
    const check = jest.fn();
    const refresh = jest.fn();
    const dismiss = jest.fn();
    const { rerender } = render(<DataFreshnessBanner dirty unknown deleted diagnostics={diagnostics} onCheckAgain={check} onRefresh={refresh} onDismiss={dismiss} />);
    fireEvent.click(screen.getByText('freshness.checkAgainAction'));
    expect(check).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText('freshness.refreshAction')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('freshness.dismissAction'));
    expect(dismiss).toHaveBeenCalledTimes(1);
    rerender(<DataFreshnessBanner dirty unknown checking diagnostics={diagnostics} onCheckAgain={check} onDismiss={dismiss} />);
    expect(screen.getByText('freshness.checkingAction')).toBeDisabled();
    fireEvent.click(screen.getByText('freshness.checkingAction'));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('does not equate a missing first response with a save or conceal known differences', () => {
    const { rerender } = render(<DataFreshnessBanner dirty={false} unknown diagnostics={{ ...diagnostics, lastServerResponseAt: null }} onDismiss={noop} />);
    expect(screen.getByText('freshness.noServerResponse')).toBeInTheDocument();
    rerender(<DataFreshnessBanner dirty unknown diagnostics={{ ...diagnostics, lastServerResult: 'different' }} onDismiss={noop} />);
    expect(screen.getByText('freshness.previouslyDifferent')).toBeInTheDocument();
  });
});

describe('offline, the icon speaks and the panel steps aside', () => {
  afterEach(() => goOnline());

  /**
   * Reported from the iPad PWA opened with the Wi-Fi already off: instead of a
   * crossed-out Wi-Fi icon, the screen carried a freshness panel headed "the device
   * reports no internet", with a check timeline and a developer-details button.
   * Offline, "we cannot confirm this is the newest version" is the obvious
   * consequence of having no connection, and the header already says that.
   */
  it('says nothing about unverifiable freshness while there is no connection', () => {
    goOffline();

    const { container } = render(
      <DataFreshnessBanner dirty={false} unknown onDismiss={jest.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('still reports a remote edit offline — that is news the icon cannot carry', () => {
    goOffline();

    render(
      <DataFreshnessBanner
        dirty={false}
        entityKey="entitySermon"
        onRefresh={jest.fn()}
        onDismiss={jest.fn()}
      />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('still reports a deletion offline', () => {
    goOffline();

    render(<DataFreshnessBanner dirty={false} deleted onDismiss={jest.fn()} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('keeps explaining unverifiable freshness while the connection is up', () => {
    goOnline();

    render(<DataFreshnessBanner dirty={false} unknown onDismiss={jest.fn()} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('losing the connection must not erase what the server already confirmed', () => {
  afterEach(() => goOnline());

  /**
   * THE SHAPE THE REAL HOOK PRODUCES, WHICH THE FIRST VERSION OF THIS SUPPRESSION MISSED.
   *
   * `unavailable()` in useDocumentFreshness flips the state to `unknown` on the offline
   * event, but leaves `remotelyDeleted` and `remote` holding the answer the server had
   * already given. Every screen passes `unknown` and `deleted` together. So the states
   * below are not hypothetical compositions — they are exactly what a person gets when
   * a record changes or disappears elsewhere and then their Wi-Fi drops.
   */
  const diagnosticsAfterGoingOffline = (
    lastServerResult: 'different' | 'deleted' | 'matching' | null
  ) => ({
    lastServerResponseAt: Date.now() - 60_000,
    lastServerResult,
    persistentFailure: null,
    incident: {
      origin: { reason: 'offline' as const, at: Date.now(), source: 'device' as const },
      events: [{ reason: 'offline' as const, at: Date.now(), source: 'device' as const }],
    },
  });

  it('keeps the deletion warning when the connection drops after a confirmed deletion', () => {
    goOffline();

    render(
      <DataFreshnessBanner
        dirty={false}
        unknown
        deleted
        diagnostics={diagnosticsAfterGoingOffline('deleted')}
        onDismiss={jest.fn()}
      />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('keeps the warning when the connection drops after a confirmed difference', () => {
    goOffline();

    render(
      <DataFreshnessBanner
        dirty={false}
        unknown
        entityKey="entitySermon"
        diagnostics={diagnosticsAfterGoingOffline('different')}
        onDismiss={jest.fn()}
      />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('keeps speaking when access was denied and the connection then dropped', () => {
    /**
     * Revoked permission or a lost session does not go away when the Wi-Fi returns —
     * the next save will still fail. Hiding it behind "you are offline" would let a
     * person keep writing toward a save that cannot happen.
     */
    goOffline();

    render(
      <DataFreshnessBanner
        dirty={false}
        unknown
        diagnostics={{
          lastServerResponseAt: null,
          lastServerResult: null,
          /**
           * The hook remembers this OUTSIDE the event list, because that list is a ring
           * buffer: pressing "check again" a few times offline appends two events per
           * press and would otherwise push the access denial out of the window, taking
           * the warning and its retry button off the screen.
           */
          persistentFailure: 'accessDenied',
          incident: {
            origin: { reason: 'accessDenied', at: Date.now(), source: 'listener' },
            events: [
              { reason: 'accessDenied', at: Date.now(), source: 'listener' },
              { reason: 'offline', at: Date.now(), source: 'device' },
            ],
          },
        }}
        onDismiss={jest.fn()}
      />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('stays silent for a plain offline start with nothing else known', () => {
    goOffline();

    const { container } = render(
      <DataFreshnessBanner
        dirty={false}
        unknown
        diagnostics={diagnosticsAfterGoingOffline(null)}
        onDismiss={jest.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('stays silent offline when the last server answer was that everything matched', () => {
    goOffline();

    const { container } = render(
      <DataFreshnessBanner
        dirty={false}
        unknown
        diagnostics={diagnosticsAfterGoingOffline('matching')}
        onDismiss={jest.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('a reason that outlived its condition must not be shown as current', () => {
  afterEach(() => goOnline());

  /**
   * `incident.origin` is sticky by design, so after a disconnection it keeps saying
   * `offline` long after the network is back — and the banner reappears the moment we are
   * online again, because the state stays `unknown` until a server snapshot lands. Left
   * alone, that reprints "the device reports no internet" over a working connection: the
   * exact sentence this work started from, merely relocated to reconnection.
   */
  it('stops blaming the connection once the connection is back', () => {
    goOnline();

    render(
      <DataFreshnessBanner
        dirty={false}
        unknown
        diagnostics={{
          lastServerResponseAt: null,
          lastServerResult: null,
          persistentFailure: null,
          incident: {
            origin: { reason: 'offline', at: Date.now(), source: 'device' },
            events: [{ reason: 'offline', at: Date.now(), source: 'device' }],
          },
        }}
        onDismiss={jest.fn()}
      />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('freshness.reasons.offline')).not.toBeInTheDocument();
    expect(screen.getByText('freshness.unknownTitle')).toBeInTheDocument();
  });
});

describe('offline never becomes the headline', () => {
  afterEach(() => goOnline());

  /**
   * While the connection is down this banner is on screen at all only because something
   * more important is true — the server holds a different version, or this record was
   * deleted elsewhere. Leading with "the device reports no internet" would bury that under
   * the exact sentence this work set out to stop showing, and the crossed-out Wi-Fi icon is
   * already saying it.
   */
  it('leads with the remote change, not the lost connection', () => {
    goOffline();

    render(
      <DataFreshnessBanner
        dirty={false}
        unknown
        entityKey="entitySermon"
        diagnostics={{
          lastServerResponseAt: Date.now() - 60_000,
          lastServerResult: 'different',
          persistentFailure: null,
          incident: {
            origin: { reason: 'offline', at: Date.now(), source: 'device' },
            events: [{ reason: 'offline', at: Date.now(), source: 'device' }],
          },
        }}
        onDismiss={jest.fn()}
      />
    );

    const status = screen.getByRole('status');
    const headline = status.querySelector('p')!;
    expect(headline).not.toHaveTextContent('freshness.reasons.offline');
    expect(headline).toHaveTextContent('freshness.unknownTitle');
  });
});
