// The solo practice ground: the level itself (it isn't one of LEVELS, so nothing else lints it), the
// partner the game walks for you, and the promise that nothing done in there touches the save.
import { frames, installRig, launch, open, reporter, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const page = await open(browser);
await installRig(page);
const t = reporter();

// ---- the level: as strict a lint as levels.mjs gives the five real ones
const lint = await page.evaluate(async () => {
  const { PRACTICE } = await import('/src/game/levels.ts');
  const { parseLevel } = await import('/src/game/level.ts');
  const L = parseLevel(PRACTICE, 99);
  const T = 32;
  const issues = [];
  if (new Set(PRACTICE.map.map((r) => r.length)).size !== 1) issues.push('ragged rows');
  if (L.feathers.length !== 3) issues.push(`fireflies ${L.feathers.length}`);
  if (L.signs.length !== PRACTICE.signs.length) issues.push(`signs ${L.signs.length}/${PRACTICE.signs.length}`);
  if (L.signs.some((s) => !s.text)) issues.push('a sign with no words');
  if (!L.checkpoints.length) issues.push('no lanterns');
  for (let g = 0; g < L.doorGroups; g++) if (!L.plates.some((p) => p.group === g) !== !L.doors.some((d) => d.group === g)) issues.push(`group ${g} unpaired`);
  const solid = (p) => '#XU,'.includes(PRACTICE.map[Math.floor(p.y / T)]?.[Math.floor(p.x / T)] ?? ' ');
  for (const p of [...L.spawns, L.nest, ...L.checkpoints]) if (solid(p)) issues.push(`point in wall at ${p.x / T},${p.y / T}`);
  // every move it means to teach has something there to teach it with
  const has = { soil: L.soils.length, rings: L.pegs.length, springs: L.springs.length, vents: L.vents.length, plates: L.plates.length, crumbles: L.crumbles.length, movers: L.movers.length, spikes: PRACTICE.map.join('').includes('^'), beetles: L.creatures.filter((c) => c.kind === 0).length, traps: L.creatures.filter((c) => c.kind === 1).length };
  for (const [k, v] of Object.entries(has)) if (!v) issues.push(`nothing for ${k}`);
  // and nothing sitting where a plant's leaves will unfurl (levels.mjs lints the five real ones)
  for (const so of L.soils) {
    for (const k of so.leaves ?? []) {
      const lx = k % L.w, ly = Math.floor(k / L.w);
      if (L.seeds.some((sd) => Math.floor(sd.x / T) === lx && Math.floor(sd.y / T) === ly)) issues.push(`seed under a leaf at ${lx},${ly}`);
    }
  }
  return { issues, has, levels: (await import('/src/game/levels.ts')).LEVELS.some((d) => d.id === PRACTICE.id) };
});
t.check('the practice ground lints clean', lint.issues.length === 0, lint.issues);
t.check('…and has something for every move it teaches', !lint.issues.length, lint.has);
t.check('…and is not one of the levels (it unlocks nothing and sits in no level select)', lint.levels === false);

// ---- the partner the game walks: fed made-up sprouts, so what it decides is plain to read
const brain = await page.evaluate(async () => {
  const { Dummy } = await import('/src/game/dummy.ts');
  const T = 32;
  const bird = (x, y, more = {}) => ({ x, y, h: 16, w: 16, grounded: true, ghost: false, present: true, bumped: false, blockedX: false, cling: 0, rope: null, ...more });
  // (a fresh one per question: it keeps a little state between frames, so that it doesn't shuffle on
  // the spot, and one scenario's answer must not depend on the one asked before it)
  const run = (me, you, n = 30) => { const d = new Dummy(); let c; for (let i = 0; i < n; i++) c = d.step(1 / 60, me, you); return { moveX: c.moveX, moveY: c.moveY, jump: c.jump, anchor: c.anchor, tug: c.tugPressed, shoot: c.shootPressed, dash: c.dashPressed }; };
  const out = {};
  // far away to the right: it walks that way
  out.walksToYou = run(bird(0, 0), bird(8 * T, 0));
  // right beside it: it stands still rather than shuffling on the spot
  out.standsNear = run(bird(0, 0), bird(1.6 * T, 0));
  // the vine tight with you off the ground: it plants its roots and holds
  out.anchors = run(bird(0, 0), bird(5 * T, -3 * T, { grounded: false }), 2);
  out.anchorsHanging = (() => { const me = bird(0, 0, { rope: { taut: true } }); return run(me, bird(5 * T, -3 * T, { grounded: false }), 2); })();
  // standing on your head: it steps off rather than perching there
  out.stepsOffYourHead = run(bird(0, -28, { grounded: false }), bird(0, 0, { h: 40 }), 2);
  // walked into a step: it hops. But a bird resting on the ground falls a hair and lands again every
  // step, so `bumped` is true the whole time it stands there — that must never read as a wall ahead.
  out.hopsAtAStep = run(bird(0, 0, { blockedX: true }), bird(8 * T, 0), 2);
  out.standingStillIsntAWall = run(bird(0, 0, { bumped: true }), bird(8 * T, 0), 2);
  // gripping a wall it walked into: it climbs while you're above it, and lets go when you're not
  out.climbsUpToYou = run(bird(0, 0, { cling: -1, grounded: false }), bird(-2 * T, -6 * T), 2);
  out.letsGoOtherwise = run(bird(0, 0, { cling: -1, grounded: false }), bird(-2 * T, 0), 2);
  // you in the flower pot: it comes right up, because the pot only counts you both within 2.2 tiles
  out.standsOffThePot = run(bird(0, 0), bird(1.9 * T, 0));
  out.crowdsIntoThePot = run(bird(0, 0), bird(1.9 * T, 0, { inGoal: true }));
  // it is a partner, not a player: it never tugs, shoots or dashes for you
  const all = [out.walksToYou, out.standsNear, out.anchors, out.hopsAtAStep];
  out.neverActsForYou = all.every((c) => !c.tug && !c.shoot && !c.dash);
  return out;
});
t.check('the practice partner walks to you', Math.sign(brain.walksToYou.moveX) === 1, brain.walksToYou);
t.check('…stands still once it is beside you (no shuffling on the spot)', brain.standsNear.moveX === 0, brain.standsNear);
t.check('…plants its roots when the vine is tight and you are off the ground', brain.anchorsHanging.anchor === true, brain.anchorsHanging);
t.check('…steps off your head instead of perching on it', brain.stepsOffYourHead.moveX !== 0, brain.stepsOffYourHead);
t.check('…hops when it walks into a step', brain.hopsAtAStep.jump === true, brain.hopsAtAStep);
t.check('…but standing still is not a step: it walks to you, it doesn’t hop the whole way', brain.standingStillIsntAWall.jump === false, brain.standingStillIsntAWall);
t.check('…climbs a wall it has got stuck on, while you are above it', brain.climbsUpToYou.moveX === -1 && brain.climbsUpToYou.moveY > 0, brain.climbsUpToYou);
t.check('…and lets go of that wall when you are not above it', brain.letsGoOtherwise.moveX === 1, brain.letsGoOtherwise);
t.check('…and steps right up when you are in the flower pot, so it counts as both of you', brain.standsOffThePot.moveX === 0 && brain.crowdsIntoThePot.moveX > 0, { off: brain.standsOffThePot, pot: brain.crowdsIntoThePot });
t.check('…and never tugs, shoots or dashes for you: those are yours to learn', brain.neverActsForYou, brain);

// ---- and in the ground itself, under the real sprouts: a partner on its feet, not one hopping the
// whole way. Made-up sprouts can't see this — it took a real bird, which falls a hair and lands on
// the floor it is already standing on every step, to make "ran into something" read as a wall ahead.
const afoot = await page.evaluate(async () => {
  const { PRACTICE } = await import('/src/game/levels.ts');
  const { Dummy } = await import('/src/game/dummy.ts');
  const out = {};
  // flat ground for the walking half: the practice ground is steps and dips on purpose, and hopping up
  // those is the partner doing its job — what must not happen is hopping where there is nothing to hop
  const H = 20;
  const flat = Array.from({ length: H }, (_, y) => (y >= H - 4 ? '#'.repeat(80) : ' '.repeat(80)));
  flat[H - 5] = '  1 2' + ' '.repeat(73) + 'N';
  const FLAT = { id: 'flat', name: 'flat', subtitle: '', theme: 'garden', song: 'garden', map: flat };
  for (const [name, where, moveX] of [['standingStill', PRACTICE, 0], ['walkingFlatGround', FLAT, 1]]) {
    const s = __rig(where, ['tall', 'small']);
    const d = new Dummy();
    s.reset();
    s.secs(1);
    let onItsFeet = 0;
    const n = 120 * 5;
    for (let k = 0; k < n; k++) {
      s.c[0].moveX = moveX;
      const f = d.step(1 / 120, s.birds[1], s.birds[0]);
      const c = s.c[1];
      c.moveX = f.moveX; c.moveY = f.moveY; c.jump = f.jump; c.jumpPressed = f.jumpPressed; c.anchor = f.anchor;
      s.step();
      if (s.birds[1].grounded) onItsFeet++;
    }
    out[name] = +(onItsFeet / n).toFixed(2);
  }
  return out;
});
t.check(
  `…and walks on its feet rather than hopping all the way (on the ground ${Math.round(afoot.standingStill * 100)}% of the time beside you, ${Math.round(afoot.walkingFlatGround * 100)}% following across the flat)`,
  afoot.standingStill > 0.8 && afoot.walkingFlatGround > 0.8,
  afoot,
);

// ---- in play, from the button on the title screen
await sleep(500);
await page.click('.btn[data-act=practice]');
await waitFor(() => page.evaluate(() => window.__fbSession?.practice === true), 8000, 'the practice ground');
const before = await page.evaluate(() => JSON.stringify(window.__fb.save.save));
const sample = () => page.evaluate(() => {
  const s = window.__fbSession;
  const [a, b] = s.birds;
  return { gap: +Math.abs((a.x - b.x) / 32).toFixed(2), onMyHead: b.y + b.h / 2 < a.y - a.h / 2 + 6 && Math.abs(a.x - b.x) < 32, seat: s.opts.seats?.[0], signs: s.L.signs.length };
});
await page.keyboard.down('d');
const gaps = [];
for (let i = 0; i < 6; i++) {
  await sleep(900);
  gaps.push((await sample()).gap);
}
await page.keyboard.up('d');
await frames(page, 90);
const settled = await sample();
t.check('every device on the screen drives the one sprout you hold', settled.seat === 'keys', settled);
t.check(`the partner keeps up while you walk (gaps ${gaps.join(', ')} tiles)`, gaps.every((g) => g < 4), gaps);
t.check('…and settles beside you, not on top of you, when you stop', !settled.onMyHead && settled.gap < 4, settled);

// ---- and none of it is written down: no run, no clear, no unlock, and no firefly either. The three
// fireflies here are the point of three of the stations (the top of the shaft, the head-bounce shelf,
// the vent), so they get picked up — and a firefly is banked the moment it's reached, hats and all.
const lit = await page.evaluate(() => {
  const s = window.__fbSession;
  const f = s.L.feathers[0];
  // (both of them, or the vine snaps the player back to a partner a hundred tiles away)
  s.birds[0].placeCenter({ x: f.x, y: f.y });
  s.birds[1].placeCenter({ x: f.x + 40, y: f.y });
  s.tether.reset(s.birds[0], s.birds[1]);
  return { feathers: s.feathers, at: { x: f.x, y: f.y } };
});
await waitFor(() => page.evaluate(() => window.__fbSession.feathers !== 0), 4000, 'the firefly');
t.check('a firefly in the practice ground can be picked up', await page.evaluate(() => window.__fbSession.feathers !== 0), lit);

await sleep(3000);
await page.evaluate(() => window.__fbSession.flushRun?.());
const after = await page.evaluate(() => JSON.stringify(window.__fb.save.save));
const stored = await page.evaluate(() => localStorage.getItem('mossbound.save.v3'));
t.check('the practice ground writes nothing to the save', before === after && !/practice/.test(stored ?? ''), { before, after });

// ---- and she can practise as either sprout: half the moves (dash, wall climb, growing) are the
// small one's own, so being stuck as the tall one would be half a practice
const kind0 = await page.evaluate(() => window.__fbSession.birds[0].kind);
await page.keyboard.press('Escape');
await waitFor(() => page.evaluate(() => !!document.querySelector('.btn[data-act=swap]')), 4000, 'the pause menu');
await sleep(450);
await page.click('.btn[data-act=swap]');
await waitFor(() => page.evaluate((k) => window.__fbSession?.practice === true && window.__fbSession.birds[0].kind !== k, kind0), 6000, 'the other sprout');
const kind1 = await page.evaluate(() => window.__fbSession.birds[0].kind);
t.check(`the pause menu swaps which sprout you practise as (${kind0} → ${kind1})`, kind0 !== kind1 && ['tall', 'small'].includes(kind1), { kind0, kind1 });

await browser.close();
t.finish('practice', page.errors);
