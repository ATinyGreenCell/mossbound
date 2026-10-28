// Controllers: the awkward ones. One physical pad shown to the page twice (Steam Input's virtual pad
// beside the real one, a doubled Linux driver) reports a press a frame apart on each copy and must
// still count as one player; a gentle wobbly push on a stick moves a menu once, not three times; a
// pad whose first move is the stick keeps that stick; and a stick held when the page loses focus
// doesn't walk the sprout on by itself.
import { frames, launch, open, padPress, reporter, screenName, waitFor } from './harness.mjs';

const browser = await launch();
const t = reporter();
const A = 0;
/** each part gets its own page (a pad's first appearance is part of what's tested): keep their errors */
const errors = [];
const done = async (page) => {
  errors.push(...page.errors);
  await page.close();
};
const btn = (page, pad, b, on) => page.evaluate((p, b, on) => { window.__pads[p].buttons[b] = { pressed: on, touched: on, value: on ? 1 : 0 }; }, pad, b, on);
const notice = (page) => page.evaluate(() => document.querySelector('.hud-notice:not(.hidden)')?.textContent ?? null);
/** Start a local level straight away on the given seats (skips the lobby, which is the UI's own test). */
const localLevel = async (page, seats, gen, level = 0) => {
  await page.evaluate((seats, gen, level) => { const f = window.__fb.flow; f.mode = 'local'; f.seats = seats; f.seatGen = gen; f.playLevel(level); }, seats, gen, level);
  await waitFor(async () => (await screenName(page)) === 'Session', 5000, 'session');
};

// ---------------------------------------------------------------- one controller, two OS devices
// Seats: pad0 (player 1, twinned with pad1) and pad2 (player 2). Player 2's pad dies, so their sprout
// is up for grabs — and player 1's next jump arrives on pad0 in one frame and on its twin pad1 in the
// next. The twin must not take player 2's sprout.
{
  const page = await open(browser, { pads: 3 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 10000, 'title');
  await localLevel(page, ['pad0', 'pad2'], [1, 1]);
  await frames(page, 30);
  await page.evaluate(() => { window.__pads[2].connected = false; });
  await waitFor(() => notice(page), 3000, 'notice');
  // player 1 jumps: the real pad reports it now, its copy one frame later
  await btn(page, 0, A, true);
  await frames(page, 1);
  await btn(page, 1, A, true);
  await frames(page, 3);
  await btn(page, 0, A, false);
  await btn(page, 1, A, false);
  await frames(page, 3);
  const stolen = await page.evaluate(() => [...window.__fbSession.opts.seats]);
  const still = await notice(page);
  t.check("a twinned controller's second copy doesn't take the other player's sprout", stolen[1] === 'pad2' && !!still, { seats: stolen, notice: still });
  // and the guard isn't too tight: player 2's own pad, back, still takes its sprout
  await page.evaluate(() => { window.__pads[2].connected = true; });
  await frames(page, 4);
  await padPress(page, 2, A);
  await frames(page, 4);
  const gone = await notice(page);
  const seats = await page.evaluate(() => [...window.__fbSession.opts.seats]);
  t.check('the reconnected controller still takes its own sprout back', gone === null && seats[1] === 'pad2', { notice: gone, seats });
  await done(page);
}

// ---------------------------------------------------------------- the Ⓐ that takes a sprout back
// "reconnect it and press Ⓐ to keep playing" hands the sprout back — it must not also make it hop:
// on a ledge or under a hazard that hop costs a life.
{
  const page = await open(browser, { pads: 2 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 10000, 'title');
  await localLevel(page, ['pad0', 'pad1'], [1, 1]);
  await frames(page, 40);
  await page.evaluate(() => { window.__pads[1].connected = false; });
  await waitFor(() => notice(page), 3000, 'notice');
  await page.evaluate(() => { window.__pads[1].connected = true; });
  await frames(page, 4);
  // watch sprout 2's own effects and its highest point from here on
  const y0 = await page.evaluate(() => {
    const s = window.__fbSession;
    window.__fx = [];
    window.__minY = s.birds[1].y;
    const orig = s.onFx.bind(s);
    s.onFx = (b, e, ...rest) => { if (b.idx === 1) window.__fx.push(e.k); return orig(b, e, ...rest); };
    const tick = () => { window.__minY = Math.min(window.__minY, s.birds[1].y); if (window.__fb.app.current === s) requestAnimationFrame(tick); };
    tick();
    return s.birds[1].y;
  });
  await padPress(page, 1, A);
  await frames(page, 40);
  const r = await page.evaluate(() => ({ fx: window.__fx, minY: window.__minY, seats: [...window.__fbSession.opts.seats] }));
  const rise = +(y0 - r.minY).toFixed(1);
  t.check('the Ⓐ that takes a sprout back does not also make it jump', !r.fx.includes('jump') && !r.fx.includes('hop') && rise < 8 && (await notice(page)) === null, { rise, fx: r.fx, seats: r.seats });
  await done(page);
}

// ---------------------------------------------------------------- a stick that wobbles on the way
// A gentle push sits near the menu threshold and trembles there (a soft thumb, a worn stick). Every
// crossing used to be another move, so one push walked the highlight three items down.
{
  const page = await open(browser, { pads: 1 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 10000, 'title');
  // count the menu edges this pad reports, frame by frame, whatever screen is up
  const count = async (values) => {
    await page.evaluate(() => {
      const inp = window.__fb.app.input;
      const dev = inp.device('pad0');
      window.__moves = { up: 0, down: 0 };
      const orig = window.__origUpdate ?? inp.update.bind(inp);
      window.__origUpdate = orig;
      inp.update = () => { orig(); if (dev.menu.down) window.__moves.down++; if (dev.menu.up) window.__moves.up++; };
    });
    for (const y of values) {
      await page.evaluate((y) => { window.__pads[0].axes[1] = y; }, y);
      await frames(page, 2);
    }
    return page.evaluate(() => window.__moves);
  };
  const wobble = await count([0.3, 0.61, 0.59, 0.62, 0.59, 0.61, 0.4, 0]);
  t.check('one wobbly push down the stick moves a menu once', wobble.down === 1 && wobble.up === 0, wobble);
  // and two real pushes still move it twice: the latch re-arms when the stick comes back
  const twice = await count([1, 0, 1, 0]);
  t.check('two pushes still move a menu twice', twice.down === 2 && twice.up === 0, twice);
  await done(page);
}

// ---------------------------------------------------------------- a pad Chrome doesn't map
// Non-standard pads (generic USB, some Bluetooth pads on Linux) can report an analog trigger as an
// axis resting at a rail, which would walk a sprout off on its own — so a resting axis is masked. But
// Chromium also reveals a pad on an axis pushed past 0.5, so a player whose first move is the stick
// used to lose that stick for good.
{
  const page = await open(browser, { pads: 1, hidePads: true });
  await page.evaluate(() => { window.__pads[0].mapping = ''; window.__pads[0].id = 'Generic USB Joystick (Vendor: 0079 Product: 0006)'; });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 10000, 'title');
  const stick = () => page.evaluate(() => { const d = window.__fb.app.input.device('pad0'); return { moveY: +d.controls.moveY.toFixed(2), masked: [...d.deadAxes] }; });
  // the player's first move is to push the stick — which is also what shows the pad to the page
  await page.evaluate(() => { window.__pads[0].axes[1] = 0.95; window.__padsHidden = false; });
  await frames(page, 4);
  const first = await stick();
  t.check('a pad whose first move is the stick can use that stick', first.moveY < -0.5, first);
  await done(page);
}
{
  const page = await open(browser, { pads: 1, hidePads: true });
  await page.evaluate(() => { window.__pads[0].mapping = ''; window.__pads[0].id = 'Generic USB Joystick (Vendor: 0079 Product: 0006)'; window.__pads[0].axes[1] = -1; });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 10000, 'title');
  const stick = () => page.evaluate(() => { const d = window.__fb.app.input.device('pad0'); return { moveY: +d.controls.moveY.toFixed(2), masked: [...d.deadAxes] }; });
  await page.evaluate(() => { window.__padsHidden = false; });
  await frames(page, 4);
  const resting = await stick();
  t.check('an axis resting at its rail (a trigger) never walks a sprout', resting.moveY === 0 && resting.masked[1] === true, resting);
  // a stick comes back to centre, a resting trigger never does: once it does, it counts again
  await page.evaluate(() => { window.__pads[0].axes[1] = 0; });
  await frames(page, 3);
  await page.evaluate(() => { window.__pads[0].axes[1] = 0.9; });
  await frames(page, 3);
  const freed = await stick();
  t.check('an axis that comes back to centre was a stick after all, and works', freed.moveY < -0.5 && freed.masked[1] === false, freed);
  await done(page);
}

// ---------------------------------------------------------------- focus taken with the stick held
// On an Xbox the guide (or Edge going full screen) can take focus away mid-level, and an online level
// doesn't pause for it — the partner is still playing. If the browser keeps serving the last pad
// reading to a page without focus, a held stick would walk the sprout on by itself.
{
  const page = await open(browser, { pads: 1 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 10000, 'title');
  const dev = () => page.evaluate(() => { const d = window.__fb.app.input.device('pad0'); return { moveX: +d.controls.moveX.toFixed(2), jump: d.controls.jump }; });
  // walking right with Ⓐ held when focus goes away
  await page.evaluate(() => { window.__pads[0].axes[0] = 1; window.__pads[0].buttons[0] = { pressed: true, touched: true, value: 1 }; });
  await frames(page, 3);
  const held = await dev();
  // count any fresh jump press from here on: the Ⓐ held through the blur must not press again
  await page.evaluate(() => {
    const inp = window.__fb.app.input;
    const d = inp.device('pad0');
    window.__jp = 0;
    const orig = inp.update.bind(inp);
    inp.update = () => { orig(); if (d.controls.jumpPressed) window.__jp++; };
  });
  await page.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); });
  await frames(page, 5);
  const blurred = await dev();
  t.check('a stick still held when the page loses focus stops walking the sprout', held.moveX > 0.5 && blurred.moveX === 0, { held, blurred });
  // focus back with the stick still held: it stays ignored until it has read near centre once
  await page.evaluate(() => { delete document.hasFocus; window.dispatchEvent(new Event('focus')); });
  await frames(page, 5);
  const back = await dev();
  await page.evaluate(() => { window.__pads[0].axes[0] = 0; });
  await frames(page, 3);
  await page.evaluate(() => { window.__pads[0].axes[0] = 1; });
  await frames(page, 3);
  const pushed = await dev();
  const jp = await page.evaluate(() => window.__jp);
  t.check('it walks again once the stick has come back to centre, and the held Ⓐ never re-presses', back.moveX === 0 && pushed.moveX > 0.5 && jp === 0, { back, pushed, freshJumpPresses: jp });
  await done(page);
}

await browser.close();
t.finish('pads', errors);
