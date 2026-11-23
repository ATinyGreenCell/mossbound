import { hash2 } from '../core/math';
import { isSolidTile, Tile, type LevelData } from '../game/level';
import { T, VIEW_TILES_H, VIEW_TILES_MAX_W, VIEW_TILES_MIN_W } from '../game/tuning';
import { canvasEpoch, settle } from './renderer';
import type { Theme } from './theme';
import { anchor, kitFor, kitStep, MOSS_DOWN, MOSS_UP, PLANK_H, stamp, stoneKind, stoneMossy, stretch, type Kit, type Sprite } from './tileart';

/** Tiles per chunk side. */
export const CHUNK = 8;
const CHUNK_PX = CHUNK * T;
/**
 * Memory for painted chunks. One is (256 × scale)² pixels: ~0.7 MB on a phone, ~3 MB on a screen 1600
 * pixels tall. Whatever the view needs right now is always allowed, even past this (a screen 1600 rows
 * tall zoomed out shows 24 chunks, more than 64 MB holds); around it, the newest.
 */
const BUDGET_BYTES = 64 * 1024 * 1024;
const MAX_CHUNKS = 48;
/** Chunks painted ahead of the view per frame (visible ones always paint at once): keeps scrolling smooth. */
const BAKE_BUDGET = 1;
/** Visible chunks repainted per frame after the resolution changed (until then the old ones stand in, scaled). */
const REBAKE_BUDGET = 2;

interface Chunk {
  canvas: HTMLCanvasElement;
  /** side in device pixels, as painted */
  px: number;
  /** the last frame it was on screen */
  used: number;
  /** the last frame it was in the ring just around the screen (painted ahead, about to be needed) */
  near: number;
}

/**
 * Static tiles painted into chunk canvases: drawing the level is then a handful of drawImage calls per
 * frame. Chunks are painted at the camera's full scale and drawn smaller while it zooms out (so a zoom
 * repaints nothing); after a resize or a quality change they're repainted a few a frame, the old ones
 * standing in meanwhile. Evicted least recently seen first, within a memory budget. A chunk with no
 * tile in it that this cache paints (open sky, a stretch of air over a pit) gets no canvas at all: it
 * would be a transparent square, allocated and drawn every frame for nothing.
 */
export class TileCache {
  private chunks = new Map<number, Chunk>();
  /** chunk keys known to hold nothing to paint (see emptyAt) */
  private empty = new Map<number, boolean>();
  /** side of a chunk painted now, device px */
  private px = 0;
  private frame = 0;
  /** how many chunks the view covered this frame: the cap never goes below it */
  private viewChunks = 0;
  private epoch = canvasEpoch;

  constructor(
    private readonly L: LevelData,
    private readonly theme: Theme,
  ) {}

  /**
   * Draw every chunk overlapping the view. `scale` = device px per world px now; `full` = the scale to
   * paint at (the camera's, zoomed in all the way). ox/oy: device-pixel offset of the view.
   */
  draw(ctx: CanvasRenderingContext2D, scale: number, full: number, ox: number, oy: number, viewW: number, viewH: number) {
    // the GPU let go of every canvas's pixels: paint them all again
    if (this.epoch !== canvasEpoch) {
      this.epoch = canvasEpoch;
      this.clear();
    }
    this.px = Math.max(1, Math.round(CHUNK_PX * Math.max(scale, full)));
    this.frame++;
    // a chunk on screen, in device pixels (edges rounded alike for neighbours, so no seams; with the
    // camera's scale in 1/256 steps they're whole numbers anyway, exactly on the world grid)
    const D = CHUNK_PX * scale;
    const cols = Math.ceil(this.L.w / CHUNK);
    // (a couple of chunk rows below the map: the ground carries on down there)
    const lastRow = Math.ceil(this.L.h / CHUNK) + 1;
    const cx0 = Math.max(0, Math.floor(ox / D));
    const cy0 = Math.max(0, Math.floor(oy / D));
    const cx1 = Math.min(cols - 1, Math.floor((ox + viewW) / D));
    const cy1 = Math.min(lastRow, Math.floor((oy + viewH) / D));
    this.viewChunks = Math.max(0, cx1 - cx0 + 1) * Math.max(0, cy1 - cy0 + 1);
    let rebake = REBAKE_BUDGET;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        let c = this.chunks.get(cy * 4096 + cx);
        if (!c) {
          if (this.emptyAt(cx, cy)) continue;
          c = this.bake(cx, cy);
        } else if (c.px !== this.px && rebake-- > 0) c = this.bake(cx, cy);
        c.used = this.frame;
        const x0 = Math.round(cx * D - ox);
        const y0 = Math.round(cy * D - oy);
        const w = Math.round((cx + 1) * D - ox) - x0;
        const h = Math.round((cy + 1) * D - oy) - y0;
        if (w === c.px && h === c.px) ctx.drawImage(c.canvas, x0, y0);
        else ctx.drawImage(c.canvas, x0, y0, w, h);
      }
    }
    // The ring just around the view. What's painted there already is kept: it's about to be needed.
    // Then one more of it is painted ahead — making room, when the cache is full, by letting go of a
    // chunk further off. (Stopping at "full" instead is what this used to do, and a cache fills about
    // half way along a level: from then on every chunk was painted in the frame it scrolled into view.)
    const rx0 = Math.max(0, cx0 - 1);
    const ry0 = Math.max(0, cy0 - 1);
    const rx1 = Math.min(cols - 1, cx1 + 1);
    const ry1 = Math.min(lastRow, cy1 + 1);
    for (let cy = ry0; cy <= ry1; cy++) {
      for (let cx = rx0; cx <= rx1; cx++) {
        const c = this.chunks.get(cy * 4096 + cx);
        if (c) c.near = this.frame;
      }
    }
    let budget = BAKE_BUDGET;
    for (let cy = ry0; cy <= ry1 && budget > 0; cy++) {
      for (let cx = rx0; cx <= rx1 && budget > 0; cx++) {
        if (this.chunks.has(cy * 4096 + cx) || this.emptyAt(cx, cy)) continue;
        if (this.chunks.size >= this.cap() && !this.evict(false)) {
          budget = 0;
          break;
        }
        this.bake(cx, cy).near = this.frame;
        budget--;
      }
    }
    this.trim();
  }

  /**
   * How many chunks the memory budget allows at the current size — and never fewer than the view itself
   * covers, so the screen is always whole (a 1600-row screen zoomed out shows 24 chunks of 883 px).
   */
  private cap() {
    return Math.max(4, this.viewChunks, Math.min(MAX_CHUNKS, Math.floor(BUDGET_BYTES / (this.px * this.px * 4))));
  }

  /**
   * Does chunk (cx, cy) have nothing to paint? Everything paintRegion would look at for it — its tiles
   * and the one-tile margin whose lips and blades reach into it — paints nothing. A level's static tiles
   * never change (doors, crumbling blocks and grown leaves are the session's), so this is kept.
   */
  private emptyAt(cx: number, cy: number) {
    const key = cy * 4096 + cx;
    let e = this.empty.get(key);
    if (e === undefined) {
      e = true;
      for (let ty = cy * CHUNK - 1; ty <= cy * CHUNK + CHUNK && e; ty++) {
        if (ty < 0) continue;
        for (let tx = cx * CHUNK - 1; tx <= cx * CHUNK + CHUNK && e; tx++) if (paints(tileAt(this.L, tx, ty))) e = false;
      }
      this.empty.set(key, e);
    }
    return e;
  }

  private bake(cx: number, cy: number): Chunk {
    const key = cy * 4096 + cx;
    const px = this.px;
    const old = this.chunks.get(key);
    const canvas = old?.canvas ?? document.createElement('canvas');
    // (resizing a canvas clears it)
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d')!;
    const k = px / CHUNK_PX;
    ctx.setTransform(k, 0, 0, k, -cx * CHUNK_PX * k, -cy * CHUNK_PX * k);
    paintRegion(ctx, this.L, this.theme, k, cx * CHUNK - 1, cy * CHUNK - 1, cx * CHUNK + CHUNK, cy * CHUNK + CHUNK);
    const c = { canvas, px, used: this.frame, near: old?.near ?? 0 };
    this.chunks.set(key, c);
    return c;
  }

  /**
   * Let go of the chunk seen longest ago — never one on screen now, and one in the ring around it only
   * when `near` allows. False when there's none to let go of.
   */
  private evict(near: boolean) {
    let oldest = -1;
    let age = Infinity;
    for (const [k, c] of this.chunks) {
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

  /** Over budget: let go of the chunks seen longest ago — off in the distance first, then the ring. */
  private trim() {
    const cap = this.cap();
    while (this.chunks.size > cap) if (!this.evict(false) && !this.evict(true)) return;
  }

  private drop(key: number) {
    const c = this.chunks.get(key);
    if (!c) return;
    // (zero-size gives the memory back now rather than whenever the garbage collector gets to it)
    c.canvas.width = c.canvas.height = 0;
    this.chunks.delete(key);
  }

  /**
   * A step more of getting the tiles ready to paint at the camera's full scale (see tilesStep): true
   * once they are. A level entered without its scenery painted calls this a frame at a time.
   */
  prepare(full: number, screen: CanvasRenderingContext2D) {
    return tilesStep(this.theme, Math.max(1, Math.round(CHUNK_PX * full)) / CHUNK_PX, screen);
  }

  /**
   * Paint one more of the chunks the view (as draw takes it) would show and hasn't got yet, and have the
   * GPU paint it now (see settle): true once it has them all. Behind a level's curtain, a step at a time,
   * so the frame that lifts the curtain only draws them.
   */
  prebake(scale: number, full: number, ox: number, oy: number, viewW: number, viewH: number) {
    if (this.epoch !== canvasEpoch) {
      this.epoch = canvasEpoch;
      this.clear();
    }
    this.px = Math.max(1, Math.round(CHUNK_PX * Math.max(scale, full)));
    const D = CHUNK_PX * scale;
    const cx1 = Math.min(Math.ceil(this.L.w / CHUNK) - 1, Math.floor((ox + viewW) / D));
    const cy1 = Math.min(Math.ceil(this.L.h / CHUNK) + 1, Math.floor((oy + viewH) / D));
    for (let cy = Math.max(0, Math.floor(oy / D)); cy <= cy1; cy++) {
      for (let cx = Math.max(0, Math.floor(ox / D)); cx <= cx1; cx++) {
        const c = this.chunks.get(cy * 4096 + cx);
        if ((c && c.px === this.px) || this.emptyAt(cx, cy)) continue;
        settle(this.bake(cx, cy).canvas);
        return false;
      }
    }
    return true;
  }

  /** Let go of everything (the level is over, or the pixels are gone). */
  clear() {
    for (const k of [...this.chunks.keys()]) this.drop(k);
  }
}

let soon: ReturnType<typeof setTimeout> | undefined;

/**
 * Get a theme's tiles ready for a W × H screen in a moment (see prepareTiles). The backdrop asks as it
 * paints a theme's scenery — the level select paints a level's before play starts — so the first frame
 * of the level doesn't also pay for the kit, nor the frame the scenery was painted in. Asked again
 * before then (the level select scrolled on to another level), only the latest is got ready.
 */
export function prepareTilesSoon(th: Theme, W: number, H: number, screen: CanvasRenderingContext2D) {
  clearTimeout(soon);
  const k = tileScale(W, H);
  // (a step a task: what's drawn between them stays smooth)
  const step = () => {
    if (!tilesStep(th, k, screen)) soon = setTimeout(step, 0);
  };
  soon = setTimeout(step, 150);
}

/**
 * Stop getting tiles ready on the side: a level's curtain is up, and it gets them ready itself, a step a
 * frame (a few tasks' steps between two of its frames would make one long frame of them).
 */
export function stopTilesSoon() {
  clearTimeout(soon);
}

/** Device px per world px the tiles of a W × H screen are painted at (as the camera works it out, zoomed in all the way). */
function tileScale(W: number, H: number) {
  let s = H / (VIEW_TILES_H * T);
  s = Math.min(s, W / (VIEW_TILES_MIN_W * T));
  s = Math.max(s, W / (VIEW_TILES_MAX_W * T));
  s = Math.max(1, Math.round(s * 256)) / 256;
  return Math.max(1, Math.round(CHUNK_PX * s)) / CHUNK_PX;
}

/**
 * A step more of getting a theme's tiles ready at k device px per world px: a piece of its kit, or the
 * warm-up (a scrap of level painted with the kit, so whatever the GPU sets up the first time it draws
 * a pattern, a stretched picture or a blend is set up then, not in the first frame of play). True
 * once there's nothing left to do.
 */
export function tilesStep(th: Theme, k: number, screen?: CanvasRenderingContext2D): boolean {
  if (!th.layers.length || th.id === 'creek') return true;
  const kit = kitStep(th, k);
  if (!kit) return false;
  if (warmed === kit) return true;
  // (the warm-up a step of its own, not on top of the kit's last)
  if (seen !== kit) {
    seen = kit;
    return false;
  }
  warmed = kit;
  const L = { w: 4, h: 3, tiles: new Uint8Array([0, 0, 0, 0, 0, Tile.Ground, Tile.Ground, Tile.Plank, 0, Tile.Ground, Tile.Spikes, 0]), soilAt: new Int16Array(12).fill(-1) } as unknown as LevelData;
  scrap ??= document.createElement('canvas');
  scrap.width = scrap.height = 32;
  const g = scrap.getContext('2d')!;
  g.setTransform(32 / (4 * T), 0, 0, 32 / (4 * T), 0, 0);
  paintRegion(g, L, th, k, -1, -1, 4, 3);
  // (and the scrap drawn onto the screen, too faint to see: a canvas never drawn anywhere is never
  // painted at all, and the GPU would meet all of it for the first time in the first frame of play)
  if (screen) {
    screen.save();
    screen.setTransform(1, 0, 0, 1, 0, 0);
    screen.globalAlpha = 0.004;
    screen.drawImage(scrap, 0, 0, 8, 8);
    screen.restore();
  }
  return false;
}

/** the last kit prepareTiles warmed up (and the last it saw finished), and the scrap of canvas it was warmed up on */
let warmed: Kit | null = null;
let seen: Kit | null = null;
let scrap: HTMLCanvasElement | null = null;

/** Does paintRegion paint this tile? (Doors, crumbling blocks and grown leaves come and go: the session draws those.) */
const paints = (t: Tile) => t !== Tile.Empty && t !== Tile.Door && t !== Tile.Crumble && t !== Tile.Leaf;

// ------------------------------------------------------------------ tile painting

const solidAt = (L: LevelData, tx: number, ty: number): boolean => {
  if (tx < 0 || tx >= L.w) return true;
  if (ty < 0) return false;
  // the ground carries on below the map wherever the bottom row is solid
  if (ty >= L.h) return isSolidTile(L.tiles[(L.h - 1) * L.w + tx]);
  return isSolidTile(L.tiles[ty * L.w + tx]);
};

const tileAt = (L: LevelData, tx: number, ty: number) => {
  if (tx < 0 || tx >= L.w || ty < 0) return Tile.Empty;
  if (ty >= L.h) {
    const b = L.tiles[(L.h - 1) * L.w + tx];
    return isSolidTile(b) ? b : Tile.Empty;
  }
  return L.tiles[ty * L.w + tx];
};

/** A patch of soil (the session draws it, and what grows from it): bare earth, no moss. */
const soilPatch = (L: LevelData, tx: number, ty: number) => ty < L.h && L.soilAt[ty * L.w + tx] >= 0;

/** Does this tile wear the moss cushion along its top? */
const mossTop = (L: LevelData, th: Theme, tx: number, ty: number) => {
  if (ty < 0 || solidAt(L, tx, ty - 1)) return false;
  const t = tileAt(L, tx, ty);
  return t === Tile.Ground ? !soilPatch(L, tx, ty) : t === Tile.Stone && stoneMossy(th);
};

/** One of a sprite's variants, chosen by the tile. */
const pick = (list: Sprite[], tx: number, ty: number, salt: number) => list[Math.floor(hash2(tx, ty, salt) * list.length)];

/** How dark the earth gets `d` tiles under the surface (the alpha of the theme's `deep` over it). */
const DARK = (d: number) => 0.46 * (1 - Math.exp(-d / 3.2));
/** how deep that's reckoned (deeper is as dark) */
const DEPTH_MAX = 8;

let shade: { c: HTMLCanvasElement; g: CanvasRenderingContext2D; img: ImageData } | null = null;

/**
 * Paint tiles in [x0, x1] × [y0, y1] — a chunk and the one-tile margin round it whose moss, drips and
 * strands reach into it — with the world transform set up at k device px per world px.
 *
 * Bodies first (soil, rock, crates, vents), then shading laid over only what's painted (the earth
 * darkening with depth, a dark rim along every exposed face, the shade under the moss), then the tops
 * a row at a time (rootlets, the moss cushion and its rounded ends, tufts and flowers, moss creeping down
 * faces and hanging off overhangs, planks), and the thorns over everything. All of it from the world's
 * tile coordinates and hashes of them, in the same order in every chunk: what a chunk paints in its
 * margin is exactly what its neighbour paints there.
 */
export function paintRegion(ctx: CanvasRenderingContext2D, L: LevelData, th: Theme, k: number, x0: number, y0: number, x1: number, y1: number) {
  const kit = kitFor(th, k);
  const s = kit.s;
  // Edges on the device's pixel grid: neighbouring fills meet exactly, with no seam of half-covered
  // pixels between them (the chunk's own origin is a whole pixel).
  const sn = (v: number) => Math.round(v * k) / k;
  const ya = Math.max(0, y0);
  const earth = anchor(kit.earth, 0, 0);
  const rock = kit.stone ? anchor(kit.stone, 0, 0) : null;

  // ---- bodies: a run of the same tile at a time, rounded where two open sides meet
  for (let ty = ya; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; ) {
      const t = tileAt(L, tx, ty);
      if (t === Tile.Ground || (t === Tile.Stone && rock)) {
        let ex = tx;
        while (ex < x1 && tileAt(L, ex + 1, ty) === t) ex++;
        ctx.fillStyle = t === Tile.Ground ? earth : rock!;
        bodyRun(ctx, L, t === Tile.Ground ? 7 : 5, tx, ex, ty, sn);
        tx = ex + 1;
        continue;
      }
      if (t === Tile.Stone) stamp(ctx, kit, s.crate[0], tx * T, ty * T);
      else if (t === Tile.Vent) stamp(ctx, kit, s.vent[0], tx * T, ty * T);
      tx++;
    }
  }

  // ---- pebbles in the earth, then shading: all of it over the bodies only
  ctx.globalCompositeOperation = 'source-atop';
  if (th.ground.kind === 'soil') {
    for (let ty = ya; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tileAt(L, tx, ty) !== Tile.Ground || hash2(tx, ty, 51) > 0.42) continue;
        // (clear of the moss on a top)
        const top = !solidAt(L, tx, ty - 1);
        stamp(ctx, kit, pick(s.gravel, tx, ty, 52), tx * T + 8 + hash2(tx, ty, 53) * 16, ty * T + (top ? 20 + hash2(tx, ty, 54) * 6 : 6 + hash2(tx, ty, 54) * 20));
      }
    }
  }
  shadeDepth(ctx, L, th, x0 + 1, y0 + 1);
  for (let ty = ya; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const t = tileAt(L, tx, ty);
      if (t !== Tile.Ground && !(t === Tile.Stone && rock)) continue;
      const x = tx * T;
      const y = ty * T;
      const X0 = sn(x);
      const X1 = sn(x + T);
      const Y0 = sn(y);
      const Y1 = sn(y + T);
      if (!solidAt(L, tx - 1, ty)) stretch(ctx, kit, s.edgeL[0], X0, Y0, sn(x + 9) - X0, Y1 - Y0);
      if (!solidAt(L, tx + 1, ty)) stretch(ctx, kit, s.edgeR[0], sn(x + T - 9), Y0, X1 - sn(x + T - 9), Y1 - Y0);
      if (!solidAt(L, tx, ty + 1)) stretch(ctx, kit, s.edgeB[0], X0, sn(y + T - 9), X1 - X0, Y1 - sn(y + T - 9));
      if (mossTop(L, th, tx, ty)) stretch(ctx, kit, s.shade[0], X0, y + 11, X1 - X0, 18);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // ---- tops, faces, undersides and planks, a row at a time
  for (let ty = ya; ty <= y1; ty++) {
    const y = ty * T;
    // moss spreading into the earth and rootlets, under where the cushion goes
    for (let tx = x0; tx <= x1; tx++) {
      if (tileAt(L, tx, ty) !== Tile.Ground || !mossTop(L, th, tx, ty)) continue;
      if (hash2(tx, ty, 60) < 0.8) stamp(ctx, kit, pick(s.creep, tx, ty, 59), tx * T, y);
      if (hash2(tx, ty, 61) < 0.5) stamp(ctx, kit, pick(s.root, tx, ty, 62), tx * T, y);
    }
    // the moss cushion, a run at a time, with a rounded end wherever the run really ends (not where
    // this region cuts it off)
    for (let tx = x0; tx <= x1; ) {
      if (!mossTop(L, th, tx, ty)) {
        tx++;
        continue;
      }
      let ex = tx;
      while (ex < x1 && mossTop(L, th, ex + 1, ty)) ex++;
      const endL = !mossTop(L, th, tx - 1, ty);
      const endR = !mossTop(L, th, ex + 1, ty);
      const a = sn(tx * T + (endL ? 6 : 0));
      const b = sn((ex + 1) * T - (endR ? 6 : 0));
      ctx.fillStyle = anchor(kit.moss, 0, y - MOSS_UP);
      ctx.fillRect(a, y - MOSS_UP, b - a, MOSS_UP + MOSS_DOWN);
      if (endL) stamp(ctx, kit, pick(s.capL, tx, ty, 63), tx * T, y);
      if (endR) stamp(ctx, kit, pick(s.capR, ex, ty, 63), (ex + 1) * T, y);
      tx = ex + 1;
    }
    // planks: a strip a run, its ends sawn
    for (let tx = x0; tx <= x1; ) {
      if (tileAt(L, tx, ty) !== Tile.Plank) {
        tx++;
        continue;
      }
      let ex = tx;
      while (ex < x1 && tileAt(L, ex + 1, ty) === Tile.Plank) ex++;
      const a = sn(tx * T);
      ctx.fillStyle = anchor(kit.plank, 0, y);
      ctx.fillRect(a, y, sn((ex + 1) * T) - a, PLANK_H);
      if (tileAt(L, tx - 1, ty) !== Tile.Plank) stamp(ctx, kit, s.plankL[0], tx * T, y);
      if (tileAt(L, ex + 1, ty) !== Tile.Plank) stamp(ctx, kit, s.plankR[0], (ex + 1) * T, y);
      tx = ex + 1;
    }
    // what grows on the tops, creeps down the faces and hangs off the undersides
    for (let tx = x0; tx <= x1; tx++) {
      const t = tileAt(L, tx, ty);
      const mossy = t === Tile.Ground || (t === Tile.Stone && stoneMossy(th));
      if (!mossy) {
        if (t === Tile.Stone && stoneKind(th) === 'bark' && !solidAt(L, tx, ty - 1)) stamp(ctx, kit, s.ring[0], tx * T, y);
        continue;
      }
      const x = tx * T;
      if (mossTop(L, th, tx, ty) && tileAt(L, tx, ty - 1) === Tile.Empty) decorate(ctx, kit, th, tx, ty, x, y);
      const lf = tileAt(L, tx - 1, ty) === Tile.Empty && !solidAt(L, tx - 1, ty);
      const rt = tileAt(L, tx + 1, ty) === Tile.Empty && !solidAt(L, tx + 1, ty);
      if (lf || rt) {
        // how far down the face this is: moss creeps furthest near the top
        let dep = 0;
        while (dep < 4 && solidAt(L, tx, ty - 1 - dep)) dep++;
        const chance = [0.9, 0.7, 0.5, 0.32, 0.2][dep];
        if (lf) face(ctx, kit, s.dripL, s.pebL, tx, ty, x, y, dep, chance, 0);
        if (rt) face(ctx, kit, s.dripR, s.pebR, tx, ty, x + T, y, dep, chance, 1);
      }
      if (tileAt(L, tx, ty + 1) === Tile.Empty && !solidAt(L, tx, ty + 1) && hash2(tx, ty, 71) < 0.8) stamp(ctx, kit, pick(s.strand, tx, ty, 72), x, y + T);
    }
  }

  // ---- thorns, over everything
  for (let ty = ya; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const t = tileAt(L, tx, ty);
      if (t === Tile.Spikes) stamp(ctx, kit, s.thorn[0], tx * T, ty * T + T);
      else if (t === Tile.CeilSpikes) stamp(ctx, kit, s.thornC[0], tx * T, ty * T);
    }
  }
}

/** A run of ground (or rock) from tile ax to bx in row ty, its corners rounded where two open sides meet. */
function bodyRun(ctx: CanvasRenderingContext2D, L: LevelData, R: number, ax: number, bx: number, ty: number, sn: (v: number) => number) {
  const y = ty * T;
  const lf = !solidAt(L, ax - 1, ty);
  const rt = !solidAt(L, bx + 1, ty);
  const tl = lf && !solidAt(L, ax, ty - 1) ? R : 0;
  const bl = lf && !solidAt(L, ax, ty + 1) ? R : 0;
  const tr = rt && !solidAt(L, bx, ty - 1) ? R : 0;
  const br = rt && !solidAt(L, bx, ty + 1) ? R : 0;
  const X0 = sn(ax * T);
  const X1 = sn((bx + 1) * T);
  const Y0 = sn(y);
  const Y1 = sn(y + T);
  if (!(tl || tr || br || bl)) {
    ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(X0 + tl, Y0);
  ctx.lineTo(X1 - tr, Y0);
  if (tr) ctx.quadraticCurveTo(X1, Y0, X1, Y0 + tr);
  ctx.lineTo(X1, Y1 - br);
  if (br) ctx.quadraticCurveTo(X1, Y1, X1 - br, Y1);
  ctx.lineTo(X0 + bl, Y1);
  if (bl) ctx.quadraticCurveTo(X0, Y1, X0, Y1 - bl);
  ctx.lineTo(X0, Y0 + tl);
  if (tl) ctx.quadraticCurveTo(X0, Y0, X0 + tl, Y0);
  ctx.closePath();
  ctx.fill();
}

/**
 * The earth darkening with depth, over the chunk whose top-left tile is (cx0, cy0): a darkness for every
 * tile corner (from how deep under the surface the tiles meeting there are), stretched smoothly over the
 * chunk in one drawImage. A corner's darkness comes from the tiles alone, so neighbouring chunks agree
 * along their shared edge.
 */
function shadeDepth(ctx: CanvasRenderingContext2D, L: LevelData, th: Theme, cx0: number, cy0: number) {
  const N = CHUNK + 2;
  const dep = new Int8Array(N * N).fill(-1);
  let solid = false;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const tx = cx0 - 1 + i;
      const ty = cy0 - 1 + j;
      if (!solidAt(L, tx, ty)) continue;
      let d = 0;
      while (d < DEPTH_MAX && solidAt(L, tx, ty - 1 - d)) d++;
      dep[j * N + i] = d;
      solid = true;
    }
  }
  if (!solid) return;
  const n = CHUNK + 1;
  if (!shade) {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d')!;
    shade = { c, g, img: g.createImageData(n, n) };
  }
  const data = shade.img.data;
  const [r, gr, b] = rgbOf(th.ground.deep);
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      // the tiles meeting at this corner: the two above it (at their bottoms), the two below (at their tops)
      let sum = 0;
      let cnt = 0;
      for (let q = 0; q < 4; q++) {
        const i = gx + (q & 1);
        const j = gy + (q >> 1);
        const d = dep[j * N + i];
        if (d < 0) continue;
        sum += DARK(q < 2 ? d + 1 : d);
        cnt++;
      }
      const o = (gy * n + gx) * 4;
      data[o] = r;
      data[o + 1] = gr;
      data[o + 2] = b;
      data[o + 3] = cnt ? Math.round((sum / cnt) * 255) : 0;
    }
  }
  shade.g.putImageData(shade.img, 0, 0);
  // (from the first corner's centre to the last's: every pixel of the chunk lies between four of them)
  ctx.drawImage(shade.c, 0.5, 0.5, CHUNK, CHUNK, cx0 * T, cy0 * T, CHUNK * T, CHUNK * T);
}

const rgbOf = (c: string) => {
  const v = parseInt(c.slice(1, 7), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** Moss creeping down an open face from its top (a long way near the top of the face), and a pebble set in it. */
function face(ctx: CanvasRenderingContext2D, kit: Kit, drips: Sprite[], pebs: Sprite[], tx: number, ty: number, x: number, y: number, dep: number, chance: number, side: number) {
  if (hash2(tx, ty, 73 + side) < chance) stamp(ctx, kit, pick(drips, tx, ty, 75 + side), x, y + (dep ? 1 + hash2(tx, ty, 77 + side) * 12 : 19));
  if (hash2(tx, ty, 79 + side) < 0.22) stamp(ctx, kit, pick(pebs, tx, ty, 81 + side), x, y + 8 + hash2(tx, ty, 83 + side) * 18);
}

/** Tufts, flowers and the theme's own things (mushrooms, ferns, toadstools, pebbles) on a top. */
function decorate(ctx: CanvasRenderingContext2D, kit: Kit, th: Theme, tx: number, ty: number, x: number, y: number) {
  const s = kit.s;
  if (hash2(tx, ty, 85) < 0.55) stamp(ctx, kit, pick(s.tuft, tx, ty, 86), x + 4 + hash2(tx, ty, 87) * 24, y + 1);
  const at = x + 6 + hash2(tx, ty, 98) * 20;
  if (s.bloom && hash2(tx, ty, 99) < 0.24) stamp(ctx, kit, pick(s.bloom, tx, ty, 97), at, y + 1);
  else if (s.glow && hash2(tx, ty, 95) < 0.08) stamp(ctx, kit, s.glow[0], at, y + 1);
  else if (s.decor && hash2(tx, ty, 94) < (th.id === 'woods' ? 0.14 : th.id === 'mill' ? 0.12 : 0.2)) stamp(ctx, kit, pick(s.decor, tx, ty, 96), at, y + 1);
}
