import { rng, TAU } from '../core/math';
import type { ThemeId } from '../game/level';

export interface GroundPal {
  top: string;
  topDark: string;
  body: string;
  bodyDark: string;
  speck: string;
  speck2: string;
}

export interface Layer {
  /** horizontal parallax factor (0 = fixed to the screen, 1 = moves with the world) */
  fx: number;
  /** vertical parallax factor */
  fy: number;
  /** strip width as a multiple of the screen height */
  period: number;
  paint(ctx: CanvasRenderingContext2D, W: number, H: number, r: () => number): void;
}

export interface Theme {
  id: ThemeId;
  sky: [string, string, string];
  sun: { x: number; y: number; r: number; core: string; glow: string } | null;
  moon: boolean;
  stars: number;
  clouds: { color: string; alpha: number; count: number } | null;
  layers: Layer[];
  ground: GroundPal;
  stone: { face: string; light: string; dark: string; line: string };
  plank: { top: string; side: string; dark: string };
  spikes: { a: string; b: string };
  /** wash over everything (late light), or null */
  tint: string | null;
  ambient: 'petals' | 'leaves' | 'motes' | 'twinkle';
  ambientColor: string[];
  /** string glow strength (brighter at night) */
  glow: number;
  ink: string;
  /** the creek along the bottom of a level — the pits are water (see Session.drawWater); none if absent */
  water?: { top: string; bottom: string; light: string };
}

const hills = (ctx: CanvasRenderingContext2D, W: number, H: number, base: number, amp: number, color: string, seed: number, waves = 3) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  const r = rng(seed);
  const ph = [r() * TAU, r() * TAU, r() * TAU];
  for (let x = 0; x <= W; x += 8) {
    const u = (x / W) * TAU;
    const y = base - amp * (0.55 * Math.sin(u * waves + ph[0]) + 0.3 * Math.sin(u * waves * 2 + ph[1]) + 0.15 * Math.sin(u * waves * 5 + ph[2]));
    ctx.lineTo(x, y * H);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
};

/** Height of hills() at x, so trees can sit on them. */
const hillY = (W: number, x: number, base: number, amp: number, seed: number, waves = 3) => {
  const r = rng(seed);
  const ph = [r() * TAU, r() * TAU, r() * TAU];
  const u = (x / W) * TAU;
  return base - amp * (0.55 * Math.sin(u * waves + ph[0]) + 0.3 * Math.sin(u * waves * 2 + ph[1]) + 0.15 * Math.sin(u * waves * 5 + ph[2]));
};

const roundTree = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, leaf: string, trunk: string) => {
  ctx.fillStyle = trunk;
  ctx.fillRect(x - s * 0.08, y - s * 0.55, s * 0.16, s * 0.55);
  ctx.fillStyle = leaf;
  ctx.beginPath();
  ctx.arc(x, y - s * 0.75, s * 0.42, 0, TAU);
  ctx.arc(x - s * 0.28, y - s * 0.55, s * 0.3, 0, TAU);
  ctx.arc(x + s * 0.3, y - s * 0.58, s * 0.3, 0, TAU);
  ctx.fill();
};

const pine = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s * 0.32, y - s * 0.35);
  ctx.lineTo(x + s * 0.2, y - s * 0.38);
  ctx.lineTo(x + s * 0.4, y);
  ctx.lineTo(x - s * 0.4, y);
  ctx.lineTo(x - s * 0.2, y - s * 0.38);
  ctx.lineTo(x - s * 0.32, y - s * 0.35);
  ctx.closePath();
  ctx.fill();
};

function eiffel(ctx: CanvasRenderingContext2D, cx: number, base: number, h: number, color: string) {
  // a simple lattice silhouette: legs, arch, platforms, spire
  const w = h * 0.36;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, base);
  ctx.quadraticCurveTo(cx - w * 0.2, base - h * 0.35, cx - w * 0.07, base - h * 0.62);
  ctx.lineTo(cx - w * 0.035, base - h * 0.93);
  ctx.lineTo(cx, base - h);
  ctx.lineTo(cx + w * 0.035, base - h * 0.93);
  ctx.lineTo(cx + w * 0.07, base - h * 0.62);
  ctx.quadraticCurveTo(cx + w * 0.2, base - h * 0.35, cx + w / 2, base);
  ctx.lineTo(cx + w * 0.3, base);
  ctx.quadraticCurveTo(cx, base - h * 0.26, cx - w * 0.3, base);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(cx - w * 0.3, base - h * 0.3, w * 0.6, h * 0.025);
  ctx.fillRect(cx - w * 0.17, base - h * 0.58, w * 0.34, h * 0.02);
}

function buildings(ctx: CanvasRenderingContext2D, W: number, H: number, r: () => number, o: { base: number; minH: number; maxH: number; wall: string; roof: string; win: string; lit: string; litChance: number; chimney: string }) {
  let x = -10;
  while (x < W + 10) {
    const bw = H * (0.09 + r() * 0.08);
    const bh = H * (o.minH + r() * (o.maxH - o.minH));
    const top = H * o.base - bh;
    ctx.fillStyle = o.wall;
    ctx.fillRect(x, top, bw + 1, H - top);
    // mansard roof
    const rh = bh * 0.18;
    ctx.fillStyle = o.roof;
    ctx.beginPath();
    ctx.moveTo(x - 2, top);
    ctx.lineTo(x + bw * 0.08, top - rh);
    ctx.lineTo(x + bw * 0.92, top - rh);
    ctx.lineTo(x + bw + 2, top);
    ctx.closePath();
    ctx.fill();
    // chimneys
    const nc = 1 + Math.floor(r() * 3);
    for (let k = 0; k < nc; k++) {
      const cxp = x + bw * (0.15 + r() * 0.7);
      ctx.fillStyle = o.chimney;
      ctx.fillRect(cxp, top - rh - H * 0.03, H * 0.014, H * 0.03);
    }
    // windows
    const cols = Math.max(2, Math.floor(bw / (H * 0.03)));
    const rows = Math.max(2, Math.floor((bh * 0.8) / (H * 0.05)));
    const ww = (bw / cols) * 0.42;
    const wh = H * 0.024;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        ctx.fillStyle = r() < o.litChance ? o.lit : o.win;
        ctx.fillRect(x + (bw / cols) * (i + 0.29), top + bh * 0.1 + j * H * 0.05, ww, wh);
      }
    }
    x += bw + H * (0.005 + r() * 0.02);
  }
}

/** Colours for a waterfall painted into a backdrop (an empty `rock` paints no shoulder of rock behind it). */
interface FallPal {
  rock: string;
  moss?: string;
  water: string;
  light: string;
  mist: string;
}

/**
 * A waterfall in a backdrop layer: the broad shoulder of rock it comes over (broad, or a fall on a
 * narrow wedge of rock reads as a white pillar), moss along its lip, the falling sheet widening as it
 * drops with a few streaks in it, and a pool and mist where it lands. Painted once with the layer.
 */
const waterfall = (ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number, w: number, o: FallPal) => {
  const h = bottom - top;
  if (o.rock) {
    const span = Math.max(w * 5, h * 0.9);
    ctx.fillStyle = o.rock;
    ctx.beginPath();
    ctx.moveTo(x - span, bottom + h * 0.02);
    ctx.quadraticCurveTo(x - span * 0.95, top + h * 0.2, x - span * 0.45, top + h * 0.03);
    ctx.quadraticCurveTo(x, top - h * 0.04, x + span * 0.45, top + h * 0.01);
    ctx.quadraticCurveTo(x + span * 0.95, top + h * 0.25, x + span, bottom + h * 0.02);
    ctx.closePath();
    ctx.fill();
    if (o.moss) {
      ctx.strokeStyle = o.moss;
      ctx.lineWidth = Math.max(2, h * 0.045);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - span * 0.55, top + h * 0.05);
      ctx.quadraticCurveTo(x, top - h * 0.03, x + span * 0.55, top + h * 0.03);
      ctx.stroke();
    }
  }
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, o.light);
  g.addColorStop(1, o.water);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.55, top);
  ctx.quadraticCurveTo(x, top - w * 0.25, x + w * 0.55, top);
  ctx.lineTo(x + w * 0.8, bottom);
  ctx.lineTo(x - w * 0.8, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = o.light;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = Math.max(1, w * 0.07);
  for (let k = 0; k < 5; k++) {
    const u = (k + 0.5) / 5 - 0.5;
    ctx.beginPath();
    ctx.moveTo(x + u * w * 0.95, top + h * 0.04);
    ctx.lineTo(x + u * w * 1.5, bottom);
    ctx.stroke();
  }
  // the pool it lands in
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = o.light;
  ctx.beginPath();
  ctx.ellipse(x, bottom, w * 1.5, Math.max(2, w * 0.28), 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  const m = ctx.createRadialGradient(x, bottom, 0, x, bottom, w * 2.4);
  m.addColorStop(0, o.mist);
  m.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = m;
  ctx.fillRect(x - w * 2.4, bottom - w * 2.4, w * 4.8, w * 4.8);
};

/** A ridge with a rough, rocky top (hills() at a high frequency). */
const ridge = (ctx: CanvasRenderingContext2D, W: number, H: number, base: number, amp: number, color: string, seed: number) => hills(ctx, W, H, base, amp, color, seed, 7);

export const THEMES: Record<ThemeId, Theme> = {
  // the title: a yellow-green morning over a mossy creek (the creek, the fall and the banks themselves
  // are render/creek.ts — this is the sky and the woods behind them)
  creek: {
    id: 'creek',
    sky: ['#9fd4c4', '#d3ecbf', '#f4f1c8'],
    sun: { x: 0.2, y: 0.2, r: 0.065, core: '#fffbe2', glow: 'rgba(255,246,190,0.55)' },
    moon: false,
    stars: 0,
    clouds: { color: '#fbfff0', alpha: 0.55, count: 4 },
    layers: [
      {
        fx: 0.04,
        fy: 0.02,
        period: 2.4,
        paint(ctx, W, H) {
          hills(ctx, W, H, 0.5, 0.05, '#d2e6b2', 31, 2);
          hills(ctx, W, H, 0.57, 0.05, '#bfdb9c', 32, 3);
        },
      },
      {
        fx: 0.1,
        fy: 0.05,
        period: 2.2,
        paint(ctx, W, H, r) {
          hills(ctx, W, H, 0.62, 0.04, '#a6cb72', 41, 3);
          for (let i = 0; i < 26; i++) {
            const x = r() * W;
            roundTree(ctx, x, hillY(W, x, 0.62, 0.04, 41, 3) * H + 6, H * (0.12 + r() * 0.08), ['#9cc65c', '#adcf66', '#8dbb52'][Math.floor(r() * 3)], '#6f5d3e');
          }
          hills(ctx, W, H, 0.7, 0.03, '#86b24f', 42, 4);
          for (let i = 0; i < 30; i++) {
            const x = r() * W;
            roundTree(ctx, x, hillY(W, x, 0.7, 0.03, 42, 4) * H + 8, H * (0.14 + r() * 0.1), ['#7aaa45', '#6c9c3e', '#88b84c'][Math.floor(r() * 3)], '#5e4e34');
          }
        },
      },
    ],
    ground: { top: '#a8cc4a', topDark: '#7fa83a', body: '#6b5236', bodyDark: '#54402a', speck: '#86a346', speck2: '#4d3a26' },
    stone: { face: '#8d9a83', light: '#aab69f', dark: '#6d7a63', line: '#56614e' },
    plank: { top: '#dca36a', side: '#b77c45', dark: '#8c5a2e' },
    spikes: { a: '#3f7d3a', b: '#2b5a28' },
    tint: null,
    ambient: 'motes',
    ambientColor: ['#e8f59a', '#ffffff', '#c8e86a'],
    glow: 0.35,
    ink: '#24331c',
  },
  // 1 · Mossy Creek: a yellow-green morning, the hills streaked with far-off falls
  garden: {
    id: 'garden',
    sky: ['#9fd6c6', '#d2ecc0', '#f6f2cc'],
    sun: { x: 0.78, y: 0.18, r: 0.065, core: '#fffbe2', glow: 'rgba(255,246,190,0.55)' },
    moon: false,
    stars: 0,
    clouds: { color: '#fbfff0', alpha: 0.75, count: 6 },
    layers: [
      {
        fx: 0.12,
        fy: 0.05,
        period: 2.4,
        paint(ctx, W, H) {
          hills(ctx, W, H, 0.58, 0.06, '#cfe5b2', 11, 2);
          const far = { rock: '#a9bd96', moss: '#bcd98c', water: '#d7efe6', light: '#ffffff', mist: 'rgba(255,255,255,0.5)' };
          waterfall(ctx, W * 0.28, H * 0.47, H * 0.66, H * 0.036, far);
          waterfall(ctx, W * 0.72, H * 0.45, H * 0.64, H * 0.03, far);
          hills(ctx, W, H, 0.66, 0.05, '#b9d99a', 12, 3);
        },
      },
      {
        fx: 0.32,
        fy: 0.12,
        period: 2.0,
        paint(ctx, W, H, r) {
          hills(ctx, W, H, 0.78, 0.06, '#9cc865', 21, 2);
          for (let i = 0; i < 14; i++) {
            const x = r() * W;
            roundTree(ctx, x, hillY(W, x, 0.78, 0.06, 21, 2) * H + 4, H * (0.08 + r() * 0.05), ['#8cc052', '#9dcc5c', '#7ab048'][Math.floor(r() * 3)], '#7a5c3c');
          }
          hills(ctx, W, H, 0.9, 0.04, '#86b94f', 22, 4);
        },
      },
    ],
    ground: { top: '#9fd15a', topDark: '#74a843', body: '#8c6a45', bodyDark: '#6f5234', speck: '#a5c75a', speck2: '#5e4630' },
    stone: { face: '#9aa592', light: '#b9c3ae', dark: '#727d6b', line: '#5d6757' },
    plank: { top: '#dca36a', side: '#b77c45', dark: '#8c5a2e' },
    spikes: { a: '#3f7d3a', b: '#2b5a28' },
    tint: null,
    ambient: 'petals',
    ambientColor: ['#f6ffd8', '#ffffff', '#e6f5a0'],
    glow: 0.35,
    ink: '#24331c',
    water: { top: '#6fa88f', bottom: '#3f7d82', light: '#e4f7ee' },
  },
  // 2 · Fern Falls: golden hour in the pines, a tall fall between them
  woods: {
    id: 'woods',
    sky: ['#ffc98a', '#ffe2a8', '#f1efbf'],
    sun: { x: 0.2, y: 0.42, r: 0.09, core: '#fff3cf', glow: 'rgba(255,200,120,0.6)' },
    moon: false,
    stars: 0,
    clouds: { color: '#fff1dc', alpha: 0.6, count: 4 },
    layers: [
      {
        fx: 0.1,
        fy: 0.05,
        period: 2.2,
        paint(ctx, W, H, r) {
          for (let i = 0; i < 60; i++) pine(ctx, r() * W, H * (0.66 + r() * 0.05), H * (0.18 + r() * 0.12), '#d6c58e');
          waterfall(ctx, W * 0.55, H * 0.36, H * 0.7, H * 0.05, { rock: '#c2a97c', moss: '#cfc480', water: '#fff1d0', light: '#ffffff', mist: 'rgba(255,248,230,0.55)' });
          ctx.fillStyle = '#d6c58e';
          ctx.fillRect(0, H * 0.7, W, H * 0.3);
        },
      },
      {
        fx: 0.3,
        // Held still vertically. Its trunks and canopy run off the top of the screen, and the old
        // version of this layer slid down as the camera climbed, which opened a band of sky above a
        // flat-topped wood (found in the 2026-11-21 review).
        fy: 0,
        period: 1.8,
        paint(ctx, W, H, r) {
          for (let i = 0; i < 40; i++) pine(ctx, r() * W, H * (0.8 + r() * 0.04), H * (0.25 + r() * 0.15), '#aaa45e');
          ctx.fillStyle = '#aaa45e';
          ctx.fillRect(0, H * 0.82, W, H * 0.18);
          for (let i = 0; i < 9; i++) {
            const x = r() * W;
            const w = H * (0.03 + r() * 0.03);
            ctx.fillStyle = '#7d5a3e';
            ctx.fillRect(x, 0, w, H);
            ctx.fillStyle = '#8fa548';
            ctx.beginPath();
            ctx.arc(x + w / 2, H * 0.12, H * 0.16, 0, TAU);
            ctx.fill();
          }
        },
      },
    ],
    ground: { top: '#a7cf55', topDark: '#7ea33c', body: '#7a5038', bodyDark: '#5d3b28', speck: '#94654a', speck2: '#4b2f20' },
    stone: { face: '#9b6a45', light: '#bb875c', dark: '#72492d', line: '#5a3820' },
    plank: { top: '#c98f5a', side: '#9e6a3a', dark: '#734a25' },
    spikes: { a: '#5a3a5a', b: '#3d2640' },
    tint: 'rgba(255,170,90,0.07)',
    ambient: 'leaves',
    ambientColor: ['#f0953f', '#e86f3a', '#f7c45a'],
    glow: 0.45,
    ink: '#2b1a24',
    water: { top: '#8fae7e', bottom: '#4e7f78', light: '#fff1d8' },
  },
  // 3 · The Old Mill: an afternoon by the millrace, the fall that turns the wheel behind the village
  mill: {
    id: 'mill',
    sky: ['#8fd2e6', '#d0eee4', '#fbf8e6'],
    sun: { x: 0.62, y: 0.16, r: 0.06, core: '#ffffff', glow: 'rgba(255,250,220,0.5)' },
    moon: false,
    stars: 0,
    clouds: { color: '#ffffff', alpha: 0.85, count: 6 },
    layers: [
      {
        fx: 0.1,
        fy: 0.05,
        period: 2.4,
        paint(ctx, W, H) {
          hills(ctx, W, H, 0.62, 0.08, '#bcd8c4', 31, 2);
          waterfall(ctx, W * 0.36, H * 0.46, H * 0.7, H * 0.04, { rock: '#9fb8a4', moss: '#b4d39a', water: '#e2f3f4', light: '#ffffff', mist: 'rgba(255,255,255,0.5)' });
          hills(ctx, W, H, 0.7, 0.05, '#a6cf9e', 32, 3);
        },
      },
      {
        fx: 0.3,
        fy: 0.12,
        period: 2.2,
        paint(ctx, W, H, r) {
          hills(ctx, W, H, 0.82, 0.04, '#94c48f', 41, 2);
          // a few cottages with tiled roofs
          for (let i = 0; i < 6; i++) {
            const x = r() * W;
            const y = hillY(W, x, 0.82, 0.04, 41, 2) * H + 2;
            const w = H * (0.07 + r() * 0.04);
            ctx.fillStyle = '#f2e6d0';
            ctx.fillRect(x, y - w * 0.6, w, w * 0.6);
            ctx.fillStyle = '#c86d50';
            ctx.beginPath();
            ctx.moveTo(x - w * 0.1, y - w * 0.6);
            ctx.lineTo(x + w / 2, y - w * 1.05);
            ctx.lineTo(x + w * 1.1, y - w * 0.6);
            ctx.fill();
            ctx.fillStyle = '#6f88a8';
            ctx.fillRect(x + w * 0.2, y - w * 0.42, w * 0.16, w * 0.16);
          }
          for (let i = 0; i < 10; i++) {
            const x = r() * W;
            roundTree(ctx, x, hillY(W, x, 0.82, 0.04, 41, 2) * H + 4, H * (0.07 + r() * 0.04), ['#7fb865', '#8cc052'][Math.floor(r() * 2)], '#7a5c40');
          }
        },
      },
    ],
    ground: { top: '#9cd15c', topDark: '#6fab45', body: '#bdb6a8', bodyDark: '#98917f', speck: '#d6d0c4', speck2: '#857d6c' },
    stone: { face: '#c98d52', light: '#e3ab72', dark: '#9a6634', line: '#7a4c22' },
    plank: { top: '#cf9c63', side: '#a67340', dark: '#7a5026' },
    spikes: { a: '#7a8090', b: '#4f5462' },
    tint: null,
    ambient: 'motes',
    ambientColor: ['#ffffff', '#fff6c8'],
    glow: 0.35,
    ink: '#2a2238',
    water: { top: '#6aa6a6', bottom: '#3a7488', light: '#e8f6f6' },
  },
  // 4 · The Cascades: a sunset cliff the water comes down in steps
  cascade: {
    id: 'cascade',
    sky: ['#f29a7c', '#ffcf9e', '#f6eebf'],
    sun: { x: 0.72, y: 0.5, r: 0.1, core: '#fff0c0', glow: 'rgba(255,180,120,0.55)' },
    moon: false,
    stars: 0,
    clouds: { color: '#ffd6c4', alpha: 0.55, count: 5 },
    layers: [
      {
        fx: 0.06,
        fy: 0.03,
        period: 2.6,
        paint(ctx, W, H) {
          hills(ctx, W, H, 0.5, 0.05, '#dfa58e', 51, 3);
          ridge(ctx, W, H, 0.58, 0.035, '#c98c74', 52);
          const fall = { rock: '#a8705e', moss: '#a7a35a', water: '#ffe6d2', light: '#fff8ee', mist: 'rgba(255,240,230,0.55)' };
          for (const [fx, top, w] of [
            [0.18, 0.5, 0.04],
            [0.47, 0.44, 0.055],
            [0.76, 0.52, 0.036],
          ]) {
            waterfall(ctx, W * fx, H * top, H * 0.75, H * w, fall);
          }
          ctx.fillStyle = '#b07a64';
          ctx.fillRect(0, H * 0.75, W, H * 0.25);
        },
      },
      {
        fx: 0.24,
        fy: 0.08,
        period: 2.0,
        paint(ctx, W, H, r) {
          hills(ctx, W, H, 0.84, 0.05, '#7f8a52', 61, 3);
          for (let i = 0; i < 12; i++) {
            const x = r() * W;
            roundTree(ctx, x, hillY(W, x, 0.84, 0.05, 61, 3) * H + 4, H * (0.1 + r() * 0.06), ['#7f9a4a', '#8fa852', '#6f8a40'][Math.floor(r() * 3)], '#5e4634');
          }
        },
      },
    ],
    ground: { top: '#b4c95a', topDark: '#86a343', body: '#8a6b55', bodyDark: '#6d5243', speck: '#a88a6e', speck2: '#5a4334' },
    stone: { face: '#a7998a', light: '#c7b9a8', dark: '#7d6f62', line: '#5f544a' },
    plank: { top: '#d09a62', side: '#a8743f', dark: '#7a5026' },
    spikes: { a: '#4d6b2f', b: '#34501f' },
    tint: 'rgba(255,140,90,0.06)',
    ambient: 'leaves',
    ambientColor: ['#ffb36b', '#ff8f6b', '#ffd58a'],
    glow: 0.55,
    ink: '#3a2230',
    water: { top: '#c79a8a', bottom: '#5a7a86', light: '#fff0e4' },
  },
  // 5 · The Great Falls: a climb by moonlight beside a fall the height of the sky
  falls: {
    id: 'falls',
    sky: ['#0b1330', '#1b2d55', '#2f5068'],
    sun: null,
    moon: true,
    stars: 140,
    clouds: { color: '#5a6a9a', alpha: 0.3, count: 4 },
    layers: [
      {
        fx: 0.05,
        // held still vertically, so the fall stays beside you all the way up the climb
        fy: 0,
        period: 2.6,
        paint(ctx, W, H, r) {
          // the cliff, the height of the screen, with ragged edges
          ctx.fillStyle = '#1c2a3c';
          ctx.beginPath();
          ctx.moveTo(W * 0.22, H);
          for (let y = H; y >= 0; y -= H / 14) ctx.lineTo(W * (0.24 + (r() - 0.5) * 0.04), y);
          for (let y = 0; y <= H; y += H / 14) ctx.lineTo(W * (0.76 + (r() - 0.5) * 0.04), y);
          ctx.closePath();
          ctx.fill();
          // moonlit moss on its ledges
          ctx.fillStyle = '#34503a';
          for (let i = 0; i < 26; i++) {
            ctx.beginPath();
            ctx.ellipse(W * (0.26 + r() * 0.48), H * r(), H * (0.02 + r() * 0.03), H * 0.008, 0, 0, TAU);
            ctx.fill();
          }
          // the fall, pale in the moonlight, and two threads beside it
          const fall = { rock: '', water: 'rgba(150,196,214,0.92)', light: 'rgba(222,240,248,0.95)', mist: 'rgba(200,225,240,0.35)' };
          waterfall(ctx, W * 0.5, H * 0.02, H * 1.02, H * 0.09, fall);
          waterfall(ctx, W * 0.33, H * 0.25, H * 1.02, H * 0.02, fall);
          waterfall(ctx, W * 0.66, H * 0.4, H * 1.02, H * 0.016, fall);
        },
      },
      {
        fx: 0.2,
        fy: 0,
        period: 2.0,
        paint(ctx, W, H, r) {
          for (let i = 0; i < 26; i++) pine(ctx, r() * W, H * (0.98 + r() * 0.04), H * (0.16 + r() * 0.14), '#121d2e');
        },
      },
    ],
    ground: { top: '#5f8f4a', topDark: '#466e38', body: '#3b3a4a', bodyDark: '#2d2c3a', speck: '#4d4c5e', speck2: '#26252f' },
    stone: { face: '#4b5563', light: '#667080', dark: '#353d4a', line: '#2a303a' },
    plank: { top: '#8a6a4a', side: '#6e5236', dark: '#4e3a26' },
    spikes: { a: '#3a5a3a', b: '#263c26' },
    tint: 'rgba(80,110,200,0.06)',
    ambient: 'twinkle',
    ambientColor: ['#e8f59a', '#c8f0ff', '#ffffff'],
    glow: 0.85,
    ink: '#14182e',
    water: { top: '#3d6680', bottom: '#162a42', light: '#cfe6f2' },
  },
  paris: {
    id: 'paris',
    sky: ['#5d4c9e', '#ff8fa6', '#ffc785'],
    sun: { x: 0.3, y: 0.66, r: 0.1, core: '#fff0c0', glow: 'rgba(255,170,120,0.55)' },
    moon: false,
    stars: 18,
    clouds: { color: '#ffd0d8', alpha: 0.55, count: 5 },
    layers: [
      {
        fx: 0.06,
        fy: 0.03,
        period: 2.6,
        paint(ctx, W, H, r) {
          ctx.fillStyle = '#8a64a8';
          ctx.fillRect(0, H * 0.74, W, H);
          buildings(ctx, W, H, r, { base: 0.78, minH: 0.04, maxH: 0.12, wall: '#8a64a8', roof: '#7a578f', win: '#8a64a8', lit: '#ffd58a', litChance: 0.12, chimney: '#7a578f' });
          // domes
          ctx.fillStyle = '#7a578f';
          ctx.beginPath();
          ctx.arc(W * 0.18, H * 0.7, H * 0.05, Math.PI, 0);
          ctx.fill();
          ctx.fillRect(W * 0.18 - 2, H * 0.6, 4, H * 0.06);
          eiffel(ctx, W * 0.62, H * 0.76, H * 0.52, '#6f4c88');
        },
      },
      {
        fx: 0.22,
        fy: 0.08,
        period: 2.0,
        paint(ctx, W, H, r) {
          buildings(ctx, W, H, r, { base: 0.88, minH: 0.12, maxH: 0.26, wall: '#c99ab0', roof: '#7d6a96', win: '#9a7a9e', lit: '#ffdc8f', litChance: 0.3, chimney: '#b0705e' });
        },
      },
    ],
    ground: { top: '#8c9fb8', topDark: '#6b7f9a', body: '#efdcc2', bodyDark: '#d3bd9f', speck: '#5d6c8c', speck2: '#ffd98a' },
    stone: { face: '#c8644c', light: '#e0846a', dark: '#9c4836', line: '#7c3628' },
    plank: { top: '#4a4660', side: '#35324a', dark: '#26243a' },
    spikes: { a: '#3d3b55', b: '#26243a' },
    tint: 'rgba(255,120,140,0.06)',
    ambient: 'motes',
    ambientColor: ['#ffe2a8', '#ffc3d0'],
    glow: 0.6,
    ink: '#2a1d36',
  },
  tower: {
    id: 'tower',
    sky: ['#060a22', '#18205a', '#3b2f74'],
    sun: null,
    moon: true,
    stars: 140,
    clouds: { color: '#5a5a9a', alpha: 0.35, count: 4 },
    layers: [
      {
        fx: 0.05,
        fy: 0.2,
        period: 2.6,
        paint(ctx, W, H, r) {
          // Paris far below: a carpet of lights
          const g = ctx.createLinearGradient(0, H * 0.7, 0, H);
          g.addColorStop(0, 'rgba(20,24,60,0)');
          g.addColorStop(0.3, '#141a40');
          g.addColorStop(1, '#0d1130');
          ctx.fillStyle = g;
          ctx.fillRect(0, H * 0.7, W, H * 0.3);
          for (let i = 0; i < 900; i++) {
            const y = H * (0.8 + Math.pow(r(), 0.7) * 0.2);
            ctx.fillStyle = r() < 0.75 ? 'rgba(255,214,140,0.8)' : 'rgba(200,220,255,0.75)';
            const s = 1 + r() * 1.6 * ((y / H - 0.78) * 4);
            ctx.fillRect(r() * W, y, s, s);
          }
          // the river, a ribbon of light
          ctx.strokeStyle = 'rgba(140,160,255,0.25)';
          ctx.lineWidth = H * 0.012;
          ctx.beginPath();
          for (let x = 0; x <= W; x += 10) ctx.lineTo(x, H * (0.9 + 0.03 * Math.sin((x / W) * TAU * 2)));
          ctx.stroke();
        },
      },
    ],
    ground: { top: '#a8865e', topDark: '#7c6044', body: '#5e4a3a', bodyDark: '#463628', speck: '#c9a272', speck2: '#2f241b' },
    stone: { face: '#6e5a48', light: '#937a60', dark: '#4e3f32', line: '#3a2e24' },
    plank: { top: '#9c7c58', side: '#6e563e', dark: '#4a3a2a' },
    spikes: { a: '#7a6a5a', b: '#4a3a2e' },
    tint: null,
    ambient: 'twinkle',
    ambientColor: ['#fff6d8', '#ffe08a', '#ffffff'],
    glow: 0.9,
    ink: '#120d24',
  },
};
