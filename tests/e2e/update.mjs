// A new build taken by itself (update.ts): at a moment that costs nothing, with the players put back
// where they were and the journal untouched — and never in an online room. Plus the Xbox's 1080-row cap.
import { XBOX_UA, launch, open, padPress, reporter, sleep, url, waitFor } from './harness.mjs';

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

/** A page whose browser refuses this site some of its storage (`which`: 'localStorage', 'sessionStorage'). */
async function openDenied(which) {
  const page = (await browser.pages()).find((p) => p.url() === 'about:blank' && !p.__taken) ?? (await browser.newPage());
  page.__taken = true;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`[pageerror] ${e.message}`));
  await page.evaluateOnNewDocument((which) => {
    for (const k of which) Object.defineProperty(window, k, { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  }, which);
  await page.goto(url(), { waitUntil: 'networkidle0' });
  await page.bringToFront();
  await waitFor(() => ev(page, () => !!window.__fb?.app?.current), 20000, 'boot');
  return page;
}
const finishLevel = (p) => p.evaluate(() => { const s = window.__fbSession; const n = s.L.nest; s.devTeleport(n.x - 12, n.y - 4, 0); s.devTeleport(n.x + 12, n.y - 4, 1); });

// ---- the moment the reload is decided, the level stands still: the next page can take seconds to
// arrive on a slow network, and nothing done in that time would come back with it. And the level comes
// back from the journal — what the old page wrote last, as it went away — not from the note taken when
// the reload was decided, so not even what did reach the journal in that window is undone
{
  const page = await open(browser);
  await page.evaluate(local, ['keysL', 'keysR']);
  await page.evaluate(() => window.__fb.flow.playLevel(0));
  await inLevel(page, 'garden');
  await page.setRequestInterception(true);
  let docAt = 0;
  // (the next page takes 2.5 s to arrive, as on a hotel's Wi-Fi)
  const slow = (req) => {
    if (!docAt && req.isNavigationRequest() && req.resourceType() === 'document') {
      docAt = Date.now();
      setTimeout(() => req.continue().catch(() => undefined), 2500);
    } else req.continue().catch(() => undefined);
  };
  page.on('request', slow);
  // in the page: from the moment the updater has written its note, how far does the game clock run?
  // And 300 ms in, a later lantern and two more seeds are written into the level directly — as anything
  // that reaches the journal in that window would be
  await page.evaluate(() => {
    let at = 0;
    let t0 = 0;
    let acted = false;
    const step = () => {
      if (!at && sessionStorage.getItem('mossbound.update.back')) {
        at = performance.now();
        t0 = window.__fb.app.time;
      }
      if (at && !acted && performance.now() - at > 300) {
        acted = true;
        const s = window.__fbSession;
        s.takeSeed(1, true);
        s.takeSeed(2, true);
        s.light(1, true);
      }
      if (at) sessionStorage.setItem('probe.gap', JSON.stringify({ ran: +(window.__fb.app.time - t0).toFixed(3), ms: Math.round(performance.now() - at) }));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.evaluate(() => { window.__marker = 1; window.__fbUpdate.found('9.9.61'); });
  await sleep(600);
  await page.evaluate(() => { const s = window.__fbSession; s.takeSeed(0, true); s.light(0, true); });
  await waitFor(() => docAt > 0, 4000, 'the reload');
  await reloaded(page);
  page.off('request', slow);
  await page.setRequestInterception(false);
  await inLevel(page, 'garden');
  const gap = await page.evaluate(() => JSON.parse(sessionStorage.getItem('probe.gap') ?? 'null'));
  const after = await page.evaluate(() => { const s = window.__fbSession; return { cp: s.checkpoint, seeds: [...s.seedTaken].filter(Boolean).length }; });
  t.check(`once the reload is decided the level stands still while the next page is on its way (the game clock ran ${gap?.ran} s in ${gap?.ms} ms)`, !!gap && gap.ms > 1500 && gap.ran < 0.05, gap);
  t.check(`…and the level comes back from the journal as it was last written (lantern ${after.cp}, ${after.seeds} seeds)`, after.cp === 1 && after.seeds === 3, after);
  errors.push(...page.errors);
  await page.close();
}

// ---- an update that changed a level's map: the seeds and plants the run recorded were places on the old
// map, so (as CONTINUE does) they don't come back — the lantern does
{
  // (a device of its own: the journal holds only this run)
  const context = await browser.createBrowserContext();
  const run = { cp: 0, seeds: [0, 1], grown: [], feathers: 1, time: 30, with: '', sig: 'oldmap' };
  const page = await open(browser, { context, storage: { 'mossbound.save.v3': { v: 3, unlocked: 1, levels: {}, finished: false, clock: 5, runs: { garden: { gen: 1, at: 5, run } } } } });
  await page.evaluate(() => {
    sessionStorage.setItem('mossbound.update.back', JSON.stringify({ from: '1.9.0', at: Date.now(), back: { to: 'level', level: 0, resume: { cp: 0, seeds: [0, 1], grown: [], feathers: 1, time: 30, gen: 1 }, seats: ['keysL', 'keysR'] } }));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await inLevel(page, 'garden');
  const after = await page.evaluate(() => { const s = window.__fbSession; return { cp: s.checkpoint, seeds: [...s.seedTaken].filter(Boolean).length, feathers: s.feathers }; });
  t.check(`an update onto a changed map brings the lantern back, not the old map's seeds (lantern ${after.cp}, ${after.seeds} seeds, fireflies ${after.feathers})`, after.cp === 0 && after.seeds === 0 && after.feathers === 0, after);
  errors.push(...page.errors);
  await page.close();
  await context.close();
}

// ---- a browser that keeps nothing for this site (storage blocked): the journal lives only in the page,
// and a reload would throw away everything played. The update waits for them, and the badge says why
{
  const page = await openDenied(['localStorage', 'sessionStorage']);
  await page.evaluate(local, ['keysL', 'keysR']);
  await page.evaluate(() => window.__fb.flow.playLevel(0));
  await inLevel(page, 'garden');
  const canSave = await page.evaluate(() => window.__fb.save.canSave());
  await finishLevel(page);
  await waitFor(() => ev(page, () => window.__fbSession.state === 'clear'), 8000, 'the clear');
  await page.evaluate(() => { window.__marker = 1; window.__fbUpdate.found('9.9.62'); });
  await sleep(1000);
  // the level select: a moment that would cost nothing, if the journal could be kept
  await page.evaluate(() => window.__fb.flow.levels());
  await sleep(1500);
  const r = await ev(page, () => ({ marker: window.__marker ?? 0, unlocked: window.__fb.save.save.unlocked, badge: document.querySelector('.version-badge')?.textContent ?? '' }));
  t.check(`storage blocked (canSave ${canSave}): an update never reloads away what this session has played`, !canSave && r?.marker === 1 && r.unlocked >= 1, r);
  t.check(`…and the badge says why (“${r?.badge}”)`, /lose/.test(r?.badge ?? ''), r);
  errors.push(...page.errors);
  await page.close();
}

// ---- sessionStorage blocked (the journal is fine): the guard against reloading for a version the reloads
// never bring in still holds — and the screen still comes back after each one
{
  const page = await openDenied(['sessionStorage']);
  let loads = 0;
  page.on('load', () => loads++);
  // as the real page does on every boot: a look at the site, which says 9.9.63 (never what the dev server serves)
  await page.evaluateOnNewDocument(() => {
    const go = () => (window.__fbUpdate && window.__fb?.app?.current ? setTimeout(() => window.__fbUpdate.checked('9.9.63'), 300) : setTimeout(go, 50));
    go();
  });
  await page.evaluate(local, ['keysL', 'keysR']);
  await page.evaluate(() => window.__fb.flow.levels());
  await waitFor(() => ev(page, () => window.__fb.app.current?.constructor.name === 'LevelSelect'), 8000, 'the level select');
  await page.evaluate(() => window.__fbUpdate.checked('9.9.63'));
  await sleep(12000);
  const at = await ev(page, () => ({ screen: window.__fb.app.current?.constructor.name, badge: document.querySelector('.version-badge')?.textContent ?? '' }));
  t.check(`sessionStorage blocked: a version the reloads keep missing is tried at most twice (${loads} reloads in 12 s)`, loads <= 2, { loads, at });
  t.check(`…and each reload comes back to the level select (${at?.screen})`, at?.screen === 'LevelSelect', at);
  errors.push(...page.errors);
  await page.close();
}

// ---- a level cleared while an update waits: the players get their clear card (seeds, fireflies, time),
// for as long as they like. The update goes when they leave it — NEXT LEVEL here, so it lands at the start
// of the next level. On an Xbox, where the middle of a level is off limits, that is its moment too: a
// session that only ever goes NEXT LEVEL → NEXT LEVEL still gets the update
for (const [name, ua] of [['laptop', undefined], ['xbox', XBOX_UA]]) {
  const page = await open(browser, { ua });
  await page.evaluate(local, ['keysL', 'keysR']);
  await page.evaluate(() => window.__fb.flow.playLevel(0));
  await inLevel(page, 'garden');
  await page.evaluate(() => { window.__marker = 1; window.__fbUpdate.found('9.9.64'); });
  await sleep(600);
  await finishLevel(page);
  const card = await waitFor(() => ev(page, () => /home sweet pot/.test(document.querySelector('.ov-card')?.textContent ?? '')), 6000, 'the clear card').catch(() => false);
  await sleep(2500);
  const still = await ev(page, () => window.__marker === 1 && /home sweet pot/.test(document.querySelector('.ov-card')?.textContent ?? ''));
  t.check(`${name}: with an update waiting, the clear card still shows — and stays up while it's read`, !!card && still === true, { card, still });
  if (still) {
    await page.click('.ov-card [data-act="next"]').catch(() => undefined);
    const landed = await reloaded(page).then(() => inLevel(page, 'woods')).then(() => true).catch(() => false);
    const toast = await ev(page, () => document.querySelector('.update-toast')?.textContent ?? '');
    t.check(`${name}: …NEXT LEVEL takes the update, and it lands at the start of the next level`, landed && /updated to/.test(toast ?? ''), { landed, toast });
  }
  errors.push(...page.errors);
  await page.close();
}

// ---- the new page never comes (a network that takes the request and never answers): the game can't
// stay frozen on "loading the new version" for ever — it gives up on that try and carries on
{
  const page = await open(browser);
  await waitFor(() => ev(page, () => window.__fb.app.current?.constructor.name === 'TitleScreen'), 8000, 'the title');
  await page.setRequestInterception(true);
  const held = [];
  page.on('request', (r) => {
    if (r.isNavigationRequest() && /[?&]u=/.test(r.url())) held.push(r); // never answered
    else r.continue().catch(() => undefined);
  });
  // (puppeteer won't evaluate in a page whose navigation is pending, so the page notes what it saw itself)
  await page.evaluate(() => {
    window.__seen = { halted: false, pill: '' };
    window.__seenT = setInterval(() => {
      if (window.__fb.app.halted) window.__seen.halted = true;
      const p = document.querySelector('.update-pill')?.textContent ?? '';
      if (p) window.__seen.pill = p;
    }, 40);
    window.__marker = 1;
    window.__fbUpdate.giveUpAfter(1500);
    window.__fbUpdate.found('9.9.40');
  });
  await waitFor(() => ev(page, () => !window.__fb.app.halted), 8000, 'carrying on').catch(() => undefined);
  const t0 = await page.evaluate(() => window.__fb.app.time);
  await sleep(600);
  const after = await page.evaluate((t0) => ({ marker: window.__marker ?? 0, halted: window.__fb.app.halted, moving: window.__fb.app.time > t0, pill: document.querySelector('.update-pill')?.textContent ?? '' }), t0);
  const frozen = await page.evaluate(() => { clearInterval(window.__seenT); return window.__seen; });
  t.check('while the new page is on its way the game is frozen and says so', frozen.halted === true && /loading the new version/.test(frozen.pill) && held.length === 1, { frozen, held: held.length });
  t.check('…and if it never comes, the game gives up on that try and carries on where it was', after.marker === 1 && after.halted === false && after.moving && !/loading/.test(after.pill), after);
  await page.setRequestInterception(false).catch(() => undefined);
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
    // (rows at full quality: the governor scales the canvas down on a busy machine — 918 rows once, with
    // four groups running — and that's the governor working, not the cap failing)
    rows[name] = await page.evaluate(() => Math.round(document.querySelector('canvas').height / window.__fb.app.renderer.scale));
    errors.push(...page.errors);
    await page.close();
  }
  t.check(`an Xbox draws at most 1080 rows at 4K output (xbox ${rows.xbox}, laptop ${rows.laptop})`, rows.xbox <= 1080 && rows.xbox >= 1000 && rows.laptop > 1080, rows);
}

await browser.close();
t.finish('update', errors);
