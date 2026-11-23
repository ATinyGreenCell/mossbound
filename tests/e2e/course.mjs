// The two-player test course: the first card on the level select, open on a journal with nothing in
// it, played by two real players (nobody walked for anyone), on one screen or online — and, like the
// practice ground whose stations it borrows, it writes nothing to the save.
import { frames, gameTime, launch, mapHere, mapStill, open, reporter, sleep, storyOpen, waitFor } from './harness.mjs';

const browser = await launch();
const t = reporter();
const errors = [];
const screen = (page) => page.evaluate(() => window.__fb.app.current?.constructor.name ?? null);
const oneLevelSelect = (page) => waitFor(() => page.evaluate(() => document.querySelectorAll('.levels-screen').length === 1 && window.__fb.app.current?.constructor.name === 'LevelSelect'), 8000, 'one level select on screen');
/** a new Session (not the one marked old) that satisfies `pred` */
const newSession = (page, pred, label) => waitFor(() => page.evaluate((src) => { const s = window.__fbSession; return !!s && !s.__old && window.__fb.app.current === s && new Function('s', `return ${src}`)(s); }, pred), 8000, label);
const markOld = (page) => page.evaluate(() => { if (window.__fbSession) window.__fbSession.__old = true; });

// ---- the level itself: the practice ground's stations, with its own name and a two-player welcome
{
  const page = await open(browser);
  const lint = await page.evaluate(async () => {
    const { COURSE, COURSE_INDEX, PRACTICE, LEVELS } = await import('/src/game/levels.ts');
    const { parseLevel } = await import('/src/game/level.ts');
    const L = parseLevel(COURSE, COURSE_INDEX);
    return {
      index: COURSE_INDEX, id: COURSE.id, inLevels: LEVELS.some((d) => d.id === COURSE.id || d === COURSE),
      sameMap: COURSE.map.join('\n') === PRACTICE.map.join('\n'), signs: L.signs.length, wanted: COURSE.signs.length,
      wordless: L.signs.filter((s) => !s.text).length, intro: COURSE.signs[0], feathers: L.feathers.length, lanterns: L.checkpoints.length,
    };
  });
  t.check('the course is the practice ground\'s stations under its own name', lint.id === 'course' && lint.sameMap && !lint.inLevels && lint.index === -1, lint);
  t.check('…every station signed, and the welcome is written for two', lint.signs === lint.wanted && !lint.wordless && /each other/.test(lint.intro) && !/practice ground/i.test(lint.intro), lint);
  errors.push(...page.errors);
  await page.close();
}

// ---- one screen: the first card, lit on a fresh journal, and two real players in it
{
  const page = await open(browser);
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.levels(); });
  await oneLevelSelect(page);
  // (a journal with nothing in it opens at Home, its storybook open)
  await waitFor(() => storyOpen(page), 5000, 'the storybook');
  await gameTime(page, 0.4);
  await page.keyboard.press('Enter');
  await waitFor(async () => !(await storyOpen(page)), 5000, 'the storybook closed');
  const spot = await page.evaluate(() => { const m = window.__fb.app.current.map; return { here: m.here, open: m.state.node[m.L.byId.get('course')], from: m.L.edges.find((e) => e.b === m.L.byId.get('course')) && m.L.nodes[m.L.edges.find((e) => e.b === m.L.byId.get('course')).a].id }; });
  t.check('the test course is a side spot of Home, open from the start', spot.open === 1 && spot.from === 'gate:creek' && spot.here === 'gate:creek', spot);
  await page.evaluate(() => window.__fb.app.current.map.walkTo('course'));
  await frames(page, 2);
  await mapStill(page);
  t.check('…a walk from Home (Ⓐ plays it)', (await mapHere(page)) === 'course', await mapHere(page));
  await gameTime(page, 0.3);

  const before = await page.evaluate(() => JSON.stringify(window.__fb.save.save));
  await page.keyboard.press('Enter');
  await newSession(page, 's.course', 'the course');
  const s0 = await page.evaluate(() => { const s = window.__fbSession; return { id: s.L.def.id, course: s.course, offRecord: s.offRecord, solo: s.solo, dummy: s.dummy, local: s.birds.map((b) => b.local), seats: s.opts.seats, online: s.online }; });
  t.check('Ⓐ on it starts the course: two players, nobody walked for either', s0.id === 'course' && s0.course && s0.offRecord && !s0.solo && s0.dummy === null && s0.local.every(Boolean) && s0.seats?.[0] !== s0.seats?.[1], s0);

  // the second player really is a player: the right half of the keyboard walks the second sprout
  const x0 = await page.evaluate(() => window.__fbSession.birds.map((b) => b.x));
  await page.keyboard.down('ArrowRight');
  const walked = await waitFor(() => page.evaluate((x) => window.__fbSession.birds[1].x > x[1] + 40, x0), 5000, 'player two walking').catch(() => false);
  await page.keyboard.up('ArrowRight');
  const x1 = await page.evaluate(() => window.__fbSession.birds.map((b) => b.x));
  t.check(`player two's keys walk the second sprout, and only that one (${x0.map(Math.round)} → ${x1.map(Math.round)})`, !!walked && Math.abs(x1[0] - x0[0]) < 4, { x0, x1 });

  // the menu starts it over as the course, not as some level
  await markOld(page);
  await page.keyboard.press('Escape');
  await waitFor(() => page.evaluate(() => !!document.querySelector('.btn[data-act=restart]')), 4000, 'the pause menu');
  const label = await page.evaluate(() => document.querySelector('.btn[data-act=restart]').textContent);
  await sleep(450);
  await page.click('.btn[data-act=restart]');
  const again = await newSession(page, 's.course', 'the course again').catch(() => false);
  t.check(`the pause menu's "${label}" starts the course over`, !!again);

  // nothing found here is written down: a seed, a firefly, a lantern's worth of time, the clear itself
  await page.evaluate(() => {
    const s = window.__fbSession;
    s.takeSeed(0, true);
    s.takeFeather(0, true);
    s.time = 45;
    s.flushRun();
  });
  await sleep(300);
  await page.evaluate(() => window.__fbSession.clear(45));
  await waitFor(() => page.evaluate(() => !!document.querySelector('.btn[data-act=next]')), 6000, 'the clear card');
  const after = await page.evaluate(() => JSON.stringify(window.__fb.save.save));
  const stored = await page.evaluate(() => localStorage.getItem('mossbound.save.v3'));
  const card = await page.evaluate(() => [...document.querySelectorAll('.ov-buttons .btn')].map((b) => b.dataset.act));
  t.check('the course writes nothing to the save (seed, firefly, run, clear)', before === after && !/course/.test(stored ?? ''), { before, after });
  t.check('its clear card offers NEXT LEVEL, not the ending', card.includes('next') && !card.includes('ending'), card);

  // …and NEXT LEVEL from the course is the first real level (pressed until it takes: a card nobody
  // asked for holds off the first few polls on purpose)
  await markOld(page);
  await sleep(450);
  const next = await waitFor(async () => {
    await page.evaluate(() => document.querySelector('.btn[data-act=next]')?.click());
    return page.evaluate(() => window.__fb.app.current?.constructor.name === 'LevelSelect' && window.__fb.app.current.map.here);
  }, 8000, 'the map').catch(() => false);
  t.check(`NEXT LEVEL from the course goes back to the map, beside Home (${next})`, next === 'course', next);
  errors.push(...page.errors);
  await page.close();
}

// ---- online: the host's card sends the guest along (protocol 7: a load of level -1)
const fake = () => {
  window.__fake = (role) => ({
    role, code: 'ABCD', status: 'connected', connected: true, peerGen: 0, rtt: 30, via: 'direct', sent: [],
    send(m) { this.sent.push(m); }, sendSnap: () => true, close() { this.closed = true; }, sharedNow: () => performance.now(),
    onStatus: null, onCtrl: null, onSnap: null,
  });
};
{
  const page = await open(browser);
  await page.evaluate(fake);
  await page.evaluate(() => { const l = (window.__h = window.__fake('host')); window.__fb.flow.adopt(l); window.__fb.flow.levels(); });
  await oneLevelSelect(page);
  await sleep(450);
  await page.evaluate(() => window.__fb.app.current.act('course'));
  await newSession(page, 's.course && s.online', 'the host in the course');
  const host = await page.evaluate(() => ({ me: window.__fbSession.me, loads: window.__h.sent.filter((m) => m.t === 'load') }));
  t.check('the host\'s course card sends the guest a load of the course', host.me === 0 && host.loads.length >= 1 && host.loads.every((m) => m.level === -1 && !m.resume), host);
  errors.push(...page.errors);
  await page.close();
}
{
  const page = await open(browser);
  await page.evaluate(fake);
  await page.evaluate(() => { const l = (window.__g = window.__fake('guest')); window.__fb.flow.adopt(l); l.onCtrl({ t: 'lobby', c: 1 }); });
  await oneLevelSelect(page);
  await page.evaluate(() => window.__fb.app.current.act('course'));
  await sleep(300);
  const guestSpot = await page.evaluate(() => { const m = window.__fb.app.current.map; return { open: m.state.node[m.L.byId.get('course')], screen: window.__fb.app.current.constructor.name, sent: window.__g.sent.filter((x) => x.t === 'load').length }; });
  t.check('the guest sees the course on the map too, but going in is the host\'s', guestSpot.open === 1 && guestSpot.screen === 'LevelSelect' && !guestSpot.sent, guestSpot);
  // a level number that is neither a level nor the course is ignored, as before
  await page.evaluate(() => { window.__g.onCtrl({ t: 'load', level: -2, n: 5, c: 2, gen: 1 }); window.__g.onCtrl({ t: 'load', level: 99, n: 6, c: 3, gen: 1 }); });
  await sleep(500);
  t.check('a load of a level that does not exist is still ignored', (await screen(page)) === 'LevelSelect');
  await page.evaluate(() => window.__g.onCtrl({ t: 'load', level: -1, n: 7, c: 4, gen: 1, kinds: ['tall', 'small'] }));
  await newSession(page, 's.course && s.online', 'the guest in the course');
  const guest = await page.evaluate(() => { const s = window.__fbSession; return { me: s.me, id: s.L.def.id, offRecord: s.offRecord, kinds: s.birds.map((b) => b.kind), acked: window.__g.sent.some((m) => m.t === 'loaded' && m.n === 7) }; });
  t.check('the guest follows the host into the course, as the second sprout, and says so', guest.me === 1 && guest.id === 'course' && guest.offRecord && guest.acked && guest.kinds.join() === 'tall,small', guest);
  errors.push(...page.errors);
  await page.close();
}

await browser.close();
t.finish('course', errors);
