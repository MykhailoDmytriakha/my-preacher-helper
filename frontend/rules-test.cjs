/* Firestore Security Rules test suite (all collections). Run via firebase emulators:exec. */
const fs = require('fs');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, disableNetwork, enableNetwork, getDocFromServer } = require('firebase/firestore');

let pass = 0, fail = 0;
async function check(label, p) {
  try { await p; console.log('  ✓', label); pass++; }
  catch (e) { console.log('  ✗', label, '—', e.message); fail++; }
}

// Collections owned via a `userId` field.
const USER_COLS = [
  'sermons', 'planTemplates', 'studyMaterials', 'studyNotes', 'studyNoteBranchStates', 'series', 'groups',
  'prayerRequests', 'prayerCategories', 'tags', 'feedback', 'serviceOrders', 'councils',
];
const SERVER_MANAGED_USER_FIELDS = {
  paidTier: 'tier4',
  promotion: { tier: 'tier4', expiresAt: '2026-08-01T00:00:00.000Z' },
  usage: {
    aiUsed: 999,
    transcriptionSecondsUsed: 999,
    audioSecondsUsed: 999,
    periodStart: '2026-07-01T00:00:00.000Z',
  },
  role: 'admin',
  referredBy: 'someUid',
};

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: process.env.RULES_TEST_PROJECT || 'demo-preacher',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });

  // Seed userA-owned docs across every collection (rules bypassed for seeding).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const c of USER_COLS) await setDoc(doc(db, c, 'd1'), { userId: 'userA', v: 1 });
    await setDoc(doc(db, 'studyNoteShareLinks', 'd1'), { ownerId: 'userA', noteId: 'n1', token: 't' });
    await setDoc(doc(db, 'users', 'userA'), {
      email: 'a@a',
      language: 'en',
      paidTier: 'tier2',
      promotion: { tier: 'tier3', expiresAt: '2026-07-31T00:00:00.000Z' },
      usage: {
        aiUsed: 1,
        transcriptionSecondsUsed: 2,
        audioSecondsUsed: 3,
        periodStart: '2026-07-01T00:00:00.000Z',
      },
      role: 'user',
    });
    await setDoc(doc(db, 'ai_prompt_telemetry', 'd1'), { v: 1 });
    await setDoc(doc(db, 'api_performance_telemetry', 'd1'), { v: 1 });
    await setDoc(doc(db, 'referralEvents', 'userA'), {
      inviterUid: 'userB',
      inviteeUid: 'userA',
    });
  });

  const a = testEnv.authenticatedContext('userA').firestore();
  const b = testEnv.authenticatedContext('userB').firestore();
  const anon = testEnv.unauthenticatedContext().firestore();

  console.log('\n=== userId-owned collections ===');
  for (const c of USER_COLS) {
    await check(`${c}: owner reads own (allow)`,       assertSucceeds(getDoc(doc(a, c, 'd1'))));
    await check(`${c}: OTHER reads (deny)`,            assertFails(getDoc(doc(b, c, 'd1'))));
    await check(`${c}: UNAUTH reads (deny)`,           assertFails(getDoc(doc(anon, c, 'd1'))));
    await check(`${c}: owner creates own (allow)`,     assertSucceeds(setDoc(doc(a, c, 'new'), { userId: 'userA', v: 2 })));
    await check(`${c}: owner creates for OTHER (deny)`, assertFails(setDoc(doc(a, c, 'new2'), { userId: 'userB', v: 2 })));
  }

  console.log('\n=== studyNoteShareLinks (ownerId) ===');
  await check('shareLinks: owner reads own (allow)',      assertSucceeds(getDoc(doc(a, 'studyNoteShareLinks', 'd1'))));
  await check('shareLinks: OTHER reads (deny)',           assertFails(getDoc(doc(b, 'studyNoteShareLinks', 'd1'))));
  await check('shareLinks: UNAUTH reads (deny)',          assertFails(getDoc(doc(anon, 'studyNoteShareLinks', 'd1'))));
  await check('shareLinks: owner creates own (allow)',    assertSucceeds(setDoc(doc(a, 'studyNoteShareLinks', 'x'), { ownerId: 'userA', noteId: 'n', token: 't' })));
  await check('shareLinks: creates for OTHER (deny)',     assertFails(setDoc(doc(a, 'studyNoteShareLinks', 'y'), { ownerId: 'userB', noteId: 'n', token: 't' })));

  console.log('\n=== users (doc-id == uid) ===');
  await check('users: owner reads own doc (allow)',       assertSucceeds(getDoc(doc(a, 'users', 'userA'))));
  await check('users: OTHER reads owner doc (deny)',      assertFails(getDoc(doc(b, 'users', 'userA'))));
  await check('users: UNAUTH reads (deny)',               assertFails(getDoc(doc(anon, 'users', 'userA'))));
  await check('users: owner updates allowed UX field (allow)', assertSucceeds(updateDoc(doc(a, 'users', 'userA'), { language: 'ru' })));
  await check('users: owner writes lastSeenAt heartbeat (allow)', assertSucceeds(setDoc(
    doc(a, 'users', 'userA'),
    { lastSeenAt: '2026-07-13T12:00:00.000Z' },
    { merge: true }
  )));
  const uxUid = 'userUx';
  const ux = testEnv.authenticatedContext(uxUid).firestore();
  await check('users: owner creates allowed UX fields (allow)', assertSucceeds(setDoc(doc(ux, 'users', uxUid), {
    language: 'en',
    email: 'ux@example.com',
    displayName: 'UX User',
    firstDayOfWeek: 'monday',
    enablePrepMode: true,
    enableAudioGeneration: true,
    enableStructurePreview: true,
    enableGroups: true,
    showAppVersion: true,
    preferredProviderId: 'gemini',
    preferredModelId: 'gemini-2.5-flash-lite',
  })));
  await check('users: OTHER updates allowed UX field (deny)', assertFails(updateDoc(doc(b, 'users', 'userA'), { language: 'hax' })));
  for (const [field, value] of Object.entries(SERVER_MANAGED_USER_FIELDS)) {
    const createUid = `create-${field}`;
    const creator = testEnv.authenticatedContext(createUid).firestore();
    await check(
      `users: owner cannot create ${field} (deny)`,
      assertFails(setDoc(doc(creator, 'users', createUid), { language: 'en', [field]: value }))
    );
    await check(
      `users: owner cannot update ${field} (deny)`,
      assertFails(updateDoc(doc(a, 'users', 'userA'), { [field]: value }))
    );
  }

  console.log('\n=== server-only telemetry (deny all client access) ===');
  await check('ai_prompt_telemetry: read (deny)',         assertFails(getDoc(doc(a, 'ai_prompt_telemetry', 'd1'))));
  await check('api_performance_telemetry: write (deny)',  assertFails(setDoc(doc(a, 'api_performance_telemetry', 'x'), { v: 1 })));

  console.log('\n=== referralEvents (server-only; deny all client access) ===');
  await check('referralEvents: signed-in client read (deny)', assertFails(getDoc(doc(a, 'referralEvents', 'userA'))));
  await check('referralEvents: signed-in client write (deny)', assertFails(setDoc(doc(a, 'referralEvents', 'attacker'), {
    inviterUid: 'userA',
    inviteeUid: 'attacker',
  })));

  console.log('\n=== server-only config (deny all client writes) ===');
  await check('config/aiModelDefaults: client write (deny)', assertFails(setDoc(
    doc(a, 'config', 'aiModelDefaults'),
    { text: { providerId: 'openrouter', modelId: 'attacker/model' } }
  )));

  console.log('\n=== unknown collection (default-deny) ===');
  await check('random collection: read (deny)',           assertFails(getDoc(doc(a, 'totally_unknown', 'd1'))));

  console.log('\n=== adversarial ownership-bypass attempts ===');
  // owner tries to GIVE AWAY their doc by reassigning userId on update
  await check('update reassigns userId to OTHER (deny)',  assertFails(updateDoc(doc(a, 'tags', 'd1'), { userId: 'userB' })));
  // create a doc with NO owner field
  await check('create WITHOUT userId field (deny)',       assertFails(setDoc(doc(a, 'tags', 'noowner'), { name: 'x' })));
  // create a doc owned by SOMEONE ELSE (planting in victim's space)
  await check('create stamped as OTHER owner (deny)',     assertFails(setDoc(doc(a, 'sermons', 'plant'), { userId: 'userB', title: 'x' })));
  // OTHER tries to delete / update the owner's doc
  await check('OTHER deletes owner doc (deny)',           assertFails(deleteDoc(doc(b, 'tags', 'd1'))));
  await check('OTHER updates owner doc (deny)',           assertFails(updateDoc(doc(b, 'tags', 'd1'), { name: 'hacked' })));
  // shareLinks: create pointing at note but stamped as OTHER owner (deny)
  await check('shareLink stamped as OTHER ownerId (deny)', assertFails(setDoc(doc(a, 'studyNoteShareLinks', 'z'), { ownerId: 'userB', noteId: 'n', token: 't' })));

  console.log('\n=== DataEngine cutover boundary ===');
  const metadata = { protocol: 1, generation: 'created', revision: 1, deleted: false };
  const protectedCollections = [...USER_COLS, 'studyNoteShareLinks', 'users'];
  for (const collection of protectedCollections) {
    const owner = collection === 'users' ? {} : { [collection === 'studyNoteShareLinks' ? 'ownerId' : 'userId']: 'userA' };
    const id = collection === 'users' ? 'userA' : 'protected';
    const reference = doc(a, collection, id);
    await testEnv.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), collection, id), { ...owner, language: 'en', v: 2, _dataEngine: metadata }));
    await check(`${collection}: migrated owner can read`, assertSucceeds(getDoc(reference)));
    await check(`${collection}: legacy partial update denied`, assertFails(updateDoc(reference, { language: 'ru' })));
    await check(`${collection}: old full set cannot erase marker`, assertFails(setDoc(reference, { ...owner, language: 'ru' })));
    await check(`${collection}: legacy delete denied`, assertFails(deleteDoc(reference)));
    await testEnv.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), collection, id), { ...owner, _dataEngine: { ...metadata, deleted: true } }));
    await check(`${collection}: tombstone cannot be resurrected`, assertFails(setDoc(reference, { ...owner, language: 'ru' })));
    if (collection !== 'users') {
      // Since 2026-09-18 a tombstone names its owner outside the legacy owner field, so that no
      // legacy owner query returns it. Its owner still reads it; nobody revives it from a browser.
      await testEnv.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), collection, 'buried'), { _dataEngineOwner: 'userA', _dataEngine: { ...metadata, deleted: true } }));
      await check(`${collection}: owner reads an owner-hidden tombstone`, assertSucceeds(getDoc(doc(a, collection, 'buried'))));
      await check(`${collection}: foreign read of an owner-hidden tombstone denied`, assertFails(getDoc(doc(b, collection, 'buried'))));
      await check(`${collection}: owner-hidden tombstone cannot be resurrected`, assertFails(setDoc(doc(a, collection, 'buried'), { ...owner, language: 'ru' })));
      await check(`${collection}: owner-hidden tombstone cannot be deleted from a browser`, assertFails(deleteDoc(doc(a, collection, 'buried'))));
    }
    if (collection !== 'users') await check(`${collection}: client cannot manufacture marker`, assertFails(setDoc(doc(a, collection, 'forged'), { ...owner, _dataEngine: metadata })));
  }
  for (const marker of [null, {}, { protocol: 99 }]) {
    await testEnv.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), 'sermons', 'malformed'), { userId: 'userA', _dataEngine: marker }));
    await check('malformed marker remains protected', assertFails(setDoc(doc(a, 'sermons', 'malformed'), { userId: 'userA' })));
  }
  const headId = JSON.stringify(['userA', 'sermons']);
  await testEnv.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), '_dataEngineHeads', headId), { userId: 'userA', collection: 'sermons', version: 1 }));
  await check('absent head reads as absent, not denied', assertSucceeds(getDoc(doc(a, '_dataEngineHeads', JSON.stringify(['userA', 'councils'])))));
  await check('head owner read allowed', assertSucceeds(getDoc(doc(a, '_dataEngineHeads', headId))));
  await check('head foreign read denied', assertFails(getDoc(doc(b, '_dataEngineHeads', headId))));
  await check('head SDK write denied', assertFails(updateDoc(doc(a, '_dataEngineHeads', headId), { version: 2 })));
  await check('feed pointer SDK write denied', assertFails(setDoc(doc(a, '_dataEngineHeads', headId, 'changes', '0001'), { version: 1 })));
  await check('receipt SDK write denied', assertFails(setDoc(doc(a, '_dataEngineReceipts', 'operation'), { userId: 'userA' })));

  // The pending full set is enqueued BEFORE server migration, then reconnects AFTER.
  // Attaching the rejection handler immediately avoids an unhandled promise race.
  const offlineRef = doc(a, 'sermons', 'offline-transition');
  await testEnv.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), 'sermons', 'offline-transition'), { userId: 'userA', title: 'before' }));
  await getDoc(offlineRef);
  await disableNetwork(a);
  const queued = assertFails(setDoc(offlineRef, { userId: 'userA', title: 'stale offline full set' }));
  await testEnv.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), 'sermons', 'offline-transition'), { userId: 'userA', title: 'engine committed', _dataEngine: metadata }));
  await enableNetwork(a);
  await check('offline queued write rejected after migration', queued);
  await check('offline rejected write preserves engine commit', (async () => {
    const actual = (await getDocFromServer(offlineRef)).data();
    if (actual.title !== 'engine committed' || actual._dataEngine.revision !== 1) throw new Error('Engine commit overwritten');
  })());

  await testEnv.cleanup();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
