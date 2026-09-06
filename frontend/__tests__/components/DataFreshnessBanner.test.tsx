import { fireEvent, render, screen } from '@testing-library/react';

import { DataFreshnessBanner } from '@/components/DataFreshnessBanner';
import '@testing-library/jest-dom';
import type { FreshnessDiagnostics, FreshnessEvent, FreshnessReason } from '@/hooks/useDocumentFreshness';

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
    incident: { origin, events: [origin] },
  };
  const noop = () => {};

  it.each<FreshnessReason>(['initialCheck', 'cached', 'offline', 'listenerStopped', 'accessDenied',
    'accountRequired', 'checkFailed', 'checkTimeout', 'pendingChanges'])(
    'shows the observed %s event without expanding history', (reason) => {
      const event = { ...origin, reason };
      render(<DataFreshnessBanner dirty={false} unknown diagnostics={{ ...diagnostics, incident: { origin: event, events: [event] } }} onDismiss={noop} />);
      const detail = screen.getByText('freshness.whatHappened').closest('details')!;
      expect(detail).not.toHaveAttribute('open');
      expect(screen.getAllByText(`freshness.reasons.${reason}`).some((node) => !detail.contains(node))).toBe(true);
      expect(screen.getAllByText('freshness.sources.listener').some((node) => !detail.contains(node))).toBe(true);
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
