// Quitting and coming back: wherever the two of you stopped is where you carry on — whatever else was
// played in between, however the page went away (closed, discarded by a phone, quit a moment after a
// pickup), whichever device's clock is off, with two tabs open, or a save this build can't fully read.
// Each check goes through the game itself (its menus, its own save and reload), so it holds for any
// save format: seeded saves are written in 1.0.0's format, which every build reads.
import { gameTime, launch, open, reporter, sleep, url, waitFor } from './harness.mjs';

const t = reporter();
const errors = [];
const browsers = [];
/** 1.0.0's save (key and format): the first four levels open, nothing else */
const V2 = 'mossbound.save.v2';
const OPEN = { unlocked: 3, levels: {}, finished: false, run: null, runAt: 0 };

const booted = (page) => waitFor(() => page.evaluate(() => !!window.__fb?.app?.current), 20000, 'boot');
const reload = async (page) => {
  await page.reload({ waitUntil: 'networkidle0' });
  await booted(page);
};
/** A device (its own browser, so its own storage) holding `seed`; `skew` sets its clock that far off. */
async function device(seed, { skew = 0, browser } = {}) {
  const b = browser ?? (await launch());
  if (!browser) browsers.push(b);
  const page = await open(b);
  if (skew) await page.evaluateOnNewDocument((ms) => { const real = Date.now.bind(Date); Date.now = () => real() + ms; }, skew);
  // (seeded once, not on every load — what the game saves must be what the next load sees)
  await page.evaluate((key, seed) => { localStorage.clear(); if (seed) localStorage.setItem(key, JSON.stringify(seed)); }, V2, seed ?? null);
  await reload(page);
  return page;
}
const now = (page) => page.evaluate(() => window.__fb.app.current?.constructor.name);
async function play(page, i) {
  await page.evaluate((i) => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keysL', 'keysR']; f.playLevel(i); }, i);
  await waitFor(() => page.evaluate((i) => window.__fb.app.current?.constructor.name === 'Session' && window.__fbSession?.L.index === i, i), 5000, `level ${i}`);
  await sleep(300);
}
/** The level select, past its click guard. */
async function levels(page) {
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keysL', 'keysR']; f.levels(); });
  // Wait for there to be exactly one level select. A screen change is taken up at the start of the
  // NEXT frame, so until then the one being left is still in the document — and if that was also a
  // level select, a querySelector finds ITS cards, built before whatever just happened. Asking
  // `app.current` is no help either: it is still the outgoing screen until the swap. Half a second
  // covered the gap on a screen and is less than one frame on a runner without a GPU.
  await waitFor(() => page.evaluate(() => document.querySelectorAll('.levels-screen').length === 1 && window.__fb.app.current?.constructor.name === 'LevelSelect'), 8000, 'one level select on screen');
}
const text = (page, sel) => page.evaluate((sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() ?? '', sel);
/** Click a card on the level select and wait to be in that level. */
async function pick(page, act, level) {
  await page.click(`[data-act="${act}"]`);
  await waitFor(() => page.evaluate((i) => window.__fbSession?.L.index === i && window.__fb.app.current?.constructor.name === 'Session', level), 5000, `into level ${level}`);
}
const where = (page) => page.evaluate(() => { const s = window.__fbSession; return { cp: s.checkpoint, feathers: s.feathers, seeds: [...s.seedTaken].filter(Boolean).length, time: +s.time.toFixed(2) }; });
async function finish(page) {
  await page.evaluate(() => { const s = window.__fbSession; const n = s.L.nest; s.devTeleport(n.x - 12, n.y - 4, 0); s.devTeleport(n.x + 12, n.y - 4, 1); });
  await waitFor(() => page.evaluate(() => window.__fbSession?.state === 'clear'), 8000, 'level clear');
}
/** The game's own save module (the same copy the game uses). */
const saveModule = 'window.__fb.save ?? (await import("/src/core/save.ts"))';
async function scenario(name, fn) {
  try {
    await fn();
  } catch (e) {
    t.check(`${name} — ran to the end`, false, String(e?.message ?? e));
  }
}

// ---- replaying another level (a missing feather, a better time) never costs the adventure's lantern
await scenario('replay', async () => {
  const page = await device(OPEN);
  await play(page, 2);
  await page.evaluate(() => { const s = window.__fbSession; s.light(1, true); for (const i of [0, 1, 2]) s.takeFeather(i, true); s.takeSeed(0, true); });
  await sleep(2500);
  await levels(page);
  await play(page, 0);
  await page.evaluate(() => window.__fbSession.takeSeed(1, true));
  await sleep(300);
  await finish(page);
  await sleep(1500);
  await reload(page);
  await levels(page);
  const lit = await page.evaluate(() => document.querySelectorAll('[data-act="lvl:2"] .feather-ico.on').length);
  await pick(page, 'lvl:2', 2);
  const mill = await where(page);
  t.check(`after replaying the Garden, the Old Mill carries on from its lantern (${mill.cp + 1})`, mill.cp === 1 && mill.feathers === 7 && mill.seeds === 1, mill);
  t.check(`feathers found in a level not yet finished are kept (${lit} of 3 on its card)`, lit === 3, lit);
  errors.push(...page.errors);
});

// ---- a lantern, then the tab is closed — or the phone switches apps and later discards the page
await scenario('page gone', async () => {
  const page = await device(OPEN);
  await play(page, 0);
  await page.evaluate(() => window.__fbSession.light(0, true));
  await page.goto('about:blank');
  await page.goto(url());
  await booted(page);
  await levels(page);
  const closed = await text(page, '[data-act="continue"]');
  await play(page, 1);
  await page.evaluate(() => { window.__fbSession.light(0, true); Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const cdp = await page.createCDPSession();
  // (a crashed page never answers: don't wait for it to)
  await Promise.race([cdp.send('Page.crash').catch(() => undefined), sleep(1500)]);
  const again = await open(page.browser());
  await levels(again);
  const discarded = await text(again, '[data-act="continue"]');
  t.check(`a lantern lit just before the tab closed is kept (“${closed}”)`, /lantern 1/.test(closed), closed);
  t.check(`a lantern lit just before the phone hid (and later dropped) the page is kept (“${discarded}”)`, /Woodland/.test(discarded) && /lantern 1/.test(discarded), discarded);
  errors.push(...again.errors);
});

// ---- quitting: the time played since the last pickup, and a seed picked up a moment before, both count
await scenario('quit', async () => {
  const page = await device(OPEN);
  await play(page, 0);
  await page.evaluate(() => window.__fbSession.takeSeed(0, true));
  // six seconds of the GAME's clock, which is what the run records. Six seconds of sleeping is six
  // seconds of play only where the two clocks agree; at three frames a second it bought 0.85 s of
  // game time and the check then compared that against a run clock, honestly, and lost.
  await gameTime(page, 6);
  const played = await page.evaluate(() => window.__fbSession.time);
  await levels(page);
  await sleep(1500);
  await reload(page);
  await levels(page);
  await pick(page, 'continue', 0);
  const back = await where(page);
  t.check(`the clock carries on from where we quit (${back.time} s of ${played.toFixed(2)} s)`, back.time >= played - 0.5, { back, played });
  await page.evaluate(() => window.__fbSession.takeSeed(1, true));
  await sleep(250);
  await page.evaluate(() => window.__fbSession.takeSeed(2, true));
  await sleep(250);
  await levels(page);
  await sleep(2000);
  await reload(page);
  await levels(page);
  await pick(page, 'continue', 0);
  const seeds = (await where(page)).seeds;
  t.check(`a seed picked up just before quitting is kept (${seeds} of 3)`, seeds === 3, seeds);
  errors.push(...page.errors);
});

// ---- two tabs of the game: the one left open from earlier can't write over what the other one did
await scenario('two tabs', async () => {
  const a = await device(OPEN);
  const b = await open(a.browser());
  await b.bringToFront();
  await play(b, 0);
  await finish(b);
  await sleep(1500);
  await a.bringToFront();
  await play(a, 1);
  await a.evaluate(() => window.__fbSession.takeSeed(0, true));
  await sleep(2500);
  await b.bringToFront();
  await reload(b);
  await levels(b);
  const best = await text(b, '[data-act="lvl:0"] .best');
  t.check(`a second tab doesn't erase the first one's progress (the Garden's best: “${best}”)`, /\d/.test(best), best);
  errors.push(...a.errors, ...b.errors);
});

// ---- her clock runs 10 minutes fast: the lantern lit last still wins, on both devices
await scenario('clocks', async () => {
  const her = await device(OPEN, { skew: 10 * 60_000 });
  const him = await device(OPEN);
  const code = (page) => page.evaluate(`(async () => (${saveModule}).exportCode())()`);
  const take = (page, c) => page.evaluate(`(async () => (${saveModule}).importCode(${JSON.stringify(c)}))()`);
  /**
   * A run is only worth exporting once the save actually holds it.
   *
   * Leaving a level is what writes the run down, and on a machine drawing a few frames a second that
   * has not necessarily happened by the time the next line asks for a save code — so the code went
   * out carrying the state from before the lantern, and the exchange below then had the two devices
   * arguing about the wrong pair of runs. It failed in whichever direction the timing fell, which is
   * what made it look like a verdict about clocks rather than a race.
   *
   * (The clocks here are inert, incidentally: the save orders copies by a logical count of its own,
   * and `Date.now` appears nowhere in src. A device whose wall clock is ten minutes out cannot bring
   * back an older anything, by construction. What this scenario still earns its keep for is the
   * convergence — two devices swapping codes both ways end up agreeing, whoever merges first.)
   */
  const held = (page, cp) => waitFor(
    () => page.evaluate(`(async () => { const r = (${saveModule}).save.runs.garden; return !!r && !!r.run && r.run.cp === ${cp}; })()`),
    6000,
    `lantern ${cp + 1} written down`,
  );
  await play(her, 0);
  await her.evaluate(() => window.__fbSession.light(0, true));
  await sleep(1500);
  await levels(her);
  await held(her, 0);
  await take(him, await code(her));
  await levels(him);
  await pick(him, 'continue', 0);
  await him.evaluate(() => window.__fbSession.light(1, true));
  await sleep(1500);
  await levels(him);
  await held(him, 1);
  await take(her, await code(him));
  await take(him, await code(her));
  await levels(her);
  await levels(him);
  const hers = await text(her, '[data-act="continue"]');
  const his = await text(him, '[data-act="continue"]');
  // what each of them is actually holding, so a disagreement says which copy won and why
  const held2 = (page) => page.evaluate(`(async () => { const s = (${saveModule}).save; return { clock: s.clock, runs: Object.fromEntries(Object.entries(s.runs).map(([k, v]) => [k, { gen: v.gen, at: v.at, cp: v.run ? v.run.cp : null }])) }; })()`);
  const saves = { her: await held2(her), him: await held2(him) };
  t.check(`a device whose clock is off can't bring back an older lantern (hers: “${hers}”, his: “${his}”)`, /lantern 2/.test(hers) && /lantern 2/.test(his), { hers, his, saves });
  errors.push(...her.errors, ...him.errors);
});

// ---- a save this build can only partly read (a number stored as text) is read as far as it goes — and never overwritten
await scenario('damaged save', async () => {
  const page = await device({ unlocked: '3', levels: { garden: { seeds: 20, feathers: 7, time: 100, clears: 1 }, woods: { seeds: 9, feathers: 3, time: 200, clears: 1 } }, finished: false, run: null, runAt: 0 });
  await levels(page);
  const lit = () => page.evaluate(() => document.querySelectorAll('[data-act="lvl:0"] .feather-ico.on').length);
  const first = await lit();
  await play(page, 1);
  await page.evaluate(() => window.__fbSession.takeSeed(0, true));
  await sleep(2000);
  await levels(page);
  await reload(page);
  await levels(page);
  const later = await lit();
  t.check(`a partly damaged save keeps what it can (Garden feathers: ${first}, then ${later} after playing on)`, first === 3 && later === 3, { first, later });
  errors.push(...page.errors);
});

// ---- a browser that won't store anything says so
await scenario('no storage', async () => {
  const b = await launch();
  browsers.push(b);
  const page = await open(b);
  await page.evaluateOnNewDocument(() => { Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
  await reload(page);
  await levels(page);
  const warn = await text(page, '.status.warn');
  t.check(`when progress can't be saved, the level select says so (“${warn.slice(0, 40)}…”)`, /isn.t keeping/.test(warn), warn);
  errors.push(...page.errors);
});

// ---- names on the CONTINUE card aren't cut off; a time garbled on the way never wipes a best time
await scenario('names and times', async () => {
  const page = await device({ ...OPEN, levels: { garden: { seeds: 20, feathers: 1, time: 100, clears: 1 } }, run: { level: 1, cp: 0, seeds: [], feathers: 0, time: 30, with: 'Marguerite & Bartholomew 🌱' }, runAt: 1 });
  await levels(page);
  const card = await text(page, '[data-act="continue"]');
  t.check(`both names show on the CONTINUE card (“${card}”)`, card.includes('Marguerite & Bartholomew 🌱') && /Woodland/.test(card), card);
  await page.evaluate(`(async () => (${saveModule}).recordClear('garden', 0, 5, 1, NaN))()`);
  await sleep(300);
  await reload(page);
  await levels(page);
  const best = await text(page, '[data-act="lvl:0"] .best');
  t.check(`a garbled finishing time doesn't wipe the best one (“${best}”)`, /1:40/.test(best), best);
  errors.push(...page.errors);
});

// ---- save codes: one pasted from a chat (wrapped, a stray invisible character) still works; a refused clipboard shows the code
await scenario('save codes', async () => {
  const from = await device({ ...OPEN, levels: { mill: { seeds: 3, feathers: 2, time: 99, clears: 1 } } });
  const c = await from.evaluate(`(async () => (${saveModule}).exportCode())()`);
  const page = await device(null);
  const pasted = `here you go: ${c.slice(0, 20)}\n${c.slice(20, 40)}​${c.slice(40)} `;
  const ok = await page.evaluate(`(async () => (${saveModule}).importCode(${JSON.stringify(pasted)}))()`);
  t.check('a save code pasted with line breaks and invisible characters still loads', ok === true, ok);
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('not allowed')); });
  await page.evaluate(() => window.__fb.flow.title());
  // Wait until there is exactly one title on screen. A screen change is queued and taken up at the
  // start of the NEXT frame, so until then the screen being left is still in the document — with a
  // settings button of its own, which a click finds first and which is disposed a moment later
  // ("Node is detached from document"). Half a second covers that on a screen and is less than one
  // frame on a runner with no GPU, which is the whole of why this came and went.
  await waitFor(() => page.evaluate(() => document.querySelectorAll('.title-screen').length === 1 && window.__fb.app.current?.constructor.name === 'TitleScreen'), 6000, 'one title on screen');
  await page.click('[data-act="settings"]');
  await waitFor(() => page.evaluate(() => !!document.querySelector('[data-act="copysave"]')), 3000, 'settings');
  await page.evaluate(() => { for (const d of document.querySelectorAll('details.advanced')) d.open = true; });
  await sleep(450);
  await page.click('[data-act="copysave"]');
  await sleep(300);
  const shown = await page.evaluate(() => { const el = document.querySelector('.save-code'); return el && !el.hidden ? el.textContent : ''; });
  t.check('when the clipboard refuses, the save code is shown to copy by hand', shown.startsWith('MB1-'), shown.slice(0, 12));
  errors.push(...page.errors, ...from.errors);
});

// ---- online: going back to the levels after the partner left keeps the room open; a guest rejoins, never reopens
await scenario('rooms', async () => {
  const page = await device(OPEN);
  await page.evaluate(() => {
    window.__fake = (role) => ({
      role, code: 'ABCD', status: 'connected', connected: true, peerGen: 0, rtt: 30, via: 'direct', sent: [],
      send(m) { this.sent.push(m); }, sendSnap: () => true, close() { this.closed = true; }, sharedNow: () => performance.now(),
      onStatus: null, onCtrl: null, onSnap: null,
      set(s) { this.status = s; this.connected = s === 'connected'; this.onStatus?.(s, ''); },
    });
    const l = (window.__h = window.__fake('host'));
    window.__fb.flow.adopt(l);
    window.__fb.flow.playLevel(0);
  });
  await waitFor(async () => (await now(page)) === 'Session', 3000, 'host in a level');
  await page.evaluate(() => { window.__h.set('lost'); window.__fb.flow.levels(); });
  await waitFor(async () => (await now(page)) !== 'Session', 3000, 'off the level').catch(() => undefined);
  const after = { screen: await now(page), open: await page.evaluate(() => !window.__h.closed) };
  t.check(`BACK TO LEVELS after the partner left keeps the room open for them (${after.screen})`, after.screen === 'LevelSelect' && after.open, after);
  // a guest's own menu: REJOIN the room they were in (two devices both reopening one code would clash)
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}'); localStorage.setItem('mossbound.settings.v1', JSON.stringify({ ...s, name: 'Bo' })); });
  const menu = () => waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'OnlineScreen' && window.__fb.app.current.state === 'menu' && !!document.querySelector('[data-act="host"]')), 3000, 'online menu');
  await page.evaluate(() => { window.__fb.flow.title(); window.__fb.flow.online(); });
  await menu();
  await page.evaluate(() => { const sc = window.__fb.app.current; sc.act('join'); });
  await sleep(200);
  await page.evaluate(() => { const sc = window.__fb.app.current; const i = document.querySelector('.code-input'); i.value = 'K7QX'; sc.act('go'); });
  await sleep(300);
  // the join fails (nobody's hosting): TRY AGAIN tries that room again
  await page.evaluate(() => window.__fb.flow.link?.onStatus?.('error', 'Nobody is hosting room K7QX.'));
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.state === 'error'), 3000, 'error card');
  await sleep(450);
  await page.click('.panel .btn');
  await sleep(300);
  const retried = await page.evaluate(() => ({ state: window.__fb.app.current?.state, code: window.__fb.flow.link?.code }));
  t.check(`TRY AGAIN after a failed join tries the same room again (${retried.state} ${retried.code ?? ''})`, retried.state === 'connecting' && retried.code === 'K7QX', retried);
  await page.evaluate(() => { window.__fb.flow.title(); window.__fb.flow.online(); });
  await menu();
  const buttons = await text(page, '.panel');
  t.check(`a guest is offered to rejoin their room, not to reopen it (“${buttons.match(/RE\w+ ROOM \w+/)?.[0] ?? ''}”)`, /REJOIN ROOM K7QX/.test(buttons) && !/REOPEN/.test(buttons), buttons);
  errors.push(...page.errors.filter((e) => !/WebSocket|relay|Nobody/.test(e)));
});

// ---- (sanity) 1.0.0's run carries over; a level can still be started over on purpose
await scenario('carried over', async () => {
  const page = await device({ ...OPEN, run: { level: 1, cp: 1, seeds: [2, 3], feathers: 1, time: 80, with: '' }, runAt: 5 });
  await levels(page);
  const card = await text(page, '[data-act="continue"]');
  t.check(`a run saved by 1.0.0 is offered (“${card}”)`, /Woodland/.test(card) && /lantern 2/.test(card), card);
  await pick(page, 'continue', 1);
  const run = await where(page);
  await page.evaluate(() => window.__fbSession.togglePause());
  await sleep(450);
  const over = await page.evaluate(() => !!document.querySelector('.overlay [data-act="restart"]'));
  if (over) {
    await page.click('.overlay [data-act="restart"]');
    await sleep(600);
  }
  const fresh = await where(page);
  t.check('START THE LEVEL OVER starts it from the beginning', run.cp === 1 && over && fresh.cp === -1 && fresh.seeds === 0, { run, over, fresh });
  errors.push(...page.errors);
});

for (const b of browsers) await b.close().catch(() => undefined);
t.finish('continue', errors);
