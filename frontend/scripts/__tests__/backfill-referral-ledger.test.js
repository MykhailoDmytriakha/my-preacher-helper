const { backfillInviter, isReferralWarning, isUid, knownInvitees, referralFieldsOf } = require('../backfill-referral-ledger.js');

const NOW = '2026-10-04T12:00:00.000Z';
const at = (day) => `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`;

/** Just enough of Firestore for the script: documents by path, an equality query, a transaction. */
function fakeDb(users, events) {
  const docs = new Map(Object.entries(users).map(([uid, data]) => [`users/${uid}`, data]));
  events.forEach((event, index) => docs.set(`referralEvents/${event.id || event.inviteeUid || `odd-${index}`}`, event));
  const writes = [];
  const read = async (target) => {
    if (target.path) {
      const data = docs.get(target.path);
      return { exists: data !== undefined, data: () => data };
    }
    const matches = [...docs].filter(([path, data]) => path.startsWith(`${target.name}/`) && data[target.field] === target.value);
    return { docs: matches.map(([path, data]) => ({ id: path.slice(target.name.length + 1), data: () => data })) };
  };
  const db = {
    collection: (name) => ({
      doc: (id) => {
        const ref = { path: `${name}/${id}` };
        return { ...ref, get: () => read(ref) };
      },
      where: (field, op, value) => {
        const query = { name, field, value };
        return { ...query, get: () => read(query) };
      },
    }),
    runTransaction: async (callback) => callback({
      get: read,
      set: (ref, data, options) => {
        expect(options).toEqual({ merge: true });
        writes.push(ref.path);
        docs.set(ref.path, { ...(docs.get(ref.path) || {}), ...data });
      },
    }),
  };
  return { db, docs, writes };
}

const event = (inviterUid, inviteeUid, day) => ({ inviterUid, inviteeUid, registeredAt: at(day) });

describe('backfill-referral-ledger (F6)', () => {
  it('counts the events, not the ledger: two before the check and two after flag the inviter at four', async () => {
    const { db, docs } = fakeDb(
      { x: { referralLedger: { count: 2, invitees: [{ uid: 'c', at: at(3) }, { uid: 'd', at: at(4) }] } } },
      [event('x', 'a', 1), event('x', 'b', 2), event('x', 'c', 3), event('x', 'd', 4)]
    );

    const result = await backfillInviter(db, 'x', NOW, true);

    expect(result).toMatchObject({ count: 4, stored: 2, flag: true, write: true });
    expect(docs.get('users/x')).toMatchObject({
      referralLedger: { count: 4 },
      referralWarning: { at: NOW, referralCount: 4 },
    });
    expect(docs.get('users/x').referralLedger.invitees.map((entry) => entry.uid)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps the whole history past twenty and lists the newest twenty', async () => {
    const many = Array.from({ length: 27 }, (_, index) => event('x', `i${index + 1}`, index + 1));
    const { db, docs } = fakeDb({ x: { referralLedger: { count: 25, invitees: [] } } }, many);

    await backfillInviter(db, 'x', NOW, true);

    expect(docs.get('users/x').referralLedger.count).toBe(27);
    expect(docs.get('users/x').referralLedger.invitees).toHaveLength(20);
    expect(docs.get('users/x').referralLedger.invitees[19].uid).toBe('i27');
  });

  it('does not count an invitee the ledger already holds a second time', async () => {
    const { db, docs } = fakeDb(
      { x: { referralLedger: { count: 4, invitees: [{ uid: 'late', at: at(9) }] }, referralWarning: 'garbage' } },
      [event('x', 'a', 1), event('x', 'b', 2), event('x', 'c', 3), event('x', 'late', 9)]
    );

    await backfillInviter(db, 'x', NOW, true);

    expect(docs.get('users/x')).toMatchObject({ referralLedger: { count: 4 }, referralWarning: { referralCount: 4 } });
  });

  it('leaves a flag already set and writes nothing on a re-run', async () => {
    const { db, writes } = fakeDb({ x: {} }, [event('x', 'a', 1), event('x', 'b', 2), event('x', 'c', 3)]);

    await backfillInviter(db, 'x', NOW, true);
    const again = await backfillInviter(db, 'x', '2026-10-05T00:00:00.000Z', true);

    expect(again).toMatchObject({ count: 3, stored: 3, flag: false, write: false });
    expect(writes).toEqual(['users/x']);
  });

  it('skips an inviter whose user document is gone instead of creating one', async () => {
    const { db, docs, writes } = fakeDb({}, [event('ghost', 'a', 1), event('ghost', 'b', 2), event('ghost', 'c', 3)]);

    await expect(backfillInviter(db, 'ghost', NOW, true)).resolves.toEqual({ inviterUid: 'ghost', skip: 'no user document' });
    expect(writes).toEqual([]);
    expect(docs.has('users/ghost')).toBe(false);
  });

  it('writes nothing and opens no transaction in a dry run', async () => {
    const { db, writes } = fakeDb({ x: {} }, [event('x', 'a', 1), event('x', 'b', 2), event('x', 'c', 3)]);
    const transactions = jest.spyOn(db, 'runTransaction');

    await expect(backfillInviter(db, 'x', NOW, false)).resolves.toMatchObject({ count: 3, flag: true, write: true });
    expect(writes).toEqual([]);
    expect(transactions).not.toHaveBeenCalled();
  });

  it('counts an event only as the claim writes it and keeps a time only when it is real', () => {
    const { known, fromEvents } = knownInvitees([
      { id: 'a', data: event('x', 'a', 1) },
      { id: 'b', data: { inviterUid: 'x', inviteeUid: 'b', registeredAt: 'garbage' } },
      { id: 'odd-1', data: event('x', 'c', 3) },
      { id: '', data: { inviterUid: 'x', inviteeUid: '' } },
      { id: 'd', data: null },
    ], undefined);

    expect(fromEvents).toBe(2);
    expect([...known]).toEqual([['a', at(1)], ['b', null]]);
  });

  it('does not count events whose name is not their invitee', async () => {
    const { db, docs, writes } = fakeDb({ x: {} }, [
      { id: 'odd-1', ...event('x', 'a', 1) },
      { id: 'odd-2', ...event('x', 'b', 2) },
      { id: 'odd-3', ...event('x', 'c', 3) },
    ]);

    await expect(backfillInviter(db, 'x', NOW, true)).resolves.toMatchObject({ count: 0, flag: false });
    expect(docs.get('users/x')).not.toHaveProperty('referralWarning');
    expect(writes).toEqual(['users/x']);
  });

  it('rewrites the list when the count matches but the events know an invitee it lacks', async () => {
    const { db, docs } = fakeDb(
      { x: { referralLedger: { count: 2, invitees: [{ uid: 'a', at: at(1) }] } } },
      [event('x', 'a', 1), event('x', 'b', 2)]
    );

    await expect(backfillInviter(db, 'x', NOW, true)).resolves.toMatchObject({ count: 2, write: true });
    expect(docs.get('users/x').referralLedger.invitees.map((entry) => entry.uid)).toEqual(['a', 'b']);
  });

  it('keeps an invitee only the ledger still knows, so its claim cannot count twice later', async () => {
    // a's event was overwritten by a later claim for another inviter; only the ledger remembers a.
    const { db, docs } = fakeDb(
      { x: { referralLedger: { count: 2, invitees: [{ uid: 'a', at: at(1) }, { uid: 'b', at: at(2) }] } } },
      [event('x', 'b', 2)]
    );

    await expect(backfillInviter(db, 'x', NOW, true)).resolves.toMatchObject({ events: 1, count: 2, flag: false });
    expect(docs.get('users/x').referralLedger.invitees.map((entry) => entry.uid)).toEqual(['a', 'b']);
  });

  it('adds up histories that only overlap: the ledger knows a and b, the events b and c', async () => {
    const { db, docs } = fakeDb(
      { x: { referralLedger: { count: 2, invitees: [{ uid: 'a', at: at(1) }, { uid: 'b', at: at(2) }] } } },
      [event('x', 'b', 2), event('x', 'c', 3)]
    );

    await expect(backfillInviter(db, 'x', NOW, true)).resolves.toMatchObject({ count: 3, flag: true });
    expect(docs.get('users/x')).toMatchObject({ referralWarning: { referralCount: 3 } });
    expect(docs.get('users/x').referralLedger.invitees.map((entry) => entry.uid)).toEqual(['a', 'b', 'c']);
  });

  it('never lowers a stored count: the ledger may know a referral whose event was overwritten', async () => {
    const { db, docs } = fakeDb(
      { x: { referralLedger: { count: 5, invitees: [] } } },
      [event('x', 'a', 1), event('x', 'b', 2), event('x', 'c', 3)]
    );

    await expect(backfillInviter(db, 'x', NOW, true)).resolves.toMatchObject({ events: 3, stored: 5, count: 5, flag: true });
    expect(docs.get('users/x')).toMatchObject({ referralLedger: { count: 5 }, referralWarning: { referralCount: 5 } });
  });

  it('names every user already holding a referral field, however malformed', () => {
    expect(referralFieldsOf({ paidTier: 'free' })).toBeNull();
    expect(referralFieldsOf(undefined)).toBeNull();
    expect(referralFieldsOf({ referralWarning: 'planted' })).toEqual({ warning: 'planted', ledgerCount: null });
    expect(referralFieldsOf({ referralLedger: { invitees: [{ uid: 'x' }] } })).toEqual({ warning: null, ledgerCount: 0 });
    expect(referralFieldsOf({ referralWarning: { at: at(3), referralCount: 3 }, referralLedger: { count: 3, invitees: [] } }))
      .toEqual({ warning: { at: at(3), referralCount: 3 }, ledgerCount: 3 });
  });

  it('accepts only uids that make a safe document path', () => {
    expect(isUid('inviter-1')).toBe(true);
    ['', '  ', 'a/b', '..', 42, 'x'.repeat(129), 'bad\u0007'].forEach((value) => expect(isUid(value)).toBe(false));
  });

  it('reads the flag the way the app does: a malformed one is no flag', () => {
    expect(isReferralWarning({ at: at(3), referralCount: 3 })).toBe(true);
    expect(isReferralWarning('ignore')).toBe(false);
    expect(isReferralWarning({ at: 'garbage', referralCount: 3 })).toBe(false);
    expect(isReferralWarning({ at: at(3), referralCount: 0 })).toBe(false);
  });
});
