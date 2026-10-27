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
// a first tap makes touch the active device: the overlay appears
await touch('touchStart', [[422, 200, 9]]);
await touch('touchEnd', []);
const shown = await waitFor(() => page.evaluate(() => document.querySelector('.tc')?.style.display !== 'none'), 4000, 'overlay');
t.check('the touch overlay appears on a phone', shown);
const jx = 130, jy = 300;
// stick right: walk
const b0 = await bird();
await touch('touchStart', [[jx, jy, 1]]);
await touch('touchMove', [[jx + 50, jy, 1]]);
await sleep(500);
const b1 = await bird();
t.check('the stick walks the bird', b1.x > b0.x + 30, { from: b0.x, to: b1.x });
// JUMP while walking (second finger)
const jump = await center('.tc-jump');
await touch('touchStart', [[jx + 50, jy, 1], [jump.x, jump.y, 2]]);
const up = await waitFor(async () => { const b = await bird(); return b.vy < -200 ? b : null; }, 2000, 'jump');
await touch('touchEnd', [[jx + 50, jy, 1]]);
t.check('JUMP jumps while the other thumb steers', !!up, up);
await touch('touchEnd', []);
await sleep(700);
// HOLD anchors (while grounded)
const hold = await center('.tc-anchor');
await touch('touchStart', [[hold.x, hold.y, 3]]);
const anchored = await waitFor(async () => (await bird()).anchored, 2000, 'anchor');
await touch('touchEnd', []);
await sleep(200);
const released = !(await bird()).anchored;
t.check('HOLD plants your feet, letting go releases', anchored && released);
// ♥
const heart = await center('.tc-heart');
await touch('touchStart', [[heart.x, heart.y, 4]]);
await touch('touchEnd', []);
const em = await waitFor(async () => (await bird()).emote === 'heart', 2000, 'heart');
t.check('♥ sends a heart', em);
// TUG: put the partner a few tiles away first (seat 1 takes every input, so the keyboard would move both)
await page.evaluate(() => { const s = window.__fbSession; const a = s.birds[0]; s.birds[1].place({ x: a.x + 150, y: a.y - 2 }); s.tether.reset(s.birds[0], s.birds[1]); });
await sleep(400);
const tug = await center('.tc-tug');
await touch('touchStart', [[tug.x, tug.y, 5]]);
await touch('touchEnd', []);
const twang = await waitFor(() => page.evaluate(() => window.__fbSession.tether.twang > 0.2 || window.__fbSession.birds[1].tuggedT > 0), 2000, 'tug');
t.check('TUG yanks the string', twang);
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
// portrait: ask to rotate
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: false });
const rotate = await waitFor(() => page.evaluate(() => getComputedStyle(document.querySelector('.tc-rotate')).display !== 'none'), 3000, 'rotate prompt');
const lockHint = await page.evaluate(() => document.querySelector('.tc-rotate').textContent);
t.check('portrait asks to turn the phone (and mentions rotation lock)', rotate && /rotation lock/.test(lockHint), lockHint);
await browser.close();
t.finish('touch', page.errors);
