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

export const THEMES: Record<ThemeId, Theme> = {
  garden: {
    id: 'garden',
    sky: ['#86ccff', '#c4eaff', '#fff2d2'],
    sun: { x: 0.78, y: 0.2, r: 0.07, core: '#fffbe6', glow: 'rgba(255,240,180,0.55)' },
    moon: false,
    stars: 0,
    clouds: { color: '#ffffff', alpha: 0.9, count: 7 },
    layers: [
      {
        fx: 0.12,
        fy: 0.05,
        period: 2.4,
        paint(ctx, W, H) {
          hills(ctx, W, H, 0.6, 0.06, '#bfe1d0', 11, 2);
          hills(ctx, W, H, 0.68, 0.05, '#a9d8bc', 12, 3);
        },
      },
      {
        fx: 0.32,
        fy: 0.12,
        period: 2.0,
        paint(ctx, W, H, r) {
          hills(ctx, W, H, 0.78, 0.06, '#8ccc8f', 21, 2);
          for (let i = 0; i < 14; i++) {
            const x = r() * W;
            roundTree(ctx, x, hillY(W, x, 0.78, 0.06, 21, 2) * H + 4, H * (0.08 + r() * 0.05), r() < 0.5 ? '#6bb877' : '#5aa86a', '#8a6a4a');
          }
          hills(ctx, W, H, 0.9, 0.04, '#78bf7c', 22, 4);
        },
      },
    ],
    ground: { top: '#7fd25c', topDark: '#58ad43', body: '#b57d4d', bodyDark: '#93603a', speck: '#cf9e6c', speck2: '#7d4f30' },
    stone: { face: '#d6cfc3', light: '#efe9df', dark: '#aaa195', line: '#8f877c' },
    plank: { top: '#dca36a', side: '#b77c45', dark: '#8c5a2e' },
    spikes: { a: '#3f7d3a', b: '#2b5a28' },
    tint: null,
    ambient: 'petals',
    ambientColor: ['#ffd1e1', '#ffffff', '#ffe7a8'],
    glow: 0.35,
    ink: '#2b2140',
  },
  woods: {
    id: 'woods',
    sky: ['#ffbe7d', '#ffd59a', '#fff0c8'],
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
          for (let i = 0; i < 70; i++) pine(ctx, r() * W, H * (0.66 + r() * 0.05), H * (0.18 + r() * 0.12), '#e8b090');
          ctx.fillStyle = '#e8b090';
          ctx.fillRect(0, H * 0.7, W, H * 0.3);
        },
      },
      {
        fx: 0.3,
        fy: 0.1,
        period: 1.8,
        paint(ctx, W, H, r) {
          for (let i = 0; i < 40; i++) pine(ctx, r() * W, H * (0.8 + r() * 0.04), H * (0.25 + r() * 0.15), '#c47c62');
          ctx.fillStyle = '#c47c62';
          ctx.fillRect(0, H * 0.82, W, H * 0.18);
          for (let i = 0; i < 9; i++) {
            const x = r() * W;
            const w = H * (0.03 + r() * 0.03);
            ctx.fillStyle = '#9a5a48';
            ctx.fillRect(x, 0, w, H);
            ctx.fillStyle = '#a8644f';
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
  },
  mill: {
    id: 'mill',
    sky: ['#8ccdff', '#cdeeff', '#fffaf0'],
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
          hills(ctx, W, H, 0.62, 0.08, '#b4cfe0', 31, 2);
          hills(ctx, W, H, 0.7, 0.05, '#a2c7b0', 32, 3);
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
            roundTree(ctx, x, hillY(W, x, 0.82, 0.04, 41, 2) * H + 4, H * (0.07 + r() * 0.04), '#6aae6c', '#7a5c40');
          }
        },
      },
    ],
    ground: { top: '#8fd06a', topDark: '#64aa4a', body: '#bdb6a8', bodyDark: '#98917f', speck: '#d6d0c4', speck2: '#857d6c' },
    stone: { face: '#c98d52', light: '#e3ab72', dark: '#9a6634', line: '#7a4c22' },
    plank: { top: '#cf9c63', side: '#a67340', dark: '#7a5026' },
    spikes: { a: '#7a8090', b: '#4f5462' },
    tint: null,
    ambient: 'motes',
    ambientColor: ['#ffffff', '#fff6c8'],
    glow: 0.35,
    ink: '#2a2238',
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
