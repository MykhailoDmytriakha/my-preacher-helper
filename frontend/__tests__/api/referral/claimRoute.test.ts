jest.mock('@/config/firebaseAdminConfig', () => ({
  adminAuth: {
    verifyIdToken: jest.fn(),
    getUser: jest.fn(),
  },
  adminDb: {
    collection: jest.fn(),
    runTransaction: jest.fn(),
  },
}));

jest.mock('@/services/ownerMail.server', () => ({
  ...jest.requireActual('@/services/ownerMail.server'),
  ownerMailConfigured: jest.fn(),
  sendOwnerNotice: jest.fn(),
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((body, init = {}) => ({
      status: init.status ?? 200,
      headers: new Headers(init.headers),
      json: async () => body,
    })),
  },
  after: jest.fn(),
}));

import { POST } from '@/api/referral/claim/route';

const { adminAuth, adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminAuth: { verifyIdToken: jest.Mock; getUser: jest.Mock };
  adminDb: { collection: jest.Mock; runTransaction: jest.Mock };
};
const { ownerMailConfigured, sendOwnerNotice } = jest.requireMock('@/services/ownerMail.server') as {
  ownerMailConfigured: jest.Mock;
  sendOwnerNotice: jest.Mock;
};
const { after } = jest.requireMock('next/server') as { after: jest.Mock };

// Work the route hands to `after` runs when the test lets it finish, as it would after the response.
const afterTasks: Array<Promise<unknown>> = [];
const settleAfterTasks = () => Promise.all(afterTasks.splice(0));


const NOW = new Date('2026-07-12T12:00:00.000Z');
const documents = new Map<string, Record<string, unknown>>();
const inviterPromotionWrites: unknown[] = [];
const referralEventWrites: Record<string, unknown>[] = [];

const createRequest = (
  body: unknown,
  authorization = 'Bearer valid-token'
): Request => new Request('http://localhost/api/referral/claim', {
  method: 'POST',
  headers: {
    authorization,
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});

describe('POST /api/referral/claim', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    jest.clearAllMocks();
    documents.clear();
    inviterPromotionWrites.length = 0;
    referralEventWrites.length = 0;
    documents.set('users/inviter-1', { paidTier: 'free' });

    adminAuth.verifyIdToken.mockResolvedValue({
      uid: 'invitee-1',
      email_verified: true,
    });
    adminAuth.getUser.mockResolvedValue({
      metadata: { creationTime: '2026-07-12T00:00:00.000Z' },
    });
    sendOwnerNotice.mockResolvedValue(true);
    ownerMailConfigured.mockReturnValue(true);
    afterTasks.length = 0;
    after.mockImplementation((task: () => Promise<unknown>) => { afterTasks.push(task()); });
    adminDb.collection.mockImplementation((collection: string) => ({
      doc: (uid: string) => {
        const path = `${collection}/${uid}`;
        return {
          path,
          get: async () => ({ exists: documents.has(path), data: () => documents.get(path) }),
        };
      },
    }));
    adminDb.runTransaction.mockImplementation(async (callback) => callback({
      get: async (ref: { path: string }) => ({
        exists: documents.has(ref.path),
        data: () => documents.get(ref.path),
      }),
      set: (
        ref: { path: string },
        value: Record<string, unknown>,
        options?: { merge: boolean }
      ) => {
        documents.set(ref.path, options?.merge
          ? { ...(documents.get(ref.path) ?? {}), ...value }
          : value);
        if (ref.path === 'users/inviter-1') inviterPromotionWrites.push(value.promotion);
        if (ref.path === 'referralEvents/invitee-1') referralEventWrites.push(value);
      },
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fails closed with 401 when the Authorization header is missing', async () => {
    const response = await POST(new Request('http://localhost/api/referral/claim', {
      method: 'POST',
      body: JSON.stringify({ ref: 'inviter-1' }),
    }));

    expect(response.status).toBe(401);
    expect(adminAuth.verifyIdToken).not.toHaveBeenCalled();
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
  });

  it('fails closed with 401 when the Bearer token is empty', async () => {
    const response = await POST(createRequest({ ref: 'inviter-1' }, 'Bearer   '));

    expect(response.status).toBe(401);
    expect(adminAuth.verifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects self-referral before account lookup or Firestore access', async () => {
    const response = await POST(createRequest({ ref: 'invitee-1' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'selfReferral' });
    expect(adminAuth.getUser).not.toHaveBeenCalled();
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
    expect(referralEventWrites).toHaveLength(0);
  });

  it('rejects an unverified invitee', async () => {
    adminAuth.verifyIdToken.mockResolvedValue({
      uid: 'invitee-1',
      email_verified: false,
    });

    const response = await POST(createRequest({ ref: 'inviter-1' }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'emailNotVerified' });
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
    expect(referralEventWrites).toHaveLength(0);
  });

  it('rejects an account older than 24 hours', async () => {
    adminAuth.getUser.mockResolvedValue({
      metadata: { creationTime: '2026-07-11T11:59:59.999Z' },
    });

    const response = await POST(createRequest({ ref: 'inviter-1' }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'notEligible' });
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
    expect(referralEventWrites).toHaveLength(0);
  });

  it('fails closed when account creation time is missing or invalid', async () => {
    adminAuth.getUser.mockResolvedValue({ metadata: {} });

    const response = await POST(createRequest({ ref: 'inviter-1' }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'notEligible' });
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
    expect(referralEventWrites).toHaveLength(0);
  });

  it('returns 404 when the inviter document does not exist', async () => {
    documents.delete('users/inviter-1');

    const response = await POST(createRequest({ ref: 'inviter-1' }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'unknownInviter' });
    expect(documents.has('users/invitee-1')).toBe(false);
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
    expect(referralEventWrites).toHaveLength(0);
  });

  it('returns 404 without writes if the inviter disappears after the eligibility gate', async () => {
    const transactionSet = jest.fn();
    adminDb.runTransaction.mockImplementationOnce(async (callback) => callback({
      get: async () => ({
        exists: false,
        data: () => undefined,
      }),
      set: transactionSet,
    }));

    const response = await POST(createRequest({ ref: 'inviter-1' }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'unknownInviter' });
    expect(transactionSet).not.toHaveBeenCalled();
    expect(referralEventWrites).toHaveLength(0);
  });

  it('grants once and returns alreadyClaimed without extending again on replay', async () => {
    const firstResponse = await POST(createRequest({ ref: 'inviter-1' }));

    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toEqual({ status: 'granted' });
    expect(documents.get('users/invitee-1')).toEqual({ referredBy: 'inviter-1' });
    expect(documents.get('users/inviter-1')).toEqual({
      paidTier: 'free',
      promotion: { tier: 'tier1', expiresAt: '2026-08-11T12:00:00.000Z' },
      referralLedger: { count: 1, invitees: [{ uid: 'invitee-1', at: NOW.toISOString() }] },
    });
    expect(documents.get('referralEvents/invitee-1')).toEqual({
      inviterUid: 'inviter-1',
      inviteeUid: 'invitee-1',
      registeredAt: NOW.toISOString(),
      promoTier: 'tier1',
      promoStartAt: NOW.toISOString(),
      promoEndAt: '2026-08-11T12:00:00.000Z',
    });
    expect(inviterPromotionWrites).toHaveLength(1);
    expect(referralEventWrites).toHaveLength(1);

    const secondResponse = await POST(createRequest({ ref: 'inviter-1' }));

    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toEqual({ status: 'alreadyClaimed' });
    expect(inviterPromotionWrites).toHaveLength(1);
    expect(referralEventWrites).toHaveLength(1);
    expect(secondResponse.headers.get('Cache-Control')).toContain('no-store');
  });

  it('records the exact accumulated promotion output for an active higher tier', async () => {
    documents.set('users/inviter-1', {
      promotion: { tier: 'tier3', expiresAt: '2026-07-20T12:00:00.000Z' },
    });

    const response = await POST(createRequest({ ref: 'inviter-1' }));

    expect(response.status).toBe(200);
    expect(documents.get('users/inviter-1')).toEqual({
      promotion: { tier: 'tier3', expiresAt: '2026-08-19T12:00:00.000Z' },
      referralLedger: { count: 1, invitees: [{ uid: 'invitee-1', at: NOW.toISOString() }] },
    });
    expect(documents.get('referralEvents/invitee-1')).toEqual(expect.objectContaining({
      promoTier: 'tier3',
      promoStartAt: NOW.toISOString(),
      promoEndAt: '2026-08-19T12:00:00.000Z',
    }));
  });

  it.each([
    [{}, 'missing ref'],
    [{ ref: '' }, 'empty ref'],
    [{ ref: 'a/b' }, 'path separator'],
    [{ ref: '..' }, 'all-dots uid'],
    [{ ref: 'inviter-1', extra: true }, 'forged extra field'],
  ])('rejects an invalid or forged body: %s (%s)', async (body, _label) => {
    const response = await POST(createRequest(body));

    expect(response.status).toBe(400);
    expect(adminAuth.getUser).not.toHaveBeenCalled();
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const response = await POST(new Request('http://localhost/api/referral/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
      },
      body: '{',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalidRequest' });
    expect(adminAuth.getUser).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid or revoked ID token', async () => {
    adminAuth.verifyIdToken.mockRejectedValue(new Error('revoked'));

    const response = await POST(createRequest({ ref: 'inviter-1' }));

    expect(response.status).toBe(401);
    expect(adminAuth.verifyIdToken).toHaveBeenCalledWith('valid-token', true);
  });

  it('returns a generic 500 when Admin SDK work fails', async () => {
    adminAuth.getUser.mockRejectedValue(new Error('sensitive details'));

    const response = await POST(createRequest({ ref: 'inviter-1' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internalServerError' });
  });

  // F6: the third referral flags the inviter for a human look and tells the owner — once. The
  // count lives in a ledger on the inviter document the claim already reads and writes.
  describe('referral check on the third referral', () => {
    const ledger = (...invitees: Array<[string, string]>) => ({
      count: invitees.length,
      invitees: invitees.map(([uid, at]) => ({ uid, at })),
    });

    const claimAndSettle = async () => {
      const response = await POST(createRequest({ ref: 'inviter-1' }));
      await settleAfterTasks();
      return response;
    };

    beforeEach(() => {
      adminAuth.getUser.mockImplementation(async (uid: string) => ({
        email: `${uid}@example.com`,
        metadata: { creationTime: '2026-07-12T00:00:00.000Z' },
      }));
    });

    it('flags the inviter at the third referral, keeps the promotion accruing and tells the owner once', async () => {
      documents.set('users/inviter-1', { paidTier: 'free', referralLedger: ledger(['invitee-a', '2026-07-10T10:00:00.000Z'], ['invitee-b', '2026-07-11T10:00:00.000Z']) });

      const response = await claimAndSettle();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'granted' });
      expect(documents.get('users/inviter-1')).toMatchObject({
        referralWarning: { at: NOW.toISOString(), referralCount: 3 },
        referralLedger: { count: 3 },
      });
      expect(inviterPromotionWrites).toHaveLength(1);
      expect(sendOwnerNotice).toHaveBeenCalledTimes(1);
      expect(sendOwnerNotice.mock.calls[0][1]).toEqual({ timeoutMs: 8_000 });
      const letter = sendOwnerNotice.mock.calls[0][0] as { subject: string; text: string };
      expect(letter.subject).toContain('3');
      expect(letter.text).toContain('inviter-1@example.com');
      ['invitee-a@example.com', 'invitee-b@example.com', 'invitee-1@example.com'].forEach((email) => expect(letter.text).toContain(email));
    });

    it('counts and says nothing before the third referral', async () => {
      documents.set('users/inviter-1', { paidTier: 'free', referralLedger: ledger(['invitee-a', '2026-07-10T10:00:00.000Z']) });

      const response = await claimAndSettle();

      expect(response.status).toBe(200);
      expect(documents.get('users/inviter-1')).toMatchObject({ referralLedger: { count: 2 } });
      expect(documents.get('users/inviter-1')).not.toHaveProperty('referralWarning');
      expect(sendOwnerNotice).not.toHaveBeenCalled();
    });

    it('starts the count with this claim for an inviter from before the check', async () => {
      const response = await claimAndSettle();

      expect(response.status).toBe(200);
      expect(documents.get('users/inviter-1')).toMatchObject({
        referralLedger: { count: 1, invitees: [{ uid: 'invitee-1', at: NOW.toISOString() }] },
      });
      expect(sendOwnerNotice).not.toHaveBeenCalled();
    });

    it('does not flag again or write again after the inviter was flagged', async () => {
      const firstFlag = { at: '2026-07-11T12:00:00.000Z', referralCount: 3 };
      documents.set('users/inviter-1', {
        paidTier: 'free',
        referralWarning: firstFlag,
        referralLedger: ledger(['invitee-a', '2026-07-10T10:00:00.000Z'], ['invitee-b', '2026-07-11T10:00:00.000Z'], ['invitee-c', '2026-07-11T12:00:00.000Z']),
      });

      const response = await claimAndSettle();

      expect(response.status).toBe(200);
      expect(documents.get('users/inviter-1')).toMatchObject({ referralWarning: firstFlag, referralLedger: { count: 4 } });
      expect(sendOwnerNotice).not.toHaveBeenCalled();
      expect(inviterPromotionWrites).toHaveLength(1);
    });

    it('treats a malformed flag as no flag: flags properly and tells the owner', async () => {
      documents.set('users/inviter-1', {
        paidTier: 'free',
        referralWarning: 'ignore',
        referralLedger: ledger(['invitee-a', '2026-07-10T10:00:00.000Z'], ['invitee-b', '2026-07-11T10:00:00.000Z']),
      });

      await claimAndSettle();

      expect(documents.get('users/inviter-1')).toMatchObject({ referralWarning: { at: NOW.toISOString(), referralCount: 3 } });
      expect(sendOwnerNotice).toHaveBeenCalledTimes(1);
    });

    it('counts an invitee once even when its claim comes back after the marker was lost', async () => {
      documents.set('users/inviter-1', {
        paidTier: 'free',
        referralLedger: ledger(['invitee-a', '2026-07-10T10:00:00.000Z'], ['invitee-1', '2026-07-11T10:00:00.000Z']),
      });

      await claimAndSettle();

      expect(documents.get('users/inviter-1')).toMatchObject({ referralLedger: { count: 2 } });
      expect(documents.get('users/inviter-1')).not.toHaveProperty('referralWarning');
      expect(sendOwnerNotice).not.toHaveBeenCalled();
    });

    it('answers before the letter and gives up on a stalled mail server within the budget', async () => {
      documents.set('users/inviter-1', { paidTier: 'free', referralLedger: ledger(['invitee-a', '2026-07-10T10:00:00.000Z'], ['invitee-b', '2026-07-11T10:00:00.000Z']) });
      sendOwnerNotice.mockReturnValue(new Promise(() => undefined));
      const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const response = await POST(createRequest({ ref: 'inviter-1' }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'granted' });
      expect(errors).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(8_000);
      await settleAfterTasks();
      expect(errors).toHaveBeenCalledWith('Referral warning letter not confirmed within the budget', { inviterUid: 'inviter-1' });
      errors.mockRestore();
    });

    it('gives up within the budget when the email lookups stall', async () => {
      documents.set('users/inviter-1', { paidTier: 'free', referralLedger: ledger(['invitee-a', '2026-07-10T10:00:00.000Z'], ['invitee-b', '2026-07-11T10:00:00.000Z']) });
      // The first lookup is the claim's own eligibility check; the letter's lookups never answer.
      adminAuth.getUser
        .mockResolvedValueOnce({ metadata: { creationTime: '2026-07-12T00:00:00.000Z' } })
        .mockImplementation(() => new Promise(() => undefined));
      const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const response = await POST(createRequest({ ref: 'inviter-1' }));
      expect(response.status).toBe(200);
      await jest.advanceTimersByTimeAsync(8_000);
      await settleAfterTasks();

      expect(sendOwnerNotice).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith('Referral warning letter not confirmed within the budget', { inviterUid: 'inviter-1' });
      errors.mockRestore();
    });

    it('starts no letter once the budget ran out, however late the lookups answer', async () => {
      documents.set('users/inviter-1', { paidTier: 'free', referralLedger: ledger(['invitee-a', '2026-07-10T10:00:00.000Z'], ['invitee-b', '2026-07-11T10:00:00.000Z']) });
      adminAuth.getUser
        .mockResolvedValueOnce({ metadata: { creationTime: '2026-07-12T00:00:00.000Z' } })
        .mockImplementation((uid: string) => new Promise((resolve) => {
          setTimeout(() => resolve({ email: `${uid}@example.com` }), 9_000);
        }));
      const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const response = await POST(createRequest({ ref: 'inviter-1' }));
      await jest.advanceTimersByTimeAsync(8_000);
      await settleAfterTasks();
      await jest.advanceTimersByTimeAsync(2_000);

      expect(response.status).toBe(200);
      expect(errors).toHaveBeenCalledWith('Referral warning letter not confirmed within the budget', { inviterUid: 'inviter-1' });
      expect(sendOwnerNotice).not.toHaveBeenCalled();
      errors.mockRestore();
    });

    it('starts no letter after the budget ran out even if the clock is set back', async () => {
      documents.set('users/inviter-1', { paidTier: 'free', referralLedger: ledger(['invitee-a', '2026-07-10T10:00:00.000Z'], ['invitee-b', '2026-07-11T10:00:00.000Z']) });
      adminAuth.getUser
        .mockResolvedValueOnce({ metadata: { creationTime: '2026-07-12T00:00:00.000Z' } })
        .mockImplementation((uid: string) => new Promise((resolve) => {
          setTimeout(() => resolve({ email: `${uid}@example.com` }), 9_000);
        }));
      const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      await POST(createRequest({ ref: 'inviter-1' }));
      await jest.advanceTimersByTimeAsync(8_000);
      await settleAfterTasks();
      jest.setSystemTime(NOW);
      await jest.advanceTimersByTimeAsync(2_000);

      expect(sendOwnerNotice).not.toHaveBeenCalled();
      errors.mockRestore();
    });

    it('flags without a letter or email lookups when owner mail is not configured', async () => {
      documents.set('users/inviter-1', { paidTier: 'free', referralLedger: ledger(['invitee-a', '2026-07-10T10:00:00.000Z'], ['invitee-b', '2026-07-11T10:00:00.000Z']) });
      ownerMailConfigured.mockReturnValue(false);

      const response = await claimAndSettle();

      expect(response.status).toBe(200);
      expect(documents.get('users/inviter-1')).toMatchObject({ referralWarning: { referralCount: 3 } });
      expect(adminAuth.getUser).toHaveBeenCalledTimes(1);
      expect(sendOwnerNotice).not.toHaveBeenCalled();
    });

    it('still writes the letter when there is no request scope to defer it to', async () => {
      documents.set('users/inviter-1', { paidTier: 'free', referralLedger: ledger(['invitee-a', '2026-07-10T10:00:00.000Z'], ['invitee-b', '2026-07-11T10:00:00.000Z']) });
      after.mockImplementationOnce(() => { throw new Error('`after` was called outside a request scope'); });

      const response = await POST(createRequest({ ref: 'inviter-1' }));
      await jest.advanceTimersByTimeAsync(0);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'granted' });
      expect(sendOwnerNotice).toHaveBeenCalledTimes(1);
    });

    it('keeps the claim when the letter cannot be sent', async () => {
      documents.set('users/inviter-1', { paidTier: 'free', referralLedger: ledger(['invitee-a', '2026-07-10T10:00:00.000Z'], ['invitee-b', '2026-07-11T10:00:00.000Z']) });
      sendOwnerNotice.mockRejectedValue(new Error('smtp down'));
      const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const response = await claimAndSettle();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'granted' });
      expect(documents.get('users/inviter-1')).toMatchObject({ referralWarning: { referralCount: 3 } });
      errors.mockRestore();
    });
  });
});
