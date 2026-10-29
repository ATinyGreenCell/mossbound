// Two players on one screen with two (emulated) Xbox controllers: claim seats, pick a level, both
// birds move independently, pause/resume, tug, controllers dropping out and coming back (in each
// other's slots, too), level clear.
import { frames, gameTime, launch, open, padAxis, padPress, reporter, screenName, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const page = await open(browser, { pads: 2 });
const t = reporter();
const A = 0, B = 1, Y = 3, START = 9, DOWN = 13;

await waitFor(async () => (await screenName(page)) === 'TitleScreen', 10000, 'title');
await sleep(400);
// title: down to PLAY ON ONE SCREEN, A
await padPress(page, 0, DOWN);
await padPress(page, 0, A);
await waitFor(async () => (await screenName(page)) === 'LocalScreen', 5000, 'local lobby');
t.check('pad navigates the title to the local lobby', true);
// a laptop with a pad plugged in still seats a pad and half a keyboard (on an Xbox, which has no
// keyboard, only controllers can hold a seat — see xbox.mjs)
const devs = await page.evaluate(() => window.__fb.app.input.devices().map((d) => d.id));
t.check('a pad and both keyboard halves can all take a seat on a laptop', devs.includes('pad0') && devs.includes('keysL') && devs.includes('keysR'), devs);
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
// 0.2 s of the game's own clock, not twelve frames: a frame is 16 ms of game time on one machine
// and 100 ms on another, and at the latter the jump has peaked and landed again by frame twelve
await gameTime(page, 0.2);
const mid = await page.evaluate(() => window.__fbSession.birds.map((b) => ({ x: b.x, y: b.y, vy: b.vy })));
await page.evaluate(() => { window.__pads[1].buttons[0] = { pressed: false, touched: false, value: 0 }; });
await padAxis(page, 0, 0, 0);
await gameTime(page, 0.6);
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
await gameTime(page, 1.3);
await padAxis(page, 1, 0, 0);
await gameTime(page, 0.3);
const before = await page.evaluate(() => ({ x0: window.__fbSession.birds[0].x, len: window.__fbSession.tether.length }));
await padPress(page, 1, B);
await gameTime(page, 0.7);
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
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mossbound.save.v3') ?? '{}'));
t.check('the clear is saved', saved.unlocked >= 1 && saved.levels?.garden?.clears === 1, { unlocked: saved.unlocked });
await page.screenshot({ path: `${process.env.E2E_OUT ?? './.out'}/local-level2.png` });

// a sign names the buttons of the player standing at it, not of whoever touched a device last
const hint = () => page.evaluate(() => document.querySelector('.hud-hint:not(.hidden)')?.textContent ?? null);
const atSign = (k) => page.evaluate((k) => { const s = window.__fbSession; const g = s.L.signs[0]; s.birds[k].place({ x: g.x, y: g.y }); s.birds[1 - k].place({ x: g.x + (k ? -5 : 5) * 32, y: g.y }); s.tether.reset(s.birds[0], s.birds[1]); }, k);
await page.evaluate(() => { const f = window.__fb.flow; f.seats = ['keysL', 'keysR']; f.seatGen = [0, 0]; f.playLevel(0); });
await waitFor(() => page.evaluate(() => window.__fbSession?.opts.seats[1] === 'keysR' && window.__fbSession.L.index === 0), 5000, 'two on one keyboard');
await sleep(500);
await atSign(1);
await page.keyboard.press('ArrowUp'); // the right-hand player touches their own keys
await frames(page, 6);
const hintR = await hint();
t.check('a sign names the right-hand keyboard player their own keys', !!hintR && /← \/ →/.test(hintR) && !/SPACE|A \/ D/.test(hintR), hintR);
// pad + keyboard: the pad player's sign keeps naming pad buttons when the other player types
await page.evaluate(() => { const f = window.__fb.flow; f.seats = ['pad0', 'keysR']; f.seatGen = [window.__fb.app.input.device('pad0').generation, 0]; f.playLevel(0); });
await waitFor(() => page.evaluate(() => window.__fbSession?.opts.seats[0] === 'pad0'), 5000, 'pad and keyboard');
await sleep(500);
await atSign(0);
await padPress(page, 0, Y);
await frames(page, 6);
const hintPad = await hint();
await page.keyboard.press('ArrowRight'); // the other player walks
await frames(page, 6);
const hintStill = await hint();
t.check("a pad player's sign keeps naming pad buttons when the other player uses the keyboard", !!hintPad && /Ⓐ/.test(hintPad) && hintStill === hintPad, { hintPad, hintStill });

// Both Shifts hold on for one player on the whole keyboard (what the signs and the controls card
// promise), while right Shift stays the right-hand player's dash when two share the keyboard.
await page.evaluate(() => {
  const inp = window.__fb.app.input;
  const orig = inp.update.bind(inp);
  window.__seen = {};
  inp.update = () => {
    orig();
    const all = inp.controls;
    const r = inp.device('keysR').controls;
    window.__seen.anchor ||= all.anchor;
    window.__seen.dash ||= all.dashPressed;
    window.__seen.rightDash ||= r.dashPressed;
  };
});
const shift = async (code) => {
  await page.evaluate(() => { window.__seen = {}; });
  await page.keyboard.down(code);
  await frames(page, 6);
  await page.keyboard.up(code);
  await frames(page, 3);
  return page.evaluate(() => ({ anchor: !!window.__seen.anchor, dash: !!window.__seen.dash, rightDash: !!window.__seen.rightDash }));
};
const shiftL = await shift('ShiftLeft');
const shiftR = await shift('ShiftRight');
t.check('on the whole keyboard either Shift holds on, as the hints say', shiftL.anchor && !shiftL.dash && shiftR.anchor && !shiftR.dash, { shiftL, shiftR });
t.check("two on one keyboard: right Shift is still the right-hand player's dash", shiftR.rightDash, shiftR);

await browser.close();
t.finish('local', page.errors);
