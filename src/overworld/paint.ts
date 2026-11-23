/**
 * Paints the map's chunks (see chunks.ts): the meadow, the creek, the trail, what grows, the landmarks
 * and the stops — then the time of day over all of it, then what glows at night. Everything a frame
 * doesn't need to move is painted here, once, so a frame is a handful of images and the sprouts.
 *
 * Painting a chunk looks only at the worlds whose stretch of map it touches (found by x), and only at
 * what of theirs falls in it, so a chunk costs the same on a map of fifty worlds as on one of three.
 * Where two worlds meet, their looks blend over a few hundred units.
 */
import { hash2 } from '../core/math';
import { portrait } from './bosses';
import { CHUNK, ChunkCache, type ChunkPainter } from './chunks';
import { bloom, book, bud, drawItem, drawMark, ell, LW, pennant, seedling, stone, type Lights } from './decor';
import { CLEARED, creekAt, LOCKED, regionAt, STEP, type MapEdge, type MapLayout, type MapNode, type MapState } from './layout';
import { scatter, type Item, type RegionDecor } from './scatter';
import { mapTheme, mix, type MapTheme } from './themes';

/** the mist thickens over this far before, and after, where it begins */
export const MIST_IN = 200;
export const MIST_OUT = 160;
/** half the width of the blend between two worlds' looks */
const BLEND = 260;
const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Where a boss stands on its stop, and where the sprouts stand on one (from its centre). */
export const BOSS_AT = (n: MapNode) => [n.x + n.r * 0.5, n.y - n.r * 0.38] as const;
/** Where a cleared stop's flower grows (and an open one's bud): on the rim, clear of the sprouts standing there. [x, y, size] */
export const BLOOM_AT = (n: MapNode) => (n.kind === 'boss' ? ([n.x + n.r * 0.12, n.y + n.r * 0.34, 9] as const) : ([n.x + n.r * 0.62, n.y, 8] as const));
export function standAt(n: MapNode): [number, number] {
  if (n.kind === 'boss') return [n.x - n.r * 0.38, n.y + 2];
  if (n.kind === 'gate') return [n.x - 8, n.y + 4];
  return [n.x, n.y];
}

/** A point `s` along an edge (from a), into out. */
export function pointAt(e: MapEdge, s: number, out: [number, number]): [number, number] {
  const acc = e.acc;
  const n = acc.length;
  if (s <= 0) {
    out[0] = e.pts[0];
    out[1] = e.pts[1];
    return out;
  }
  if (s >= e.len) {
    out[0] = e.pts[n * 2 - 2];
    out[1] = e.pts[n * 2 - 1];
    return out;
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (acc[mid] <= s) lo = mid;
    else hi = mid;
  }
  const u = (s - acc[lo]) / (acc[hi] - acc[lo] || 1);
  out[0] = e.pts[lo * 2] + (e.pts[hi * 2] - e.pts[lo * 2]) * u;
  out[1] = e.pts[lo * 2 + 1] + (e.pts[hi * 2 + 1] - e.pts[lo * 2 + 1]) * u;
  return out;
}

const P: [number, number] = [0, 0];
const C: [number, number] = [0, 0];

/** A soft round glow, painted straight into the (CPU) chunk: art.ts's glow is a GPU image, and a GPU image drawn into a CPU canvas is a readback. */
function halo(g: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${rgb},${a})`);
  gr.addColorStop(0.45, `rgba(${rgb},${a * 0.45})`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
}
/** paint chunks on the CPU (see bake) — a switch for measuring, from ?gpuchunks */
export let CPU_CHUNKS = true;
export const setCpuChunks = (on: boolean) => (CPU_CHUNKS = on);

export class MapPainter implements ChunkPainter<HTMLCanvasElement> {
  readonly themes: MapTheme[];
  private readonly decor: (RegionDecor | null)[];
  /** edges still shown as they were while their vine grows (map.ts), and stops shown as they were */
  readonly holdEdges = new Map<number, number>();
  readonly holdNodes = new Map<number, number>();
  /** time spent placing what grows (once per world), ms */
  scatterMs = 0;
  /** where the mist over what's still to come begins (map x): painted into the chunks, it moves only when progress does */
  mistX = Infinity;

  constructor(
    readonly L: MapLayout,
    public state: MapState,
  ) {
    this.themes = L.regions.map((g) => mapTheme(g.def.mapTheme));
    this.decor = L.regions.map(() => null);
  }

  bake(cx: number, cy: number, px: number, old: HTMLCanvasElement | null): HTMLCanvasElement {
    const c = old ?? document.createElement('canvas');
    if (c.width !== px || c.height !== px) {
      c.width = px;
      c.height = px;
    }
    // painted by the CPU (Skia's rasteriser is quick at hundreds of little paths; a software GPU, like a
    // CI runner's, is not), then laid on the screen as one image — the same trick as the sprouts' (sprouts.ts)
    const g = c.getContext('2d', { willReadFrequently: CPU_CHUNKS })!;
    const k = px / CHUNK;
    g.setTransform(k, 0, 0, k, -cx * CHUNK * k, -cy * CHUNK * k);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.lineJoin = 'round';
    g.lineCap = 'round';
    this.paint(g, cx * CHUNK, cy * CHUNK, k);
    return c;
  }

  free(c: HTMLCanvasElement) {
    c.width = c.height = 0;
  }

  /** What grows in world w (placed the first time it's needed). */
  decorOf(w: number): RegionDecor {
    let d = this.decor[w];
    if (!d) {
      const t0 = performance.now();
      d = this.decor[w] = scatter(this.L, w, this.themes[w]);
      this.scatterMs += performance.now() - t0;
    }
    return d;
  }

  /** The two worlds whose looks meet at x, and how far from the first to the second: [a, b, t]. */
  private look(x: number): [number, number, number] {
    const R = this.L.regions;
    const w = regionAt(this.L, x);
    if (w > 0 && x < R[w].x0 + BLEND) return [w - 1, w, smooth(0.5 + (x - R[w].x0) / (2 * BLEND))];
    if (w < R.length - 1 && x > R[w + 1].x0 - BLEND) return [w, w + 1, smooth(0.5 - (R[w + 1].x0 - x) / (2 * BLEND))];
    return [w, w, 0];
  }

  private colorAt(x: number, pick: (th: MapTheme, w: number, x: number) => string) {
    const [a, b, t] = this.look(x);
    const A = pick(this.themes[a], a, x);
    return a === b || t <= 0 ? A : mix(A, pick(this.themes[b], b, x), t);
  }

  /** A fill for x0..x1: the colour, or a gradient across it where worlds meet (or the time of day turns). */
  private fillX(g: CanvasRenderingContext2D, x0: number, x1: number, pick: (th: MapTheme, w: number, x: number) => string): string | CanvasGradient {
    const cols: string[] = [];
    for (let i = 0; i <= 4; i++) cols.push(this.colorAt(x0 + ((x1 - x0) * i) / 4, pick));
    if (cols.every((c) => c === cols[0])) return cols[0];
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    cols.forEach((c, i) => gr.addColorStop(i / 4, c));
    return gr;
  }

  /** The time of day at x in world w: where it is between the world's start and end, along its grade. */
  private dayAt(w: number, x: number, stops: readonly number[] | readonly string[]): number | string {
    const g = this.L.regions[w];
    const gx0 = Number.isFinite(g.x0) ? g.x0 : this.L.nodes[g.gate].x - 300;
    const gx1 = w < this.L.regions.length - 1 ? this.L.regions[w + 1].x0 : g.x1;
    const u = Math.max(0, Math.min(1, (x - gx0) / (gx1 - gx0))) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(u));
    const f = u - i;
    if (typeof stops[0] === 'number') return (stops[i] as number) + ((stops[i + 1] as number) - (stops[i] as number)) * f;
    return mix(stops[i] as string, stops[i + 1] as string, f);
  }

  private gradeAt = (th: MapTheme, w: number, x: number) => (th.grade.length > 1 ? (this.dayAt(w, x, th.grade) as string) : th.grade[0]);

  nightAt(x: number) {
    const [a, b, t] = this.look(x);
    const na = this.themes[a].night.length > 1 ? (this.dayAt(a, x, this.themes[a].night) as number) : this.themes[a].night[0] ?? 0;
    if (a === b) return na;
    const nb = this.themes[b].night.length > 1 ? (this.dayAt(b, x, this.themes[b].night) as number) : this.themes[b].night[0] ?? 0;
    return na + (nb - na) * t;
  }

  /** The look of the world painted at x. */
  themeAt(x: number) {
    return this.themes[regionAt(this.L, x)];
  }

  // ------------------------------------------------------------------ a chunk

  private paint(g: CanvasRenderingContext2D, x0: number, y0: number, k: number) {
    const L = this.L;
    const x1 = x0 + CHUNK;
    const y1 = y0 + CHUNK;
    const mid = this.themeAt(x0 + CHUNK / 2);
    // the meadow
    g.fillStyle = this.fillX(g, x0, x1, (th) => th.ground[0]);
    g.fillRect(x0, y0, CHUNK, CHUNK);
    this.patches(g, x0, y0, x1, y1);
    this.specks(g, x0, y0, x1, y1, mid);
    this.creek(g, x0, y0, x1, y1);
    // the worlds that reach in here
    const w0 = regionAt(L, x0 - 320);
    const w1 = regionAt(L, x1 + 320);
    for (let w = w0; w <= w1; w++) {
      const R = L.regions[w];
      for (const ei of R.edges) {
        const e = L.edges[ei];
        if (e.box[0] > x1 + 12 || e.box[2] < x0 - 12 || e.box[1] > y1 + 12 || e.box[3] < y0 - 12) continue;
        this.edge(g, e, x0, y0, x1, y1);
      }
      for (const c of R.crossings) if (c.bridge && Math.abs(c.x - (x0 + x1) / 2) < CHUNK / 2 + 60 && Math.abs(c.y - (y0 + y1) / 2) < CHUNK / 2 + 70) this.bridge(g, L.edges[c.edge], c.x, this.themes[w]);
    }
    // what grows, and the landmarks, back to front
    const lights: Lights = [];
    const key = ChunkCache.key(Math.floor(x0 / CHUNK), Math.floor(y0 / CHUNK));
    const lists: { items: Item[]; th: MapTheme; seed: number }[] = [];
    for (let w = Math.max(0, w0 - 1); w <= Math.min(L.regions.length - 1, w1 + 1); w++) {
      const R = L.regions[w];
      if (R.cx0 > x1 + 400 || R.cx0 + R.cy.length * STEP < x0 - 400) continue;
      const items = this.decorOf(w).buckets.get(key);
      if (items) lists.push({ items, th: this.themes[w], seed: R.seed });
    }
    const idx = lists.map(() => 0);
    for (;;) {
      let best = -1;
      for (let i = 0; i < lists.length; i++) if (idx[i] < lists[i].items.length && (best < 0 || lists[i].items[idx[i]].y < lists[best].items[idx[best]].y)) best = i;
      if (best < 0) break;
      const it = lists[best].items[idx[best]++];
      const th = lists[best].th;
      if (it.mark) drawMark(g, it.mark.kind, it.x, it.y, it.mark.side, th, lights, lists[best].seed % 97);
      else drawItem(g, it, th);
    }
    // the stops
    const nodes: MapNode[] = [];
    for (let w = w0; w <= w1; w++) {
      for (const ni of L.regions[w].nodes) {
        const n = L.nodes[ni];
        if (n.x - 80 > x1 || n.x + 100 < x0 || n.y - 110 > y1 || n.y + 40 < y0) continue;
        nodes.push(n);
      }
    }
    nodes.sort((a, b) => a.y - b.y);
    for (const n of nodes) this.node(g, n, k);
    // the time of day
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = this.fillX(g, x0, x1, this.gradeAt);
    g.fillRect(x0, y0, CHUNK, CHUNK);
    g.globalCompositeOperation = 'source-over';
    // and what glows in the dark
    const night = this.nightAt(x0 + CHUNK / 2);
    if (night > 0.2) this.glows(g, x0, y0, x1, y1, night, lights);
    // the mist over what's still to come
    if (x1 > this.mistX - MIST_IN) {
      const m = g.createLinearGradient(this.mistX - MIST_IN, 0, this.mistX + MIST_OUT, 0);
      m.addColorStop(0, 'rgba(246,248,232,0)');
      m.addColorStop(0.55, 'rgba(246,248,232,0.74)');
      m.addColorStop(1, 'rgba(246,248,232,0.96)');
      g.fillStyle = m;
      const mx = Math.max(x0, this.mistX - MIST_IN);
      g.fillRect(mx, y0, x1 - mx, CHUNK);
    }
  }

  /** Big soft patches of lighter and darker meadow. */
  private patches(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    const S = 192;
    for (let cy = Math.floor((y0 - 130) / S); cy <= Math.floor((y1 + 130) / S); cy++) {
      for (let cx = Math.floor((x0 - 130) / S); cx <= Math.floor((x1 + 130) / S); cx++) {
        for (let i = 0; i < 2; i++) {
          const h = hash2(cx, cy, 11 + i);
          const x = (cx + hash2(cx, cy, 21 + i)) * S;
          const y = (cy + hash2(cx, cy, 31 + i)) * S;
          const rx = 50 + h * 70;
          if (x + rx < x0 || x - rx > x1 || y + rx < y0 || y - rx > y1) continue;
          const th = this.themeAt(x);
          g.fillStyle = h < 0.5 ? th.ground[1] : th.ground[2];
          g.globalAlpha = 0.55;
          ell(g, x, y, rx, rx * (0.42 + hash2(cx, cy, 41 + i) * 0.2));
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;
  }

  /** Specks and little tufts all over: per colour, one fill of specks and one stroke of tufts. */
  private specks(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, th: MapTheme) {
    const S = 24;
    const n = th.specks.length;
    g.lineWidth = 1.1;
    const cx0 = Math.floor(x0 / S) - 1;
    const cx1 = Math.floor(x1 / S);
    const cy0 = Math.floor(y0 / S) - 1;
    const cy1 = Math.floor(y1 / S);
    for (let c = 0; c < n; c++) {
      for (const tufts of [false, true]) {
        g.beginPath();
        let any = false;
        for (let cy = cy0; cy <= cy1; cy++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            const h = hash2(cx, cy, 5);
            if (h > 0.62 || h < 0.3 !== tufts || Math.floor(hash2(cx, cy, 6) * n) !== c) continue;
            const x = (cx + hash2(cx, cy, 7)) * S;
            const y = (cy + hash2(cx, cy, 8)) * S;
            if (tufts) {
              g.moveTo(x - 1.6, y);
              g.quadraticCurveTo(x - 1.8, y - 2.4, x - 2.6, y - 4.2);
              g.moveTo(x + 0.6, y);
              g.quadraticCurveTo(x + 0.8, y - 2.8, x + 1.8, y - 4.6);
            } else g.rect(x - 1.3, y - 0.7, 2.6, 1.4);
            any = true;
          }
        }
        if (!any) continue;
        if (tufts) {
          g.strokeStyle = th.specks[c];
          g.stroke();
        } else {
          g.fillStyle = th.specks[c];
          g.fill();
        }
      }
    }
  }

  /** The creek: a mossy rim, the water (deeper in the middle, shaded under the far bank), inked banks, glints. */
  private creek(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    const xa = Math.floor((x0 - 24) / STEP) * STEP;
    const xb = Math.ceil((x1 + 24) / STEP) * STEP;
    const n = (xb - xa) / STEP + 1;
    const ys = new Float32Array(n);
    const ws = new Float32Array(n);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      creekAt(this.L, xa + i * STEP, C);
      ys[i] = C[0];
      ws[i] = C[1];
      lo = Math.min(lo, C[0] - C[1]);
      hi = Math.max(hi, C[0] + C[1]);
    }
    if (lo > y1 + 12 || hi < y0 - 12) return;
    const band = (top: number, bot: number, off = 0) => {
      g.beginPath();
      for (let i = 0; i < n; i++) g.lineTo(xa + i * STEP, ys[i] + off - ws[i] * top);
      for (let i = n - 1; i >= 0; i--) g.lineTo(xa + i * STEP, ys[i] + off + ws[i] * bot);
      g.closePath();
    };
    const edge = (side: number, add: number) => {
      g.beginPath();
      for (let i = 0; i < n; i++) g.lineTo(xa + i * STEP, ys[i] + side * (ws[i] + add));
    };
    g.fillStyle = this.fillX(g, xa, xb, (th) => th.bank);
    band(1.28, 1.2);
    g.fill();
    g.fillStyle = this.fillX(g, xa, xb, (th) => th.water[1]);
    band(1, 1);
    g.fill();
    g.fillStyle = this.fillX(g, xa, xb, (th) => th.water[0]);
    g.globalAlpha = 0.55;
    band(0.42, 0.5, 2);
    g.fill();
    // the far bank's shadow on the water
    g.globalAlpha = 0.35;
    band(1, -0.72);
    g.fill();
    g.globalAlpha = 1;
    const ink = this.themeAt((x0 + x1) / 2).ink;
    g.strokeStyle = ink;
    g.lineWidth = LW;
    edge(-1, 0);
    g.stroke();
    edge(1, 0);
    g.stroke();
    // glints, drifting downstream
    g.strokeStyle = this.fillX(g, xa, xb, (th) => th.water[2]);
    g.lineWidth = 1.5;
    g.beginPath();
    const G = 30;
    for (let gx = Math.floor(xa / G); gx * G < xb; gx++) {
      const h = hash2(gx, 3, 9);
      if (h > 0.65) continue;
      const x = gx * G + hash2(gx, 4, 9) * 10;
      const i = Math.round((x - xa) / STEP);
      if (i < 0 || i >= n) continue;
      const y = ys[i] + (hash2(gx, 5, 9) - 0.45) * ws[i] * 1.1;
      const len = 7 + h * 12;
      g.moveTo(x, y);
      g.quadraticCurveTo(x + len / 2, y - 1.6, x + len, y);
    }
    g.stroke();
  }

  /** The trail: moss and pebbles where it's open, faint dots where it isn't yet, stepping stones in the water. */
  private edge(g: CanvasRenderingContext2D, e: MapEdge, x0: number, y0: number, x1: number, y1: number) {
    const L = this.L;
    const th = this.themes[e.world];
    const held = this.holdEdges.get(e.i);
    const open = held !== undefined ? held === 1 : this.state.edge[e.i] === 1;
    const A = L.nodes[e.a];
    const B = L.nodes[e.b];
    const bridge = this.L.regions[e.world].crossings.some((c) => c.edge === e.i && c.bridge);
    const step = open ? 10.5 : 13;
    let i = 0;
    for (let s = step * 0.6; s < e.len; s += step, i++) {
      pointAt(e, s, P);
      const x = P[0];
      const y = P[1];
      if (x < x0 - 9 || x > x1 + 9 || y < y0 - 9 || y > y1 + 9) continue;
      if (Math.hypot(x - A.x, (y - A.y) * 1.4) < A.r + 3 || Math.hypot(x - B.x, (y - B.y) * 1.4) < B.r + 3) continue;
      creekAt(L, x, C);
      const wet = Math.abs(y - C[0]) < C[1] + 1.5;
      if (wet) {
        if (bridge || i % 2) continue;
        // a stepping stone, the water rippling round it
        g.strokeStyle = th.water[2];
        g.lineWidth = 1;
        ell(g, x, y + 1.5, 9, 3.6);
        g.stroke();
        ell(g, x, y, 6.5, 4.2);
        g.fillStyle = th.stone[0];
        g.fill();
        g.strokeStyle = th.ink;
        g.lineWidth = 1;
        g.stroke();
        g.fillStyle = th.stone[1];
        ell(g, x - 1.2, y - 1.2, 3.6, 2);
        g.fill();
        continue;
      }
      if (!open) {
        g.fillStyle = th.ink;
        g.globalAlpha = 0.2;
        ell(g, x, y, 1.9, 1.5);
        g.fill();
        g.globalAlpha = 1;
      } else if (i % 2) {
        ell(g, x, y, 3.6, 2.6);
        g.fillStyle = th.path.stone;
        g.fill();
        g.strokeStyle = th.path.stoneDark;
        g.lineWidth = 0.9;
        g.stroke();
      } else {
        g.fillStyle = th.path.mossDark;
        ell(g, x + 0.5, y + 0.8, 4.4, 3.2);
        g.fill();
        g.fillStyle = th.path.moss;
        ell(g, x, y, 3.9, 2.8);
        g.fill();
      }
    }
  }

  /** A little plank bridge where the trail crosses the creek at x. */
  private bridge(g: CanvasRenderingContext2D, e: MapEdge, cx: number, th: MapTheme) {
    const L = this.L;
    // along the edge, from bank to bank (a plank's width past the water each side)
    let s0 = -1;
    let s1 = -1;
    for (let s = 0; s <= e.len; s += 2) {
      pointAt(e, s, P);
      if (Math.abs(P[0] - cx) > 90) continue;
      creekAt(L, P[0], C);
      if (Math.abs(P[1] - C[0]) < C[1] + 7) {
        if (s0 < 0) s0 = s;
        s1 = s;
      }
    }
    if (s0 < 0) return;
    const rails: number[][] = [[], []];
    for (let s = s0; s <= s1 + 0.1; s += 4.6) {
      pointAt(e, s, P);
      const x = P[0];
      const y = P[1];
      pointAt(e, Math.min(e.len, s + 2), C);
      const a = Math.atan2(C[1] - y, C[0] - x);
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.beginPath();
      g.rect(-1.9, -10, 3.8, 20);
      g.fillStyle = (Math.round(s / 4.6) % 3) ? '#c99a62' : '#b8884f';
      g.fill();
      g.strokeStyle = th.ink;
      g.lineWidth = 0.8;
      g.stroke();
      g.restore();
      rails[0].push(x - Math.sin(a) * 9.5, y + Math.cos(a) * 9.5);
      rails[1].push(x + Math.sin(a) * 9.5, y - Math.cos(a) * 9.5);
    }
    for (const r of rails) {
      g.beginPath();
      for (let i = 0; i < r.length; i += 2) g.lineTo(r[i], r[i + 1] - 5);
      g.strokeStyle = th.ink;
      g.lineWidth = 2.8;
      g.stroke();
      g.strokeStyle = '#a8784a';
      g.lineWidth = 1.4;
      g.stroke();
      for (const i of [0, r.length - 2]) {
        g.beginPath();
        g.rect(r[i] - 1.6, r[i + 1] - 7, 3.2, 8);
        g.fillStyle = '#8a5e3a';
        g.fill();
        g.strokeStyle = th.ink;
        g.lineWidth = 0.8;
        g.stroke();
      }
    }
  }

  /** A stop, as it stands. */
  private node(g: CanvasRenderingContext2D, n: MapNode, k: number) {
    const th = this.themes[n.world];
    const held = this.holdNodes.get(n.i);
    const st = held ?? this.state.node[n.i];
    const R = this.L.regions[n.world];
    if (n.kind === 'gate') {
      const faint = st === LOCKED;
      stone(g, n.x, n.y + 2, n.r, th, faint ? 0.4 : 1);
      g.globalAlpha = faint ? 0.45 : 1;
      book(g, n.x + 9, n.y - 3, th.ink);
      g.globalAlpha = 1;
      return;
    }
    if (n.kind === 'boss') {
      stone(g, n.x, n.y, n.r, th, st === LOCKED ? 0.45 : 1);
      const art = R.def.boss?.art;
      if (art) {
        const p = portrait(art, k, st === LOCKED);
        const [bx, by] = BOSS_AT(n);
        g.globalAlpha = st === LOCKED ? 0.7 : 1;
        g.drawImage(p.c, bx + p.x, by + p.y, p.w, p.h);
        g.globalAlpha = 1;
      }
      if (st === CLEARED) {
        const [bx, by, bs] = BLOOM_AT(n);
        bloom(g, bx, by, bs, 1, th.ink);
      }
      return;
    }
    if (st === LOCKED) {
      stone(g, n.x, n.y, n.r, th, 0.38);
      return;
    }
    stone(g, n.x, n.y, n.r, th);
    if (n.kind === 'side') {
      pennant(g, n.x + n.r * 0.45, n.y - 2, n.id === 'course' ? '#5cb8ff' : '#ffd27a', th.ink);
      return;
    }
    const [bx, by, bs] = BLOOM_AT(n);
    if (n.planned) seedling(g, bx - 2, by, th.ink);
    else if (st === CLEARED) bloom(g, bx, by, bs, 1, th.ink);
    else bud(g, bx, by, 12, th.ink);
  }

  /** At night: lit windows, glints of moonlight on the creek, a few fireflies. */
  private glows(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, night: number, lights: Lights) {
    for (let i = 0; i < lights.length; i += 4) {
      const [x, y, w, h] = [lights[i], lights[i + 1], lights[i + 2], lights[i + 3]];
      g.fillStyle = '#ffd77a';
      g.globalAlpha = Math.min(1, night * 1.2);
      g.fillRect(x + 0.6, y + 0.6, w - 1.2, h - 1.2);
      halo(g, x + w / 2, y + h / 2, 10 + w, '255,214,120', night * 0.55);
    }
    g.globalAlpha = 1;
    // moonlight on the water
    g.strokeStyle = '#eef0ff';
    g.lineWidth = 1.4;
    g.globalAlpha = night * 0.75;
    g.beginPath();
    for (let gx = Math.floor(x0 / 44); gx * 44 < x1; gx++) {
      if (hash2(gx, 1, 77) > 0.55) continue;
      const x = gx * 44 + hash2(gx, 2, 77) * 20;
      creekAt(this.L, x, C);
      const y = C[0] + (hash2(gx, 3, 77) - 0.5) * C[1];
      if (y < y0 - 4 || y > y1 + 4) continue;
      g.moveTo(x, y);
      g.lineTo(x + 4 + hash2(gx, 4, 77) * 6, y);
    }
    g.stroke();
    g.globalAlpha = 1;
    // fireflies about the meadow: a soft ring and a bright dot each, two fills for all of them
    const S = 96;
    const rings = new Path2D();
    const dots = new Path2D();
    for (let cy = Math.floor(y0 / S); cy * S < y1; cy++) {
      for (let cx = Math.floor(x0 / S); cx * S < x1; cx++) {
        if (hash2(cx, cy, 61) > night * 0.5) continue;
        const x = (cx + hash2(cx, cy, 62)) * S;
        const y = (cy + hash2(cx, cy, 63)) * S;
        rings.moveTo(x + 4.5, y);
        rings.ellipse(x, y, 4.5, 4.5, 0, 0, Math.PI * 2);
        dots.moveTo(x + 1.2, y);
        dots.ellipse(x, y, 1.2, 1.2, 0, 0, Math.PI * 2);
      }
    }
    g.fillStyle = `rgba(226,255,140,${(0.28 * night).toFixed(3)})`;
    g.fill(rings);
    g.fillStyle = '#f4ffc0';
    g.fill(dots);
  }

  /** What a stop's painting covers (to paint it again when it changes). */
  nodeBox(n: MapNode): [number, number, number, number] {
    return n.kind === 'boss' ? [n.x - 80, n.y - 110, n.x + 110, n.y + 48] : [n.x - 44, n.y - 48, n.x + 48, n.y + 36];
  }
}
