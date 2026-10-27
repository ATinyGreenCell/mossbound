// Menus with every kind of input: keyboard through the title and settings (which persist), a
// controller through the controls card and out of the room-code and name boxes, phone layout, Xbox,
// the level select's CONTINUE, a fresh room code over an old one, and guards against a stray Ⓐ.
import { XBOX_UA, frames, launch, open, padPress, reporter, screenName, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const t = reporter();
const key = async (page, k) => { await page.keyboard.press(k); await frames(page, 2); };
const sel = (page) => page.evaluate(() => document.querySelector('.sel')?.textContent?.trim() ?? '');

// ---- keyboard: title → settings → name, color, music → back; it all persists
{
  const page = await open(browser);
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await sleep(450);
  t.check('the title highlights PLAY ONLINE', (await sel(page)) === 'PLAY ONLINE', await sel(page));
  for (let i = 0; i < 3; i++) await key(page, 'ArrowDown');
  t.check('arrows walk the menu', (await sel(page)) === 'SETTINGS', await sel(page));
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
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowRight');
    await frames(page, 1);
  }
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

// ---- Xbox: the "use game controls" hint
{
  const page = await open(browser, { ua: XBOX_UA });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  const hint = await page.evaluate(() => document.querySelector('.xbox-hint')?.textContent ?? '');
  t.check('Xbox shows how to hand the controller to the game', /Use game controls/.test(hint), hint);
  await page.close();
}
await browser.close();
t.finish('menus', []);
