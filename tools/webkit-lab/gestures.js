const { webkit } = require('../../node_modules/playwright-core');
// Drives the page gestures of the running dev server (localhost:3000) in Playwright WebKit as an installed iPad app.
// Run: node tools/webkit-lab/gestures.js — prints the surface position mid-gesture and saves screenshots next to this file.
const OUT = __dirname;
(async () => {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1180, height: 820 }, hasTouch: true, locale: 'ru-RU',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Safari/605.1.15',
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
    Object.defineProperty(navigator, 'standalone', { get: () => true });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  const login = page.getByRole('button', { name: /Test User|тестов/i });
  await login.waitFor({ timeout: 60000 });
  await login.click();
  await page.waitForURL(/dashboard/, { timeout: 60000 });
  await page.waitForTimeout(3000);
  const go = async (href, re) => {
    await page.evaluate(h => { const a = document.querySelector(`a[href="${h}"]`); if (!a) throw new Error('no link ' + h); a.click(); }, href);
    await page.waitForURL(re, { timeout: 30000 });
    await page.waitForTimeout(2500);
  };
  await go('/sermons', /sermons/);
  await go('/series', /series/);
  console.log('at', page.url(), 'history', await page.evaluate(() => history.length));

  const touch = (type, x, y) => page.evaluate(([type, x, y]) => {
    const el = document.elementFromPoint(Math.min(x, innerWidth - 1), y) || document.body;
    const t = { identifier: 1, target: el, clientX: x, clientY: y };
    const list = type === 'touchend' ? [] : [t];
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: list });
    Object.defineProperty(event, 'changedTouches', { value: [t] });
    el.dispatchEvent(event);
  }, [type, x, y]);
  const probe = () => page.evaluate(() => {
    const s = document.querySelector('[data-page-gesture]');
    const nav = document.querySelector('nav');
    const r = s.getBoundingClientRect();
    return { kind: s.dataset.pageGesture, left: s.style.left, top: s.style.top, surfaceX: Math.round(r.left), surfaceY: Math.round(r.top),
      navX: nav && Math.round(nav.getBoundingClientRect().left), navY: nav && Math.round(nav.getBoundingClientRect().top),
      parentClip: s.parentElement.style.overflowX, docWidth: document.documentElement.scrollWidth, transform: getComputedStyle(s).transform };
  });

  // Edge start belongs to Safari: nothing must move.
  await touch('touchstart', 10, 400); await touch('touchmove', 40, 401); await touch('touchmove', 200, 402);
  console.log('edge', JSON.stringify(await probe()));
  await touch('touchend', 200, 402); await page.waitForTimeout(400);

  // Swipe back from the middle, hold mid-way.
  await touch('touchstart', 300, 400); await page.waitForTimeout(150);
  for (const x of [320, 380, 460, 560, 640]) { await touch('touchmove', x, 402); await page.waitForTimeout(40); }
  console.log('back-mid', JSON.stringify(await probe()));
  await page.screenshot({ path: `${OUT}/back-mid.png` });
  await page.waitForTimeout(300); // rest the finger so release is not a flick
  await touch('touchend', 640, 402);
  await page.waitForTimeout(60);
  console.log('back-release', JSON.stringify(await probe()));
  await page.screenshot({ path: `${OUT}/back-leaving.png` });
  await page.waitForTimeout(1500);
  console.log('after-back', page.url(), JSON.stringify(await probe()));

  // Pull down at the top.
  await page.evaluate(() => scrollTo(0, 0));
  await touch('touchstart', 600, 150); await page.waitForTimeout(100);
  for (const y of [160, 200, 260, 320]) { await touch('touchmove', 600, y); await page.waitForTimeout(40); }
  console.log('pull-mid', JSON.stringify(await probe()));
  await page.screenshot({ path: `${OUT}/pull-mid.png` });
  // abandon: back up, release
  await touch('touchmove', 600, 170); await touch('touchend', 600, 170);
  await page.waitForTimeout(80);
  console.log('pull-settling', JSON.stringify(await probe()));
  await page.waitForTimeout(400);
  console.log('pull-rest', JSON.stringify(await probe()));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
