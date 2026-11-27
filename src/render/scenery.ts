/**
 * Backdrop scenery with some depth to it: rock with lit lips and striations, waterfalls that pour over
 * a lip in streaks and land in foam and mist, crowns of trees shaded underneath and lit toward the sun,
 * meadows stippled, and haze settling toward the horizon so the playfield in front stands out.
 *
 * All of it paints into a backdrop layer's strip, once per theme and screen height (see backdrop.ts),
 * so every rule of a strip holds: it repeats every W (whatever crosses an edge is painted again on the
 * other side, the same), and it paints with the context's own paths only (paintedBox has to see every
 * fill to keep only the part of the strip with anything in it).
 */
import { rng, TAU } from '../core/math';

type Ctx = CanvasRenderingContext2D;

/** the diameters a disc is painted at, side by side on its colour's canvas */
const SIZES = [8, 24, 64, 128];
const AT = [0, 10, 36, 102];

/**
 * Discs stamped rather than filled. One path of hundreds of circles strewn along a strip — a wood's
 * leafy lumps, a meadow's flowers — makes the renderer rasterise a mask the width of the whole strip,
 * the dearest thing in a backdrop by far. Each disc here is a drawImage of one painted once at about
 * its size instead: hundreds of quads from one small picture.
 */
class Stamps {
  private made = new Map<string, HTMLCanvasElement>();

  private of(color: string) {
    let c = this.made.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = 230;
      c.height = 128;
      const g = c.getContext('2d')!;
      g.fillStyle = color;
      g.beginPath();
      SIZES.forEach((n, i) => {
        g.moveTo(AT[i] + n, n / 2);
        g.arc(AT[i] + n / 2, n / 2, n / 2 - 0.5, 0, TAU);
      });
      g.fill();
      this.made.set(color, c);
    }
    return c;
  }

  /** Discs of one colour: `xyr` is x, y, radius, x, y, radius… (strip px). */
  stamp(ctx: Ctx, color: string, xyr: number[]) {
    if (!xyr.length) return;
    const c = this.of(color);
    for (let i = 0; i < xyr.length; i += 3) {
      const r = xyr[i + 2];
      const s = r <= 6 ? 0 : r <= 18 ? 1 : r <= 44 ? 2 : 3;
      const n = SIZES[s];
      ctx.drawImage(c, AT[s], 0, n, n, xyr[i] - r, xyr[i + 1] - r, 2 * r, 2 * r);
    }
  }

  free() {
    for (const c of this.made.values()) c.width = c.height = 0;
    this.made.clear();
  }
}

/** The stamps of the layer being painted (see stamped). */
let stamps: Stamps | null = null;

/**
 * A layer painter written as parts (a yield between them): its painting whole, and the same a part at
 * a time. Either way the discs it stamps are made for it and let go of after; between parts, another
 * painting's may be in use, so its own are put back each time it carries on.
 */
const stepped = (f: (ctx: Ctx, W: number, H: number) => Generator<void>) => {
  function* steps(ctx: Ctx, W: number, H: number): Generator<void> {
    const mine = new Stamps();
    const parts = f(ctx, W, H);
    try {
      for (;;) {
        stamps = mine;
        const n = parts.next();
        stamps = null;
        if (n.done) return;
        yield;
      }
    } finally {
      stamps = null;
      mine.free();
    }
  }
  const paint = (ctx: Ctx, W: number, H: number) => {
    for (const _ of steps(ctx, W, H));
  };
  return { paint, steps };
};

/** Discs of one colour, stamped while a layer is being painted, else as one path. */
function discs(ctx: Ctx, color: string, xyr: number[]) {
  if (stamps) return stamps.stamp(ctx, color, xyr);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < xyr.length; i += 3) {
    ctx.moveTo(xyr[i] + xyr[i + 2], xyr[i + 1]);
    ctx.arc(xyr[i], xyr[i + 1], xyr[i + 2], 0, TAU);
  }
  ctx.fill();
}

/** Call f at x, and again a strip's width over wherever x is within `reach` of an edge (strips repeat). */
export function around(W: number, x: number, reach: number, f: (x: number) => void) {
  f(x);
  if (x - reach < 0) f(x + W);
  if (x + reach > W) f(x - W);
}

/** A height along the strip in whole waves, so it ends where it began: for ridges and hilltops. */
export function wave(W: number, seed: number, waves: number[], amps: number[]) {
  const r = rng(seed);
  const ph = waves.map(() => r() * TAU);
  return (x: number) => waves.reduce((s, n, i) => s + amps[i] * Math.sin((x / W) * TAU * n + ph[i]), 0);
}

/** Fill from the line y(x) down to `bottom` (px), across the whole strip. */
export function fillBelow(ctx: Ctx, W: number, y: (x: number) => number, bottom: number, color: string | CanvasGradient, step = 6) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, bottom);
  for (let x = 0; x < W; x += step) ctx.lineTo(x, y(x));
  ctx.lineTo(W, y(W));
  ctx.lineTo(W, bottom);
  ctx.closePath();
  ctx.fill();
}

/** A band between y(x) and y(x) + thick(x), across the strip (a lit rim along a ridge, a ledge). */
export function band(ctx: Ctx, W: number, y: (x: number) => number, thick: (x: number) => number, color: string, step = 6) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let x = 0; x < W; x += step) ctx.lineTo(x, y(x));
  ctx.lineTo(W, y(W));
  for (let x = W; x > 0; x -= step) ctx.lineTo(x, y(x) + thick(x));
  ctx.lineTo(0, y(0) + thick(0));
  ctx.closePath();
  ctx.fill();
}

/**
 * Dots over a stretch of the strip (a meadow's flowers and shadows, lichen, leaves), one path per
 * colour: a few hundred dots are then a few fills. `y0(x)` keeps them below a hill's line.
 */
export function stipple(ctx: Ctx, W: number, n: number, y0: (x: number) => number, depth: number, colors: string[], rMin: number, rMax: number, r: () => number) {
  for (const color of colors) {
    const xyr: number[] = [];
    for (let i = 0; i < n / colors.length; i++) {
      const x = r() * W;
      const y = y0(x) + 3 + r() * depth;
      const rad = rMin + r() * (rMax - rMin);
      around(W, x, rad, (xx) => xyr.push(xx, y, rad));
    }
    discs(ctx, color, xyr);
  }
}

/** Haze laid over what's painted between y0 and y1 (nothing where nothing is): `a0` at y0 to `a1` at y1. */
export function haze(ctx: Ctx, W: number, y0: number, y1: number, rgb: string, a0: number, a1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, `rgba(${rgb},${a0})`);
  g.addColorStop(1, `rgba(${rgb},${a1})`);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, W, y1 - y0);
  ctx.globalCompositeOperation = 'source-over';
}

export interface Leaves {
  dark: string;
  mid: string;
  lit: string;
  trunk: string;
}

/**
 * Crowns of trees gathered to paint together: all their trunks one fill, then all their shaded lumps,
 * their lumps, and their lit caps one fill each. (One fill per crown per tone was hundreds of fills a
 * backdrop, and a software renderer pays by the fill.) Crowns that overlap merge into one canopy, so
 * a grove is for trees side by side or a wood seen from afar; a row in front is a grove of its own.
 */
export class Grove {
  private trunks: number[] = [];
  /** x, y, radius, and the crown's middle height (a lump above it is lit) */
  private lumps: number[] = [];

  /** `sun` -1: lit from the left, 1: from the right */
  constructor(private readonly sun: number) {}

  /**
   * A tree's crown on its trunk standing at (x, y), s tall: leafy lumps round its middle. Its shape
   * comes from `seed`, so a copy painted again across a strip's edge is the same tree. No trunk: a bush.
   */
  tree(x: number, y: number, s: number, seed: number, trunk = true) {
    const r = rng(seed);
    const cy = trunk ? y - s * 0.66 : y - s * 0.28;
    if (trunk) this.trunks.push(x, y, s, cy);
    const w = trunk ? 1 : 1.5;
    const lit = cy + s * 0.06;
    this.lumps.push(x, cy, s * (trunk ? 0.3 : 0.26), lit);
    const n = 6 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + r() * 0.6;
      const d = s * (0.2 + r() * 0.07);
      const ly = cy + Math.sin(a) * d * (trunk ? 0.8 : 0.45);
      // (a bush sits on the ground: nothing below it)
      this.lumps.push(x + Math.cos(a) * d * 1.2 * w, trunk ? ly : Math.min(ly, y - s * 0.12), s * (0.15 + r() * 0.09), lit);
    }
  }

  paint(ctx: Ctx, p: Leaves) {
    const T = this.trunks;
    if (T.length) {
      ctx.fillStyle = p.trunk;
      ctx.beginPath();
      for (let i = 0; i < T.length; i += 4) {
        const [x, y, s, cy] = [T[i], T[i + 1], T[i + 2], T[i + 3]];
        ctx.moveTo(x - s * 0.06, y);
        ctx.lineTo(x - s * 0.035, cy);
        ctx.lineTo(x + s * 0.035, cy);
        ctx.lineTo(x + s * 0.06, y);
        ctx.closePath();
      }
      ctx.fill();
    }
    const L = this.lumps;
    const tone = (color: string, dx: number, dy: number, k: number, litOnly: boolean) => {
      const xyr: number[] = [];
      for (let i = 0; i < L.length; i += 4) {
        const [lx, ly, lr] = [L[i], L[i + 1], L[i + 2]];
        if (litOnly && ly >= L[i + 3]) continue;
        xyr.push(lx + dx * lr, ly + dy * lr, lr * k);
      }
      discs(ctx, color, xyr);
    };
    tone(p.dark, -this.sun * 0.08, 0.14, 1, false);
    tone(p.mid, this.sun * 0.06, -0.06, 0.86, false);
    tone(p.lit, this.sun * 0.3, -0.34, 0.5, true);
  }
}

/**
 * Woods in `n` clumps along the line y(x): each a few crowns packed shoulder to shoulder, the middle
 * ones tallest (a trunk showing under some), bare ground between the clumps.
 */
export function woods(ctx: Ctx, W: number, y: (x: number) => number, n: number, sMin: number, sMax: number, p: Leaves, seed: number, r: () => number) {
  const grove = new Grove(1);
  for (let c = 0; c < n; c++) {
    const cx = ((c + 0.2 + r() * 0.6) / n) * W;
    const k = 3 + Math.floor(r() * 4);
    const span = sMax * k * 0.55;
    const trees: [number, number, number, boolean][] = [];
    for (let i = 0; i < k; i++) {
      const u = k > 1 ? i / (k - 1) - 0.5 : 0;
      const s = sMin + (sMax - sMin) * (1 - Math.abs(u) * 1.4) * (0.75 + r() * 0.35);
      trees.push([cx + u * span + (r() - 0.5) * sMin * 0.5, Math.max(sMin * 0.7, s), seed + c * 16 + i, r() < 0.4]);
    }
    for (const [x, s, sd, trunk] of trees) around(W, x, s, (xx) => grove.tree(xx, y(x) + s * 0.12, s, sd, trunk));
  }
  grove.paint(ctx, p);
}

/** Trees ([x, size, seed], standing on y(x)) in two groves: the smaller half behind, the bigger in front. */
function grow(ctx: Ctx, W: number, list: [number, number, number][], y: (x: number) => number, p: Leaves) {
  list.sort((a, b) => a[1] - b[1]);
  const half = Math.ceil(list.length / 2);
  for (const part of [list.slice(0, half), list.slice(half)]) {
    const grove = new Grove(1);
    for (const [x, s, seed] of part) around(W, x, s * 0.6, (xx) => grove.tree(xx, y(x) + s * 0.08, s, seed));
    grove.paint(ctx, p);
  }
}

export interface FallPal {
  rock: string;
  rockLit: string;
  rockDark: string;
  /** moss on the lip: lit, mid, shaded */
  moss: [string, string, string];
  water: string;
  light: string;
  /** the darker streaks in the sheet */
  shade: string;
  mist: string;
}

/**
 * A waterfall: the buttress of rock it pours over, lit along its lip and striped down its flanks; the
 * wet channel the sheet falls down, the sheet itself (brightest where it comes over, streaked light and
 * dark, widening as it falls), moss along the lip either side, and foam and mist where it lands.
 * `seed` gives the rock's stripes and the foam.
 */
export function fall(ctx: Ctx, x: number, top: number, bottom: number, w: number, o: FallPal, seed: number) {
  const r = rng(seed);
  const h = bottom - top;
  const span = Math.max(w * 2.3, h * 0.32);
  const lip = top;
  // the buttress, its lit top and stripes (none for a fall down a cliff already painted: just the water)
  if (o.rock) {
  ctx.fillStyle = o.rock;
  ctx.beginPath();
  ctx.moveTo(x - span, bottom);
  ctx.bezierCurveTo(x - span * 1.02, lip + h * 0.45, x - span * 0.92, lip + h * 0.06, x - span * 0.56, lip);
  ctx.lineTo(x + span * 0.56, lip);
  ctx.bezierCurveTo(x + span * 0.92, lip + h * 0.08, x + span * 1.02, lip + h * 0.5, x + span, bottom);
  ctx.closePath();
  ctx.fill();
  // its lit top
  ctx.fillStyle = o.rockLit;
  ctx.beginPath();
  ctx.moveTo(x - span * 0.62, lip + h * 0.012);
  ctx.quadraticCurveTo(x - span * 0.6, lip - h * 0.004, x - span * 0.5, lip - h * 0.004);
  ctx.lineTo(x + span * 0.5, lip - h * 0.004);
  ctx.quadraticCurveTo(x + span * 0.6, lip - h * 0.004, x + span * 0.64, lip + h * 0.014);
  ctx.lineTo(x + span * 0.55, lip + h * 0.05);
  ctx.lineTo(x - span * 0.55, lip + h * 0.05);
  ctx.closePath();
  ctx.fill();
  // stripes down its flanks
  ctx.strokeStyle = o.rockDark;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, w * 0.06);
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1;
    const sx = x + side * (w * 0.95 + r() * (span * 0.75 - w * 0.95));
    const y0 = lip + h * (0.08 + r() * 0.25);
    ctx.moveTo(sx, y0);
    ctx.lineTo(sx + side * r() * w * 0.4, y0 + h * (0.2 + r() * 0.45));
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  }
  // the wet channel, dark behind the sheet
  ctx.fillStyle = o.rockDark;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.66, lip + h * 0.01);
  ctx.lineTo(x + w * 0.66, lip + h * 0.01);
  ctx.lineTo(x + w * 0.92, bottom);
  ctx.lineTo(x - w * 0.92, bottom);
  ctx.closePath();
  ctx.fill();
  // the sheet
  const g = ctx.createLinearGradient(0, lip, 0, bottom);
  g.addColorStop(0, o.light);
  g.addColorStop(0.2, o.water);
  g.addColorStop(1, o.water);
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.56, lip);
  ctx.quadraticCurveTo(x, lip - w * 0.16, x + w * 0.56, lip);
  ctx.lineTo(x + w * 0.8, bottom);
  ctx.lineTo(x - w * 0.8, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  // streaks down it, light and shaded, broad and fine (a stroke for each kind)
  const streaks: [string, number, number][] = [
    [o.light, 0.12, 0.45],
    [o.light, 0.06, 0.7],
    [o.shade, 0.09, 0.55],
  ];
  streaks.forEach(([color, width, alpha], kind) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1, w * width);
    ctx.beginPath();
    for (let i = kind; i < 12; i += 3) {
      const u = (i + 0.15 + r() * 0.7) / 12 - 0.5;
      const y0 = lip + h * r() * 0.35;
      ctx.moveTo(x + u * w * 1.05, y0);
      ctx.lineTo(x + u * w * 1.5, Math.min(bottom, y0 + h * (0.3 + r() * 0.6)));
    }
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  // where it comes over: a bright roll of water
  ctx.fillStyle = o.light;
  ctx.beginPath();
  ctx.ellipse(x, lip + w * 0.03, w * 0.6, Math.max(1, w * 0.11), 0, 0, TAU);
  ctx.fill();
  // moss along the lip either side, and a few strands of it hanging down the rock
  if (o.rock) {
  const lumps: [number, number, number][] = [];
  for (const side of [-1, 1]) {
    for (let u = w * 0.62; u < span * 0.62; u += w * (0.2 + r() * 0.16)) lumps.push([x + side * u, lip + w * (0.02 + r() * 0.06), w * (0.13 + r() * 0.1)]);
  }
  for (const [k, dy, color] of [
    [1, 0.25, o.moss[2]],
    [0.85, 0, o.moss[1]],
    [0.45, -0.35, o.moss[0]],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [lx, ly, lr] of lumps) {
      ctx.moveTo(lx + lr * k, ly + dy * lr);
      ctx.arc(lx, ly + dy * lr, lr * k, 0, TAU);
    }
    ctx.fill();
  }
  ctx.strokeStyle = o.moss[2];
  ctx.lineWidth = Math.max(1, w * 0.05);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const vx = x + side * (w * 0.75 + r() * span * 0.35);
    ctx.moveTo(vx, lip + w * 0.1);
    ctx.lineTo(vx + side * w * 0.05, lip + w * 0.1 + h * (0.06 + r() * 0.12));
  }
  ctx.stroke();
  }
  // foam where it lands, and the mist rising off it
  ctx.fillStyle = o.light;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  for (let i = 0; i < 9; i++) {
    const fx = x + (r() - 0.5) * w * 1.9;
    const fr = w * (0.14 + r() * 0.16);
    const fy = bottom - fr * 0.5 - r() * w * 0.15;
    ctx.moveTo(fx + fr, fy);
    ctx.arc(fx, fy, fr, 0, TAU);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
  const m = ctx.createRadialGradient(x, bottom - w * 0.3, 0, x, bottom - w * 0.3, w * 2.3);
  m.addColorStop(0, o.mist);
  m.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = m;
  ctx.fillRect(x - w * 2.3, bottom - w * 2.6, w * 4.6, w * 4.6);
}

// ------------------------------------------------------------------ 1 · Mossy Creek

const G_FALL: FallPal = {
  rock: '#a9bd9d',
  rockLit: '#c8d8b6',
  rockDark: '#78907f',
  moss: ['#d6eaa6', '#b6d68a', '#98bd74'],
  water: '#c8e5e3',
  light: '#ffffff',
  shade: '#8fc0c8',
  mist: 'rgba(255,255,250,0.62)',
};

/** Far off: pale hills, a rocky ridge mossed along its top with three falls coming down it, woods at its foot, haze in the valley. */
export const gardenFar = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(91);
  const far = wave(W, 11, [2, 5], [0.035, 0.012]);
  fillBelow(ctx, W, (x) => H * (0.545 + far(x)), H, '#d5e8c3');
  // the ridge
  const top = wave(W, 13, [2, 5, 11], [0.02, 0.01, 0.005]);
  const ry = (x: number) => H * (0.565 + top(x));
  fillBelow(ctx, W, ry, H, '#aabe9d');
  band(ctx, W, ry, () => H * 0.012, '#c5d5b3');
  ctx.strokeStyle = '#98ad8e';
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = Math.max(1, H * 0.0022);
  ctx.beginPath();
  for (let i = 0; i < 70; i++) {
    const x = r() * W;
    const y0 = ry(x) + H * (0.018 + r() * 0.03);
    const len = H * (0.03 + r() * 0.05);
    around(W, x, 2, (xx) => {
      ctx.moveTo(xx, y0);
      ctx.lineTo(xx + (r() - 0.5) * H * 0.006, y0 + len);
    });
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  yield;
  // woods in clumps along the ridge's top, bare rock between
  woods(ctx, W, ry, 11, H * 0.024, H * 0.042, { dark: '#a2c27e', mid: '#b6d48e', lit: '#d0e6a6', trunk: '#98a888' }, 300, r);
  yield;
  // the falls
  const falls: [number, number, number][] = [
    [0.17, 0.052, 0.69],
    [0.5, 0.064, 0.695],
    [0.81, 0.046, 0.688],
  ];
  falls.forEach(([fx, w, bottom], i) => {
    const x = W * fx;
    fall(ctx, x, ry(x) + H * 0.004, H * bottom, H * w, G_FALL, 40 + i);
  });
  yield;
  // nearer hills, wooded
  const near = wave(W, 12, [3, 7], [0.022, 0.008]);
  const ny = (x: number) => H * (0.7 + near(x));
  fillBelow(ctx, W, ny, H, '#bcdb9f');
  stipple(ctx, W, 160, ny, H * 0.1, ['#cbe3ad', '#a8cb86'], H * 0.0016, H * 0.0035, r);
  woods(ctx, W, ny, 9, H * 0.04, H * 0.065, { dark: '#9ec478', mid: '#b2d389', lit: '#cbe5a0', trunk: '#8f9f7a' }, 400, r);
  yield;
  // morning haze settling in the valley
  haze(ctx, W, H * 0.58, H, '238,244,214', 0, 0.6);
});

/** Nearer: a meadow on rolling hills, clumps of trees with lit crowns, bushes along the front. */
export const gardenNear = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(92);
  const back = wave(W, 21, [2, 5], [0.032, 0.012]);
  const by = (x: number) => H * (0.772 + back(x));
  fillBelow(ctx, W, by, H, '#a2cb6a');
  stipple(ctx, W, 340, by, H * 0.12, ['#b9da7c', '#8fbd58', '#cfe597', '#f3f1c4'], H * 0.002, H * 0.0042, r);
  yield;
  const trees: Leaves = { dark: '#6f9e3f', mid: '#88b64b', lit: '#b0d264', trunk: '#6e5a3f' };
  const list: [number, number, number][] = [];
  for (let i = 0; i < 15; i++) list.push([r() * W, H * (0.085 + r() * 0.065), 500 + i]);
  grow(ctx, W, list, by, trees);
  yield;
  const front = wave(W, 22, [4, 9], [0.016, 0.006]);
  const fy = (x: number) => H * (0.885 + front(x));
  fillBelow(ctx, W, fy, H, '#8bbd52');
  const bushes = new Grove(1);
  for (let i = 0; i < 22; i++) {
    const x = r() * W;
    const s = H * (0.04 + r() * 0.035);
    const seed = 600 + i;
    around(W, x, s, (xx) => bushes.tree(xx, fy(x) + s * 0.15, s, seed, false));
  }
  bushes.paint(ctx, { dark: '#679a3a', mid: '#7dae45', lit: '#a3cb5a', trunk: '' });
  yield;
  stipple(ctx, W, 200, fy, H * 0.09, ['#a3cd62', '#77a945', '#d4e98f'], H * 0.002, H * 0.004, r);
  haze(ctx, W, H * 0.6, H * 0.8, '236,243,210', 0.28, 0);
});

// ------------------------------------------------------------------ 4 · The Cascades

const C_FALL: FallPal = {
  rock: '#c3917f',
  rockLit: '#f1c69e',
  rockDark: '#93685f',
  moss: ['#e8dc8c', '#c7c06e', '#a39d5a'],
  water: '#ffe6d4',
  light: '#fffaf0',
  shade: '#e8c0ae',
  mist: 'rgba(255,240,226,0.62)',
};

/**
 * Far off: mesas in the sunset haze, and the cliff the water comes down in steps — over the top, onto
 * a mossy ledge, and over again to the valley — lit along every edge by the low sun.
 */
export const cascadeFar = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(93);
  const far = wave(W, 51, [3, 7], [0.03, 0.012]);
  fillBelow(ctx, W, (x) => H * (0.5 + far(x)), H, '#e8b99e');
  // the cliff: its top, a ledge across it, its foot
  const top = wave(W, 53, [3, 7, 13], [0.022, 0.011, 0.006]);
  const cy = (x: number) => H * (0.565 + top(x));
  const ledge = wave(W, 54, [2, 6], [0.008, 0.004]);
  const ly = (x: number) => H * (0.668 + ledge(x));
  fillBelow(ctx, W, cy, H, '#c79583');
  band(ctx, W, cy, () => H * 0.011, '#f0c49e');
  yield;
  // stripes down the upper cliff and the lower
  ctx.strokeStyle = '#a97c6e';
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, H * 0.0024);
  ctx.beginPath();
  for (let i = 0; i < 90; i++) {
    const x = r() * W;
    const lower = i % 2 === 1;
    const y0 = (lower ? ly(x) : cy(x)) + H * (0.016 + r() * 0.02);
    const len = H * (0.025 + r() * 0.045);
    around(W, x, 2, (xx) => {
      ctx.moveTo(xx, y0);
      ctx.lineTo(xx + (r() - 0.5) * H * 0.005, y0 + len);
    });
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  yield;
  // the ledge: lit, shaded under its lip, mossed
  band(ctx, W, (x) => ly(x) + H * 0.008, () => H * 0.01, '#a77a6c');
  band(ctx, W, ly, () => H * 0.008, '#efc19b');
  const moss: Leaves = { dark: '#b0a45c', mid: '#cbbf6e', lit: '#ead98a', trunk: '#9a7a62' };
  const ledgeMoss = new Grove(1);
  for (let i = 0; i < 40; i++) {
    const x = r() * W;
    const s = H * (0.018 + r() * 0.022);
    const seed = 700 + i;
    around(W, x, s * 1.2, (xx) => ledgeMoss.tree(xx, ly(x) + s * 0.25, s, seed, false));
  }
  ledgeMoss.paint(ctx, moss);
  const topWood = new Grove(1);
  for (let i = 0; i < 38; i++) {
    const x = r() * W;
    const s = H * (0.022 + r() * 0.03);
    const seed = 800 + i;
    around(W, x, s, (xx) => topWood.tree(xx, cy(x) + s * 0.15, s, seed, i % 3 !== 0));
  }
  topWood.paint(ctx, moss);
  yield;
  // the falls, each in two steps
  const falls: [number, number][] = [
    [0.16, 0.036],
    [0.47, 0.05],
    [0.77, 0.034],
  ];
  falls.forEach(([fx, w], i) => {
    const x = W * fx;
    fall(ctx, x, cy(x) + H * 0.004, ly(x) + H * 0.004, H * w, C_FALL, 60 + i);
    const x2 = x + H * w * (i % 2 ? -0.7 : 0.7);
    fall(ctx, x2, ly(x2) + H * 0.006, H * 0.775, H * w * 1.15, C_FALL, 70 + i);
  });
  yield;
  // the valley floor, and the warm haze over everything low
  const floor = wave(W, 55, [4, 9], [0.006, 0.003]);
  fillBelow(ctx, W, (x) => H * (0.782 + floor(x)), H, '#b88a72');
  haze(ctx, W, H * 0.6, H, '249,214,184', 0, 0.55);
});

/** Nearer: olive-gold hills, trees lit from the low sun on the right, bushes along the front. */
export const cascadeNear = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(94);
  const back = wave(W, 61, [3, 7], [0.03, 0.01]);
  const by = (x: number) => H * (0.835 + back(x));
  fillBelow(ctx, W, by, H, '#949f56');
  stipple(ctx, W, 280, by, H * 0.1, ['#aab364', '#7f8b48', '#d4c77c'], H * 0.002, H * 0.0042, r);
  yield;
  const trees: Leaves = { dark: '#62713a', mid: '#80904a', lit: '#d7c873', trunk: '#5e4634' };
  const list: [number, number, number][] = [];
  for (let i = 0; i < 13; i++) list.push([r() * W, H * (0.1 + r() * 0.06), 900 + i]);
  grow(ctx, W, list, by, trees);
  yield;
  const bushes = new Grove(1);
  for (let i = 0; i < 16; i++) {
    const x = r() * W;
    const s = H * (0.035 + r() * 0.03);
    const seed = 950 + i;
    around(W, x, s, (xx) => bushes.tree(xx, by(x) + H * 0.045 + s * 0.15, s, seed, false));
  }
  bushes.paint(ctx, { dark: '#5d6c36', mid: '#788a44', lit: '#cdbf6c', trunk: '' });
  haze(ctx, W, H * 0.66, H * 0.86, '250,214,182', 0.3, 0);
});

// ------------------------------------------------------------------ pines

/**
 * Pines standing at (x, y), s tall: tiered silhouettes in their shade, the half facing the light lit
 * (`sun` -1: from the left, 1: from the right), trunks under them. Three fills for any number of them.
 */
function pines(ctx: Ctx, list: [number, number, number][], shade: string, lit: string, trunk: string, sun: number) {
  const tiers = 4;
  // the outline down one side, as offsets (dx outward, dy from the top) in units of s
  const side: [number, number][] = [[0, 0]];
  for (let k = 0; k < tiers; k++) {
    const top = k * 0.21;
    side.push([0.13 + k * 0.075, top + 0.29], [0.05 + k * 0.05, top + 0.26]);
  }
  side.push([0.04, 0.92]);
  const outline = (x: number, y: number, s: number, dir: number) => {
    ctx.moveTo(x, y - s);
    for (const [dx, dy] of side) ctx.lineTo(x + dir * dx * s, y - s + dy * s);
  };
  ctx.fillStyle = trunk;
  ctx.beginPath();
  for (const [x, y, s] of list) ctx.rect(x - s * 0.03, y - s * 0.12, s * 0.06, s * 0.12);
  ctx.fill();
  ctx.fillStyle = shade;
  ctx.beginPath();
  for (const [x, y, s] of list) {
    outline(x, y, s, 1);
    for (let i = side.length - 1; i >= 0; i--) ctx.lineTo(x - side[i][0] * s, y - s + side[i][1] * s);
    ctx.closePath();
  }
  ctx.fill();
  ctx.fillStyle = lit;
  ctx.beginPath();
  for (const [x, y, s] of list) {
    outline(x, y, s, sun);
    ctx.lineTo(x, y - s * 0.08);
    ctx.closePath();
  }
  ctx.fill();
}

/** `n` pines along y(x) between sizes, back to front by size; copies across the strip's edges. */
function pineRow(W: number, n: number, y: (x: number) => number, sMin: number, sMax: number, r: () => number) {
  const list: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const s = sMin + r() * (sMax - sMin);
    around(W, x, s * 0.45, (xx) => list.push([xx, y(x) + s * 0.04, s]));
  }
  return list.sort((a, b) => a[2] - b[2]);
}

/** Ferns along the ground y(x): fronds fanning up, a fill for the stems and one for the leaves a colour. */
function fernBed(ctx: Ctx, W: number, n: number, y: (x: number) => number, s: number, colors: string[], r: () => number) {
  for (const color of colors) {
    const stems: [number, number, number, number][] = [];
    for (let i = 0; i < n / colors.length; i++) {
      const x = r() * W;
      const len = s * (0.6 + r() * 0.6);
      const k = 3 + Math.floor(r() * 3);
      for (let j = 0; j < k; j++) {
        const l = len * (0.7 + r() * 0.4);
        const a = -Math.PI / 2 + (j / (k - 1) - 0.5) * 1.9;
        around(W, x, len, (xx) => stems.push([xx, y(x), l, a]));
      }
    }
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [x, y0, len, a] of stems) {
      ctx.moveTo(x, y0);
      ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y0 + Math.sin(a) * len * 0.5, x + Math.cos(a + 0.25 * Math.sign(Math.cos(a))) * len, y0 + Math.sin(a + 0.25 * Math.sign(Math.cos(a))) * len);
    }
    ctx.stroke();
    ctx.beginPath();
    for (const [x, y0, len, a] of stems) {
      for (let t = 0.25; t < 0.95; t += 0.14) {
        const px = x + Math.cos(a) * len * t;
        const py = y0 + Math.sin(a) * len * t;
        const leaf = len * 0.16 * (1 - t * 0.6);
        for (const sd of [-1, 1]) {
          const la = a + sd * 1.2;
          ctx.moveTo(px + Math.cos(la) * leaf, py + Math.sin(la) * leaf);
          ctx.ellipse(px + Math.cos(la) * leaf * 0.5, py + Math.sin(la) * leaf * 0.5, leaf * 0.55, leaf * 0.2, la, 0, TAU);
        }
      }
    }
    ctx.fill();
  }
}

// ------------------------------------------------------------------ 2 · Fern Falls

/** Far off, at golden hour: rows of pines going pale in the haze, and the tall fall the level is named for. */
export const woodsFar = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(95);
  const a = wave(W, 71, [2, 5], [0.012, 0.005]);
  const ay = (x: number) => H * (0.655 + a(x));
  pines(ctx, pineRow(W, 56, ay, H * 0.12, H * 0.2, r), '#e5d29a', '#f4e6b4', '#d8c08a', -1);
  fillBelow(ctx, W, ay, H, '#e5d29a');
  yield;
  fall(ctx, W * 0.55, H * 0.37, H * 0.72, H * 0.05, { rock: '#c8a676', rockLit: '#f3dca4', rockDark: '#9a7a58', moss: ['#e8dc8e', '#c9c06c', '#a39d58'], water: '#fff0d4', light: '#fffaf0', shade: '#e9cfa8', mist: 'rgba(255,246,226,0.6)' }, 80);
  yield;
  const b = wave(W, 72, [3, 7], [0.01, 0.004]);
  const by = (x: number) => H * (0.705 + b(x));
  pines(ctx, pineRow(W, 42, by, H * 0.17, H * 0.27, r), '#cbb877', '#ead592', '#a98f62', -1);
  fillBelow(ctx, W, by, H, '#cbb877');
  haze(ctx, W, H * 0.5, H, '255,236,196', 0, 0.55);
});

/**
 * Nearer: the pines' trunks going up past the top of the screen, their bark lit on the sun's side and
 * their crowns lumped up there; light slanting down between them; ferns along the floor.
 */
export const woodsNear = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(96);
  const g = wave(W, 73, [2, 5], [0.012, 0.005]);
  const gy = (x: number) => H * (0.82 + g(x));
  pines(ctx, pineRow(W, 30, gy, H * 0.25, H * 0.4, r), '#a39a58', '#cfc27c', '#86744e', -1);
  fillBelow(ctx, W, gy, H, '#a39a58');
  yield;
  // light slanting down between the trunks
  ctx.fillStyle = 'rgba(255,232,170,0.13)';
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const x = ((i + 0.3 + r() * 0.4) / 4) * W;
    const w = H * (0.05 + r() * 0.06);
    ctx.moveTo(x, 0);
    ctx.lineTo(x + w, 0);
    ctx.lineTo(x + w + H * 0.45, H * 0.9);
    ctx.lineTo(x + H * 0.45 - w * 0.5, H * 0.9);
    ctx.closePath();
  }
  ctx.fill();
  yield;
  // the trunks: bark in shade, a lit strip on the sun's side, a furrow or two
  const trunks: [number, number][] = [];
  for (let i = 0; i < 9; i++) trunks.push([((i + 0.15 + r() * 0.7) / 9) * W, H * (0.03 + r() * 0.03)]);
  const each = (f: (x: number, w: number) => void) => {
    for (const [x, w] of trunks) around(W, x, w * 2, (xx) => f(xx, w));
  };
  ctx.fillStyle = '#6f5038';
  ctx.beginPath();
  each((x, w) => ctx.rect(x, 0, w, H));
  ctx.fill();
  ctx.fillStyle = '#a5794f';
  ctx.beginPath();
  each((x, w) => ctx.rect(x + w * 0.08, 0, w * 0.28, H));
  ctx.fill();
  ctx.strokeStyle = '#5a3f2c';
  ctx.lineWidth = Math.max(1, H * 0.002);
  ctx.beginPath();
  each((x, w) => {
    for (let k = 0; k < 3; k++) {
      const fx = x + w * (0.45 + k * 0.17);
      ctx.moveTo(fx, 0);
      ctx.lineTo(fx + w * 0.04, H);
    }
  });
  ctx.stroke();
  yield;
  // their crowns, up at the top
  const crowns = new Grove(-1);
  trunks.forEach(([x0, w], i) => {
    const n = 1 + (i % 3);
    const top = H * (0.03 + ((i * 7) % 5) * 0.035);
    around(W, x0, H * 0.3, (x) => {
      for (let k = 0; k < n; k++) crowns.tree(x + w / 2 + (k - (n - 1) / 2) * H * 0.09, top + (k % 2) * H * 0.05, H * (0.13 + ((i + k) % 3) * 0.035), 1500 + i * 3 + k, false);
    });
  });
  crowns.paint(ctx, { dark: '#7a8442', mid: '#929c4e', lit: '#cdb866', trunk: '' });
  yield;
  // ferns along the floor
  fernBed(ctx, W, 40, (x) => gy(x) + H * 0.06, H * 0.11, ['#7f9440', '#a4b458'], r);
  yield;
  stipple(ctx, W, 160, gy, H * 0.16, ['#b7ad66', '#8e8650', '#e6d690'], H * 0.002, H * 0.004, r);
});

// ------------------------------------------------------------------ 3 · The Old Mill

/** Far off: blue-green hills in the afternoon haze, the fall on the hillside that feeds the millrace, woods. */
export const millFar = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(97);
  const a = wave(W, 31, [2, 5], [0.04, 0.012]);
  const ay = (x: number) => H * (0.585 + a(x));
  fillBelow(ctx, W, ay, H, '#c8e2cf');
  woods(ctx, W, ay, 8, H * 0.022, H * 0.04, { dark: '#b0d0ae', mid: '#c0dcbb', lit: '#d8ecd0', trunk: '#a8bba8' }, 1100, r);
  yield;
  fall(ctx, W * 0.36, H * 0.5, H * 0.7, H * 0.045, { rock: '#a7bfae', rockLit: '#c8dccb', rockDark: '#7f9a8c', moss: ['#cfe8b6', '#b2d39a', '#94ba84'], water: '#d8eef0', light: '#ffffff', shade: '#9fc8d0', mist: 'rgba(255,255,255,0.6)' }, 81);
  yield;
  const b = wave(W, 32, [3, 7], [0.022, 0.008]);
  const by = (x: number) => H * (0.7 + b(x));
  fillBelow(ctx, W, by, H, '#aed2a4');
  stipple(ctx, W, 140, by, H * 0.08, ['#c3dfb2', '#98c290'], H * 0.0016, H * 0.0035, r);
  woods(ctx, W, by, 8, H * 0.035, H * 0.06, { dark: '#8fbe86', mid: '#a5cd96', lit: '#c5e2ae', trunk: '#8a9a80' }, 1200, r);
  haze(ctx, W, H * 0.55, H, '238,248,240', 0, 0.55);
});

/**
 * Nearer: the old mill by the millrace — stone walls, a tiled roof, and its wheel turning under the
 * water a wooden flume brings to it — with cottages, trees and a meadow around.
 */
export const millNear = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(98);
  const g = wave(W, 41, [2, 5], [0.03, 0.01]);
  const gy = (x: number) => H * (0.82 + g(x));
  fillBelow(ctx, W, gy, H, '#9cc98d');
  stipple(ctx, W, 260, gy, H * 0.12, ['#b5da9c', '#86b77a', '#f2f0cc'], H * 0.002, H * 0.004, r);
  // the millrace, along the foot of the meadow
  ctx.fillStyle = '#86c3c6';
  ctx.fillRect(0, H * 0.93, W, H * 0.07);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(0, H * 0.93, W, H * 0.006);
  yield;
  // cottages: walls, a tiled roof, a window
  const cottages: [number, number][] = [];
  for (let i = 0; i < 4; i++) cottages.push([((i + 0.2 + r() * 0.5) / 4) * W, H * (0.07 + r() * 0.03)]);
  for (const [x0, w] of cottages) {
    if (Math.abs(x0 - W * 0.55) < H * 0.32) continue;
    around(W, x0, w * 1.2, (x) => house(ctx, x, gy(x0) + H * 0.01, w, w * 0.62, '#f1e6d0', '#c86d50', '#6f88a8'));
  }
  yield;
  // the mill itself, its wheel beside it under the flume
  const mx = W * 0.55;
  const base = gy(mx) + H * 0.02;
  house(ctx, mx, base, H * 0.16, H * 0.13, '#e2d6bc', '#b8553e', '#5f7896');
  ctx.strokeStyle = 'rgba(120,100,80,0.35)';
  ctx.lineWidth = Math.max(1, H * 0.0015);
  ctx.beginPath();
  for (let k = 1; k < 5; k++) {
    ctx.moveTo(mx - H * 0.08, base - H * 0.026 * k);
    ctx.lineTo(mx + H * 0.08, base - H * 0.026 * k);
  }
  ctx.stroke();
  const wx = mx - H * 0.1;
  const wy = base - H * 0.07;
  const wr = H * 0.07;
  yield;
  // the flume: a wooden channel from the left, onto the wheel's top
  ctx.fillStyle = '#7a5838';
  ctx.fillRect(wx - H * 0.32, wy - wr - H * 0.022, H * 0.3, H * 0.018);
  ctx.fillStyle = '#9a7650';
  ctx.fillRect(wx - H * 0.32, wy - wr - H * 0.022, H * 0.3, H * 0.006);
  ctx.fillStyle = '#5f4630';
  ctx.beginPath();
  for (let k = 0; k < 4; k++) ctx.rect(wx - H * 0.31 + k * H * 0.08, wy - wr - H * 0.006, H * 0.008, base - (wy - wr) + H * 0.006);
  ctx.fill();
  yield;
  // the wheel: rim, spokes, paddles
  ctx.strokeStyle = '#5f4430';
  ctx.lineWidth = Math.max(1.5, H * 0.006);
  ctx.beginPath();
  ctx.arc(wx, wy, wr, 0, TAU);
  ctx.moveTo(wx + wr * 0.72, wy);
  ctx.arc(wx, wy, wr * 0.72, 0, TAU);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + 0.2;
    ctx.moveTo(wx, wy);
    ctx.lineTo(wx + Math.cos(a) * wr, wy + Math.sin(a) * wr);
  }
  ctx.stroke();
  ctx.fillStyle = '#7d5a3a';
  ctx.beginPath();
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(wx + c * wr * 0.95 - s * H * 0.004, wy + s * wr * 0.95 + c * H * 0.004);
    ctx.lineTo(wx + c * wr * 1.12 - s * H * 0.004, wy + s * wr * 1.12 + c * H * 0.004);
    ctx.lineTo(wx + c * wr * 1.12 + s * H * 0.004, wy + s * wr * 1.12 - c * H * 0.004);
    ctx.lineTo(wx + c * wr * 0.95 + s * H * 0.004, wy + s * wr * 0.95 - c * H * 0.004);
    ctx.closePath();
  }
  ctx.fill();
  ctx.fillStyle = '#4a3424';
  ctx.beginPath();
  ctx.arc(wx, wy, wr * 0.1, 0, TAU);
  ctx.fill();
  yield;
  // the water: off the flume, down over the wheel, foaming into the race
  ctx.strokeStyle = 'rgba(232,246,248,0.85)';
  ctx.lineWidth = Math.max(1, H * 0.004);
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const x = wx - H * 0.018 + k * H * 0.009;
    ctx.moveTo(x, wy - wr - H * 0.006);
    ctx.quadraticCurveTo(x + H * 0.03, wy - wr * 0.3, x + H * 0.045 + k * H * 0.004, H * 0.93);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  for (let k = 0; k < 7; k++) {
    const fx = wx + H * 0.03 + (r() - 0.3) * H * 0.06;
    const fr = H * (0.008 + r() * 0.01);
    ctx.moveTo(fx + fr, H * 0.93);
    ctx.arc(fx, H * 0.93, fr, 0, TAU);
  }
  ctx.fill();
  yield;
  // trees about the place
  const list: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) {
    const x = r() * W;
    if (Math.abs(x - mx) < H * 0.26) continue;
    list.push([x, H * (0.07 + r() * 0.04), 1300 + i]);
  }
  grow(ctx, W, list, gy, { dark: '#5f9a4a', mid: '#79b056', lit: '#a8d070', trunk: '#7a5c40' });
  haze(ctx, W, H * 0.6, H * 0.85, '238,248,240', 0.22, 0);
});

/** A house at (x, ground): walls w wide and h high, a pitched tiled roof, a lit window, a door. */
function house(ctx: Ctx, x: number, ground: number, w: number, h: number, wall: string, roof: string, glass: string) {
  ctx.fillStyle = wall;
  ctx.fillRect(x - w / 2, ground - h, w, h);
  ctx.fillStyle = 'rgba(90,70,50,0.18)';
  ctx.fillRect(x + w * 0.18, ground - h, w * 0.32, h);
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.6, ground - h);
  ctx.lineTo(x, ground - h - w * 0.42);
  ctx.lineTo(x + w * 0.6, ground - h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,30,20,0.35)';
  ctx.lineWidth = Math.max(1, w * 0.012);
  ctx.beginPath();
  for (let k = 1; k < 4; k++) {
    const t = k / 4;
    ctx.moveTo(x - w * 0.6 * t, ground - h - w * 0.42 * (1 - t));
    ctx.lineTo(x + w * 0.6 * t, ground - h - w * 0.42 * (1 - t));
  }
  ctx.stroke();
  ctx.fillStyle = glass;
  ctx.fillRect(x - w * 0.3, ground - h * 0.72, w * 0.18, w * 0.18);
  ctx.fillStyle = '#7a5a40';
  ctx.fillRect(x + w * 0.1, ground - h * 0.5, w * 0.16, h * 0.5);
}

// ------------------------------------------------------------------ 5 · The Great Falls

const NIGHT_FALL: FallPal = {
  rock: '',
  rockLit: '#3a5470',
  rockDark: '#141f2e',
  moss: ['#5d8a5e', '#3b5a40', '#2c4434'],
  water: 'rgba(150,196,214,0.92)',
  light: '#dcecf4',
  shade: '#7fa6bf',
  mist: 'rgba(200,225,240,0.4)',
};

/**
 * Far off (held still, so it stays beside the climb): the cliff the height of the sky, striped and
 * moonlit along its edges, mossy ledges, and the great fall pouring down it with two threads beside.
 */
export const fallsFar = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(99);
  // the cliff, ragged down both sides
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let k = 0; k <= 14; k++) {
    left.push([W * (0.24 + (r() - 0.5) * 0.04), H - (k * H) / 14]);
    right.push([W * (0.76 + (r() - 0.5) * 0.04), (k * H) / 14]);
  }
  ctx.fillStyle = '#1f2d40';
  ctx.beginPath();
  ctx.moveTo(W * 0.22, H);
  for (const [x, y] of left) ctx.lineTo(x, y);
  for (const [x, y] of right) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
  yield;
  // moonlight along its edges
  ctx.strokeStyle = '#3d5878';
  ctx.lineWidth = Math.max(1, H * 0.004);
  ctx.beginPath();
  right.forEach(([x, y], i) => (i ? ctx.lineTo(x - H * 0.002, y) : ctx.moveTo(x - H * 0.002, y)));
  left.forEach(([x, y], i) => (i ? ctx.lineTo(x + H * 0.002, y) : ctx.moveTo(x + H * 0.002, y)));
  ctx.stroke();
  yield;
  // stripes down the rock
  ctx.strokeStyle = '#16212f';
  ctx.lineWidth = Math.max(1, H * 0.0025);
  ctx.beginPath();
  for (let i = 0; i < 80; i++) {
    const x = W * (0.27 + r() * 0.46);
    const y = r() * H;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * H * 0.006, y + H * (0.03 + r() * 0.06));
  }
  ctx.stroke();
  yield;
  // mossy ledges, moonlit on top
  const ledges: [number, number, number][] = [];
  for (let i = 0; i < 30; i++) ledges.push([W * (0.27 + r() * 0.46), r() * H, H * (0.02 + r() * 0.03)]);
  for (const [color, dy, k] of [
    ['#22362c', 0.004, 1],
    ['#30503a', 0, 0.85],
    ['#5d8a5e', -0.004, 0.6],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [x, y, w] of ledges) {
      ctx.moveTo(x + w * k, y + H * dy);
      ctx.ellipse(x, y + H * dy, w * k, H * 0.006 * k, 0, 0, TAU);
    }
    ctx.fill();
  }
  yield;
  // the fall and the threads beside it
  fall(ctx, W * 0.5, H * 0.02, H * 1.02, H * 0.09, NIGHT_FALL, 90);
  yield;
  fall(ctx, W * 0.33, H * 0.25, H * 1.02, H * 0.02, NIGHT_FALL, 91);
  fall(ctx, W * 0.66, H * 0.4, H * 1.02, H * 0.016, NIGHT_FALL, 92);
});

/** Nearer: pines black against the night, their edges silvered on the moon's side. */
export const fallsNear = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(100);
  pines(ctx, pineRow(W, 28, () => H * 1.0, H * 0.16, H * 0.3, r), '#0f1828', '#22344c', '#0b111c', 1);
  ctx.fillStyle = '#0f1828';
  ctx.fillRect(0, H * 0.985, W, H * 0.015);
});

// ------------------------------------------------------------------ World 1's middle stops
//
// Three more reaches of the same creek (see game/levels.ts). Each gets its own front layer, which is
// the part a player actually reads; behind it, Lily Pond keeps Mossy Creek's hills and Reed Run keeps
// the Shallows' braided flat, because they are the same valley a little further up it.

/**
 * Blades standing up out of the line y(x): `n` of them, leaning a little, with an oval seed-head on
 * top where `head` is given. One stroked path for the blades and one fill for the heads, whatever
 * the count — a reed bed is the one thing in these backdrops there are hundreds of.
 */
function reedBed(ctx: Ctx, W: number, n: number, y: (x: number) => number, hMin: number, hMax: number, blade: string, head: string | null, width: number, r: () => number) {
  const tips: [number, number, number][] = [];
  ctx.strokeStyle = blade;
  ctx.lineWidth = Math.max(1, width);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const h = hMin + r() * (hMax - hMin);
    const lean = (r() - 0.5) * h * 0.45;
    around(W, x, h, (xx) => {
      ctx.moveTo(xx, y(x));
      ctx.quadraticCurveTo(xx + lean * 0.35, y(x) - h * 0.62, xx + lean, y(x) - h);
      tips.push([xx + lean, y(x) - h, h]);
    });
  }
  ctx.stroke();
  if (!head) return;
  ctx.fillStyle = head;
  ctx.beginPath();
  for (const [x, ty, h] of tips) {
    ctx.moveTo(x + h * 0.04, ty);
    ctx.ellipse(x, ty + h * 0.06, h * 0.04, h * 0.1, 0, 0, TAU);
  }
  ctx.fill();
}

const SH_FALL: FallPal = {
  rock: '#b4c4a3',
  rockLit: '#d8e4c2',
  rockDark: '#829a86',
  moss: ['#e4f2ae', '#c2dc92', '#a0c47c'],
  water: '#daf2f0',
  light: '#ffffff',
  shade: '#9ad0d6',
  mist: 'rgba(255,255,252,0.6)',
};

/**
 * Far off at midday: pale hills, a low shelf the creek comes over in a string of small falls rather
 * than three big ones, and the flat below it braided with channels — which is the level's own shape,
 * seen from a mile off.
 */
export const shallowsFar = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(140);
  const far = wave(W, 41, [2, 5], [0.03, 0.01]);
  fillBelow(ctx, W, (x) => H * (0.5 + far(x)), H, '#d9edc8');
  // the shelf, lower and wider than the garden's ridge
  const top = wave(W, 42, [3, 7, 13], [0.014, 0.008, 0.004]);
  const ry = (x: number) => H * (0.6 + top(x));
  fillBelow(ctx, W, ry, H, '#b5c5a5');
  band(ctx, W, ry, () => H * 0.011, '#d4e0c4');
  yield;
  woods(ctx, W, ry, 10, H * 0.018, H * 0.032, { dark: '#a6c682', mid: '#bad892', lit: '#d4eaaa', trunk: '#9aaa8a' }, 700, r);
  yield;
  // five small falls strung along it
  for (let i = 0; i < 5; i++) {
    const x = W * (0.09 + i * 0.205);
    fall(ctx, x, ry(x) + H * 0.004, H * (0.7 + (i % 2) * 0.012), H * (0.022 + (i % 3) * 0.008), SH_FALL, 60 + i);
  }
  yield;
  // the shingle flat, and the channels lying across it
  const near = wave(W, 43, [3, 8], [0.012, 0.005]);
  const ny = (x: number) => H * (0.73 + near(x));
  fillBelow(ctx, W, ny, H, '#d2dfb8');
  for (let i = 0; i < 4; i++) {
    const w0 = wave(W, 50 + i, [2, 6], [0.006, 0.003]);
    const cy = (x: number) => ny(x) + H * (0.03 + i * 0.05) + H * w0(x);
    band(ctx, W, cy, () => H * (0.013 + (i % 2) * 0.006), i % 2 ? '#bfe2de' : '#d0ebe6');
  }
  stipple(ctx, W, 220, ny, H * 0.24, ['#c6d3ab', '#dde7c2', '#aebb96'], H * 0.0016, H * 0.0032, r);
  yield;
  haze(ctx, W, H * 0.56, H, '242,248,220', 0, 0.5);
});

/** Nearer: a shingle bank with willows leaning over it, and rushes along the very front. */
export const shallowsNear = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(141);
  const back = wave(W, 51, [2, 5], [0.026, 0.01]);
  const by = (x: number) => H * (0.78 + back(x));
  fillBelow(ctx, W, by, H, '#a9d076');
  stipple(ctx, W, 300, by, H * 0.12, ['#c0de88', '#96c160', '#d9eb9f'], H * 0.002, H * 0.0042, r);
  yield;
  const willows = new Grove(1);
  for (let i = 0; i < 12; i++) {
    const x = r() * W;
    const s = H * (0.1 + r() * 0.06);
    around(W, x, s * 0.7, (xx) => willows.tree(xx, by(x) + s * 0.08, s, 740 + i));
  }
  willows.paint(ctx, { dark: '#789f46', mid: '#94ba56', lit: '#c2db78', trunk: '#7b6749' });
  yield;
  const front = wave(W, 52, [4, 9], [0.014, 0.005]);
  const fy = (x: number) => H * (0.9 + front(x));
  fillBelow(ctx, W, fy, H, '#90be57');
  reedBed(ctx, W, 90, fy, H * 0.03, H * 0.085, '#709d3d', null, H * 0.0035, r);
  yield;
  stipple(ctx, W, 180, fy, H * 0.08, ['#a8d066', '#7cae48', '#d6ea92'], H * 0.002, H * 0.004, r);
  haze(ctx, W, H * 0.6, H * 0.82, '240,247,216', 0.24, 0);
});

/**
 * Nearer, at the pond: a wooded rim, then the still water itself with the wood lying on it upside
 * down, pads over it, and bulrushes along the front. Flat water is the one thing in the backdrops
 * that is drawn as a straight edge — everything else in this valley is a wave of some sort — and
 * that is the whole look of the place.
 */
export const pondNear = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(142);
  const back = wave(W, 61, [2, 4], [0.02, 0.008]);
  const by = (x: number) => H * (0.73 + back(x));
  fillBelow(ctx, W, by, H, '#80ae5e');
  woods(ctx, W, by, 8, H * 0.06, H * 0.11, { dark: '#4f7d34', mid: '#679b40', lit: '#8db858', trunk: '#5b4b34' }, 760, r);
  yield;
  // the water, and what is standing beside it lying flat on it
  const wy = H * 0.845;
  ctx.fillStyle = '#4c7d62';
  ctx.fillRect(0, wy, W, H - wy);
  ctx.globalAlpha = 0.5;
  const refl = new Grove(1);
  for (let i = 0; i < 9; i++) {
    const x = r() * W;
    const s = H * (0.05 + r() * 0.05);
    around(W, x, s * 0.7, (xx) => refl.tree(xx, wy + s, s, 770 + i));
  }
  refl.paint(ctx, { dark: '#3d6a4e', mid: '#477a56', lit: '#5d9268', trunk: '#3a5a46' });
  ctx.globalAlpha = 1;
  // the glints the sky leaves on it
  ctx.fillStyle = '#b6ddc0';
  ctx.globalAlpha = 0.45;
  for (let i = 0; i < 70; i++) {
    const w = H * (0.012 + r() * 0.05);
    const x = r() * W;
    around(W, x, w, (xx) => ctx.fillRect(xx, wy + r() * (H - wy), w, Math.max(1, H * 0.003)));
  }
  ctx.globalAlpha = 1;
  yield;
  // pads lying on it, bigger toward the front
  for (const [n, col, y0, s0] of [
    [16, '#6aa24e', 0.87, 0.016],
    [13, '#79b256', 0.93, 0.024],
    [9, '#8cc062', 0.985, 0.034],
  ] as [number, string, number, number][]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = r() * W;
      const s = H * s0 * (0.7 + r() * 0.6);
      around(W, x, s, (xx) => {
        ctx.moveTo(xx + s, H * y0);
        ctx.ellipse(xx, H * y0, s, s * 0.34, 0, 0, TAU);
      });
    }
    ctx.fill();
  }
  yield;
  // bulrushes along the front, their heads dark against the water
  reedBed(ctx, W, 70, () => H * 1.01, H * 0.1, H * 0.22, '#53803a', '#6b4a2c', H * 0.0045, r);
  haze(ctx, W, H * 0.6, H * 0.8, '226,240,206', 0.22, 0);
});

/** Nearer, in the reed bed: three depths of reed, the front row with its seed-heads in the sun. */
export const reedsNear = stepped(function* (ctx: Ctx, W: number, H: number) {
  const r = rng(143);
  const back = wave(W, 71, [2, 5], [0.02, 0.008]);
  const by = (x: number) => H * (0.72 + back(x));
  fillBelow(ctx, W, by, H, '#a0c25c');
  stipple(ctx, W, 240, by, H * 0.16, ['#b4d16c', '#8fb24a', '#cbdf86'], H * 0.002, H * 0.004, r);
  yield;
  reedBed(ctx, W, 150, (x) => by(x) + H * 0.03, H * 0.1, H * 0.2, '#8aa84a', null, H * 0.0028, r);
  yield;
  const mid = wave(W, 72, [3, 7], [0.014, 0.006]);
  const my = (x: number) => H * (0.86 + mid(x));
  fillBelow(ctx, W, my, H, '#96b84e');
  reedBed(ctx, W, 140, my, H * 0.12, H * 0.26, '#a6c158', '#8a6a34', H * 0.0034, r);
  yield;
  reedBed(ctx, W, 90, () => H * 1.01, H * 0.16, H * 0.34, '#c2d46e', '#9c7a3c', H * 0.0042, r);
  haze(ctx, W, H * 0.58, H * 0.78, '246,242,206', 0.26, 0);
});
