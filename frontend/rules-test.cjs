/* Firestore Security Rules test suite (all collections). Run via firebase emulators:exec. */
const fs = require('fs');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');

let pass = 0, fail = 0;
async function check(label, p) {
  try { await p; console.log('  ✓', label); pass++; }
  catch (e) { console.log('  ✗', label, '—', e.message); fail++; }
}

// Collections owned via a `userId` field.
const USER_COLS = [
  'sermons', 'studyNotes', 'studyNoteBranchStates', 'series', 'groups',
  'prayerRequests', 'prayerCategories', 'tags', 'feedback',
];

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-preacher',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });

  // Seed userA-owned docs across every collection (rules bypassed for seeding).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const c of USER_COLS) await setDoc(doc(db, c, 'd1'), { userId: 'userA', v: 1 });
    await setDoc(doc(db, 'studyNoteShareLinks', 'd1'), { ownerId: 'userA', noteId: 'n1', token: 't' });
    await setDoc(doc(db, 'users', 'userA'), { email: 'a@a', language: 'en' });
    await setDoc(doc(db, 'ai_prompt_telemetry', 'd1'), { v: 1 });
    await setDoc(doc(db, 'api_performance_telemetry', 'd1'), { v: 1 });
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
  await check('users: owner writes own doc (allow)',      assertSucceeds(setDoc(doc(a, 'users', 'userA'), { email: 'a@a' })));
  await check('users: OTHER writes owner doc (deny)',     assertFails(setDoc(doc(b, 'users', 'userA'), { email: 'hax' })));

  console.log('\n=== server-only telemetry (deny all client access) ===');
  await check('ai_prompt_telemetry: read (deny)',         assertFails(getDoc(doc(a, 'ai_prompt_telemetry', 'd1'))));
  await check('api_performance_telemetry: write (deny)',  assertFails(setDoc(doc(a, 'api_performance_telemetry', 'x'), { v: 1 })));

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

  await testEnv.cleanup();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
