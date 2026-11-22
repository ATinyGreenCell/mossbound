/**
 * A render that can pause.
 *
 * Every sound and instrument here is a run of loops over a Float32Array. Written as generators, each
 * loop gives way every STRIDE samples: the synth worker runs a render straight through (finish), and
 * the main thread — only when there is no worker — takes it in slices short enough never to hold up a
 * frame (see Audio.sliced). Pausing changes nothing about what is computed or in what order, so both
 * come out the same to the last sample.
 *
 * (The noise sources in sfx.ts and music.ts are module state: one render runs at a time, start to end,
 * which both the worker and the slicer keep to.)
 */
export type Steps<T> = Generator<undefined, T, undefined>;

/** samples between the points where a render may pause */
export const STRIDE = 1024;

/** Is sample `i` a place to pause? */
export const pause = (i: number) => (i & (STRIDE - 1)) === STRIDE - 1;

/** Run a render to its end in one go. */
export function finish<T>(w: Steps<T>): T {
  for (;;) {
    const r = w.next();
    if (r.done) return r.value;
  }
}
