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
    // (`,` is a patch of soil, which parses to ground: you stand on it)
    const solid = (x, y) => { const tx = Math.floor(x / T), ty = Math.floor(y / T); return ty >= 0 && ty < L.h && tx >= 0 && tx < L.w && '#XU,'.includes(def.map[ty][tx]); };
    for (const p of [...L.spawns, L.nest, ...L.checkpoints]) if (solid(p.x, p.y)) issues.push(`point in wall at ${p.x / T},${p.y / T}`);
    // a plant unfurls over three tiles two rows up: nothing may already be sitting in them, or the leaf
    // is drawn over it (a seed hidden inside a leaf reads as a bug, and it was one)
    for (const so of L.soils) {
      for (const k of so.leaves ?? []) {
        const lx = k % L.w, ly = Math.floor(k / L.w);
        if (L.seeds.some((sd) => Math.floor(sd.x / T) === lx && Math.floor(sd.y / T) === ly)) issues.push(`seed under a leaf at ${lx},${ly}`);
      }
    }
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
  /**
   * Swing bird `i` off the lip at `edgeX`, across the gap, to land on row `land` past `farX`.
   *
   * Letting go of a swing is a judgement, not a position. The arc depends on the body, on how the
   * pump went and on where the vine caught, so what makes the crossing is a WINDOW of release points
   * rather than one — and this used to let go at a single fixed point, one and a half tiles short of
   * the far mark. That passed for years and then stopped when the fall was slowed, because a slower
   * fall carries you further from the same release: the fixed point fell outside the window for two
   * of the three pairs, while every one of those crossings was still perfectly makeable by letting
   * go a little sooner.
   *
   * Which is what a player does — you feel the release out over a couple of goes. So this tries the
   * window, earliest useful release last, and takes the first that lands. Failing all of them is the
   * thing actually worth knowing, because that is an obstacle nobody can get across, and it is the
   * only case this reports as a failure. `tries` goes in the detail either way.
   */
  const swingAcross = (make, i, edgeX, farX, land, maxX = Infinity, secs = 12) => {
    const tries = [];
    for (const lead of [1.5, 2.5, 3.5, 4.5]) {
      const s = make();
      s.c[i].moveX = 1; s.until(() => s.birds[i].x > (edgeX - 0.6) * T, 4); s.jump(i);
      let hopped = false;
      const got = s.until(() => {
        const b = s.birds[i];
        s.c[i].jump = !b.hanging && !hopped;
        s.c[i].moveX = b.hanging ? Math.sign(b.vx) || 1 : 1;
        // (a climber that caught the far wall climbs up it)
        s.c[i].moveY = b.cling ? 1 : 0;
        if (b.hanging && !hopped && b.x > (farX - lead) * T && b.vx > -20) { s.jump(i); hopped = true; }
        if (b.hanging && hopped && b.x < (farX - 3) * T) hopped = false;
        return b.grounded && b.x > farX * T;
      }, secs) > 0;
      const b = s.birds[i];
      tries.push({ lead, got, feet: feet(s, i), x: +(b.x / T).toFixed(2) });
      if (got && feet(s, i) === land && b.x < maxX * T && !b.ghost) return { ok: true, lead, tries };
    }
    return { ok: false, tries };
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
      {
        const r = swingAcross(() => { const q = __rig(0, K); q.place(0, 64, 9); q.place(1, 60, 9); q.reset(); q.c[0].anchor = true; q.secs(0.2); return q; }, 1, 65, 71, 11);
        g.ringSwing = r.ok;
        g.ringSwingDetail = r;
      }
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
      // the branch over the meadow (1.2.0): a jump can touch it but there's nothing to stand on
      s = __rig(0, K); s.place(0, 72, 11); s.place(1, 75, 11); s.reset(); s.secs(0.4);
      // a jump can touch the branch but there is nothing up there to stand on: you come straight
      // back down. The shot is what holds you there.
      g.branchNeedsTheShot = (() => {
        const b = s.birds[0];
        const ring = s.L.pegs.find((p) => Math.abs(p.x / T - 72.5) < 1);
        const up = (b.y + b.ropeOff - ring.y) / T;
        s.jump(0);
        for (let k = 0; k < 180; k++) { s.c[0].jump = true; s.step(); }
        g.branchDetail = { up: +up.toFixed(2), reach: b.traits.shot, backOnTheGround: b.grounded, feet: feet(s, 0) };
        return up > 2.9 && up <= b.traits.shot && b.grounded && feet(s, 0) === 11;
      })();
      s = __rig(0, K); s.place(0, 72, 11); s.place(1, 75, 11); s.reset(); s.secs(0.4);
      g.branchShotAndClimb = (() => {
        const b = s.birds[0];
        const ok = !!s.shootAt(0, 0, 1);
        s.c[0].moveY = 1;
        const up = s.until(() => s.tether.ends[0].seg < 34 && !b.grounded, 6);
        g.shotDetail = { ok, up, seg: +s.tether.ends[0].seg.toFixed(1), grounded: b.grounded, hanging: b.hanging, climbLen: +b.climbLen.toFixed(1) };
        return ok && up > 0 && !b.ghost;
      })();
      // the blossom up to the high plank and its feather
      s = __rig(0, K); s.place(0, 111, 14); s.place(1, 113, 14); s.reset(); s.secs(0.2);
      s.c[1].moveX = 1; s.until(() => Math.abs(s.birds[1].x - 114.5 * T) < 8, 3); s.c[1].moveX = 0;
      s.until(() => s.birds[1].vy < -500, 1); s.c[1].moveX = 0.4; s.c[1].jump = true;
      g.blossom = s.until(() => s.birds[1].grounded && feet(s, 1) === 7, 3) > 0;
      // the patch of soil (1.3.0): standing on it, the small sprout shoots its vine into the ground
      // and a leaf platform grows — the step up to the seeds hanging above, which a jump from the
      // meadow floor can't reach. The soil is at column 134; the seeds it serves are 6 rows up.
      {
        const SOIL_X = 134;
        const s2 = __rig(0, K);
        const grower = s2.birds[0].traits.grow ? 0 : 1;
        const other = 1 - grower;
        s2.place(grower, SOIL_X, 14); s2.place(other, SOIL_X - 3, 14); s2.reset(); s2.secs(0.4);
        const si = s2.world.soilUnder(s2.birds[grower]);
        g.soilUnderfoot = si >= 0;
        // pressing shoot while standing on it is the whole trigger (the rig mirrors Session.shoot)
        g.shootGrowsThePlant = s2.shootAt(grower) === 'grew' && !!s2.world.grown[si];
        s2.secs(0.6);
        const leaves = (s2.L.soils[si]?.leaves ?? []).map((li) => [li % s2.L.w, (li - (li % s2.L.w)) / s2.L.w]);
        g.leavesGrew = leaves.length === 3 && leaves.every(([lx, ly]) => s2.world.onewayAt(lx, ly));
        // the tall sprout has no knack for it: on that very soil, its shot grows nothing
        if (!s2.birds[other].traits.grow) {
          const s4 = __rig(0, K);
          s4.place(other, SOIL_X, 14); s4.place(grower, SOIL_X - 3, 14); s4.reset(); s4.secs(0.4);
          const onIt = s4.world.soilUnder(s4.birds[other]) === si;
          s4.shootAt(other);
          g.soilIsNotForTheTallOne = onIt && !s4.world.grown[si];
          g.soilIsNotForTheTallOneDetail = { onIt, grown: [...s4.world.grown] };
        }
        // Either of them can climb onto a grown leaf, and only from up there do the seeds come within
        // reach (the session's own pickup rule) — so the plant is the step, not a decoration.
        const seed = s2.L.seeds.find((p) => p.x === SOIL_X * T + T / 2 && p.y === 8 * T + T / 2);
        const touches = (s3, i) => { const b = s3.birds[i]; return !!seed && Math.abs(seed.x - b.x) < 16 && Math.abs(seed.y - b.y) < 18; };
        const reach = [grower, other].map((i) => {
          const s3 = __rig(0, K);
          s3.place(i, SOIL_X, 14); s3.place(1 - i, SOIL_X - 3, 14); s3.reset(); s3.secs(0.3);
          // from the meadow floor the seeds stay overhead, however long you hold the jump
          s3.jump(i);
          const fromFloor = s3.until(() => touches(s3, i), 2) >= 0;
          s3.until(() => s3.birds[i].grounded, 3);
          s3.c[i].jump = false; s3.secs(0.2);
          // grow it, hop up onto the leaf, and jump again from there
          s3.world.grow(si);
          s3.secs(0.6);
          s3.jump(i);
          const onLeaf = s3.until(() => s3.birds[i].grounded && s3.birds[i].y + s3.birds[i].h / 2 < 12.5 * T, 3) >= 0;
          s3.c[i].jump = false; s3.secs(0.2);
          s3.jump(i);
          const fromLeaf = s3.until(() => touches(s3, i), 2) >= 0;
          return { onLeaf, fromLeaf, fromFloor };
        });
        g.leafCarriesEither = reach.every((r) => r.onLeaf);
        g.seedsOnlyFromTheLeaf = !!seed && reach.every((r) => r.fromLeaf && !r.fromFloor);
        g.seedsOnlyFromTheLeafDetail = reach;
      }
      res.garden = g;
    }
    // ---- woods: the blossom up the oak, and a stump swing
    {
      const w = {};
      let s = __rig(1, K); s.place(0, 76, 18); s.place(1, 77, 18); s.reset(); s.secs(0.2);
      s.c[1].moveX = 1; s.until(() => s.birds[1].vy < -500, 3);
      w.oakBlossom = s.until(() => s.birds[1].grounded && feet(s, 1) === 12, 3) > 0;
      {
        const r = swingAcross(() => { const q = __rig(1, K); q.place(0, 31, 14); q.place(1, 27, 14); q.reset(); q.secs(0.1); q.place(0, 25, 14); q.place(1, 21, 14); q.reset(); q.c[0].anchor = true; q.secs(0.2); return q; }, 1, 26, 32, 16);
        w.streamSwing = r.ok;
        w.streamSwingDetail = r;
      }
      {
        const r = swingAcross(() => { const q = __rig(1, K); q.place(0, 100, 12); q.place(1, 96, 12); q.reset(); q.c[0].anchor = true; q.secs(0.2); return q; }, 1, 101, 107, 14, 110);
        w.stumpSwing = r.ok;
        w.stumpSwingDetail = r;
      }
      // the hollow under the roots (1.2.0): one tile high, so only the small sprout gets in
      {
        const s2 = __rig(1, K);
        const fits = [0, 1].map((i) => {
          s2.place(i, 128, 18); s2.place(1 - i, 127, 18); s2.reset(); s2.secs(0.3);
          const b = s2.birds[i];
          s2.c[i].moveX = 1;
          const got = s2.until(() => b.x > 131 * T, 4);
          s2.c[i].moveX = 0;
          return { kind: b.kind, inside: got > 0 };
        });
        w.nookFitsTheSmallOneOnly = fits.every((f) => (f.kind === 'tall' ? !f.inside : f.inside));
        w.nookDetail = fits;
      }
      res.woods = w;
    }
    // ---- mill: airlock, lift, ferry, fans
    {
      const m = {};
      // the millstone gate (1.2.0): the heavy sprout holds the slab, the other slips through and
      // stands on the latch so the heavy one can follow. Neither of them can do it alone.
      {
        const s2 = __rig(2, K);
        const heavy = s2.birds[0].traits.heavy ? 0 : 1;
        const light = 1 - heavy;
        s2.place(heavy, 41, 16); s2.place(light, 42, 16); s2.reset(); s2.secs(0.5);
        const slab = s2.L.plates.findIndex((p) => p.heavy);
        const onSlab = !!s2.world.plateDown[slab];
        const through = walkTo(s2, light, 46, 6);
        s2.c[light].moveX = 0;
        walkTo(s2, light, 47, 3); s2.c[light].moveX = 0; s2.secs(0.3);
        const latchIdx = s2.L.plates.findIndex((p) => !p.heavy && p.group === 2);
        const latch = !!s2.world.plateDown[latchIdx];
        const followed = walkTo(s2, heavy, 46, 8);
        s2.c[heavy].moveX = 0;
        m.heavyGate = onSlab && through > 0 && latch && followed > 0 && !s2.birds[0].ghost && !s2.birds[1].ghost;
        m.heavyGateDetail = { onSlab, through, latch, followed, slabHeldBy: s2.birds[heavy].kind };
        // and the light one alone can't open it
        const s3 = __rig(2, K);
        if (!s3.birds[light].traits.heavy) {
          s3.place(light, 41, 16); s3.place(heavy, 20, 16); s3.reset(); s3.secs(0.6);
          m.heavySlabIgnoresTheSmallOne = !s3.world.plateDown[slab];
        }
      }
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
    // ---- the shallows: wading, brambles, the deep channel, the willow, the kingcups
    //
    // (the pair is tied through all of this, as it is in play, so every crossing here is scripted for
    // the two of them: eight tiles is the whole of the vine, and a sprout sent further than that is
    // pulled back off whatever it was in the middle of — which is how a bramble hop became a death)
    {
      const h = {};
      // the wade: two rows down with the creek over the gravel. Both walk in, through, and out.
      let s = __rig(5, K); s.place(0, 16, 15); s.place(1, 14, 15); s.reset(); s.secs(0.2);
      s.c[0].moveX = 1; s.c[1].moveX = 1;
      h.wadeIn = s.until(() => s.birds[0].grounded && feet(s, 0) === 17, 4) > 0 && !s.birds[0].ghost;
      const wadeOut = s.until(() => {
        let out = 0;
        for (const i of [0, 1]) {
          const b = s.birds[i];
          if (b.grounded && feet(s, i) <= 15 && b.x > 25 * T) { s.c[i].jump = false; s.c[i].moveX = 0; out++; continue; }
          s.c[i].moveX = 1;
          if (!b.grounded) s.c[i].jump = b.vy < 0;
          else if (feet(s, i) === 17 && b.x > 23.4 * T) s.jump(i);
        }
        return out === 2;
      }, 9);
      h.wadeOut = wadeOut > 0 && !s.birds[0].ghost && !s.birds[1].ghost;
      h.wadeOutDetail = { secs: wadeOut, a: col(s, 0), b: col(s, 1), feetA: feet(s, 0), feetB: feet(s, 1) };
      // the brambles: three tiles of them along the bar, taken with a running jump — both of them
      s = __rig(5, K); s.place(0, 57, 14); s.place(1, 55, 14); s.reset(); s.secs(0.2);
      const bramStart = { a: col(s, 0), b: col(s, 1), feetA: feet(s, 0), feetB: feet(s, 1) };
      let bramDied = false;
      const hopped = s.until(() => {
        if (s.birds[0].ghost || s.birds[1].ghost) bramDied = true;
        let over = 0;
        for (const i of [0, 1]) {
          const b = s.birds[i];
          if (b.grounded && b.x > 65 * T) { s.c[i].jump = false; s.c[i].moveX = 0; over++; continue; }
          s.c[i].moveX = 1;
          if (!b.grounded) s.c[i].jump = b.vy < 0;
          else if (b.x > 60.9 * T && b.x < 62 * T) s.jump(i);
        }
        return over === 2;
      }, 9);
      h.brambles = hopped > 0 && feet(s, 0) === 14 && feet(s, 1) === 14 && !s.birds[0].ghost && !s.birds[1].ghost;
      h.bramblesDetail = { secs: hopped, start: bramStart, died: bramDied, a: col(s, 0), b: col(s, 1), feetA: feet(s, 0), feetB: feet(s, 1) };
      // the deep channel: one holds on at the lip, the other leaps the ring and swings across
      {
        const r2 = swingAcross(() => { const q = __rig(5, K); q.place(0, 72, 14); q.place(1, 68, 14); q.reset(); q.c[0].anchor = true; q.secs(0.2); return q; }, 1, 73, 79, 16);
        h.channelSwing = r2.ok;
        h.channelSwingDetail = r2;
      }
      // and the firefly in it, which hangs under the near lip: one holds on up there while the other
      // walks off the edge and the vine lowers it straight past. Measured against the pickup box
      // itself (20 x 22 px), because "near enough" here means exactly that box.
      {
        const s2 = __rig(5, K); s2.place(0, 72, 14); s2.place(1, 69, 14); s2.reset(); s2.secs(0.3);
        const ff = s2.L.feathers.find((q) => Math.abs(q.x / T - 75.5) < 0.6);
        const hooked = !!s2.shootAt(0, 0.7, 0.7);
        let near = Infinity;
        s2.c[0].moveX = 1;
        for (let k = 0; k < 120 * 4; k++) {
          s2.step();
          const b = s2.birds[0];
          if (!b.ghost && ff) near = Math.min(near, Math.max(Math.abs(b.x - ff.x) / 20, Math.abs(b.y - ff.y) / 22));
        }
        h.channelFirefly = !!ff && hooked && near <= 1 && !s2.birds[0].ghost;
        h.channelFireflyDetail = { hooked, near: +near.toFixed(2), ghost: s2.birds[0].ghost, at: { x: col(s2, 0), y: +(s2.birds[0].y / T).toFixed(2) } };
      }
      // the willow branch, four rows up: a shot hooks it and the climb lifts you to the seeds on it
      {
        const s2 = __rig(5, K); s2.place(0, 107, 14); s2.place(1, 104, 14); s2.reset(); s2.secs(0.4);
        const hooked = !!s2.shootAt(0, 0, 1);
        s2.c[0].moveY = 1;
        const up = s2.until(() => !s2.birds[0].grounded && s2.birds[0].y < 12 * T, 6);
        h.willowShot = hooked && up > 0 && !s2.birds[0].ghost;
        h.willowShotDetail = { hooked, up, reach: s2.birds[0].traits.shot, y: +(s2.birds[0].y / T).toFixed(2) };
      }
      // the shelf past it is five rows up, which is nobody's jump: one hops off the other's head,
      // and the one left below climbs the vine after them
      s = __rig(5, K); s.place(1, 114, 14); s.place(0, 112, 14); s.reset(); s.secs(0.2);
      walkTo(s, 0, 113); s.c[0].moveX = 0; s.secs(0.2);
      s.jump(0); s.c[0].moveX = 0.35;
      s.until(() => s.birds[0].vy < -700, 2);
      s.until(() => s.birds[0].grounded && s.birds[0].vy === 0 && s.birds[0].y < 11 * T, 3);
      s.c[0].moveX = 0; s.c[0].jump = false; s.secs(0.6);
      h.shelfBounce = feet(s, 0) === 9 && col(s, 0) > 112 && col(s, 0) < 119;
      h.shelfBounceDetail = { col: col(s, 0), feet: feet(s, 0), ghost: s.birds[0].ghost };
      walkTo(s, 1, col(s, 0), 4);
      s.c[1].moveX = 0;
      s.c[1].moveY = 1;
      h.shelfClimbAfter = s.until(() => s.birds[1].grounded && feet(s, 1) === 9, 8) > 0;
      h.shelfClimbAfterDetail = { col: col(s, 1), feet: feet(s, 1) };
      // the kingcups: a flower bounces you up to the high shelf and its firefly. The partner waits on
      // the far side of it, within the vine of a six-row rise.
      s = __rig(5, K); s.place(0, 129, 14); s.place(1, 133, 14); s.reset(); s.secs(0.2);
      walkTo(s, 0, 131, 4); s.c[0].moveX = 0;
      const sprung = s.until(() => s.birds[0].vy < -500, 2);
      s.c[0].jump = true;
      h.kingcup = sprung >= 0 && s.until(() => s.birds[0].grounded && feet(s, 0) === 8, 4) > 0;
      h.kingcupDetail = { sprung, col: col(s, 0), feet: feet(s, 0), ghost: s.birds[0].ghost };
      // --- act three's channel: the same shape as act one's, six tiles with a ring over the middle
      {
        const r3 = swingAcross(() => { const q = __rig(5, K); q.place(0, 277, 14); q.place(1, 273, 14); q.reset(); q.c[0].anchor = true; q.secs(0.2); return q; }, 1, 278, 284, 16);
        h.secondChannelSwing = r3.ok;
        h.secondChannelSwingDetail = r3;
      }
      res.shallows = h;
    }
    // ---- lily pond: the pads, the island's plant, and the stump out of the water
    {
      const p = {};
      // the first pad carries them both over sixteen tiles of open water to the island
      let s = __rig(6, K); s.place(0, 21, 16); s.place(1, 20, 16); s.reset(); s.secs(0.3);
      const chub = s.L.creatures.findIndex((c) => c.kind === 4);
      p.pondHasAChub = chub >= 0;
      /**
       * Ride the pad: keep your footing near the middle of it, and tap a hop the moment the fish is
       * out of the water and close. A tap, not a jump — the pad moves on while you are off it, and a
       * full jump lands you in the water behind it. (`walk`: hold right instead, to step off at the end.)
       */
      const ride = (secs, pred, walk = false) =>
        s.until(() => {
          const w2 = s.world;
          const out = w2.creatureU[chub] > 0;
          const mid = w2.moverX[0] + 1.5 * T;
          for (const i of [0, 1]) {
            const b = s.birds[i];
            if (walk) s.c[i].moveX = 1;
            else {
              const d = mid - b.x + (i ? -11 : 11);
              s.c[i].moveX = Math.abs(d) > 7 ? Math.sign(d) : 0;
            }
            if (!b.grounded) s.c[i].jump = false;
            else if (out && Math.abs(b.x - w2.creatureX[chub]) < 2.4 * T) s.jump(i);
          }
          return pred();
        }, secs);
      p.padRides = ride(10, () => s.world.moverX[0] > 32 * T) > 0 && s.birds[0].grounded && s.birds[1].grounded && !s.birds[0].ghost && !s.birds[1].ghost;
      p.padRidesDetail = { a: col(s, 0), b: col(s, 1), feet: feet(s, 0), ghost: [s.birds[0].ghost, s.birds[1].ghost] };
      p.padToIsland = ride(6, () => col(s, 0) > 37 && col(s, 1) > 36.5 && s.birds[0].grounded && s.birds[1].grounded && feet(s, 0) === 16, true) > 0 && !s.birds[0].ghost && !s.birds[1].ghost;
      p.padToIslandDetail = { a: col(s, 0), b: col(s, 1), feet: feet(s, 0) };
      // the island's patch of soil: the small sprout grows the leaf, and the leaf is the step up
      {
        const s2 = __rig(6, K);
        const grower = s2.birds[0].traits.grow ? 0 : 1;
        s2.place(grower, 45, 16); s2.place(1 - grower, 42, 16); s2.reset(); s2.secs(0.4);
        const si = s2.world.soilUnder(s2.birds[grower]);
        p.islandSoil = si >= 0 && s2.shootAt(grower) === 'grew' && !!s2.world.grown[si];
        s2.secs(0.8);
        // a hop from beside the patch puts you on the leaf two rows above it
        walkTo(s2, grower, 44, 3); s2.c[grower].moveX = 0; s2.secs(0.2);
        s2.jump(grower); s2.c[grower].moveX = 0.4;
        p.islandLeaf = s2.until(() => s2.birds[grower].grounded && feet(s2, grower) === 14, 4) > 0;
        p.islandLeafDetail = { si, feet: feet(s2, grower), col: col(s2, grower) };
      }
      // the second crossing: a pad to the stone in the middle (a hop up onto it, one row)
      s = __rig(6, K); s.place(0, 52, 16); s.place(1, 51, 16); s.reset(); s.secs(0.3);
      s.until(() => s.world.moverX[1] > 58.5 * T, 9);
      s.c[0].moveX = 1; s.c[1].moveX = 1;
      s.until(() => col(s, 0) > 61.4, 3);
      s.jump(0);
      p.padToStone = s.until(() => s.birds[0].grounded && feet(s, 0) === 15 && col(s, 0) > 62, 5) > 0 && !s.birds[0].ghost;
      p.padToStoneDetail = { col: col(s, 0), feet: feet(s, 0) };
      // the pad on the far half starts at the other end of its run, so whoever waits on the stone
      // gets it coming back — the clock is wound to where that happens
      s = __rig(6, K); s.place(0, 64, 15); s.place(1, 63, 15); s.reset(); s.at(3.4); s.secs(0.3);
      s.c[0].moveX = 1; s.c[1].moveX = 1;
      s.until(() => col(s, 0) > 67.5 && col(s, 1) > 66.8, 5);
      s.c[0].moveX = 0; s.c[1].moveX = 0;
      s.until(() => s.world.moverX[2] > 73.5 * T, 9);
      s.c[0].moveX = 1; s.c[1].moveX = 1;
      p.padToFarShore = s.until(() => col(s, 0) > 78 && col(s, 1) > 77.5 && s.birds[0].grounded && s.birds[1].grounded && feet(s, 0) === 16, 6) > 0 && !s.birds[0].ghost && !s.birds[1].ghost;
      p.padToFarShoreDetail = { a: col(s, 0), b: col(s, 1), feet: feet(s, 0) };
      // the bay's firefly, under the near lip: one holds on, the other steps off and is lowered past it
      {
        const s2 = __rig(6, K); s2.place(0, 96, 16); s2.place(1, 93, 16); s2.reset(); s2.at(3); s2.secs(0.3);
        const ff = s2.L.feathers.find((q) => Math.abs(q.x / T - 99.5) < 0.6);
        const hooked = !!s2.shootAt(0, 0.7, 0.7);
        let near = Infinity;
        s2.c[0].moveX = 1;
        for (let k = 0; k < 120 * 4; k++) {
          s2.step();
          const b = s2.birds[0];
          if (!b.ghost && ff) near = Math.min(near, Math.max(Math.abs(b.x - ff.x) / 20, Math.abs(b.y - ff.y) / 22));
        }
        p.bayFirefly = !!ff && hooked && near <= 1 && !s2.birds[0].ghost;
        p.bayFireflyDetail = { hooked, near: +near.toFixed(2), ghost: s2.birds[0].ghost, at: { x: col(s2, 0), y: +(s2.birds[0].y / T).toFixed(2) } };
      }
      // the stump: four rows of face. The one that clings climbs it like ivy; the other follows up
      // the vine. Whichever way round the pair is, both of them get onto the shelf off its top.
      {
        const s2 = __rig(6, K);
        const climber = s2.birds[0].traits.climb ? 0 : 1;
        const other = 1 - climber;
        s2.place(climber, 115, 14); s2.place(other, 113, 14); s2.reset(); s2.secs(0.3);
        s2.c[climber].moveX = 1;
        s2.jump(climber);
        const up = s2.until(() => {
          const b = s2.birds[climber];
          s2.c[climber].moveX = 1;
          s2.c[climber].moveY = b.cling ? 1 : 0;
          return b.grounded && feet(s2, climber) === 9;
        }, 8);
        p.stumpClimb = up > 0;
        p.stumpClimbDetail = { up, climber, feet: feet(s2, climber), col: col(s2, climber) };
        s2.c[climber].moveX = 0; s2.c[climber].moveY = 0; s2.secs(0.4);
        walkTo(s2, other, col(s2, climber), 5);
        s2.c[other].moveX = 0;
        s2.c[other].moveY = 1;
        p.stumpFollow = s2.until(() => s2.birds[other].grounded && feet(s2, other) === 9, 9) > 0;
        p.stumpFollowDetail = { feet: feet(s2, other), col: col(s2, other) };
      }
      // --- act two's long reach: nineteen tiles of open water and one pad over all of it
      {
        const s2 = __rig(6, K); s2.place(0, 152, 16); s2.place(1, 151, 16); s2.reset(); s2.secs(0.3);
        const rode = s2.until(() => s2.world.moverX[4] > 165 * T, 11);
        s2.c[0].moveX = 1; s2.c[1].moveX = 1;
        p.longPad = rode > 0 && s2.until(() => col(s2, 0) > 170 && col(s2, 1) > 169.5 && s2.birds[0].grounded && s2.birds[1].grounded && feet(s2, 0) === 16, 6) > 0 && !s2.birds[0].ghost && !s2.birds[1].ghost;
        p.longPadDetail = { rode, a: col(s2, 0), b: col(s2, 1), feet: feet(s2, 0) };
      }
      res.lilypond = p;
    }
    // ---- reed run: the mats, the shaft between two stalks, the chute
    {
      const q = {};
      // the old reed mat: eight tiles of it, and it goes as you cross
      let s = __rig(7, K); s.place(0, 16, 18); s.place(1, 14, 18); s.reset(); s.secs(0.2);
      s.c[0].moveX = 1; s.c[1].moveX = 1;
      q.firstMat = s.until(() => col(s, 0) > 27 && s.birds[0].grounded && feet(s, 0) === 18, 6) > 0 && !s.birds[0].ghost;
      q.firstMatDetail = { col: col(s, 0), ghost: s.birds[0].ghost };
      // the shaft: two stalks three tiles apart. Take them in turns and you climb — every sprout can,
      // and the partner waits on the floor directly below, so the vine's eight tiles are all upward.
      s = __rig(7, K); s.place(0, 47, 18); s.place(1, 47, 18); s.reset(); s.secs(0.3);
      {
        const b = s.birds[0];
        s.jump(0);
        for (let k = 0; k < 1200; k++) {
          const c = s.c[0];
          c.moveX = b.cling ? b.cling : b.kickSide !== 0 ? -b.kickSide : 1;
          c.moveY = b.cling ? 1 : 0;
          if (!b.cling && b.wallTouchT > 0 && b.wallTouch !== 0 && b.kickSide !== b.wallTouch) s.jump(0);
          else if (b.grounded && feet(s, 0) === 12) s.jump(0);
          else c.jump = !b.cling && b.vy < 0;
          s.step();
          if (b.grounded && feet(s, 0) === 11) break;
        }
        q.shaftClimb = s.birds[0].grounded && feet(s, 0) <= 12;
        q.shaftClimbDetail = { feet: feet(s, 0), col: col(s, 0), ghost: b.ghost, climbs: !!s.birds[0].traits.climb };
      }
      // …and the one left at the bottom comes up the vine after them
      s.c[0].moveX = 0; s.c[0].jump = false; s.secs(0.5);
      s.c[1].moveY = 1;
      q.shaftFollow = s.until(() => s.birds[1].grounded && feet(s, 1) <= 12, 9) > 0;
      q.shaftFollowDetail = { feet: feet(s, 1), col: col(s, 1) };
      // the terrace's patch of soil, and the firefly the grown leaf is the step to
      {
        const s2 = __rig(7, K);
        const grower = s2.birds[0].traits.grow ? 0 : 1;
        s2.place(grower, 77, 14); s2.place(1 - grower, 80, 14); s2.reset(); s2.secs(0.4);
        const si = s2.world.soilUnder(s2.birds[grower]);
        q.terraceSoil = si >= 0 && s2.shootAt(grower) === 'grew' && !!s2.world.grown[si];
      }
      // the chute: the spray holds them both up to the plank nine rows above the terrace, which is
      // further than the vine is long — so this one is only ridden together
      s = __rig(7, K); s.place(0, 88, 14); s.place(1, 88, 14); s.reset(); s.secs(0.2);
      s.until(() => s.birds[0].y < 6 * T && s.birds[1].y < 6 * T, 7);
      s.c[0].moveX = 1; s.c[1].moveX = 0.8;
      s.until(() => { for (const i of [0, 1]) s.c[i].moveY = s.birds[i].cling ? 1 : 0; return false; }, 1.2);
      s.c[0].moveX = s.c[1].moveX = 0; s.c[0].moveY = s.c[1].moveY = 0; s.secs(0.5);
      q.chute = feet(s, 0) === 5 && feet(s, 1) === 5 && col(s, 0) > 89;
      q.chuteDetail = { a: { col: col(s, 0), feet: feet(s, 0) }, b: { col: col(s, 1), feet: feet(s, 1) } };
      // the mat up at the top of the reeds
      s = __rig(7, K); s.place(0, 108, 6); s.place(1, 106, 6); s.reset(); s.secs(0.2);
      s.c[0].moveX = 1; s.c[1].moveX = 1;
      q.topMat = s.until(() => col(s, 0) > 119 && s.birds[0].grounded && feet(s, 0) === 6, 6) > 0 && !s.birds[0].ghost;
      q.topMatDetail = { col: col(s, 0), ghost: s.birds[0].ghost };
      // --- act two's shaft, the second of them: seven rows again, and the only way back up the shoulder
      {
        const s2 = __rig(7, K); s2.place(0, 228, 12); s2.place(1, 228, 12); s2.reset(); s2.secs(0.3);
        const b = s2.birds[0];
        s2.jump(0);
        for (let k = 0; k < 1200; k++) {
          const c = s2.c[0];
          c.moveX = b.cling ? b.cling : b.kickSide !== 0 ? -b.kickSide : 1;
          c.moveY = b.cling ? 1 : 0;
          if (!b.cling && b.wallTouchT > 0 && b.wallTouch !== 0 && b.kickSide !== b.wallTouch) s2.jump(0);
          else if (b.grounded && feet(s2, 0) === 6) s2.jump(0);
          else c.jump = !b.cling && b.vy < 0;
          s2.step();
          if (b.grounded && feet(s2, 0) === 5) break;
        }
        q.secondShaftClimb = b.grounded && feet(s2, 0) <= 6;
        q.secondShaftClimbDetail = { feet: feet(s2, 0), col: col(s2, 0), ghost: b.ghost };
        s2.c[0].moveX = 0; s2.c[0].jump = false; s2.secs(0.5);
        s2.c[1].moveY = 1;
        q.secondShaftFollow = s2.until(() => s2.birds[1].grounded && feet(s2, 1) <= 6, 9) > 0;
        q.secondShaftFollowDetail = { feet: feet(s2, 1), col: col(s2, 1) };
      }
      res.reedrun = q;
    }
    return res;
  };
  for (const K of [['tall', 'small'], ['small', 'tall'], ['even', 'even']]) out[K.join('/')] = play(K);
  return out;
});

// ---- where a sprout is put down: a level's start, a run continued from a lantern (which is also where
// an update's reload and a partner's rejoin carry on from), and a seed that gave up waiting by its
// partner and went home. Each must be somewhere that sprout's own body fits — for every pairing, at
// every lantern. Fern Falls' third lantern stands right by the roots arch, and the second sprout used
// to be put down inside it: wedged in the rock, or clinging to it from inside.
const homes = await page.evaluate(async () => {
  const { Session } = await import('/src/game/session.ts');
  const { LEVELS, COURSE_INDEX } = await import('/src/game/levels.ts');
  const { app, flow } = window.__fb;
  const bad = [];
  let checked = 0;
  // (pairs put down within reach of each other, and those of them a VINE press there couldn't tie)
  const pairs = { beside: 0, cantTie: [] };
  const grounds = [...LEVELS.map((_, i) => ({ level: i })), { level: COURSE_INDEX }, { level: LEVELS.length, practice: true }];
  for (const g of grounds) {
    for (const kinds of [['tall', 'small'], ['small', 'tall'], ['even', 'even']]) {
      for (let cp = -1; ; cp++) {
        const s = new Session(app, flow, { ...g, mode: 'local', seats: ['keysL', 'keysR'], profiles: flow.profiles(), kinds, ...(cp >= 0 ? { resume: { cp, seeds: [], grown: [], feathers: 0, time: 0, gen: 1 } } : {}) });
        const lanterns = s.L.checkpoints.length;
        for (const b of s.birds) {
          checked++;
          if (!s.world.boxFree(b.x, b.y, b.w, b.h)) bad.push(`${s.L.def.id} ${cp < 0 ? 'start' : `lantern ${cp}`} ${kinds.join('/')}: the ${b.kind} sprout at ${(b.x / 32).toFixed(2)},${(b.y / 32).toFixed(2)}`);
        }
        // VINE ties only with a clear line between the two: put down beside each other, they can tie there
        const [A, B] = s.birds;
        if (Math.hypot(A.x - B.x, A.y - B.y) <= 2.5 * 32) {
          pairs.beside++;
          s.tieVine(A);
          if (!s.tether.tied) pairs.cantTie.push(`${s.L.def.id} ${cp < 0 ? 'start' : `lantern ${cp}`} ${kinds.join('/')}`);
        }
        s.dispose();
        if (cp + 1 >= lanterns) break;
      }
    }
  }
  // a seed whose partner hovers over a pit with nowhere to land beside them gives up after a while and
  // goes home — to a lantern spot that, here, a rock juts into
  const { parseLevel } = await import('/src/game/level.ts');
  const { World } = await import('/src/game/world.ts');
  const { Bird } = await import('/src/game/bird.ts');
  const T = 32;
  const H = 20, W = 40;
  const map = Array.from({ length: H }, (_, y) => (y >= 15 ? '#'.repeat(15) + ' '.repeat(20) + '#'.repeat(5) : ' '.repeat(W)));
  map[13] = ' '.repeat(12) + 'X' + ' '.repeat(W - 13);
  map[14] = '  1 2' + ' '.repeat(W - 6) + 'N';
  const L = parseLevel({ id: 'rock', name: 'rock', subtitle: '', theme: 'garden', song: 'garden', map }, 0);
  const world = new World(L);
  const partner = new Bird(0);
  partner.setKind('small');
  partner.x = 19.5 * T; partner.y = 13 * T; partner.grounded = false;
  const home = { x: 12 * T - 2, y: 14 * T + 12 };
  const goneHome = {};
  for (const kind of ['tall', 'small', 'even']) {
    const g = new Bird(1);
    g.setKind(kind);
    g.x = 19 * T; g.y = 17 * T;
    g.die('fall');
    let k = 0;
    for (; k < 120 * 8 && g.ghost; k++) g.stepGhost(1 / 120, world, partner, home);
    goneHome[kind] = { back: !g.ghost, afterSecs: +(k / 120).toFixed(2), fits: world.boxFree(g.x, g.y, g.w, g.h), nearHome: +(Math.hypot(g.x - home.x, g.y - home.y) / T).toFixed(2) };
  }
  return { checked, bad, goneHome, pairs };
});
await browser.close();

const t = reporter();
for (const [id, issues] of Object.entries(r.lint)) t.check(`lint ${id}`, issues.length === 0, issues.join('; '));
t.check('both springboard signs teach holding on while your partner climbs', Object.values(r.fallbackSigns).every((n) => n === 1), r.fallbackSigns);
for (const K of ['tall/small', 'small/tall', 'even/even']) for (const lvl of Object.keys(r[K])) for (const [k, v] of Object.entries(r[K][lvl])) if (typeof v === 'boolean') t.check(`${lvl}: ${k} (${K})`, v, r[K][lvl][`${k}Detail`] ?? '');
t.check(`every sprout is put down somewhere its body fits: the start and every lantern, every level, every pairing (${homes.checked} placings)`, homes.bad.length === 0, homes.bad);
t.check(`…and wherever the two are put down beside each other, VINE ties them there (${homes.pairs.beside} placings)`, homes.pairs.beside > 0 && homes.pairs.cantTie.length === 0, homes.pairs.cantTie);
t.check('a seed that gives up waiting and goes home is put down somewhere it fits there too', Object.values(homes.goneHome).every((v) => v.back && v.fits && v.nearHome < 2), homes.goneHome);
t.finish('levels', page.errors);
