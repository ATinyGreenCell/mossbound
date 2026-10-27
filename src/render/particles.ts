import { TAU } from '../core/math';

export const enum PK {
  Dust = 0,
  Spark = 1,
  Feather = 2,
  Heart = 3,
  Leaf = 4,
  Wind = 5,
  Smoke = 6,
  Ring = 7,
  Star = 8,
}

interface Particle {
  kind: PK;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  grav: number;
  drag: number;
}

const CAP = 420;

/** A fixed pool of little effects (no allocation once warm). */
export class Particles {
  private pool: Particle[] = [];
  private n = 0;
  density = 1;

  constructor() {
    for (let i = 0; i < CAP; i++) {
      this.pool.push({ kind: PK.Dust, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, rot: 0, vr: 0, color: '#fff', grav: 0, drag: 0 });
    }
  }

  clear() {
    this.n = 0;
  }

  add(kind: PK, x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, grav = 0, drag = 0) {
    if (this.n >= CAP) return;
    const p = this.pool[this.n++];
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = p.max = life;
    p.size = size;
    p.rot = Math.random() * TAU;
    p.vr = (Math.random() - 0.5) * 6;
    p.color = color;
    p.grav = grav;
    p.drag = drag;
  }

  /** A puff of `count` particles thrown around a point (scaled by the performance density). */
  burst(kind: PK, x: number, y: number, count: number, speed: number, life: number, size: number, color: string, grav = 0, drag = 2, up = 0) {
    const k = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < k; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.add(kind, x, y, Math.cos(a) * s, Math.sin(a) * s - up, life * (0.6 + Math.random() * 0.5), size * (0.6 + Math.random() * 0.6), color, grav, drag);
    }
  }

  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        // swap-remove
        const last = this.pool[--this.n];
        this.pool[this.n] = p;
        this.pool[i] = last;
        continue;
      }
      p.vy += p.grav * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      if (p.kind === PK.Leaf || p.kind === PK.Feather) p.vx += Math.sin(p.life * 4 + p.rot) * 30 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      i++;
    }
  }

  /**
   * Draw in world space. `s`, `ox`, `oy` are the camera transform (screen = world × s − o): rotated
   * particles set their transform directly rather than save/rotate/restore each one.
   */
  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, s = 1, ox = 0, oy = 0) {
    const rot = (p: Particle) => {
      const c = Math.cos(p.rot) * s;
      const n = Math.sin(p.rot) * s;
      ctx.setTransform(c, n, -n, c, p.x * s - ox, p.y * s - oy);
    };
    for (let i = 0; i < this.n; i++) {
      const p = this.pool[i];
      if (p.x < x0 - 20 || p.x > x1 + 20 || p.y < y0 - 20 || p.y > y1 + 20) continue;
      const u = p.life / p.max;
      ctx.globalAlpha = Math.min(1, u * 2.2);
      ctx.fillStyle = p.color;
      switch (p.kind) {
        case PK.Dust: {
          const r = p.size * (1.6 - u * 0.6);
          ctx.globalAlpha = u * 0.55;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, TAU);
          ctx.fill();
          break;
        }
        case PK.Smoke: {
          const r = p.size * (2.2 - u * 1.2);
          ctx.globalAlpha = u * 0.35;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, TAU);
          ctx.fill();
          break;
        }
        case PK.Spark:
        case PK.Star: {
          const z = p.size * (0.4 + u * 0.6);
          rot(p);
          ctx.beginPath();
          ctx.moveTo(0, -z);
          ctx.lineTo(z * 0.3, -z * 0.3);
          ctx.lineTo(z, 0);
          ctx.lineTo(z * 0.3, z * 0.3);
          ctx.lineTo(0, z);
          ctx.lineTo(-z * 0.3, z * 0.3);
          ctx.lineTo(-z, 0);
          ctx.lineTo(-z * 0.3, -z * 0.3);
          ctx.closePath();
          ctx.fill();
          ctx.setTransform(s, 0, 0, s, -ox, -oy);
          break;
        }
        case PK.Feather:
        case PK.Leaf: {
          rot(p);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.42, 0, 0, TAU);
          ctx.fill();
          ctx.setTransform(s, 0, 0, s, -ox, -oy);
          break;
        }
        case PK.Heart: {
          const s = p.size * (0.7 + (1 - u) * 0.5);
          heartPath(ctx, p.x, p.y, s);
          ctx.fill();
          break;
        }
        case PK.Wind: {
          ctx.globalAlpha = Math.sin(u * Math.PI) * 0.5;
          ctx.fillRect(p.x - 0.8, p.y, 1.6, p.size);
          break;
        }
        case PK.Ring: {
          ctx.globalAlpha = u;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.8 - u), 0, TAU);
          ctx.stroke();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** A heart centered at (x, y), about `s` wide. */
export function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const h = s * 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.9);
  ctx.bezierCurveTo(x - s * 0.9, y + h * 0.1, x - s * 0.55, y - h * 1.15, x, y - h * 0.35);
  ctx.bezierCurveTo(x + s * 0.55, y - h * 1.15, x + s * 0.9, y + h * 0.1, x, y + h * 0.9);
  ctx.closePath();
}
