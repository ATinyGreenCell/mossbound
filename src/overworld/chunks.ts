/**
 * The map's painted pieces: squares CHUNK map units a side, painted once and kept while they're near
 * the view (the same idea as render/tiles.ts's TileCache, which this follows).
 *
 * A frame draws the chunks under the view — painting any that are missing — and paints at most one
 * more just outside it, ahead of the camera. Past a memory budget the chunks seen longest ago are let
 * go. So a map of fifty worlds costs a frame exactly what a map of three does: the view is the same
 * size, and nothing off it is touched. A chunk whose content changed (a level cleared: a bloom, a path
 * opening) is painted again while it stays on screen, a couple a frame, the old one standing in.
 *
 * The bookkeeping is here and knows nothing of canvases (tests/e2e/overworld.mjs runs it in node with
 * a pretend painter); paint.ts does the painting.
 */

/** A chunk's side, map units. */
export const CHUNK = 256;
/** chunks painted ahead of the view per frame (the ones on screen are always painted at once) */
const AHEAD = 1;
/** visible chunks repainted per frame after a resize or a change (the old ones stand in meanwhile) */
const REPAINT = 2;

export interface ChunkPainter<C> {
  /** paint chunk (cx, cy), `px` device pixels a side, reusing `old` (its canvas) when given */
  bake(cx: number, cy: number, px: number, old: C | null): C;
  /** let go of it (give its memory back) */
  free(c: C): void;
}

export interface Chunk<C> {
  cx: number;
  cy: number;
  c: C;
  /** side as painted, device px */
  px: number;
  /** the last frame it was on screen; the last frame it was just around it */
  used: number;
  near: number;
  /** what's on it changed: paint it again */
  dirty: boolean;
}

export interface ChunkStats {
  live: number;
  peak: number;
  bakes: number;
  /** painted this frame */
  frameBakes: number;
  /** time spent painting: all of it, the last one, the slowest one */
  bakeMs: number;
  lastBakeMs: number;
  maxBakeMs: number;
  /** on screen this frame */
  visible: number;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class ChunkCache<C> {
  private readonly map = new Map<number, Chunk<C>>();
  private frame = 0;
  private viewChunks = 0;
  private px = 0;
  /** the chunks on screen this frame, in drawing order */
  readonly vis: Chunk<C>[] = [];
  readonly stats: ChunkStats = { live: 0, peak: 0, bakes: 0, frameBakes: 0, bakeMs: 0, lastBakeMs: 0, maxBakeMs: 0, visible: 0 };

  constructor(
    private readonly painter: ChunkPainter<C>,
    /** memory for painted chunks: a 512-px chunk is 1 MB */
    private readonly budget = 56 * 1024 * 1024,
    private readonly maxChunks = 48,
  ) {}

  static key(cx: number, cy: number) {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  /** How many the budget allows at this size — never fewer than the view needs. */
  cap() {
    return Math.max(4, this.viewChunks, Math.min(this.maxChunks, Math.floor(this.budget / Math.max(1, this.px * this.px * 4))));
  }

  /**
   * The chunks under x0..x1 × y0..y1 (map units), painted `px` device pixels a side: in `vis`. (hx, hy):
   * which way the camera is heading, to paint ahead of it.
   */
  view(x0: number, y0: number, x1: number, y1: number, px: number, hx = 0, hy = 0): Chunk<C>[] {
    this.frame++;
    this.px = px;
    this.stats.frameBakes = 0;
    const vis = this.vis;
    vis.length = 0;
    const cx0 = Math.floor(x0 / CHUNK);
    const cy0 = Math.floor(y0 / CHUNK);
    const cx1 = Math.floor(x1 / CHUNK);
    const cy1 = Math.floor(y1 / CHUNK);
    this.viewChunks = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    let repaint = REPAINT;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        let c = this.map.get(ChunkCache.key(cx, cy));
        if (!c) c = this.bake(cx, cy, null);
        else if ((c.dirty || c.px !== px) && repaint-- > 0) c = this.bake(cx, cy, c);
        c.used = this.frame;
        vis.push(c);
      }
    }
    // the ring around the view: keep what's there, and paint one more of it — the one furthest the
    // way the camera is heading (hx, hy), so the next column is ready before it scrolls in
    const mx = (cx0 + cx1) / 2;
    const my = (cy0 + cy1) / 2;
    let best = -Infinity;
    let bx = 0;
    let by = 0;
    for (let cy = cy0 - 1; cy <= cy1 + 1; cy++) {
      for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) {
        if (cy > cy0 - 1 && cy < cy1 + 1 && cx > cx0 - 1 && cx < cx1 + 1) continue;
        const c = this.map.get(ChunkCache.key(cx, cy));
        if (c) c.near = this.frame;
        if (c && c.px === px && !c.dirty) continue;
        const score = (cx - mx) * hx + (cy - my) * hy;
        if (score > best) {
          best = score;
          bx = cx;
          by = cy;
        }
      }
    }
    if (best > -Infinity && this.stats.frameBakes < AHEAD) {
      const c = this.map.get(ChunkCache.key(bx, by));
      if (c || this.map.size < this.cap() || this.evict(false)) this.bake(bx, by, c ?? null).near = this.frame;
    }
    this.trim();
    this.stats.live = this.map.size;
    this.stats.peak = Math.max(this.stats.peak, this.map.size);
    this.stats.visible = vis.length;
    return vis;
  }

  /** What's painted under x0..x1 × y0..y1 changed: on screen, paint it again soon; off it, forget it. */
  invalidate(x0: number, y0: number, x1: number, y1: number) {
    for (const [k, c] of this.map) {
      const ax = c.cx * CHUNK;
      const ay = c.cy * CHUNK;
      if (ax > x1 || ay > y1 || ax + CHUNK < x0 || ay + CHUNK < y0) continue;
      if (c.used >= this.frame - 1) c.dirty = true;
      else this.drop(k);
    }
  }

  /** Is anything under x0..x1 × y0..y1 still waiting to be painted again? */
  pending(x0: number, y0: number, x1: number, y1: number) {
    for (const c of this.map.values()) {
      if (!c.dirty) continue;
      const ax = c.cx * CHUNK;
      const ay = c.cy * CHUNK;
      if (!(ax > x1 || ay > y1 || ax + CHUNK < x0 || ay + CHUNK < y0)) return true;
    }
    return false;
  }

  private bake(cx: number, cy: number, old: Chunk<C> | null): Chunk<C> {
    const t0 = now();
    const c = this.painter.bake(cx, cy, this.px, old?.c ?? null);
    const ms = now() - t0;
    const s = this.stats;
    s.bakes++;
    s.frameBakes++;
    s.bakeMs += ms;
    s.lastBakeMs = ms;
    s.maxBakeMs = Math.max(s.maxBakeMs, ms);
    const e: Chunk<C> = { cx, cy, c, px: this.px, used: this.frame, near: old?.near ?? 0, dirty: false };
    this.map.set(ChunkCache.key(cx, cy), e);
    return e;
  }

  /** Let go of the chunk seen longest ago: never one on screen, one just around it only if `near`. */
  private evict(near: boolean) {
    let oldest = -1;
    let age = Infinity;
    for (const [k, c] of this.map) {
      if (c.used === this.frame || (!near && c.near === this.frame)) continue;
      if (c.used < age) {
        age = c.used;
        oldest = k;
      }
    }
    if (oldest < 0) return false;
    this.drop(oldest);
    return true;
  }

  private trim() {
    const cap = this.cap();
    while (this.map.size > cap) if (!this.evict(false) && !this.evict(true)) return;
  }

  private drop(k: number) {
    const c = this.map.get(k);
    if (!c) return;
    this.painter.free(c.c);
    this.map.delete(k);
  }

  /** Let go of everything. */
  clear() {
    for (const k of [...this.map.keys()]) this.drop(k);
    this.stats.live = 0;
  }

  get size() {
    return this.map.size;
  }
}
