// The sound library must not cost the game its frames. Every effect and instrument note is
// synthesized once when audio unlocks (the first button press), and that used to happen on the main
// thread: the longest sounds took 50-60 ms each, so the title screen stuttered for about a second
// right after the player's first press — and worse on a phone. It is rendered in a worker now, with
// the main-thread slices kept as a fallback, so the library still has to come out complete.
import { launch, open, reporter } from './harness.mjs';

const browser = await launch();
const page = await open(browser, { query: { audio: true } });
const t = reporter();

// record every frame's own duration, and any task long enough to drop one
await page.evaluate(() => {
  const app = window.__fb.app;
  const orig = app.frame;
  window.__frames = [];
  app.frame = (now) => {
    const t0 = performance.now();
    orig(now);
    window.__frames.push(performance.now() - t0);
  };
  window.__long = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  } catch { /* no long-task observer here */ }
  window.__waitFrames = (n) => new Promise((res) => { const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : res()); step(n); });
});
const idle = await page.evaluate(async () => { window.__frames.length = 0; await window.__waitFrames(90); return Math.max(...window.__frames); });

const r = await page.evaluate(async () => {
  window.__frames.length = 0;
  window.__long.length = 0;
  const a = window.__fb.audio;
  const t0 = performance.now();
  a.unlock();
  await window.__waitFrames(240);
  const { renderSfx } = await import('/src/audio/sfx.ts');
  const worst = [...window.__frames].sort((x, y) => y - x).slice(0, 3).map((v) => +v.toFixed(1));
  return {
    builtMs: Math.round(performance.now() - t0),
    sounds: a.buffers.size,
    wanted: renderSfx.names.length,
    notes: a.seq?.samples.size ?? 0,
    worstFrameMs: worst,
    longTasksMs: window.__long.map((v) => Math.round(v)),
  };
});
t.check('every sound is in the library after unlocking', r.sounds === r.wanted && r.notes > 0, r);
t.check('building it drops no frames', r.worstFrameMs[0] < 25 && !r.longTasksMs.some((v) => v > 50), { idleFrameMs: +idle.toFixed(1), ...r });

// the sounds still play (a buffer source per voice, and the voice cap still holds)
const played = await page.evaluate(() => {
  const a = window.__fb.audio;
  a.play('jump');
  a.play('step');
  a.play('step');
  a.play('step');
  return { ctx: a.ctx?.state ?? null, step: a.voices.get('step') ?? 0 };
});
t.check('a sound plays, and the voice cap holds', played.ctx === 'running' && played.step > 0 && played.step <= 2, played);

await browser.close();
t.finish('audio', page.errors);
