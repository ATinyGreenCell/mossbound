/// <reference lib="webworker" />
/**
 * The sound library, rendered off the main thread. Every sound, instrument sample and the reverb's
 * impulse is pure maths over a Float32Array, so a worker can make the whole library and hand each piece
 * back as soon as it is done (the buffer is transferred, not copied) while the game keeps drawing. On
 * the main thread this cost whole frames: the longest sounds took 50-60 ms each.
 *
 * The menu's own sounds come first, so a press on the title has them. Each piece is seeded on its own
 * (see sfx.ts, and seedFor/renderImpulseSteps in music.ts), so the main-thread fallback makes exactly
 * the same samples — and can make just the ones a stalled worker never sent.
 */
import { renderSfx, SFX_ORDER } from './sfx';
import { instNotes, renderImpulseSteps, renderInst } from './music';
import { finish } from './steps';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<{ rate?: number }>) => {
  const rate = e.data?.rate;
  if (!(typeof rate === 'number' && rate > 0)) return;
  try {
    for (const name of SFX_ORDER) {
      const data = renderSfx(name, rate);
      ctx.postMessage({ k: 'sfx', name, data }, [data.buffer]);
    }
    for (const [inst, note] of instNotes()) {
      const data = renderInst(inst, note, rate);
      ctx.postMessage({ k: 'inst', inst, note, data }, [data.buffer]);
    }
    const data = finish(renderImpulseSteps(rate));
    ctx.postMessage({ k: 'impulse', data }, data.map((d) => d.buffer));
    ctx.postMessage({ k: 'done' });
  } catch {
    ctx.postMessage({ k: 'failed' });
  }
};
