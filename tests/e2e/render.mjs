// Drawing that has to hold up on real screens: the camera easing out paints no tiles over again, tiles
// sit exactly on the world grid even at the far end of a level, a GPU reset gets everything painted
// again, resizing never flashes a black frame, the tile cache keeps to its memory on a big screen, and
// a change of pixel density alone (a window dragged to another monitor) is noticed.
import { frames, launch, open, reporter, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const t = reporter();
// (sharpest quality: the governor mustn't change the resolution under the measurements)
const page = await open(browser, { storage: { 'mossbound.settings.v1': { perf: 'high' } } });
await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keysL', 'keysR']; f.playLevel(0); });
await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session'), 5000, 'session');
await sleep(600);
/** Put both birds on the ground at tile column `tx` (the string off, so it can't drag them about). */
const standAt = (tx, gap = 2) => page.evaluate((tx, gap) => {
  const s = window.__fbSession;
  const F = 14;
  s.devTeleport(tx * 32 + 16, F * 32 - 10.01, 0);
  s.devTeleport((tx + gap) * 32 + 16, F * 32 - 10.01, 1);
  s.ropeOffUntil = Infinity;
}, tx, gap);

// ---- the camera eases out (the birds far apart) and back in: no tile chunk is painted twice
{
  await standAt(20);
  await sleep(800);
  const zoom = await page.evaluate(async () => {
    const s = window.__fbSession;
    const get = HTMLCanvasElement.prototype.getContext;
    let paints = 0;
    HTMLCanvasElement.prototype.getContext = function (...a) {
      if (this.id !== 'view') paints++;
      return get.apply(this, a);
    };
    const scales = new Set();
    const watch = (ms) => new Promise((done) => {
      const t0 = performance.now();
      const f = () => {
        scales.add(s.cam.scale);
        if (performance.now() - t0 < ms) requestAnimationFrame(f);
        else done();
      };
      f();
    });
    const F = 14;
    s.devTeleport(52 * 32 + 16, F * 32 - 10.01, 1);
    s.ropeOffUntil = Infinity;
    await watch(2000);
    s.devTeleport(22 * 32 + 16, F * 32 - 10.01, 1);
    s.ropeOffUntil = Infinity;
    await watch(2000);
    HTMLCanvasElement.prototype.getContext = get;
    return { paints, zoomSteps: scales.size };
  });
  t.check(`zooming out and back in paints only the tiles coming into view (${zoom.paints} paints over ${zoom.zoomSteps} zoom steps)`, zoom.zoomSteps > 10 && zoom.paints <= 40, zoom);
}

// ---- far along the level, every chunk of tiles lands exactly on the world grid
{
  await standAt(130);
  await sleep(1200);
  const grid = await page.evaluate(async () => {
    const s = window.__fbSession;
    const ctx = window.__fb.app.renderer.ctx;
    const calls = [];
    const draw = ctx.drawImage;
    ctx.drawImage = function (img, x, y, ...rest) {
      calls.push([img, x, y]);
      return draw.call(this, img, x, y, ...rest);
    };
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    ctx.drawImage = draw;
    const chunks = new Set([...s.tiles.chunks.values()].map((c) => c.canvas));
    const D = 256 * s.cam.scale;
    let worst = 0;
    let n = 0;
    for (const [img, x, y] of calls) {
      if (!chunks.has(img)) continue;
      n++;
      // where the world grid puts a chunk corner: a whole number of chunks from the origin
      const gx = (x + s.cam.ox) / D;
      const gy = (y + s.cam.oy) / D;
      worst = Math.max(worst, Math.abs(gx - Math.round(gx)) * D, Math.abs(gy - Math.round(gy)) * D);
    }
    return { chunks: n, worstPx: +worst.toFixed(3), scale: s.cam.scale, x: Math.round(s.birds[0].x / 32) };
  });
  t.check(`tiles sit on the world grid at the far end of the level (off by ${grid.worstPx} px)`, grid.chunks > 4 && grid.worstPx < 0.01, grid);
}

// ---- a GPU reset blanks every canvas: the level is painted again, ground and sky
{
  await standAt(10);
  await sleep(800);
  const reset = await page.evaluate(async () => {
    const s = window.__fbSession;
    const r = window.__fb.app.renderer;
    const ctx = r.ctx;
    const b = s.birds[0];
    const after = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
    await after();
    const px = (X, Y) => [...ctx.getImageData(Math.round(X), Math.round(Y), 1, 1).data.slice(0, 3)];
    // a pixel of ground just under the bird's feet, one of sky at the top left
    const look = () => ({ ground: px(b.x * s.cam.scale - s.cam.ox, (b.y + 22) * s.cam.scale - s.cam.oy), sky: px(2, 2) });
    const before = look();
    for (const c of s.tiles.chunks.values()) c.canvas.width = c.canvas.width;
    for (const l of s.backdrop.layers) l.canvas.width = l.canvas.width;
    if (s.backdrop.sky) s.backdrop.sky.width = s.backdrop.sky.width;
    r.canvas.dispatchEvent(new Event('contextlost'));
    await after();
    r.canvas.dispatchEvent(new Event('contextrestored'));
    await after();
    await after();
    return { before, after: look() };
  });
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 24);
  t.check('after a GPU reset the ground and the sky are painted again', near(reset.before.ground, reset.after.ground) && near(reset.before.sky, reset.after.sky), reset);
}

// ---- resizing (a phone turning, a window edge dragged) never shows a black frame
{
  await page.evaluate(() => {
    const r = window.__fb.app.renderer;
    window.__flash = { black: 0, samples: 0, on: true };
    // look at what each frame left on the canvas, after it was drawn and before the next one
    const loop = () => requestAnimationFrame(() => setTimeout(() => {
      if (!window.__flash.on) return;
      const d = r.ctx.getImageData(r.width >> 1, 2, 1, 1).data;
      window.__flash.samples++;
      if (d[0] + d[1] + d[2] === 0) window.__flash.black++;
      loop();
    }, 0));
    loop();
  });
  for (const [w, h] of [[1100, 650], [1280, 720], [900, 560], [1280, 720], [1000, 700], [1280, 720]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(200);
  }
  // Those six resizes take 1.2 s, which is thirty-odd frames on a screen and eleven on a software
  // renderer with no GPU behind it. Keep watching until there is enough to go on, rather than
  // deciding on eleven — the resizing is over, so this is only sampling a settled canvas.
  let flash = await page.evaluate(() => window.__flash);
  for (let waited = 0; flash.samples <= 30 && waited < 6000; waited += 500) {
    await sleep(500);
    flash = await page.evaluate(() => window.__flash);
  }
  flash = await page.evaluate(() => { window.__flash.on = false; return window.__flash; });
  if (flash.black > 0) {
    // conclusive however few frames it took: a black frame is a black frame
    t.check(`resizing never shows a black frame (${flash.black} of ${flash.samples})`, false, flash);
  } else if (flash.samples > 30) {
    t.check(`resizing never shows a black frame (0 of ${flash.samples})`, true, flash);
  } else {
    t.skip('resizing never shows a black frame', `only ${flash.samples} frames in 7 s — too slow to tell, and none of them were black`);
  }
}

// ---- a big screen (1600 rows): scrolling through the level keeps the tile cache within its memory
{
  await page.setViewport({ width: 2560, height: 1600, deviceScaleFactor: 1 });
  await sleep(500);
  let most = 0;
  for (let tx = 8; tx <= 140; tx += 6) {
    await standAt(tx);
    await frames(page, 4);
    const mb = await page.evaluate(() => [...window.__fbSession.tiles.chunks.values()].reduce((n, c) => n + c.canvas.width * c.canvas.height * 4, 0) / 2 ** 20);
    most = Math.max(most, mb);
  }
  t.check(`the tile cache stays within its memory on a big screen (${most.toFixed(0)} MB at most)`, most <= 80, most);
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await sleep(300);
}

// ---- the window moves to a screen with twice the pixel density (same size): the canvas follows
{
  const cdp = await page.createCDPSession();
  const ratio = () => page.evaluate(() => window.__fb.app.renderer.pixelRatio);
  const r1 = await ratio();
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false });
  // A density change fires no resize event — nothing moved — so the renderer notices it in flush(),
  // which runs once a frame. Waiting 400 ms assumed that was several frames; on a machine drawing
  // three a second it is barely one. Wait for the change instead. If the renderer never follows it,
  // this still fails, and `devDpr` below says whether the machine ever made the change at all.
  await waitFor(async () => (await ratio()) === 2, 3000, 'the canvas to follow the pixel density').catch(() => undefined);
  const r2 = await ratio();
  // What the PAGE thinks its ratio is, read while the override is still on — afterwards it is back
  // to 1 and says nothing. If r2 is still 1 the question is whether the renderer ignored the change
  // or the machine never made it, and those want opposite answers: one is a bug, the other is a
  // machine that cannot be asked. This is the only moment the difference is visible.
  const devDpr = await page.evaluate(() => window.devicePixelRatio);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await waitFor(async () => (await ratio()) === 1, 3000, 'the canvas to follow it back').catch(() => undefined);
  const r3 = await ratio();
  if (r2 !== 2 && devDpr < 1.5) {
    t.skip('a change of pixel density alone is followed', `this machine kept devicePixelRatio at ${devDpr} when asked for 2, so there was no change to follow`);
  } else {
    t.check('a change of pixel density alone is followed', r1 === 1 && r2 === 2 && r3 === 1, { r1, r2, r3, devDpr });
  }
}

const errs = [...page.errors];
await browser.close();
t.finish('render', errs);
