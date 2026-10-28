// Robust resizing: a level in play survives every window shape and pixel ratio (laptop, phone each
// way, ultra-wide, 4K, tiny) and rapid-fire resizing — the canvas follows, the camera keeps the same
// slice of world, the ground still renders to the bottom edge, and nothing throws.
import { launch, open, reporter, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const page = await open(browser, { storage: { 'mossbound.settings.v1': { perf: 'high' } } });
const t = reporter();
await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keysL', 'keysR']; f.playLevel(0); });
await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session'), 5000, 'session');
const SIZES = [
  [1280, 720, 1],
  [844, 390, 3],
  [390, 844, 3],
  [2560, 1080, 1],
  [3840, 2160, 1],
  [600, 600, 2],
  [320, 200, 1],
  [1920, 1080, 1.5],
];
for (const [w, h, dpr] of SIZES) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
  await sleep(400);
  const r = await page.evaluate(() => {
    const app = window.__fb.app;
    const rr = app.renderer;
    const s = window.__fbSession;
    // the canvas backing store is css × min(dpr,2) × quality (capped at ~1600 rows)
    const k = Math.min(Math.min(devicePixelRatio, 2), 1600 / rr.cssH) * rr.scale;
    const okSize = Math.abs(rr.width - Math.round(rr.cssW * k)) <= 1 && Math.abs(rr.height - Math.round(rr.cssH * k)) <= 1 && rr.cssW === innerWidth && rr.cssH === innerHeight;
    // the camera shows about 14.5 tiles of height (wider/narrower screens are clamped)
    const tilesH = s.cam.viewH / 32;
    const tilesW = s.cam.viewW / 32;
    // pixels: something drawn at the top (sky) and at the bottom (ground), not black
    const ctx = rr.ctx;
    const px = (x, y) => Array.from(ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3));
    const top = px(rr.width / 2, 2);
    const bottom = px(rr.width / 2, rr.height - 3);
    return { canvas: [rr.width, rr.height], css: [rr.cssW, rr.cssH], okSize, tilesH: +tilesH.toFixed(1), tilesW: +tilesW.toFixed(1), top, bottom };
  });
  const drawn = r.top.some((v) => v > 30) && r.bottom.some((v) => v > 30);
  t.check(`${w}×${h} @${dpr}x`, r.okSize && drawn && r.tilesW >= 16.5 && r.tilesW <= 35 && r.tilesH > 6, r);
}
// rapid fire
for (let i = 0; i < 30; i++) await page.setViewport({ width: 400 + ((i * 137) % 1500), height: 300 + ((i * 89) % 800), deviceScaleFactor: 1 + (i % 3) * 0.5 });
await sleep(500);
const last = await page.evaluate(() => { const rr = window.__fb.app.renderer; return { w: rr.width, cssW: rr.cssW, inner: innerWidth, gen: rr.generation }; });
t.check('rapid resizing settles on the final size', last.cssW === last.inner, last);
// ---- a touch-screen laptop in a window taller than wide: "turn your phone sideways" is for phones,
// and must never take the game away from a laptop someone happened to touch
await page.setViewport({ width: 960, height: 1040, deviceScaleFactor: 1 });
await sleep(400);
const rotateEl = () => page.evaluate(() => getComputedStyle(document.querySelector('.tc-rotate')).display);
const before = await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, portrait: matchMedia('(orientation: portrait)').matches }));
// one touch of the screen (a pen, a stray thumb) — the pointer stays a mouse's, as on a laptop
await page.evaluate(() => document.getElementById('app')?.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, isPrimary: true, pointerId: 7 })));
await sleep(300);
const after = await page.evaluate(() => ({ bodyTouch: document.body.classList.contains('touch'), screen: window.__fb.app.current?.constructor.name }));
t.check('a touch on a laptop in a tall window keeps the game', after.bodyTouch && !before.coarse && before.portrait && (await rotateEl()) === 'none', { before, after, rotate: await rotateEl() });
await browser.close();
t.finish('resize', page.errors);
