// Smoke test against the deployed site. A production build has no dev hooks, so everything here goes
// through the page itself: click the buttons, read the DOM, look at the canvas. Two browsers are two
// devices, pairing over the real relays, as the two of us actually play.
//
// It talks to the live site, so it isn't part of `run.mjs`. After a deploy:
//   node tests/e2e/live.mjs                       # the published site
//   node tests/e2e/live.mjs http://127.0.0.1:4173/   # or a local `vite preview` of the build
import { launch, reporter, sleep } from './harness.mjs';

const BASE = process.argv[2] ?? 'https://atinygreencell.github.io/mossbound/';
const t = reporter();
const noise = (s) => /WebSocket connection to 'wss:\/\/[^']+' failed|ERR_NAME_NOT_RESOLVED|net::ERR_|Failed to load resource|willReadFrequently/.test(s);
const waitFor = async (fn, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn().catch(() => false)) return true; await sleep(200); }
  console.log(`   (timed out waiting for ${label})`);
  return false;
};

/** A browser on the live page, with its console and its requests recorded. */
async function device(browser, url, name) {
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  const errors = [];
  const asked = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { const s = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !noise(s)) errors.push(`[${m.type()}] ${s}`); });
  page.on('request', (r) => asked.push(r.url()));
  await page.evaluateOnNewDocument((n) => { try { localStorage.clear(); localStorage.setItem('mossbound.settings.v1', JSON.stringify({ name: n, color: n === 'Pip' ? 0 : 1 })); } catch { /* blocked */ } }, name);
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.bringToFront();
  await sleep(800);
  page.errors = errors;
  page.asked = asked;
  return page;
}
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, sel);
// menus ignore clicks for their first moments, so wait before each one
const click = async (page, sel) => { await sleep(500); await page.click(sel); await sleep(300); };
const picking = (s) => /pick a level|is picking/.test(s ?? '');

const b1 = await launch();
const b2 = await launch();
const host = await device(b1, BASE, 'Pip');
t.check('the page loads and shows the title', (await text(host, '.btn[data-act=online]')) !== null);

// the first press unlocks the sound, which is built in a worker now: that asset has to be served too
await host.mouse.click(640, 400);
await sleep(1500);
const worker = host.asked.filter((u) => /synth\.worker/.test(u));
t.check('the sound library’s worker is served and fetched', worker.length === 1, worker.map((u) => u.split('/').pop()));

// PLAY ONLINE opens on its main button, with one thing looking chosen
await click(host, '.btn[data-act=online]');
const opened = await host.evaluate(() => ({ sel: document.querySelector('.btn.sel')?.dataset?.act ?? null, golds: document.querySelectorAll('.btn.sel').length }));
t.check('PLAY ONLINE opens on MAKE A ROOM, and one button looks chosen', opened.sel === 'host' && opened.golds === 1, opened);

// pair the two devices over the real relays
await click(host, '.btn[data-act=host]');
const gotCode = await waitFor(async () => (await text(host, '.code'))?.length === 4, 20000, 'room code');
const code = gotCode ? await text(host, '.code') : null;
t.check('a room opens with a code', !!code, code);
const guest = code ? await device(b2, `${BASE}#join=${code}`, 'Bo') : null;
const paired = guest ? await waitFor(async () => picking(await text(host, '.panel-title')) && picking(await text(guest, '.panel-title')), 60000, 'both at the level select') : false;
t.check('the two devices pair and reach the level select', paired);

if (paired) {
  const lines = [await text(host, '.sprouts'), await text(guest, '.sprouts')];
  t.check('both screens agree who is which sprout', lines.every((l) => /Pip is the tall sprout/.test(l ?? '') && /Bo the small one/.test(l ?? '')), lines);

  await click(host, '[data-act="lvl:0"]');
  const inLevel = await waitFor(async () => (await host.evaluate(() => !!document.querySelector('.hud'))) && (await guest.evaluate(() => !!document.querySelector('.hud'))), 30000, 'the level on both');
  t.check('the host’s pick starts the level on both devices', inLevel);

  if (inLevel) {
    await sleep(2500);
    const dash = await Promise.all([host, guest].map((p) => p.evaluate(() => { const el = document.querySelector('.tc-dash'); return el ? getComputedStyle(el).display !== 'none' : null; })));
    t.check('only the small sprout’s screen offers DASH', dash[0] === false && dash[1] === true, { tall: dash[0], small: dash[1] });
    // both of them shoot vines (1.2.0)
    const vine = await Promise.all([host, guest].map((p) => p.evaluate(() => { const el = document.querySelector('.tc-shoot'); return el ? getComputedStyle(el).display !== 'none' : null; })));
    t.check('both screens offer VINE', vine[0] === true && vine[1] === true, { tall: vine[0], small: vine[1] });
    const drawn = await host.evaluate(() => {
      const c = document.querySelector('canvas');
      const g = c.getContext('2d');
      const px = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      return { size: [c.width, c.height], lit: px[0] + px[1] + px[2] > 30 };
    });
    t.check('the level is on the screen', drawn.lit, drawn);
  }
}

// A tall window on a laptop with a touch screen keeps the game, rather than being replaced by "turn
// your phone sideways": one stray touch is not a phone. A touch pointer event builds the touch
// controls while the pointer itself stays a mouse's, which is exactly the case this distinguishes
// (puppeteer's hasTouch would also make the pointer coarse, i.e. a real phone).
await host.setViewport({ width: 760, height: 1000, deviceScaleFactor: 1 });
await sleep(800);
await host.evaluate(() => document.getElementById('app')?.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, isPrimary: true, pointerId: 7 })));
await sleep(1200);
const rotate = await host.evaluate(() => {
  const el = document.querySelector('.tc-rotate');
  return { shown: el ? getComputedStyle(el).display !== 'none' : null, bodyTouch: document.body.classList.contains('touch'), coarse: matchMedia('(pointer: coarse)').matches, portrait: matchMedia('(orientation: portrait)').matches, canvas: !!document.querySelector('canvas') };
});
t.check('a tall window on a laptop with a touch screen keeps the game', rotate.bodyTouch && !rotate.coarse && rotate.portrait && rotate.shown === false && rotate.canvas, rotate);

const errs = [...host.errors, ...(guest?.errors ?? [])];
await b1.close();
await b2.close();
t.finish('live', errs);
