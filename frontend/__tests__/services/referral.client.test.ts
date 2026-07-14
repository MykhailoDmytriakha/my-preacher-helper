import {
  capturePendingReferral,
  claimPendingReferral,
  PENDING_REFERRAL_KEY,
  PENDING_REFERRAL_TS_KEY,
} from '@/services/referral.client';

describe('referral client delivery', () => {
  const getIdToken = jest.fn();
  const fetchMock = jest.mocked(fetch);

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    getIdToken.mockResolvedValue('firebase-token');
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  });

  it('captures a non-empty referral from the landing URL before auth', () => {
    capturePendingReferral('?ref=inviter-1');

    expect(localStorage.getItem(PENDING_REFERRAL_KEY)).toBe('inviter-1');
  });

  it.each(['', '?ref=', '?ref=%20%20'])('does nothing without a usable ref: %s', (search) => {
    capturePendingReferral(search);

    expect(localStorage.getItem(PENDING_REFERRAL_KEY)).toBeNull();
  });

  it('does not capture the current user as their own inviter', () => {
    capturePendingReferral('?ref=own-uid', 'own-uid');

    expect(localStorage.getItem(PENDING_REFERRAL_KEY)).toBeNull();
  });

  it('keeps landing usable when referral storage is unavailable', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('blocked');
    });

    expect(() => capturePendingReferral('?ref=inviter-1')).not.toThrow();
    setItem.mockRestore();
  });

  it('posts the pending referral with a Firebase bearer token and clears it', async () => {
    localStorage.setItem(PENDING_REFERRAL_KEY, 'inviter-1');

    await claimPendingReferral({ uid: 'invitee-1', getIdToken });

    expect(fetchMock).toHaveBeenCalledWith('/api/referral/claim', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer firebase-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'inviter-1' }),
    });
    expect(localStorage.getItem(PENDING_REFERRAL_KEY)).toBeNull();
  });

  it('clears the referral on a terminal non-success HTTP response', async () => {
    localStorage.setItem(PENDING_REFERRAL_KEY, 'inviter-1');
    fetchMock.mockResolvedValue(new Response('{}', { status: 409 }));

    await claimPendingReferral({ uid: 'invitee-1', getIdToken });

    expect(localStorage.getItem(PENDING_REFERRAL_KEY)).toBeNull();
  });

  it('retains the referral when no HTTP response exists', async () => {
    localStorage.setItem(PENDING_REFERRAL_KEY, 'inviter-1');
    fetchMock.mockRejectedValue(new Error('offline'));

    await claimPendingReferral({ uid: 'invitee-1', getIdToken });

    expect(localStorage.getItem(PENDING_REFERRAL_KEY)).toBe('inviter-1');
  });

  it('retains the referral on a retryable status so a later verified sign-in can deliver it', async () => {
    // e.g. a guest (email_verified false) hits 403; the real Google sign-in that
    // follows must still be able to attribute the inviter.
    localStorage.setItem(PENDING_REFERRAL_KEY, 'inviter-1');
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));

    await claimPendingReferral({ uid: 'invitee-1', getIdToken });

    expect(localStorage.getItem(PENDING_REFERRAL_KEY)).toBe('inviter-1');
  });

  it('drops a stale captured referral past the eligibility window without a request', async () => {
    localStorage.setItem(PENDING_REFERRAL_KEY, 'inviter-1');
    localStorage.setItem(
      PENDING_REFERRAL_TS_KEY,
      String(Date.now() - 25 * 60 * 60 * 1000)
    );

    await claimPendingReferral({ uid: 'invitee-1', getIdToken });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING_REFERRAL_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_REFERRAL_TS_KEY)).toBeNull();
  });

  it('clears a manually planted self-referral without making a request', async () => {
    localStorage.setItem(PENDING_REFERRAL_KEY, 'own-uid');

    await claimPendingReferral({ uid: 'own-uid', getIdToken });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING_REFERRAL_KEY)).toBeNull();
  });

  it('does not reject when storage reads are blocked', async () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('blocked');
    });

    await expect(claimPendingReferral({ uid: 'invitee-1', getIdToken })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    getItem.mockRestore();
  });

  it('does not reject when terminal-response cleanup storage is blocked', async () => {
    localStorage.setItem(PENDING_REFERRAL_KEY, 'inviter-1');
    const removeItem = jest.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
      throw new Error('blocked');
    });

    await expect(claimPendingReferral({ uid: 'invitee-1', getIdToken })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    removeItem.mockRestore();
  });

  it('does not reject when self-referral cleanup storage is blocked', async () => {
    localStorage.setItem(PENDING_REFERRAL_KEY, 'own-uid');
    const removeItem = jest.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
      throw new Error('blocked');
    });

    await expect(claimPendingReferral({ uid: 'own-uid', getIdToken })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    removeItem.mockRestore();
  });

  it('is byte-preserving for users without a pending referral', async () => {
    await claimPendingReferral({ uid: 'invitee-1', getIdToken });

    expect(getIdToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
