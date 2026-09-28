/**
 * A COLLECTION CLOSED TO BROWSER WRITES — the last step of a domain's rollout.
 *
 * The shipped rules close nothing. Closing is a one-word edit of `closedToBrowserWrites` in
 * firestore.rules, made at rollout together with the server's DATA_ENGINE_CLOSED_COLLECTIONS.
 * This script applies that edit to a copy of the rules, listing every collection production serves
 * through the engine, and proves each one closes as the runbook says, before anyone has to trust it. Separate from rules-test.cjs because one process can start only
 * one rules environment.
 */
const fs = require('fs');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');

let pass = 0, fail = 0;
async function check(name, promise) {
  try { await promise; pass += 1; console.log(`  ✓ ${name}`); }
  catch (error) { fail += 1; console.log(`  ✗ ${name}\n    ${error.message}`); }
}

(async () => {
  const openRules = fs.readFileSync('firestore.rules', 'utf8');
  // The ten collections production serves through the engine (activation.ts, Vercel switches).
  const closed = ['councils', 'groups', 'series', 'sermons', 'tags', 'prayerRequests', 'serviceOrders', 'studyNotes', 'studyMaterials', 'planTemplates'];
  const closedRules = openRules.replace('return name in [];', `return name in [${closed.map(name => `'${name}'`).join(', ')}];`);
  if (closedRules === openRules) throw new Error('closedToBrowserWrites was not found in firestore.rules');
  const testEnv = await initializeTestEnvironment({ projectId: process.env.RULES_TEST_PROJECT || 'demo-preacher', firestore: { rules: closedRules } });
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore(); // once: a second call would try to configure a started instance
    for (const name of closed) await setDoc(doc(db, name, 'legacy'), { userId: 'userA', title: 'never touched by the engine' });
    await setDoc(doc(db, 'prayerCategories', 'other'), { userId: 'userA', name: 'x' });
  });
  const a = testEnv.authenticatedContext('userA').firestore();
  for (const name of closed) {
    console.log(`\n=== ${name} closed to browser writes ===`);
    await check(`owner still reads ${name}`, assertSucceeds(getDoc(doc(a, name, 'legacy'))));
    await check(`update of an unmarked ${name} document denied`, assertFails(updateDoc(doc(a, name, 'legacy'), { title: 'old bundle' })));
    await check(`delete of an unmarked ${name} document denied`, assertFails(deleteDoc(doc(a, name, 'legacy'))));
    await check(`creating ${name} from a browser denied`, assertFails(setDoc(doc(a, name, 'fresh'), { userId: 'userA', title: 'invisible to the feed' })));
  }
  console.log('\n=== a collection outside the list ===');
  await check('prayer categories stay writable', assertSucceeds(updateDoc(doc(a, 'prayerCategories', 'other'), { name: 'y' })));
  await testEnv.cleanup();
  console.log(`\nRESULT (closed): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
