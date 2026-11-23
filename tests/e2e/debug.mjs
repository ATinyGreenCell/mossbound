// The debug ground (src/core/debug.ts): a way into any level, alone, with the toolbox over it.
//
// Two things matter more than the tools themselves. It must be unreachable without asking for it —
// this one ships in the production build, unlike the testmode switches, so an ordinary player must
// never meet it. And it must leave the journal alone exactly as the practice ground does: an hour
// spent poking at a level is not progress, and a run recorded from one would be a lie on the level
// select.
//
// Everything here runs through the real game loop rather than calling update() by hand, so a tool
// that only works when something else is also driving the session still counts as broken.
import { frames, launch, open, reporter, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const t = reporter();
const errors = [];

// ---- without the hash there is no way in
{
  const page = await open(browser);
  await waitFor(() => page.evaluate(() => !!document.querySelector('.menu')), 10000, 'the title screen');
  const shown = await page.evaluate(() => [...document.querySelectorAll('.btn')].map((b) => b.textContent.trim()));
  t.check('the title screen offers no debug ground by default', !shown.some((s) => /DEBUG/i.test(s)), shown);
  const flagged = await page.evaluate(async () => (await import('/src/core/debug.ts')).debugOn());
  t.check('…and the flag is off', flagged === false);
  errors.push(...page.errors);
  await page.close();
}

// ---- #debug puts it on the title
{
  const page = await open(browser, { query: { hash: 'debug' } });
  await waitFor(() => page.evaluate(() => !!document.querySelector('.menu')), 10000, 'the title screen');
  const shown = await page.evaluate(() => [...document.querySelectorAll('.btn')].map((b) => b.textContent.trim()));
  t.check('#debug offers the debug ground', shown.some((s) => /DEBUG GROUND/i.test(s)), shown);
  errors.push(...page.errors);
  await page.close();
}

// ---- it plays a real level, alone, with the panel over it
const page = await open(browser, { query: { hash: 'debug' } });
await waitFor(() => page.evaluate(() => !!document.querySelector('.menu')), 10000, 'the title screen');
await page.evaluate(() => window.__fb.flow.debug(0));
await waitFor(() => page.evaluate(() => !!window.__fbSession), 10000, 'the debug session');
await frames(page, 30);

const started = await page.evaluate(() => {
  const s = window.__fbSession;
  return { level: s.L.def.id, debug: s.debug, practice: s.practice, solo: s.solo, dummy: !!s.dummy, panel: !!document.querySelector('.dbg'), online: s.online };
});
t.check('it drops into a real level, not the practice ground', started.level !== 'practice' && started.debug === true, started);
t.check('…played on the practice rules: a walked partner, and solo', started.dummy && started.solo && !started.practice, started);
t.check('…offline, with the panel over it', started.online === false && started.panel, started);

// the panel must be able to receive a tap at all: .ui is pointer-events none, so a panel that
// forgot to ask for them back would look right and do nothing
const taps = await page.evaluate(() => {
  const el = document.querySelector('.dbg');
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 8);
  return { pe: getComputedStyle(el).pointerEvents, hits: !!hit && el.contains(hit) };
});
t.check('the panel takes taps', taps.pe === 'auto' && taps.hits, taps);

// ---- FREEZE and STEP, through the real loop
const freeze = await page.evaluate(async () => {
  const { dbg } = await import('/src/core/debug.ts');
  const s = window.__fbSession;
  const wait = (n) => new Promise((done) => { const go = (k) => (k ? requestAnimationFrame(() => go(k - 1)) : done()); go(n); });
  dbg.frozen = true;
  await wait(5);
  const a = s.sharedT;
  await wait(20);
  const held = s.sharedT === a;
  dbg.stepOne = true;
  await wait(3);
  const stepped = s.sharedT > a;
  const b = s.sharedT;
  await wait(20);
  const stoppedAgain = s.sharedT === b;
  dbg.frozen = false;
  await wait(5);
  const running = s.sharedT > b;
  return { held, stepped, stoppedAgain, running, step: b - a };
});
t.check('FREEZE stops the world', freeze.held);
t.check('STEP lets exactly one step through, then stops again', freeze.stepped && freeze.stoppedAgain && freeze.step < 0.1, freeze);
t.check('…and unfreezing starts it again', freeze.running);

// ---- slow motion
const slow = await page.evaluate(async () => {
  const { dbg } = await import('/src/core/debug.ts');
  const s = window.__fbSession;
  const run = async (speed, n) => {
    dbg.speed = speed;
    await new Promise((done) => { const go = (k) => (k ? requestAnimationFrame(() => go(k - 1)) : done()); go(3); });
    const a = s.sharedT;
    await new Promise((done) => { const go = (k) => (k ? requestAnimationFrame(() => go(k - 1)) : done()); go(n); });
    return s.sharedT - a;
  };
  const full = await run(1, 40);
  const quarter = await run(0.25, 40);
  dbg.speed = 1;
  return { full, quarter, ratio: full > 0 ? quarter / full : 0 };
});
t.check('¼× runs the shared clock about four times slower', slow.ratio > 0.15 && slow.ratio < 0.4, slow);

// ---- the rest of the toolbox
const tools = await page.evaluate(async () => {
  const { dbg } = await import('/src/core/debug.ts');
  const s = window.__fbSession;
  const me = s.birds.find((b) => b.local);
  const wait = (n) => new Promise((done) => { const go = (k) => (k ? requestAnimationFrame(() => go(k - 1)) : done()); go(n); });
  const out = {};

  s.teleport(me, 600, 200);
  out.teleported = Math.abs(me.x - 600) < 1 && Math.abs(me.y - 200) < 1;
  out.teleportSafe = !me.ghost && me.vx === 0 && me.vy === 0 && me.invuln > 0;

  me.die('fall');
  s.teleport(me, 300, 200);
  out.revived = !me.ghost;

  dbg.invuln = true;
  await wait(20);
  out.invuln = me.invuln > 0;
  dbg.invuln = false;

  // the boxes overlay must not throw while drawing — it reaches into the world and the vine
  dbg.boxes = true;
  await wait(10);
  dbg.boxes = false;

  // noclip: through a wall, and the bird is left in a state the ordinary step can pick up
  dbg.noclip = true;
  s.teleport(me, 64, 96);
  await wait(30);
  out.noclipFinite = Number.isFinite(me.x) && Number.isFinite(me.y);
  dbg.noclip = false;
  await wait(20);
  out.recovers = Number.isFinite(me.x) && Number.isFinite(me.y) && !me.ghost;
  return out;
});
t.check('TAP TO GO puts a sprout where you tapped', tools.teleported);
t.check('…in a state the game can carry on from', tools.teleportSafe);
t.check('…and brings a ghost back rather than moving a corpse', tools.revived);
t.check('UNHURTABLE holds the invulnerability on', tools.invuln);
t.check('NOCLIP flies without breaking anything, and hands the bird back', tools.noclipFinite && tools.recovers, tools);

// ---- the tap sheet, so the touch stick cannot eat the tap
const sheet = await page.evaluate(async () => {
  const { dbg } = await import('/src/core/debug.ts');
  const el = () => document.querySelector('.dbg-catch');
  const wait = () => new Promise((done) => requestAnimationFrame(() => done()));
  const off = el().classList.contains('hidden');
  dbg.teleport = true;
  await wait();
  await wait();
  const on = !el().classList.contains('hidden');
  const over = getComputedStyle(el()).pointerEvents === 'auto';
  dbg.teleport = false;
  await wait();
  await wait();
  return { off, on, over, gone: el().classList.contains('hidden') };
});
t.check('the tap sheet is up only while TAP TO GO is on', sheet.off && sheet.on && sheet.gone, sheet);
t.check('…and it is the thing that takes the tap', sheet.over);

// ---- the promise: nothing it does reaches the journal
const before = await page.evaluate(() => JSON.stringify(window.__fb.save.save));
await page.evaluate(async () => {
  const s = window.__fbSession;
  const wait = (n) => new Promise((done) => { const go = (k) => (k ? requestAnimationFrame(() => go(k - 1)) : done()); go(n); });
  // take every firefly, then put both sprouts in the nest and clear the level outright
  for (const f of s.L.feathers) {
    s.teleport(s.birds[0], f.x, f.y);
    s.teleport(s.birds[1], f.x, f.y);
    await wait(6);
  }
  const n = s.L.nest;
  s.teleport(s.birds[0], n.x, n.y);
  s.teleport(s.birds[1], n.x, n.y);
  await wait(180);
});
await sleep(600);
const after = await page.evaluate(() => JSON.stringify(window.__fb.save.save));
t.check('nothing done in the debug ground is written to the journal', before === after);

// ---- and everything that starts it again stays on it: the clear card (which used to offer the real
// levels' buttons — PLAY AGAIN and NEXT LEVEL started real, recorded runs, and THE END wrote the journal)
// and the pause menu, with the sprout picked by SWAP (which used to swap nothing at all)
const markOld = () => page.evaluate(() => { if (window.__fbSession) window.__fbSession.__old = true; });
const fresh = (label) => waitFor(() => page.evaluate(() => { const s = window.__fbSession; return !!s && !s.__old && window.__fb.app.current === s; }), 8000, label);
const where = () => page.evaluate(() => { const s = window.__fbSession; return { level: s.L.index, debug: s.debug, offRecord: s.offRecord, kinds: s.birds.map((b) => b.kind).join('/') }; });
const journal = () => page.evaluate(() => JSON.stringify(window.__fb.save.save) + '|' + (localStorage.getItem('mossbound.save.v3') ?? ''));
/** clear the level outright, and press `act` on its card until it takes */
const clearAnd = async (act) => {
  await page.evaluate(() => window.__fbSession.clear(42));
  await waitFor(() => page.evaluate(() => !!document.querySelector('.ov-buttons .btn')), 8000, 'the clear card');
  const buttons = await page.evaluate(() => [...document.querySelectorAll('.ov-buttons .btn')].map((b) => b.dataset.act));
  if (!act) return { buttons };
  await markOld();
  await sleep(450);
  await waitFor(async () => {
    await page.evaluate((act) => document.querySelector(`.ov-buttons .btn[data-act=${act}]`)?.click(), act);
    return page.evaluate(() => { const s = window.__fbSession; return !!s && !s.__old && window.__fb.app.current === s; });
  }, 8000, act);
  return { buttons, now: await where() };
};
const j0 = await journal();
const k0 = (await where()).kinds;
await markOld();
await page.evaluate(() => window.__fbSession.panel.onSwap());
await fresh('the debug ground, swapped');
const swapped = await where();
await markOld();
await page.evaluate(() => window.__fbSession.togglePause());
await waitFor(() => page.evaluate(() => !!document.querySelector('.btn[data-act=restart]')), 4000, 'the pause menu');
await sleep(450);
await waitFor(async () => {
  await page.evaluate(() => document.querySelector('.btn[data-act=restart]')?.click());
  return page.evaluate(() => { const s = window.__fbSession; return !!s && !s.__old && window.__fb.app.current === s; });
}, 8000, 'the debug ground started over');
const restarted = await where();
const again = await clearAnd('again');
const next = await clearAnd('next');
await markOld();
await page.evaluate((sw) => window.__fb.flow.debug(4, sw), swapped.kinds.startsWith('small'));
await fresh('the last level, on the debug ground');
const last = await clearAnd(null);
await sleep(600);
const j1 = await journal();
t.check(`SWAP on the panel swaps the sprouts (${k0} → ${swapped.kinds})`, swapped.debug && swapped.kinds !== k0, { k0, swapped });
t.check('…and the pause menu’s START THE LEVEL OVER keeps you there, as that sprout', restarted.debug && restarted.level === swapped.level && restarted.kinds === swapped.kinds, restarted);
t.check('the clear card’s AGAIN plays the level again on the debug ground, as the same sprout', again.now.debug && again.now.offRecord && again.now.level === restarted.level && again.now.kinds === swapped.kinds, again);
t.check('…its NEXT LEVEL goes on to the next level on the debug ground', next.now.debug && next.now.offRecord && next.now.level === again.now.level + 1 && next.now.kinds === swapped.kinds, next);
t.check('…and the last level’s card offers no THE END (which writes the journal)', !last.buttons.includes('ending') && last.buttons.includes('again'), last);
t.check('…and none of it touched the journal', j0 === j1);

// ---- …and its own way round: the card's LEVELS is the map, every level open and the pair on the level
// just played, and a stop there goes into that level on the debug ground — still off the record
await markOld();
await waitFor(async () => {
  await page.evaluate(() => document.querySelector('.ov-buttons .btn[data-act=levels]')?.click());
  return page.evaluate(() => window.__fb.app.current?.constructor.name === 'LevelSelect');
}, 8000, 'the map');
const onMap = await page.evaluate(() => { const m = window.__fb.app.current.map; return { here: m.here, open: ['garden', 'woods', 'mill', 'paris', 'tower'].map((id) => m.state.node[m.L.byId.get(id)]) }; });
await page.evaluate(() => { const ls = window.__fb.app.current; ls.map.standOn('mill'); ls.act('go'); });
await fresh('the debug ground, from the map');
const fromMap = await where();
const j2 = await journal();
t.check(`its LEVELS is the map, every level open, on the level just played (${onMap.here}); a stop there goes into that level on the debug ground`, onMap.open.every((s) => s > 0) && onMap.here === 'tower' && fromMap.debug && fromMap.offRecord && fromMap.level === 2 && j2 === j0, { onMap, fromMap, journal: j2 === j0 });

errors.push(...page.errors);
await sleep(100);
await browser.close();
t.finish('debug', errors);
