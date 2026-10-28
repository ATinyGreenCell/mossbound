import { damp } from '../core/math';
import { reducedMotion, settings } from '../core/settings';
import type { Pt } from './level';
import { T, VIEW_TILES_H, VIEW_TILES_MAX_W, VIEW_TILES_MIN_W } from './tuning';

/**
 * The scale moves in steps of 1/256 device px per world px. A 256-px chunk of pre-painted tiles
 * (render/tiles.ts) is then a whole number of device pixels, and every tile lands exactly where the
 * birds, doors and collisions are drawn — even at the far end of a level.
 */
const STEPS = 256;
const quantize = (s: number) => Math.max(1, Math.round(s * STEPS)) / STEPS;

/**
 * Follows the birds. The zoom is chosen per screen so about VIEW_TILES_H tiles fit vertically — a
 * phone held sideways, a laptop and a TV all see roughly the same slice of the world (at least
 * VIEW_TILES_MIN_W tiles wide on narrow screens, at most VIEW_TILES_MAX_W on ultra-wide ones) — and
 * eases out further when the two birds drift apart. Positions are snapped to device pixels when drawn.
 */
export class Camera {
  x = 0;
  y = 0;
  /** device pixels per world pixel, right now */
  scale = 1;
  private base = 1;
  private zoom = 1;
  screenW = 1;
  screenH = 1;
  /** device-pixel offset: screen = world * scale - offset */
  ox = 0;
  oy = 0;
  private shakeAmt = 0;
  private shakeT = 0;
  private placed = false;

  fit(screenW: number, screenH: number) {
    this.screenW = screenW;
    this.screenH = screenH;
    let s = screenH / (VIEW_TILES_H * T);
    s = Math.min(s, screenW / (VIEW_TILES_MIN_W * T));
    s = Math.max(s, screenW / (VIEW_TILES_MAX_W * T));
    this.base = s;
    this.scale = quantize(this.base * this.zoom);
  }

  /** The scale without any zoom-out: what pre-painted tiles are painted at (drawn smaller when zoomed out). */
  get fullScale() {
    return quantize(this.base);
  }

  get viewW() {
    return this.screenW / this.scale;
  }

  get viewH() {
    return this.screenH / this.scale;
  }

  shake(amount: number) {
    if (!settings.shake || reducedMotion) return;
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  /**
   * Ease toward the focus points (weights sum to 1). `bounds` is the level in world px. `snap` jumps
   * straight there (level start, respawn).
   */
  follow(dt: number, pts: readonly Pt[], weights: readonly number[], lead: Pt, bounds: { w: number; h: number }, snap = false) {
    let cx = 0;
    let cy = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      cx += pts[i].x * weights[i];
      cy += pts[i].y * weights[i];
      minX = Math.min(minX, pts[i].x);
      maxX = Math.max(maxX, pts[i].x);
      minY = Math.min(minY, pts[i].y);
      maxY = Math.max(maxY, pts[i].y);
    }
    // A bird that somehow goes to NaN must not take the view with it: a NaN here sticks to x/y and
    // the screen stays blank until the level is left. Keep the last good view instead.
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(minX) || !Number.isFinite(minY)) {
      cx = Number.isFinite(this.x) ? this.x : 0;
      cy = Number.isFinite(this.y) ? this.y : 0;
      minX = maxX = cx;
      minY = maxY = cy;
    }
    // zoom out (a little) so both birds stay comfortably in view
    const needW = maxX - minX + 7 * T;
    const needH = maxY - minY + 6 * T;
    const fitZoom = Math.min(1, this.screenW / (needW * this.base), this.screenH / (needH * this.base));
    const zTarget = Math.max(0.7, fitZoom);
    this.zoom = snap || !this.placed ? zTarget : this.zoom + (zTarget - this.zoom) * damp(zTarget < this.zoom ? 4 : 1.5, dt);
    if (!Number.isFinite(this.zoom)) this.zoom = zTarget;
    this.scale = quantize(this.base * this.zoom);
    const vw = this.viewW;
    const vh = this.viewH;
    let tx = cx + (Number.isFinite(lead.x) ? lead.x : 0);
    let ty = cy + (Number.isFinite(lead.y) ? lead.y : 0) - T * 0.6;
    // stay inside the level (centered when the level is smaller than the view)
    tx = bounds.w <= vw ? bounds.w / 2 : Math.min(bounds.w - vw / 2, Math.max(vw / 2, tx));
    const top = -T * 2;
    const bottom = bounds.h;
    ty = bottom - top <= vh ? (top + bottom) / 2 : Math.min(bottom - vh / 2, Math.max(top + vh / 2, ty));
    if (snap || !this.placed) {
      this.x = tx;
      this.y = ty;
      this.placed = true;
    } else {
      this.x += (tx - this.x) * damp(6, dt);
      this.y += (ty - this.y) * damp(4.5, dt);
    }
    if (!Number.isFinite(this.x) || !Number.isFinite(this.y)) {
      this.x = tx;
      this.y = ty;
    }
    let sx = 0;
    let sy = 0;
    if (this.shakeAmt > 0.05) {
      this.shakeT += dt * 60;
      sx = Math.sin(this.shakeT * 1.7) * this.shakeAmt;
      sy = Math.cos(this.shakeT * 2.3) * this.shakeAmt;
      this.shakeAmt *= Math.exp(-dt * 9);
    } else this.shakeAmt = 0;
    this.ox = Math.round(this.x * this.scale - this.screenW / 2 + sx * this.scale);
    this.oy = Math.round(this.y * this.scale - this.screenH / 2 + sy * this.scale);
  }

  /** World point → CSS pixel position (for DOM bubbles over the canvas). */
  toCss(x: number, y: number, pixelRatio: number): Pt {
    return { x: (x * this.scale - this.ox) / pixelRatio, y: (y * this.scale - this.oy) / pixelRatio };
  }
}
