const { webkit, chromium } = require('../../node_modules/playwright-core');
// Reading a big book by scrolling (2026-10-16, `.howto/draw-a-big-book.md`): the wheel down, then up past
// the chapters drawn, twice. Each step: did a row on the screen move by anything but the scroll (a box of a
// guessed height drawn above it would move it)? Rows past the screen's edge are not counted: nothing seen
// moves there. Also the frames while scrolling, and how far the text moved when the scroll rested (the
// chapters above come in then). One JSON line.
//   ENGINE=webkit|chrome  BASE=http://localhost:3100  BOOK=psalms  AT=77:1  STEP=160  STEPS=50
//   node tools/webkit-lab/big-book-scroll.js
const BASE = process.env.BASE || 'http://localhost:3100';
const ENGINE = process.env.ENGINE || 'webkit';
const BOOK = process.env.BOOK || 'psalms';
const AT = process.env.AT || '77:1';
const STEP = Number(process.env.STEP || 160);
const STEPS = Number(process.env.STEPS || 50);

(async () => {
  const browser = ENGINE === 'chrome' ? await chromium.launch({ channel: 'chrome' }) : await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const login = page.getByRole('button', { name: /Test User|тестов/i });
  await login.waitFor({ timeout: 90000 }); await login.click();
  await page.waitForURL(/dashboard/, { timeout: 90000 });
  await page.goto(`${BASE}/bible?book=${BOOK}&at=${AT}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-verse]').first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(2500);
  const box = await page.locator('article').boundingBox();
  await page.mouse.move(box.x + 200, 600);
  // The line under the reading top, and how far the pane is scrolled.
  const probe = () => page.evaluate(() => {
    const pane = document.querySelector('article').parentElement;
    const line = pane.getBoundingClientRect().top + 24;
    const rows = [...document.querySelectorAll('[data-verse]')];
    const found = rows.find((r) => r.getBoundingClientRect().bottom > line);
    // Only a row on the screen: what the person sees.
    const row = found && found.getBoundingClientRect().top < pane.getBoundingClientRect().bottom ? found : null;
    return { scroll: pane.scrollTop, key: row?.dataset.verse ?? null, top: row ? row.getBoundingClientRect().top : null, drawn: document.querySelectorAll('section[data-chapter]:not([data-box])').length, rows: rows.length };
  });
  // The row's top, while it is on the screen: a row gone past the edge shows nothing that could move.
  const rowTop = (key) => page.evaluate((k) => { const row = document.querySelector(`[data-verse="${k}"]`); const pane = document.querySelector('article').parentElement.getBoundingClientRect(); if (!row) return null; const r = row.getBoundingClientRect(); return r.top < pane.bottom && r.bottom > pane.top ? r.top : null; }, key);
  const startFrames = () => page.evaluate(() => { window.__frames = []; let last = performance.now(); const loop = (now) => { window.__frames.push(Math.round(now - last)); last = now; if (window.__frames.length < 2000) requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
  const frames = () => page.evaluate(() => { const f = window.__frames.slice(1); return { worst: Math.max(0, ...f), over34: f.filter((d) => d > 34).length, jank: f.reduce((s, d) => s + Math.max(0, d - 17), 0) }; });

  const run = async (direction) => {
    let worstSlip = 0; let slips = 0;
    await startFrames();
    for (let i = 0; i < STEPS; i += 1) {
      const before = await probe();
      await page.mouse.wheel(0, direction * STEP);
      await page.waitForTimeout(60);
      if (before.key === null) continue;
      const after = await probe();
      const top = await rowTop(before.key);
      if (top === null) continue;
      // The row moved by the scroll and nothing else.
      const slip = Math.abs((top - before.top) + (after.scroll - before.scroll));
      if (slip > 1) slips += 1;
      worstSlip = Math.max(worstSlip, slip);
    }
    const scrolling = await frames();
    // The rest: the chapters above come in, and the text must not move.
    const atRest = await probe();
    await page.waitForTimeout(600);
    const restTop = atRest.key ? await rowTop(atRest.key) : null;
    const settled = await probe();
    return { direction: direction > 0 ? 'down' : 'up', worstSlipPx: Math.round(worstSlip * 10) / 10, slipSteps: slips, scrolling, restMovePx: restTop === null || atRest.top === null ? null : Math.round((restTop - atRest.top) * 10) / 10, place: settled.key, drawn: settled.drawn, rows: settled.rows };
  };
  const down = await run(1);
  const up = await run(-1);
  const up2 = await run(-1);
  console.log(JSON.stringify({ engine: ENGINE, book: BOOK, down, up, up2 }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
