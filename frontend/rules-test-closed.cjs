/**
 * COLLECTIONS CLOSED TO BROWSER WRITES — the last step of the rollout, shipped 2026-09-28.
 *
 * `closedToBrowserWrites` in firestore.rules lists every collection production serves through the
 * engine, deployed together with the server's DATA_ENGINE_CLOSED_COLLECTIONS. This script tests the
 * shipped rules as they are: the list must be exactly the ten, and each one must be closed. Separate from rules-test.cjs because one process can start only
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
  // The ten collections production serves through the engine and closes (activation.ts, Vercel
  // DATA_ENGINE_CLOSED_COLLECTIONS). The shipped rules are tested as they ship: the list must be exactly these.
  const closed = ['councils', 'groups', 'series', 'sermons', 'tags', 'prayerRequests', 'serviceOrders', 'studyNotes', 'studyMaterials', 'planTemplates'];
  const closedRules = fs.readFileSync('firestore.rules', 'utf8');
  const lists = [...closedRules.matchAll(/return name in \[([^\]]*)\];/g)];
  if (lists.length !== 1) throw new Error('closedToBrowserWrites list not found exactly once in firestore.rules');
  const shipped = lists[0][1].split(',').map(entry => entry.trim().replace(/^'|'$/g, '')).filter(Boolean);
  if (JSON.stringify([...shipped].sort()) !== JSON.stringify([...closed].sort())) {
    throw new Error(`closedToBrowserWrites ships [${shipped.join(', ')}], expected exactly [${closed.join(', ')}]`);
  }
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
