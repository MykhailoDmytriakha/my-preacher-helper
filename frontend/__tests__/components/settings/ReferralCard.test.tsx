import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fetchMock from 'jest-fetch-mock';
import React from 'react';

import ReferralCard from '@/components/settings/ReferralCard';

import type { User } from 'firebase/auth';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key} ${options.count}`,
  }),
}));

describe('ReferralCard', () => {
  const writeText = jest.fn();
  const user = { uid: 'user with spaces' } as User;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.resetMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('renders an encoded read-only referral link for the signed-in user', async () => {
    render(<ReferralCard user={user} />);

    const input = await screen.findByRole('textbox', { name: 'settings.referral.linkLabel' });
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveValue(`${window.location.origin}/?ref=user%20with%20spaces`);
    expect(screen.getByRole('heading', { name: 'settings.referral.title' })).toBeInTheDocument();
    expect(screen.getByText('settings.referral.description')).toBeInTheDocument();
  });

  it('copies the link and confirms success accessibly', async () => {
    render(<ReferralCard user={user} />);
    const input = await screen.findByRole('textbox', { name: 'settings.referral.linkLabel' });

    fireEvent.click(screen.getByRole('button', { name: 'settings.referral.copy' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(input.getAttribute('value'));
      expect(screen.getByRole('button', { name: 'settings.referral.copied' })).toBeInTheDocument();
    });
  });

  it('loads and renders the signed-in inviter count beside the reward summary', async () => {
    const statsUser = {
      uid: 'inviter-1',
      getIdToken: jest.fn().mockResolvedValue('firebase-token'),
    } as unknown as User;
    fetchMock.mockResponseOnce(JSON.stringify({ invitedCount: 3 }));

    render(<ReferralCard user={statsUser} />);

    expect(await screen.findByText('settings.referral.invitedCount 3')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/referral/stats', {
      headers: { Authorization: 'Bearer firebase-token' },
    });
  });

  it('hides referral stats when the endpoint fails', async () => {
    const statsUser = {
      uid: 'inviter-1',
      getIdToken: jest.fn().mockResolvedValue('firebase-token'),
    } as unknown as User;
    fetchMock.mockRejectOnce(new Error('offline'));

    render(<ReferralCard user={statsUser} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/settings\.referral\.invitedCount/)).not.toBeInTheDocument();
  });

  it('resets the Copy label about two seconds after a successful copy', async () => {
    jest.useFakeTimers();
    render(<ReferralCard user={user} />);
    await screen.findByRole('textbox', { name: 'settings.referral.linkLabel' });

    fireEvent.click(screen.getByRole('button', { name: 'settings.referral.copy' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'settings.referral.copied' })).toBeInTheDocument();

    act(() => jest.advanceTimersByTime(2_000));
    expect(screen.getByRole('button', { name: 'settings.referral.copy' })).toBeInTheDocument();
    jest.useRealTimers();
  });

  it('keeps the Copy state when clipboard access fails', async () => {
    writeText.mockRejectedValue(new Error('blocked'));
    render(<ReferralCard user={user} />);
    await screen.findByRole('textbox', { name: 'settings.referral.linkLabel' });

    fireEvent.click(screen.getByRole('button', { name: 'settings.referral.copy' }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'settings.referral.copy' })).toBeInTheDocument();
  });

  it('renders nothing without a user', () => {
    const { container } = render(<ReferralCard user={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
