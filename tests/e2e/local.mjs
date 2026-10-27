// Two players on one screen with two (emulated) Xbox controllers: claim seats, pick a level, both
// birds move independently, pause/resume, tug, controllers dropping out and coming back (in each
// other's slots, too), level clear.
import { frames, launch, open, padAxis, padPress, reporter, screenName, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const page = await open(browser, { pads: 2 });
const t = reporter();
const A = 0, B = 1, START = 9, DOWN = 13;

await waitFor(async () => (await screenName(page)) === 'TitleScreen', 10000, 'title');
await sleep(400);
// title: down to PLAY ON ONE SCREEN, A
await padPress(page, 0, DOWN);
await padPress(page, 0, A);
await waitFor(async () => (await screenName(page)) === 'LocalScreen', 5000, 'local lobby');
t.check('pad navigates the title to the local lobby', true);
await sleep(400);
// one press seen on both pads in the same frame (some drivers show one controller twice) seats one player
const both = (on) => page.evaluate((on, b) => { for (const p of window.__pads) p.buttons[b] = { pressed: on, touched: on, value: on ? 1 : 0 }; }, on, A);
await both(true);
await frames(page, 2);
await both(false);
await frames(page, 3);
const one = await page.evaluate(() => ({ seats: window.__fb.app.current.seats?.filter(Boolean).length, screen: window.__fb.app.current.constructor.name }));
t.check('one press seen on two pads at once seats one player', one.seats === 1 && one.screen === 'LocalScreen', one);
await padPress(page, 1, A);
await waitFor(async () => (await screenName(page)) === 'LevelSelect', 5000, 'level select');
const seats = await page.evaluate(() => window.__fb.flow.seats);
t.check('each controller claims a seat', seats[0] === 'pad0' && seats[1] === 'pad1', seats);
await sleep(400);
await padPress(page, 0, A);
await waitFor(async () => (await screenName(page)) === 'Session', 5000, 'session');
await sleep(800);
const s0 = await page.evaluate(() => window.__fbSession.birds.map((b) => ({ x: b.x, y: b.y })));
// pad 0 walks right, pad 1 jumps
await padAxis(page, 0, 1, 0);
await page.evaluate(() => { window.__pads[1].buttons[0] = { pressed: true, touched: true, value: 1 }; });
await frames(page, 12);
const mid = await page.evaluate(() => window.__fbSession.birds.map((b) => ({ x: b.x, y: b.y, vy: b.vy })));
await page.evaluate(() => { window.__pads[1].buttons[0] = { pressed: false, touched: false, value: 0 }; });
await padAxis(page, 0, 0, 0);
await sleep(600);
const s1 = await page.evaluate(() => window.__fbSession.birds.map((b) => ({ x: b.x, y: b.y })));
t.check('pad 1 moves bird 1, pad 2 makes bird 2 jump', s1[0].x > s0[0].x + 20 && mid[1].y < s0[1].y - 10 && Math.abs(s1[1].x - s0[1].x) < 30, { s0, mid, s1 });
// pause from either pad, resume with A
await padPress(page, 1, START);
const paused = await waitFor(() => page.evaluate(() => window.__fbSession.paused && !!document.querySelector('.overlay')), 3000, 'pause');
await sleep(400);
await padPress(page, 0, A);
const resumed = await waitFor(() => page.evaluate(() => !window.__fbSession.paused && !document.querySelector('.overlay')), 3000, 'resume');
t.check('START pauses, A resumes', paused && resumed);
// tug: pad 2 walks away to stretch the string, then B yanks bird 1 over
await padAxis(page, 1, 1, 0);
await sleep(1300);
await padAxis(page, 1, 0, 0);
await sleep(300);
const before = await page.evaluate(() => ({ x0: window.__fbSession.birds[0].x, len: window.__fbSession.tether.length }));
await padPress(page, 1, B);
await sleep(700);
const after = await page.evaluate(() => ({ x0: window.__fbSession.birds[0].x, twang: window.__fbSession.tether.twang }));
t.check('B tugs the partner along the string', after.x0 > before.x0 + 32, { before, after });
// a controller drops out: notice. It comes back, and its Ⓐ takes the bird back (a pad that reconnects
// can turn up in another player's slot, so it's never handed back by slot number alone)
const noticeUp = () => page.evaluate(() => !!document.querySelector('.hud-notice:not(.hidden)'));
await page.evaluate(() => { window.__pads[1].connected = false; });
const notice = await waitFor(() => page.evaluate(() => document.querySelector('.hud-notice:not(.hidden)')?.textContent ?? ''), 3000, 'notice');
await page.evaluate(() => { window.__pads[1].connected = true; });
await frames(page, 6);
const waits = await noticeUp();
await padPress(page, 1, A);
const gone = await waitFor(async () => !(await noticeUp()), 3000, 'notice gone');
t.check('a dropped controller is noticed; back, its Ⓐ takes the bird back', /controller/.test(notice) && waits && gone, notice);
// both drop out and come back in each other's slots: player 1 presses Ⓐ first (on slot 2 now), then player 2
await page.evaluate(() => { for (const p of window.__pads) p.connected = false; });
await frames(page, 4);
await page.evaluate(() => { for (const p of window.__pads) p.connected = true; });
await frames(page, 4);
await padPress(page, 1, A);
await padPress(page, 0, A);
await waitFor(async () => !(await noticeUp()), 3000, 'both back');
await sleep(500);
const xs = () => page.evaluate(() => window.__fbSession.birds.map((b) => b.x));
const w0 = await xs();
await padAxis(page, 1, -1, 0);
await frames(page, 20);
await padAxis(page, 1, 0, 0);
await sleep(300);
const w1 = await xs();
const swapped = await page.evaluate(() => window.__fb.flow.seats);
t.check('controllers back in swapped slots go to whoever presses Ⓐ, not by slot', swapped[0] === 'pad1' && swapped[1] === 'pad0' && w1[0] < w0[0] - 20 && Math.abs(w1[1] - w0[1]) < 30, { swapped, w0, w1 });
// clear the level: both birds into the nest
await page.evaluate(() => { const s = window.__fbSession; const n = s.L.nest; s.birds[0].place({ x: n.x - 10, y: n.y - 6 }); s.birds[1].place({ x: n.x + 10, y: n.y - 6 }); s.tether.reset(s.birds[0], s.birds[1]); });
const cleared = await waitFor(() => page.evaluate(() => !!document.querySelector('.overlay.clear [data-act="next"]')), 8000, 'clear overlay');
await sleep(500);
await padPress(page, 0, A);
const next = await waitFor(() => page.evaluate(() => window.__fbSession?.L?.index === 1), 5000, 'level 2');
t.check('both in the nest clears the level; NEXT LEVEL', cleared && next);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mossbound.save.v2') ?? '{}'));
t.check('the clear is saved', saved.unlocked >= 1 && saved.levels?.garden?.clears === 1, { unlocked: saved.unlocked });
await page.screenshot({ path: `${process.env.E2E_OUT ?? './.out'}/local-level2.png` });
await browser.close();
t.finish('local', page.errors);
