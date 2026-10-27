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
  return out;
});
t.check('feet a hair above a rising lift land on it', e.liftMissed === 0, e.liftMissed);
t.check('no endless climb bouncing off a partner who hangs from you', e.hangBounce.a < 7 && e.hangBounce.b < 4, e.hangBounce);
t.check('climbing when the partner leaves: let go, fall, and the fall counts', e.deadString.climbing && e.deadString.diedIn > 0 && e.deadString.diedIn < 4, e.deadString);
t.check('a jump just after a blossom launch keeps the launch', e.springJump.launched > 0 && e.springJump.vy < -900, e.springJump);
t.check('a ghost’s flight home doesn’t wind the string; it’s tied straight when they’re back', e.retie.wraps === 0 && Math.abs(e.retie.len - e.retie.straight) < 2, e.retie);
await browser.close();
t.finish('physics', page.errors);
