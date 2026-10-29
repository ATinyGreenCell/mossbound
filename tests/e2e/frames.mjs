// Frame-loop edge cases: a frame of no length, and a position that somehow goes to NaN. Browsers do
// hand out repeated (or backwards) animation timestamps — coarsened timers round them, and a tab
// coming back can repeat one — and dividing by that frame used to turn the vine's solver, both
// sprouts and then the camera into NaN: the screen went blank mid-swing and the pair were dropped to
// the title screen a few frames later. Neither the sprouts nor the view may keep a NaN.
import { launch, open, reporter, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const page = await open(browser);
const t = reporter();

// rAF is stubbed out so the test drives App.frame itself, with the timestamps it wants
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
await sleep(200);

/** Hang one sprout on a taut vine with the other anchored above, then play with a repeated timestamp. */
const swing = await page.evaluate(() => {
  const app = window.__fb.app;
  let now = performance.now();
  const step = (ms) => { now += ms; app.frame(now); };
  const again = () => app.frame(now); // the same timestamp twice: dt = 0
  const f = window.__fb.flow;
  f.mode = 'local';
  f.seats = ['keysL', 'keysR'];
  f.playLevel(0);
  step(16);
  step(16);
  const s = window.__fbSession;
  if (!s) throw new Error('no session');
  const [a, b] = s.birds;
  a.place({ x: 60 * 32 + 16, y: 9 * 32 - 10 });
  b.placeCenter({ x: 66 * 32, y: 9 * 32 + 10 });
  s.tether.tie(a, b);
  const hold = { moveX: 0, moveY: 0, jump: false, jumpPressed: false, anchor: true, tugPressed: false, dashPressed: false, heartPressed: false, heyPressed: false };
  const push = { ...hold, anchor: false, moveX: 1 };
  s.controlsFor = (i) => (i === 0 ? hold : push);
  // 10 s of swinging at 60 fps with one zero-length frame every second
  let nanAt = -1;
  for (let f = 0; f < 600; f++) {
    if (f % 60 === 59) again();
    else step(1000 / 60);
    if (nanAt < 0 && !(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(a.x) && Number.isFinite(s.cam.x))) nanAt = f;
  }
  const after = [];
  for (let k = 0; k < 12; k++) { step(1000 / 60); after.push(app.current?.constructor?.name); }
  return {
    nanAtFrame: nanAt,
    birds: [a.x, a.y, b.x, b.y].map((v) => (Number.isFinite(v) ? Math.round(v) : null)),
    vine: Number.isFinite(s.tether.length) ? Math.round(s.tether.length) : null,
    cam: [s.cam.x, s.cam.y, s.cam.ox, s.cam.oy].map((v) => (Number.isFinite(v) ? Math.round(v) : null)),
    screens: [...new Set(after)],
  };
});
t.check('10 s of swinging with a zero-length frame every second keeps every position finite', swing.nanAtFrame < 0 && swing.birds.every((v) => v !== null) && swing.vine !== null, swing);
t.check('a zero-length frame leaves the pair in the level', swing.screens.length === 1 && swing.screens[0] === 'Session', swing.screens);
t.check('the view survives it', swing.cam.every((v) => v !== null), swing.cam);

// A NaN that arrives some other way must wash out of the camera rather than blanking the screen for good.
const recover = await page.evaluate(() => {
  const app = window.__fb.app;
  let now = performance.now();
  const step = (ms) => { now += ms; app.frame(now); };
  const s = window.__fbSession;
  if (!s) return { gone: 'the level was already lost', during: [null], cam: [null] };
  const [, b] = s.birds;
  b.x = NaN;
  b.y = NaN;
  step(1000 / 60);
  const during = [s.cam.x, s.cam.ox].map((v) => (Number.isFinite(v) ? Math.round(v) : null));
  for (let k = 0; k < 30; k++) step(1000 / 60);
  return { during, cam: [s.cam.x, s.cam.y, s.cam.ox, s.cam.oy].map((v) => (Number.isFinite(v) ? Math.round(v) : null)), screen: app.current?.constructor?.name };
});
t.check('a NaN position never sticks to the view', recover.during.every((v) => v !== null) && recover.cam.every((v) => v !== null), recover);

await browser.close();
t.finish('frames', page.errors);
