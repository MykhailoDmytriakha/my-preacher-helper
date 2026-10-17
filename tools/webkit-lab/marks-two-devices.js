const { webkit } = require('../../node_modules/playwright-core');
// A mark is kept and reaches another device (2026-10-17, item 2.9 of the block-diagram case). Device A (as
// the iPad) marks the first words of a verse in Jonah 2 that has no mark yet and reloads; device B (a second
// browser with its own storage, as the computer) opens the same place; then A erases the mark and B, opened
// again, no longer has it — the test user is left as it was. One test user, a dev server with its login
// button. Prints each step; the last line is PASS or FAIL, and FAIL exits 1.
//   BASE=http://localhost:3000  node tools/webkit-lab/marks-two-devices.js
const BASE = process.env.BASE || 'http://localhost:3000';
const PLACE = 'book=jonah&at=2:1';

async function device() {
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' })).newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const login = page.getByRole('button', { name: /Test User|тестов/i });
  await login.waitFor({ timeout: 90000 });
  await login.click();
  await page.waitForURL(/dashboard/, { timeout: 90000 });
  return { browser, page };
}

async function open(page) {
  await page.goto(`${BASE}/bible?${PLACE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-mark-toolbar] > button', { timeout: 90000 });
  await page.waitForTimeout(4000);
}

// The words under any mark in the verse, as the page paints them (CSS Custom Highlights).
const marked = (page, verse) => page.evaluate((key) => {
  const row = document.querySelector(`[data-verse="${key}"] [data-verse-text]`);
  const out = [];
  CSS.highlights.forEach((highlight, name) => highlight.forEach((range) => {
    if (row && row.contains(range.startContainer)) out.push(`${name}:${range.toString().trim()}`);
  }));
  return out.sort();
}, verse);

// A stroke over the verse's first three words.
async function stroke(page, verse) {
  const points = await page.evaluate((key) => {
    const node = document.createTreeWalker(document.querySelector(`[data-verse="${key}"] [data-verse-text]`), NodeFilter.SHOW_TEXT).nextNode();
    return [...node.data.matchAll(/\S+/g)].slice(0, 3).map((word) => {
      const range = document.createRange();
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      const box = range.getBoundingClientRect();
      return [box.left + box.width / 2, box.top + box.height / 2];
    });
  }, verse);
  await page.mouse.move(...points[0]);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(...point, { steps: 4 });
  await page.mouse.up();
}

const sent = (page) => page.waitForResponse(
  (response) => response.url().includes('/api/data-engine/commands') && response.request().method() === 'POST',
  { timeout: 30000 },
).then((response) => response.status());

(async () => {
  const checks = [];
  const check = (what, ok) => { checks.push(ok); console.log(`${ok ? '✓' : '✗'} ${what}`); };
  const A = await device();
  await open(A.page);
  // A verse with no mark yet: a stroke in the same colour over a mark takes it away (utils/bibleMarks.ts).
  let verse = null;
  for (const candidate of ['2:2', '2:3', '2:4', '2:5', '2:6', '2:7']) {
    if (!(await marked(A.page, candidate)).length) { verse = candidate; break; }
  }
  if (!verse) throw new Error('every verse 2:2–2:7 already carries a mark');
  console.log(`verse Jonah ${verse}`);

  await A.page.locator('[data-mark-toolbar]:visible button[aria-expanded]').first().click();
  await A.page.waitForTimeout(400);
  const markSent = sent(A.page);
  await stroke(A.page, verse);
  check(`A: the mark is sent (${await markSent})`, true);
  const mark = await marked(A.page, verse);
  check(`A: the words are marked ${JSON.stringify(mark)}`, mark.length > 0);

  await A.page.reload({ waitUntil: 'domcontentloaded' });
  await A.page.waitForSelector('[data-mark-toolbar] > button', { timeout: 90000 });
  await A.page.waitForTimeout(4000);
  check('A: after a reload the same mark', JSON.stringify(await marked(A.page, verse)) === JSON.stringify(mark));

  const B = await device();
  await open(B.page);
  check('B: another device opens the place with the same mark', JSON.stringify(await marked(B.page, verse)) === JSON.stringify(mark));

  await A.page.getByRole('button', { name: 'Ластик' }).first().click();
  await A.page.waitForTimeout(400);
  const eraseSent = sent(A.page);
  await stroke(A.page, verse);
  check(`A: the erasing is sent (${await eraseSent})`, true);
  check('A: the words are clear again', (await marked(A.page, verse)).length === 0);
  await open(B.page);
  check('B: opened again, the mark is gone there too', (await marked(B.page, verse)).length === 0);

  await A.browser.close();
  await B.browser.close();
  const pass = checks.every(Boolean);
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})().catch((error) => { console.error(error); console.log('FAIL'); process.exit(1); });
