import { clamp, TAU } from '../core/math';
import { BIRD_COLORS, type Bird } from '../game/bird';
import type { Pt } from '../game/level';
import { ROPE_LEN, T } from '../game/tuning';
import { heartPath } from './particles';
import { canvasEpoch } from './renderer';
import type { Theme } from './theme';

export type BirdColor = (typeof BIRD_COLORS)[number];

const glowCache = new Map<string, HTMLCanvasElement>();
let glowEpoch = 0;

/** A soft round glow, rendered once per color: drawn as a scaled image instead of a fresh gradient each frame. */
function glowSprite(rgb: string) {
  if (glowEpoch !== canvasEpoch) {
    glowCache.clear();
    glowEpoch = canvasEpoch;
  }
  let c = glowCache.get(rgb);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, `rgba(${rgb},1)`);
  rg.addColorStop(0.45, `rgba(${rgb},0.45)`);
  rg.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(rgb, c);
  return c;
}

/** Draw a glow of radius r at (x, y), at opacity a. */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number) {
  if (a <= 0.01) return;
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(glowSprite(rgb), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

export const hexRgb = (hex: string) => `${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)}`;

export const PLATE_COLORS = ['#ffcf4a', '#4ad3c9', '#ff7fb0'];

// ------------------------------------------------------------------ hats (drawn on the sprouts: see sprouts.ts)

export function drawHat(ctx: CanvasRenderingContext2D, hat: string, ink: string) {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ink;
  switch (hat) {
    case 'beret':
      ctx.fillStyle = '#d6334a';
      ctx.beginPath();
      ctx.ellipse(0, -12, 10, 4.2, -0.12, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(1, -16);
      ctx.lineTo(1.6, -19);
      ctx.stroke();
      break;
    case 'flower': {
      const cs = ['#ff8fb1', '#ffd45a', '#ffffff', '#b48cff', '#ff8fb1'];
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = cs[k];
        ctx.beginPath();
        ctx.arc(-8 + k * 4, -11 - Math.sin((k / 4) * Math.PI) * 3, 2.6, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'acorn':
      ctx.fillStyle = '#9a6a3a';
      ctx.beginPath();
      ctx.ellipse(0, -11, 9, 5, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -16);
      ctx.lineTo(1, -19.5);
      ctx.stroke();
      break;
    case 'straw':
      ctx.fillStyle = '#f2d27a';
      ctx.beginPath();
      ctx.ellipse(0, -11, 13, 2.8, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, -13, 6.5, 4.5, 0, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e0605a';
      ctx.fillRect(-6.4, -13.5, 12.8, 2);
      break;
    case 'star': {
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 2.6 : 6;
        const a = -Math.PI / 2 + (k / 10) * TAU;
        ctx.lineTo(Math.cos(a) * r, -17 + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
}

/** A speech bubble above a bird: a heart, a "!" or a "…" (menu open). */
export function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, kind: 'heart' | 'hey' | 'menu', age: number, ink: string) {
  const pop = Math.min(1, age * 7);
  const s = 0.6 + 0.4 * pop + Math.sin(Math.min(1, age * 4) * Math.PI) * 0.15;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.roundRect(-11, -11, 22, 18, 7);
  ctx.moveTo(-3, 7);
  ctx.lineTo(0, 12);
  ctx.lineTo(3, 7);
  ctx.fill();
  ctx.stroke();
  if (kind === 'heart') {
    ctx.fillStyle = '#ff5d8f';
    heartPath(ctx, 0, -2, 11);
    ctx.fill();
  } else if (kind === 'hey') {
    ctx.fillStyle = '#ff8a2a';
    ctx.fillRect(-1.6, -8, 3.2, 8);
    ctx.beginPath();
    ctx.arc(0, 3, 1.8, 0, TAU);
    ctx.fill();
  } else {
    ctx.fillStyle = ink;
    for (let k = -1; k <= 1; k++) {
      ctx.globalAlpha = 0.4 + 0.6 * ((Math.floor(age * 3) + k + 1) % 3 === 0 ? 1 : 0.4);
      ctx.beginPath();
      ctx.arc(k * 5, -2, 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ------------------------------------------------------------------ the string

// the vine's drawn path, kept as flat coordinates and reused: it is rebuilt every frame, and a
// fresh point object per bend used to be the heaviest allocation in the renderer
const ropeX: number[] = [];
const ropeY: number[] = [];
const ropeAcc: number[] = [];
let ropeN = 0;

/**
 * The string along its path (bird → bends → bird), sagging when slack, with a wave running along it
 * after a tug. Colored from one bird's color to the other's.
 */
export function drawRope(ctx: CanvasRenderingContext2D, path: readonly Pt[], total: number, colA: string, colB: string, tension: number, twang: number, twangFrom: 0 | 1, t: number, glow: number, solid?: (x: number, y: number) => boolean) {
  ropeN = 0;
  ropeAcc.length = 0;
  const slack = clamp(ROPE_LEN - total, 0, 70) * 0.5;
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i];
    const q = path[i + 1];
    const L = Math.hypot(q.x - p.x, q.y - p.y);
    const d = total > 0 ? (slack * L) / total : 0;
    let sag = Math.min(L * 0.55, Math.sqrt((3 * L * d) / 8));
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    // a slack string drapes on the ground, it doesn't sink into it
    if (solid && sag > 2) {
      for (let k = 2; k <= sag + 2; k += 3) {
        if (solid(mx, my + k)) {
          sag = Math.max(0, k - 3);
          break;
        }
      }
    }
    const cx = mx;
    const cy = my + sag * 2;
    const n = Math.max(2, Math.min(16, Math.round(L / 9)));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const u = k / n;
      const a = (1 - u) * (1 - u);
      const bb = 2 * (1 - u) * u;
      const c = u * u;
      ropeX[ropeN] = a * p.x + bb * cx + c * q.x;
      ropeY[ropeN] = a * p.y + bb * cy + c * q.y;
      ropeAcc[ropeN] = acc + u * L;
      ropeN++;
    }
    acc += L;
  }
  // tug wave: a bump traveling from the tugger's end
  if (twang > 0.01 && ropeN > 2) {
    const front = (1 - twang) * acc * 1.4;
    for (let i = 1; i < ropeN - 1; i++) {
      const s = twangFrom === 0 ? ropeAcc[i] : acc - ropeAcc[i];
      const env = Math.exp(-(((s - front) / 26) ** 2)) * twang;
      if (env < 0.01) continue;
      const dx = ropeX[i + 1] - ropeX[i - 1];
      const dy = ropeY[i + 1] - ropeY[i - 1];
      const l = Math.hypot(dx, dy) || 1;
      const off = Math.sin(s * 0.25 - t * 30) * 7 * env;
      ropeX[i] -= (dy / l) * off;
      ropeY[i] += (dx / l) * off;
    }
  }
  // a vine: a soft glow in the two players' colours, a green stem, and little leaves along it
  const a = path[0];
  const z = path[path.length - 1];
  const grad = ctx.createLinearGradient(a.x, a.y, z.x, z.y);
  grad.addColorStop(0, colA);
  grad.addColorStop(1, colB);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ropeX[0], ropeY[0]);
  for (let i = 1; i < ropeN; i++) ctx.lineTo(ropeX[i], ropeY[i]);
  ctx.strokeStyle = grad;
  ctx.globalAlpha = 0.14 + glow * 0.2 + tension * 0.12;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = VINE_DARK;
  ctx.lineWidth = 3.4 + tension * 0.4;
  ctx.stroke();
  ctx.strokeStyle = VINE;
  ctx.lineWidth = 1.7 + tension * 0.3;
  ctx.stroke();
  // a twist along it, and a leaf every so often (alternating sides, swaying)
  ctx.lineWidth = 1;
  let next = 14;
  let side = 1;
  for (let i = 1; i < ropeN; i++) {
    if (ropeAcc[i] < next || ropeAcc[i] > acc - 10) continue;
    next = ropeAcc[i] + 22;
    const ang = Math.atan2(ropeY[i] - ropeY[i - 1], ropeX[i] - ropeX[i - 1]) + side * (1.0 + Math.sin(t * 2.6 + i) * 0.18);
    ctx.save();
    ctx.translate(ropeX[i], ropeY[i]);
    ctx.rotate(ang);
    ctx.fillStyle = side > 0 ? '#a8d64a' : '#95c63e';
    ctx.strokeStyle = VINE_DARK;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(4, -3.2, 8.5, 0);
    ctx.quadraticCurveTo(4, 3.2, 0, 0);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    side = -side;
  }
}

const VINE = '#8cc63f';
const VINE_DARK = '#4a7a1c';

/** The vine's end curling loose from a sprout whose partner is away (from its knot). */
export function drawLooseEnd(ctx: CanvasRenderingContext2D, b: Bird, _col: string, t: number) {
  const y = b.y + b.ropeOff;
  const sway = Math.sin(t * 2) * 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(b.x, y);
  ctx.quadraticCurveTo(b.x - b.facing * 9 + sway, y + 10, b.x - b.facing * 3 + sway * 1.5, y + 18);
  ctx.quadraticCurveTo(b.x + b.facing * 2 + sway, y + 22, b.x + b.facing * 1 + sway, y + 17);
  ctx.strokeStyle = VINE_DARK;
  ctx.lineWidth = 3.2;
  ctx.stroke();
  ctx.strokeStyle = VINE;
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

// ------------------------------------------------------------------ props

export function drawPeg(ctx: CanvasRenderingContext2D, x: number, y: number, th: Theme, t: number, used: boolean) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.5 + x * 0.01);
  ctx.fillStyle = `rgba(255,240,190,${0.1 + pulse * 0.12 + (used ? 0.15 : 0)})`;
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, TAU);
  ctx.fill();
  if (th.id === 'woods') {
    ctx.fillStyle = th.stone.dark;
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y, 5.5, 4.5, 0.3, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#9ccf5a';
    ctx.beginPath();
    ctx.ellipse(x + 5, y - 5, 4, 2, -0.6, 0, TAU);
    ctx.fill();
    return;
  }
  const metal = th.id === 'paris' || th.id === 'tower' ? '#c9a46a' : '#e8b44a';
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = metal;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = th.ink;
  ctx.beginPath();
  ctx.arc(x, y - 5.5, 2.2, 0, TAU);
  ctx.fill();
}

export function drawSeed(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, i: number) {
  const bob = Math.sin(t * 3 + i * 1.3) * 2;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(0.5 + Math.sin(t * 2 + i) * 0.2);
  ctx.fillStyle = '#f5c75a';
  ctx.strokeStyle = '#9b6420';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.6, 5.4, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(-1, -1.6, 1, 1.8, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}


/** A firefly (three hide in every level): a soft yellow-green glow, wandering a little, wings a-flicker. */
export function drawFirefly(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const fx = x + Math.sin(t * 1.3 + x * 0.05) * 5;
  const fy = y + Math.sin(t * 2.2) * 4;
  const pulse = 0.65 + 0.35 * Math.sin(t * 4.1 + x);
  glow(ctx, fx, fy, 40, '210,255,110', 0.4 + 0.3 * pulse);
  glow(ctx, fx, fy + 5, 15, '250,255,190', 0.85 * pulse + 0.15);
  ctx.save();
  ctx.translate(fx, fy);
  ctx.rotate(Math.sin(t * 1.7) * 0.25);
  ctx.scale(1.6, 1.6);
  // wings, a blur of flicker
  ctx.fillStyle = 'rgba(235,250,255,0.75)';
  const wing = 3.8 + Math.abs(Math.sin(t * 38)) * 1.6;
  ctx.beginPath();
  ctx.ellipse(-3, -4, wing, 2.2, -0.5, 0, TAU);
  ctx.ellipse(3, -4, wing, 2.2, 0.5, 0, TAU);
  ctx.fill();
  // body, and the glowing tail
  ctx.fillStyle = '#3b3550';
  ctx.beginPath();
  ctx.ellipse(0, -2, 2.6, 3.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = `rgba(226,255,120,${0.75 + 0.25 * pulse})`;
  ctx.beginPath();
  ctx.ellipse(0, 3, 3.1, 3.6, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A spring sitting on the floor of tile center (x, y); `comp` > 0 right after a bounce. */
export function drawSpring(ctx: CanvasRenderingContext2D, x: number, y: number, comp: number, th: Theme) {
  const base = y + T / 2;
  const k = comp > 0 ? Math.sin((1 - comp / 0.35) * Math.PI * 3) * (comp / 0.35) : 0;
  const h = 14 * (1 - k * 0.45);
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 1.6;
  if (th.id === 'paris') {
    // a striped café awning, bouncy
    ctx.save();
    ctx.translate(x, base - h);
    ctx.fillStyle = '#7a3a3a';
    ctx.fillRect(-12, 0, 2, h);
    ctx.fillRect(10, 0, 2, h);
    for (let s = 0; s < 6; s++) {
      ctx.fillStyle = s % 2 ? '#ffffff' : '#e0414f';
      ctx.fillRect(-15 + s * 5, -4, 5, 7);
    }
    ctx.strokeRect(-15, -4, 30, 7);
    ctx.restore();
    return;
  }
  if (th.id === 'garden' || th.id === 'woods') {
    // a bouncy blossom
    ctx.fillStyle = '#5aa84a';
    ctx.fillRect(x - 1.5, base - h, 3, h);
    ctx.save();
    ctx.translate(x, base - h);
    ctx.scale(1 + k * 0.3, 1 - k * 0.3);
    ctx.fillStyle = th.id === 'woods' ? '#ff9a4a' : '#ff7fb0';
    ctx.beginPath();
    ctx.moveTo(-13, -1);
    ctx.quadraticCurveTo(-11, -9, -5, -7);
    ctx.quadraticCurveTo(0, -12, 5, -7);
    ctx.quadraticCurveTo(11, -9, 13, -1);
    ctx.quadraticCurveTo(0, 5, -13, -1);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffe680';
    ctx.beginPath();
    ctx.ellipse(0, -3, 5, 2.2, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }
  // a coil spring with a plate
  ctx.strokeStyle = '#8a8fa0';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) ctx.lineTo(x + (i % 2 ? 7 : -7), base - (i / 8) * h);
  ctx.stroke();
  ctx.fillStyle = '#e0505a';
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 12, base - h - 4, 24, 5, 2);
  ctx.fill();
  ctx.stroke();
}

export function drawPlate(ctx: CanvasRenderingContext2D, tx: number, ty: number, down: boolean, group: number, ink: string, heavy = false) {
  const x = tx * T;
  const y = ty * T + T;
  const c = PLATE_COLORS[group] ?? '#fff';
  ctx.fillStyle = '#5a5468';
  ctx.beginPath();
  ctx.roundRect(x + 2, y - 4, T - 4, 4, 2);
  ctx.fill();
  const h = down ? 2 : 5;
  if (down) {
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(x + T / 2, y - 4, 18, 7, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = c;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x + 5, y - 4 - h, T - 10, h + 1, 2);
  ctx.fill();
  ctx.stroke();
  // a heavy plate takes the tall sprout's weight: a stone slab on a thicker frame, so you can tell
  // at a glance which of you has to stand on it
  if (heavy) {
    ctx.fillStyle = '#6f6a7d';
    ctx.beginPath();
    ctx.roundRect(x + 3, y - 6 - h, T - 6, 3, 1.5);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + T / 2 - 4, y - 8 - h);
    ctx.lineTo(x + T / 2 + 4, y - 8 - h);
    ctx.stroke();
  }
}

export function drawDoor(ctx: CanvasRenderingContext2D, tx: number, ty: number, open: number, group: number, th: Theme) {
  const x = tx * T;
  const y = ty * T;
  const c = PLATE_COLORS[group] ?? '#fff';
  if (open > 0.98) {
    ctx.strokeStyle = c;
    ctx.globalAlpha = 0.3;
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 3, y + 1, T - 6, T - 2);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, T, T);
  ctx.clip();
  const dy = -open * T;
  ctx.fillStyle = th.id === 'tower' || th.id === 'paris' ? '#4a4660' : '#8a5a34';
  ctx.fillRect(x + 3, y + dy, T - 6, T);
  ctx.fillStyle = th.id === 'tower' || th.id === 'paris' ? '#6a6688' : '#a8703f';
  for (let k = 0; k < 3; k++) ctx.fillRect(x + 6 + k * 8, y + dy, 4, T);
  ctx.fillStyle = c;
  ctx.fillRect(x + 3, y + dy + 12, T - 6, 4);
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 3, y + dy, T - 6, T);
  ctx.restore();
}

export function drawCrumble(ctx: CanvasRenderingContext2D, tx: number, ty: number, shake: number, th: Theme, t: number) {
  const x = tx * T;
  const y = ty * T;
  if (shake < 0) {
    ctx.strokeStyle = th.ground.body;
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 2, y + 2, T - 4, T - 4);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return;
  }
  const j = shake > 0 ? Math.sin(t * 70 + tx) * 1.6 * (0.4 + shake) : 0;
  ctx.save();
  ctx.translate(j, 0);
  ctx.fillStyle = th.stone.face;
  ctx.strokeStyle = th.stone.dark;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, T - 2, T - 2, 4);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = th.stone.line;
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 2);
  ctx.lineTo(x + 13, y + 13);
  ctx.lineTo(x + 10, y + 21);
  ctx.moveTo(x + 13, y + 13);
  ctx.lineTo(x + 24, y + 16);
  ctx.lineTo(x + 29, y + 27);
  ctx.stroke();
  ctx.restore();
}

export function drawCheckpoint(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean, t: number, th: Theme) {
  const base = y + T / 2;
  ctx.fillStyle = '#6a4a32';
  ctx.fillRect(x - 1.5, base - 30, 3, 30);
  ctx.fillRect(x - 1.5, base - 30, 9, 2.5);
  const lx = x + 7;
  const ly = base - 21;
  if (lit) glow(ctx, lx, ly, 28, '255,214,120', 0.7 + 0.1 * Math.sin(t * 9));
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 1.5;
  ctx.fillStyle = lit ? '#ffe7a0' : '#4a4a62';
  ctx.beginPath();
  ctx.roundRect(lx - 5, ly - 6, 10, 12, 3);
  ctx.fill();
  ctx.stroke();
  if (lit) {
    ctx.fillStyle = '#ff9a3a';
    ctx.beginPath();
    ctx.ellipse(lx, ly + 1, 2, 3.5 + Math.sin(t * 13) * 0.6, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#3a3048';
  ctx.fillRect(lx - 6, ly - 8, 12, 2.5);
}

/** The nest: both birds inside clears the level. */
/** The goal: a cosy terracotta pot of soil, a heart bobbing over it (both sprouts in it = level clear). */
export function drawNest(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, inside: number, th: Theme) {
  const base = y + T / 2;
  glow(ctx, x, base - 22, 76, '255,232,160', 0.35 + 0.18 * Math.sin(t * 2) + inside * 0.25);
  ctx.fillStyle = '#ff6f9a';
  ctx.globalAlpha = 0.8;
  heartPath(ctx, x, base - 66 + Math.sin(t * 2.5) * 4, 14 + inside * 3);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  // the pot: tapering sides, a rim, soil
  ctx.fillStyle = '#d8794a';
  ctx.beginPath();
  ctx.moveTo(x - 40, base - 30);
  ctx.lineTo(x + 40, base - 30);
  ctx.lineTo(x + 31, base);
  ctx.lineTo(x - 31, base);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x - 30, base - 24, 7, 20);
  ctx.fillStyle = '#e68b58';
  ctx.beginPath();
  ctx.roundRect(x - 45, base - 38, 90, 10, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5a3a24';
  ctx.beginPath();
  ctx.ellipse(x, base - 38, 40, 4.5, 0, Math.PI, 0);
  ctx.fill();
  // a sprig already growing there, waiting for company
  ctx.strokeStyle = '#4a7a1c';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x + 24, base - 40);
  ctx.quadraticCurveTo(x + 26, base - 50, x + 22, base - 56);
  ctx.stroke();
  ctx.fillStyle = '#a8d64a';
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    ctx.beginPath();
    ctx.ellipse(x + 22 + s * 4, base - 56, 4.5, 2.2, s * 0.6 + Math.sin(t * 2) * 0.1, 0, TAU);
    ctx.fill();
  }
}

export function drawSign(ctx: CanvasRenderingContext2D, x: number, y: number, th: Theme, near: boolean) {
  const base = y + T / 2;
  ctx.fillStyle = '#7a5434';
  ctx.fillRect(x - 1.5, base - 22, 3, 22);
  ctx.fillStyle = near ? '#ffe9b8' : '#e9c48c';
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 11, base - 30, 22, 14, 3);
  ctx.fill();
  ctx.stroke();
  // a question mark, drawn as strokes (text rendering every frame is slow on phones)
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(x, base - 25.3, 2.4, Math.PI * 1.05, Math.PI * 2.35);
  ctx.lineTo(x, base - 21.6);
  ctx.stroke();
  ctx.fillStyle = th.ink;
  ctx.fillRect(x - 0.9, base - 20.2, 1.8, 1.8);
}

export function drawMover(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, th: Theme) {
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 1.6;
  switch (th.id) {
    case 'garden': {
      // a floating leaf
      ctx.fillStyle = '#6cc35a';
      ctx.beginPath();
      ctx.moveTo(x - 3, y + 3);
      ctx.quadraticCurveTo(x + w / 2, y - 6, x + w + 3, y + 3);
      ctx.quadraticCurveTo(x + w / 2, y + 16, x - 3, y + 3);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#4c9a3e';
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 4);
      ctx.lineTo(x + w - 2, y + 4);
      ctx.stroke();
      break;
    }
    case 'paris':
    case 'mill': {
      // a hanging gondola / lift on ropes
      ctx.strokeStyle = 'rgba(60,50,70,0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 4, y);
      ctx.lineTo(x + 4, y - 400);
      ctx.moveTo(x + w - 4, y);
      ctx.lineTo(x + w - 4, y - 400);
      ctx.stroke();
      ctx.fillStyle = th.id === 'paris' ? '#5b6b8a' : th.plank.side;
      ctx.strokeStyle = th.ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 11, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = th.id === 'paris' ? '#8fa1c0' : th.plank.top;
      ctx.fillRect(x + 2, y + 1.5, w - 4, 2.5);
      break;
    }
    default: {
      ctx.fillStyle = th.id === 'woods' ? th.stone.face : th.plank.side;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 11, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = th.id === 'woods' ? th.stone.light : th.plank.top;
      ctx.fillRect(x + 4, y + 2, w - 8, 2.5);
    }
  }
}

// ------------------------------------------------------------------ name labels (pre-rendered)

const labelCache = new Map<string, HTMLCanvasElement>();
let labelEpoch = 0;

/** A rounded name tag, rendered once per (name, color, size). */
export function nameLabel(name: string, color: string, px: number) {
  if (labelEpoch !== canvasEpoch) {
    labelCache.clear();
    labelEpoch = canvasEpoch;
  }
  const key = `${name}|${color}|${px}`;
  let c = labelCache.get(key);
  if (c) return c;
  if (labelCache.size > 32) labelCache.clear();
  c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = `600 ${px}px Fredoka, system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(name).width) + px;
  const h = Math.ceil(px * 1.5);
  c.width = w;
  c.height = h;
  ctx.font = font;
  ctx.fillStyle = 'rgba(29,23,48,0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, w / 2, h / 2 + px * 0.05);
  labelCache.set(key, c);
  return c;
}
