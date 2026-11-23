// Menus with every kind of input: keyboard through the title and settings (which persist), a
// controller through the controls card and out of the room-code and name boxes, phone layout, Xbox,
// the level select's CONTINUE, a fresh room code over an old one, and guards against a stray Ⓐ.
import { SLOW, XBOX_UA, frames, launch, open, padPress, reporter, screenName, slowFrames, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const t = reporter();
const key = async (page, k) => { await page.keyboard.press(k); await frames(page, 2); };
const sel = (page) => page.evaluate(() => document.querySelector('.sel')?.textContent?.trim() ?? '');
/**
 * Installs window.__tapWhen(ready, button): presses that fake pad button on the very frame `ready()`
 * first says yes and lets go three frames later — the press a player is already making when a menu
 * arrives under them (a tap in the nest, a tug mid-level). Counted in frames, so a busy machine
 * can't turn it into a press that lands late.
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
  // the name is src/brand.ts's, on the title, the tab and the install manifest alike (docs/RENAMING.md)
  const brand = await page.evaluate(async () => {
    const { BRAND } = await import('/src/brand.ts');
    const logo = document.querySelector('.logo');
    const m = await (await fetch('./manifest.webmanifest')).json();
    return { BRAND, logo: logo.textContent, gold: logo.querySelector('span')?.textContent, tab: document.title, ios: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content, m: [m.name, m.short_name, m.id] };
  });
  const B = brand.BRAND;
  t.check('the name comes from src/brand.ts: title, tab, home screen, manifest', brand.logo === B.logo.join('') && brand.gold === B.logo[1] && brand.tab === B.name && brand.ios === B.name && brand.m[0] === B.name && brand.m[1] === B.name && brand.m[2] === 'mossbound-game', brand);
  // a longer name gets a smaller logo, on one line, and the title still fits
  const long = await page.evaluate(() => {
    const l = document.querySelector('.logo');
    const was = [l.innerHTML, l.getAttribute('style')];
    l.style.setProperty('--n', '20');
    l.innerHTML = 'by brook or <span>by crook</span>';
    const r = document.createRange();
    r.selectNodeContents(l);
    const text = r.getBoundingClientRect();
    const lines = Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).fontSize));
    const fits = [...document.querySelectorAll('.title-screen .btn, .logo')].every((el) => { const b = el.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; });
    l.innerHTML = was[0];
    l.setAttribute('style', was[1]);
    return { left: Math.round(text.left), right: Math.round(text.right), w: innerWidth, lines, fits };
  });
  t.check('a name twice as long fits on one line, and the title still fits', long.left >= 0 && long.right <= long.w && long.lines === 1 && long.fits, long);
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
  const page = await open(browser, { storage: { 'mossbound.save.v2': { unlocked: 6, levels: {}, finished: false, run, runAt: 1 } } });
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
  await page.evaluate(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    window.__paints = 0;
    HTMLCanvasElement.prototype.getContext = function (...a) { if (this.id !== 'view') window.__paints++; return get.apply(this, a); };
  });
  // (one frame between presses — quick scrolling: a frame is at most 0.1 s of game time, inside the
  // highlight's 0.15 s settle, however slow a busy machine makes the frames)
  // ←/→ walk along a row of cards (↑/↓ go between rows), so the scroll starts at the first card of the
  // longest row of levels, and takes as many steps as that row has room for — up to four
  const steps = await page.evaluate(() => {
    const L = window.__fb.app.current.list;
    const cards = L.items().filter((el) => el.dataset.act?.startsWith('lvl:'));
    const rows = new Map();
    for (const el of cards) rows.set(el.offsetTop, [...(rows.get(el.offsetTop) ?? []), el]);
    const row = [...rows.values()].sort((a, b) => b.length - a.length)[0];
    L.sel = L.items().indexOf(row[0]);
    L.highlight();
    return Math.min(4, row.length - 1);
  });
  // (a frame first: the new highlight starts its settle in the game's next frame, and a look before that
  // finds the old settle long over. Software rendering draws frames in pairs, one 5 ms after the other,
  // and the start card's scenery then painted inside the quick scroll below: 17 paints, not 8)
  await frames(page, 2);
  await waitFor(() => page.evaluate(() => window.__fb.app.current.settle <= 0), 3000, 'scenery settled again').catch(() => undefined);
  await frames(page, 3);
  const from = await act();
  // Quick: four steps in four frames, driven from inside the page. It used to be page.keyboard.press
  // in a loop out here, and each of those is a round trip to the browser — nothing on a machine
  // drawing sixty frames a second, but a whole frame of game time on one drawing three, which let the
  // highlight's 0.15 s settle elapse between steps and repaint the scenery at every one. The point of
  // the check is that a QUICK scroll paints once, so the scroll has to actually be quick, and the only
  // way to guarantee that is to stop leaving the page between presses.
  await page.evaluate(() => { window.__paints = 0; });
  await page.evaluate((steps) => new Promise((done) => {
    let n = 0;
    const press = () => {
      if (n++ >= steps) return done();
      for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { code: 'ArrowRight', key: 'ArrowRight', bubbles: true }));
      requestAnimationFrame(press);
    };
    requestAnimationFrame(press);
  }), steps);
  const to = await act();
  await waitFor(() => page.evaluate(() => window.__fb.app.current.settle <= 0), 3000, 'the scenery settles once').catch(() => undefined);
  await frames(page, 3);
  const quick = await page.evaluate(() => window.__paints);
  // Slow: the same four steps back, each one allowed to settle before the next. That is what "a
  // backdrop per step" costs, measured on the machine that is actually running — so what the check
  // compares is one paint against four, not a number against a ceiling. The ceiling was 10, fitted
  // to one renderer on one machine: it says nothing about the behaviour either way, and it fails the
  // day a theme gains a layer. (It was reading 12 and 19 on a runner drawing software frames.)
  await page.evaluate(() => { window.__paints = 0; });
  for (let i = 0; i < steps; i++) {
    await key(page, 'ArrowLeft');
    await waitFor(() => page.evaluate(() => window.__fb.app.current.settle <= 0), 3000, `step ${i + 1} settles`).catch(() => undefined);
    await frames(page, 3);
  }
  const slow = await page.evaluate(() => window.__paints);
  t.check('a quick scroll paints one backdrop where a slow one paints at every step', steps >= 2 && quick * 2 <= slow && to !== from, { steps, quick, slow, from, to });
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
  // Deliberately slow frames for this one. The card holds off the tap already under way, and the
  // press reaches it on the poll AFTER the button went down — so a frame longer than the hold-off is
  // the whole failure, and a machine quick enough never asks the question. 260 ms a frame is past
  // the 180 ms this arms for under ?fast, and the card has to survive the tap anyway.
  const quick = await slowFrames(page);
  // both sprouts in the nest: the level clears and the card comes up on its own
  await page.evaluate(() => { const s = window.__fbSession; const n = s.L.nest; s.devTeleport(n.x - 12, n.y - 4, 0); s.devTeleport(n.x + 12, n.y - 4, 1); return window.__tapWhen(() => !!document.querySelector('.overlay.clear [data-act="ending"]')); });
  const cardUp = await page.evaluate(() => !!document.querySelector('.overlay.clear .ov-stats'));
  await quick();
  await sleep(500);
  await padPress(page, 0, 0);
  const toEnding = await waitFor(async () => (await screenName(page)) === 'EndingScreen', 5000, 'the ending').catch(() => false);
  t.check('the level-clear card isn’t pressed by the Ⓐ already being tapped in the nest (at 4 frames a second)', cardUp && !!toEnding, { cardUp, toEnding: !!toEnding });
  // and the ending itself: the same tap mustn't carry straight past it to the title
  await page.evaluate(() => window.__fb.flow.title());
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 4000, 'title');
  const slowEnd = await slowFrames(page);
  await page.evaluate(() => { window.__fb.flow.ending(); return window.__tapWhen(() => !!document.querySelector('.ending-screen [data-act="title"]')); });
  const stillEnding = (await screenName(page)) === 'EndingScreen';
  await slowEnd();
  await sleep(500);
  await padPress(page, 0, 0);
  const toTitle = await waitFor(async () => (await screenName(page)) === 'TitleScreen', 5000, 'title again').catch(() => false);
  t.check('the ending stays up for the Ⓐ still being tapped, and leaves on the next one (at 4 frames a second)', stillEnding && !!toTitle, { stillEnding, toTitle: !!toTitle });
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
  await padPress(page, 0, 12); // ↑ again: past the whole row in one step, to your name
  const pastRow = await act();
  t.check('the colours are one stop on the way, changed with ←/→', onRow === 'color' && now === (was + 1) % 8 && pastRow === 'name', { onRow, was, now, pastRow });
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

// ---- settings: clicking a section heading opens it and leaves the keyboard nowhere, so the next ENTER
// does one thing — and changing a setting doesn't fold the section away. (The heading is a stop in the
// list, so the click puts the highlight on it, as a click does on any stop: ENTER there folds it again,
// and nothing else. Back on a setting, ENTER changes that setting and the section stays open.)
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
  const onHeading = await page.evaluate(() => document.querySelector('.settings .sel')?.tagName);
  await key(page, 'Enter');
  await sleep(200);
  const folded = await state();
  await key(page, 'Enter');
  await sleep(200);
  for (let i = 0; i < 20 && (await page.evaluate(() => document.querySelector('.settings .sel')?.dataset.act)) !== 'shake'; i++) await key(page, 'ArrowUp');
  const mid = await state();
  await key(page, 'Enter');
  await sleep(200);
  const after = await state();
  t.check('ENTER after opening a settings section does one thing, and the section stays open', row === 'shake' && before.open && before.focus !== 'SUMMARY' && onHeading === 'SUMMARY' && !folded.open && folded.shake === before.shake && mid.open && after.open && after.shake === !mid.shake, { row, before, onHeading, folded, mid, after });
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
  // Player 2 sits too, and one of them changes their mind before the level select arrives.
  //
  // The window being aimed at is "both seats taken, level select not here yet": the countdown, which
  // runs for 450 ms (90 under ?fast) and three frames at the least, and ends inside a frame, after that
  // frame's presses — so a click that lands in it is always in time. It is aimed at from inside the
  // page, with the watch already running when the seat is claimed: pressing out here and then looking
  // costs two round trips, which on a slow machine is the whole countdown. So the press and the watch
  // go in together: arm, press, and take the first frame that shows both seats with the lobby still up.
  //
  // (This used to be a bare `querySelector(...).click()` on the hope of being early enough, which
  // dereferenced null when it wasn't and took the whole of menus.mjs down with it — every check
  // after this one never ran, which is what an empty errors block under a FAIL looks like.)
  const hitTheWindow = await page.evaluate(() => new Promise((done) => {
    const deadline = performance.now() + 4000;
    const f = () => {
      const lobby = window.__fb.app.current;
      if (lobby?.constructor.name !== 'LocalScreen') return done(false);
      if (lobby.seats.filter(Boolean).length >= 2) {
        const b = document.querySelector('.local-screen [data-act="back"]');
        b?.click();
        return done(!!b);
      }
      return performance.now() > deadline ? done(false) : requestAnimationFrame(f);
    };
    window.__pads[1].buttons[0] = { pressed: true, touched: true, value: 1 };
    requestAnimationFrame(f);
  }));
  const atOnce = await page.evaluate(() => window.__fb.app.next?.constructor.name);
  await page.evaluate(() => { window.__pads[1].buttons[0] = { pressed: false, touched: false, value: 0 }; });
  await sleep(700);
  const later = await screenName(page);
  t.check('BACK with both seats taken stays on the title', hitTheWindow && atOnce === 'TitleScreen' && later === 'TitleScreen', { hitTheWindow, atOnce, later });
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
  const slowTug = await slowFrames(page);
  await page.evaluate(() => { window.__fb.flow.levels(); return window.__tapWhen(() => window.__fb.app.current?.constructor.name === 'LevelSelect', 1); });
  const after = await page.evaluate(() => ({ screen: window.__fb.app.current?.constructor.name, closed: window.__link.closed, link: !!window.__fb.flow.link }));
  await slowTug();
  t.check('a tug (Ⓑ) as the partner moves you to the level select doesn’t leave the room (at 4 frames a second)', after.screen === 'LevelSelect' && !after.closed && after.link, after);
  // ...and once they've had a moment to see where they are, LEAVE ROOM works (Ⓑ is LEAVE ROOM pressed,
  // and LEAVE ROOM asks first: the second Ⓑ leaves)
  await sleep(500);
  await padPress(page, 0, 1);
  const asked = await page.evaluate(() => ({ screen: window.__fb.app.current?.constructor.name, closed: window.__link.closed }));
  await padPress(page, 0, 1);
  const left = await waitFor(async () => (await screenName(page)) === 'TitleScreen', 3000, 'title').catch(() => false);
  t.check('Ⓑ on the level select still leaves the room a moment later (asking first)', asked.screen === 'LevelSelect' && !asked.closed && !!left && (await page.evaluate(() => window.__link.closed)), { asked, left: !!left });
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

// ---- a key or controller press that changes screen shows the new screen in the very frame that
// handled it — and never a frame with the old menu and the new one painted on top of each other
{
  const page = await open(browser, { pads: 1 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await sleep(450);
  // a watcher that runs after the game's own frame, so what it sees is what that frame paints
  await page.evaluate(() => {
    const s = (window.__seen = { frame: 0, two: 0, ev: null, to: null, want: null });
    const f = () => {
      s.frame++;
      if (document.querySelectorAll('.ui > .screen').length > 1) s.two++;
      if (s.want && s.ev !== null && s.to === null && window.__fb.app.current?.constructor.name === s.want && document.querySelectorAll('.ui > .screen').length === 1) s.to = s.frame - s.ev;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(() => requestAnimationFrame(f));
    addEventListener('keydown', () => { if (s.want && s.ev === null) s.ev = s.frame; }, true);
  });
  const expect = (want) => page.evaluate((want) => Object.assign(window.__seen, { want, ev: null, to: null }), want);
  const took = async (label) => {
    const to = await waitFor(() => page.evaluate(() => window.__seen.to), 4000, label).catch(() => null);
    return to;
  };
  await key(page, 'ArrowDown');
  await expect('LocalScreen');
  await page.keyboard.press('Enter');
  const enter = await took('the lobby');
  await sleep(450);
  await expect('TitleScreen');
  await page.keyboard.press('Escape');
  const esc = await took('the title');
  await sleep(450);
  await page.evaluate(() => { window.__fbTitle.list.sel = 0; window.__fbTitle.list.highlight(); });
  await expect('OnlineScreen');
  // the controller's Ⓐ goes down between two frames, as a real one does
  await page.evaluate(() => requestAnimationFrame(() => { window.__seen.ev = window.__seen.frame; window.__pads[0].buttons[0] = { pressed: true, touched: true, value: 1 }; }));
  const pad = await took('the online menu');
  await page.evaluate(() => { window.__pads[0].buttons[0] = { pressed: false, touched: false, value: 0 }; });
  const two = await page.evaluate(() => window.__seen.two);
  t.check('a press that changes screen shows the new one in the frame that handled it, never two at once', enter === 1 && esc === 1 && pad === 1 && two === 0, { framesTo: { enter, esc, pad }, framesWithTwoScreens: two });
  t.check('no errors (same-frame screen change)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- the level select's highlight is unmistakable. Whatever else a card wears — the dashed outline of
// the level the scenery shows, CONTINUE's gold one, the test course's dashed border — the card Ⓐ will
// press looks like the highlighted card, and no other card does.
{
  const page = await open(browser);
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  const looks = () => page.evaluate(() => [...document.querySelectorAll('.levels-screen .card')].map((c) => {
    const s = getComputedStyle(c);
    return { act: c.dataset.act ?? 'locked', sel: c.classList.contains('sel'), look: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}` };
  }));
  const toLevels = async () => {
    await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keysL', 'keysR']; f.levels(); });
    await waitFor(() => page.evaluate(() => document.querySelectorAll('.levels-screen').length === 1 && window.__fb.app.current?.constructor.name === 'LevelSelect'), 5000, 'level select');
    await sleep(300);
  };
  await toLevels();
  const fresh = await looks();
  const highlight = fresh.find((c) => c.sel)?.look;
  // a run under way in Fern Falls (from its first lantern): CONTINUE is what Ⓐ picks
  await page.evaluate(() => { const s = window.__fb.save.save; s.unlocked = 2; s.levels.garden = { clears: 1, feathers: 1, time: 90 }; window.__fb.flow.enterLevel(1); });
  await waitFor(() => page.evaluate(() => window.__fbSession?.L.index === 1 && window.__fb.app.current === window.__fbSession), 8000, 'Fern Falls');
  await sleep(300);
  await page.evaluate(() => window.__fbSession.light(0, true));
  await toLevels();
  const run = await looks();
  await key(page, 'ArrowRight');
  await key(page, 'ArrowRight');
  const moved = await looks();
  const plain = (state) => {
    const on = state.find((c) => c.sel);
    return !!on && on.look === highlight && state.filter((c) => c.look === highlight).length === 1;
  };
  t.check('the highlighted level card looks highlighted — over CONTINUE, the picked level and the test course — and no other card does', !!highlight && plain(fresh) && plain(run) && plain(moved), { highlight, fresh, run, moved });
  t.check('no errors (level select highlight)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- the symbols the menus draw (✦ ▶ ⏱ 🔒 Ⓐ ☰ …) aren't in the game's font, and the first time one is
// laid out the browser looks through the system's fonts for it — inside the layout of whatever screen
// shows it first, in the frame of the press that asked for that screen. They are laid out once ahead
// of time, while the title is idle, so a symbol laid out for the first time after that costs no more
// than one laid out again. (A clock, on a machine that may be busy: up to three fresh pages, and one
// clean measurement is the answer — the cost it looks for is there every time, or not at all.)
{
  const tries = [];
  let errs = [];
  for (let i = 0; i < 3; i++) {
    const page = await open(browser);
    await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
    await sleep(2500);
    const layout = () => page.evaluate((s) => {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;left:-10000px;top:0;white-space:nowrap';
      el.innerHTML = ['400', '600', '700'].map((w) => `<span style="font-weight:${w}">${s}</span>`).join('');
      document.body.appendChild(el);
      const t0 = performance.now();
      void el.offsetWidth;
      const ms = performance.now() - t0;
      el.remove();
      return +ms.toFixed(2);
    }, '✦▶◀⏱🔒Ⓐ Ⓑ Ⓧ Ⓨ ☰ ⧉ ✓ ♥ ← → ↑ ↓');
    const first = await layout();
    const again = await layout();
    tries.push({ first, again, ok: first <= 3 * again + 6 * SLOW });
    errs = errs.concat(page.errors);
    await page.close();
    if (tries.at(-1).ok) break;
  }
  const last = tries.at(-1);
  t.check(`the menus' symbols are ready before any screen needs them (first layout ${last.first} ms, again ${last.again} ms)`, last.ok, tries);
  t.check('no errors (symbols ready)', !errs.length, errs.join('\n'));
}

// ---- settings on a phone: a change is made where it's shown. The card used to be built again for
// every tap of ◀ / ▶, which scrolled it back to the top under the thumb — so the next tap at the same
// spot changed the row above.
{
  // (settings seeded after the page is up: the harness's storage seeding meets about:blank on a phone viewport)
  const page = await open(browser, { viewport: { width: 667, height: 375, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true } });
  await page.evaluate(() => localStorage.setItem('mossbound.settings.v1', JSON.stringify({ sfx: 0.5, music: 0.7 })));
  await page.reload({ waitUntil: 'networkidle0' });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.touchscreen.tap(330, 5);
  await sleep(300);
  await page.evaluate(() => window.__fbTitle.act('settings'));
  await waitFor(() => page.evaluate(() => !!document.querySelector('.panel.settings')), 3000, 'settings');
  // a section open (so the card scrolls), scrolled so that the sounds row sits mid-card
  await page.evaluate(() => {
    document.querySelector('.settings details').open = true;
    const p = document.querySelector('.panel.settings');
    p.scrollTop = document.querySelector('[data-act="sfx"]').offsetTop - p.clientHeight / 2;
  });
  await sleep(500);
  const where = () => page.evaluate(() => {
    const row = document.querySelector('[data-act="sfx"]');
    const up = row.querySelector('[data-dir="1"]').getBoundingClientRect();
    return { rowY: Math.round(row.getBoundingClientRect().y), scroll: document.querySelector('.panel.settings').scrollTop, x: up.x + up.width / 2, y: up.y + up.height / 2 };
  });
  const before = await where();
  await page.touchscreen.tap(before.x, before.y);
  await sleep(250);
  const between = await where();
  await page.touchscreen.tap(before.x, before.y);
  await sleep(250);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mossbound.settings.v1')));
  const stillOpen = await page.evaluate(() => document.querySelector('.settings details').open);
  t.check('two taps on a setting’s ▶ on a phone change that setting twice — the card stays where it was', saved.sfx === 0.7 && saved.music === 0.7 && between.rowY === before.rowY && between.scroll === before.scroll && stillOpen, { before, between, sfx: saved.sfx, music: saved.music, stillOpen });
  t.check('no errors (settings on a phone)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}

// ---- settings open with the highlight on your own colour, so an Ⓐ / ENTER right away changes nothing
{
  const page = await open(browser, { storage: { 'mossbound.settings.v1': { color: 3 } } });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await sleep(450);
  await page.evaluate(() => window.__fbTitle.act('settings'));
  await waitFor(() => page.evaluate(() => !!document.querySelector('.panel.settings')), 3000, 'settings');
  const on = await page.evaluate(() => document.querySelector('.settings .sel')?.dataset.act ?? null);
  await key(page, 'Enter');
  const colour = await page.evaluate(() => JSON.parse(localStorage.getItem('mossbound.settings.v1')).color);
  t.check('settings open on your own colour, and ENTER there leaves it as it is', on === 'color:3' && colour === 3, { on, colour });
  t.check('no errors (settings start)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}
// ---- after an update lands on an Xbox's title, its note and the hint that says how to hand the
// controllers back are both readable: the note used to sit on top of the hint for nine seconds
{
  const page = await open(browser, { ua: XBOX_UA, viewport: { width: 1920, height: 1080 } });
  await page.evaluate(() => sessionStorage.setItem('mossbound.update.back', JSON.stringify({ from: '1.9.0', at: Date.now(), back: { to: 'title' } })));
  await page.reload({ waitUntil: 'networkidle0' });
  await waitFor(() => page.evaluate(() => window.__fb?.app?.current?.constructor.name === 'TitleScreen' && !!document.querySelector('.update-toast')), 8000, 'the title, updated');
  await sleep(300);
  const r = await page.evaluate(() => {
    const box = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
    const a = box('.update-toast');
    const b = box('.xbox-hint');
    const apart = a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left;
    return { apart, toast: a, hint: b, onScreen: a.top >= 0 && a.bottom <= innerHeight && b.top >= 0 && b.bottom <= innerHeight };
  });
  t.check('an Xbox title just updated shows the update note and the controller hint without one over the other', r.apart && r.onScreen, r);
  t.check('no errors (updated on an Xbox)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}
// ---- the version badge keeps to its corner: never drawn over a card (the level select's, BACK and all, on
// a small phone), never under the frame-rate meter, and gone the moment a level is being played
{
  const page = await open(browser, { viewport: { width: 667, height: 375 } });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await sleep(700);
  // the badge ignores the pointer; let it answer for a moment, to ask what is drawn on top where it meets BACK
  const onTop = () => page.evaluate(() => {
    const badge = document.querySelector('.version-badge');
    const back = document.querySelector('.levels-screen .panel');
    const a = badge.getBoundingClientRect();
    const b = back.getBoundingClientRect();
    const x = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
    const y = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
    const meet = Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
    badge.style.pointerEvents = 'auto';
    const hit = document.elementFromPoint(x, y);
    badge.style.pointerEvents = '';
    return { meet, top: hit === badge ? 'badge' : hit?.closest('.panel') ? 'panel' : hit?.className ?? null };
  });
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keysL', 'keysR']; f.levels(); });
  await waitFor(() => page.evaluate(() => document.querySelectorAll('.levels-screen').length === 1 && window.__fb.app.current?.constructor.name === 'LevelSelect'), 5000, 'levels');
  await sleep(700);
  const atBack = await onTop();
  // the frame-rate meter (the backquote key) and the badge
  await page.keyboard.press('Backquote');
  await sleep(700);
  const meter = await page.evaluate(() => {
    const a = document.querySelector('.fps-meter').getBoundingClientRect();
    const b = document.querySelector('.version-badge').getBoundingClientRect();
    return Math.min(a.right, b.right) <= Math.max(a.left, b.left) || Math.min(a.bottom, b.bottom) <= Math.max(a.top, b.top);
  });
  await page.keyboard.press('Backquote');
  // into a level: the badge is gone in the first frame the level is on screen
  const gone = await page.evaluate(() => new Promise((done) => {
    window.__fb.flow.enterLevel(0);
    const f = () => {
      if (window.__fb.app.current?.constructor.name !== 'Session') return requestAnimationFrame(f);
      const b = document.querySelector('.version-badge');
      done(!b || getComputedStyle(b).display === 'none');
    };
    requestAnimationFrame(f);
  }));
  t.check('the version badge is never drawn over a card (the level select at 667×375), nor under the frame-rate meter, and leaves with the level', atBack.meet && atBack.top === 'panel' && meter && gone, { atBack, meterClear: meter, goneInLevel: gone });
  t.check('no errors (version badge)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}
// ---- a click that the partner's news rebuilds the level select under (between the button going down and
// coming up) still presses what it was on — once; and the room's own status news rebuilds nothing
{
  const page = await open(browser);
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  // the host of an online room, with a stand-in for the link
  await page.evaluate(() => {
    const l = { role: 'host', code: 'K7QX', status: 'connected', detail: '', rtt: 40, via: 'direct', peerId: 'p', peerGen: 1, myId: 'me', connected: true,
      send() {}, sendSnap() {}, close() {}, sharedNow: () => performance.now(), onStatus: null, onCtrl: null, onSnap: null };
    window.__fb.flow.adopt(l);
    window.__fb.flow.levels();
  });
  await waitFor(() => page.evaluate(() => document.querySelectorAll('.levels-screen').length === 1 && window.__fb.app.current?.constructor.name === 'LevelSelect'), 5000, 'levels');
  await sleep(450);
  const swapped = () => page.evaluate(() => JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}').swap === true);
  const at = () => page.evaluate(() => { const r = document.querySelector('[data-act="swap"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
  const before = await swapped();
  let p = await at();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(60);
  await page.evaluate(() => window.__fb.app.current.onSave()); // the partner's half of the save arrives
  await sleep(60);
  await page.mouse.up();
  await sleep(300);
  const byMouse = await swapped();
  // a touch: the browser still sends its own click after a rebuild, so it mustn't count twice
  const cdp = await page.createCDPSession();
  p = await at();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
  await sleep(60);
  await page.evaluate(() => window.__fb.app.current.onSave());
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  const byTouch = await swapped();
  t.check('a click or a tap that the partner’s news rebuilds the level select under presses its button once', byMouse !== before && byTouch === before, { before, byMouse, byTouch });
  // the room waiting for a partner: its status changing doesn't rebuild the card (nor re-arm its guard)
  await page.evaluate(() => window.__fb.flow.title());
  await page.evaluate(() => window.__fb.flow.online());
  await waitFor(async () => (await screenName(page)) === 'OnlineScreen', 4000, 'online');
  await sleep(400);
  const kept = await page.evaluate(() => {
    const s = window.__fb.app.current;
    const l = { role: 'host', code: 'AB2C', status: 'connecting', detail: '', rtt: 0, via: null, peerId: null, peerGen: 0, myId: 'me', connected: false,
      send() {}, sendSnap() {}, close() {}, sharedNow: () => performance.now(), onStatus: null, onCtrl: null, onSnap: null };
    window.__fb.flow.adopt(l);
    s.go('host');
    const share = document.querySelector('[data-act="share"]');
    l.status = 'waiting';
    s.onLinkStatus('waiting', '');
    return { same: share === document.querySelector('[data-act="share"]'), status: document.querySelector('.status')?.textContent.trim() };
  });
  t.check('the room’s status changing ("waiting for your partner…") rebuilds nothing under the finger', kept.same && /waiting for your partner/.test(kept.status), kept);
  t.check('no errors (rebuilt mid-click)', !page.errors.length, page.errors.join('\n'));
  await page.evaluate(() => window.__fb.flow.title());
  await page.close();
}
// ---- building a level forces no layout: the HUD's seed counter restarted its pop with a forced reflow even
// for the level's first figure, in the frame of the press, with the screen being left still in the page
{
  const page = await open(browser);
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await sleep(300);
  const reads = await page.evaluate(() => {
    const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    let n = 0;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { n++; return was.get.call(this); } });
    try {
      const f = window.__fb.flow;
      f.mode = 'local';
      f.seats = ['keysL', 'keysR'];
      f.enterLevel(0);
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', was);
    }
    return n;
  });
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session'), 8000, 'level');
  await sleep(300);
  const pops = await page.evaluate(() => { window.__fbSession.hud.setSeeds(5, 43); return document.querySelector('.hud-seeds').getAnimations().length > 0; });
  t.check('building a level reads no layout for its HUD, and a seed still makes the counter pop', reads === 0 && pops, { offsetWidthReads: reads, pops });
  t.check('no errors (HUD build)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}
// ---- the debug ground's readout is rewritten ten times a second at most, not every frame (each rewrite
// is a style and layout pass, on the phone whose frame rate the panel is there to look at)
{
  const page = await open(browser, { query: { hash: 'debug=1' } });
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session' && !!document.querySelector('.dbg-out')), 8000, 'the debug ground');
  await sleep(1000);
  const perSecond = await page.evaluate(() => new Promise((done) => {
    let n = 0;
    const mo = new MutationObserver((list) => { n += list.length; });
    mo.observe(document.querySelector('.dbg-out'), { childList: true, characterData: true, subtree: true });
    setTimeout(() => { mo.disconnect(); done(n / 2); }, 2000);
  }));
  const text = await page.evaluate(() => document.querySelector('.dbg-out').textContent);
  t.check(`the debug readout is rewritten at most ten times a second (${perSecond}/s)`, perSecond <= 11 && /fps/.test(text), { perSecond });
  t.check('no errors (debug readout)', !page.errors.length, page.errors.join('\n'));
  await page.close();
}
await browser.close();
t.finish('menus', []);
