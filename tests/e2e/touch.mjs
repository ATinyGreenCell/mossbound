// Phone controls: real multi-touch (CDP) on a phone held sideways — the floating stick walks and
// climbs, JUMP jumps, HOLD anchors, TUG yanks, ♥ sends a heart, ❚❚ pauses, the controls stay for the
// next level, and portrait asks to rotate.
import { launch, open, reporter, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const page = await open(browser, { viewport: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true } });
const t = reporter();
const cdp = await page.createCDPSession();
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
const center = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel);
const bird = () => page.evaluate(() => { const b = window.__fbSession.birds[0]; return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, g: b.grounded, anchored: b.anchored, emote: b.emote, paused: window.__fbSession.paused }; });

// a local session where seat 1 takes every input (touch included)
await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keys', 'keysR']; f.playLevel(0); });
await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session'), 5000, 'session');
await sleep(600);
const len0 = await page.evaluate(() => history.length);
// a first tap makes touch the active device: the overlay appears
await touch('touchStart', [[422, 200, 9]]);
await touch('touchEnd', []);
const shown = await waitFor(() => page.evaluate(() => document.querySelector('.tc')?.style.display !== 'none'), 4000, 'overlay');
t.check('the touch overlay appears on a phone', shown);
// A phone's system back gesture (Android gesture navigation, an iOS left-edge swipe in a tab with
// history) starts exactly where the left thumb rests on the stick, and a web page can't refuse it.
// One history entry of our own takes the hit instead of the level being left — and goes back on top.
const guard = await page.evaluate(() => ({ len: history.length, fb: history.state?.fb ?? null }));
t.check('the first touch puts a history entry in the way of a back gesture', guard.len === len0 + 1 && guard.fb === 1, { ...guard, len0 });
await page.evaluate(() => history.back());
const rearmed = await waitFor(() => page.evaluate(() => history.state?.fb === 1), 3000, 'guard back on top').catch(() => false);
const afterBack = await page.evaluate(() => ({ screen: window.__fb?.app?.current?.constructor?.name ?? null, href: location.href }));
t.check('a back gesture keeps the level, and the guard goes back on top', !!rearmed && afterBack.screen === 'Session', { rearmed: !!rearmed, ...afterBack });
const jx = 130, jy = 300;
// stick right: walk
const b0 = await bird();
await touch('touchStart', [[jx, jy, 1]]);
await touch('touchMove', [[jx + 50, jy, 1]]);
// (waited for, not slept on: half a second of wall time is one frame, or none, on a runner drawing in
// software — the check flaked on the gate that way with the stick working perfectly)
await waitFor(async () => (await bird()).x > b0.x + 30, 3000, 'the bird walking').catch(() => undefined);
const b1 = await bird();
t.check('the stick walks the bird', b1.x > b0.x + 30, { from: b0.x, to: b1.x });
// JUMP while walking (second finger)
const jump = await center('.tc-jump');
await touch('touchStart', [[jx + 50, jy, 1], [jump.x, jump.y, 2]]);
const up = await waitFor(async () => { const b = await bird(); return b.vy < -200 ? b : null; }, 2000, 'jump');
await touch('touchEnd', [[jx + 50, jy, 1]]);
t.check('JUMP jumps while the other thumb steers', !!up, up);
await touch('touchEnd', []);
// HOLD anchors, and anchoring wants feet on the ground. The jump above takes about six tenths of a
// second of GAME time to come back down, which is six frames where a frame is a tenth of one — so
// sleeping 700 ms of wall time was not that wait at all, and this went on to hold a button while the
// sprout was still in the air. Wait for the ground instead of guessing at how long it takes.
await waitFor(async () => (await bird()).g, 8000, 'back on the ground');
const hold = await center('.tc-anchor');
await touch('touchStart', [[hold.x, hold.y, 3]]);
const anchored = await waitFor(async () => (await bird()).anchored, 2000, 'anchor');
await touch('touchEnd', []);
// and letting go is polled for, not slept through: two hundred milliseconds is less than one frame
// at the same rate, so the release had not been read yet and the feet still looked planted
const released = await waitFor(async () => !(await bird()).anchored, 4000, 'let go').catch(() => false);
t.check('HOLD plants your feet, letting go releases', anchored && released);
// ♥
const heart = await center('.tc-heart');
await touch('touchStart', [[heart.x, heart.y, 4]]);
await touch('touchEnd', []);
const em = await waitFor(async () => (await bird()).emote === 'heart', 2000, 'heart');
t.check('♥ sends a heart', em);
// TUG: put the partner a few tiles away first (seat 1 takes every input, so the keyboard would move both)
await page.evaluate(() => { const s = window.__fbSession; const a = s.birds[0]; s.birds[1].place({ x: a.x + 150, y: a.y - 2 }); s.tether.tie(s.birds[0], s.birds[1]); });
await sleep(400);
const tug = await center('.tc-tug');
await touch('touchStart', [[tug.x, tug.y, 5]]);
await touch('touchEnd', []);
const twang = await waitFor(() => page.evaluate(() => window.__fbSession.tether.twang > 0.2 || window.__fbSession.birds[1].tuggedT > 0), 2000, 'tug');
t.check('TUG yanks the string', twang);
// VINE: beside your partner it ties the vine between you, and being tied is a state that stays put.
// This used to watch the shot cooldown instead, which is three tenths of a second at most and half
// that for a link — one or two frames where a frame is a tenth of a second — and it had to be caught
// between two round trips to the browser. It was the gate's most-retried check for exactly that
// reason. A phone player needs to be able to tie up at all, so that is the better thing to ask.
// (Shooting at a ring is played out in physics.mjs and levels.mjs.)
const vine = await center('.tc-shoot');
await page.evaluate(() => {
  const s = window.__fbSession;
  const a = s.birds[0];
  s.birds[1].place({ x: a.x + 40, y: a.y - 2 }); // within LINK_REACH of each other
  s.tether.untie();
  a.shotCd = 0;
});
await sleep(400);
await touch('touchStart', [[vine.x, vine.y, 9]]);
await touch('touchEnd', []);
const shot = await waitFor(() => page.evaluate(() => window.__fbSession.tether.tied), 2000, 'the vine tied');
t.check('VINE ties the vine to your partner', shot);
// pause ❚❚, then RESUME by tapping it
const pause = await center('.tc-pause');
await touch('touchStart', [[pause.x, pause.y, 6]]);
await touch('touchEnd', []);
const paused = await waitFor(async () => (await bird()).paused, 2000, 'paused');
await sleep(450);
const resume = await waitFor(() => center('.overlay [data-act="resume"]'), 2000, 'resume button');
await touch('touchStart', [[resume.x, resume.y, 7]]);
await touch('touchEnd', []);
const unpaused = await waitFor(async () => !(await bird()).paused, 2000, 'resumed');
t.check('❚❚ pauses and RESUME resumes (by touch)', paused && unpaused);
// straight on to another level (NEXT LEVEL, PLAY AGAIN, the host's pick): the controls come along
await page.evaluate(() => window.__fb.flow.playLevel(1));
await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session' && window.__fbSession?.L.index === 1), 5000, 'level 2');
await sleep(300);
const still = await page.evaluate(() => document.querySelector('.tc')?.style.display !== 'none' && document.body.classList.contains('touch-play'));
t.check('the touch controls are still there in the next level', still);
// the buttons sit inside the screen (safe), the stick zone covers the left
const fit = await page.evaluate(() => [...document.querySelectorAll('.tc-btn, .tc-pause')].every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
t.check('every button is on screen', fit);
await page.screenshot({ path: './.out/touch-phone.png' });
// two fingers on one button (a second thumb, or the same thumb re-landing before the first lifts):
// letting go of the first must not release the button while the other is still on it — mid-glide, or
// mid-swing on HOLD, that drops the sprout
const heldJump = () => page.evaluate(() => window.__fb.app.input.touch.jump);
const jb = await center('.tc-jump');
await touch('touchStart', [[jb.x - 15, jb.y, 11]]);
await sleep(80);
await touch('touchStart', [[jb.x - 15, jb.y, 11], [jb.x + 15, jb.y, 12]]);
await sleep(80);
const bothDown = await heldJump();
await touch('touchEnd', [[jb.x - 15, jb.y, 11]]);
await sleep(80);
const afterFirst = await heldJump();
await touch('touchEnd', []);
await sleep(80);
const afterBoth = await heldJump();
t.check('JUMP stays held while a second finger is still on it, and lets go when both lift', bothDown && afterFirst && !afterBoth, { bothDown, afterFirst, afterBoth });
// portrait: ask to rotate
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: false });
const rotate = await waitFor(() => page.evaluate(() => getComputedStyle(document.querySelector('.tc-rotate')).display !== 'none'), 3000, 'rotate prompt');
const lockHint = await page.evaluate(() => document.querySelector('.tc-rotate').textContent);
t.check('portrait asks to turn the phone (and mentions rotation lock)', rotate && /rotation lock/.test(lockHint), lockHint);

// ---- the menus under a thumb: every control answers a touch anywhere in a 44 px band around it —
// mostly invisible, the controls look the size they did — and a thumb that lands just beside ◀ is on ◀
// (it used to be on the row, which steps the other way). Two phone sizes held sideways.
const errors = [...page.errors];
for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 375 }]) {
  const p = await open(browser, { viewport: { ...viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true } });
  await waitFor(() => p.evaluate(() => window.__fb.app.current?.constructor.name === 'TitleScreen'), 8000, 'title');
  await sleep(500);
  /** each control matching `sel`: does a touch `d` px out from its centre, in each direction asked, still land on it? */
  const reach = (sel, dirs, d = 21) => p.evaluate((sel, dirs, d) => [...document.querySelectorAll(sel)].filter((el) => el.offsetParent !== null && !el.hidden).map((el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const miss = dirs.map(([dx, dy]) => [cx + dx * d, cy + dy * d]).filter(([x, y]) => { const h = document.elementFromPoint(x, y); return !(h === el || el.contains(h)); });
    return { el: (el.dataset.act ?? el.dataset.dir ?? el.className).toString(), h: Math.round(r.height), miss: miss.length };
  }), sel, dirs, d);
  const UPDOWN = [[0, -1], [0, 1]];
  const title = await reach('.title-screen .menu > .btn', UPDOWN);
  await p.evaluate(() => window.__fbTitle.act('settings'));
  await waitFor(() => p.evaluate(() => !!document.querySelector('.panel.settings')), 3000, 'settings');
  await sleep(400);
  const rows = await reach('.settings .row[data-act]', UPDOWN);
  const less = await reach('.settings .steps [data-dir="-1"]', [[-1, 0], [0, -1], [0, 1]]);
  const more = await reach('.settings .steps [data-dir="1"]', [[1, 0], [0, -1], [0, 1]]);
  const swatches = await reach('.settings .swatch', UPDOWN);
  const back = await reach('.settings [data-act="back"]', UPDOWN);
  // the controls themselves are the size they were (rows ~25 px, small buttons ~26 px)
  const looks = await p.evaluate(() => ({ row: Math.round(document.querySelector('.settings .row').getBoundingClientRect().height), btn: Math.round(document.querySelector('.settings [data-act="back"]').getBoundingClientRect().height) }));
  // a thumb just left of the music row's ◀ turns the music down
  const music = () => p.evaluate(() => JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}').music ?? 0.7);
  const m0 = await music();
  const beside = await p.evaluate(() => { const el = document.querySelector('[data-act="music"] [data-dir="-1"]'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x - 4, y: r.y + r.height / 2 }; });
  await sleep(450);
  await p.touchscreen.tap(beside.x, beside.y);
  await sleep(300);
  const m1 = await music();
  // the level select's SWAP, and the buttons of the pause card
  await p.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keys', 'keysR']; f.levels(); });
  await waitFor(() => p.evaluate(() => document.querySelectorAll('.levels-screen').length === 1 && window.__fb.app.current?.constructor.name === 'LevelSelect'), 5000, 'levels');
  await sleep(300);
  const swap = await reach('.levels-screen [data-act="swap"]', UPDOWN);
  await p.evaluate(() => window.__fb.flow.enterLevel(0));
  await waitFor(() => p.evaluate(() => window.__fb.app.current?.constructor.name === 'Session'), 8000, 'level');
  await sleep(300);
  await p.evaluate(() => window.__fbSession.togglePause());
  await sleep(300);
  const pause = await reach('.overlay [data-act]', UPDOWN);
  const all = { title, rows, less, more, swatches, back, swap, pause };
  const misses = Object.entries(all).flatMap(([k, list]) => list.filter((x) => x.miss).map((x) => `${k}:${x.el}`));
  const counted = Object.values(all).every((list) => list.length > 0);
  t.check(`${viewport.width}×${viewport.height}: every menu control answers a thumb anywhere in a 44 px band around it`, counted && misses.length === 0, { misses, counts: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.length])) });
  t.check(`${viewport.width}×${viewport.height}: …while looking the size it did, and a thumb just beside ◀ turns the music down`, looks.row <= 30 && looks.btn <= 30 && Math.abs(m1 - (m0 - 0.1)) < 1e-9, { looks, music: [m0, m1] });
  errors.push(...p.errors);
  await p.close();
}
await browser.close();
t.finish('touch', errors);
