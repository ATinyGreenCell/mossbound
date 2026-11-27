// The map: the level select since 1.12. Walked like a Mario World map — a press goes one stop, holding
// on carries on, a tap walks there and a tap on the stop you're on goes in — and everything the old
// level select did: CONTINUE (the map opens on the stop played last, its card says from which
// lantern), SWAP, the test course and the practice ground (Home's side spots), the storybook (by
// itself the first time, on Ⓐ at the book after that), a phone's taps, an Xbox pad. After a clear,
// NEXT LEVEL comes back to the map, on the cleared stop, with the path to the next one growing in.
//
//   node map.mjs          the map on one screen
//   node map.mjs online   two devices: the host walks the pair, the guest's follows; either can emote
//
// Every wait is on the game's clock or a state, never on a wall-clock sleep: on a runner drawing three
// frames a second, a step that "takes a second" takes ten.
import { frames, gameTime, launch, open, padPress, reporter, slowFrames, waitFor, XBOX_UA } from './harness.mjs';

const MODE = process.argv[2] ?? 'local';
const t = reporter();
const errors = [];
const browsers = [];
const save = (o) => ({ v: 3, unlocked: 0, levels: {}, finished: false, runs: {}, clock: 0, ...o });
/** World 1's built levels finished, so the trail is open as far as the mill (its planned boss is walked past) */
const CLEARED2 = save({
  unlocked: 2,
  levels: {
    garden: { seeds: 20, feathers: 1, time: 300, clears: 1 },
    woods: { seeds: 30, feathers: 0, time: 400, clears: 1 },
    shallows: { seeds: 10, feathers: 0, time: 320, clears: 1 },
    lilypond: { seeds: 10, feathers: 0, time: 330, clears: 1 },
    reedrun: { seeds: 10, feathers: 0, time: 340, clears: 1 },
  },
});
const SEEN = ['creek', 'mill', 'falls'];

async function page(opts = {}) {
  const b = await launch();
  browsers.push(b);
  const p = await open(b, opts);
  errors.push(p.errors);
  return p;
}

const screen = (p) => p.evaluate(() => window.__fb.app.current?.constructor.name);
/** The map, on screen (only one: a screen change lands at the start of the next frame). */
const onMap = (p, label = 'the map') => waitFor(() => p.evaluate(() => window.__fb.app.current?.constructor.name === 'LevelSelect' && document.querySelectorAll('.map-screen').length === 1), 10000, label);
const here = (p) => p.evaluate(() => window.__fb.app.current?.map?.here);
/** Wait for the pair to stand still (not walking, not zooming in). */
const still = (p) => waitFor(() => p.evaluate(() => { const m = window.__fb.app.current?.map; return !!m && !m.walking && !m.entering; }), 10000, 'the pair standing still');
const story = (p) => p.evaluate(() => !!document.querySelector('.story-wrap'));
const inLevel = (p, id) => waitFor(() => p.evaluate((id) => window.__fb.app.current?.constructor.name === 'Session' && window.__fbSession?.L.def.id === id, id), 10000, `into ${id}`);
async function localMap(p) {
  await p.evaluate(() => window.__fb.flow.startLocal(['keysL', 'keysR'], [0, 0]));
  await onMap(p);
  await gameTime(p, 0.7);
}
async function closeStory(p) {
  await gameTime(p, 0.4);
  await p.keyboard.press('Enter');
  await waitFor(async () => !(await story(p)), 5000, 'the storybook closed');
  await gameTime(p, 0.7);
}
async function finish(p) {
  await p.evaluate(() => { const s = window.__fbSession; const n = s.L.nest; s.devTeleport(n.x - 12, n.y - 4, 0); s.devTeleport(n.x + 12, n.y - 4, 1); });
  await waitFor(() => p.evaluate(() => window.__fbSession?.state === 'clear'), 10000, 'level clear');
}
async function scenario(name, fn) {
  try {
    await fn();
  } catch (e) {
    t.check(`${name} — ran to the end`, false, String(e?.message ?? e));
  }
}

if (MODE === 'local') {
  // ---- a new journal: the storybook, then one press is one stop, then Ⓐ goes in
  await scenario('first steps', async () => {
    const p = await page();
    await localMap(p);
    t.check('a new journal starts at Home', (await here(p)) === 'gate:creek', await here(p));
    t.check('…with the first storybook open by itself', await story(p));
    const text = await p.evaluate(() => document.querySelector('.story-card')?.textContent ?? '');
    t.check('the story calls them Pip and Bo', /Pip and Bo had saved one seed/.test(text), text.slice(0, 80));
    await closeStory(p);
    await p.keyboard.press('ArrowRight');
    await frames(p, 2);
    await still(p);
    t.check('a press of → walks to Mossy Creek', (await here(p)) === 'garden', await here(p));
    const card = await p.evaluate(() => document.querySelector('.ow-card')?.textContent.replace(/\s+/g, ' ') ?? '');
    t.check('its card names it, and Ⓐ plays it', /Mossy Creek/.test(card) && /Ⓐ play/.test(card), card);
    await p.keyboard.press('Enter');
    await inLevel(p, 'garden');
    t.check('Ⓐ goes into Mossy Creek', true);
    // ---- back after a clear: on the cleared stop, the path to the next one growing in
    await finish(p);
    await waitFor(() => p.evaluate(() => !!document.querySelector('[data-act="next"]')), 10000, 'the clear card');
    await gameTime(p, 2);
    await p.click('[data-act="next"]');
    await onMap(p, 'back on the map');
    const back = await p.evaluate(() => { const m = window.__fb.app.current.map; return { here: m.here, growing: m.growing, woods: m.state.node[m.L.byId.get('woods')] }; });
    t.check('NEXT LEVEL comes back to the map, on the cleared stop', back.here === 'garden', back);
    t.check('…with the path to Fern Falls growing in', back.growing >= 1, back);
    await waitFor(() => p.evaluate(() => window.__fb.app.current.map.growing === 0), 15000, 'the vine grown');
    const after = await p.evaluate(() => { const m = window.__fb.app.current.map; return { woods: m.state.node[m.L.byId.get('woods')], garden: m.state.node[m.L.byId.get('garden')] }; });
    t.check('Fern Falls is open, Mossy Creek cleared', after.woods === 1 && after.garden === 2, after);
    t.check('the storybook came once only', !(await story(p)));
  });

  // ---- a press held across a slow frame is one stop; a hold carries on
  await scenario('holding', async () => {
    const p = await page({ storage: { 'mossbound.save.v3': CLEARED2, 'mossbound.settings.v1': { stories: SEEN } } });
    await localMap(p);
    await p.evaluate(() => window.__fb.app.current.map.standOn('garden'));
    await gameTime(p, 0.3);
    const stop = await slowFrames(p, 333);
    await p.keyboard.down('ArrowRight');
    await frames(p, 2);
    await p.keyboard.up('ArrowRight');
    await stop();
    await frames(p, 2);
    await still(p);
    t.check('a press held across two slow frames walks one stop (no repeat)', (await here(p)) === 'woods', await here(p));
    await p.keyboard.down('ArrowRight');
    await gameTime(p, 1.4);
    await p.keyboard.up('ArrowRight');
    await frames(p, 2);
    await still(p);
    const far = await p.evaluate(() => { const m = window.__fb.app.current.map; return m.L.byId.get(m.here) - m.L.byId.get('woods'); });
    t.check(`holding → carries on past the stops (${far} on)`, far >= 2, far);
    // ← goes back the way they came
    const was = await here(p);
    await p.keyboard.press('ArrowLeft');
    await frames(p, 2);
    await still(p);
    const back = await here(p);
    t.check('← walks back a stop', back !== was && (await p.evaluate((a) => window.__fb.app.current.map.L.byId.get(a), back)) < (await p.evaluate((a) => window.__fb.app.current.map.L.byId.get(a), was)), { was, back });
  });

  // ---- CONTINUE: the map opens on the level played last, and Ⓐ carries on from its lantern
  await scenario('continue', async () => {
    const p = await page({ storage: { 'mossbound.save.v3': CLEARED2, 'mossbound.settings.v1': { stories: SEEN } } });
    await p.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keysL', 'keysR']; f.playLevel(2); });
    await inLevel(p, 'mill');
    await p.evaluate(() => window.__fbSession.light(1, true));
    await gameTime(p, 0.5);
    await p.evaluate(() => window.__fb.flow.levels());
    await onMap(p);
    t.check('the map opens on The Old Mill', (await here(p)) === 'mill', await here(p));
    const card = await p.evaluate(() => document.querySelector('.ow-card')?.textContent.replace(/\s+/g, ' ') ?? '');
    t.check('its card says "continue from lantern 2", and Ⓐ continues', /continue from lantern 2/.test(card) && /Ⓐ continue/.test(card), card);
    // a reload (the page closed and opened again) opens there too
    await p.reload({ waitUntil: 'networkidle0' });
    await waitFor(() => p.evaluate(() => !!window.__fb?.app?.current), 20000, 'boot');
    await localMap(p);
    t.check('…and after a reload', (await here(p)) === 'mill', await here(p));
    await p.keyboard.press('Enter');
    await inLevel(p, 'mill');
    const cp = await p.evaluate(() => window.__fbSession.checkpoint);
    t.check('Ⓐ carries on from lantern 2', cp === 1, cp);
    // a run remembers which map its seeds were picked on (levelSig): the five levels keep the signatures
    // they had in 1.11, or every saved run would lose its seeds once
    const sigs = await p.evaluate(async () => { const s = await import('/src/core/save.ts'); const { LEVELS } = await import('/src/game/levels.ts'); return Object.fromEntries(LEVELS.slice(0, 5).map((L, i) => [L.id, s.levelSig(i)])); });
    t.check('the five levels keep their 1.11 map signatures', JSON.stringify(sigs) === JSON.stringify({ garden: '13yjvj', woods: '1wsazqx', mill: '8pa68k', paris: 'db2e0a', tower: '1ftwobh' }), sigs);
  });

  // ---- SWAP, the test course and the practice ground (Home's side spots), the storybook on Ⓐ
  await scenario('home', async () => {
    const p = await page({ storage: { 'mossbound.save.v3': CLEARED2, 'mossbound.settings.v1': { stories: ['creek'] } } });
    await localMap(p);
    const kinds = () => p.evaluate(() => window.__fb.flow.kinds().join());
    const k0 = await kinds();
    await p.click('[data-act="swap"]');
    const k1 = await kinds();
    await gameTime(p, 0.2);
    await p.keyboard.press('KeyX');
    await gameTime(p, 0.2);
    const k2 = await kinds();
    const birds = await p.evaluate(() => window.__fb.app.current.map.birds.map((b) => b.kind).join());
    t.check('SWAP trades who is which sprout, and Ⓧ trades back', k0 !== k1 && k2 === k0 && birds === k0, { k0, k1, k2, birds });
    // off to Mossy Creek and back home: a gate already read keeps its storybook shut. (The walk also
    // takes the highlight off SWAP, where the click left it: until then ENTER would press SWAP.)
    await p.keyboard.press('ArrowRight');
    await frames(p, 2);
    await still(p);
    const away = await here(p);
    await p.keyboard.press('ArrowLeft');
    await frames(p, 2);
    await still(p);
    t.check('the storybook stays shut at a gate already read', away === 'garden' && (await here(p)) === 'gate:creek' && !(await story(p)), { away, here: await here(p) });
    await p.keyboard.press('Enter');
    await waitFor(() => story(p), 5000, 'the storybook on Ⓐ');
    t.check('Ⓐ at the book opens it again', true);
    await closeStory(p);
    await p.evaluate(() => window.__fb.app.current.map.walkTo('practice'));
    await still(p);
    await p.keyboard.press('Enter');
    await waitFor(() => p.evaluate(() => window.__fbSession?.practice === true && window.__fb.app.current?.constructor.name === 'Session'), 10000, 'the practice ground');
    t.check('the practice ground is a side spot of Home', true);
    await p.evaluate(() => window.__fb.flow.leavePractice());
    await onMap(p, 'back from practice');
    t.check('…and leaving it comes back to the map, beside it', (await here(p)) === 'practice', await here(p));
    await p.evaluate(() => window.__fb.app.current.map.walkTo('course'));
    await still(p);
    await p.keyboard.press('Enter');
    await inLevel(p, 'course');
    t.check('the test course is the other one', true);
    // a world's gate reached for the first time: its storybook opens by itself (once)
    await p.evaluate(() => window.__fb.flow.levels());
    await onMap(p);
    await p.evaluate(() => window.__fb.app.current.map.walkTo('gate:mill'));
    await waitFor(() => story(p), 20000, 'the second storybook');
    const w = await p.evaluate(() => document.querySelector('.story-world')?.textContent);
    t.check('the next world’s storybook opens by itself at its gate', /World 2/.test(w ?? ''), w);
    await closeStory(p);
    await p.keyboard.press('ArrowLeft');
    await frames(p, 2);
    await still(p);
    await p.keyboard.press('ArrowRight');
    await frames(p, 2);
    await still(p);
    t.check('…the first time only', !(await story(p)) && (await here(p)) === 'gate:mill', await here(p));
    const seen = await p.evaluate(() => JSON.parse(localStorage.getItem('mossbound.settings.v1')).stories);
    t.check('this device remembers which storybooks it has shown', seen.includes('creek') && seen.includes('mill'), seen);
  });

  // ---- a phone: a tap walks there, a tap on the stop they stand on goes in
  await scenario('touch', async () => {
    // (no storage seeded: a phone's emulated viewport opens a blank page first, which has none)
    const p = await page({ viewport: { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true } });
    await localMap(p);
    await gameTime(p, 0.4);
    await p.touchscreen.tap(422, 195);
    await waitFor(async () => !(await story(p)), 5000, 'the storybook tapped shut');
    t.check('a tap closes the storybook', true);
    await gameTime(p, 0.7);
    const at = (id) => p.evaluate((id) => { const m = window.__fb.app.current.map; const n = m.L.nodes[m.L.byId.get(id)]; return [(n.x * m.kd - m.ox) / m.dpr, (n.y * m.kd - m.oy) / m.dpr]; }, id);
    const [x, y] = await at('garden');
    await p.touchscreen.tap(x, y);
    await frames(p, 2);
    await still(p);
    t.check('a tap on Mossy Creek walks there', (await here(p)) === 'garden', await here(p));
    await gameTime(p, 0.3);
    const [x2, y2] = await at('garden');
    await p.touchscreen.tap(x2, y2);
    await inLevel(p, 'garden');
    t.check('a tap on the stop they stand on goes in', true);
  });

  // ---- an Xbox: the d-pad walks, Ⓐ goes in, Ⓧ swaps
  await scenario('xbox', async () => {
    const p = await page({ ua: XBOX_UA, pads: 1, storage: { 'mossbound.settings.v1': { stories: SEEN } } });
    await p.evaluate(() => window.__fb.flow.startLocal(['pad0', 'keysR'], [0, 0]));
    await onMap(p);
    await gameTime(p, 0.7);
    await padPress(p, 0, 15);
    await still(p);
    t.check('the d-pad walks the pair', (await here(p)) === 'garden', await here(p));
    const k0 = await p.evaluate(() => window.__fb.flow.kinds().join());
    await padPress(p, 0, 2);
    const k1 = await p.evaluate(() => window.__fb.flow.kinds().join());
    t.check('Ⓧ swaps', k0 !== k1, { k0, k1 });
    await padPress(p, 0, 0);
    await inLevel(p, 'garden');
    t.check('Ⓐ goes in', true);
  });
}

if (MODE === 'online') {
  // ---- two devices: the host walks the pair, the guest's follows live; either can say hello
  await scenario('online', async () => {
    const host = await page({ query: { extra: 'norender' }, storage: { 'mossbound.settings.v1': { name: 'Pip', color: 0, stories: SEEN }, 'mossbound.save.v3': CLEARED2 } });
    const guest = await page({ query: { extra: 'norender' }, storage: { 'mossbound.settings.v1': { name: 'Bo', color: 1 } } });
    await host.evaluate(() => window.__fb.flow.online());
    await waitFor(() => host.evaluate(() => window.__fb.app.current?.constructor.name === 'OnlineScreen'), 8000, 'host online screen');
    await host.evaluate(() => window.__fb.app.current.act('host'));
    const code = await waitFor(() => host.evaluate(() => window.__fb.flow.link?.code), 8000, 'room code');
    await guest.evaluate((c) => window.__fb.flow.online({ joinCode: c }), code);
    await waitFor(async () => (await host.evaluate(() => window.__fb.flow.link?.status)) === 'connected' && (await guest.evaluate(() => window.__fb.flow.link?.status)) === 'connected', 60000, 'pairing');
    await onMap(host, 'the host’s map');
    await onMap(guest, 'the guest’s map');
    t.check('paired, both on the map', true);
    // each device shows a storybook it hasn't shown (the guest's first, at Home): the host has read them all
    await waitFor(() => story(guest), 10000, 'the guest’s storybook');
    t.check('the guest’s device shows the storybook it hasn’t shown; the host’s doesn’t', !(await story(host)));
    await closeStory(guest);
    await gameTime(host, 0.6);
    const start = await here(host);
    await waitFor(async () => (await here(guest)) === start, 15000, 'the guest’s pair where the host’s is');
    t.check(`the guest’s pair stands where the host’s does (${start})`, true);
    // the host walks: the guest's pair follows, stop by stop
    await host.evaluate(() => window.__fb.app.current.map.walkTo('woods'));
    await still(host);
    await waitFor(async () => (await here(guest)) === 'woods', 20000, 'the guest’s pair at Fern Falls');
    t.check('the host walks to Fern Falls, the guest’s pair follows', true);
    // the guest's own presses don't walk anything
    await guest.keyboard.press('ArrowRight');
    await gameTime(guest, 0.8);
    t.check('the guest’s presses walk nobody', (await here(guest)) === 'woods' && (await here(host)) === 'woods', { guest: await here(guest), host: await here(host) });
    // either can emote: the guest's heart shows on the host's screen
    await guest.keyboard.press('KeyQ');
    await waitFor(() => host.evaluate(() => window.__fb.app.current.map.birds[1].emote === 'heart'), 10000, 'the guest’s heart on the host’s map');
    await host.keyboard.press('KeyQ');
    await waitFor(() => guest.evaluate(() => window.__fb.app.current.map.birds[0].emote === 'heart'), 10000, 'the host’s heart on the guest’s map');
    t.check('either player’s heart shows on both maps', true);
    // the host's Ⓐ takes both into the level
    await host.keyboard.press('Enter');
    await inLevel(host, 'woods');
    await inLevel(guest, 'woods');
    t.check('the host’s Ⓐ takes both into Fern Falls', true);
  });
}

for (const b of browsers) await b.close().catch(() => undefined);
t.finish('map', errors.flat());
