import { T } from '../game/tuning';

/** A creek's colours (Theme.water). */
export interface WaterPal {
  top: string;
  bottom: string;
  light: string;
}

const fract = (v: number) => v - Math.floor(v);

/** The band's gradient, made once for a session's creek rather than every frame. */
let band: { ctx: CanvasRenderingContext2D; pal: WaterPal; top: number; g: CanvasGradient } | null = null;

/**
 * The creek along the bottom of a level, behind the tiles, so a pit is water now: a band of colour, its
 * ripples drifting downstream, and a bright line along its surface. Cosmetic only.
 *
 * `ctx` has the world transform; x0..x1 and y1 bound the view in world px; `bottom` is where the band ends.
 */
export function drawCreekBand(ctx: CanvasRenderingContext2D, pal: WaterPal, top: number, x0: number, x1: number, y1: number, bottom: number, t: number) {
  if (y1 < top) return;
  if (!band || band.ctx !== ctx || band.pal !== pal || band.top !== top) {
    const g = ctx.createLinearGradient(0, top, 0, top + 2.5 * T);
    g.addColorStop(0, pal.top);
    g.addColorStop(1, pal.bottom);
    band = { ctx, pal, top, g };
  }
  ctx.fillStyle = band.g;
  ctx.fillRect(x0, top, x1 - x0, bottom - top);
  // Ripples: a fixed pattern of them in the water's own frame, carried downstream (leftward) with it.
  // Each is a little bar, filled. They were one stroke (round-ended, 1.6 px) over the whole band, and a
  // GPU's canvas pays for a long stroked path as one big anti-aliased shape — a software renderer ~8-17 ms
  // a frame at 720p — where a bar is the cheapest thing it draws. The bars are as long as the strokes
  // were plus as much again as their round ends held (π/4 of the half-width each side), so the same
  // ink: at 1.6 px the only difference is the ends' corners, square now rather than round. (Nothing here
  // is stroked any more, so nothing depends on the lineCap the last thing drawn happened to leave.)
  const end = 0.8 * (Math.PI / 4);
  ctx.fillStyle = pal.light;
  ctx.globalAlpha = 0.45;
  const step = 44;
  const flow = t * 18;
  for (let i = Math.floor((x0 + flow) / step) - 1; i * step - flow < x1; i++) {
    const h1 = fract(Math.sin(i * 12.9898) * 43758.5453);
    const h2 = fract(Math.sin(i * 78.233) * 12345.678);
    const x = i * step + h1 * 20 - flow;
    const y = top + 7 + h2 * 22 + Math.sin(t * 1.5 + i) * 1.2;
    ctx.fillRect(x - end, y - 0.8, 8 + h1 * 14 + 2 * end, 1.6);
  }
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = pal.light;
  ctx.fillRect(x0, top - 1, x1 - x0, 2);
  ctx.globalAlpha = 1;
}
