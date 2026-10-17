const { webkit } = require('../../node_modules/playwright-core');
// One place in every Bible (2026-10-17, item 4.1 of the block-diagram case): a reference written in one
// Bible's numbering opens the same verse in the Bible being read, and switching the Bible keeps the place.
// The dev test user picks the King James, then links in the Synodal and Ohienko numberings are opened; each
// step checks the Bible shown, the verse standing at the top and its first words. The last line is PASS or
// FAIL, and FAIL exits 1. WIDTH=390 runs it at phone width, where the page's header scrolls away.
//   BASE=http://localhost:3000  WIDTH=1280  node tools/webkit-lab/translations-same-place.js
const BASE = process.env.BASE || 'http://localhost:3000';
const WIDTH = Number(process.env.WIDTH || 1280);

(async () => {
  const browser = await webkit.launch();
  const context = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, locale: 'ru-RU', serviceWorkers: 'block' });
  // A device that has been used before knows the interface's language at once (its cookie). A fresh one
  // opens in English — and so in the King James — and turns to the person's language a moment later:
  // BUG-20261017-fresh-device-link-read-in-default-bible. This probe checks the numbering, not that.
  const host = new URL(BASE).hostname;
  await context.addCookies([{ name: process.env.LANG_COOKIE || 'lang', value: 'ru', domain: host, path: '/' }]);
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const login = page.getByRole('button', { name: /Test User|тестов/i });
  await login.waitFor({ timeout: 90000 });
  await login.click();
  await page.waitForURL(/dashboard/, { timeout: 150000, waitUntil: 'domcontentloaded' });

  // The Bible on the switch, the place the reader itself says the person is at (its place button, measured
  // from the reading line a verse brought to stands on) and that verse's first words. The probe keeps no
  // geometry of its own: rows above the place sit under the reader's sticky bar.
  const where = async () => {
    await page.waitForSelector('[data-verse]', { timeout: 90000 });
    await page.waitForTimeout(5500);
    return page.evaluate(() => {
      const visible = [...document.querySelectorAll('button')].filter((button) => button.offsetParent);
      const trigger = visible.find((button) => /выбрать другой перевод/.test(button.getAttribute('aria-label') || ''));
      const verse = visible.map((button) => (button.textContent || '').trim()).find((text) => /^\d+:\d+$/.test(text));
      const row = verse ? document.querySelector(`[data-verse="${verse}"]`) : null;
      return {
        bible: trigger?.textContent?.trim(),
        verse,
        words: row?.querySelector('[data-verse-text]')?.textContent?.trim().slice(0, 40),
      };
    });
  };
  const pick = async (name) => {
    await page.locator('button[aria-haspopup="dialog"]:visible', { hasText: /перевод|Version|Огієнка/ }).first().click();
    await page.getByRole('button', { name: new RegExp(name) }).last().click();
  };

  const checks = [];
  const check = async (what, expected) => {
    const seen = await where();
    const ok = seen.bible === expected.bible && seen.verse === expected.verse && (!expected.words || expected.words.test(seen.words || ''));
    checks.push(ok);
    console.log(`${ok ? '✓' : '✗'} ${what} → ${seen.bible} ${seen.verse} «${seen.words}»`);
  };

  await page.goto(`${BASE}/bible?book=psalms&at=1:1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-verse]', { timeout: 90000 });
  await pick('King James Version');
  await check('King James chosen', { bible: 'King James Version', verse: '1:1' });

  await page.goto(`${BASE}/bible?book=psalms&at=22:1&tr=rst`, { waitUntil: 'domcontentloaded' });
  await check('Synodal Ps 22:1 read in the King James', { bible: 'King James Version', verse: '23:1', words: /The LORD is my shep/ });
  // On a phone the switch stands in the book's line, which scrolls away with the text: reaching it is
  // scrolling to the book's start, and the switch keeps that place. It is checked where it stays in view.
  if (WIDTH >= 768) {
    await pick('Переклад Огієнка');
    await check('switched to Ohienko, the same psalm', { bible: 'Переклад Огієнка', verse: '22:1', words: /Господь — то мій Па/ });
  }
  await pick('Синодальный перевод');
  if (WIDTH >= 768) await check('switched to the Synodal, the same psalm', { bible: 'Синодальный перевод', verse: '22:1', words: /Господь — Пастырь мой/ });

  await page.goto(`${BASE}/bible?book=joel&at=3:1&tr=ubio`, { waitUntil: 'domcontentloaded' });
  await check('Ohienko Joel 3:1 read in the Synodal', { bible: 'Синодальный перевод', verse: '2:28' });
  await page.goto(`${BASE}/bible?book=romans&at=16:25&tr=kjv`, { waitUntil: 'domcontentloaded' });
  await check('King James Rom 16:25 read in the Synodal', { bible: 'Синодальный перевод', verse: '14:24', words: /Могущему же утвердить/ });

  await page.goto(`${BASE}/bible?book=psalms&at=1:1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-verse]', { timeout: 90000 });
  await pick('King James Version');
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/bible?book=psalms&at=50:12&tr=rst`, { waitUntil: 'domcontentloaded' });
  await check('Synodal Ps 50:12 read in the King James', { bible: 'King James Version', verse: '51:10', words: /Create in me a clean heart/ });
  await page.goto(`${BASE}/bible?book=psalms&at=1:1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-verse]', { timeout: 90000 });

  // The test user is left reading the Synodal, as before.
  await pick('Синодальный перевод');
  await page.waitForTimeout(1500);
  await browser.close();
  const pass = checks.every(Boolean);
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})().catch((error) => { console.error(error); console.log('FAIL'); process.exit(1); });
