import { rng, TAU } from '../core/math';
import { canvasEpoch } from './renderer';
import type { Theme } from './theme';

interface LayerCanvas {
  canvas: HTMLCanvasElement;
  w: number;
}

/**
 * Sky, sun/moon, stars, clouds and the parallax strips behind the level. Everything static is
 * painted once per screen size into offscreen canvases; a frame is a few drawImage calls.
 */
export class Backdrop {
  private layers: LayerCanvas[] = [];
  private sky: HTMLCanvasElement | null = null;
  private sunGlow: HTMLCanvasElement | null = null;
  private clouds: HTMLCanvasElement[] = [];
  private stars: Float32Array;
  private W = 0;
  private H = 0;
  /** the canvasEpoch these were painted in (after a GPU reset they're blank) */
  private epoch = -1;

  constructor(readonly theme: Theme) {
    const r = rng(777);
    this.stars = new Float32Array(theme.stars * 3);
    for (let i = 0; i < theme.stars; i++) {
      this.stars[i * 3] = r();
      this.stars[i * 3 + 1] = Math.pow(r(), 1.6) * 0.75;
      this.stars[i * 3 + 2] = r() * TAU;
    }
  }

  /** Painted for some screen size, and still there? */
  get built() {
    return this.sky !== null && this.epoch === canvasEpoch;
  }

  /** Give the painted canvases' memory back now (it's painted again if drawn later). */
  release() {
    for (const c of [this.sky, this.sunGlow, ...this.clouds, ...this.layers.map((l) => l.canvas)]) if (c) c.width = c.height = 0;
    this.sky = this.sunGlow = null;
    this.clouds = [];
    this.layers = [];
    this.W = this.H = 0;
  }

  private build(W: number, H: number) {
    this.release();
    this.W = W;
    this.H = H;
    this.epoch = canvasEpoch;
    const th = this.theme;
    // sky: a tall gradient strip, stretched to the screen each frame
    this.sky = document.createElement('canvas');
    this.sky.width = 4;
    this.sky.height = Math.max(64, Math.min(1024, H));
    const sctx = this.sky.getContext('2d')!;
    const g = sctx.createLinearGradient(0, 0, 0, this.sky.height);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(0.55, th.sky[1]);
    g.addColorStop(1, th.sky[2]);
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, 4, this.sky.height);
    // sun glow sprite
    this.sunGlow = null;
    if (th.sun) {
      const R = Math.ceil(th.sun.r * H * 4);
      const c = document.createElement('canvas');
      c.width = c.height = R * 2;
      const ctx = c.getContext('2d')!;
      const rg = ctx.createRadialGradient(R, R, th.sun.r * H * 0.9, R, R, R);
      rg.addColorStop(0, th.sun.glow);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, R * 2, R * 2);
      ctx.fillStyle = th.sun.core;
      ctx.beginPath();
      ctx.arc(R, R, th.sun.r * H, 0, TAU);
      ctx.fill();
      this.sunGlow = c;
    }
    // parallax strips
    this.layers = th.layers.map((layer, i) => {
      const w = Math.ceil(layer.period * H);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      layer.paint(ctx, w, H, rng(1000 + i * 77));
      return { canvas, w };
    });
    // clouds
    this.clouds = [];
    if (th.clouds) {
      const r = rng(55);
      for (let i = 0; i < 3; i++) {
        const cw = Math.ceil(H * (0.22 + r() * 0.14));
        const ch = Math.ceil(cw * 0.45);
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = th.clouds.color;
        for (let k = 0; k < 7; k++) {
          const u = k / 6;
          const rr = ch * (0.22 + Math.sin(u * Math.PI) * 0.22) * (0.8 + r() * 0.3);
          ctx.beginPath();
          ctx.arc(cw * (0.15 + u * 0.7), ch * 0.72 - rr * 0.4, rr, 0, TAU);
          ctx.fill();
        }
        ctx.fillRect(cw * 0.15, ch * 0.62, cw * 0.7, ch * 0.3);
        this.clouds.push(c);
      }
    }
  }

  /**
   * @param camX camera center x (world px)
   * @param camBottom world y of the screen's bottom edge
   * @param levelBottom world y of the level's bottom
   */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number, camX: number, camBottom: number, levelBottom: number, scale: number, t: number) {
    if (W !== this.W || H !== this.H || !this.built) this.build(W, H);
    const th = this.theme;
    ctx.drawImage(this.sky!, 0, 0, W, H);
    // the higher the camera, the further the backdrop sinks (most visible on the tower)
    const rise = Math.max(0, levelBottom - camBottom) * scale;
    if (th.stars) {
      // (the colour is the same for every star: setting it per star cost a colour parse each time)
      ctx.fillStyle = '#fff8e0';
      for (let i = 0; i < th.stars; i++) {
        const a = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.8 + this.stars[i * 3 + 2]));
        ctx.globalAlpha = a;
        const s = i % 9 === 0 ? 2.4 : 1.4;
        ctx.fillRect(this.stars[i * 3] * W, this.stars[i * 3 + 1] * H, s, s);
      }
      ctx.globalAlpha = 1;
    }
    if (this.sunGlow && th.sun) {
      const sy = th.sun.y * H + rise * 0.04;
      ctx.drawImage(this.sunGlow, th.sun.x * W - this.sunGlow.width / 2, sy - this.sunGlow.height / 2);
    }
    if (th.moon) {
      const mx = W * 0.8;
      const my = H * 0.16;
      const mr = H * 0.05;
      ctx.fillStyle = 'rgba(255,248,220,0.12)';
      ctx.beginPath();
      ctx.arc(mx, my, mr * 2.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff6da';
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, TAU);
      ctx.fill();
      ctx.fillStyle = th.sky[0];
      ctx.beginPath();
      ctx.arc(mx + mr * 0.45, my - mr * 0.2, mr * 0.88, 0, TAU);
      ctx.fill();
    }
    if (th.clouds && this.clouds.length) {
      ctx.globalAlpha = th.clouds.alpha;
      for (let i = 0; i < th.clouds.count; i++) {
        const c = this.clouds[i % this.clouds.length];
        const span = W + c.width * 2;
        const x = ((((i * 0.37 * span - camX * scale * 0.05 - t * (6 + i * 2) * (H / 600)) % span) + span) % span) - c.width;
        const y = H * (0.06 + ((i * 0.23) % 0.4)) + rise * 0.06;
        ctx.drawImage(c, x, y);
      }
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < this.layers.length; i++) {
      const L = this.layers[i];
      const layer = th.layers[i];
      const off = -((((camX * scale * layer.fx) % L.w) + L.w) % L.w);
      const dy = Math.min(H * 0.9, rise * layer.fy);
      for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, x, dy);
    }
  }
}
