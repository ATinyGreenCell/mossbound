// Fuzz soak: random inputs for both sprouts on every level — tall and small both ways round, and two
// alike; dashes, wall climbs and all — checking invariants every physics step (finite and bounded
// state, never inside a wall, the vine within its tolerance, ghosts always reform) — then real
// key-mashing through the real app on every level (rendering, HUD, pause).
import { installRig, launch, open, reporter, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const page = await open(browser);
await installRig(page);
const fuzz = await page.evaluate(async () => {
  const { LEVELS } = await import('/src/game/levels.ts');
  const T = 32;
  const out = [];
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let li = 0; li < LEVELS.length; li++) {
    for (let run = 0; run < 3; run++) {
      const s = __rig(li, [['tall', 'small'], ['small', 'tall'], ['even', 'even']][run]);
      const bad = [];
      let ghostFor = [0, 0];
      let maxLen = 0;
      // the vine grows for a shot and coils back in (see Tether.limit), so what must never happen is
      // not a length but a stretch: the vine longer than there is vine
      let maxOver = 0;
      // start somewhere interesting: at a random checkpoint (or the spawn)
      const cps = [...s.L.checkpoints, s.L.spawns[0]];
      const start = cps[Math.floor(rnd() * cps.length)];
      s.birds[0].place({ x: start.x - 12, y: start.y - 2 });
      s.birds[1].place({ x: start.x + 12, y: start.y - 2 });
      s.reset();
      for (let k = 0; k < 120 * 45; k++) {
        if (k % 30 === 0) {
          for (const c of s.c) {
            c.moveX = [-1, 0, 1, 1][Math.floor(rnd() * 4)];
            c.moveY = [-1, 0, 0, 1][Math.floor(rnd() * 4)];
            c.jump = rnd() < 0.4;
            if (c.jump && rnd() < 0.5) c.jumpPressed = true;
            c.anchor = rnd() < 0.15;
            c.dashPressed = rnd() < 0.12;
          }
          if (rnd() < 0.08) s.yank(Math.floor(rnd() * 2));
          // vine shots, aimed anywhere (including at nothing), and let go of again
          if (rnd() < 0.18) s.shootAt(Math.floor(rnd() * 2), rnd() * 2 - 1, rnd() * 2 - 1);
          if (rnd() < 0.08) s.unhook(Math.floor(rnd() * 2));
          // plants grown out of soil, which turn open air into leaves the sprouts can stand on
          if (rnd() < 0.06 && s.world.grown.length) s.world.grow(Math.floor(rnd() * s.world.grown.length));
        }
        s.step();
        for (let i = 0; i < 2; i++) {
          const b = s.birds[i];
          if (![b.x, b.y, b.vx, b.vy].every(Number.isFinite)) bad.push(`nan b${i} @${k}`);
          if (Math.abs(b.vx) > 4000 || Math.abs(b.vy) > 4000) bad.push(`fast b${i} ${Math.round(b.vx)},${Math.round(b.vy)} @${k}`);
          if (!b.ghost && !s.world.boxFree(b.x, b.y, b.w - 2, b.h - 2)) bad.push(`in wall b${i} ${(b.x / T).toFixed(1)},${(b.y / T).toFixed(1)} @${k}`);
          // a ghost with nowhere to land beside its partner hovers by them instead of being flung back
          // to the lantern, so while the partner is off the ground it may stay a ghost a while; once
          // they're standing there is always somewhere beside them, and it must come back
          ghostFor[i] = b.ghost && s.birds[1 - i].grounded ? ghostFor[i] + 1 : 0;
          if (ghostFor[i] > 120 * 4.5) bad.push(`stuck ghost b${i} @${k}`);
        }
        if (!s.birds[0].ghost && !s.birds[1].ghost) {
          maxLen = Math.max(maxLen, s.tether.length);
          maxOver = Math.max(maxOver, s.tether.length - s.tether.limit);
        }
        if (bad.length > 5) break;
      }
      out.push({ level: LEVELS[li].id, run, bad: bad.slice(0, 5), maxLen: +maxLen.toFixed(1), maxOver: +maxOver.toFixed(1) });
    }
  }
  return out;
});

// real app: mash keys on every level in local co-op (both keyboard halves)
const KEYS = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'ShiftLeft', 'KeyE', 'KeyR', 'KeyQ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Slash', 'Period', 'Comma', 'Semicolon', 'KeyM'];
const real = [];
for (let li = 0; li < 5; li++) {
  await page.evaluate((li) => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keysL', 'keysR']; f.playLevel(li); }, li);
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session'), 5000, 'session');
  for (let k = 0; k < 60; k++) {
    const key = KEYS[Math.floor(Math.random() * KEYS.length)];
    await page.keyboard.down(key);
    await sleep(40 + Math.random() * 120);
    await page.keyboard.up(key);
    if (k === 30) {
      await page.keyboard.press('Escape');
      await sleep(150);
      await page.keyboard.press('Escape');
    }
  }
  real.push(await page.evaluate(() => { const s = window.__fbSession; return { ok: s.birds.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y)), paused: s.paused, level: s.L.def.id }; }));
}
await browser.close();

const t = reporter();
for (const f of fuzz) t.check(`fuzz ${f.level} #${f.run}`, f.bad.length === 0 && f.maxOver < 20, { bad: f.bad, maxLen: f.maxLen, maxOver: f.maxOver });
for (const r of real) t.check(`real ${r.level}`, r.ok && !r.paused, r);
t.finish('soak', page.errors);
