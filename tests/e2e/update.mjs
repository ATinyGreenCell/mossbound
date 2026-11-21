// A new build taken by itself (update.ts): at a moment that costs nothing, with the players put back
// where they were and the journal untouched — and never in an online room. Plus the Xbox's 1080-row cap.
import { XBOX_UA, launch, open, padPress, reporter, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const t = reporter();
const errors = [];
const A = 0;
/** evaluate, but a page in the middle of reloading answers null rather than throwing */
const ev = (p, fn, ...args) => p.evaluate(fn, ...args).catch(() => null);
/** the page went away and a new one booted (the marker set before the update is gone) */
const reloaded = (p) => waitFor(() => ev(p, () => !window.__marker && !!window.__fb?.app?.current), 20000, 'the reload');
const inLevel = (p, id) => waitFor(() => ev(p, (id) => window.__fbSession?.L.def.id === id && window.__fb.app.current === window.__fbSession, id), 10000, `in ${id}`);
const local = (seats) => { const f = window.__fb.flow; f.mode = 'local'; f.seats = seats; f.seatGen = seats.map((s) => window.__fb.app.input.device(s)?.generation ?? 0); };

// ---- the version badge: on every menu and card, never over a level being played, and it says when
// the site has something newer than what is running (the stale guard)
{
  const page = await open(browser);
  const badge = () => ev(page, () => { const b = document.querySelector('.version-badge'); return b ? { text: b.textContent, stale: b.classList.contains('stale') } : null; });
  await waitFor(() => ev(page, () => window.__fb.app.current?.constructor.name === 'TitleScreen'), 8000, 'the title');
  await sleep(700);
  const version = await page.evaluate(() => window.__fbUpdate.version);
  const onTitle = await badge();
  await page.evaluate((v) => window.__fbUpdate.checked(v), version);
  const latest = await badge();
  await page.evaluate(local, ['keysL', 'keysR']);
  await page.evaluate(() => window.__fb.flow.playLevel(0));
  await inLevel(page, 'garden');
  await sleep(800);
  const inPlay = await badge();
  await page.keyboard.press('Escape');
  await waitFor(() => ev(page, () => !!document.querySelector('.overlay .btn[data-act=resume]')), 4000, 'the pause card');
  await sleep(700);
  const paused = await badge();
  // the site has something newer: it says so while it waits for its moment
  await page.evaluate(() => { window.__marker = 1; window.__fbUpdate.checked('9.9.20'); });
  await sleep(700);
  const waiting = await badge();
  t.check(`the title shows which version this is (${onTitle?.text})`, !!onTitle && onTitle.text.includes(`v${version}`), onTitle);
  t.check(`…and, once the site agrees, that it's the latest (${latest?.text})`, /latest ✓/.test(latest?.text ?? '') && !latest.stale, latest);
  t.check('…not over a level being played', inPlay === null, inPlay);
  t.check(`…but on the pause card (${paused?.text})`, /latest ✓/.test(paused?.text ?? ''), paused);
  t.check(`…and a newer build on the site shows while it waits for its moment (${waiting?.text})`, /9\.9\.20 is out/.test(waiting?.text ?? '') && waiting.stale, waiting);
  errors.push(...page.errors);
  await page.close();
}
{
  // the stale guard: a version that two reloads in a row didn't bring in (a stale cache somewhere) is
  // not reloaded for again — and the badge says plainly that this isn't the latest
  const page = await open(browser);
  await waitFor(() => ev(page, () => window.__fb.app.current?.constructor.name === 'TitleScreen'), 8000, 'the title');
  await page.evaluate(() => { sessionStorage.setItem('mossbound.update.tried', JSON.stringify({ v: '9.9.30', n: 2, at: Date.now() })); window.__marker = 1; window.__fbUpdate.checked('9.9.30'); });
  await sleep(1500);
  const after = await ev(page, () => ({ marker: window.__marker ?? 0, text: document.querySelector('.version-badge')?.textContent ?? '', stale: !!document.querySelector('.version-badge.stale') }));
  t.check(`a build two reloads couldn't bring in isn't reloaded for a third time, and the badge says so (${after?.text})`, after?.marker === 1 && /9\.9\.30 is out — reload to get it/.test(after.text) && after.stale, after);
  errors.push(...page.errors);
  await page.close();
}

// ---- at the level select: it loads at once and comes back to the level select, seats and all
{
  const page = await open(browser);
  await page.evaluate(local, ['keysL', 'keysR']);
  await page.evaluate(() => window.__fb.flow.levels());
  await waitFor(() => ev(page, () => document.querySelectorAll('.levels-screen').length === 1 && window.__fb.app.current?.constructor.name === 'LevelSelect'), 8000, 'the level select');
  const save0 = await page.evaluate(() => localStorage.getItem('mossbound.save.v3'));
  await page.evaluate(() => { window.__marker = 1; window.__fbUpdate.found('9.9.1'); });
  await reloaded(page);
  await waitFor(() => ev(page, () => window.__fb.app.current?.constructor.name === 'LevelSelect'), 8000, 'back at the level select').catch(() => false);
  const at = await page.evaluate(() => ({ screen: window.__fb.app.current?.constructor.name, mode: window.__fb.flow.mode, seats: window.__fb.flow.seats.join(), toast: document.querySelector('.update-toast')?.textContent ?? null }));
  const save1 = await page.evaluate(() => localStorage.getItem('mossbound.save.v3'));
  t.check('at the level select an update loads at once and comes back to the level select', at.screen === 'LevelSelect' && at.mode === 'local' && at.seats === 'keysL,keysR', at);
  t.check('…says that it updated', /updated to/.test(at.toast ?? ''), at.toast);
  t.check('…and leaves the journal exactly as it was', save0 === save1, { save0, save1 });
  errors.push(...page.errors);
  await page.close();
}

// ---- in a level on one screen: it waits, and says so, until a lantern is lit — then comes back to that lantern
for (const [level, id] of [[0, 'garden'], [-1, 'course']]) {
  const page = await open(browser);
  await page.evaluate(local, ['keysL', 'keysR']);
  await page.evaluate((i) => window.__fb.flow.playLevel(i), level);
  await inLevel(page, id);
  await sleep(300);
  await page.evaluate((v) => { window.__marker = 1; window.__fbUpdate.found(v); }, `9.9.${level + 3}`);
  await sleep(1500);
  const waiting = await page.evaluate(() => ({ marker: window.__marker ?? 0, pill: document.querySelector('.update-pill')?.textContent ?? null }));
  t.check(`${id}: mid-level it waits, and says it will load at the next lantern`, waiting.marker === 1 && /next lantern/.test(waiting.pill ?? ''), waiting);
  const before = await page.evaluate(() => { const s = window.__fbSession; s.takeSeed(0, true); s.takeSeed(1, true); s.light(0, true); return { cp: s.checkpoint, seeds: [...s.seedTaken].filter(Boolean).length }; });
  await reloaded(page);
  await inLevel(page, id);
  const after = await page.evaluate(() => { const s = window.__fbSession; return { cp: s.checkpoint, seeds: [...s.seedTaken].filter(Boolean).length, seats: s.opts.seats.join(), online: s.online }; });
  t.check(`${id}: the lantern brings it in, and the level comes back at that lantern with what was found (${before.cp} → ${after.cp})`, after.cp === before.cp && after.cp >= 0 && after.seeds === before.seeds && after.seats === 'keysL,keysR' && !after.online, { before, after });
  if (id === 'garden') {
    const run = await page.evaluate(() => JSON.parse(localStorage.getItem('mossbound.save.v3') ?? '{}').runs?.garden?.run ?? null);
    t.check('…and the journal holds that lantern and those seeds', run?.cp === before.cp && run?.seeds?.length === before.seeds, run);
  } else {
    const stored = await page.evaluate(() => localStorage.getItem('mossbound.save.v3') ?? '');
    t.check('…the course still writes nothing down', !/course/.test(stored), stored.slice(0, 200));
  }
  errors.push(...page.errors);
  await page.close();
}

// ---- controllers: a freshly loaded page shows no pad until it is pressed. After the reload the seats
// wait for each pad's first appearance, so the press that wakes it is already its player's
/** Two pads seated, in the Garden, then an update at a lantern: the page after the reload, pads hidden again. */
async function reloadWithPads(v) {
  const page = await open(browser, { pads: 2, hidePads: true });
  await page.evaluate(() => { window.__padsHidden = false; });
  await waitFor(() => ev(page, () => !!window.__fb.app.input.device('pad1')?.connected), 4000, 'the pads');
  await page.evaluate(local, ['pad0', 'pad1']);
  await page.evaluate(() => window.__fb.flow.playLevel(0));
  await inLevel(page, 'garden');
  await page.evaluate((v) => { window.__marker = 1; window.__fbUpdate.found(v); }, v);
  await sleep(600);
  await page.evaluate(() => window.__fbSession.light(0, true));
  await reloaded(page);
  await inLevel(page, 'garden');
  return page;
}
const seatState = (page) => page.evaluate(() => ({ seats: window.__fbSession.seats.join(), lost: window.__fbSession.seatLost, notice: document.querySelector('.hud-notice')?.textContent ?? '' }));
{
  const page = await reloadWithPads('9.9.9');
  const hidden = await page.evaluate(() => !window.__fb.app.input.device('pad1')?.connected && !window.__fb.app.input.device('pad0')?.connected);
  const waiting = await seatState(page);
  // (a sprout put back at a lantern drops onto it first: measure the jump from the ground, not from
  // wherever it happened to be on a runner drawing three frames a second)
  await waitFor(() => ev(page, () => window.__fbSession.birds[1].grounded), 4000, 'player 2 on the ground').catch(() => undefined);
  const y0 = await page.evaluate(() => window.__fbSession.birds[1].y);
  await page.evaluate(() => { window.__padsHidden = false; });
  // press until it takes, as a player does (the first press is also the one that shows the pad)
  const jumped = await waitFor(async () => {
    await padPress(page, 1, A, 4);
    return ev(page, (y) => window.__fbSession.birds[1].y < y - 8 || window.__fbSession.birds[1].vy < -100, y0);
  }, 4000, 'the jump').catch(() => false);
  const state = await seatState(page);
  t.check('after the reload the pads are hidden until pressed, as a browser does', hidden);
  t.check('…and their seats wait for them rather than calling them lost', !waiting.lost.some(Boolean) && !/disconnected/.test(waiting.notice), waiting);
  t.check('…and player 2\'s pad jumps player 2\'s sprout, seats unswapped', !!jumped && state.seats === 'pad0,pad1' && !state.lost.some(Boolean) && !/disconnected/.test(state.notice), state);
  errors.push(...page.errors);
  await page.close();
}
{
  // a pad that never comes back: after the wait, the usual notice and "press Ⓐ to take it back"
  const page = await reloadWithPads('9.9.10');
  await sleep(6000);
  const state = await seatState(page);
  t.check('a pad that never turns up after the reload is a lost controller after a few seconds, with the notice', state.lost.some(Boolean) && /disconnected/.test(state.notice), state);
  errors.push(...page.errors);
  await page.close();
}

// ---- an online room: never — a reload would drop the partner
{
  const page = await open(browser);
  await page.evaluate(() => {
    const l = { role: 'host', code: 'ABCD', status: 'connected', connected: true, peerGen: 0, rtt: 30, via: 'direct', sent: [], send(m) { this.sent.push(m); }, sendSnap: () => true, close() {}, sharedNow: () => performance.now(), onStatus: null, onCtrl: null, onSnap: null };
    window.__fb.flow.adopt(l);
    window.__fb.flow.playLevel(0);
  });
  await inLevel(page, 'garden');
  await page.evaluate(() => { window.__marker = 1; window.__fbUpdate.found('9.9.8'); });
  await sleep(600);
  await page.evaluate(() => window.__fbSession.light(0, true));
  await sleep(1500);
  await page.evaluate(() => window.__fb.flow.levels());
  await sleep(1500);
  const still = await ev(page, () => window.__marker === 1);
  t.check('in an online room it never reloads — not at a lantern, not at the level select', still === true);
  errors.push(...page.errors);
  await page.close();
}

// ---- an Xbox draws at most 1080 rows (a 4K TV across the room was over twice the pixels of 1080p)
{
  const rows = {};
  for (const [name, ua] of [['xbox', XBOX_UA], ['laptop', undefined]]) {
    const page = await open(browser, { ua, viewport: { width: 1920, height: 1080, deviceScaleFactor: 2 } });
    await page.evaluate(() => { window.__fb.flow.mode = 'local'; window.__fb.flow.playLevel(0); });
    await inLevel(page, 'garden');
    await sleep(400);
    rows[name] = await page.evaluate(() => document.querySelector('canvas').height);
    errors.push(...page.errors);
    await page.close();
  }
  t.check(`an Xbox draws at most 1080 rows at 4K output (xbox ${rows.xbox}, laptop ${rows.laptop})`, rows.xbox <= 1080 && rows.xbox >= 1000 && rows.laptop > 1080, rows);
}

await browser.close();
t.finish('update', errors);
