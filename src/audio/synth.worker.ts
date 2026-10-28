/// <reference lib="webworker" />
/**
 * The sound library, rendered off the main thread. Every sound and instrument sample is pure maths
 * over a Float32Array, so a worker can do the whole library and hand each one back (the buffer is
 * transferred, not copied) while the game keeps drawing. On the main thread this cost whole frames:
 * the longest sounds took 50-60 ms each, about 0.7 s of stutter right after the first button press.
 *
 * The order is fixed and matches the fallback in audio.ts / music.ts: the noise sources are seeded,
 * so the samples come out identical whichever path ran.
 */
import { renderSfx } from './sfx';
import { instNotes, renderInst } from './music';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<{ rate?: number }>) => {
  const rate = e.data?.rate;
  if (!(typeof rate === 'number' && rate > 0)) return;
  try {
    for (const name of renderSfx.names) {
      const data = renderSfx(name, rate);
      ctx.postMessage({ k: 'sfx', name, data }, [data.buffer]);
    }
    for (const [inst, note] of instNotes()) {
      const data = renderInst(inst, note, rate);
      ctx.postMessage({ k: 'inst', inst, note, data }, [data.buffer]);
    }
    ctx.postMessage({ k: 'done' });
  } catch {
    ctx.postMessage({ k: 'failed' });
  }
};
