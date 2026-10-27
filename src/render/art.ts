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

const hexRgb = (hex: string) => `${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)}`;

export const PLATE_COLORS = ['#ffcf4a', '#4ad3c9', '#ff7fb0'];

// ------------------------------------------------------------------ birds

/**
 * A round little bird. Drawn around its body center: tilted toward the string while it hangs, leaning
 * back while it anchors, squashed and stretched by its springy `squash`.
 */
export function drawBird(ctx: CanvasRenderingContext2D, b: Bird, col: BirdColor, t: number, ink: string, hat: string, menu: boolean) {
  ctx.save();
  ctx.translate(b.x, b.y);
  if (b.ghost) {
    drawGhost(ctx, b, col, t);
    ctx.restore();
    return;
  }
  if (b.invuln > 0 && Math.floor(t * 14) % 2 === 0) ctx.globalAlpha = 0.45;
  let rot = 0;
  const rope = b.rope;
  if (b.hanging && rope) {
    rot = Math.atan2(rope.pivot.x - b.x, -(rope.pivot.y - b.y)) * 0.75;
  } else if (b.anchored && rope) {
    rot = -Math.sign(rope.pivot.x - b.x || b.facing) * 0.22;
  } else if (b.grounded && Math.abs(b.vx) > 40) {
    rot = Math.sign(b.vx) * 0.07 + (b.strain > 0.3 ? Math.sign(b.vx) * 0.12 : 0);
  } else if (!b.grounded) {
    rot = clamp(b.vx / 1600, -0.25, 0.25);
  }
  ctx.rotate(rot);
  const sq = b.squash;
  // squash around the feet
  ctx.translate(0, 10);
  ctx.scale(b.facing * (1 + sq * 0.85), 1 - sq);
  ctx.translate(0, -10);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = ink;

  // feet
  const walk = Math.sin(b.walkPhase);
  const spread = b.anchored ? 2.5 : 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#d98a1e';
  if (b.grounded || b.anchored) {
    ctx.beginPath();
    ctx.moveTo(-3 - spread, 9);
    ctx.lineTo(-4 - spread + walk * 2.5, 12);
    ctx.moveTo(4 + spread, 9);
    ctx.lineTo(5 + spread - walk * 2.5, 12);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-3, 9);
    ctx.lineTo(-4.5, 12.5);
    ctx.moveTo(3, 9);
    ctx.lineTo(2, 12.5);
    ctx.stroke();
  }
  ctx.strokeStyle = ink;

  // tail
  ctx.fillStyle = col.dark;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-9, -1);
  ctx.lineTo(-17, -7 + walk);
  ctx.lineTo(-16.5, -1.5);
  ctx.lineTo(-18, 2.5);
  ctx.lineTo(-9, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // body
  ctx.fillStyle = col.body;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = col.belly;
  ctx.beginPath();
  ctx.ellipse(4, 4.5, 8, 7.5, -0.2, 0, TAU);
  ctx.fill();
  // a soft shade along the bottom
  ctx.fillStyle = 'rgba(40,20,60,0.12)';
  ctx.beginPath();
  ctx.ellipse(0, 12, 14, 5, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, TAU);
  ctx.stroke();

  // head tuft
  ctx.fillStyle = col.dark;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-2, -11.5);
  ctx.quadraticCurveTo(-4, -18, 1, -17.5);
  ctx.quadraticCurveTo(-0.5, -15, 1.5, -11.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // wing
  let wa = 0.25;
  if (b.fluttering || b.ghost) wa = 0.4 + Math.sin(b.wingPhase) * 0.9;
  else if (!b.grounded && !b.hanging) wa = b.vy < 0 ? -0.5 + Math.sin(b.wingPhase) * 0.5 : 0.9;
  else if (b.hanging) wa = b.climbing ? Math.sin(b.wingPhase * 2) * 0.8 - 0.6 : -0.9 + Math.sin(b.wingPhase) * 0.15;
  else if (b.anchored) wa = -0.7;
  ctx.save();
  ctx.translate(1, 0);
  ctx.rotate(wa);
  ctx.fillStyle = col.dark;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(1.5, -2);
  ctx.quadraticCurveTo(-4, -6, -10, 1);
  ctx.quadraticCurveTo(-5, 5.5, 1.5, 2.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // cheek
  ctx.fillStyle = 'rgba(255,110,150,0.5)';
  ctx.beginPath();
  ctx.arc(6.5, 2.5, 2.3, 0, TAU);
  ctx.fill();

  // eye
  const lx = b.lookX * b.facing;
  const ly = b.lookY;
  if (b.blinkT < 0 || menu) {
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(2, -4);
    ctx.quadraticCurveTo(4.6, -2.2, 7.2, -4);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(4.6, -4, 4.3, 4.8, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ink;
    const px = 4.6 + clamp(lx, -1, 1) * 1.5;
    const py = -4 + clamp(ly, -1, 1) * 1.7;
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px - 0.9, py - 1, 0.95, 0, TAU);
    ctx.fill();
  }

  // beak (open while bouncing/flapping hard)
  ctx.fillStyle = '#ffb63c';
  ctx.lineWidth = 1.6;
  const open = b.fluttering || b.strain > 0.5 ? 1.6 : 0;
  ctx.beginPath();
  ctx.moveTo(10.5, -2.2);
  ctx.lineTo(16.5, -0.3 - open * 0.3);
  ctx.lineTo(10.5, 1.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (open) {
    ctx.beginPath();
    ctx.moveTo(10.5, 1.4);
    ctx.lineTo(15, 1.4 + open);
    ctx.lineTo(10.5, 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  if (hat !== 'none') drawHat(ctx, hat, ink);

  // a bead of effort while straining against the string
  if (b.strain > 0.5 && b.grounded) {
    ctx.fillStyle = '#9fdcff';
    ctx.beginPath();
    ctx.ellipse(-6, -13, 1.6, 2.4, -0.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawGhost(ctx: CanvasRenderingContext2D, _b: Bird, col: BirdColor, t: number) {
  glow(ctx, 0, 0, 18, hexRgb(col.belly), 0.85);
  glow(ctx, 0, 0, 9, '255,255,255', 0.7);
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = col.body;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(0, 0, 8 + Math.sin(t * 9) * 0.8, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#2b2140';
  ctx.beginPath();
  ctx.arc(-2.5, -1, 1.3, 0, TAU);
  ctx.arc(2.5, -1, 1.3, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawHat(ctx: CanvasRenderingContext2D, hat: string, ink: string) {
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

const ropePts: Pt[] = [];
const ropeAcc: number[] = [];

/**
 * The string along its path (bird → bends → bird), sagging when slack, with a wave running along it
 * after a tug. Colored from one bird's color to the other's.
 */
export function drawRope(ctx: CanvasRenderingContext2D, path: readonly Pt[], total: number, colA: string, colB: string, tension: number, twang: number, twangFrom: 0 | 1, t: number, glow: number, solid?: (x: number, y: number) => boolean) {
  ropePts.length = 0;
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
      ropePts.push({ x: a * p.x + bb * cx + c * q.x, y: a * p.y + bb * cy + c * q.y });
      ropeAcc.push(acc + u * L);
    }
    acc += L;
  }
  // tug wave: a bump traveling from the tugger's end
  if (twang > 0.01 && ropePts.length > 2) {
    const front = (1 - twang) * acc * 1.4;
    for (let i = 1; i < ropePts.length - 1; i++) {
      const s = twangFrom === 0 ? ropeAcc[i] : acc - ropeAcc[i];
      const env = Math.exp(-(((s - front) / 26) ** 2)) * twang;
      if (env < 0.01) continue;
      const a = ropePts[i - 1];
      const b = ropePts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      const off = Math.sin(s * 0.25 - t * 30) * 7 * env;
      ropePts[i] = { x: ropePts[i].x - (dy / l) * off, y: ropePts[i].y + (dx / l) * off };
    }
  }
  const a = path[0];
  const z = path[path.length - 1];
  const grad = ctx.createLinearGradient(a.x, a.y, z.x, z.y);
  grad.addColorStop(0, colA);
  grad.addColorStop(1, colB);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ropePts[0].x, ropePts[0].y);
  for (let i = 1; i < ropePts.length; i++) ctx.lineTo(ropePts[i].x, ropePts[i].y);
  ctx.strokeStyle = grad;
  ctx.globalAlpha = 0.16 + glow * 0.2 + tension * 0.12;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2.6 + tension * 0.4;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
}

/** The string's end hanging loose from a bird whose partner is away. */
export function drawLooseEnd(ctx: CanvasRenderingContext2D, b: Bird, col: string, t: number) {
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  const sway = Math.sin(t * 2) * 4;
  ctx.quadraticCurveTo(b.x - b.facing * 8 + sway, b.y + 12, b.x - b.facing * 4 + sway * 1.5, b.y + 22);
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

let featherFill: CanvasGradient | null = null;

export function drawFeather(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const bob = Math.sin(t * 2.2) * 3;
  glow(ctx, x, y + bob, 24, '255,226,130', 0.6 + 0.15 * Math.sin(t * 3));
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(-0.6 + Math.sin(t * 1.6) * 0.25);
  // (a gradient in the feather's own space, built once)
  if (!featherFill) {
    featherFill = ctx.createLinearGradient(0, -12, 0, 12);
    featherFill.addColorStop(0, '#fff6c0');
    featherFill.addColorStop(1, '#eba824');
  }
  ctx.fillStyle = featherFill;
  ctx.strokeStyle = '#9a6410';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.bezierCurveTo(7, -7, 6, 6, 0, 11);
  ctx.bezierCurveTo(-6, 6, -7, -7, 0, -13);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.lineTo(0, 15);
  ctx.stroke();
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

export function drawPlate(ctx: CanvasRenderingContext2D, tx: number, ty: number, down: boolean, group: number, ink: string) {
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
export function drawNest(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, inside: number, th: Theme) {
  const base = y + T / 2;
  glow(ctx, x, base - 20, 72, '255,220,150', 0.35 + 0.18 * Math.sin(t * 2) + inside * 0.25);
  // a little floating heart over the nest
  ctx.fillStyle = '#ff6f9a';
  ctx.globalAlpha = 0.8;
  heartPath(ctx, x, base - 58 + Math.sin(t * 2.5) * 4, 14 + inside * 3);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#9a6b3e';
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 46, base - 18);
  ctx.quadraticCurveTo(x, base + 10, x + 46, base - 18);
  ctx.quadraticCurveTo(x, base + 2, x - 46, base - 18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#c9965e';
  ctx.lineWidth = 1.6;
  for (let k = 0; k < 7; k++) {
    const u = k / 6;
    ctx.beginPath();
    ctx.moveTo(x - 44 + u * 70, base - 16 + Math.sin(u * 9) * 2);
    ctx.lineTo(x - 30 + u * 70, base - 6 - Math.cos(u * 7) * 2);
    ctx.stroke();
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
