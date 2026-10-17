const { webkit, chromium } = require('../../node_modules/playwright-core');
// What a big book of the Bible costs (2026-10-16, the owner's iPad: the text size and a turn were slow in
// Isaiah and the Psalms): opening it, a new text size, a turn of the iPad — the page as it is ("base"), with
// `content-visibility` on each chapter ("cv"), and with only ±TRIM_K chapters left in the page by hand
// ("trim", the ceiling of drawing a window; `.howto/draw-a-big-book.md`). One JSON line per book and mode.
//   ENGINE=webkit|chrome  BASE=http://localhost:3100  BOOKS=psalms,genesis  MODES=base,cv,trim  TRIM_K=5
//   node tools/webkit-lab/big-book-cost.js
// Measure a production build (NEXT_PUBLIC_ENABLE_TEST_LOGIN=true, NEXT_PUBLIC_API_BASE= , `next start`).
// The size here is written to the CSS variable directly, past the provider that brings the place back:
// read the place from a real "A+" tap, not from this probe.
const BASE = process.env.BASE || 'http://localhost:3100';
const ENGINE = process.env.ENGINE || 'webkit';
const BOOKS = (process.env.BOOKS || 'psalms,genesis,jeremiah,isaiah').split(',');
const MODES = (process.env.MODES || 'base,cv,trim').split(',');
const CV_SIZE = process.env.CV_SIZE || '1200px';
const AT = { psalms: '77:1', genesis: '25:1', jeremiah: '26:1', isaiah: '33:1', ezekiel: '24:1' };

const median = (list) => { const s = [...list].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

(async () => {
  const browser = ENGINE === 'chrome' ? await chromium.launch({ channel: 'chrome' }) : await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const login = page.getByRole('button', { name: /Test User|тестов/i });
  await login.waitFor({ timeout: 90000 }); await login.click();
  await page.waitForURL(/dashboard/, { timeout: 90000 });
  await page.evaluate(() => { localStorage.setItem('text-scale-preference', '1'); });
  // The first time a verse is in the page and the frame after it: "the text is there".
  await ctx.addInitScript(() => {
    window.__shown = null;
    const watch = () => {
      if (document.querySelector('[data-verse]')) {
        const at = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => { window.__shown = { inPage: Math.round(at), painted: Math.round(performance.now()) }; }));
        return;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  const results = [];
  for (const book of BOOKS) {
    for (const mode of MODES) {
      const page2 = await ctx.newPage();
      if (mode === 'cv') {
        await page2.addInitScript((size) => {
          const style = document.createElement('style');
          style.textContent = `section[data-chapter]{content-visibility:auto;contain-intrinsic-size:auto ${size}}`;
          document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
        }, CV_SIZE);
      }
      await page2.goto(`${BASE}/bible?book=${book}&at=${AT[book] || '10:1'}`, { waitUntil: 'domcontentloaded' });
      await page2.waitForFunction(() => window.__shown, null, { timeout: 90000 });
      await page2.waitForTimeout(2500);
      const shown = await page2.evaluate(() => window.__shown);
      if (mode === 'trim') {
        await page2.evaluate((k) => {
          const place = document.querySelector('[data-chapter]') && [...document.querySelectorAll('section[data-chapter]')];
          const top = place.find((section) => section.getBoundingClientRect().bottom > 0);
          const here = Number(top.dataset.chapter);
          place.forEach((section) => { if (Math.abs(Number(section.dataset.chapter) - here) > k) section.remove(); });
        }, Number(process.env.TRIM_K ?? 5));
        await page2.waitForTimeout(1000);
      }
      const elements = await page2.evaluate(() => document.querySelectorAll('article *').length);
      // A new text size: the frame that carries it, six times, 1 ↔ 1.25.
      const sizes = await page2.evaluate(async () => {
        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
        const out = [];
        for (let i = 0; i < 6; i += 1) {
          await frame();
          const t0 = performance.now();
          document.documentElement.style.setProperty('--text-scale', i % 2 ? '1' : '1.25');
          await frame(); await frame();
          out.push(Math.round(performance.now() - t0));
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return out;
      });
      // A turn of the iPad: the worst frame while the window goes landscape and back.
      const startFrames = () => page2.evaluate(() => { window.__frames = []; let last = performance.now(); const loop = (now) => { window.__frames.push(Math.round(now - last)); last = now; if (window.__frames.length < 600) requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
      const worst = () => page2.evaluate(() => { const f = window.__frames.slice(1); return { worst: Math.max(0, ...f), jank: f.reduce((s, d) => s + Math.max(0, d - 17), 0) }; });
      await startFrames(); await page2.waitForTimeout(200);
      await page2.setViewportSize({ width: 1180, height: 820 }); await page2.waitForTimeout(1200);
      await page2.setViewportSize({ width: 820, height: 1180 }); await page2.waitForTimeout(1200);
      const turn = await worst();
      // The verse at the reading top before and after: a turn and a size must keep the place.
      const place = await page2.evaluate(() => document.querySelector('header')?.innerText.replace(/\s+/g, ' ').slice(0, 60) ?? null);
      const row = { engine: ENGINE, book, mode, elements, openPaintedMs: shown.painted, sizeMedianMs: median(sizes), sizeMaxMs: Math.max(...sizes), turnWorstMs: turn.worst, turnJankMs: turn.jank, place };
      console.log(JSON.stringify(row));
      results.push(row);
      await page2.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
