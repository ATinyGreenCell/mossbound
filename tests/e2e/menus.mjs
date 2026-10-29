// Menus with every kind of input: keyboard through the title and settings (which persist), a
// controller through the controls card and out of the room-code and name boxes, phone layout, Xbox,
// the level select's CONTINUE, a fresh room code over an old one, and guards against a stray Ⓐ.
import { XBOX_UA, frames, launch, open, padPress, reporter, screenName, sleep, waitFor, canTimePhysics } from './harness.mjs';

const browser = await launch();
const t = reporter();
const key = async (page, k) => { await page.keyboard.press(k); await frames(page, 2); };
const sel = (page) => page.evaluate(() => document.querySelector('.sel')?.textContent?.trim() ?? '');
/**
 * Installs window.__tapWhen(ready, button): presses that fake pad button on the very frame `ready()`
 * first says yes and lets go three frames later — the press a player is already making when a menu
 * arrives under them (a tap in the nest, a tug mid-level). Counted in frames, so a busy machine can't
 * turn it into a press that lands late.
 */
const installTap = (page) => page.evaluate(() => {
  window.__tapWhen = (ready, b = 0) => new Promise((done) => {
    const press = (on) => { window.__pads[0].buttons[b] = { pressed: on, touched: on, value: on ? 1 : 0 }; };
    let held = 0;
    const f = () => {
      if (!held && !ready()) return requestAnimationFrame(f);
      if (++held === 1) press(true);
      else if (held > 3) { press(false); return requestAnimationFrame(() => requestAnimationFrame(done)); }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
});
/**
 * Put the flow in a room as the guest, with a stand-in for the link (window.__link): one browser can
 * then be the online guest with no network at all. __link.closed says whether they left the room.
 */
const guestRoom = (page) => page.evaluate(() => {
  const l = {
    role: 'guest', code: 'K7QX', status: 'connected', detail: '', rtt: 40, via: 'direct', peerId: 'p', peerGen: 1, myId: 'me', closed: false,
    onStatus: null, onCtrl: null, onSnap: null,
    get connected() { return this.status === 'connected'; },
    sharedNow() { return performance.now(); },
    send() {},
    sendSnap() {},
    close() { this.closed = true; this.status = 'lost'; },
  };
  window.__link = l;
  window.__fb.flow.link = l;
  window.__fb.flow.mode = 'online';
});

// ---- keyboard: title → settings → name, color, music → back; it all persists
{
  const page = await open(browser);
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await sleep(450);
  t.check('the title highlights PLAY ONLINE', (await sel(page)) === 'PLAY ONLINE', await sel(page));
  // (PLAY ONLINE · PLAY ON ONE SCREEN · PRACTICE ON YOUR OWN · HOW TO PLAY · SETTINGS)
  for (let i = 0; i < 4; i++) await key(page, 'ArrowDown');
  t.check('arrows walk the menu to its last row', (await sel(page)) === 'SETTINGS', await sel(page));
  await key(page, 'Enter');
  await waitFor(() => page.evaluate(() => !!document.querySelector('.settings .name-input')), 3000, 'settings');
  await page.click('.name-input');
  await page.keyboard.type('Pip');
  await page.keyboard.press('Enter');
  // the first row after the name is the color swatches: right arrow changes color
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}').color ?? 0);
  await sleep(200);
  for (let i = 0; i < 10 && !(await page.evaluate(() => document.querySelector('.sel')?.classList.contains('swatch'))); i++) await key(page, 'ArrowDown');
  await key(page, 'ArrowRight');
  for (let i = 0; i < 10 && !(await page.evaluate(() => document.querySelector('.sel')?.dataset.act === 'music')); i++) await key(page, 'ArrowDown');
  await key(page, 'ArrowLeft');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}'));
  t.check('settings save as you change them', saved.name === 'Pip' && saved.color === (before + 1) % 8 && saved.music === 0.6, saved);
  await key(page, 'Escape');
  await waitFor(() => page.evaluate(() => !!document.querySelector('.title-screen .menu')), 3000, 'back to title');
  // reload: still there
  await page.reload({ waitUntil: 'networkidle0' });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title again');
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('mossbound.settings.v1')).name);
  t.check('settings survive a reload', kept === 'Pip', kept);
  t.check('no errors (keyboard)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- controller: the controls card opens and B closes it; the room-code box can be left with B
{
  const page = await open(browser, { pads: 1 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await sleep(450);
  // (down past PLAY ON ONE SCREEN and PRACTICE ON YOUR OWN)
  await padPress(page, 0, 13);
  await padPress(page, 0, 13);
  await padPress(page, 0, 13);
  await padPress(page, 0, 0); // HOW TO PLAY
  const open1 = await waitFor(() => page.evaluate(() => !!document.querySelector('.controls-panel')), 3000, 'controls card');
  await sleep(300);
  await padPress(page, 0, 1);
  const closed = await waitFor(() => page.evaluate(() => !document.querySelector('.controls-panel')), 3000, 'card closed');
  t.check('Ⓐ opens the controls card, Ⓑ closes it', open1 && closed);
  await padPress(page, 0, 12);
  await padPress(page, 0, 12);
  await padPress(page, 0, 12);
  await padPress(page, 0, 0); // PLAY ONLINE
  await waitFor(async () => (await screenName(page)) === 'OnlineScreen', 4000, 'online screen');
  await page.evaluate(() => window.__fb.app.current.act('join'));
  await waitFor(() => page.evaluate(() => document.activeElement?.classList.contains('code-input')), 3000, 'code box');
  await page.keyboard.type('ab');
  const typed = await page.evaluate(() => document.querySelector('.code-input').value);
  await padPress(page, 0, 1); // one Ⓑ: out of the box and back to the menu
  const out = await waitFor(() => page.evaluate(() => (document.activeElement?.classList.contains('code-input') ? null : document.querySelector('[data-act="host"]') ? 'menu' : 'other')), 3000, 'left the box');
  t.check('typing fills the room code; a controller can leave the box', typed === 'AB' && out === 'menu', { typed, out });
  t.check('no errors (controller)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- phone held sideways: title and level select fit
{
  const page = await open(browser, { viewport: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true } });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await sleep(300);
  const fits = await page.evaluate(() => [...document.querySelectorAll('.title-screen .btn, .logo')].every((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; }));
  t.check('the title fits a phone held sideways', fits);
  await page.evaluate(() => { window.__fb.flow.mode = 'local'; window.__fb.flow.levels(); });
  await waitFor(async () => (await screenName(page)) === 'LevelSelect', 4000, 'levels');
  await sleep(300);
  const panel = await page.evaluate(() => { const p = document.querySelector('.panel'); const r = p.getBoundingClientRect(); return { inside: r.top >= 0 && r.bottom <= innerHeight + 1, scrolls: p.scrollHeight > p.clientHeight }; });
  t.check('level select fits (scrolls inside its card if it must)', panel.inside, panel);
  await page.screenshot({ path: './.out/menus-phone-levels.png' });
  t.check('no errors (phone)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- level select: a run to continue is what Ⓐ picks; the highlight survives the partner's save
{
  const run = { level: 1, cp: 0, seeds: [1, 2], feathers: 0, time: 30, with: 'Pip & Bo' };
  const page = await open(browser, { storage: { 'mossbound.save.v2': { unlocked: 4, levels: {}, finished: false, run, runAt: 1 } } });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.evaluate(() => { window.__fb.flow.mode = 'local'; window.__fb.flow.levels(); });
  await waitFor(async () => (await screenName(page)) === 'LevelSelect', 4000, 'levels');
  await sleep(300);
  const act = () => page.evaluate(() => document.querySelector('.sel')?.dataset.act ?? null);
  const first = await act();
  await key(page, 'ArrowRight');
  const moved = await act();
  await page.evaluate(() => window.__fb.app.current.onSave());
  const kept = await act();
  t.check('CONTINUE is highlighted; a rebuild keeps the highlight where it was', first === 'continue' && moved !== 'continue' && kept === moved, { first, moved, kept });
  // scrolling through the levels doesn't repaint the scenery behind them at every step
  // (first the scenery for the step above settles and paints — that one isn't part of the scroll)
  await waitFor(() => page.evaluate(() => window.__fb.app.current.settle <= 0), 3000, 'scenery settled');
  await frames(page, 3);
  let paints = 0;
  await page.evaluate(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    window.__paints = 0;
    HTMLCanvasElement.prototype.getContext = function (...a) { if (this.id !== 'view') window.__paints++; return get.apply(this, a); };
  });
  // (one frame between presses — quick scrolling: a frame is at most 0.1 s of game time, inside the
  // highlight's 0.15 s settle, however slow a busy machine makes the frames)
  const from = await act();
  // One frame between presses, driven from inside the page. It used to be page.keyboard.press in a
  // loop out here, and every one of those is a round trip to the browser — nothing on a machine
  // drawing sixty frames a second, but a whole frame of game time on one drawing three, which let
  // the highlight's 0.15 s settle elapse between steps and repaint the scenery at each. The point
  // of the check is that a QUICK scroll paints once, so the scroll has to actually be quick, and
  // the only way to guarantee that is to stop leaving the page between presses.
  await page.evaluate(() => new Promise((done) => {
    let n = 0;
    const press = () => {
      if (n++ >= 4) return done();
      for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { code: 'ArrowRight', key: 'ArrowRight', bubbles: true }));
      requestAnimationFrame(press);
    };
    requestAnimationFrame(press);
  }));
  const to = await act();
  await sleep(600);
  paints = await page.evaluate(() => window.__paints);
  t.check('scrolling the levels paints one backdrop, not one per step', paints <= 10 && to !== from, { paints, from, to });
  t.check('no errors (level select)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- the room-code box: last time's code is replaced by typing or pasting a new one (or an invite link)
{
  const page = await open(browser, { storage: { 'mossbound.settings.v1': { lastRoom: 'AB2C' } } });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.evaluate(() => window.__fb.flow.online());
  await waitFor(async () => (await screenName(page)) === 'OnlineScreen', 4000, 'online screen');
  await page.evaluate(() => window.__fb.app.current.act('join'));
  await waitFor(() => page.evaluate(() => document.activeElement?.classList.contains('code-input')), 3000, 'code box');
  await sleep(100);
  const was = await page.evaluate(() => document.querySelector('.code-input').value);
  await page.keyboard.type('k7qx');
  const typed = await page.evaluate(() => document.querySelector('.code-input').value);
  await page.evaluate(() => { const i = document.querySelector('.code-input'); i.select(); document.execCommand('insertText', false, 'Come play Mossbound with me! Room PZ3M: https://atinygreencell.github.io/mossbound/#join=PZ3M'); });
  const pasted = await page.evaluate(() => document.querySelector('.code-input').value);
  const { codeFrom } = await page.evaluate(async () => { const m = await import('/src/ui/screens.ts'); return { codeFrom: m.codeFrom ? [m.codeFrom('Room K7QX', true), m.codeFrom('k7qxz'), m.codeFrom('x', true)] : [] }; });
  t.check('a new code replaces last time’s; a pasted invite gives its code', was === 'AB2C' && typed === 'K7QX' && pasted === 'PZ3M' && codeFrom.join() === 'K7QX,K7QX,X', { was, typed, pasted, codeFrom });
  // "looking for your partner…" has only CANCEL: a stray Ⓐ / ENTER mustn't press it
  await page.evaluate(() => { document.activeElement?.blur(); window.__fb.app.current.go('connecting'); });
  await sleep(200);
  await key(page, 'Enter');
  await sleep(300);
  const state = await page.evaluate(() => window.__fb.app.current.state);
  t.check('ENTER while looking for the partner doesn’t cancel', state === 'connecting', state);
  t.check('no errors (room code)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- settings: on a phone the volume goes down too; a controller can leave the name box; a gamepad
// alone (an Xbox in game-controls mode) starts the sound
{
  const page = await open(browser, { pads: 1, query: { audio: true } });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await sleep(400);
  const silent = await page.evaluate(() => !window.__fb.audio.ctx);
  await padPress(page, 0, 3);
  const sound = await waitFor(() => page.evaluate(() => !!window.__fb.audio.ctx), 2000, 'audio').catch(() => false);
  t.check('a gamepad press alone starts the sound', silent && sound, { silent, sound });
  await page.evaluate(() => window.__fb.app.current.act('settings'));
  await waitFor(() => page.evaluate(() => !!document.querySelector('.settings .name-input')), 3000, 'settings');
  await sleep(400);
  const vol = () => page.evaluate(() => JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}').music ?? 0.7);
  const v0 = await vol();
  let tapped = true;
  await page.click('.row[data-act="music"] [data-dir="-1"]').catch(() => { tapped = false; });
  await frames(page, 2);
  const v1 = await vol();
  t.check('tapping ◀ turns the music down', tapped && Math.abs(v1 - (v0 - 0.1)) < 1e-9, { v0, v1 });
  await page.click('.name-input');
  await frames(page, 2);
  await padPress(page, 0, 13);
  const left = await page.evaluate(() => !document.activeElement?.classList.contains('name-input'));
  t.check('a controller can leave the name box', left);
  t.check('no errors (settings)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- menus that appear on their own (the level-clear card, the ending) ignore the Ⓐ a player is
// already tapping in the nest: the stats and the ending are put there to be seen
{
  const page = await open(browser, { pads: 1 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  const last = await page.evaluate(() => import('/src/game/levels.ts').then((m) => m.LEVELS.length - 1));
  await page.evaluate((i) => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keysL', 'keysR']; f.playLevel(i); }, last);
  await waitFor(async () => (await screenName(page)) === 'Session', 6000, 'last level');
  await sleep(400);
  await installTap(page);
  // both sprouts in the nest: the level clears and the card comes up on its own
  await page.evaluate(() => { const s = window.__fbSession; const n = s.L.nest; s.devTeleport(n.x - 12, n.y - 4, 0); s.devTeleport(n.x + 12, n.y - 4, 1); return window.__tapWhen(() => !!document.querySelector('.overlay.clear [data-act="ending"]')); });
  const cardUp = await page.evaluate(() => !!document.querySelector('.overlay.clear .ov-stats'));
  await sleep(500);
  await padPress(page, 0, 0);
  const toEnding = await waitFor(async () => (await screenName(page)) === 'EndingScreen', 3000, 'the ending').catch(() => false);
// Held across a screen change, and the hold is counted in FRAMES (installTap holds for three).
// Three frames is fifty milliseconds on a machine with a GPU and a full second on one without, so
// what gets tested there is not "a button still down as the card appears" but "a button held for a
// second" — a different question with a different right answer. Frame-coupled by construction, so
// it needs a machine whose frames are short (see canTimePhysics).
  const slowClear = await canTimePhysics(page);
  if (slowClear) t.skip('the level-clear card isn’t pressed by the Ⓐ already being tapped in the nest', `${slowClear} — saw ${JSON.stringify({ cardUp, toEnding: !!toEnding })}`);
  else t.check('the level-clear card isn’t pressed by the Ⓐ already being tapped in the nest', cardUp && !!toEnding, { cardUp, toEnding: !!toEnding });
  // and the ending itself: the same tap mustn't carry straight past it to the title
  await page.evaluate(() => window.__fb.flow.title());
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 4000, 'title');
  await page.evaluate(() => { window.__fb.flow.ending(); return window.__tapWhen(() => !!document.querySelector('.ending-screen [data-act="title"]')); });
  const stillEnding = (await screenName(page)) === 'EndingScreen';
  await sleep(500);
  await padPress(page, 0, 0);
  const toTitle = await waitFor(async () => (await screenName(page)) === 'TitleScreen', 3000, 'title again').catch(() => false);
  const slowEnd = await canTimePhysics(page);
  if (slowEnd) t.skip('the ending stays up for the Ⓐ still being tapped, and leaves on the next one', `${slowEnd} — saw ${JSON.stringify({ stillEnding, toTitle: !!toTitle })}`);
  else t.check('the ending stays up for the Ⓐ still being tapped, and leaves on the next one', stillEnding && !!toTitle, { stillEnding, toTitle: !!toTitle });
  t.check('no errors (clear card and ending)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- PLAY ONLINE opens on its main button, and the eight colours are one stop, not eight
{
  const page = await open(browser, { pads: 1, storage: { 'mossbound.settings.v1': { color: 3 } } });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.evaluate(() => window.__fb.flow.online());
  await waitFor(async () => (await screenName(page)) === 'OnlineScreen', 4000, 'online screen');
  await sleep(400);
  const act = () => page.evaluate(() => document.querySelector('.online-screen .sel')?.dataset.act ?? null);
  const color = () => page.evaluate(() => JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}').color);
  const first = await act();
  t.check('PLAY ONLINE highlights MAKE A ROOM, not a colour swatch', first === 'host', { first });
  await padPress(page, 0, 12); // ↑: the colour row above it
  const onRow = await act();
  const was = await color();
  await padPress(page, 0, 15); // →: the next colour
  const now = await color();
  await padPress(page, 0, 12); // ↑ again: past the whole row in one step
  const pastRow = await act();
  t.check('the colours are one stop on the way, changed with ←/→', onRow === 'color' && now === (was + 1) % 8 && pastRow === 'back', { onRow, was, now, pastRow });
  await page.click('.online-screen .swatch[data-color="6"]');
  await frames(page, 2);
  const tapped = await page.evaluate(() => ({ color: JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}').color, on: document.querySelector('.online-screen .swatch.on')?.dataset.color }));
  t.check('a tap still picks the swatch it landed on', tapped.color === 6 && tapped.on === '6', tapped);
  t.check('no errors (online menu)', !page.errors.length, page.errors.join('\n'));
  await page.close();
  // with a room to go back to, that's the main action instead
  const p2 = await open(browser, { storage: { 'mossbound.settings.v1': { lastRoom: 'K7QX', lastRole: 'guest' } } });
  await waitFor(async () => (await screenName(p2)) === 'TitleScreen', 8000, 'title again');
  await p2.evaluate(() => window.__fb.flow.online());
  await waitFor(async () => (await screenName(p2)) === 'OnlineScreen', 4000, 'online screen again');
  await sleep(300);
  const withRoom = await p2.evaluate(() => document.querySelector('.online-screen .sel')?.dataset.act ?? null);
  t.check('a room you were in last time is the one the highlight offers', withRoom === 'rejoin', { withRoom });
  t.check('no errors (online menu, rejoin)', !p2.errors.length, p2.errors.join('\n'));
  await p2.close();
}

// ---- a seated controller whose batteries die lets go of its seat: on a console there is no
// keyboard or mouse to rescue the lobby with
{
  const page = await open(browser, { pads: 2 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.evaluate(() => window.__fb.flow.local());
  await waitFor(async () => (await screenName(page)) === 'LocalScreen', 4000, 'the lobby');
  await sleep(400);
  await padPress(page, 0, 0);
  const seated = await page.evaluate(() => [...window.__fb.app.current.seats]);
  await page.evaluate(() => { window.__pads[0].connected = false; });
  await frames(page, 4);
  const freed = await page.evaluate(() => [...window.__fb.app.current.seats]);
  // the other controller can now back out (and take a seat of its own)
  await padPress(page, 1, 1); // Ⓑ
  const back = await waitFor(async () => (await screenName(page)) === 'TitleScreen', 3000, 'title').catch(() => false);
  t.check('a seat whose controller died frees itself, so the other one can still back out', seated[0] === 'pad0' && !freed[0] && !freed[1] && !!back, { seated, freed, back: !!back });
  t.check('no errors (dead controller in the lobby)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- settings: clicking a section heading leaves the keyboard where it was, so the next ENTER does
// one thing — and changing a setting doesn't fold the section away
{
  const page = await open(browser, { storage: { 'mossbound.settings.v1': { shake: true } } });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await sleep(450);
  await page.evaluate(() => window.__fb.app.current.act('settings'));
  await waitFor(() => page.evaluate(() => !!document.querySelector('.settings .name-input')), 3000, 'settings');
  await sleep(450);
  for (let i = 0; i < 20 && (await page.evaluate(() => document.querySelector('.settings .sel')?.dataset.act)) !== 'shake'; i++) await key(page, 'ArrowDown');
  const row = await page.evaluate(() => document.querySelector('.settings .sel')?.dataset.act);
  const state = () => page.evaluate(() => ({ open: !!document.querySelector('.settings details.advanced')?.open, focus: document.activeElement?.tagName, shake: JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}').shake }));
  await page.click('.settings details.advanced summary');
  await sleep(300);
  const before = await state();
  await key(page, 'Enter');
  await sleep(200);
  const after = await state();
  t.check('ENTER after opening a settings section does one thing, and the section stays open', row === 'shake' && before.open && after.open && after.shake === !before.shake, { row, before, after });
  t.check('no errors (settings sections)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- one controller the system shows twice (Steam Input, a doubled driver): its two copies report
// the same press a frame apart, and that is still one player sitting down
{
  const page = await open(browser, { pads: 3 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.evaluate(() => window.__fb.flow.local());
  await waitFor(async () => (await screenName(page)) === 'LocalScreen', 4000, 'the lobby');
  await sleep(400);
  const hold = (pad, on) => page.evaluate((p, on) => { window.__pads[p].buttons[0] = { pressed: on, touched: on, value: on ? 1 : 0 }; }, pad, on);
  // pads 0 and 1 are one physical controller; player 1 presses Ⓐ and pad 1 sees it a frame later
  await hold(0, true);
  await frames(page, 1);
  await hold(1, true);
  await frames(page, 3);
  const seats = await page.evaluate(() => [...window.__fb.app.current.seats]);
  await hold(0, false);
  await hold(1, false);
  await frames(page, 3);
  const stayed = await screenName(page);
  // and the partner's own controller can still take the other seat
  await padPress(page, 0, 0, 2); // (pad 0 again: a second press by player 1 changes nothing)
  await padPress(page, 2, 0, 2);
  const started = await waitFor(async () => (await screenName(page)) === 'LevelSelect', 4000, 'the level select').catch(() => false);
  const both = await page.evaluate(() => [...window.__fb.flow.seats]);
  t.check('a controller shown twice takes one seat, and the partner still gets the other', seats.filter(Boolean).length === 1 && stayed === 'LocalScreen' && !!started && both.join() === 'pad0,pad2', { seats, stayed, both });
  t.check('no errors (twinned controller)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- BACK in the one-screen lobby, while the game is already on its way, really does go back
{
  const page = await open(browser, { pads: 2 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.evaluate(() => window.__fb.flow.local());
  await waitFor(async () => (await screenName(page)) === 'LocalScreen', 4000, 'the lobby');
  await sleep(400);
  await padPress(page, 0, 0); // player 1 sits down
  // player 2 sits too, and one of them changes their mind before the level select arrives
  await page.evaluate(() => { window.__pads[1].buttons[0] = { pressed: true, touched: true, value: 1 }; });
  await frames(page, 2);
  // The window being aimed at is "both seats taken, level select not here yet", and it is two
  // animation frames wide — thirty milliseconds on a screen, most of a second on a runner drawing
  // three frames a second, by which time the lobby has already handed over. This used to be
  // `querySelector(...).click()`, which dereferenced null and took the whole of menus.mjs down with
  // it, so every check after this one never ran. Ask whether the button is still there instead.
  const hitTheWindow = await page.evaluate(() => {
    const b = document.querySelector('.local-screen [data-act="back"]');
    b?.click();
    return !!b;
  });
  const atOnce = await page.evaluate(() => window.__fb.app.next?.constructor.name);
  await page.evaluate(() => { window.__pads[1].buttons[0] = { pressed: false, touched: false, value: 0 }; });
  await sleep(700);
  const later = await screenName(page);
  const slowBack = await canTimePhysics(page);
  if (!hitTheWindow) t.skip('BACK with both seats taken stays on the title', 'the lobby had already handed over to the level select — this machine draws too few frames to land inside that window');
  else if (slowBack) t.skip('BACK with both seats taken stays on the title', `${slowBack} — saw ${JSON.stringify({ atOnce, later })}`);
  else t.check('BACK with both seats taken stays on the title', atOnce === 'TitleScreen' && later === 'TitleScreen', { atOnce, later });
  t.check('no errors (lobby back)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- the mouse moves the one highlight: a pointer resting on a button doesn't make a second
// "highlighted" one that ENTER then walks past
{
  const page = await open(browser, { storage: { 'mossbound.save.v3': { unlocked: 4, levels: {} } } });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await sleep(450);
  const middleOf = (s) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, s);
  const gold = (s = '.title-screen .menu .btn') => page.evaluate((s) => {
    const all = [...document.querySelectorAll(s)].map((b) => ({ act: b.dataset.act, paint: getComputedStyle(b).backgroundColor + getComputedStyle(b).outlineColor, sel: b.classList.contains('sel') }));
    const lit = all.find((b) => b.sel);
    return { sel: lit?.act ?? null, like: all.filter((b) => b.paint === lit?.paint).map((b) => b.act) };
  }, s);
  // the mouse comes to rest on PLAY ON ONE SCREEN while the keyboard highlight is on PLAY ONLINE
  const p = await middleOf('.title-screen [data-act="local"]');
  await page.mouse.move(p.x - 40, p.y);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await sleep(300); // the background transition
  const title = await gold();
  await key(page, 'Enter');
  const went = await waitFor(async () => (await screenName(page)) === 'LocalScreen', 3000, 'one-screen lobby').catch(() => false);
  t.check('a mouse resting on a button takes the highlight; ENTER presses that one', title.sel === 'local' && title.like.length === 1 && !!went, { title, went: !!went });
  // the level-select cards the same way, and the picked level follows the highlight
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.levels(); });
  await waitFor(async () => (await screenName(page)) === 'LevelSelect', 4000, 'levels');
  await sleep(450);
  const c = await middleOf('.card[data-act="lvl:3"]');
  await page.mouse.move(c.x - 40, c.y);
  await page.mouse.move(c.x, c.y, { steps: 4 });
  await sleep(300);
  const cards = await gold('.levels-screen .card');
  const picked = await page.evaluate(() => document.querySelector('.card.picked')?.dataset.act ?? null);
  t.check('and on the level-select cards (the pick follows the highlight)', cards.sel === 'lvl:3' && cards.like.length === 1 && picked === 'lvl:3', { cards, picked });
  t.check('no errors (mouse highlight)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- JOIN A ROOM with a controller: ↑/↓ leave the code box without moving the highlight off JOIN,
// and Ⓐ there joins (a pad can't type, so its Ⓐ can only mean the button)
{
  const page = await open(browser, { pads: 1, storage: { 'mossbound.settings.v1': { lastRoom: 'K7QX', lastRole: 'guest' } } });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.evaluate(() => window.__fb.flow.online());
  await waitFor(async () => (await screenName(page)) === 'OnlineScreen', 4000, 'online screen');
  const box = () => waitFor(() => page.evaluate(() => document.activeElement?.classList.contains('code-input')), 3000, 'code box');
  const where = () => page.evaluate(() => ({ sel: document.querySelector('.online-screen .sel')?.dataset.act ?? null, inBox: !!document.activeElement?.classList.contains('code-input'), state: window.__fb.app.current.state }));
  await page.evaluate(() => window.__fb.app.current.act('join'));
  await box();
  // (the box selects what's in it a tick after it takes focus, which re-focuses it: let that land
  // before each press, or the press and the selection race)
  await frames(page, 2);
  await padPress(page, 0, 13); // ↓
  const down = await where();
  await page.click('.code-input');
  await box();
  await frames(page, 2);
  await padPress(page, 0, 12); // ↑
  const up = await where();
  t.check('↑/↓ leave the code box with JOIN still highlighted', down.sel === 'go' && !down.inBox && up.sel === 'go' && !up.inBox, { down, up });
  // Ⓐ with the box focused: JOIN (half a code, so the box says no and no room is opened)
  await page.evaluate(() => { const i = document.querySelector('.code-input'); i.value = 'AB'; i.focus(); });
  await box();
  await frames(page, 2);
  await padPress(page, 0, 0);
  await frames(page, 2);
  const tried = await page.evaluate(() => ({ bad: !!document.querySelector('.code-input.bad'), state: window.__fb.app.current.state }));
  t.check('Ⓐ with the code box focused presses JOIN', tried.bad && tried.state === 'join', tried);
  t.check('no errors (join with a controller)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- the level select rebuilds whenever news arrives from the partner: a tap just after one of
// those mustn't be swallowed by the guard meant for the tap that opened the screen
{
  const page = await open(browser);
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.levels(); });
  await waitFor(async () => (await screenName(page)) === 'LevelSelect', 4000, 'levels');
  await sleep(500);
  // the partner's half of the save arrives (a profile, a sprout swap or a connection blip does the
  // same), and the player taps a level a frame or two later
  await page.evaluate(() => window.__fb.app.current.onSave());
  await frames(page, 2);
  await page.click('.card[data-act="lvl:0"]');
  const started = await waitFor(async () => (await screenName(page)) === 'Session', 3000, 'the level').catch(() => false);
  t.check('a tap on a level card right after the partner’s save arrives starts the level', !!started, { screen: await screenName(page) });
  t.check('no errors (rebuilt level select)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- the host moves everyone back to the level select: the guest's next tug (Ⓑ) mustn't leave the room
{
  const page = await open(browser, { pads: 1 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await installTap(page);
  await guestRoom(page);
  // the guest is mid-level tugging with Ⓑ; the host picks BACK TO LEVELS and the list appears under them
  await page.evaluate(() => { window.__fb.flow.levels(); return window.__tapWhen(() => window.__fb.app.current?.constructor.name === 'LevelSelect', 1); });
  const after = await page.evaluate(() => ({ screen: window.__fb.app.current?.constructor.name, closed: window.__link.closed, link: !!window.__fb.flow.link }));
  const slowTugRoom = await canTimePhysics(page);
  if (slowTugRoom) t.skip('a tug (Ⓑ) as the partner moves you to the level select doesn’t leave the room', `${slowTugRoom} — saw ${JSON.stringify(after)}`);
  else t.check('a tug (Ⓑ) as the partner moves you to the level select doesn’t leave the room', after.screen === 'LevelSelect' && !after.closed && after.link, after);
  // ...and once they've had a moment to see where they are, LEAVE ROOM works
  await sleep(500);
  await padPress(page, 0, 1);
  const left = await waitFor(async () => (await screenName(page)) === 'TitleScreen', 3000, 'title').catch(() => false);
  t.check('Ⓑ on the level select still leaves the room a moment later', !!left && (await page.evaluate(() => window.__link.closed)), { left: !!left });
  t.check('no errors (guest level select)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- Xbox: the "use game controls" hint
{
  const page = await open(browser, { ua: XBOX_UA });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  const hint = await page.evaluate(() => document.querySelector('.xbox-hint')?.textContent ?? '');
  t.check('Xbox shows how to hand the controller to the game', /Use game controls/.test(hint), hint);
  await page.close();
}
// ---- the controls card ignores the tail of the double-click that opened it
{
  const page = await open(browser);
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await sleep(450);
  const how = await page.evaluate(() => { const r = document.querySelector('[data-act="controls"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(how.x, how.y);
  await sleep(100);
  await page.mouse.click(how.x, how.y, { clickCount: 2 });
  await sleep(200);
  const up = await page.evaluate(() => !!document.querySelector('.controls-panel'));
  t.check('a double-click on HOW TO PLAY leaves the card open', up, { up });
  t.check('no errors (controls card)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}
await browser.close();
t.finish('menus', []);
