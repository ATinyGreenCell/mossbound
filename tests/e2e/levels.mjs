// Every level: map lint, then the key obstacles played through with scripted inputs on the real maps
// (bounce + climb, ring swings, springboards + tugs, springs, updrafts, lifts, ferries, gondolas,
// airlocks) — so a level edit can't silently make the game impossible. Each obstacle is played by the
// tall and the small sprout both ways round, and by two sprouts alike: nobody's stuck whoever is which.
import { installRig, launch, open, reporter } from './harness.mjs';

const browser = await launch();
const page = await open(browser);
await installRig(page);
const r = await page.evaluate(async () => {
  const { LEVELS } = await import('/src/game/levels.ts');
  const { parseLevel } = await import('/src/game/level.ts');
  const T = 32;
  const out = { lint: {} };
  LEVELS.forEach((def, i) => {
    const L = parseLevel(def, i);
    const issues = [];
    if (new Set(def.map.map((x) => x.length)).size !== 1) issues.push('ragged rows');
    if (L.feathers.length !== 3) issues.push(`feathers ${L.feathers.length}`);
    if ((def.signs?.length ?? 0) !== L.signs.length) issues.push(`signs ${L.signs.length}/${def.signs?.length}`);
    if (!L.checkpoints.length) issues.push('no checkpoints');
    for (let g = 0; g < L.doorGroups; g++) if (!L.plates.some((p) => p.group === g) !== !L.doors.some((d) => d.group === g)) issues.push(`group ${g} unpaired`);
    // nothing spawns inside a wall
    const solid = (x, y) => { const tx = Math.floor(x / T), ty = Math.floor(y / T); return ty >= 0 && ty < L.h && tx >= 0 && tx < L.w && '#XU'.includes(def.map[ty][tx]); };
    for (const p of [...L.spawns, L.nest, ...L.checkpoints]) if (solid(p.x, p.y)) issues.push(`point in wall at ${p.x / T},${p.y / T}`);
    out.lint[def.id] = issues;
  });
  // Both springboard pits are crossed by one sprout bouncing over and then tugging the other across —
  // except that a small sprout's tug can't lift a tall one that far (measured: it lands half a tile
  // short even over the garden's narrower pit). The way over is then to hold on while they climb the
  // vine, so both signs have to say so; only the garden's did.
  out.fallbackSigns = Object.fromEntries(['garden', 'mill'].map((id) => [id, (LEVELS.find((d) => d.id === id)?.signs ?? []).filter((s) => /hold on while they climb/.test(s)).length]));
  /** steer bird i toward tile column tx (returns when within a third of a tile) */
  const walkTo = (s, i, tx, secs = 6) => s.until(() => { const d = tx * T + 16 - s.birds[i].x; s.c[i].moveX = Math.abs(d) < 10 ? 0 : Math.sign(d); return Math.abs(d) < 10; }, secs);
  const feet = (s, i) => +((s.birds[i].y + s.birds[i].h / 2) / T).toFixed(2);
  /** leap from the edge holding jump, let the string take you over the ring, pump, let go toward the far side */
  const swingAcross = (s, i, edgeX, farX, secs = 12) => {
    s.c[i].moveX = 1; s.until(() => s.birds[i].x > (edgeX - 0.6) * T, 4); s.jump(i);
    let hopped = false;
    return s.until(() => {
      const b = s.birds[i];
      s.c[i].jump = !b.hanging && !hopped;
      s.c[i].moveX = b.hanging ? Math.sign(b.vx) || 1 : 1;
      // (a climber that caught the far wall climbs up it)
      s.c[i].moveY = b.cling ? 1 : 0;
      if (b.hanging && !hopped && b.x > (farX - 1.5) * T && b.vx > -20) { s.jump(i); hopped = true; }
      if (b.hanging && hopped && b.x < (farX - 3) * T) hopped = false;
      return b.grounded && b.x > farX * T;
    }, secs) > 0;
  };
  const col = (s, i) => +(s.birds[i].x / T).toFixed(2);
  /** walk bird i to column `fromX`, run `runUp` seconds toward `dir`, then hold the jump to land on the ledge whose top is `toRow` */
  const leap = (s, i, fromX, dir, toRow, secs = 5, runUp = 0.3) => {
    if (walkTo(s, i, fromX, 4) < 0) return false;
    s.c[i].moveX = dir;
    if (runUp) s.secs(runUp);
    s.jump(i);
    const ok = s.until(() => { s.c[i].jump = true; return s.birds[i].grounded && feet(s, i) === toRow; }, secs) > 0;
    s.c[i].jump = false;
    s.c[i].moveX = 0;
    return ok;
  };

  const play = (K) => {
    const res = {};
    // ---- garden
    {
      const g = {};
      // pit 2 (4 wide): run and jump it
      let s = __rig(0, K); s.place(0, 27, 14); s.place(1, 29, 14); s.reset(); s.secs(0.1);
      s.c[0].moveX = 1; s.c[1].moveX = 1;
      s.until(() => s.birds[1].x > 30.4 * T, 3); s.jump(1);
      s.until(() => s.birds[0].x > 30.4 * T, 3); s.jump(0);
      s.secs(1.2); s.c[0].moveX = s.c[1].moveX = 0; s.secs(0.5);
      g.pitJump = col(s, 0) > 35 && col(s, 1) > 35 && !s.birds[0].ghost && !s.birds[1].ghost;
      // the high ledge: hop on the partner's head, then the partner climbs the string
      // (stand beside them, hop and drift onto their head — holding jump: the full bounce — then on up)
      s = __rig(0, K); s.place(1, 47, 14); s.place(0, 44, 14); s.reset(); s.secs(0.2);
      walkTo(s, 0, 46); s.c[0].moveX = 0; s.secs(0.2);
      s.jump(0); s.c[0].moveX = 0.35;
      s.until(() => s.birds[0].vy < -700, 2);
      s.c[0].moveX = 1;
      s.until(() => s.birds[0].grounded && s.birds[0].vy === 0 && s.birds[0].y < 12 * T, 3);
      s.c[0].moveX = 0;
      s.secs(0.6);
      g.bounceUp = feet(s, 0) === 9 && col(s, 0) > 49;
      walkTo(s, 0, 52); s.c[0].moveX = 0; s.secs(0.3);
      walkTo(s, 1, 48); s.c[1].moveX = 0; s.c[1].moveY = 1;
      g.climbAfter = s.until(() => s.birds[1].grounded && s.birds[1].y < 9 * T, 6) > 0;
      // the chasm: one holds on at the edge, the other leaps the ring and swings across
      s = __rig(0, K); s.place(0, 64, 9); s.place(1, 60, 9); s.reset(); s.c[0].anchor = true; s.secs(0.2);
      g.ringSwing = swingAcross(s, 1, 65, 71) && feet(s, 1) === 11;
      // the springboard: run and bounce off the partner at the edge, sail across, tug them over
      s = __rig(0, K); s.place(1, 80, 11); s.place(0, 74, 11); s.reset(); s.secs(0.2);
      // stand beside the partner, hop up and drift onto their head (holding jump: the full bounce),
      // then steer across — the forgiving way to do a springboard
      walkTo(s, 0, 79); s.c[0].moveX = 0; s.secs(0.2);
      s.jump(0); s.c[0].moveX = 0.35;
      s.until(() => s.birds[0].vy < -700, 2);
      s.c[0].moveX = 1;
      g.springboard = s.until(() => s.birds[0].grounded && s.birds[0].x > 86.2 * T, 4) > 0 && !s.birds[0].ghost;
      s.c[0].jump = false; walkTo(s, 0, 88); s.c[0].moveX = 0; s.secs(0.3);
      s.yank(1); s.secs(2.5);
      g.tugOver = col(s, 1) > 86 && s.birds[1].grounded && !s.birds[1].ghost;
      // the blossom up to the high plank and its feather
      s = __rig(0, K); s.place(0, 111, 14); s.place(1, 113, 14); s.reset(); s.secs(0.2);
      s.c[1].moveX = 1; s.until(() => Math.abs(s.birds[1].x - 114.5 * T) < 8, 3); s.c[1].moveX = 0;
      s.until(() => s.birds[1].vy < -500, 1); s.c[1].moveX = 0.4; s.c[1].jump = true;
      g.blossom = s.until(() => s.birds[1].grounded && feet(s, 1) === 7, 3) > 0;
      res.garden = g;
    }
    // ---- woods: the blossom up the oak, and a stump swing
    {
      const w = {};
      let s = __rig(1, K); s.place(0, 76, 18); s.place(1, 77, 18); s.reset(); s.secs(0.2);
      s.c[1].moveX = 1; s.until(() => s.birds[1].vy < -500, 3);
      w.oakBlossom = s.until(() => s.birds[1].grounded && feet(s, 1) === 12, 3) > 0;
      s = __rig(1, K); s.place(0, 31, 14); s.place(1, 27, 14); s.reset(); s.secs(0.1);
      s.place(0, 25, 14); s.place(1, 21, 14); s.reset(); s.c[0].anchor = true; s.secs(0.2);
      w.streamSwing = swingAcross(s, 1, 26, 32) && feet(s, 1) === 16;
      s = __rig(1, K); s.place(0, 100, 12); s.place(1, 96, 12); s.reset(); s.c[0].anchor = true; s.secs(0.2);
      w.stumpSwing = swingAcross(s, 1, 101, 107) && feet(s, 1) === 14 && s.birds[1].x < 110 * T;
      res.woods = w;
    }
    // ---- mill: airlock, lift, ferry, fans
    {
      const m = {};
      let s = __rig(2, K); s.place(0, 21, 16); s.place(1, 23, 16); s.reset(); s.secs(0.5);
      walkTo(s, 1, 28); s.c[1].moveX = 0;
      m.airlockIn = col(s, 1) > 27.5;
      s.secs(0.2); walkTo(s, 0, 30); s.c[0].moveX = 0;
      m.airlockBoth = col(s, 0) > 27;
      walkTo(s, 1, 32); s.c[1].moveX = 0; s.secs(0.3); walkTo(s, 0, 37); s.c[0].moveX = 0; s.secs(0.2);
      walkTo(s, 1, 36); s.c[1].moveX = 0;
      m.airlockOut = col(s, 0) > 34.5 && col(s, 1) > 34.5;
      // the lift: both hop on at the bottom and ride to the top of the wall, then step off
      s = __rig(2, K); s.place(0, 49, 16); s.place(1, 51, 16); s.reset();
      const topT = s.until(() => s.world.moverY[0] < 7.02 * T, 14);
      s.c[0].moveX = s.c[1].moveX = 1; s.secs(1.2); s.c[0].moveX = s.c[1].moveX = 0;
      m.lift = topT > 0 && feet(s, 0) === 7 && feet(s, 1) === 7 && col(s, 0) > 52;
      // the ferry: both board at the near bank, ride across the race, step off
      s = __rig(2, K); s.place(0, 74, 10); s.place(1, 75, 10); s.reset();
      s.until(() => s.world.moverX[1] < 77.05 * T, 14);
      s.until(() => { for (const i of [0, 1]) s.c[i].moveX = s.birds[i].groundMover === 1 && s.birds[i].x > 77.6 * T ? 0 : 1; return s.birds[0].groundMover === 1 && s.birds[1].groundMover === 1 && s.birds[0].x > 77.6 * T; }, 3);
      s.c[0].moveX = s.c[1].moveX = 0;
      s.until(() => s.world.moverX[1] > 87.95 * T, 12);
      s.c[0].moveX = s.c[1].moveX = 1; s.secs(0.7); s.c[0].moveX = s.c[1].moveX = 0; s.secs(0.3);
      m.ferry = col(s, 0) > 90.5 && col(s, 1) > 90.5 && feet(s, 0) === 10 && !s.birds[0].ghost;
      // the fan floats you up through the loft's hole; step off onto the loft
      s = __rig(2, K); s.place(0, 104, 10); s.place(1, 106, 10); s.reset(); s.secs(0.2);
      s.until(() => s.birds[1].y < 2.2 * T, 4); s.c[1].moveX = 1; s.secs(0.8); s.c[1].moveX = 0; s.secs(0.4);
      m.fans = feet(s, 1) === 3 && col(s, 1) > 106.5;
      res.mill = m;
    }
    // ---- paris: updraft, gondola, awning
    {
      const p = {};
      // the updraft: both ride it up (one alone is held back by the string), then hop onto the tall roof
      let s = __rig(3, K); s.place(0, 50, 13); s.place(1, 50, 13); s.reset(); s.secs(0.2);
      s.until(() => s.birds[0].y < 3 * T && s.birds[1].y < 3 * T, 5);
      // (not quite in step — the one landing on top would just hop on the other's head — and a climber
      // that catches the roof's edge climbs over it)
      s.c[0].moveX = 1; s.c[1].moveX = 0.8;
      s.until(() => { for (const i of [0, 1]) s.c[i].moveY = s.birds[i].cling ? 1 : 0; return false; }, 1.1);
      s.c[0].moveX = s.c[1].moveX = 0; s.c[0].moveY = s.c[1].moveY = 0; s.secs(0.4);
      p.updraft = feet(s, 0) === 4 && feet(s, 1) === 4 && col(s, 1) > 53;
      // the gondola: both board, ride across the boulevard, step off
      s = __rig(3, K); s.place(0, 68, 4); s.place(1, 69, 4); s.reset();
      s.until(() => s.world.moverX[0] < 71.05 * T, 12);
      // one hops down onto the gondola, shuffles over, then the other follows
      s.until(() => { s.c[1].moveX = s.birds[1].groundMover === 0 && s.birds[1].x > 72.9 * T ? 0 : 1; return s.c[1].moveX === 0; }, 3);
      s.until(() => { s.c[0].moveX = s.birds[0].groundMover === 0 ? 0 : s.birds[0].x > 71.7 * T ? 0 : 1; return s.birds[0].groundMover === 0; }, 3);
      s.c[0].moveX = s.c[1].moveX = 0;
      s.until(() => s.world.moverX[0] > 77.95 * T, 12);
      s.c[0].moveX = s.c[1].moveX = 1; s.secs(0.7); s.c[0].moveX = s.c[1].moveX = 0; s.secs(0.3);
      p.gondola = col(s, 0) > 80.5 && col(s, 1) > 80.5 && feet(s, 0) === 6;
      // the café awning up the facade
      s = __rig(3, K); s.place(0, 106, 12); s.place(1, 107, 12); s.reset(); s.secs(0.2);
      s.c[1].moveX = 1; s.until(() => s.birds[1].vy < -500, 3);
      p.awning = s.until(() => s.birds[1].grounded && feet(s, 1) === 6, 3) > 0;
      res.paris = p;
    }
    // ---- tower: the bounce step, the fan shaft, the lift, the spring, the spire fan
    {
      const t = {};
      // the big step: hop on the partner's head and on up to the girder 6 rows above
      let s = __rig(4, K); s.place(1, 14, 90); s.place(0, 16, 90); s.reset(); s.secs(0.3);
      s.jump(0); s.c[0].moveX = -0.35;
      s.until(() => s.birds[0].vy < -700, 2);
      s.c[0].moveX = -1;
      t.bounceStep = s.until(() => s.birds[0].grounded && feet(s, 0) === 84, 4) > 0;
      // …and the one left behind climbs the string up to them and mantles onto the girder (a plank:
      // it used to leave the climber dangling just under it, waiting for a jump nothing teaches)
      s.c[0].moveX = 0; s.secs(0.3);
      s.c[1].moveY = 1;
      t.bigStepClimb = s.until(() => s.birds[1].grounded && Math.abs(feet(s, 1) - 84) < 0.1, 6) > 0;
      // the fan shaft: both ride it, then step onto the girder at the top
      s = __rig(4, K); s.place(0, 34, 81); s.place(1, 34, 81); s.reset(); s.secs(0.2);
      s.until(() => s.birds[0].y < 69.5 * T && s.birds[1].y < 69.5 * T, 5);
      s.c[0].moveX = s.c[1].moveX = 1; s.secs(0.8); s.c[0].moveX = s.c[1].moveX = 0; s.secs(0.3);
      t.fanShaft = feet(s, 1) === 70 && col(s, 1) > 35;
      s = __rig(4, K); s.place(0, 26, 58); s.place(1, 28, 58); s.reset();
      s.until(() => s.world.moverY[0] < 36.05 * T, 14);
      s.c[0].moveX = s.c[1].moveX = -1; s.secs(0.6); s.c[0].moveX = s.c[1].moveX = 0;
      t.lift = feet(s, 0) === 36 && feet(s, 1) === 36;
      s = __rig(4, K); s.place(0, 15, 36); s.place(1, 13, 36); s.reset(); s.secs(0.2);
      s.c[1].moveX = -1; s.until(() => Math.abs(s.birds[1].x - 12.5 * T) < 8, 2); s.c[1].moveX = 0;
      s.until(() => s.birds[1].vy < -500, 1); s.c[1].moveX = 0.5;
      t.spring = s.until(() => s.birds[1].grounded && feet(s, 1) === 29, 3) > 0;
      s = __rig(4, K); s.place(0, 25, 20); s.place(1, 25, 20); s.reset(); s.secs(0.2);
      s.until(() => s.birds[0].y < 8 * T && s.birds[1].y < 8 * T, 5);
      s.c[0].moveX = s.c[1].moveX = -1; s.secs(0.5); s.c[0].moveX = s.c[1].moveX = 0; s.secs(0.4);
      t.spireFan = feet(s, 0) === 9 && feet(s, 1) === 9;
      // Stage 2's girders are each three rows up — all a jump has. Girder 66 reaches left over the end
      // of 63, so the step up to 63 has a takeoff edge above its landing; two columns short of it, the
      // tall sprout had about a tenth of a second to get it right and a standing jump simply failed.
      // One sprout leaps while the other waits on the girder, then follows up the vine, as the level's
      // first sign teaches and stage 1's big step is played above.
      for (const [name, edge, dir, from, to] of [['69to66', 20, 1, 69, 66], ['66to63', 20, -1, 66, 63]]) {
        s = __rig(4, K); s.place(0, edge - dir * 2, from); s.place(1, edge - dir * 3, from); s.reset(); s.secs(0.3);
        // from the very edge, standing: the step is there to be taken, not timed to a frame
        t[`stair${name}`] = leap(s, 0, edge, dir, to, 5, 0);
        // then the one left behind walks under them and climbs the vine up to the same girder
        s.c[0].moveX = 0; s.secs(0.3);
        walkTo(s, 1, col(s, 0), 4);
        s.c[1].moveY = 1;
        t[`stair${name}Follow`] = s.until(() => s.birds[1].grounded && Math.abs(feet(s, 1) - to) < 0.1, 8) > 0;
      }
      res.tower = t;
    }
    return res;
  };
  for (const K of [['tall', 'small'], ['small', 'tall'], ['even', 'even']]) out[K.join('/')] = play(K);
  return out;
});
await browser.close();

const t = reporter();
for (const [id, issues] of Object.entries(r.lint)) t.check(`lint ${id}`, issues.length === 0, issues.join('; '));
t.check('both springboard signs teach holding on while your partner climbs', Object.values(r.fallbackSigns).every((n) => n === 1), r.fallbackSigns);
for (const K of ['tall/small', 'small/tall', 'even/even']) for (const lvl of ['garden', 'woods', 'mill', 'paris', 'tower']) for (const [k, v] of Object.entries(r[K][lvl])) if (typeof v === 'boolean') t.check(`${lvl}: ${k} (${K})`, v);
t.finish('levels', page.errors);
