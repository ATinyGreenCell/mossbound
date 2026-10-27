import type { Pt } from './level';
import { CATCH_BOUNCE, ROPE_LEN, T } from './tuning';
import type { Body, World } from './world';

/** A point the string bends around: a convex tile corner or a peg. */
export interface Wrap {
  x: number;
  y: number;
  /** winding sign when it wrapped: the string unwraps once its bend straightens past this */
  s: number;
  peg: boolean;
}

/** What a bird at one end of the string needs to know about it. */
export interface RopeEnd {
  /** the point this bird swings around: the nearest bend, or the partner when the string is straight */
  pivot: Pt;
  /** that pivot is the partner bird (not a bend) */
  pivotIsBird: boolean;
  /** the pivot is a tile corner (a ledge edge you can climb over) */
  pivotIsCorner: boolean;
  /** distance from the bird to its pivot */
  seg: number;
  /** longest this segment may be right now */
  limit: number;
  /** the string is pulling on this bird */
  taut: boolean;
  /** there's a bird at the other end (not a ghost, not gone): the string can hold anyone at all */
  active: boolean;
}

/** Fields of a bird the string reads (and, for birds simulated here, corrects). */
export interface RopeBird extends Body {
  anchored: boolean;
  hanging: boolean;
  /** personal limit while climbing (Infinity otherwise) */
  climbLen: number;
  present: boolean;
  /** where it was at the start of this physics step */
  prevX: number;
  prevY: number;
  /** a swinging bird's energy this step after its own push or brake (NaN when not swinging) */
  swingE: number;
  /** it ran into something this step (a swing that bumps loses energy, as it should) */
  bumped: boolean;
  /** weight on the string: the heavier end drags the lighter one (see traits.ts) */
  mass: number;
  /** its gravity (a swing's energy is reckoned with it) */
  g: number;
  /** the string is tied this far below the body's centre: at the same height above the feet for every body (see knotY) */
  ropeOff: number;
}

/**
 * Where the string is tied to a body: 10 px above its feet, whatever its height — so a tall sprout and
 * a small one swing, hang and reach exactly as far as the levels were made for.
 */
const knotY = (b: Pt & { ropeOff?: number }) => b.y + (b.ropeOff ?? 0);
const knot = (b: Pt & { ropeOff?: number }): Pt => ({ x: b.x, y: knotY(b) });

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
/** corner points sit this far outside the tile, so the string never lies inside it */
const CORNER_OFF = 1.2;
/** an end has to swing this far (sin of the bend angle) past straight before the string unwraps */
const UNWRAP_HYST = 0.004;
const MAX_WRAPS = 24;
/** the string corrects a bird at most this far per step: a big stretch resolves over a few steps, never a teleport */
const MAX_CORR = 24;

/**
 * The string between the two birds, as a path that bends around tile corners and pegs (a "ninja
 * rope"): each end sweeps from where it was to where it is, and the first corner the moving segment
 * crosses becomes a bend. A bend lets go when the string straightens past it.
 *
 * The length limit is solved per bird: each screen only ever moves the bird(s) it simulates, with a
 * share decided by who is anchored, grounded or airborne. Both screens use the same rule from their
 * own side, so the two halves of the correction add up even though each sees the other a little late.
 */
export class Tether {
  readonly pts: Wrap[] = [];
  /** endpoint positions at the last update */
  private ax = 0;
  private ay = 0;
  private bx = 0;
  private by = 0;
  length = 0;
  /** 0..1 how hard the string pulls (drawing) */
  tension = 0;
  /** a tug pulse running along the string: 1 at the start, fades to 0 */
  twang = 0;
  /** which end the twang started from */
  twangFrom: 0 | 1 = 0;
  /** radial speed the string just absorbed per end (a catch), for sounds — the session clears it */
  readonly caught: [number, number] = [0, 0];
  /**
   * Stretch past this always pulls on every bird simulated here, whatever the share rules say — so a
   * partner wedged against a wall can't be dragged on forever. Online it's looser: each side sees
   * the other a little late, and a tight value would make hauling a partner feel sticky.
   */
  slackTol = 8;
  readonly ends: [RopeEnd, RopeEnd] = [
    { pivot: { x: 0, y: 0 }, pivotIsBird: true, pivotIsCorner: false, seg: 0, limit: ROPE_LEN, taut: false, active: false },
    { pivot: { x: 0, y: 0 }, pivotIsBird: true, pivotIsCorner: false, seg: 0, limit: ROPE_LEN, taut: false, active: false },
  ];
  /** a ghost was at one end: tie the string afresh once both birds are back (see follow) */
  private retie = false;

  constructor(private readonly world: World) {}

  /** Straighten the string between two fresh positions (spawn, respawn, level start). */
  reset(a: Pt & { ropeOff?: number }, b: Pt & { ropeOff?: number }) {
    this.pts.length = 0;
    this.ax = a.x;
    this.ay = knotY(a);
    this.bx = b.x;
    this.by = knotY(b);
    this.repair();
    this.measure();
  }

  /**
   * Track the birds for one step. A string with a ghost (or nobody) at one end isn't there: it doesn't
   * wrap around whatever a ghost flies through, and it's tied afresh, straight, the moment both birds
   * are back — on both screens alike, whichever screen simulates the bird that died.
   */
  follow(a: Pt & { present: boolean; ghost: boolean; ropeOff?: number }, b: Pt & { present: boolean; ghost: boolean; ropeOff?: number }) {
    if (a.present && b.present && !a.ghost && !b.ghost) {
      if (this.retie) this.reset(a, b);
      else this.update(a, b);
      this.retie = false;
    } else if (a.ghost || b.ghost) this.retie = true;
  }

  /** Move the ends to new positions, wrapping around anything the string swept past. */
  update(a: Pt & { ropeOff?: number }, b: Pt & { ropeOff?: number }) {
    const ay = knotY(a);
    const by = knotY(b);
    if (a.x !== this.ax || ay !== this.ay) this.sweep(0, a.x, ay);
    if (b.x !== this.bx || by !== this.by) this.sweep(1, b.x, by);
    this.unwrap();
    this.measure();
  }

  private sweep(end: 0 | 1, nx: number, ny: number) {
    let ox = end === 0 ? this.ax : this.bx;
    let oy = end === 0 ? this.ay : this.by;
    // a jump of more than a few tiles in one step is a teleport (respawn): don't sweep the world
    if (Math.hypot(nx - ox, ny - oy) > 3 * T) {
      this.setEnd(end, nx, ny);
      this.pts.length = 0;
      this.repair();
      return;
    }
    for (let iter = 0; iter < 6 && this.pts.length < MAX_WRAPS; iter++) {
      const piv = this.pivotPoint(end);
      const hit = this.firstCorner(piv.x, piv.y, ox, oy, nx, ny);
      if (!hit) break;
      const w: Wrap = { x: hit.x, y: hit.y, s: 0, peg: hit.peg };
      if (end === 0) {
        w.s = Math.sign(cross(w.x - nx, w.y - ny, piv.x - w.x, piv.y - w.y)) || 1;
        this.pts.unshift(w);
      } else {
        w.s = Math.sign(cross(w.x - piv.x, w.y - piv.y, nx - w.x, ny - w.y)) || 1;
        this.pts.push(w);
      }
      // continue sweeping the rest of the motion around the new bend
      const ix = this.raySeg(piv.x, piv.y, w.x, w.y, ox, oy, nx, ny);
      if (ix) {
        ox = ix.x;
        oy = ix.y;
      }
    }
    this.setEnd(end, nx, ny);
  }

  private setEnd(end: 0 | 1, x: number, y: number) {
    if (end === 0) {
      this.ax = x;
      this.ay = y;
    } else {
      this.bx = x;
      this.by = y;
    }
  }

  private pivotPoint(end: 0 | 1): Pt {
    const n = this.pts.length;
    if (end === 0) return n ? this.pts[0] : { x: this.bx, y: this.by };
    return n ? this.pts[n - 1] : { x: this.ax, y: this.ay };
  }

  /** Bends at either end straighten out once the string swings back past them. */
  private unwrap() {
    for (let guard = 0; guard < MAX_WRAPS && this.pts.length; guard++) {
      const c = this.pts[0];
      const q = this.pts[1] ?? { x: this.bx, y: this.by };
      if (!this.straightened(this.ax, this.ay, c, q)) break;
      this.pts.shift();
    }
    for (let guard = 0; guard < MAX_WRAPS && this.pts.length; guard++) {
      const n = this.pts.length;
      const c = this.pts[n - 1];
      const p = this.pts[n - 2] ?? { x: this.ax, y: this.ay };
      if (!this.straightened(p.x, p.y, c, { x: this.bx, y: this.by })) break;
      this.pts.pop();
    }
  }

  private straightened(px: number, py: number, c: Wrap, q: Pt) {
    const ux = c.x - px;
    const uy = c.y - py;
    const vx = q.x - c.x;
    const vy = q.y - c.y;
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    // an end sitting right on its bend: let go, the bend means nothing
    if (lu < 0.5 || lv < 0.5) return true;
    return (cross(ux, uy, vx, vy) / (lu * lv)) * c.s < -UNWRAP_HYST;
  }

  /**
   * The first corner (or peg) crossed when the segment pivot→o swings to pivot→n: the one inside the
   * swept triangle with the smallest angle from the old segment (nearest the pivot on ties).
   */
  private firstCorner(px: number, py: number, ox: number, oy: number, nx: number, ny: number): (Pt & { peg: boolean }) | null {
    const d0x = ox - px;
    const d0y = oy - py;
    const d1x = nx - px;
    const d1y = ny - py;
    const turn = cross(d0x, d0y, d1x, d1y);
    if (Math.abs(turn) < 1e-3) return null;
    const sg = Math.sign(turn);
    const L = this.world.L;
    let best: (Pt & { peg: boolean }) | null = null;
    let bestA = Infinity;
    let bestD = Infinity;
    const consider = (cx: number, cy: number, peg: boolean) => {
      const rx = cx - px;
      const ry = cy - py;
      const dd = rx * rx + ry * ry;
      if (dd < 1) return;
      // strictly inside the triangle (pivot, o, n)
      if (cross(d0x, d0y, rx, ry) * sg <= 0.01) return;
      if (cross(nx - ox, ny - oy, cx - ox, cy - oy) * sg <= 0.01) return;
      if (cross(px - nx, py - ny, cx - nx, cy - ny) * sg <= 0.01) return;
      const a = Math.atan2(Math.abs(cross(d0x, d0y, rx, ry)), d0x * rx + d0y * ry);
      if (a < bestA - 1e-6 || (Math.abs(a - bestA) <= 1e-6 && dd < bestD)) {
        bestA = a;
        bestD = dd;
        best = { x: cx, y: cy, peg };
      }
    };
    const minX = Math.min(px, ox, nx);
    const maxX = Math.max(px, ox, nx);
    const minY = Math.min(py, oy, ny);
    const maxY = Math.max(py, oy, ny);
    const gx0 = Math.max(0, Math.floor(minX / T));
    const gx1 = Math.min(L.w, Math.ceil(maxX / T));
    const gy0 = Math.max(0, Math.floor(minY / T));
    const gy1 = Math.min(L.h, Math.ceil(maxY / T));
    const W = L.w + 1;
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const c = L.corners[gy * W + gx];
        if (!c) continue;
        // nudge away from the solid tile
        const ox2 = c === 1 || c === 3 ? CORNER_OFF : -CORNER_OFF;
        const oy2 = c === 1 || c === 2 ? CORNER_OFF : -CORNER_OFF;
        consider(gx * T + ox2, gy * T + oy2, false);
      }
    }
    for (const p of L.pegs) if (p.x >= minX - 1 && p.x <= maxX + 1 && p.y >= minY - 1 && p.y <= maxY + 1) consider(p.x, p.y, true);
    return best;
  }

  /** Where the ray from p through c crosses segment o→n (null if it doesn't). */
  private raySeg(px: number, py: number, cx: number, cy: number, ox: number, oy: number, nx: number, ny: number): Pt | null {
    const rx = cx - px;
    const ry = cy - py;
    const sx = nx - ox;
    const sy = ny - oy;
    const den = cross(rx, ry, sx, sy);
    if (Math.abs(den) < 1e-9) return null;
    const u = cross(ox - px, oy - py, rx, ry) / den;
    if (u < 0 || u > 1) return null;
    return { x: ox + sx * u, y: oy + sy * u };
  }

  /** Is the straight line between two points clear of static solids? */
  los(x0: number, y0: number, x1: number, y1: number) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / 6));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.world.staticSolidPx(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  /** After a teleport the straight string may pass through a wall: route it over one corner if that works. */
  private repair() {
    if (this.pts.length || this.los(this.ax, this.ay, this.bx, this.by)) return;
    const L = this.world.L;
    const W = L.w + 1;
    const gx0 = Math.max(0, Math.floor(Math.min(this.ax, this.bx) / T) - 3);
    const gx1 = Math.min(L.w, Math.ceil(Math.max(this.ax, this.bx) / T) + 3);
    const gy0 = Math.max(0, Math.floor(Math.min(this.ay, this.by) / T) - 3);
    const gy1 = Math.min(L.h, Math.ceil(Math.max(this.ay, this.by) / T) + 3);
    let best: Wrap | null = null;
    let bestLen = Infinity;
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const c = L.corners[gy * W + gx];
        if (!c) continue;
        const x = gx * T + (c === 1 || c === 3 ? CORNER_OFF : -CORNER_OFF);
        const y = gy * T + (c === 1 || c === 2 ? CORNER_OFF : -CORNER_OFF);
        const len = Math.hypot(x - this.ax, y - this.ay) + Math.hypot(this.bx - x, this.by - y);
        if (len >= bestLen || !this.los(this.ax, this.ay, x, y) || !this.los(x, y, this.bx, this.by)) continue;
        bestLen = len;
        best = { x, y, s: Math.sign(cross(x - this.ax, y - this.ay, this.bx - x, this.by - y)) || 1, peg: false };
      }
    }
    if (best) this.pts.push(best);
  }

  private measure() {
    let len = 0;
    let px = this.ax;
    let py = this.ay;
    for (const p of this.pts) {
      len += Math.hypot(p.x - px, p.y - py);
      px = p.x;
      py = p.y;
    }
    len += Math.hypot(this.bx - px, this.by - py);
    this.length = len;
  }

  /** The path from bird 0 to bird 1 (positions as of the last update), into `out` (reused). */
  path(out: Pt[]) {
    out.length = 0;
    out.push({ x: this.ax, y: this.ay });
    for (const p of this.pts) out.push(p);
    out.push({ x: this.bx, y: this.by });
    return out;
  }

  /**
   * Pull birds back within the string's length. Only birds with `auth` set are moved (online, the
   * partner's bird is moved by their own screen). `vel` is each bird's velocity (the partner's is
   * estimated from their snapshots).
   */
  solve(birds: readonly [RopeBird, RopeBird], auth: readonly [boolean, boolean], dt = 1 / 120) {
    const [A, B] = birds;
    const active = A.present && B.present && !A.ghost && !B.ghost;
    const n = this.pts.length;
    const total = this.length;
    const excess = total - ROPE_LEN;
    let maxPull = 0;
    // (last step's tautness tells a swing under way from a fresh catch)
    const wasTaut0 = this.ends[0].taut;
    const wasTaut1 = this.ends[1].taut;
    // pass 1: where each end pivots and how much string it may use (both, before anything moves)
    for (let end = 0 as 0 | 1; end <= 1; end = (end + 1) as 0 | 1) {
      const me = birds[end];
      const e = this.ends[end];
      const piv = end === 0 ? (n ? this.pts[0] : knot(B)) : n ? this.pts[n - 1] : knot(A);
      e.pivot.x = piv.x;
      e.pivot.y = piv.y;
      e.pivotIsBird = n === 0;
      e.pivotIsCorner = n > 0 && !(end === 0 ? this.pts[0].peg : this.pts[n - 1].peg);
      e.seg = Math.hypot(me.x - piv.x, knotY(me) - piv.y);
      e.limit = Math.min(ROPE_LEN - (total - e.seg), me.climbLen);
      e.taut = active && e.seg >= e.limit - 0.75;
      e.active = active;
    }
    if (!active) {
      this.tension *= 0.75;
      return;
    }
    // pass 2: pull the birds simulated here back in (shares from the pre-move excess, like a Jacobi step)
    for (let end = 0 as 0 | 1; end <= 1; end = (end + 1) as 0 | 1) {
      const me = birds[end];
      const other = birds[1 - end];
      const e = this.ends[end];
      const seg = e.seg;
      if (!auth[end] || seg < 1e-3) continue;
      const personal = Math.max(0, seg - me.climbLen);
      const share = shareOf(me, other, end, this);
      // (a bird holding on never budges, not even for the stretch limit)
      const corr = Math.min(MAX_CORR, Math.max(personal, Math.max(0, excess) * share, me.anchored ? 0 : excess - this.slackTol));
      if (corr <= 0) continue;
      maxPull = Math.max(maxPull, corr);
      const ux = (me.x - e.pivot.x) / seg;
      const uy = (knotY(me) - e.pivot.y) / seg;
      // pull toward the pivot (through the world, so the string never drags a bird into a wall)
      this.world.moveX(me, -ux * corr);
      if (this.world.moveY(me, -uy * corr) === 1 && me.vy > 0) me.vy = 0;
      // and take away the speed that carries it further out
      const pvx = e.pivotIsBird ? other.vx : 0;
      const pvy = e.pivotIsBird ? other.vy : 0;
      const rvx = me.vx - pvx;
      const rvy = me.vy - pvy;
      const radial = rvx * ux + rvy * uy;
      if (radial > 0) {
        const k = personal > 0 ? 1 : share;
        // (only a smooth swing: a big correction is a yank, not an arc, and must not become speed)
        const swinging = k >= 1 && (end === 0 ? wasTaut0 : wasTaut1) && !me.grounded && corr < 6;
        if (swinging) {
          // a swing under way: the velocity is how far this step really moved the bird (position
          // based)… and since that alone leaks a little energy every step (half the drop's worth),
          // its speed is then set from the swing's own energy, so a pendulum keeps its height. Only
          // around a pivot that holds still, and only if nothing was bumped on the way.
          me.vx = (me.x - me.prevX) / dt;
          me.vy = (me.y - me.prevY) / dt;
          const still = !e.pivotIsBird || other.anchored || (other.grounded && Math.abs(other.vx) + Math.abs(other.vy) < 5);
          const sp = Math.hypot(me.vx, me.vy);
          if (still && !me.bumped && Number.isFinite(me.swingE) && sp > 1) {
            const v2 = 2 * (me.swingE + me.g * me.y);
            if (v2 > 0) {
              const k2 = Math.sqrt(v2) / sp;
              me.vx *= k2;
              me.vy *= k2;
            }
          }
        } else {
          // a fresh catch: the fall stops along the string, with a little give
          const give = radial > 260 && k >= 1 ? CATCH_BOUNCE : 0;
          me.vx -= ux * radial * k * (1 + give);
          me.vy -= uy * radial * k * (1 + give);
          if (radial > 260) this.caught[end] = Math.max(this.caught[end], radial * k);
        }
      }
    }
    const target = Math.min(1, Math.max(0, (total - ROPE_LEN * 0.9) / (ROPE_LEN * 0.1)) + Math.min(1, maxPull * 0.2));
    this.tension += (target - this.tension) * 0.25;
  }

  /** Unit direction from a bird toward its pivot (for tugs), or null when it sits on it. */
  pullDir(end: 0 | 1, me: Pt & { ropeOff?: number }): Pt | null {
    const piv = this.ends[end].pivot;
    const dx = piv.x - me.x;
    const dy = piv.y - knotY(me);
    const d = Math.hypot(dx, dy);
    return d < 1 ? null : { x: dx / d, y: dy / d };
  }
}

/**
 * How much of the string's overshoot this bird takes up (0..1). Symmetric: the partner's screen
 * computes the other half with the roles swapped.
 */
function shareOf(me: RopeBird, other: RopeBird, end: 0 | 1, rope: Tether): number {
  if (me.anchored) return 0;
  if (other.anchored) return 1;
  if (me.grounded && !other.grounded) return 0; // I'm the anchor for my airborne partner
  if (!me.grounded && other.grounded) return 1; // I hang from my grounded partner
  if (me.grounded && other.grounded) {
    // on the ground: whoever walks away from the other gets stopped by the string — unless they're the
    // heavier one, who drags the lighter one along instead
    const em = rope.ends[end];
    const eo = rope.ends[1 - end];
    const om = outward(me, em.pivot);
    const oo = outward(other, eo.pivot);
    if (om + oo < 1) return other.mass / (me.mass + other.mass);
    // (shares from both screens add up to one: each walker's part, plus what the other walker leaves)
    const wm = om / (om + oo);
    return wm * walkerShare(me, other) + (1 - wm) * (1 - walkerShare(other, me));
  }
  // both in the air: the lighter one gives way
  return other.mass / (me.mass + other.mass);
}

/** How much of the stretch a bird walking away from a standing one takes up: all of it (it's stopped) — unless it's the heavier, which drags the lighter one along. */
function walkerShare(walker: RopeBird, stander: RopeBird) {
  return walker.mass <= stander.mass ? 1 : stander.mass / (walker.mass + stander.mass);
}

function outward(b: Body, piv: Pt) {
  const dx = b.x - piv.x;
  const dy = b.y - piv.y;
  const d = Math.hypot(dx, dy) || 1;
  return Math.max(0, (b.vx * dx + b.vy * dy) / d);
}
