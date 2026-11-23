// The game on each kind of screen: on a phone held sideways no text is smaller than 11 px, and the cards
// still fit down to 568×320; on an Xbox the whole UI is drawn for reading across a room, and grows with
// the screen rather than stopping at a laptop's size. On a phone, turning it upright pauses a local
// level under the rotate prompt; a thumb slides from one touch button onto the next; the stick keeps
// clear of the edge the system's back gesture lives on; and the screen stays on while a room is open.
import { XBOX_UA, frames, launch, open, reporter, screenName, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const t = reporter();
const errors = [];
const done = async (page) => {
  errors.push(...page.errors);
  await page.close();
};
const PHONE = { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true };
const SMALL = { width: 568, height: 320, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true };
const SAVE = { unlocked: 6, levels: { garden: { seeds: 3, feathers: 5, time: 100, clears: 1 } }, finished: false, run: { level: 2, cp: 0, seeds: [1, 2], feathers: 0, time: 30, with: 'Pip & Bo' }, runAt: 1 };
const guestRoom = (page, role = 'guest', status = 'connected') => page.evaluate((role, status) => {
  const l = {
    role, code: 'K7QX', status, detail: '', rtt: 40, via: 'direct', peerId: 'p', peerGen: 1, myId: 'me', closed: false,
    onStatus: null, onCtrl: null, onSnap: null,
    get connected() { return this.status === 'connected'; },
    sharedNow() { return performance.now(); },
    send() {},
    sendSnap() { return true; },
    close() { this.closed = true; this.status = 'lost'; },
  };
  window.__link = l;
  window.__fb.flow.link = l;
  window.__fb.flow.mode = 'online';
}, role, status);

/** Every piece of text on screen: its size, and whether it spills out of the box it's in. */
const texts = (page) => page.evaluate(() => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const s = n.textContent.trim();
    const el = n.parentElement;
    if (!s || !el || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    out.push({ px: parseFloat(getComputedStyle(el).fontSize), text: s.slice(0, 30), cls: String(el.className || el.tagName) });
  }
  return out;
});
/** What spills: the page sideways, a panel or card past the screen's sides, text out of a card or button. */
const spills = (page) => page.evaluate(() => {
  const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`page ${document.documentElement.scrollWidth}`);
  for (const el of document.querySelectorAll('.panel, .ov-card, .menu')) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.left < -1 || r.right > innerWidth + 1)) bad.push(`${el.className} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  for (const el of document.querySelectorAll('.card, .btn')) if (el.offsetParent && el.scrollWidth > el.clientWidth + 1) bad.push(`${el.className}: ${el.textContent.trim().slice(0, 20)}`);
  return bad;
});
/** Visit each kind of screen; `look(name)` is called on each. */
async function tour(page, look) {
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'TitleScreen'), 8000, 'title');
  await sleep(500);
  // (the update's pill, as update.ts builds it: the smallest text there was)
  await page.evaluate(() => { const p = document.createElement('div'); p.className = 'update-pill'; p.innerHTML = '<b>✦ a new version is ready</b><span>it loads at the next lantern</span>'; window.__fb.app.ui.appendChild(p); });
  await frames(page, 2);
  await look('title');
  await page.evaluate(() => document.querySelector('.update-pill')?.remove());
  await page.evaluate(() => window.__fbTitle.act('settings'));
  await waitFor(() => page.evaluate(() => !!document.querySelector('.panel.settings')), 3000, 'settings');
  await frames(page, 2);
  await look('settings');
  await page.evaluate(() => document.querySelectorAll('.settings details').forEach((d) => (d.open = true)));
  await frames(page, 2);
  await look('settings, both sections open');
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keys', 'keysR']; f.levels(); });
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'LevelSelect'), 5000, 'levels');
  await sleep(300);
  await look('levels');
  await page.evaluate(() => window.__fb.flow.online());
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'OnlineScreen'), 5000, 'online');
  await sleep(200);
  await look('online');
  await page.evaluate(() => window.__fb.flow.local());
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'LocalScreen'), 5000, 'lobby');
  await sleep(200);
  await look('lobby');
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keys', 'keysR']; f.playLevel(1); });
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session'), 8000, 'level');
  await sleep(500);
  await page.evaluate(() => window.__fbSession.togglePause());
  await sleep(200);
  await look('pause');
  await page.evaluate(() => window.__fbSession.togglePause());
  await page.evaluate(() => { const s = window.__fbSession; const n = s.L.nest; s.devTeleport(n.x - 12, n.y - 4, 0); s.devTeleport(n.x + 12, n.y - 4, 1); });
  await waitFor(() => page.evaluate(() => !!document.querySelector('.overlay.clear .ov-stats')), 6000, 'clear card');
  await sleep(200);
  await look('clear');
}

// ---- 16. phones: no text under 11 px, and nothing spills, on a phone and on the smallest one held sideways
for (const [name, viewport] of [['844×390', PHONE], ['568×320', SMALL]]) {
  // (the save goes in once the page is up: the harness's seeding meets about:blank on a phone viewport)
  const page = await open(browser, { viewport });
  await page.evaluate((save) => localStorage.setItem('mossbound.save.v2', JSON.stringify(save)), SAVE);
  await page.reload({ waitUntil: 'networkidle0' });
  const small = [];
  const spilt = [];
  await tour(page, async (scene) => {
    for (const x of await texts(page)) if (x.px < 11) small.push(`${scene}: ${x.px.toFixed(1)}px ${x.cls} 「${x.text}」`);
    for (const s of await spills(page)) spilt.push(`${scene}: ${s}`);
  });
  t.check(`${name}: no text on screen is smaller than 11 px`, !small.length, small.slice(0, 8));
  t.check(`${name}: nothing spills — off the sides, or out of a card or a button`, !spilt.length, spilt.slice(0, 8));
  await done(page);
}

// ---- 16. the TV: the 10-foot UI — no text under 18 px at 1080p, the level select, settings and pause
// menu still on one screen, and a 4K viewport drawn twice as big rather than half the size
{
  const page = await open(browser, { ua: XBOX_UA, viewport: { width: 1920, height: 1080 }, storage: { 'mossbound.save.v2': SAVE } });
  const small = [];
  const over = [];
  let least = Infinity;
  await tour(page, async (scene) => {
    for (const x of await texts(page)) {
      least = Math.min(least, x.px);
      if (x.px < 18) small.push(`${scene}: ${x.px.toFixed(1)}px ${x.cls} 「${x.text}」`);
    }
    if (scene === 'levels' || scene === 'settings' || scene === 'pause') {
      const fits = await page.evaluate(() => [...document.querySelectorAll('.panel, .ov-card')].filter((el) => el.offsetParent).every((el) => el.scrollHeight <= el.clientHeight + 1 && el.getBoundingClientRect().bottom <= innerHeight));
      if (!fits) over.push(scene);
    }
  });
  t.check('TV 1920×1080: no text smaller than 18 px (it was 12)', !small.length, { least, small: small.slice(0, 6) });
  t.check('TV 1920×1080: the level select, settings and the pause menu each fit on the screen', !over.length, over);
  const button = () => page.evaluate(() => document.querySelector('.ov-card .btn, .btn')?.getBoundingClientRect().height ?? 0);
  const h1080 = await button();
  await page.setViewport({ width: 3840, height: 2160 });
  await frames(page, 3);
  const h2160 = await button();
  t.check('TV: a 4K viewport draws the UI twice as big (not capped at a laptop’s size)', Math.abs(h2160 / h1080 - 2) < 0.1, { h1080, h2160 });
  await done(page);
}

// ---- 17a. turning a phone upright over a local level pauses it under the rotate prompt; online
// nothing pauses (the partner plays on)
{
  const page = await open(browser, { viewport: PHONE });
  const cdp = await page.createCDPSession();
  const tap = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keys', 'keysR']; f.playLevel(0); });
  await waitFor(async () => (await screenName(page)) === 'Session', 6000, 'level');
  await sleep(500);
  await tap(422, 200);
  await waitFor(() => page.evaluate(() => document.querySelector('.tc')?.style.display !== 'none'), 3000, 'touch controls');
  const state = () => page.evaluate(() => ({ paused: window.__fbSession.paused, menu: !!document.querySelector('.overlay'), prompt: getComputedStyle(document.querySelector('.tc-rotate')).display !== 'none' }));
  const before = await state();
  await page.setViewport({ ...PHONE, width: 390, height: 844, isLandscape: false });
  await frames(page, 4);
  const upright = await state();
  await page.setViewport(PHONE);
  await frames(page, 4);
  const back = await state();
  t.check('a local level pauses when the phone is turned upright (the rotate prompt covers it), and stays paused', !before.paused && upright.prompt && upright.paused && upright.menu && back.paused && !back.prompt, { before, upright, back });
  // online: the same turn pauses nothing
  await guestRoom(page, 'host');
  await page.evaluate(async () => {
    const { Session } = await import('/src/game/session.ts');
    const { app, flow } = window.__fb;
    app.setScreen(new Session(app, flow, { level: 0, mode: 'online', link: window.__link, me: 0, nonce: 3, profiles: flow.profiles() }));
  });
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session' && window.__fbSession.online), 6000, 'online level');
  await sleep(300);
  await page.setViewport({ ...PHONE, width: 390, height: 844, isLandscape: false });
  await frames(page, 4);
  const online = await state();
  await page.setViewport(PHONE);
  t.check('online, turning the phone upright pauses nothing', online.prompt && !online.paused && !online.menu, online);
  await done(page);
}

// ---- 17b, c. a thumb that slides from one touch button onto another presses that one (and off onto
// nothing keeps what it had); the stick keeps its own finger; and the stick leaves the edge strip alone
{
  const page = await open(browser, { viewport: PHONE });
  const cdp = await page.createCDPSession();
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keys', 'keysR']; f.playLevel(0); });
  await waitFor(async () => (await screenName(page)) === 'Session', 6000, 'level');
  await sleep(500);
  await touch('touchStart', [[422, 200, 9]]);
  await touch('touchEnd', []);
  await waitFor(() => page.evaluate(() => document.querySelector('.tc')?.style.display !== 'none'), 3000, 'touch controls');
  // count every button press the controls make
  await page.evaluate(() => {
    const T = window.__fbTouch;
    const press = T.press.bind(T);
    window.__presses = [];
    T.press = (b, ...rest) => { window.__presses.push(b.def.id); return press(b, ...rest); };
  });
  const centre = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  const now = () => page.evaluate(() => ({ on: [...document.querySelectorAll('.tc-btn.on')].map((el) => [...el.classList].find((c) => c.startsWith('tc-') && c !== 'tc-btn').slice(3)), jump: window.__fb.app.input.touch.jump, presses: [...window.__presses] }));
  const [jx, jy] = await centre('.tc-jump');
  const [tx, ty] = await centre('.tc-tug');
  await touch('touchStart', [[jx, jy, 1]]);
  await frames(page, 2);
  const onJump = await now();
  await touch('touchMove', [[(jx + tx) / 2, (jy + ty) / 2, 1]]);
  await touch('touchMove', [[tx, ty, 1]]);
  await frames(page, 2);
  const onTug = await now();
  await touch('touchMove', [[jx, jy, 1]]);
  await frames(page, 2);
  const backOnJump = await now();
  // off onto empty screen: JUMP stays held, as it always did
  await touch('touchMove', [[jx - 160, jy - 160, 1]]);
  await frames(page, 2);
  const offAll = await now();
  await touch('touchEnd', []);
  await frames(page, 2);
  const lifted = await now();
  t.check('a thumb sliding from JUMP onto TUG presses TUG (and lets go of JUMP); sliding back presses JUMP', onJump.jump && onTug.on.join() === 'tug' && !onTug.jump && onTug.presses.join() === 'jump,tug' && backOnJump.jump && backOnJump.presses.join() === 'jump,tug,jump', { onJump, onTug, backOnJump });
  t.check('…off onto nothing it keeps JUMP held, and lifting lets go', offAll.jump && offAll.on.join() === 'jump' && !lifted.jump && !lifted.on.length, { offAll, lifted });
  // the stick's thumb, wandering over the buttons, presses none of them
  await page.evaluate(() => { window.__presses.length = 0; });
  await touch('touchStart', [[150, 300, 2]]);
  await touch('touchMove', [[tx, ty, 2]]);
  await frames(page, 2);
  const stickOver = await now();
  await touch('touchEnd', []);
  t.check('the stick keeps its own finger: sliding it over the buttons presses nothing', !stickOver.presses.length && !stickOver.on.length, stickOver);
  // the strip along the left edge (Android's back gesture) is not the stick's
  const stick = () => page.evaluate(() => ({ on: document.querySelector('.tc-stick').classList.contains('on'), x: window.__fb.app.input.touch.moveX }));
  await touch('touchStart', [[8, 300, 3]]);
  await touch('touchMove', [[70, 300, 3]]);
  await frames(page, 2);
  const edge = await stick();
  await touch('touchEnd', []);
  await frames(page, 2);
  await touch('touchStart', [[30, 300, 4]]);
  await touch('touchMove', [[150, 300, 4]]);
  await frames(page, 2);
  const inside = await stick();
  await touch('touchEnd', []);
  const zone = await page.evaluate(() => Math.round(document.querySelector('.tc-zone').getBoundingClientRect().left));
  t.check('a thumb in the 18 px strip at the left edge is the system’s, not the stick’s; just inside, the stick works', !edge.on && edge.x === 0 && inside.on && inside.x > 0.5 && zone >= 16 && zone <= 20, { edge, inside, zone });
  await done(page);
}

// ---- 17d. the screen stays on whenever a room is open — waiting for a partner, the partner picking —
// not only inside a level; and it is let go once the room is
{
  const page = await open(browser, { viewport: PHONE });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.evaluate(() => {
    window.__wake = { held: 0, asks: 0 };
    const lock = { request: async () => { window.__wake.held++; window.__wake.asks++; const s = { released: false, release: async () => { if (!s.released) { s.released = true; window.__wake.held--; } } }; return s; } };
    Object.defineProperty(navigator, 'wakeLock', { value: lock, configurable: true });
  });
  const held = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => done(window.__wake.held), 50)))));
  const title = await held();
  // the host's room, waiting for a partner
  await page.evaluate(() => window.__fb.flow.online());
  await waitFor(async () => (await screenName(page)) === 'OnlineScreen', 4000, 'online');
  await guestRoom(page, 'host', 'waiting');
  await page.evaluate(() => window.__fb.app.current.go('host'));
  const waiting = await held();
  // the guest, while the partner picks a level
  await page.evaluate(() => window.__fb.flow.title());
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 4000, 'title');
  const closed = await held();
  await guestRoom(page, 'guest');
  await page.evaluate(() => window.__fb.flow.levels());
  await waitFor(async () => (await screenName(page)) === 'LevelSelect', 4000, 'levels');
  const picking = await held();
  // and left
  await page.evaluate(() => window.__fb.flow.leaveOnline());
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 4000, 'title again');
  const left = await held();
  t.check('the screen is kept on while a room is open (host waiting, guest while the partner picks), and let go after', title === 0 && waiting === 1 && closed === 0 && picking === 1 && left === 0, { title, waiting, closed, picking, left });
  await done(page);
}

await browser.close();
process.exit(t.finish('devices', errors) ? 0 : 1);
