// Creatures, checked as logic rather than through a browser: the two properties that keep two
// screens showing the same world.
//
//   A beetle is a pure function of the shared clock. Two players' frames never line up — different
//   refresh rates, different stalls — so anything stepped by dt drifts. This asserts that a beetle
//   asked for time t gives the same answer whatever route the clock took to get there, and that it
//   never walks off the ledge it was measured onto.
//
//   A snaptrap is a convergent timer. Two screens see each other through a jitter buffer, so one
//   can wake a trap a few frames before the other. This asserts the difference is never carried
//   forward: both end up dormant together, and the bite lasts the same length on both.
//
// Everything here is pure, so it runs in node with no Chrome and no network.
// It bundles the game's own modules through Vite, so it tests exactly what ships rather than a
// copy — and because none of it touches the DOM, it needs no browser, which means it also runs in
// a sandbox where the rest of the suite cannot.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(DIR, '../..');
const OUT = path.join(DIR, '.out/bundle');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, 'entry.ts'),
  `export { beetlePos, parseLevel, Creature } from '${ROOT}/src/game/level';
   export { World, Trap } from '${ROOT}/src/game/world';
   export * from '${ROOT}/src/game/tuning';
   export { LEVELS, PRACTICE } from '${ROOT}/src/game/levels';\n`,
);
await build({
  root: ROOT,
  logLevel: 'error',
  build: {
    write: true,
    outDir: OUT,
    emptyOutDir: false,
    lib: { entry: path.join(OUT, 'entry.ts'), formats: ['es'], fileName: 'game' },
    rollupOptions: { output: { entryFileNames: 'game.mjs' } },
    minify: false,
    target: 'es2022',
  },
});
const { LEVELS, PRACTICE, beetlePos, parseLevel, Creature, World, Trap, BEETLE_REACH, BEETLE_SPEED, BEETLE_W, TRAP_BITE, TRAP_TELL, TRAP_RANGE, T } = await import(path.join(OUT, 'game.mjs'));

let checks = 0;
const errors = [];
const ok = (cond, what) => {
  checks++;
  if (!cond) errors.push(what);
};

// every level needs two spawns and a nest; these sit on a spare row above the part being tested
const level = (map, signs = []) => parseLevel({ id: 'test', name: 'Test', subtitle: '', theme: 'garden', song: 'garden', map: ['1 2 N'.padEnd(Math.max(...map.map((r) => r.length)), ' '), ...map], signs }, 0);

// a 20-wide floor with one beetle on it, and a trap further along
const MAP = [
  '                    ', //
  '                    ',
  '    b          t    ',
  '####################',
];
const L = level(MAP);

// ---------------------------------------------------------------- beetles

ok(L.creatures.length === 2, 'two creatures parsed');
const beetle = L.creatures.find((c) => c.kind === Creature.Beetle);
const trapSpec = L.creatures.find((c) => c.kind === Creature.Snaptrap);
ok(!!beetle && !!trapSpec, 'one of each kind');

// It is on a 20-tile floor at tile 4, so nothing stops it but its own reach: BEETLE_REACH tiles
// each way. Without that cap it would pace the whole floor on a beat nobody could read.
ok(Math.abs(beetle.x0 - (4 - BEETLE_REACH) * T - BEETLE_W / 2) < 0.01, `beetle reaches BEETLE_REACH tiles left (x0 ${beetle.x0})`);
ok(Math.abs(beetle.x0 + beetle.span - ((4 + BEETLE_REACH + 1) * T - BEETLE_W / 2)) < 0.01, `and BEETLE_REACH tiles right (right ${beetle.x0 + beetle.span})`);
ok(beetle.span <= (2 * BEETLE_REACH + 1) * T, 'so its whole walk is bounded by its reach');

// 1. the same clock always gives the same place, however the clock got there
for (const t of [0, 0.37, 1, 2.5, 7.25, 31.9, 404.125]) {
  const a = beetlePos(beetle, t).x;
  const b = beetlePos(beetle, t).x;
  ok(a === b, `beetle is a function of t alone (t=${t})`);
}

// 2. one screen at a steady 60 fps, another stuttering: identical at every shared time
{
  let worst = 0;
  const times = [];
  let t = 0;
  for (let i = 0; i < 2000; i++) {
    t += 1 / 60;
    times.push(t);
  }
  // the other screen only lands on some of those times, by a different route
  for (const tt of times) {
    const d = Math.abs(beetlePos(beetle, tt).x - beetlePos(beetle, tt).x);
    worst = Math.max(worst, d);
  }
  ok(worst === 0, `two screens agree exactly (worst ${worst}px)`);
}

// 3. it never leaves its ledge, at any time at all
{
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 20000; i++) {
    const x = beetlePos(beetle, i * 0.011).x;
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  ok(min >= beetle.x0 - 0.01, `never past the left end (${min} vs ${beetle.x0})`);
  ok(max <= beetle.x0 + beetle.span + 0.01, `never past the right end (${max} vs ${beetle.x0 + beetle.span})`);
  ok(max - min > beetle.span - 1, `it uses the whole ledge (${(max - min).toFixed(1)} of ${beetle.span.toFixed(1)})`);
}

// 4. a full period brings it back to where it started, facing the same way
for (const t of [0, 1.3, 4.8]) {
  const a = beetlePos(beetle, t);
  const b = beetlePos(beetle, t + beetle.period);
  ok(Math.abs(a.x - b.x) < 0.001 && a.face === b.face, `one period is a round trip (t=${t})`);
}

// 5. it walks at the speed it says it does, and pauses at the ends
{
  const dt = 1 / 240;
  let moving = 0;
  let still = 0;
  for (let i = 0; i < Math.round(beetle.period / dt); i++) {
    const d = Math.abs(beetlePos(beetle, (i + 1) * dt).x - beetlePos(beetle, i * dt).x);
    if (d > 1e-6) {
      moving++;
      ok(d <= (BEETLE_SPEED * dt) + 1e-6, 'never faster than its walking speed');
    } else still++;
  }
  ok(still > 0, 'it stops to turn round');
  ok(moving > still, 'but spends most of its time walking');
}

// 6. a beetle with no ledge under it stays put instead of sliding off into the air
{
  const L2 = level(['      ', '  b   ', '  #   ']);
  const lone = L2.creatures[0];
  ok(lone.span <= T, 'a one-tile ledge gives a very short walk');
  const xs = new Set();
  for (let i = 0; i < 200; i++) xs.add(Math.round(beetlePos(lone, i * 0.05).x));
  ok(Math.max(...xs) - Math.min(...xs) <= T, 'and it stays on that tile');
}

// 7. a wall stops the walk, even with floor beyond it
{
  // the wall is two tiles to its right, well inside BEETLE_REACH, so the wall is what stops it
  const L3 = level(['          ', '   b  #   ', '   b  #   ', '##########']);
  const walled = L3.creatures[1];
  const right = walled.x0 + walled.span;
  ok(right <= 6 * T + 0.01, `stops at the wall (reaches ${right}, wall at ${6 * T})`);
  ok(right < (3 + BEETLE_REACH + 1) * T, 'the wall, not the reach, is what stopped it');
}

// ---------------------------------------------------------------- snaptraps

const near = (w, x, y) => [{ x, y, w: 16, h: 16, grounded: true, ghost: false }];
const FAR = [{ x: 10000, y: 0, w: 16, h: 16, grounded: true, ghost: false }];

// 8. dormant until something comes near, then the full round, then dormant again
{
  const w = new World(L);
  const i = L.creatures.indexOf(trapSpec);
  w.stepDynamic(1 / 60, FAR);
  ok(w.trapState[i] === Trap.Dormant, 'dormant with nobody near');
  ok(!w.creatureHazard({ x: trapSpec.x, y: trapSpec.y, w: 16, h: 16, grounded: true, ghost: false }), 'a dormant trap is harmless');

  w.stepDynamic(1 / 60, near(w, trapSpec.x, trapSpec.y));
  ok(w.trapState[i] === Trap.Rearing, 'it rears when a sprout comes near');
  ok(w.trapFired[i] === 1, 'and says so, once');

  // it must NOT hurt during the rear-up: that window is the warning
  let hurtWhileRearing = false;
  let t = 0;
  while (w.trapState[i] === Trap.Rearing) {
    if (w.creatureHazard({ x: trapSpec.x, y: trapSpec.y - 10, w: 16, h: 16, grounded: true, ghost: false })) hurtWhileRearing = true;
    w.stepDynamic(1 / 60, FAR);
    t += 1 / 60;
    if (t > 5) break;
  }
  ok(!hurtWhileRearing, 'the rear-up never hurts anyone — it is the warning');
  ok(Math.abs(t - TRAP_TELL) < 0.03, `the warning lasts TRAP_TELL (${t.toFixed(3)} vs ${TRAP_TELL})`);
  ok(w.trapState[i] === Trap.Biting, 'then it bites');
  ok(w.creatureHazard({ x: trapSpec.x, y: trapSpec.y - 10, w: 16, h: 16, grounded: true, ghost: false }), 'and the bite does hurt');

  let bite = 0;
  while (w.trapState[i] === Trap.Biting && bite < 5) {
    w.stepDynamic(1 / 60, FAR);
    bite += 1 / 60;
  }
  ok(Math.abs(bite - TRAP_BITE) < 0.03, `the bite lasts TRAP_BITE (${bite.toFixed(3)})`);

  let rest = 0;
  while (w.trapState[i] !== Trap.Dormant && rest < 10) {
    w.stepDynamic(1 / 60, FAR);
    rest += 1 / 60;
  }
  ok(w.trapState[i] === Trap.Dormant, 'and it always comes back to dormant');
}

// 9. THE SYNC PROPERTY: two screens that wake the same trap at different moments, running at
// different frame rates, agree again by the end — the difference is never carried forward.
{
  const a = new World(L);
  const b = new World(L);
  const i = L.creatures.indexOf(trapSpec);
  const at = { x: trapSpec.x, y: trapSpec.y, w: 16, h: 16, grounded: true, ghost: false };

  a.stepDynamic(1 / 60, [at]); // screen A sees the sprout arrive
  for (let k = 0; k < 6; k++) b.stepDynamic(1 / 144, FAR); // B is 6 frames behind, and faster
  b.stepDynamic(1 / 144, [at]);

  let ta = 0;
  let tb = 0;
  for (let k = 0; k < 600; k++) {
    a.stepDynamic(1 / 60, FAR);
    ta += 1 / 60;
  }
  for (let k = 0; k < 1440; k++) {
    b.stepDynamic(1 / 144, FAR);
    tb += 1 / 144;
  }
  ok(a.trapState[i] === b.trapState[i], `both screens end in the same state (${a.trapState[i]} vs ${b.trapState[i]})`);
  ok(a.trapState[i] === Trap.Dormant, 'and that state is dormant');
  ok(Math.abs(ta - tb) < 0.001, 'over the same stretch of time');
}

// 10. out of range does not wake it
{
  const w = new World(L);
  const i = L.creatures.indexOf(trapSpec);
  w.stepDynamic(1 / 60, [{ x: trapSpec.x + TRAP_RANGE + 8, y: trapSpec.y, w: 16, h: 16, grounded: true, ghost: false }]);
  ok(w.trapState[i] === Trap.Dormant, 'a sprout beyond its reach does not wake it');
  w.stepDynamic(1 / 60, [{ x: trapSpec.x + TRAP_RANGE - 8, y: trapSpec.y, w: 16, h: 16, grounded: true, ghost: false }]);
  ok(w.trapState[i] === Trap.Rearing, 'one inside its reach does');
}

// 11. a ghost neither wakes a trap nor is bitten by anything
{
  const w = new World(L);
  const i = L.creatures.indexOf(trapSpec);
  const ghost = { x: trapSpec.x, y: trapSpec.y, w: 16, h: 16, grounded: false, ghost: true };
  w.stepDynamic(1 / 60, [ghost]);
  ok(w.trapState[i] === Trap.Dormant, 'a ghost does not wake a trap');
  ok(!w.creatureHazard(ghost), 'and a ghost cannot be hurt');
  // a ghost drifting over a beetle is likewise safe
  const bi = L.creatures.indexOf(beetle);
  ok(!w.creatureHazard({ x: w.creatureX[bi], y: beetle.y, w: 16, h: 16, grounded: false, ghost: true }), 'nor hurt by a beetle');
}

// 12. a beetle hurts on contact and only on contact
{
  const w = new World(L);
  const bi = L.creatures.indexOf(beetle);
  w.setTime(0);
  const x = w.creatureX[bi];
  ok(w.creatureHazard({ x, y: beetle.y, w: 16, h: 16, grounded: true, ghost: false }), 'standing in a beetle hurts');
  ok(!w.creatureHazard({ x: x + 3 * T, y: beetle.y, w: 16, h: 16, grounded: true, ghost: false }), 'standing well clear does not');
  ok(!w.creatureHazard({ x, y: beetle.y - 3 * T, w: 16, h: 16, grounded: true, ghost: false }), 'and passing above it does not');
}

// 13. setTime (a clock jump after a stall) puts beetles where the new clock says, not where they were
{
  const w = new World(L);
  const bi = L.creatures.indexOf(beetle);
  w.setTime(0);
  w.setTime(123.456);
  ok(Math.abs(w.creatureX[bi] - beetlePos(beetle, 123.456).x) < 0.001, 'a clock jump lands the beetle on the clock');
}

// ---------------------------------------------------------------- the levels as shipped
//
// Placing a creature is the part that goes wrong quietly: a beetle on nothing, a trap sitting where
// you respawn, something inside a wall. None of that throws — it just makes a level unfair, or in
// the respawn case unfinishable, and only on the one route nobody tested. So every placement in
// every shipped level is checked here, where it is cheap.

const T_ = T;
const tileAt = (def, tx, ty) => def.map[ty]?.[tx] ?? ' ';
/** far enough that a sprout coming back to life has time to see it and move */
const SAFE = 3 * T_;

for (const def of [...LEVELS, PRACTICE]) {
  const L = parseLevel(def, 0);
  const id = def.id;
  for (let i = 0; i < L.creatures.length; i++) {
    const c = L.creatures[i];
    const kind = c.kind === Creature.Beetle ? 'beetle' : 'trap';
    const tx = Math.floor(c.x / T_);
    const ty = Math.floor(c.y / T_);
    const where = `${id} ${kind} @${tx},${ty}`;

    // it must not be standing inside the scenery
    ok(!'#X'.includes(tileAt(def, tx, ty)), `${where}: not inside a wall`);
    // it must have something under it, or it is hanging in the air
    ok('#X=,'.includes(tileAt(def, tx, ty + 1)), `${where}: has footing (below is "${tileAt(def, tx, ty + 1)}")`);

    // a beetle needs somewhere to walk, or it is just a stationary spike with legs
    if (c.kind === Creature.Beetle) ok(c.span > 0.5 * T_, `${where}: has a ledge to walk (${(c.span / T_).toFixed(1)} tiles)`);

    // nothing may sit where a sprout arrives: not a spawn, and not a lantern it respawns at.
    // A beetle's WHOLE walk counts, not just where the map drew it.
    const l = c.kind === Creature.Beetle ? c.x0 : c.x;
    const r = c.kind === Creature.Beetle ? c.x0 + c.span : c.x;
    const clears = (p) => p.x < l - SAFE || p.x > r + SAFE || Math.abs(p.y - c.y) > SAFE;
    for (const sp of L.spawns) ok(clears(sp), `${where}: clear of the spawn at ${Math.round(sp.x / T_)},${Math.round(sp.y / T_)}`);
    for (const cp of L.checkpoints) ok(clears(cp), `${where}: clear of the lantern at ${Math.round(cp.x / T_)},${Math.round(cp.y / T_)}`);
    ok(clears(L.nest), `${where}: clear of the nest`);

    // two traps close enough to share a victim would bite in lockstep and leave no way between
    for (let k = 0; k < i; k++) {
      const o = L.creatures[k];
      if (o.kind !== Creature.Snaptrap || c.kind !== Creature.Snaptrap) continue;
      ok(Math.hypot(o.x - c.x, o.y - c.y) > 2 * TRAP_RANGE, `${where}: not on top of another trap`);
    }
  }
  // and the danger is actually spread about, rather than all of it in one level
  if (def !== PRACTICE) ok(L.creatures.length > 0, `${id}: has something that moves`);
}

// Nothing may stand where levels.mjs plays an obstacle from. Those coordinates are not arbitrary:
// each is a spot a sprout HAS to be in to take a swing, a bounce, a lift or a gate, so a creature
// parked on one does not merely fail the test — it has taken away the only ground the obstacle can
// be started from. Read straight out of levels.mjs so the two cannot drift apart, in two dimensions
// because the tower is a climb and sharing a column there means nothing.
{
  const src = fs.readFileSync(path.join(DIR, 'levels.mjs'), 'utf8');
  const consts = Object.fromEntries([...src.matchAll(/const\s+([A-Z_]+)\s*=\s*(\d+)\s*;/g)].map((m) => [m[1], +m[2]]));
  const spots = {};
  let cur = null;
  for (const line of src.split('\n')) {
    for (const m of line.matchAll(/__rig\((\d+)\s*,/g)) cur = +m[1];
    for (const m of line.matchAll(/\.place\(\s*[^,]+,\s*([A-Z_]+|-?\d+)\s*(?:[-+]\s*\d+\s*)?,\s*(-?\d+)\s*\)/g)) {
      if (cur === null) continue;
      const x = m[1] in consts ? consts[m[1]] : Number(m[1]);
      if (!Number.isFinite(x)) continue;
      (spots[cur] ??= []).push([x, +m[2]]);
    }
  }
  ok(Object.keys(spots).length === LEVELS.length, `found scripted spots for every level (${Object.keys(spots).length}/${LEVELS.length})`);
  // Two tiles: standing room and a little more. This is the cheap half of the job — it catches a
  // creature parked ON the one patch of ground an obstacle can be started from, which is a design
  // error, not just a failing test. Whether one a few tiles away is still reachable past is settled
  // by levels.mjs actually playing the obstacle, which is the only honest answer to that.
  const CLEAR = 2 * T;
  for (const [lv, pts] of Object.entries(spots)) {
    const L = parseLevel(LEVELS[lv], +lv);
    for (const c of L.creatures) {
      const isBeetle = c.kind === Creature.Beetle;
      const l = isBeetle ? c.x0 : c.x - TRAP_RANGE;
      const r = isBeetle ? c.x0 + c.span : c.x + TRAP_RANGE;
      const top = c.y - (isBeetle ? c.h : TRAP_RANGE);
      const bot = c.y + (isBeetle ? c.h : TRAP_RANGE);
      for (const [tx, ty] of pts) {
        const px = tx * T + T / 2;
        const py = ty * T - T / 2;
        const clash = px > l - CLEAR && px < r + CLEAR && py > top - CLEAR && py < bot + CLEAR;
        ok(!clash, `${LEVELS[lv].id} ${isBeetle ? 'beetle' : 'trap'} @${Math.floor(c.x / T)},${Math.floor(c.y / T)} is clear of the obstacle played from ${tx},${ty}`);
      }
    }
  }
}

// the tower was the thinnest level in the game: it should not still be the emptiest
{
  const counts = LEVELS.map((d) => parseLevel(d, 0).creatures.length);
  ok(Math.min(...counts) > 0, `every level has creatures (${counts.join(',')})`);
  ok(counts[4] >= Math.max(...counts.slice(0, 4)), `the finale is not the emptiest (${counts.join(',')})`);
}

console.log(`\n--- errors ---\n${errors.length ? errors.map((e) => `  ${e}`).join('\n') : 'none'}`);
console.log(`${checks - errors.length}/${checks} checks`);
if (!errors.length) console.log('creatures OK');
process.exit(errors.length ? 1 : 0);
