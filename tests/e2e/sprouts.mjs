// The two sprouts: the tall one can't fit a one-tile gap and jumps lower, but it's strong (it drags the
// small one, its tug flings it, the small one's barely budges it); the small one jumps higher, climbs
// walls (and jumps off them), and dashes once per jump. Two sprouts alike get one body with every move.
// Who's which swaps at the level select — online, the host's word holds for both screens.
import { installRig, launch, open, reporter, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const page = await open(browser);
await installRig(page);
const t = reporter();

const r = await page.evaluate(() => {
  const T = 32;
  const W = 60;
  const H = 24;
  const F = 20;
  const out = {};
  /** a flat test level (floor at row F), with `edit` adding walls and ceilings */
  const level = (edit) => {
    const g = Array.from({ length: H }, () => Array(W).fill(' '));
    for (let y = F; y < H; y++) for (let x = 0; x < W; x++) g[y][x] = '#';
    edit?.(g);
    g[F - 1][2] = '1';
    g[F - 1][4] = '2';
    g[F - 1][W - 3] = 'N';
    return { id: 'sprouts', name: 's', subtitle: '', theme: 'garden', song: 'garden', map: g.map((x) => x.join('')), movers: [] };
  };
  const feet = (b) => (b.y + b.h / 2) / T;

  // ---- how high each jumps (holding jump), and how fast each runs
  const jumps = {};
  for (const k of ['tall', 'small', 'even']) {
    const s = __rig(level(), [k, k]);
    s.place(0, 20, F); s.place(1, 21, F); s.reset(); s.secs(0.3);
    const f0 = feet(s.birds[0]);
    s.jump(0); s.c[0].jump = true;
    let top = f0;
    for (let i = 0; i < 120; i++) { s.step(); top = Math.min(top, feet(s.birds[0])); }
    s.c[0].jump = false;
    s.secs(0.5);
    s.c[0].moveX = 1; s.secs(1); const v = s.birds[0].vx; s.c[0].moveX = 0;
    jumps[k] = { rise: +(f0 - top).toFixed(2), run: Math.round(v) };
  }
  out.jumps = jumps;

  // ---- a one-tile gap: the small one (and two alike) through it, the tall one stopped at its mouth
  const tunnel = level((g) => { for (let x = 24; x <= 34; x++) g[F - 2][x] = '#'; });
  const through = {};
  for (const k of ['tall', 'small', 'even']) {
    const s = __rig(tunnel, [k, 'small']);
    s.place(0, 18, F); s.place(1, 17, F); s.reset(); s.secs(0.2);
    s.c[0].moveX = 1; s.c[1].moveX = 1; s.secs(4);
    through[k] = +(s.birds[0].x / T).toFixed(1);
  }
  out.through = through;

  // ---- a wall 6 tiles tall: the small one clings, climbs, and steps over the top; the tall one can't
  // (its partner waits near the foot of it: the vine reaches)
  const wall = level((g) => { for (let y = F - 6; y < F; y++) for (let x = 26; x < 28; x++) g[y][x] = '#'; });
  const climb = {};
  for (const k of ['small', 'tall', 'even']) {
    const s = __rig(wall, [k, 'tall']);
    s.place(0, 23, F); s.place(1, 24, F); s.reset(); s.secs(0.2);
    s.c[0].moveX = 1; s.secs(0.2); s.jump(0);
    const clung = s.until(() => s.birds[0].cling === 1, 1.5) >= 0;
    s.c[0].moveY = 1;
    s.until(() => s.birds[0].grounded && feet(s.birds[0]) < F - 5, 5);
    climb[k] = { clung, onTop: s.birds[0].grounded && Math.abs(feet(s.birds[0]) - (F - 6)) < 0.05 && s.birds[0].x > 25.5 * T };
  }
  out.climb = climb;
  // a wall jump: up and away from the wall
  {
    const s = __rig(wall, ['small', 'tall']);
    s.place(0, 23, F); s.place(1, 22, F); s.reset(); s.secs(0.2);
    s.c[0].moveX = 1; s.secs(0.2); s.jump(0);
    s.until(() => s.birds[0].cling === 1, 1.5);
    s.secs(0.2);
    const x0 = s.birds[0].x;
    s.jump(0); s.c[0].jump = true; s.c[0].moveX = 0;
    s.secs(0.25);
    out.wallJump = { away: +((x0 - s.birds[0].x) / T).toFixed(2), up: s.birds[0].vy < 0 || s.birds[0].y < F * T - 3 * T, cling: s.birds[0].cling };
  }
  // a wall jump with dash pressed in the same frame: off the wall, then the dash
  {
    const s = __rig(wall, ['small', 'tall']);
    s.place(0, 23, F); s.place(1, 22, F); s.reset(); s.secs(0.2);
    s.c[0].moveX = 1; s.secs(0.2); s.jump(0);
    s.until(() => s.birds[0].cling === 1, 1.5);
    s.secs(0.2);
    s.c[0].moveX = 0;
    s.jump(0); s.c[0].dashPressed = true; s.step();
    out.wallJumpDash = { dashing: s.birds[0].dashT > 0, speed: Math.round(Math.hypot(s.birds[0].vx, s.birds[0].vy)), cling: s.birds[0].cling };
  }

  // ---- the dash: once per jump, and only the small one (or two alike)
  const dash = {};
  for (const k of ['small', 'tall', 'even']) {
    const s = __rig(level(), [k, k]);
    s.place(0, 20, F); s.place(1, 21, F); s.reset(); s.secs(0.3);
    s.jump(0); s.c[0].jump = true; s.secs(0.15);
    s.c[0].moveX = 1; s.c[0].dashPressed = true; s.step();
    const v1 = s.birds[0].vx;
    s.secs(0.3);
    s.c[0].dashPressed = true; s.step();
    const v2 = s.birds[0].vx;
    s.c[0].moveX = 0; s.c[0].jump = false;
    s.until(() => s.birds[0].grounded, 3);
    s.secs(0.1);
    s.jump(0); s.secs(0.15); s.c[0].moveX = -1; s.c[0].dashPressed = true; s.step();
    const v3 = s.birds[0].vx;
    // jump and dash in the very same frame: the jump, and then the dash — not the jump alone
    const s2 = __rig(level(), [k, k]);
    s2.place(0, 20, F); s2.place(1, 21, F); s2.reset(); s2.secs(0.3);
    s2.c[0].moveX = 1;
    s2.jump(0); s2.c[0].dashPressed = true; s2.step();
    dash[k] = { first: Math.round(v1), again: Math.round(v2), nextJump: Math.round(v3), together: Math.round(s2.birds[0].vx), togetherJumped: !s2.birds[0].grounded };
  }
  out.dash = dash;

  // ---- on the ground: the tall one walking away drags the small one along; the small one walking away
  // from the tall one is stopped — the tall one doesn't budge
  {
    let s = __rig(level(), ['tall', 'small']);
    s.place(0, 20, F); s.place(1, 28, F); s.reset(); s.secs(0.3);
    const smallX = s.birds[1].x;
    s.c[0].moveX = -1; s.secs(1.5); s.c[0].moveX = 0;
    const dragged = (smallX - s.birds[1].x) / T;
    s = __rig(level(), ['tall', 'small']);
    s.place(0, 20, F); s.place(1, 28, F); s.reset(); s.secs(0.3);
    const tallX = s.birds[0].x;
    const sx0 = s.birds[1].x;
    s.c[1].moveX = 1; s.secs(1.5); s.c[1].moveX = 0;
    out.ground = { dragged: +dragged.toFixed(2), tallBudged: +((s.birds[0].x - tallX) / T).toFixed(2), smallGot: +((s.birds[1].x - sx0) / T).toFixed(2) };
  }
  return out;
});

const { jumps, through, climb, wallJump, wallJumpDash, dash, ground } = r;
t.check(`the small sprout jumps higher than the tall one (${jumps.small.rise} vs ${jumps.tall.rise} tiles; alike ${jumps.even.rise})`, jumps.small.rise > jumps.tall.rise + 0.6 && jumps.tall.rise > 3.1 && jumps.even.rise > 3.2, jumps);
t.check('both run at the same speed', jumps.tall.run === jumps.small.run && jumps.small.run === jumps.even.run, jumps);
t.check(`a one-tile gap lets the small sprout (and two alike) through, not the tall one (${through.tall} / ${through.small} / ${through.even})`, through.tall < 24 && through.small > 35 && through.even > 35, through);
t.check('the small sprout clings to a wall, climbs it and steps over the top', climb.small.clung && climb.small.onTop, climb);
t.check('the tall sprout can’t climb walls; two alike can', !climb.tall.clung && !climb.tall.onTop && climb.even.onTop, climb);
t.check(`a wall jump goes up and away from the wall (${wallJump.away} tiles)`, wallJump.away > 0.5 && wallJump.up && wallJump.cling === 0, wallJump);
t.check('the small sprout dashes once per jump (and again after landing)', dash.small.first > 450 && dash.small.again < 450 && dash.small.nextJump < -450, dash);
t.check('the tall sprout doesn’t dash; two alike do', dash.tall.first < 300 && dash.even.first > 450, dash);
t.check('jump and dash pressed together give both, not just the jump', dash.small.together > 450 && dash.even.together > 450 && dash.small.togetherJumped && dash.even.togetherJumped, dash);
t.check('a wall jump with dash pressed together gives both', wallJumpDash.dashing && wallJumpDash.speed > 450 && wallJumpDash.cling === 0, wallJumpDash);
t.check(`walking away, the tall sprout drags the small one along (${ground.dragged} tiles)`, ground.dragged > 1.5, ground);
t.check(`walking away, the small sprout can’t budge the tall one (moved ${ground.tallBudged} tiles)`, Math.abs(ground.tallBudged) < 0.1 && ground.smallGot < 0.6, ground);

// ---- tugs, through a real level: the tall one flings the small one far; the small one barely budges the tall one
const errors = [];
const tug = async (tugger) => {
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keysL', 'keysR']; f.playLevel(0); });
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session'), 5000, 'session');
  return page.evaluate(async (tugger) => {
    const s = window.__fbSession;
    // a flat stretch of the garden, 8 tiles of floor with room above
    const m = s.L.def.map;
    const solid = (x, y) => '#X'.includes(m[y]?.[x] ?? ' ');
    let fx = -1;
    let fy = -1;
    for (let y = 4; y < m.length - 1 && fx < 0; y++) for (let x = 2; x < m[y].length - 10 && fx < 0; x++) {
      let ok = true;
      for (let k = 0; k < 9 && ok; k++) ok = solid(x + k, y) && !solid(x + k, y - 1) && !solid(x + k, y - 2) && !solid(x + k, y - 3);
      if (ok) { fx = x; fy = y; }
    }
    s.devTeleport((fx + 1) * 32 + 16, fy * 32 - 10.01, 0);
    s.devTeleport((fx + 7) * 32 + 16, fy * 32 - 10.01, 1);
    await new Promise((r) => setTimeout(r, 1700));
    const other = s.birds[1 - tugger];
    const x0 = other.x;
    s.tug(s.birds[tugger]);
    await new Promise((r) => setTimeout(r, 700));
    return { kinds: s.birds.map((b) => b.kind).join('/'), moved: +(Math.abs(other.x - x0) / 32).toFixed(2) };
  }, tugger);
};
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}'); localStorage.setItem('mossbound.settings.v1', JSON.stringify({ ...s, even: false, swap: false })); });
await page.reload({ waitUntil: 'networkidle0' });
await waitFor(() => page.evaluate(() => !!window.__fb?.app?.current), 20000, 'boot');
const strong = await tug(0);
const weak = await tug(1);
t.check(`the tall sprout’s tug flings the small one (${strong.moved} tiles), the small one’s barely budges the tall one (${weak.moved})`, strong.kinds === 'tall/small' && strong.moved > 3 && weak.moved < 1.2, { strong, weak });

// ---- who's which: SWAP at the level select trades; "alike" (Settings) makes both the same
const kindsNow = () => page.evaluate(() => window.__fb.flow.kinds().join('/'));
await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.levels(); });
await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'LevelSelect'), 5000, 'levels');
await sleep(450);
const k0 = await kindsNow();
const label0 = await page.evaluate(() => document.querySelector('.sprouts')?.textContent ?? '');
await page.click('[data-act="swap"]');
await sleep(200);
const k1 = await kindsNow();
await page.evaluate(() => window.__fb.flow.playLevel(0));
await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session'), 5000, 'session');
const inLevel = await page.evaluate(() => window.__fbSession.birds.map((b) => `${b.kind}:${b.w}x${b.h}`).join(' '));
t.check(`SWAP trades sprouts (${k0} → ${k1}), and the level uses it (${inLevel})`, k0 === 'tall/small' && k1 === 'small/tall' && inLevel === 'small:16x16 tall:22x40' && /tall sprout/.test(label0), { k0, k1, inLevel, label0 });
const touchDash = await page.evaluate(() => { const b = document.querySelector('.tc-dash'); return b ? b.style.display !== 'none' : null; });
t.check('the phone’s DASH button is there for a sprout that can dash', touchDash !== false, touchDash);
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}'); localStorage.setItem('mossbound.settings.v1', JSON.stringify({ ...s, even: true, swap: false })); });
await page.reload({ waitUntil: 'networkidle0' });
await waitFor(() => page.evaluate(() => !!window.__fb?.app?.current), 20000, 'boot');
await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keysL', 'keysR']; f.playLevel(0); });
await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session'), 5000, 'session');
const alike = await page.evaluate(() => window.__fbSession.birds.map((b) => `${b.kind}:${b.w}x${b.h}:${b.traits.climb}:${b.traits.dash}`).join(' '));
t.check(`“alike” in Settings gives both sprouts one body with every move (${alike})`, alike === 'even:18x20:true:true even:18x20:true:true', alike);
errors.push(...page.errors);

// ---- online: the host's word on who's which holds on the guest's screen too
const online = await page.evaluate(async () => {
  const fake = (role) => ({
    role, code: 'ABCD', status: 'connected', connected: true, peerGen: 0, rtt: 30, via: 'direct', sent: [],
    send(m) { this.sent.push(m); }, sendSnap: () => true, close() { this.closed = true; }, sharedNow: () => performance.now(),
    onStatus: null, onCtrl: null, onSnap: null,
    set(s) { this.status = s; this.connected = s === 'connected'; this.onStatus?.(s, ''); },
  });
  const f = window.__fb.flow;
  const S = JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}');
  localStorage.setItem('mossbound.settings.v1', JSON.stringify({ ...S, even: false }));
  // host: a swap goes to the guest, and so does every level start
  const h = fake('host');
  f.adopt(h);
  h.set('connected');
  const shared = h.sent.filter((m) => m.t === 'kinds').map((m) => m.k.join('/'));
  // guest: takes the host's word (the newest only), and plays it
  const g = fake('guest');
  f.adopt(g);
  g.onCtrl({ t: 'kinds', k: ['small', 'tall'], c: 2 });
  g.onCtrl({ t: 'kinds', k: ['tall', 'small'], c: 1 });
  const guestSees = f.kinds().join('/');
  g.onCtrl({ t: 'load', level: 0, n: 5, c: 1, kinds: ['small', 'tall'] });
  await new Promise((r) => setTimeout(r, 400));
  const s = window.__fbSession;
  return { shared, guestSees, guestPlays: s ? s.birds.map((b) => b.kind).join('/') : null, me: s?.me };
});
t.check(`online, the host’s choice holds on the guest’s screen (host sent ${online.shared.join(', ')}; guest sees ${online.guestSees}, plays ${online.guestPlays})`, online.shared.length >= 1 && online.guestSees === 'small/tall' && online.guestPlays === 'small/tall' && online.me === 1, online);

await browser.close();
t.finish('sprouts', [...errors, ...page.errors.filter((e) => !errors.includes(e))]);
