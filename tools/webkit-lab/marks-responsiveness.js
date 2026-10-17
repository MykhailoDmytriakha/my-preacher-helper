const { webkit, chromium } = require('../../node_modules/playwright-core');
// How the Bible marks answer a person (2026-10-16, the owner's iPad felt every tap and stroke stiff):
// a tap on a tool, a stroke over words, and the frames after it, in Playwright WebKit (the iPad's engine)
// or the installed Google Chrome, signed in as the test user. Prints one JSON line per book.
//   ENGINE=webkit|chrome  BASE=http://localhost:3000  AT=<chapter per book, comma-separated>  SKIP=<words to skip>
//   node tools/webkit-lab/marks-responsiveness.js habakkuk psalms
// Measure a production build, not the dev server: the dev server answering each stroke takes the CPU the
// browser draws with. Build a copy with NEXT_PUBLIC_ENABLE_TEST_LOGIN=true (the test sign-in) and
// NEXT_PUBLIC_API_BASE= , `next start -p 3100` it, and pass BASE. Each run adds marks to the test user's
// book; pick a chapter per run (AT) so strokes paint new words instead of erasing the last run's.
const ENGINE = process.env.ENGINE || 'webkit';
const SKIP = Number(process.env.SKIP || 0);
const BASE = process.env.BASE || 'http://localhost:3000';
const AT = (process.env.AT || '1,1').split(',');
const books = process.argv.slice(2).length ? process.argv.slice(2) : ['habakkuk', 'psalms'];
(async () => {
  const browser = ENGINE === 'chrome' ? await chromium.launch({ channel: 'chrome' }) : await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, locale: 'ru-RU' });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
    Object.defineProperty(navigator, 'standalone', { get: () => true });
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const login = page.getByRole('button', { name: /Test User|тестов/i });
  await login.waitFor({ timeout: 90000 });
  await login.click();
  await page.waitForURL(/dashboard/, { timeout: 90000 });
  await page.waitForTimeout(2000);

  const wordsOf = (index, count) => page.evaluate(([index, count, skip]) => {
    const rows = [...document.querySelectorAll('[data-verse-text]')].filter((e) => { const r = e.getBoundingClientRect(); return r.top > 120 && r.bottom < innerHeight - 60 && r.width > 300; });
    const el = rows[index % rows.length];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const pts = []; let node; let seen = 0;
    while ((node = walker.nextNode()) && pts.length < count) for (const m of node.data.matchAll(/\S+/g)) { if (seen++ < skip) continue; const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length); const b = r.getBoundingClientRect(); if (b.width && Math.abs(b.top - (pts[0]?.[1] ?? b.top + b.height / 2) + b.height / 2) < 4) pts.push([b.left + b.width / 2, b.top + b.height / 2]); if (pts.length >= count) break; }
    return pts;
  }, [index, count, SKIP]);
  const stroke = async (pts) => {
    await page.mouse.move(pts[0][0], pts[0][1]);
    await page.mouse.down();
    for (const [x, y] of pts.slice(1)) { await page.mouse.move(x, y, { steps: 3 }); await page.waitForTimeout(16); }
    await page.mouse.up();
  };
  const ranges = () => page.evaluate(() => { let n = 0; CSS.highlights.forEach((h) => { n += h.size; }); return n; });
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText.slice(0, 80)));

  for (const book of books) {
    await page.goto(`${BASE}/bible?book=${book}&at=${AT[books.indexOf(book)] ?? 1}:1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-mark-toolbar] > button', { timeout: 90000 });
    await page.waitForTimeout(3000);
    const size = await page.evaluate(() => ({ elements: document.querySelector('[data-pen-surface]').querySelectorAll('*').length, verses: document.querySelectorAll('[data-verse]').length }));

    // Take the marker (its colours open), close the colours.
    const marker = page.locator('[data-mark-toolbar]:visible button[aria-expanded]').first();
    await marker.click();
    await page.waitForTimeout(400);
    // Warm-up: the book gets some marks, as after a few minutes of work.
    const before = await ranges();
    for (let i = 0; i < 12; i++) { await stroke(await wordsOf(i, 3)); await page.waitForTimeout(250); }
    await page.waitForTimeout(3000);
    const warm = { before, after: await ranges(), toasts: await toasts() };

    const costs = await page.evaluate(async () => {
      const art = document.querySelector('[data-pen-surface]');
      const deep = art.querySelector('[data-verse-text]');
      const yieldNow = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
      const force = () => { const t = performance.now(); getComputedStyle(deep).color; art.offsetHeight; return performance.now() - t; };
      const median = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)] * 10) / 10; };
      let name = 'bible-mark-orange'; CSS.highlights.forEach((h, n) => { if (h.size) name = n; });
      const h = CSS.highlights.get(name);
      force();
      const classToggle = []; const highlight = []; const caret = [];
      for (let i = 0; i < 5; i++) {
        await yieldNow(); art.classList.toggle('zz-none'); classToggle.push(force());
        await yieldNow(); CSS.highlights.set(name, h); highlight.push(force());
        await yieldNow(); CSS.highlights.set(name, h); const r = deep.getBoundingClientRect(); const t = performance.now(); document.caretRangeFromPoint(r.left + 20, r.top + 8); caret.push(performance.now() - t);
      }
      return { classToggle: median(classToggle), highlightChange: median(highlight), caretAfterHighlight: median(caret) };
    });

    // Taps on the eraser (no colours open): time from the click to the second painted frame.
    const taps = [];
    for (let i = 0; i < 4; i++) {
      taps.push(await page.evaluate(() => new Promise((resolve) => {
        const bar = [...document.querySelectorAll('[data-mark-toolbar]')].find((b) => b.getBoundingClientRect().width > 0);
        const eraser = bar.querySelector(':scope > button');
        const t0 = performance.now();
        eraser.click();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))));
      })));
      await page.waitForTimeout(300);
    }
    // Back to the marker in hand.
    const pressed = await marker.getAttribute('aria-pressed');
    if (pressed !== 'true') await marker.click();
    await page.waitForTimeout(500);

    // A measured stroke, frames counted meanwhile.
    const pts = await wordsOf(13, 8);
    await page.evaluate(() => { window.__frames = []; let last = performance.now(); const loop = (now) => { window.__frames.push(Math.round(now - last)); last = now; if (window.__frames.length < 600) requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    await page.waitForTimeout(100);
    await page.evaluate(() => { window.__downAt = window.__frames.length; });
    await stroke(pts);
    await page.evaluate(() => { window.__upAt = window.__frames.length; });
    await page.waitForTimeout(3000);
    const frames = await page.evaluate(() => {
      const during = window.__frames.slice(window.__downAt, window.__upAt); const after = window.__frames.slice(window.__upAt);
      const jank = (a) => a.reduce((s, d) => s + Math.max(0, d - 17), 0);
      return { duringStroke: { frames: during.length, worstMs: Math.max(0, ...during), jankMs: jank(during) }, afterRelease: { worstMs: Math.max(0, ...after), jankMs: jank(after), longest: [...after].sort((a, b) => b - a).slice(0, 5) } };
    });
    console.log(JSON.stringify({ engine: ENGINE, book, size, warm, costs, tapsMs: taps, frames, finalRanges: await ranges(), toasts: await toasts() }));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
