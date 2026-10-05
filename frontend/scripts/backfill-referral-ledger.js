#!/usr/bin/env node
/**
 * F6 — one-time backfill of `referralLedger` and the third-referral flag from `referralEvents`.
 *
 * ⚠️ RUN IT ONCE, AT LEAST 15 MINUTES AFTER THE F6 DEPLOY TURNED GREEN. The claim before F6
 * writes the event but not the ledger, so a referral it grants after this script ran would never
 * be counted; a claim already running on the old deployment when the new one went live can still
 * finish for as long as a function may run (up to 800 s on Vercel's plans), hence the wait.
 *
 * The claim counts referrals in a ledger on the inviter document (it may not grow a new query —
 * `__tests__/architecture/README.md`), so referrals made before F6 shipped are not in it. The
 * events are the history: every claim writes one, named by the invitee's uid; since F6, in the
 * same transaction that moves the ledger. So each inviter's ledger is set from its events — read
 * together with the inviter document in one transaction, which a claim for the same inviter
 * cannot interleave with, because it reads and writes that document too.
 *
 * Order: deploy the Firestore rules that make both fields server-managed BEFORE the F6 code is
 * pushed. Until then a client could write them on its own profile, and once the code is public
 * their names are known. Every dry run lists the users already holding either field: run it after
 * the rules and before the push, and the list must be empty.
 *
 * ⚠️ DRY RUN by default: prints the project, the users already holding the fields, and per
 * inviter the referrals in events, the count stored now and whether the flag would be set — and
 * writes nothing. Writing requires --apply,
 * --i-understand-this-writes-prod AND --project=<the project id the dry run printed>. It sends
 * no letters: the dry-run list is what to look at. A re-run writes nothing new.
 *
 * Usage (dry run):
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/backfill-referral-ledger.js
 * Usage (WRITE — gated):
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/backfill-referral-ledger.js \
 *     --apply --i-understand-this-writes-prod --project=<project id>
 */

const LEDGER_LIMIT = 20; // REFERRAL_LEDGER_LIMIT in app/services/referral.server.ts
const WARNING_AT = 3; // REFERRAL_WARNING_AT in app/services/referral.server.ts

/** Mirrors readReferralWarning in app/services/referral.server.ts (this script cannot import TS). */
function isReferralWarning(value) {
  return Boolean(value) && typeof value === 'object'
    && typeof value.at === 'string' && !Number.isNaN(Date.parse(value.at))
    && Number.isInteger(value.referralCount) && value.referralCount >= 1;
}

/** A uid the claim would accept (uidSchema in app/api/referral/claim/route.ts), so a document path is safe. */
function isUid(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() !== ''
    && !value.includes('/') && !/^\.+$/.test(value)
    && Array.from(value).every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 32 && codePoint !== 127;
    });
}

/** What a user document already says about the referral check, or null when it says nothing. */
function referralFieldsOf(data) {
  if (!data || (data.referralWarning === undefined && data.referralLedger === undefined)) return null;
  return {
    warning: data.referralWarning === undefined ? null : data.referralWarning,
    ledgerCount: data.referralLedger === undefined ? null : storedCount(data),
  };
}

function storedCount(data) {
  const count = data && data.referralLedger && data.referralLedger.count;
  return Number.isInteger(count) && count > 0 ? count : 0;
}

function isTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * Every invitee an inviter is known to have, uid → registration time (null when unknown): from its
 * events, counted only as the claim writes them — named by the invitee's uid, with that same uid
 * inside — and from the list the ledger already holds. Only a claim writes that list, so each uid
 * in it is a real referral, even one whose event a later claim for the same invitee overwrote.
 */
function knownInvitees(events, storedLedger) {
  const known = new Map();
  for (const { id, data } of events) {
    if (!data || !isUid(id) || data.inviteeUid !== id || known.has(id)) continue;
    known.set(id, isTime(data.registeredAt) ? data.registeredAt : null);
  }
  const fromEvents = known.size;
  const listed = storedLedger && Array.isArray(storedLedger.invitees) ? storedLedger.invitees : [];
  for (const entry of listed) {
    if (!entry || !isUid(entry.uid)) continue;
    if (!known.has(entry.uid) || known.get(entry.uid) === null) known.set(entry.uid, isTime(entry.at) ? entry.at : null);
  }
  return { known, fromEvents };
}

function sameLedger(stored, ledger) {
  return Boolean(stored) && stored.count === ledger.count
    && Array.isArray(stored.invitees) && stored.invitees.length === ledger.invitees.length
    && stored.invitees.every((entry, index) => entry && entry.uid === ledger.invitees[index].uid
      && entry.at === ledger.invitees[index].at);
}

/**
 * What one inviter's document should hold: nothing known is dropped and nothing is counted twice.
 * The count is never below the stored one nor below the invitees known; the list keeps the newest
 * LEDGER_LIMIT of them with a real time. A flag already set stays.
 */
function planInviter(userData, events, now) {
  const storedLedger = userData && userData.referralLedger;
  const { known, fromEvents } = knownInvitees(events, storedLedger);
  const stored = storedCount(userData);
  const ledger = {
    count: Math.max(known.size, stored),
    invitees: [...known]
      .filter(([, at]) => at !== null)
      .map(([uid, at]) => ({ uid, at }))
      .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
      .slice(-LEDGER_LIMIT),
  };
  const flag = ledger.count >= WARNING_AT && !isReferralWarning(userData && userData.referralWarning);
  return {
    count: ledger.count,
    events: fromEvents,
    stored,
    flag,
    write: !sameLedger(storedLedger, ledger) || flag,
    update: {
      referralLedger: ledger,
      ...(flag ? { referralWarning: { at: now, referralCount: ledger.count } } : {}),
    },
  };
}

/**
 * One inviter. Applying reads its document and events in one transaction and writes the plan
 * there; a dry run reads them plainly, so it never holds a lock a live claim would wait on.
 */
async function backfillInviter(db, inviterUid, now, apply) {
  const ref = db.collection('users').doc(inviterUid);
  const events = db.collection('referralEvents').where('inviterUid', '==', inviterUid);
  const plan = (snapshot, eventSnapshot) => (snapshot.exists
    ? { inviterUid, ...planInviter(snapshot.data(), eventSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })), now) }
    : { inviterUid, skip: 'no user document' });
  if (!apply) return plan(await ref.get(), await events.get());
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return plan(snapshot, null);
    const result = plan(snapshot, await transaction.get(events));
    if (result.write) transaction.set(ref, result.update, { merge: true });
    return result;
  });
}

function readProjectId(admin, db) {
  try {
    return db.projectId;
  } catch {
    return admin.app().options.projectId || process.env.GOOGLE_CLOUD_PROJECT || null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const projectArg = (args.find((arg) => arg.startsWith('--project=')) || '').slice('--project='.length);
  if (apply && !args.includes('--i-understand-this-writes-prod')) {
    console.error('Refusing to write without --i-understand-this-writes-prod. Aborting.');
    process.exit(1);
  }
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = admin.firestore();
  const now = new Date().toISOString();

  const all = (await db.collection('referralEvents').get()).docs.map((doc) => doc.data());
  const inviterUids = [...new Set(all.map((event) => event && event.inviterUid).filter(isUid))];
  const unreadable = all.filter((event) => !event || !isUid(event.inviterUid)).length;
  const projectId = readProjectId(admin, db);
  console.log(`project: ${projectId} · referral events: ${all.length} (${unreadable} without a usable inviter) · inviters: ${inviterUids.length} · ${apply ? 'APPLY' : 'dry run'}`);
  const holders = (await db.collection('users').select('referralWarning', 'referralLedger').get()).docs
    .map((doc) => ({ uid: doc.id, fields: referralFieldsOf(doc.data()) }))
    .filter((holder) => holder.fields !== null);
  console.log(`users already holding referral fields: ${holders.length}`);
  for (const { uid, fields } of holders) console.log(`  ${uid}: warning ${JSON.stringify(fields.warning)} · ledger count ${fields.ledgerCount}`);
  if (apply && (!projectId || projectArg !== projectId)) {
    console.error(`Refusing to write: pass --project=${projectId} to confirm this is the project you mean. Nothing was written.`);
    process.exit(1);
  }

  for (const inviterUid of inviterUids) {
    const result = await backfillInviter(db, inviterUid, now, apply);
    if (result.skip) {
      console.log(`  ${inviterUid}: skipped (${result.skip})`);
      continue;
    }
    const verb = !result.write ? 'nothing to write' : apply ? 'written' : 'would write';
    console.log(`  ${inviterUid}: events ${result.events} · stored ${result.stored} → ${result.count}${result.flag ? ' · FLAG' : ''} · ${verb}`);
  }
}

module.exports = { backfillInviter, isReferralWarning, isUid, knownInvitees, planInviter, referralFieldsOf };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
