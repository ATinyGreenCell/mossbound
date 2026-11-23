import { rng, TAU } from '../core/math';
import { canvasEpoch, settle } from './renderer';
import { prepareTilesSoon } from './tiles';
import type { Theme } from './theme';

interface LayerCanvas {
  /** the part of the strip with anything in it (often only its lower half: hills, trees, a creek bank) */
  canvas: HTMLCanvasElement;
  /** the whole strip's width (it repeats every `w`), in the pixels it was painted at */
  w: number;
  /** where `canvas` sits in the strip */
  left: number;
  top: number;
}

/**
 * Watch what's painted, noting which part of the canvas it touched: the bounding box (device pixels)
 * of every fill, stroke, rect and image — conservatively (a curve's box takes in its control points, an arc its
 * whole circle, a stroke its width and any mitre), so the box always holds every pixel painted. Null when
 * nothing was painted. Something it can't bound (text, pixels put straight in) counts as everything.
 * The painting may go on over several steps: the function returned ends the watch and gives the box.
 */
function watch(ctx: CanvasRenderingContext2D, w: number, h: number): () => [number, number, number, number] | null {
  const P = CanvasRenderingContext2D.prototype;
  let box: [number, number, number, number] | null = null;
  // the current path's box, and whether it has a corner a mitred stroke could poke out of
  let path: [number, number, number, number] | null = null;
  let segs = 0;
  const add = (b: [number, number, number, number], pad: number) => {
    const x0 = b[0] - pad;
    const y0 = b[1] - pad;
    const x1 = b[2] + pad;
    const y1 = b[3] + pad;
    box = box ? [Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1)] : [x0, y0, x1, y1];
  };
  const at = (x: number, y: number, r = 0) => {
    const m = ctx.getTransform();
    const px = m.a * x + m.c * y + m.e;
    const py = m.b * x + m.d * y + m.f;
    const k = r * Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
    path = path ? [Math.min(path[0], px - k), Math.min(path[1], py - k), Math.max(path[2], px + k), Math.max(path[3], py + k)] : [px - k, py - k, px + k, py + k];
  };
  const rectBox = (x: number, y: number, rw: number, rh: number) => {
    const saved = path;
    path = null;
    at(x, y);
    at(x + rw, y);
    at(x, y + rh);
    at(x + rw, y + rh);
    const b = path!;
    path = saved;
    return b;
  };
  const scale = () => {
    const m = ctx.getTransform();
    return Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  };
  const own: Record<string, unknown> = {
    beginPath() {
      path = null;
      segs = 0;
      P.beginPath.call(ctx);
    },
    moveTo(x: number, y: number) {
      at(x, y);
      P.moveTo.call(ctx, x, y);
    },
    lineTo(x: number, y: number) {
      at(x, y);
      segs++;
      P.lineTo.call(ctx, x, y);
    },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      at(cx, cy);
      at(x, y);
      segs++;
      P.quadraticCurveTo.call(ctx, cx, cy, x, y);
    },
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
      at(c1x, c1y);
      at(c2x, c2y);
      at(x, y);
      segs++;
      P.bezierCurveTo.call(ctx, c1x, c1y, c2x, c2y, x, y);
    },
    arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean) {
      at(x, y, r);
      segs++;
      P.arc.call(ctx, x, y, r, a0, a1, ccw);
    },
    ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw?: boolean) {
      at(x, y, Math.max(rx, ry));
      segs++;
      P.ellipse.call(ctx, x, y, rx, ry, rot, a0, a1, ccw);
    },
    rect(x: number, y: number, rw: number, rh: number) {
      at(x, y);
      at(x + rw, y);
      at(x, y + rh);
      at(x + rw, y + rh);
      segs += 4;
      P.rect.call(ctx, x, y, rw, rh);
    },
    fill(...a: unknown[]) {
      // (a Path2D of its own: not the path recorded here)
      if (a[0] instanceof Path2D) box = [0, 0, w, h];
      // (a pixel for the anti-aliased edge, and one clear pixel past it: drawn at a fraction of a pixel,
      // a part's edge is sampled with its neighbour, which must be as clear as it was in the whole strip)
      else if (path) add(path, 2);
      (P.fill as (...x: unknown[]) => void).apply(ctx, a);
    },
    stroke(...a: unknown[]) {
      if (a[0] instanceof Path2D) box = [0, 0, w, h];
      else if (path) {
        // half the line either side, a square cap's corner past the end, and a mitre at any corner
        const half = (ctx.lineWidth / 2) * scale();
        const mitre = segs > 1 && ctx.lineJoin === 'miter' ? ctx.miterLimit : 1.5;
        add(path, half * mitre + 2);
      }
      (P.stroke as (...x: unknown[]) => void).apply(ctx, a);
    },
    fillRect(x: number, y: number, rw: number, rh: number) {
      add(rectBox(x, y, rw, rh), 2);
      P.fillRect.call(ctx, x, y, rw, rh);
    },
    strokeRect(x: number, y: number, rw: number, rh: number) {
      add(rectBox(x, y, rw, rh), (ctx.lineWidth / 2) * scale() * 1.5 + 2);
      P.strokeRect.call(ctx, x, y, rw, rh);
    },
    drawImage(...a: unknown[]) {
      const img = a[0] as { width: number; height: number };
      const [dx, dy, dw, dh] = a.length === 3 ? [a[1], a[2], img.width, img.height] : a.length === 5 ? a.slice(1, 5) : a.slice(5, 9);
      add(rectBox(dx as number, dy as number, dw as number, dh as number), 2);
      (P.drawImage as (...x: unknown[]) => void).apply(ctx, a);
    },
  };
  // anything else that paints, unbounded: the whole canvas
  for (const k of ['fillText', 'strokeText', 'putImageData', 'roundRect']) {
    own[k] = (...a: unknown[]) => {
      box = [0, 0, w, h];
      return (P[k as keyof CanvasRenderingContext2D] as (...x: unknown[]) => unknown).apply(ctx, a);
    };
  }
  Object.assign(ctx, own);
  return () => {
    for (const k of Object.keys(own)) delete (ctx as unknown as Record<string, unknown>)[k];
    return box;
  };
}

/** A theme's scenery painted for one screen height: what every Backdrop of that theme draws. */
interface Painting {
  theme: Theme;
  /** the screen height it was painted for */
  H: number;
  /** the canvasEpoch it was painted in (after a GPU reset it's blank) */
  epoch: number;
  sky: HTMLCanvasElement;
  sunGlow: HTMLCanvasElement | null;
  clouds: HTMLCanvasElement[];
  layers: LayerCanvas[];
  /** the backdrops drawing it now */
  users: Set<Backdrop>;
  /** when it was last drawn (newest kept when nobody is using it) */
  used: number;
}

/**
 * Every painting there is. A theme is painted once and shared: the level select's scenery is the very
 * one the level then draws (it used to be painted again, a second copy kept, the moment play began).
 */
const paintings: Painting[] = [];
/** paintings nobody is drawing kept for a screen that wants one back (leaving a level, then its card) */
const KEEP_IDLE = 1;
let clock = 0;

/** Can a painting made for height P be drawn at H? Scaled, within a step of the governor's or so. */
const fits = (P: number, H: number, exact: boolean) => (exact ? P === H : H >= P * 0.5 && H <= P * 1.25);

function free(p: Painting) {
  for (const c of [p.sky, p.sunGlow, ...p.clouds, ...p.layers.map((l) => l.canvas)]) if (c) c.width = c.height = 0;
  p.users.clear();
  const i = paintings.indexOf(p);
  if (i >= 0) paintings.splice(i, 1);
}

/** Let go of paintings from before a GPU reset, and of all but the newest idle ones. */
function tidy() {
  for (const p of paintings.filter((q) => q.epoch !== canvasEpoch)) free(p);
  const idle = paintings.filter((q) => q.users.size === 0).sort((a, b) => b.used - a.used);
  for (const p of idle.slice(KEEP_IDLE)) free(p);
}

/**
 * A theme's scenery painted for height H, a step at a time: the sky, sun and clouds first, then a layer
 * a step (a layer is most of the work). See Backdrop.prepare.
 */
function* paint(th: Theme, H: number, stepped = false): Generator<void, Painting> {
  const epoch = canvasEpoch;
  // sky: a tall gradient strip, stretched to the screen each frame
  const sky = document.createElement('canvas');
  sky.width = 4;
  sky.height = Math.max(64, Math.min(1024, H));
  const sctx = sky.getContext('2d')!;
  const g = sctx.createLinearGradient(0, 0, 0, sky.height);
  g.addColorStop(0, th.sky[0]);
  g.addColorStop(0.55, th.sky[1]);
  g.addColorStop(1, th.sky[2]);
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, 4, sky.height);
  // sun glow sprite
  let sunGlow: HTMLCanvasElement | null = null;
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
    sunGlow = c;
  }
  // Parallax strips. Most of each is clear sky — the hills, trees and falls sit in its lower part — and
  // blitting the clear part every frame was a full screen of blending for nothing (a software renderer
  // pays ~6 ms a layer at 720p). So each is painted whole, then only the part with anything in it is
  // kept, copied pixel for pixel into a canvas of its own.
  // clouds
  const clouds: HTMLCanvasElement[] = [];
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
      clouds.push(c);
    }
  }
  // (each step has the GPU paint what it drew there and then: see settle)
  if (stepped) for (const c of [sunGlow, ...clouds]) if (c) settle(c);
  yield;
  const layers: LayerCanvas[] = [];
  for (const [i, layer] of th.layers.entries()) {
    layers.push(yield* paintLayer(layer, i, H, stepped));
    if (i < th.layers.length - 1) yield;
  }
  return { theme: th, H, epoch, sky, sunGlow, clouds, layers, users: new Set(), used: ++clock };
}


/** A parallax layer painted whole, then only the part of it with anything in it kept. */
function* paintLayer(layer: Theme['layers'][number], i: number, H: number, stepped: boolean): Generator<void, LayerCanvas> {
  {
    const w = Math.ceil(layer.period * H);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    // (a step at a time where the layer can, when the painting is being done a step at a time)
    const done = watch(ctx, w, H);
    let b: [number, number, number, number] | null;
    try {
      if (stepped && layer.steps) {
        for (const step of layer.steps(ctx, w, H, rng(1000 + i * 77))) {
          settle(canvas);
          yield step;
        }
      } else layer.paint(ctx, w, H, rng(1000 + i * 77));
    } finally {
      b = done();
    }
    if (!b) {
      canvas.width = canvas.height = 0;
      return { canvas, w, left: 0, top: H };
    }
    const left = Math.max(0, Math.floor(b[0]));
    const top = Math.max(0, Math.floor(b[1]));
    const right = Math.min(w, Math.ceil(b[2]));
    const bottom = Math.min(H, Math.ceil(b[3]));
    if (left === 0 && top === 0 && right === w && bottom === H) {
      if (stepped) settle(canvas);
      return { canvas, w, left: 0, top: 0 };
    }
    const part = document.createElement('canvas');
    part.width = Math.max(1, right - left);
    part.height = Math.max(1, bottom - top);
    part.getContext('2d')!.drawImage(canvas, left, top, part.width, part.height, 0, 0, part.width, part.height);
    canvas.width = canvas.height = 0;
    if (stepped) settle(part);
    return { canvas: part, w, left, top };
  }
}

/**
 * Sky, sun/moon, stars, clouds and the parallax strips behind the level. Everything static is painted
 * once per theme and screen height into offscreen canvases (shared by every Backdrop of the theme); a
 * frame is a few drawImage calls.
 *
 * A change of size within a step of the performance governor's or a small resize (a phone's address
 * bar, a window edge) doesn't paint it again: what's painted is drawn scaled, as the title's creek
 * does. Painting again then would cost a struggling device the most at the worst moment (on a
 * software renderer a 250–300 ms frame for every governor step). A big change — a phone turned, a
 * window maximised, a second screen — paints it afresh.
 */
export class Backdrop {
  private stars: Float32Array;
  private p: Painting | null = null;
  /** a painting under way a step at a time (see prepare), and the height it's for */
  private job: { H: number; steps: Generator<void, Painting> } | null = null;

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
    return this.p !== null && this.p.epoch === canvasEpoch;
  }

  // (what's painted, for whoever needs to look: a GPU reset test, the checks in tests/e2e)
  get sky() {
    return this.p?.sky ?? null;
  }
  get sunGlow() {
    return this.p?.sunGlow ?? null;
  }
  get clouds() {
    return this.p?.clouds ?? [];
  }
  get layers() {
    return this.p?.layers ?? [];
  }

  /**
   * Done with it. Its painting is kept while another backdrop draws it, or (the newest idle one) for a
   * screen that wants it back; `now` gives its memory back at once (the title's creek, whose sky lives
   * on in the still picture painted from it).
   */
  release(now = false) {
    const p = this.p;
    this.p = null;
    if (!p) return;
    p.users.delete(this);
    if (now && p.users.size === 0) free(p);
    tidy();
  }

  /** The painting to draw at height H: this one's own if it still fits, another's of the theme, or a new one. */
  private paintingFor(ctx: CanvasRenderingContext2D, W: number, H: number, exact: boolean): Painting {
    let p = this.ready(H, exact);
    if (!p) {
      // (a painting under way for this height is finished now; any other is started and finished)
      if (!this.job || this.job.H !== H) this.job = { H, steps: paint(this.theme, H) };
      let n = this.job.steps.next();
      while (!n.done) n = this.job.steps.next();
      p = this.adopt(n.value, W, ctx);
    }
    p.used = ++clock;
    return p;
  }

  /** This backdrop's painting for height H if it has one, or another backdrop of the theme does (then shared). */
  private ready(H: number, exact: boolean): Painting | null {
    const own = this.p;
    if (own && own.epoch === canvasEpoch && fits(own.H, H, exact)) return own;
    const p = paintings.find((q) => q.theme === this.theme && q.epoch === canvasEpoch && fits(q.H, H, exact));
    if (!p) return null;
    if (own && own !== p) own.users.delete(this);
    p.users.add(this);
    this.p = p;
    tidy();
    return p;
  }

  /** A painting just finished: it's this backdrop's, and anyone's of the theme. */
  private adopt(p: Painting, W: number, screen: CanvasRenderingContext2D): Painting {
    this.job = null;
    paintings.push(p);
    if (this.p && this.p !== p) this.p.users.delete(this);
    p.users.add(this);
    this.p = p;
    tidy();
    // (and the theme's tiles in a moment, a step at a time: the first frame of play then paints neither)
    prepareTilesSoon(this.theme, W, p.H, screen);
    return p;
  }

  /**
   * Get the painting for a W × H screen ready a step at a time — the sky, sun and clouds, then a layer
   * a call — rather than in the one frame that first draws it: true once it is (drawing then paints
   * nothing). A level entered with no painting of its scenery yet calls this a frame at a time.
   */
  prepare(ctx: CanvasRenderingContext2D, W: number, H: number): boolean {
    if (this.ready(H, false)) return true;
    if (this.job && this.job.H !== H) this.job = null;
    this.job ??= { H, steps: paint(this.theme, H, true) };
    const n = this.job.steps.next();
    if (!n.done) return false;
    this.adopt(n.value, W, ctx);
    return true;
  }

  /** The sky alone, from the theme's colours (no painting needed): the curtain a level is revealed from. */
  drawSky(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, this.theme.sky[0]);
    g.addColorStop(0.55, this.theme.sky[1]);
    g.addColorStop(1, this.theme.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /**
   * @param camX camera center x (world px)
   * @param camBottom world y of the screen's bottom edge
   * @param levelBottom world y of the level's bottom
   * @param exact paint it for exactly this height rather than scale one painted for another (a picture
   * kept for good, like the title's still, wants it crisp)
   */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number, camX: number, camBottom: number, levelBottom: number, scale: number, t: number, exact = false) {
    const p = this.paintingFor(ctx, W, H, exact);
    const th = this.theme;
    // (all of it at the alpha it's asked for: a level's curtain fades out as this)
    const alpha = ctx.globalAlpha;
    // how much bigger the screen is than what was painted (1: drawn as painted, pixel for pixel)
    const k = H / p.H;
    // The sky strip is one pixel row per screen row whenever the screen is 64–1024 rows tall: drawn
    // without smoothing it is then the same picture (every column of the strip is the same, and
    // vertically it's 1:1 — a GPU's filter at a texel's centre can round one way or the other, so 1 in
    // 255 here and there at most), and a software renderer draws it ~30% quicker. Stretched, it keeps
    // its smoothing.
    const sky = p.sky;
    if (sky.height === H) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sky, 0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
    } else ctx.drawImage(sky, 0, 0, W, H);
    // the higher the camera, the further the backdrop sinks (most visible on the great falls, a climb)
    const rise = Math.max(0, levelBottom - camBottom) * scale;
    if (th.stars) {
      // (the colour is the same for every star: setting it per star cost a colour parse each time)
      ctx.fillStyle = '#fff8e0';
      for (let i = 0; i < th.stars; i++) {
        const a = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.8 + this.stars[i * 3 + 2]));
        ctx.globalAlpha = alpha * a;
        const s = i % 9 === 0 ? 2.4 : 1.4;
        ctx.fillRect(this.stars[i * 3] * W, this.stars[i * 3 + 1] * H, s, s);
      }
      ctx.globalAlpha = alpha;
    }
    if (p.sunGlow && th.sun) {
      const sw = p.sunGlow.width * k;
      const sy = th.sun.y * H + rise * 0.04;
      if (k === 1) ctx.drawImage(p.sunGlow, th.sun.x * W - sw / 2, sy - sw / 2);
      else ctx.drawImage(p.sunGlow, th.sun.x * W - sw / 2, sy - sw / 2, sw, sw);
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
    if (th.clouds && p.clouds.length) {
      ctx.globalAlpha = alpha * th.clouds.alpha;
      for (let i = 0; i < th.clouds.count; i++) {
        const c = p.clouds[i % p.clouds.length];
        const cw = c.width * k;
        const span = W + cw * 2;
        const x = ((((i * 0.37 * span - camX * scale * 0.05 - t * (6 + i * 2) * (H / 600)) % span) + span) % span) - cw;
        const y = H * (0.06 + ((i * 0.23) % 0.4)) + rise * 0.06;
        if (k === 1) ctx.drawImage(c, x, y);
        else ctx.drawImage(c, x, y, cw, c.height * k);
      }
      ctx.globalAlpha = alpha;
    }
    for (let i = 0; i < p.layers.length; i++) {
      const L = p.layers[i];
      const layer = th.layers[i];
      const Lw = L.w * k;
      const off = -((((camX * scale * layer.fx) % Lw) + Lw) % Lw);
      const dy = Math.min(H * 0.9, rise * layer.fy);
      if (!L.canvas.width || dy + L.top * k >= H) continue;
      if (k === 1) for (let x = off; x < W; x += Lw) ctx.drawImage(L.canvas, x + L.left, dy + L.top);
      else for (let x = off; x < W; x += Lw) ctx.drawImage(L.canvas, x + L.left * k, dy + L.top * k, L.canvas.width * k, L.canvas.height * k);
    }
  }
}
