// The birds' movement envelope and the feel of the string, measured with the game's own modules:
// jumps, flutter, bounces, catching, climbing, swinging (energy kept, pumping, launches), pulleys,
// tugs and zips — and the string never stretching.
import { installRig, launch, open, reporter } from './harness.mjs';

const browser = await launch();
const page = await open(browser);
await installRig(page);
const r = await page.evaluate(() => {
  const T = 32;
  // test map: floor at row 20, a 5-high cliff (cols 40-58) with a 6-wide pit and a ring, a far ledge
  const W = 100, H = 26, F = 20;
  const g = Array.from({ length: H }, () => Array(W).fill(' '));
  const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c; };
  fill(0, F, W - 1, H - 1, '#');
  fill(40, F - 5, 58, H - 1, '#');
  fill(59, F - 5, 64, H - 1, ' ');
  fill(65, F - 4, W - 1, H - 1, '#');
  fill(55, 10, 57, 10, '#'); // a perch, and a ring out in the open air to hang a pendulum from
  g[8][60] = 'o';
  g[F - 7][61] = 'o';
  g[F - 1][2] = '1'; g[F - 1][4] = '2'; g[F - 1][95] = 'N';
  const def = { id: 'phys', name: 'p', subtitle: '', theme: 'garden', song: 'garden', map: g.map((x) => x.join('')) };
  const out = {};
  let s;
  // jumps
  s = __rig(def); s.place(0, 10, F); s.place(1, 12, F); s.reset(); s.secs(0.3);
  let y0 = s.birds[0].y, minY = y0; s.jump(0);
  for (let i = 0; i < 120; i++) { s.step(); minY = Math.min(minY, s.birds[0].y); }
  out.jumpHeight = +((y0 - minY) / T).toFixed(2);
  for (const flutter of [false, true]) {
    s = __rig(def); s.place(0, 4, F); s.place(1, 6, F); s.reset(); s.secs(0.2);
    s.c[0].moveX = 1; s.c[1].moveX = 1; s.secs(0.6);
    const x0 = s.birds[0].x; s.jump(0); s.step();
    for (let k = 0; k < 400 && !s.birds[0].grounded; k++) { s.c[0].jump = flutter || s.birds[0].vy < 0; s.step(); }
    out[flutter ? 'flutterJump' : 'runJump'] = +((s.birds[0].x - x0) / T).toFixed(2);
  }
  // bounce off the partner's head
  s = __rig(def); s.place(1, 20, F); s.place(0, 20, F - 5); s.reset(); s.c[0].jump = true;
  const floor0 = s.birds[1].y; minY = Infinity;
  for (let i = 0; i < 240; i++) { s.step(); minY = Math.min(minY, s.birds[0].y); }
  out.bounce = +((floor0 - minY) / T).toFixed(2);
  // catch, hang, climb, mantle
  s = __rig(def); s.place(0, 56, F - 5); s.place(1, 57, F - 5); s.reset(); s.secs(0.2);
  const ax0 = s.birds[0].x;
  s.c[1].moveX = 1; s.secs(0.5); s.c[1].moveX = 0; s.secs(1.5);
  out.hang = { hanging: s.birds[1].hanging, len: +s.tether.length.toFixed(1), anchorMoved: +Math.abs(s.birds[0].x - ax0).toFixed(1), ghost: s.birds[1].ghost };
  s.c[1].moveY = 1;
  out.climbSecs = s.until(() => s.birds[1].grounded, 5);
  out.climbOnLedge = s.birds[1].y < (F - 5) * T && s.birds[1].x < 59 * T;
  // pendulum: the partner holds on at the ledge, the string runs over the ring, the bird swings below
  // it from the side with no input — a pendulum should keep its height
  const ringX = 60.5 * T, ringY = 8.5 * T;
  /** the partner holds on at the perch; the string bends over the ring; the bird hangs at angle a0 */
  const hangFromRing = (a0 = Math.PI / 4) => {
    // (place both birds, then reset the string — moving one alone would stretch it across the map)
    const s = __rig(def); s.place(0, 57, 10);
    const A = s.birds[0];
    const r = 256 - Math.hypot(ringX - A.x, ringY - A.y) - 0.5;
    s.birds[1].place({ x: ringX + r * Math.sin(a0), y: ringY + r * Math.cos(a0) });
    s.reset();
    const B = s.birds[1];
    s.tether.pts.length = 0;
    s.tether.pts.push({ x: ringX, y: ringY, s: Math.sign((ringX - A.x) * (B.y - ringY) - (ringY - A.y) * (B.x - ringX)) || 1, peg: true });
    s.tether.update(A, B);
    s.c[0].anchor = true;
    return s;
  };
  s = hangFromRing();
  const swingTops = []; let lastVx = 0;
  for (let i = 0; i < 9 * 120; i++) {
    s.step();
    const b = s.birds[1];
    if (Math.sign(b.vx) !== Math.sign(lastVx) && lastVx !== 0) swingTops.push(b.y);
    lastVx = b.vx;
  }
  out.ringPivot = s.tether.pts.map((p) => (p.peg ? 'peg' : 'corner'));
  out.swingTops = swingTops.slice(0, 10).map((y) => +((y - ringY) / T).toFixed(2));
  const radius = 256 - Math.hypot(ringX - s.birds[0].x, ringY - s.birds[0].y);
  const bottom = ringY + radius;
  const firstTop = swingTops[1], lastTop = swingTops[Math.min(9, swingTops.length - 1)];
  out.swingKept = +((bottom - lastTop) / (bottom - firstTop)).toFixed(3);
  // pumping builds it up
  s = hangFromRing(); let maxSide = 0;
  for (let i = 0; i < 6 * 120; i++) { const b = s.birds[1]; s.c[1].moveX = b.hanging ? Math.sign(b.vx) || 1 : 0; s.step(); maxSide = Math.max(maxSide, Math.abs(b.x - ringX)); }
  out.pumpedReach = +(maxSide / T).toFixed(2);
  // let go at the bottom of a fast swing: launch at (at least) the swing's speed
  {
    let launched = null;
    for (let i = 0; i < 4 * 120 && !launched; i++) {
      const b = s.birds[1];
      s.c[1].moveX = b.hanging ? Math.sign(b.vx) || 1 : 0;
      if (b.hanging && Math.abs(b.x - ringX) < 14 && Math.abs(b.vx) > 250) {
        const before = Math.hypot(b.vx, b.vy);
        const vx0 = b.vx;
        s.jump(1); s.step();
        launched = { before: +before.toFixed(0), after: +Math.hypot(b.vx, b.vy).toFixed(0), up: b.vy < 0, sameWay: Math.sign(b.vx) === Math.sign(vx0) && Math.abs(b.vx) >= Math.abs(vx0) * 0.98 };
      } else s.step();
    }
    out.release = launched;
  }
  // a zero-length frame mid-swing (a repeated animation-frame timestamp): the swing's speed is taken
  // from how far it really moved, and dividing that by a zero frame used to turn both sprouts — and
  // the camera with them — into NaN, for good
  {
    const s = hangFromRing();
    s.secs(0.4);
    s.c[1].moveX = 1;
    s.secs(0.3);
    s.tether.solve(s.birds, [true, true], 0);
    s.tether.solve(s.birds, [true, true], 0);
    s.c[1].moveX = 0;
    s.secs(0.5);
    const b = s.birds[1];
    out.zeroFrame = { finite: [b.x, b.y, b.vx, b.vy, s.tether.length].every(Number.isFinite), hanging: b.hanging };
  }
  // momentum carries through the air: thrown sideways with the string slack, no input
  s = __rig(def); s.place(0, 30, F); s.place(1, 31, F - 6); s.reset(); s.birds[0].present = false; s.secs(0.01);
  s.birds[1].vx = 600; s.birds[1].vy = -600; s.secs(0.5);
  out.airCarry = +(s.birds[1].vx / 600).toFixed(2);
  // swing across the pit under the ring: pump and let go over the far ledge
  s = __rig(def); s.place(0, 58, F - 5); s.place(1, 55, F - 5); s.reset(); s.secs(0.2);
  s.c[1].moveX = 1; s.secs(0.45); s.jump(1); s.secs(0.35); s.c[1].jump = false;
  let hopped = false;
  out.swingAcross = s.until(() => {
    const b = s.birds[1];
    s.c[1].moveX = b.hanging ? Math.sign(b.vx) || 1 : 1;
    if (b.hanging && !hopped && b.x > 63.6 * T && b.vx > -20) { s.jump(1); hopped = true; }
    return b.grounded && b.x > 65 * T;
  }, 10);
  // pulley: walk away to haul the hanging partner up and over the edge
  s = __rig(def); s.place(0, 56, F - 5); s.place(1, 57, F - 5); s.reset(); s.secs(0.2);
  s.c[1].moveX = 1; s.secs(0.5); s.c[1].moveX = 0; s.secs(1.2);
  const hy = s.birds[1].y; s.c[0].moveX = -1; s.secs(1.6); s.c[0].moveX = 0; s.secs(0.3);
  out.pulley = { lifted: +((hy - s.birds[1].y) / T).toFixed(2), mantled: s.birds[1].grounded, len: +s.tether.length.toFixed(1) };
  // tug the partner across the pit
  s = __rig(def); s.place(0, 57, F - 5); s.place(1, 64, F - 5); s.reset(); s.secs(0.1);
  s.birds[1].place({ x: 66 * T, y: (F - 4) * T - 10.01 }); s.reset(); s.secs(0.3);
  s.yank(0); s.secs(2);
  out.tug = { x: +(s.birds[0].x / T).toFixed(2), grounded: s.birds[0].grounded, ghost: s.birds[0].ghost };
  // zip to an anchored partner: they don't budge
  s = __rig(def); s.place(0, 57, F - 5); s.place(1, 66, F - 4); s.reset(); s.c[1].anchor = true; s.secs(0.3);
  const anchorX = s.birds[1].x; s.yank(0); s.secs(2);
  out.zip = { x: +(s.birds[0].x / T).toFixed(2), grounded: s.birds[0].grounded, anchorMoved: +Math.abs(s.birds[1].x - anchorX).toFixed(2) };
  // walking apart: the string holds
  s = __rig(def); s.place(0, 20, F); s.place(1, 22, F); s.reset(); s.secs(0.2);
  s.c[0].moveX = -1; s.c[1].moveX = 1; let maxLen = 0;
  for (let i = 0; i < 360; i++) { s.step(); maxLen = Math.max(maxLen, s.tether.length); }
  out.apartMax = +maxLen.toFixed(1);
  return out;
});

const t = reporter();
for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(12)} ${JSON.stringify(v)}`);
t.check('jump ≈ 3.3 tiles up', r.jumpHeight > 3.1 && r.jumpHeight < 3.5, r.jumpHeight);
t.check('running jump ≈ 4 tiles, flutter ≈ 5', r.runJump > 3.8 && r.runJump < 4.4 && r.flutterJump > 4.6 && r.flutterJump < 5.6, [r.runJump, r.flutterJump]);
t.check('bounce off the partner ≥ 6 tiles', r.bounce >= 6, r.bounce);
t.check('the string catches a fall; the anchor stays put', r.hang.hanging && !r.hang.ghost && r.hang.len < 258.5 && r.hang.anchorMoved < 1, r.hang);
t.check('climb up and over the ledge', r.climbSecs > 0 && r.climbSecs < 3 && r.climbOnLedge, r.climbSecs);
t.check('a swing keeps its height (90–102% after 4 swings, no pumping)', r.swingKept >= 0.9 && r.swingKept <= 1.02, r.swingKept);
t.check('pumping builds a big swing', r.pumpedReach > 2, r.pumpedReach);
t.check('letting go keeps the swing’s speed and direction (and kicks up)', !!r.release && r.release.after >= r.release.before && r.release.up && r.release.sameWay, r.release);
t.check('momentum carries through the air', r.airCarry >= 0.8, r.airCarry);
t.check('swing across a 6-tile pit under a ring', r.swingAcross > 0, r.swingAcross);
t.check('pulley hauls the partner up and over', r.pulley.lifted > 5 && r.pulley.mantled && r.pulley.len < 258.5, r.pulley);
t.check('a tug pulls the partner across', r.tug.x > 64.5 && r.tug.grounded && !r.tug.ghost, r.tug);
t.check('a zip lands you by your anchored partner (who stays put)', r.zip.x > 64.5 && r.zip.grounded && r.zip.anchorMoved < 1, r.zip);
t.check('walking apart never stretches the string', r.apartMax < 258.5, r.apartMax);
t.check('a zero-length frame mid-swing leaves everything finite', r.zeroFrame.finite && r.zeroFrame.hanging, r.zeroFrame);

// edge cases found in review (each check fails on the code before its fix)
const e = await page.evaluate(() => {
  const T = 32;
  // (deep: a long fall reaches top speed before the death line)
  const W = 60, H = 60, F = 20;
  const g = Array.from({ length: H }, () => Array(W).fill(' '));
  const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c; };
  fill(0, F, W - 1, H - 1, '#');
  fill(40, F, 45, H - 1, ' '); // a bottomless pit
  fill(8, 12, 16, 12, '='); // a girder
  g[F - 1][30] = 'S'; // a blossom spring
  g[F - 6][20] = 'o'; // a ring
  g[F - 1][2] = '1'; g[F - 1][4] = '2'; g[F - 1][55] = 'N';
  // a quick lift (cols 22-24): up 9 tiles and back every 4 s
  const def = { id: 'edge', name: 'e', subtitle: '', theme: 'garden', song: 'garden', map: g.map((x) => x.join('')), movers: [{ x: 22, y: F, w: 3, path: [[0, -9]], period: 4 }] };
  const out = {};
  // a bird whose feet are a hair above a rising lift lands on it (it used to fall through)
  let missed = 0;
  for (let k = 0; k < 80; k++) {
    const s = __rig(def);
    s.birds[1].present = false;
    s.at(k * 0.05);
    const b = s.birds[0];
    b.place({ x: 23.5 * T, y: s.world.moverY[0] - 10 - 0.3 });
    b.vy = 30;
    // (on a lift going down it takes a moment to catch up: wait until it lands, or is below the top)
    s.until(() => b.groundMover === 0 || b.y + 10 > s.world.moverY[0] + 4, 1.5);
    if (b.groundMover !== 0) missed++;
  }
  out.liftMissed = missed;
  // no bouncing off a partner who hangs from you: B dangles under the girder A stands on and climbs
  // right up to A; A holds jump. (It used to bounce off B's head again and again, hauling both up
  // the level for free.)
  {
    const s = __rig(def);
    const [A, B] = s.birds;
    s.place(0, 12, 12);
    B.place({ x: A.x, y: 17 * T });
    s.reset();
    s.secs(1);
    s.c[1].moveY = 1;
    s.secs(2.5);
    const y0 = A.y;
    let minA = y0;
    let minB = B.y;
    s.c[0].jump = true;
    s.c[0].jumpPressed = true;
    for (let k = 0; k < 6 * 120; k++) {
      s.step();
      minA = Math.min(minA, A.y);
      minB = Math.min(minB, B.y);
    }
    out.hangBounce = { a: +((y0 - minA) / T).toFixed(2), b: +((y0 - minB) / T).toFixed(2) };
  }
  // climbing when the string goes dead (the partner left — their connection is gone): let go and fall,
  // and the fall can kill (it used to go on forever, past top speed, never reaching the death line)
  {
    const s = __rig(def);
    const [A, B] = s.birds;
    s.place(0, 39, F);
    B.place({ x: 41.5 * T, y: A.y + 40 });
    s.reset();
    s.secs(1.5);
    s.c[1].moveY = -1;
    s.secs(0.25);
    s.c[1].moveY = 0;
    const climbing = B.hanging && B.climbLen < Infinity;
    A.present = false;
    out.deadString = { climbing, diedIn: s.until(() => B.ghost, 5) };
  }
  // a jump pressed just after a blossom launches you doesn't swap the launch for a hop
  {
    const s = __rig(def);
    const A = s.birds[0];
    s.place(0, 28, F); s.place(1, 26, F); s.reset(); s.secs(0.3);
    s.c[0].moveX = 1;
    const launched = s.until(() => A.vy < -900, 2);
    s.c[0].moveX = 0;
    s.jump(0);
    s.step();
    out.springJump = { launched, vy: Math.round(A.vy) };
  }
  // the partner's ghost (moved by their screen) flies home over a wall: the string doesn't wind round
  // the wall's corners on the way, and it's tied afresh, straight, when the ghost is a bird again
  {
    const w = Array.from({ length: 24 }, () => Array(W).fill(' '));
    for (let y = F; y < 24; y++) for (let x = 0; x < W; x++) w[y][x] = '#';
    for (let y = F - 6; y < F; y++) for (let x = 20; x <= 24; x++) w[y][x] = '#';
    w[F - 1][2] = '1'; w[F - 1][4] = '2'; w[F - 1][55] = 'N';
    const s = __rig({ ...def, id: 'wall', map: w.map((r) => r.join('')), movers: [] });
    const [A, B] = s.birds;
    s.place(0, 10, F); s.place(1, 30, F); s.reset();
    B.ghost = true;
    for (let k = 0; k <= 120; k++) {
      const u = k / 120;
      B.x = (30 - 17 * u) * T + 16;
      B.y = (F - 1) * T - Math.sin(u * Math.PI) * 9 * T;
      s.tether.follow(A, B);
    }
    B.ghost = false;
    B.place({ x: 13 * T + 16, y: F * T - 10.01 });
    s.tether.follow(A, B);
    out.retie = { wraps: s.tether.pts.length, len: Math.round(s.tether.length), straight: Math.round(Math.hypot(A.x - B.x, A.y - B.y)) };
  }
  // a sprout whose state somehow went non-finite comes back at the lantern instead of vanishing: a
  // fall out of the world never catches it (y > floorY is false for NaN), so it would hang there
  {
    const s = __rig(def);
    s.place(0, 10, F);
    s.place(1, 12, F);
    s.reset();
    s.secs(0.2);
    s.birds[0].vx = NaN;
    s.secs(3);
    out.nanRevive = { back: s.birds.every((b) => !b.ghost), finite: s.birds.every((b) => [b.x, b.y, b.vx, b.vy].every(Number.isFinite)) };
  }
  return out;
});
t.check('feet a hair above a rising lift land on it', e.liftMissed === 0, e.liftMissed);
t.check('no endless climb bouncing off a partner who hangs from you', e.hangBounce.a < 7 && e.hangBounce.b < 4, e.hangBounce);
t.check('climbing when the partner leaves: let go, fall, and the fall counts', e.deadString.climbing && e.deadString.diedIn > 0 && e.deadString.diedIn < 4, e.deadString);
t.check('a jump just after a blossom launch keeps the launch', e.springJump.launched > 0 && e.springJump.vy < -900, e.springJump);
t.check('a ghost’s flight home doesn’t wind the string; it’s tied straight when they’re back', e.retie.wraps === 0 && Math.abs(e.retie.len - e.retie.straight) < 2, e.retie);
t.check('a sprout whose state goes non-finite comes back instead of vanishing', e.nanRevive.back && e.nanRevive.finite, e.nanRevive);

// ---- tight corners: a wall that steps in, so every row has an overhang with open air beneath it
// (the tower's wall steps, and the underside of any ledge lip)
const w = await page.evaluate(() => {
  const T = 32;
  const W = 20, H = 26, F = 24;
  const g = Array.from({ length: H }, () => Array(W).fill(' '));
  const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c; };
  fill(0, F, W - 1, H - 1, '#');
  fill(0, 10, 4, 16, '#'); // five columns wide…
  fill(0, 17, 3, F - 1, '#'); // …then four: tile (4,16) overhangs open air
  fill(11, 10, 11, F - 1, '#'); // a shaft wall to grip, right beside where a lift runs (cols 8-10)
  g[F - 1][8] = '1'; g[F - 1][10] = '2'; g[F - 1][17] = 'N';
  const def = { id: 'step', name: 's', subtitle: '', theme: 'garden', song: 'garden', map: g.map((x) => x.join('')), movers: [] };
  /** how far a body pokes into solid tiles (0 = clear), px — by shrinking its box until it fits */
  const depth = (s, i) => {
    const b = s.birds[i];
    if (b.ghost || s.world.boxFree(b.x, b.y, b.w - 0.05, b.h - 0.05)) return 0;
    for (let d = 0.5; d < 40; d += 0.5) if (s.world.boxFree(b.x, b.y, Math.max(0.1, b.w - 2 * d), Math.max(0.1, b.h - 2 * d))) return d;
    return 99;
  };
  const out = {};
  // a head-bounce in that corner: the bouncer used to be snapped up into the overhang, and the next
  // sideways move then "resolved" the overlap backwards — shoving it right through the wall beside it
  {
    const s = __rig(def, ['tall', 'small']);
    const [tall, small] = s.birds;
    const under = 17 * T; // the overhang's underside
    tall.placeCenter({ x: 4.55 * T, y: under + 14 + tall.h / 2 });
    small.placeCenter({ x: 4.46 * T, y: under + 20 - small.h / 2 });
    small.vy = 60;
    small.vx = 131;
    s.reset();
    s.c[1].moveX = 1; // pushing out of the corner, holding jump: the full bounce
    s.c[1].jump = true;
    s.step(1);
    // (the bounce still throws it up; a 3 px gap to the overhang then bonks that away again)
    const bounceV = Math.round(small.vy);
    const atOnce = depth(s, 1);
    s.step(1);
    s.c[1].jump = false;
    let inWall = 0;
    for (let k = 0; k < 240; k++) {
      s.step(2);
      if (depth(s, 1) > 0.5) inWall++;
    }
    out.bounceOverhang = { bounceV, atOnce, framesInWall: inWall, endDepth: depth(s, 1), onGround: small.grounded };
  }
  // climbing the string up to a partner riding a moving platform: the top of one is footing too, so
  // the climber mantles on beside them instead of dangling under the lift for the whole ride
  {
    const lift = { ...def, id: 'lift', movers: [{ x: 8, y: F - 2, w: 3, path: [[0, -10]], period: 8 }] };
    const s = __rig(lift, ['even', 'tall']);
    const [rider, climber] = s.birds;
    s.at(0);
    rider.placeCenter({ x: 9.5 * T, y: s.world.moverY[0] - rider.h / 2 - 1 });
    s.place(1, 9, F); // the climber waits on the floor under the shaft
    s.reset();
    s.secs(1.4); // the lift carries the rider up out of reach
    s.c[1].moveY = 1; // push up: take hold of the string, then climb it
    s.step(2);
    const grabbed = climber.hanging;
    out.moverMantle = { grabbed, up: s.until(() => climber.grounded, 4), onLift: climber.groundMover === 0 || Math.abs(climber.y + climber.h / 2 - s.world.moverY[0]) < 2 };
  }
  // a lift rising into a sprout gripping the shaft wall: it used to pass straight through it, because
  // a grip holds still and the landing test only looks for platforms when something moves
  {
    const lift = { ...def, id: 'shaft', movers: [{ x: 8, y: F - 2, w: 3, path: [[0, -10]], period: 8 }] };
    const s = __rig(lift, ['small', 'small']);
    const clinger = s.birds[0];
    s.birds[1].present = false;
    s.at(0);
    clinger.placeCenter({ x: 11 * T - clinger.w / 2 - 0.5, y: 18 * T - clinger.h / 2 });
    s.reset();
    s.c[0].moveX = 1; // push into the wall: it grips
    s.step(2);
    const gripped = clinger.cling === 1;
    const caught = s.until(() => clinger.groundMover === 0, 4);
    out.liftCatchesClinger = { gripped, caught, liftRow: +(s.world.moverY[0] / T).toFixed(1), feet: +((clinger.y + clinger.h / 2) / T).toFixed(2) };
  }
  return out;
});
t.check('a head-bounce under an overhang never pushes the bouncer into the wall', w.bounceOverhang.bounceV < -400 && w.bounceOverhang.atOnce === 0 && w.bounceOverhang.framesInWall === 0, w.bounceOverhang);
t.check('climbing the string up to a partner on a moving platform mantles onto it', w.moverMantle.grabbed && w.moverMantle.up > 0 && w.moverMantle.up < 3 && w.moverMantle.onLift, w.moverMantle);
t.check('a rising lift picks up a sprout gripping the shaft wall', w.liftCatchesClinger.gripped && w.liftCatchesClinger.caught > 0, w.liftCatchesClinger);

// ---- where a ghost comes back: beside its partner, somewhere it can stand — never flung back to the
// lantern across the level, and never over a pit again and again
const gh = await page.evaluate(() => {
  const T = 32;
  // a nook one tile high (cols 33-37) that only the small sprout fits under, with open floor either side
  const W = 60, H = 24, F = 20;
  const g = Array.from({ length: H }, () => Array(W).fill(' '));
  const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c; };
  fill(0, F, W - 1, H - 1, '#');
  fill(33, F - 2, 37, F - 2, '#');
  g[F - 1][2] = '1'; g[F - 1][4] = '2'; g[F - 1][55] = 'N';
  const def = { id: 'nook', name: 'n', subtitle: '', theme: 'garden', song: 'garden', map: g.map((x) => x.join('')), movers: [] };
  const out = {};
  // no room at all beside the partner: the ghost used to go all the way home, with the string re-tied
  // straight through the level
  {
    const s = __rig(def, ['tall', 'small']);
    const [tall, small] = s.birds;
    s.place(1, 35, F); // under the nook, where a tall body can't follow
    s.place(0, 34, F);
    s.reset();
    s.secs(0.3);
    tall.die('fall');
    const back = s.until(() => !tall.ghost, 6);
    out.noRoom = {
      back,
      apart: +(Math.hypot(tall.x - small.x, tall.y - small.y) / T).toFixed(1),
      vine: Math.round(s.tether.length),
      stands: s.until(() => tall.grounded, 2) > 0,
    };
  }
  // the garden chasm, the partner gripping its far wall deep in the pit: the ghost reformed over the
  // pit beside them, fell the whole string, crossed the death line — and did it again
  {
    const s = __rig(0, ['even', 'even']);
    const [a, b] = s.birds;
    a.placeCenter({ x: 2272 - a.w / 2 - 1, y: 20 * T - a.h / 2 }); // gripping the chasm's far wall
    b.placeCenter({ x: 2040, y: 9 * T - b.h / 2 }); // on the near ledge
    s.reset();
    s.c[0].moveX = 1; // pushing into the wall: it grips
    s.secs(0.3);
    const clinging = a.cling !== 0;
    s.c[1].moveX = 1; // walks off the edge into the chasm
    let deaths = 0;
    let was = b.ghost;
    for (let k = 0; k < 8 * 120; k++) {
      s.step();
      if (!was && b.ghost) {
        deaths++;
        s.c[1].moveX = 0; // hands off, as when you're watching your ghost
      }
      was = b.ghost;
    }
    out.deathLoop = { clinging, deaths, clingerStillThere: a.cling !== 0 || a.grounded };
  }
  return out;
});
t.check('a ghost with no room beside its partner comes back near them, not at the lantern', gh.noRoom.back > 0 && gh.noRoom.apart < 4 && gh.noRoom.vine < 150 && gh.noRoom.stands, gh.noRoom);
t.check('a ghost doesn’t reform over a pit beside a clinging partner and die again', gh.deathLoop.clinging && gh.deathLoop.deaths <= 1, gh.deathLoop);

// ---- the string's bends: what happens to a climber's grip when one appears or straightens out
const vn = await page.evaluate(() => {
  const T = 32;
  const out = {};
  // a climber halfway up the string, the string bent over the mill loft's fan hole, the partner up
  // there moving away: the bend straightens out, the climber's segment jumps to the whole string —
  // and the grip used to be re-applied to that, reeling the climber in at the solver's cap
  {
    const s = __rig(2, ['tall', 'small']);
    const [A, B] = s.birds;
    A.placeCenter({ x: 3322.3, y: 250.7 }); // hanging in the fan shaft, below the loft floor
    B.placeCenter({ x: 3446.1, y: 38.7 }); // up in the loft, gliding left
    s.reset();
    // the bend at the hole's lower-left corner (vertex (106,4), solid up and left of it)
    const bend = { x: 106 * T + 1.2, y: 4 * T + 1.2, s: 0, peg: false };
    const ka = { x: A.x, y: A.y + A.ropeOff };
    const kb = { x: B.x, y: B.y + B.ropeOff };
    bend.s = Math.sign((bend.x - ka.x) * (kb.y - bend.y) - (bend.y - ka.y) * (kb.x - bend.x)) || 1;
    s.tether.pts.length = 0;
    s.tether.pts.push(bend);
    s.tether.update(A, B);
    A.hanging = true;
    A.climbLen = 150.5; // gripping the string at its bend, 150 px along
    A.vx = -22; A.vy = 26;
    B.vx = -401; B.vy = -232;
    s.c[1].moveX = -1;
    const wraps0 = s.tether.pts.length;
    const piv0 = { ...s.tether.ends[0].pivot };
    let prev = { x: A.x, y: A.y };
    let jumps = 0;
    let reel = 0;
    for (let k = 0; k < 6; k++) {
      s.step(1);
      const d = Math.hypot(A.x - prev.x, A.y - prev.y);
      if (d > 15) {
        jumps++;
        reel += d;
      }
      prev = { x: A.x, y: A.y };
    }
    const piv = s.tether.ends[0].pivot;
    out.unwrapReel = { wraps0, pivotMoved: Math.round(Math.hypot(piv.x - piv0.x, piv.y - piv0.y)), jumps, reel: Math.round(reel) };
  }
  // a cliff (cols 0-34, top at row 14) with its floor ten tiles below, so a sprout walking off the lip
  // is caught by the string and has to climb it: the taught second crossing
  {
    const W = 60, H = 30, F = 24;
    const g = Array.from({ length: H }, () => Array(W).fill(' '));
    const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c; };
    fill(0, 14, 34, H - 1, '#');
    fill(35, F, W - 1, H - 1, '#');
    g[13][2] = '1'; g[13][4] = '2'; g[F - 1][55] = 'N';
    const def = { id: 'lip', name: 'l', subtitle: '', theme: 'garden', song: 'garden', map: g.map((x) => x.join('')), movers: [] };
    const s = __rig(def, ['tall', 'small']);
    const [A, B] = s.birds;
    s.place(0, 33, 14); // by the lip
    s.place(1, 30, 14); // a few tiles back
    s.reset();
    s.secs(0.3);
    s.c[0].moveX = 1; // walk off the lip: the string catches it over the corner
    s.until(() => A.hanging, 3);
    s.c[0].moveX = 0;
    s.secs(0.5);
    const hooked = s.tether.pts.length;
    s.c[0].moveY = 1; // climb the string and mantle onto the ledge
    const up = s.until(() => A.grounded, 6);
    s.c[0].moveY = 0;
    s.step(2); // (the mantle lands after the string was last tracked: let it be tracked once more)
    const wrapsOnLedge = s.tether.pts.length;
    const detour = +(s.tether.length - Math.hypot(A.x - B.x, A.y - B.y)).toFixed(1);
    // both walk on, away from the lip: the hairpin left at the corner used to drag them back to it
    s.c[0].moveX = -1;
    s.c[1].moveX = -1;
    let maxVine = 0;
    for (let k = 0; k < 300; k++) {
      s.step();
      maxVine = Math.max(maxVine, s.tether.length);
    }
    out.hookAfterMantle = { hooked, up, wrapsOnLedge, detour, maxVine: Math.round(maxVine), aCol: +(A.x / T).toFixed(1), bCol: +(B.x / T).toFixed(1), grounded: A.grounded && B.grounded };
  }
  // the woods ledge past stream 2, the state the completability run reached: both sprouts up on the
  // ledge, the bend still hooked on the lip behind them. Walking on folds it right back on itself, and
  // it used to hold — hauling whoever walked second back to the lip
  {
    const s = __rig(1, ['tall', 'small']);
    const [A, B] = s.birds;
    A.placeCenter({ x: 42.64 * T, y: 18 * T - A.h / 2 - 0.01 });
    B.placeCenter({ x: 41.92 * T, y: 18 * T - B.h / 2 - 0.01 });
    s.reset();
    s.tether.pts.length = 0;
    s.tether.pts.push({ x: 41.96 * T, y: 17.96 * T, s: 1, peg: false });
    s.tether.update(A, B);
    const hooked = s.tether.pts.length;
    s.c[0].moveX = 1;
    s.c[1].moveX = 1;
    let maxVine = 0;
    for (let k = 0; k < 144; k++) {
      s.step();
      maxVine = Math.max(maxVine, s.tether.length);
    }
    out.hookWalkOn = { hooked, wraps: s.tether.pts.length, maxVine: Math.round(maxVine), aCol: +(A.x / T).toFixed(1), bCol: +(B.x / T).toFixed(1) };
  }
  // one end below the mill loft's floor right of its fan hole, the other gliding down-left above it:
  // the string wraps the hole's corner, then straightens — and the straight line used to be left
  // lying through the corner on the other side of the hole (knot paths from the fuzz soak)
  {
    const s = __rig(2, ['even', 'even']);
    const rope = s.tether;
    const knot = (x, feet) => ({ x: x * T, y: feet * T - 10 });
    const ends0 = [[110.04, 6.12], [109.73, 6.22], [109.4, 6.36], [109.04, 6.5], [108.88, 6.55], [108.79, 6.58], [108.7, 6.64], [108.61, 6.69], [108.53, 6.75]];
    const ends1 = [[105.44, 0.44], [105.39, 0.84], [105.26, 1.26], [105.06, 1.65], [104.95, 1.81], [104.89, 1.9], [104.82, 1.99], [104.75, 2.09], [104.69, 2.18]];
    rope.reset(knot(108.2, 6), knot(106.5, 0.4));
    /** pixels of the string lying inside a solid tile (a pixel in from its edges, so corners don't count) */
    const insideSolid = () => {
      const path = rope.path([]);
      let n = 0;
      for (let k = 0; k + 1 < path.length; k++) {
        const a = path[k];
        const b = path[k + 1];
        const m = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
        for (let j = 1; j < m; j++) {
          const px = a.x + ((b.x - a.x) * j) / m;
          const py = a.y + ((b.y - a.y) * j) / m;
          const tx = Math.floor(px / T);
          const ty = Math.floor(py / T);
          if (s.world.staticSolidPx(px, py) && px - tx * T > 1 && tx * T + T - px > 1 && py - ty * T > 1 && ty * T + T - py > 1) n++;
        }
      }
      return n;
    };
    let worst = 0;
    const wraps = [];
    for (let k = 0; k < ends0.length; k++) {
      rope.update(knot(...ends0[k]), knot(...ends1[k]));
      worst = Math.max(worst, insideSolid());
      wraps.push(rope.pts.length);
    }
    out.unwrapThrough = { wraps: wraps.join(''), insideSolidPx: worst };
  }
  return out;
});
t.check('a bend going at a climber’s end doesn’t reel it along the string', vn.unwrapReel.wraps0 === 1 && vn.unwrapReel.pivotMoved > 50 && vn.unwrapReel.jumps === 0, vn.unwrapReel);
t.check('mantling over a ledge corner leaves the string free, not hooked on the lip', vn.hookAfterMantle.hooked === 1 && vn.hookAfterMantle.up > 0 && vn.hookAfterMantle.wrapsOnLedge === 0 && vn.hookAfterMantle.detour < 2 && vn.hookAfterMantle.maxVine < 258.5 && vn.hookAfterMantle.grounded, vn.hookAfterMantle);
t.check('a bend folded back on itself lets go: walking on doesn’t drag your partner to the lip', vn.hookWalkOn.hooked === 1 && vn.hookWalkOn.wraps === 0 && vn.hookWalkOn.maxVine < 100 && vn.hookWalkOn.aCol > 47 && vn.hookWalkOn.bCol > 47, vn.hookWalkOn);
t.check('unwrapping at a one-tile hole never leaves the string through the corner beyond it', vn.unwrapThrough.insideSolidPx < 2, vn.unwrapThrough);

// ---- the co-op moves through a REAL Session on real maps: the tug's own rules (reach, power, cooldown,
// footing) live there, not in the rig. The session is stepped by hand, a fixed number of sub-steps per
// frame, so these stay as deterministic as the rig's.
await installSim(page);
const co = await page.evaluate(() => {
  const T = 32;
  const out = {};
  // two sprouts alike, both in the air over the garden's floor, each tugging whenever it's the higher
  // one: free height from nothing (it used to carry them clean out of the level)
  {
    const sim = __sim(0, ['even', 'even']);
    const [a, b] = sim.birds;
    sim.place(0, 20, 14); sim.place(1, 22, 14); sim.reset(); sim.secs(0.2);
    const floor = a.y + a.h / 2;
    sim.jump(0);
    let best = 0;
    for (let f = 0; f < 60 * 15; f++) {
      sim.c[a.y < b.y ? 0 : 1].tugPressed = true;
      sim.c[0].jump = sim.c[1].jump = true;
      sim.frame(1 / 60);
      best = Math.max(best, (floor - Math.min(a.y + a.h / 2, b.y + b.h / 2)) / T);
    }
    out.skyClimb = +best.toFixed(1);
  }
  // …but a tug with footing still does its job — bird 0 always tugs; how far each of them was thrown
  const tugFrom = (kinds, setup) => {
    const sim = __sim(0, kinds);
    const [a, b] = sim.birds;
    setup(sim, a, b);
    const was = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
    const stance = (k) => (k.grounded ? 'ground' : k.hanging ? 'string' : k.cling ? 'wall' : 'air');
    const foot = stance(a);
    const partnerFoot = stance(b);
    sim.tug(sim.birds[0]);
    // (the full cooldown, not the short one a tug too close to the partner gets: it really went off)
    const fired = sim.birds[0].tugCd > 0.3;
    sim.secs(0.6);
    return {
      foot,
      partnerFoot,
      fired,
      me: +(Math.hypot(a.x - was[0].x, a.y - was[0].y) / T).toFixed(2),
      partner: +(Math.hypot(b.x - was[1].x, b.y - was[1].y) / T).toFixed(2),
    };
  };
  // standing on the garden's floor, 7 tiles apart: the partner is thrown
  out.tugStanding = tugFrom(['tall', 'small'], (sim) => {
    sim.place(0, 20, 14); sim.place(1, 27, 14); sim.reset(); sim.secs(0.3);
  });
  // dropped into the chasm and caught by the string, the partner holding on at the lip: the zip up to them
  out.zipHanging = tugFrom(['even', 'even'], (sim, a) => {
    sim.place(1, 64, 9);
    a.placeCenter({ x: 66.5 * T, y: 8 * T });
    sim.reset(); sim.c[1].anchor = true;
    sim.until(() => a.hanging, 3); sim.secs(0.3);
  });
  // gripping the step block's left face (cols 15-17), the partner holding on out on the floor
  out.tugClinging = tugFrom(['even', 'even'], (sim, a) => {
    a.placeCenter({ x: 15 * T - a.w / 2 - 0.5, y: 13 * T - 20 });
    sim.place(1, 9, 14); sim.reset();
    sim.c[0].moveX = 1; sim.secs(0.3); sim.c[0].moveX = 0; sim.c[1].anchor = true; sim.secs(0.1);
  });
  // the other way round: tugging a partner who grips that wall but isn't holding on — the tug used to
  // play its twang, spend its cooldown and leave them exactly where they were
  out.tugClinger = tugFrom(['even', 'even'], (sim, a, b) => {
    b.placeCenter({ x: 15 * T - b.w / 2 - 0.5, y: 13 * T - 20 });
    sim.place(0, 9, 14); sim.reset();
    sim.c[1].moveX = 1; sim.secs(0.3); sim.c[1].moveX = 0; sim.secs(0.1);
  });
  return out;
});
t.check('two sprouts can’t tug each other into the sky', co.skyClimb < 9, co.skyClimb);
t.check('a tug from the ground still flings the partner', co.tugStanding.foot === 'ground' && co.tugStanding.fired && co.tugStanding.partner > 2.5, co.tugStanding);
t.check('a zip from the string still carries you to the partner holding on', co.zipHanging.foot === 'string' && co.zipHanging.fired && co.zipHanging.me > 2, co.zipHanging);
t.check('a zip from a wall grip carries you to the partner holding on', co.tugClinging.foot === 'wall' && co.tugClinging.fired && co.tugClinging.me > 2, co.tugClinging);
t.check('a tug moves a partner gripping a wall instead of doing nothing', co.tugClinger.partnerFoot === 'wall' && co.tugClinger.fired && co.tugClinger.partner > 2, co.tugClinger);

await browser.close();
t.finish('physics', page.errors);

/**
 * In-page rig around a REAL Session (local co-op on a shipped level), stepped by hand the way
 * App.frame does — the game's own tugs (reach, power, cooldown, footing), ghosts and lanterns, with
 * our control frames. Installed as window.__sim(levelIndex, kinds).
 */
async function installSim(page) {
  await page.evaluate(async () => {
    const { Session } = await import('/src/game/session.ts');
    const { makeControls } = await import('/src/core/input.ts');
    const { T } = await import('/src/game/tuning.ts');
    const { app, flow } = window.__fb;
    let live = null;
    window.__sim = (level, kinds = ['even', 'even']) => {
      live?.dispose();
      flow.mode = 'local';
      flow.seats = ['keysL', 'keysR'];
      const s = new Session(app, flow, { level, mode: 'local', seats: ['keysL', 'keysR'], profiles: flow.profiles(), kinds });
      live = s;
      const c = [makeControls(), makeControls()];
      s.controlsFor = (i) => c[i];
      const clearPresses = () => { for (const cc of c) cc.jumpPressed = cc.tugPressed = cc.dashPressed = cc.heartPressed = cc.heyPressed = false; };
      return {
        s, c, birds: s.birds, world: s.world, tether: s.tether, L: s.L,
        /** one display frame, split into the same sub-steps the app uses (presses only in the first) */
        frame(dt = 1 / 60) {
          for (let i = 0; i < 2; i++) if (c[i].tugPressed) s.tug(s.birds[i]);
          const steps = Math.min(10, Math.max(1, Math.ceil(dt / (1 / 120) - 1e-6)));
          for (let i = 0; i < steps; i++) {
            s.update(dt / steps);
            if (i === 0) clearPresses();
          }
          clearPresses();
        },
        secs(t, dt = 1 / 60) { for (let k = 0; k < Math.round(t / dt); k++) this.frame(dt); },
        until(pred, t, dt = 1 / 60) { for (let k = 0; k < t / dt; k++) { this.frame(dt); if (pred()) return +((k + 1) * dt).toFixed(2); } return -1; },
        /** feet on tile row ty, column tx */
        place(i, tx, ty) { s.birds[i].placeCenter({ x: tx * T + 16, y: ty * T - s.birds[i].h / 2 - 0.01 }); },
        reset() { s.tether.reset(s.birds[0], s.birds[1]); },
        jump(i) { c[i].jump = true; c[i].jumpPressed = true; },
        tug(b) { s.tug(b); },
      };
    };
  });
}
