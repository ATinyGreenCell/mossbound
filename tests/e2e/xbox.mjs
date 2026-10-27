// Two people on one Xbox, in Edge, each with a controller. Edge's quirks are emulated:
// - the browser shows no controller to the page until one is pressed;
// - a click is a controller's Ⓐ in Edge's "browsing controls", and Ⓑ there is "back a page";
// - controller buttons can also arrive as key presses, with no key code or as ENTER;
// - Edge may keep ☰ for its own menu;
// - focus can be lost to full screen or the guide, and then no controller reaches the page.
import { XBOX_UA, frames, launch, open, padAxis, padPress, reporter, screenName, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const page = await open(browser, { ua: XBOX_UA, pads: 2, hidePads: true });
const t = reporter();
const A = 0, Y = 3, VIEW = 8, DOWN = 13;
const press = (pad, b, on) => page.evaluate((p, b, on) => { window.__pads[p].buttons[b] = { pressed: on, touched: on, value: on ? 1 : 0 }; }, pad, b, on);

await waitFor(async () => (await screenName(page)) === 'TitleScreen', 10000, 'title');
await sleep(500);
const hint = await page.evaluate(() => document.querySelector('.title-screen .xbox-hint')?.textContent ?? '');
t.check('the title says how to hand the controllers to the game', /Use game controls/.test(hint), hint);
t.check('no "press the Xbox button" note while the page has focus', !(await page.evaluate(() => !!document.querySelector('.xbox-refocus'))));

// a click on nothing (Ⓐ in browsing controls), then Ⓑ twice ("back a page"): still here
const logo = await page.evaluate(() => { const r = document.querySelector('.logo-wrap').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.click(logo.x, logo.y);
const href = await page.evaluate(() => location.href);
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => history.back()).catch(() => undefined);
  await sleep(500);
}
const stay = await page.evaluate(() => ({ href: location.href, screen: window.__fb?.app?.current?.constructor?.name ?? null })).catch((e) => ({ error: String(e) }));
t.check('Ⓑ in browsing controls ("back a page") never leaves the game', stay.href === href && stay.screen === 'TitleScreen', stay);

// the press that shows the controllers to the page is the player's first move: ↓ to PLAY ON ONE SCREEN
const sel0 = await page.evaluate(() => window.__fbTitle.list.sel);
await page.evaluate((b) => { window.__pads[0].buttons[b] = { pressed: true, touched: true, value: 1 }; window.__padsHidden = false; }, DOWN);
await frames(page, 3);
await press(0, DOWN, false);
await frames(page, 2);
const sel1 = await page.evaluate(() => window.__fbTitle.list.sel);
t.check('the press that shows a controller to the page counts', sel0 === 0 && sel1 === 1, { sel0, sel1 });

// a controller button that also arrives as a key press with no key code: hints keep naming Ⓐ Ⓑ…
await padPress(page, 0, Y);
await page.evaluate(() => { for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { key: 'Unidentified', code: '' })); });
await frames(page, 2);
const dev = await page.evaluate(() => window.__fb.app.input.lastDevice);
t.check('a controller button that also arrives as a nameless key press keeps the hints on the controller', dev === 'pad', dev);

// into the one-screen lobby (straight there, whatever the checks above said)
await page.evaluate(() => { window.__fbTitle.list.sel = 1; window.__fbTitle.list.highlight(); });
await padPress(page, 0, A);
await waitFor(async () => (await screenName(page)) === 'LocalScreen', 5000, 'local lobby');
await sleep(500);
const lobbyHint = await page.evaluate(() => document.querySelector('.local-screen .xbox-hint')?.textContent ?? '');
t.check('the one-screen lobby says how to hand the controllers to the game', /Use game controls/.test(lobbyHint), lobbyHint);

// a click on the lobby is Ⓐ in browsing controls, which never reaches the game: nobody sits down,
// and the hint shows what to do
const title = await page.evaluate(() => { const r = document.querySelector('.local-screen .panel-title').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.click(title.x, title.y);
await frames(page, 3);
const clicked = await page.evaluate(() => ({ seats: window.__fb.app.current.seats, nudged: !!document.querySelector('.local-screen .xbox-hint.nudge') }));
t.check('a click (Ⓐ in browsing controls) seats nobody and points at the hint', clicked.seats.every((s) => s === null) && clicked.nudged, clicked);

// player 1 presses Ⓐ on the second controller, and the same press also arrives as ENTER: the
// controller takes the seat, not half the keyboard
await page.evaluate(() => {
  window.__pads[1].buttons[0] = { pressed: true, touched: true, value: 1 };
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' }));
});
await frames(page, 2);
await page.evaluate(() => {
  window.__pads[1].buttons[0] = { pressed: false, touched: false, value: 0 };
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter' }));
});
await frames(page, 2);
const first = await page.evaluate(() => [...window.__fb.app.current.seats]);
t.check('a controller press that also arrives as a key press seats the controller', first[0] === 'pad1' && first[1] === null, first);

// player 2 on the first controller
await padPress(page, 0, A);
await waitFor(async () => (await screenName(page)) === 'LevelSelect', 5000, 'level select');
const seats = await page.evaluate(() => window.__fb.flow.seats);
t.check('each controller takes a sprout', seats[0] === 'pad1' && seats[1] === 'pad0', seats);
await sleep(500);
await padPress(page, 0, A);
await waitFor(async () => (await screenName(page)) === 'Session', 5000, 'session');
await sleep(800);

// player 1 (second controller) walks right while player 2 (first controller) jumps
const s0 = await page.evaluate(() => window.__fbSession.birds.map((b) => ({ x: b.x, y: b.y })));
await padAxis(page, 1, 1, 0);
await press(0, A, true);
await frames(page, 12);
const mid = await page.evaluate(() => window.__fbSession.birds.map((b) => ({ x: b.x, y: b.y })));
await press(0, A, false);
await padAxis(page, 1, 0, 0);
await sleep(600);
const s1 = await page.evaluate(() => window.__fbSession.birds.map((b) => ({ x: b.x, y: b.y })));
t.check('each controller moves its own sprout', s1[0].x > s0[0].x + 20 && mid[1].y < s0[1].y - 10 && Math.abs(s1[1].x - s0[1].x) < 30, { s0, mid, s1 });

// ⧉ View opens the menu (Edge may keep ☰ for itself), and on Xbox the menu says how to get the
// controllers back if they stop
await padPress(page, 0, VIEW);
const viewPaused = await waitFor(() => page.evaluate(() => window.__fbSession.paused && !!document.querySelector('.overlay')), 2000, 'pause on View').catch(() => false);
const note = await page.evaluate(() => document.querySelector('.overlay .xbox-note')?.textContent ?? '');
t.check('⧉ View opens the menu', viewPaused);
t.check('the menu says how to get the controllers back', /Xbox button twice/.test(note), note);
await sleep(400);
await padPress(page, 1, A);
await waitFor(() => page.evaluate(() => !window.__fbSession.paused && !document.querySelector('.overlay')), 3000, 'resume');

// focus lost (full screen, the guide): the level pauses, and a note says to press the Xbox button
// twice. It goes once the page has focus again.
await page.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); });
const lostPaused = await waitFor(() => page.evaluate(() => window.__fbSession.paused), 2000, 'pause on blur').catch(() => false);
const refocus = await waitFor(() => page.evaluate(() => document.querySelector('.xbox-refocus')?.textContent ?? ''), 4000, 'refocus note').catch(() => '');
await page.evaluate(() => { delete document.hasFocus; window.dispatchEvent(new Event('focus')); });
const noteGone = await waitFor(() => page.evaluate(() => !document.querySelector('.xbox-refocus')), 2000, 'note gone').catch(() => false);
t.check('focus lost: the level pauses and says to press the Xbox button twice; the note goes with focus back', lostPaused && /Xbox button twice/.test(refocus) && noteGone, { lostPaused, refocus, noteGone });
await sleep(300);
await padPress(page, 0, A);
const resumed = await waitFor(() => page.evaluate(() => !window.__fbSession.paused && !document.querySelector('.overlay')), 3000, 'resume').catch(() => false);
t.check('Ⓐ resumes', resumed);

await page.screenshot({ path: `${process.env.E2E_OUT ?? './.out'}/xbox.png` });
await browser.close();
t.finish('xbox', page.errors);
