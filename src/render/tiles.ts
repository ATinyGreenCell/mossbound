import { hash2, TAU } from '../core/math';
import { isSolidTile, Tile, type LevelData } from '../game/level';
import { T } from '../game/tuning';
import { canvasEpoch } from './renderer';
import type { Theme } from './theme';

/** Tiles per chunk side. */
export const CHUNK = 8;
const CHUNK_PX = CHUNK * T;
/**
 * Memory for painted chunks. One is (256 × scale)² pixels: ~0.7 MB on a phone, ~3 MB on a screen 1600
 * pixels tall. Whatever the view needs right now is kept even past this; around it, the newest.
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
  used: number;
}

/**
 * Static tiles painted into chunk canvases: drawing the level is then a handful of drawImage calls per
 * frame. Chunks are painted at the camera's full scale and drawn smaller while it zooms out (so a zoom
 * repaints nothing); after a resize or a quality change they're repainted a few a frame, the old ones
 * standing in meanwhile. Evicted least recently seen first, within a memory budget.
 */
export class TileCache {
  private chunks = new Map<number, Chunk>();
  /** side of a chunk painted now, device px */
  private px = 0;
  private frame = 0;
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
    const cx0 = Math.max(0, Math.floor(ox / D));
    const cy0 = Math.max(0, Math.floor(oy / D));
    const cx1 = Math.min(Math.ceil(this.L.w / CHUNK) - 1, Math.floor((ox + viewW) / D));
    // (a couple of chunk rows below the map: the ground carries on down there)
    const cy1 = Math.min(Math.ceil(this.L.h / CHUNK) + 1, Math.floor((oy + viewH) / D));
    let rebake = REBAKE_BUDGET;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        let c = this.chunks.get(cy * 4096 + cx);
        if (!c || (c.px !== this.px && rebake-- > 0)) c = this.bake(cx, cy);
        c.used = this.frame;
        const x0 = Math.round(cx * D - ox);
        const y0 = Math.round(cy * D - oy);
        const w = Math.round((cx + 1) * D - ox) - x0;
        const h = Math.round((cy + 1) * D - oy) - y0;
        if (w === c.px && h === c.px) ctx.drawImage(c.canvas, x0, y0);
        else ctx.drawImage(c.canvas, x0, y0, w, h);
      }
    }
    // paint the ring around the view while there's room
    let budget = BAKE_BUDGET;
    for (let cy = Math.max(0, cy0 - 1); cy <= cy1 + 1 && budget > 0; cy++) {
      for (let cx = Math.max(0, cx0 - 1); cx <= cx1 + 1 && budget > 0; cx++) {
        if (cx >= Math.ceil(this.L.w / CHUNK) || cy > Math.ceil(this.L.h / CHUNK) + 1 || this.chunks.has(cy * 4096 + cx)) continue;
        if (this.chunks.size >= this.cap()) break;
        this.bake(cx, cy);
        budget--;
      }
    }
    this.trim();
  }

  /** How many chunks the memory budget allows at the current size. */
  private cap() {
    return Math.max(4, Math.min(MAX_CHUNKS, Math.floor(BUDGET_BYTES / (this.px * this.px * 4))));
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
    paintRegion(ctx, this.L, this.theme, cx * CHUNK - 1, cy * CHUNK - 1, cx * CHUNK + CHUNK, cy * CHUNK + CHUNK);
    const c = { canvas, px, used: this.frame };
    this.chunks.set(key, c);
    return c;
  }

  /** Over budget: let go of the chunks seen longest ago (never one on screen now). */
  private trim() {
    const cap = this.cap();
    while (this.chunks.size > cap) {
      let oldest = -1;
      let age = this.frame;
      for (const [k, c] of this.chunks) {
        if (c.used < age) {
          age = c.used;
          oldest = k;
        }
      }
      if (oldest < 0) return;
      this.drop(oldest);
    }
  }

  private drop(key: number) {
    const c = this.chunks.get(key);
    if (!c) return;
    // (zero-size gives the memory back now rather than whenever the garbage collector gets to it)
    c.canvas.width = c.canvas.height = 0;
    this.chunks.delete(key);
  }

  /** Let go of everything (the level is over, or the pixels are gone). */
  clear() {
    for (const k of [...this.chunks.keys()]) this.drop(k);
  }
}

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

function roundedTilePath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tl: number, tr: number, br: number, bl: number) {
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + s - tr, y);
  if (tr) ctx.quadraticCurveTo(x + s, y, x + s, y + tr);
  ctx.lineTo(x + s, y + s - br);
  if (br) ctx.quadraticCurveTo(x + s, y + s, x + s - br, y + s);
  ctx.lineTo(x + bl, y + s);
  if (bl) ctx.quadraticCurveTo(x, y + s, x, y + s - bl);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

/** Paint tiles in [x0, x1] × [y0, y1] (world transform already set up). */
export function paintRegion(ctx: CanvasRenderingContext2D, L: LevelData, th: Theme, x0: number, y0: number, x1: number, y1: number) {
  // pass 1: bodies; pass 2: lips and decorations on top (so they overlap neighbours cleanly)
  for (let pass = 0; pass < 2; pass++) {
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (ty < 0) continue;
        const t = tileAt(L, tx, ty);
        if (t === Tile.Empty || t === Tile.Door || t === Tile.Crumble) continue;
        const x = tx * T;
        const y = ty * T;
        if (t === Tile.Ground) paintGround(ctx, L, th, tx, ty, x, y, pass);
        else if (t === Tile.Stone) {
          if (pass === 0) paintStone(ctx, L, th, tx, ty, x, y);
        } else if (t === Tile.Vent) {
          if (pass === 0) paintVent(ctx, th, x, y);
        } else if (pass === 1) {
          if (t === Tile.Plank) paintPlank(ctx, L, th, tx, ty, x, y);
          else if (t === Tile.Spikes) paintSpikes(ctx, th, x, y, false);
          else if (t === Tile.CeilSpikes) paintSpikes(ctx, th, x, y, true);
        }
      }
    }
  }
}

function paintGround(ctx: CanvasRenderingContext2D, L: LevelData, th: Theme, tx: number, ty: number, x: number, y: number, pass: number) {
  const p = th.ground;
  const up = !solidAt(L, tx, ty - 1);
  const dn = !solidAt(L, tx, ty + 1);
  const lf = !solidAt(L, tx - 1, ty);
  const rt = !solidAt(L, tx + 1, ty);
  const R = 7;
  if (th.id === 'tower') return paintGirder(ctx, th, x, y, up, dn, lf, rt, pass, tx, ty);
  if (pass === 0) {
    // body, rounded where two exposed sides meet
    roundedTilePath(ctx, x - 0.3, y - 0.3, T + 0.6, up && lf ? R : 0, up && rt ? R : 0, dn && rt ? R : 0, dn && lf ? R : 0);
    ctx.fillStyle = p.body;
    ctx.fill();
    if (th.id === 'paris') {
      paintFacade(ctx, th, tx, ty, x, y, up, dn);
    } else if (th.id === 'mill') {
      // stone wall courses
      ctx.strokeStyle = p.bodyDark;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const off = (ty & 1) * (T / 2);
      ctx.moveTo(x, y + T / 2);
      ctx.lineTo(x + T, y + T / 2);
      ctx.moveTo(x + off + 0.5, y);
      ctx.lineTo(x + off + 0.5, y + T / 2);
      ctx.moveTo(x + ((off + T / 2) % T) + 0.5, y + T / 2);
      ctx.lineTo(x + ((off + T / 2) % T) + 0.5, y + T);
      ctx.stroke();
    } else {
      // specks and pebbles
      for (let k = 0; k < 3; k++) {
        const h = hash2(tx, ty, k);
        if (h < 0.45) continue;
        ctx.fillStyle = k === 0 ? p.speck2 : p.speck;
        const px = x + 4 + hash2(tx, ty, k + 7) * (T - 8);
        const py = y + (up ? 12 : 4) + hash2(tx, ty, k + 13) * (T - (up ? 16 : 8));
        ctx.beginPath();
        ctx.ellipse(px, py, 1.6 + h * 1.6, 1.2 + h, 0, 0, TAU);
        ctx.fill();
      }
    }
    // shading toward exposed sides
    ctx.fillStyle = p.bodyDark;
    if (dn) ctx.fillRect(x + (lf ? R * 0.6 : 0), y + T - 4, T - (lf ? R * 0.6 : 0) - (rt ? R * 0.6 : 0), 4);
    if (lf) ctx.fillRect(x, y + (up ? R : 0), 2.5, T - (up ? R : 0) - (dn ? R : 0));
    if (rt) ctx.fillRect(x + T - 2.5, y + (up ? R : 0), 2.5, T - (up ? R : 0) - (dn ? R : 0));
    return;
  }
  if (!up) return;
  // the lip on top: grass / moss / zinc roof
  if (th.id === 'paris') {
    ctx.fillStyle = p.topDark;
    ctx.fillRect(x - (lf ? 2 : 0), y - 1, T + (lf ? 2 : 0) + (rt ? 2 : 0), 9);
    ctx.fillStyle = p.top;
    ctx.fillRect(x - (lf ? 2 : 0), y - 1, T + (lf ? 2 : 0) + (rt ? 2 : 0), 5);
    ctx.fillStyle = '#c9d6e6';
    ctx.fillRect(x - (lf ? 2 : 0), y - 1, T + (lf ? 2 : 0) + (rt ? 2 : 0), 1.5);
    // seams of the zinc sheets
    ctx.fillStyle = p.topDark;
    ctx.fillRect(x + 15, y + 1, 1.2, 7);
    if (hash2(tx, ty, 5) < 0.18 && !lf && !rt) {
      // a chimney pot
      ctx.fillStyle = th.stone.face;
      ctx.fillRect(x + 8, y - 12, 9, 12);
      ctx.fillStyle = th.stone.dark;
      ctx.fillRect(x + 7, y - 13, 11, 3);
      ctx.fillStyle = '#d97a4a';
      ctx.fillRect(x + 10, y - 17, 5, 5);
    }
    return;
  }
  const lipH = 8;
  const x0 = x - (lf ? 1.5 : 0.5);
  const x1 = x + T + (rt ? 1.5 : 0.5);
  // the wave is a function of world x, so neighbouring lips join seamlessly
  const wave = (wx: number) => y + lipH + 2.2 * Math.sin(wx * 0.21) + 1.2 * Math.sin(wx * 0.077);
  ctx.fillStyle = p.topDark;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  for (let k = 0; k <= 8; k++) {
    const sx = x0 + ((x1 - x0) * k) / 8;
    ctx.lineTo(sx, wave(sx));
  }
  ctx.lineTo(x1, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = p.top;
  roundedTilePath(ctx, x0, y - 1.5, x1 - x0, lf ? 5 : 0, rt ? 5 : 0, 0, 0);
  ctx.save();
  ctx.clip();
  ctx.fillRect(x0 - 1, y - 2, x1 - x0 + 2, lipH - 1);
  ctx.restore();
  // blades and decorations poking up
  ctx.fillStyle = p.top;
  for (let k = 0; k < 4; k++) {
    if (hash2(tx, ty, 20 + k) < 0.5) continue;
    const bx = x + 3 + k * 7.5 + hash2(tx, ty, 30 + k) * 3;
    ctx.beginPath();
    ctx.moveTo(bx - 1.6, y + 0.5);
    ctx.lineTo(bx + hash2(tx, ty, 40 + k) * 2 - 1, y - 3 - hash2(tx, ty, 50 + k) * 3);
    ctx.lineTo(bx + 1.6, y + 0.5);
    ctx.fill();
  }
  const d = hash2(tx, ty, 99);
  if (tileAt(L, tx, ty - 1) !== Tile.Empty) return;
  if (th.id === 'garden' && d < 0.22) {
    const fx = x + 6 + hash2(tx, ty, 98) * 20;
    ctx.strokeStyle = '#4f9a3c';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(fx, y + 1);
    ctx.lineTo(fx, y - 8);
    ctx.stroke();
    const c = ['#ff8fb1', '#ffffff', '#ffd45a', '#b48cff'][Math.floor(hash2(tx, ty, 97) * 4)];
    ctx.fillStyle = c;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      ctx.beginPath();
      ctx.arc(fx + Math.cos(a) * 2.6, y - 9 + Math.sin(a) * 2.6, 1.9, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ffcf3a';
    ctx.beginPath();
    ctx.arc(fx, y - 9, 1.5, 0, TAU);
    ctx.fill();
  } else if (th.id === 'woods' && d < 0.14) {
    const fx = x + 8 + hash2(tx, ty, 98) * 16;
    ctx.fillStyle = '#f2e6d6';
    ctx.fillRect(fx - 1.5, y - 6, 3, 6);
    ctx.fillStyle = hash2(tx, ty, 96) < 0.5 ? '#e0603f' : '#c48a3a';
    ctx.beginPath();
    ctx.ellipse(fx, y - 6, 5.5, 3.6, 0, Math.PI, 0);
    ctx.fill();
  } else if (th.id === 'mill' && d < 0.12) {
    ctx.fillStyle = '#9e978a';
    ctx.beginPath();
    ctx.ellipse(x + 10 + hash2(tx, ty, 98) * 12, y - 1.5, 4.5, 3, 0, Math.PI, 0);
    ctx.fill();
  }
}

/** Paris: building fronts with tall windows, some lit for the evening. */
function paintFacade(ctx: CanvasRenderingContext2D, th: Theme, tx: number, ty: number, x: number, y: number, up: boolean, dn: boolean) {
  if (up) {
    // mansard: slate-blue slope under the zinc lip, with a dormer window now and then
    ctx.fillStyle = '#6f7d9c';
    ctx.fillRect(x, y + 6, T, T - 6);
    if (hash2(tx, ty, 3) < 0.5) {
      ctx.fillStyle = '#efdcc2';
      ctx.fillRect(x + 10, y + 12, 12, 14);
      ctx.fillStyle = hash2(tx, ty, 4) < 0.45 ? '#ffd98a' : '#4f5f80';
      ctx.fillRect(x + 12, y + 15, 8, 10);
    }
    return;
  }
  if (dn) return;
  ctx.fillStyle = th.ground.bodyDark;
  ctx.fillRect(x, y + 29, T, 3);
  const lit = hash2(tx, ty, 6) < 0.33;
  ctx.fillStyle = '#d9c4a6';
  ctx.fillRect(x + 7, y + 4, 18, 22);
  ctx.fillStyle = lit ? '#ffd98a' : '#5c6c8e';
  ctx.fillRect(x + 9, y + 6, 14, 18);
  ctx.fillStyle = lit ? '#ffecb8' : '#7b8bab';
  ctx.fillRect(x + 9, y + 6, 14, 4);
  ctx.fillStyle = '#d9c4a6';
  ctx.fillRect(x + 15.4, y + 6, 1.2, 18);
  // a little wrought-iron balcony
  ctx.fillStyle = '#3b3a50';
  ctx.fillRect(x + 6, y + 22, 20, 1.6);
  for (let k = 0; k < 5; k++) ctx.fillRect(x + 7 + k * 4.4, y + 22, 1, 5);
}

/** Tower: iron lattice you can see the night through. */
function paintGirder(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, up: boolean, dn: boolean, lf: boolean, rt: boolean, pass: number, tx: number, ty: number) {
  const p = th.ground;
  if (pass === 0) {
    ctx.strokeStyle = p.body;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + T, y + T);
    ctx.moveTo(x + T, y);
    ctx.lineTo(x, y + T);
    ctx.stroke();
    ctx.fillStyle = p.bodyDark;
    if (lf || (tx & 1) === 0) ctx.fillRect(x - 0.5, y - 0.5, 4, T + 1);
    if (rt) ctx.fillRect(x + T - 3.5, y - 0.5, 4, T + 1);
    if (dn || (ty & 1) === 0) ctx.fillRect(x - 0.5, y + T - 3.5, T + 1, 4);
    ctx.fillStyle = p.speck;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x + 1, y + 1, 2, 2);
    ctx.fillRect(x + T - 3, y + T - 3, 2, 2);
    ctx.globalAlpha = 1;
    return;
  }
  if (!up) return;
  ctx.fillStyle = p.topDark;
  ctx.fillRect(x - (lf ? 1 : 0), y, T + (lf ? 1 : 0) + (rt ? 1 : 0), 7);
  ctx.fillStyle = p.top;
  ctx.fillRect(x - (lf ? 1 : 0), y, T + (lf ? 1 : 0) + (rt ? 1 : 0), 3);
  ctx.fillStyle = p.speck2;
  for (let k = 0; k < 4; k++) ctx.fillRect(x + 3 + k * 8, y + 4, 1.6, 1.6);
}

function paintStone(ctx: CanvasRenderingContext2D, L: LevelData, th: Theme, tx: number, ty: number, x: number, y: number) {
  const s = th.stone;
  const up = !solidAt(L, tx, ty - 1);
  const dn = !solidAt(L, tx, ty + 1);
  const lf = !solidAt(L, tx - 1, ty);
  const rt = !solidAt(L, tx + 1, ty);
  const R = 5;
  roundedTilePath(ctx, x - 0.3, y - 0.3, T + 0.6, up && lf ? R : 0, up && rt ? R : 0, dn && rt ? R : 0, dn && lf ? R : 0);
  ctx.fillStyle = s.face;
  ctx.fill();
  ctx.save();
  ctx.clip();
  switch (th.id) {
    case 'woods': {
      // bark: vertical grain
      ctx.strokeStyle = s.dark;
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 4; k++) {
        const gx = x + 4 + k * 8 + hash2(tx, ty, k) * 3;
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.bezierCurveTo(gx + 2, y + 10, gx - 2, y + 20, gx + 1, y + T);
        ctx.stroke();
      }
      if (up) {
        ctx.fillStyle = s.light;
        ctx.beginPath();
        ctx.ellipse(x + T / 2, y + 3, T / 2, 4, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = s.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(x + T / 2, y + 3, T / 4, 2, 0, 0, TAU);
        ctx.stroke();
      }
      break;
    }
    case 'mill': {
      // a wooden crate
      ctx.strokeStyle = s.dark;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, T - 4, T - 4);
      ctx.beginPath();
      ctx.moveTo(x + 3, y + T - 3);
      ctx.lineTo(x + T - 3, y + 3);
      ctx.stroke();
      ctx.fillStyle = s.light;
      ctx.fillRect(x + 2, y + 2, T - 4, 2);
      break;
    }
    case 'tower': {
      ctx.fillStyle = s.light;
      ctx.fillRect(x, y, T, 2);
      ctx.fillStyle = s.dark;
      ctx.fillRect(x, y + T - 2, T, 2);
      ctx.fillStyle = s.line;
      for (const [rx, ry] of [
        [5, 5],
        [T - 7, 5],
        [5, T - 7],
        [T - 7, T - 7],
      ]) {
        ctx.beginPath();
        ctx.arc(x + rx + 1, y + ry + 1, 1.8, 0, TAU);
        ctx.fill();
      }
      break;
    }
    default: {
      // bricks (paris) / stone blocks (garden)
      const rows = th.id === 'paris' ? 4 : 2;
      const rh = T / rows;
      ctx.fillStyle = s.light;
      for (let r = 0; r < rows; r++) {
        const off = ((r + ty) & 1) * (T / (rows === 4 ? 4 : 2));
        const bw = rows === 4 ? T / 2 : T;
        for (let bx = -bw; bx < T + bw; bx += bw) ctx.fillRect(x + bx + off + 1, y + r * rh + 1, bw - 2, 1.5);
      }
      ctx.strokeStyle = s.line;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let r = 1; r < rows; r++) {
        ctx.moveTo(x, y + r * rh);
        ctx.lineTo(x + T, y + r * rh);
      }
      for (let r = 0; r < rows; r++) {
        const off = ((r + ty) & 1) * (T / (rows === 4 ? 4 : 2));
        const bw = rows === 4 ? T / 2 : T;
        for (let bx = off; bx < T; bx += bw) {
          if (bx <= 0.5) continue;
          ctx.moveTo(x + bx, y + r * rh);
          ctx.lineTo(x + bx, y + (r + 1) * rh);
        }
      }
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.fillStyle = s.dark;
  if (dn) ctx.fillRect(x + (lf ? R : 0), y + T - 3, T - (lf ? R : 0) - (rt ? R : 0), 3);
}

function paintPlank(ctx: CanvasRenderingContext2D, L: LevelData, th: Theme, tx: number, ty: number, x: number, y: number) {
  const p = th.plank;
  const lf = tileAt(L, tx - 1, ty) !== Tile.Plank;
  const rt = tileAt(L, tx + 1, ty) !== Tile.Plank;
  if (th.id === 'paris') {
    // a stone ledge with a wrought-iron railing
    ctx.fillStyle = '#d8c3a5';
    ctx.fillRect(x, y, T, 5);
    ctx.fillStyle = '#b9a383';
    ctx.fillRect(x, y + 5, T, 2);
    ctx.fillStyle = p.top;
    ctx.fillRect(x, y - 10, T, 1.6);
    for (let k = 0; k < 4; k++) {
      ctx.fillRect(x + 2 + k * 8, y - 10, 1.3, 10);
      ctx.beginPath();
      ctx.arc(x + 6 + k * 8, y - 5, 2.2, 0, TAU);
      ctx.lineWidth = 1;
      ctx.strokeStyle = p.top;
      ctx.stroke();
    }
    return;
  }
  ctx.fillStyle = p.dark;
  ctx.fillRect(x, y + 6, T, 3);
  ctx.fillStyle = p.side;
  ctx.fillRect(x, y, T, 8);
  ctx.fillStyle = p.top;
  ctx.fillRect(x, y, T, 3);
  ctx.fillStyle = p.dark;
  ctx.fillRect(x + 15.5, y + 1, 1, 6);
  ctx.fillStyle = th.id === 'tower' ? th.ground.speck2 : '#6b6b6b';
  ctx.fillRect(x + 4, y + 3.5, 1.6, 1.6);
  ctx.fillRect(x + 26, y + 3.5, 1.6, 1.6);
  if (lf) {
    ctx.fillStyle = p.dark;
    ctx.fillRect(x, y, 2, 9);
  }
  if (rt) {
    ctx.fillStyle = p.dark;
    ctx.fillRect(x + T - 2, y, 2, 9);
  }
}

function paintSpikes(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, ceiling: boolean) {
  const thorny = th.id === 'garden' || th.id === 'woods';
  ctx.save();
  if (ceiling) {
    ctx.translate(x + T / 2, y + T / 2);
    ctx.scale(1, -1);
    ctx.translate(-(x + T / 2), -(y + T / 2));
  }
  const base = y + T;
  if (thorny) {
    // a bramble: a dark vine with sharp thorns
    ctx.fillStyle = th.spikes.b;
    ctx.beginPath();
    ctx.ellipse(x + T / 2, base - 5, T / 2 + 1, 6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = th.spikes.a;
    for (let k = 0; k < 4; k++) {
      const bx = x + 3 + k * 8.5;
      ctx.beginPath();
      ctx.moveTo(bx - 3, base - 6);
      ctx.lineTo(bx + 1, base - 17 - (k & 1) * 3);
      ctx.lineTo(bx + 3, base - 6);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    ctx.fillStyle = th.spikes.b;
    ctx.fillRect(x + 1, base - 4, T - 2, 4);
    for (let k = 0; k < 4; k++) {
      const bx = x + 4 + k * 8;
      ctx.fillStyle = th.spikes.a;
      ctx.beginPath();
      ctx.moveTo(bx - 3.6, base - 3);
      ctx.lineTo(bx, base - 15);
      ctx.lineTo(bx + 3.6, base - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(bx - 1, base - 4);
      ctx.lineTo(bx, base - 14);
      ctx.lineTo(bx + 0.4, base - 4);
      ctx.fill();
    }
  }
  ctx.restore();
}

function paintVent(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number) {
  if (th.id === 'paris') {
    // a big brick chimney stack, open at the top
    ctx.fillStyle = th.stone.face;
    ctx.fillRect(x, y, T, T);
    ctx.fillStyle = th.stone.dark;
    ctx.fillRect(x - 2, y, T + 4, 5);
    ctx.fillStyle = '#2a2030';
    ctx.fillRect(x + 4, y, T - 8, 3);
    ctx.strokeStyle = th.stone.line;
    ctx.lineWidth = 1;
    for (let r = 1; r < 4; r++) {
      ctx.beginPath();
      ctx.moveTo(x, y + 5 + r * 7);
      ctx.lineTo(x + T, y + 5 + r * 7);
      ctx.stroke();
    }
    return;
  }
  ctx.fillStyle = th.stone.dark;
  ctx.fillRect(x, y, T, T);
  ctx.fillStyle = th.stone.face;
  ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
  ctx.fillStyle = '#2a2234';
  for (let k = 0; k < 4; k++) ctx.fillRect(x + 5 + k * 6, y + 3, 3, 9);
  ctx.fillStyle = th.stone.light;
  ctx.fillRect(x + 2, y + 2, T - 4, 1.5);
}
