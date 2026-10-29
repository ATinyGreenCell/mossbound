import type { Pt } from './level';
import { CATCH_BOUNCE, ROPE_LEN, ROPE_MIN, SHOT_OWED, SHOT_REEL, T } from './tuning';
import type { Body, World } from './world';

/** A point the string bends around: a convex tile corner or a peg. */
export interface Wrap {
  x: number;
  y: number;
  /** winding sign when it wrapped: the string unwraps once its bend straightens past this */
  s: number;
  peg: boolean;
  /**
   * A bird shot its vine over this ring and is holding on there (see shoot). The string stays over it
   * however the bird swings, until that bird lets go: a bend that came and went of its own accord is
   * the string finding its way, but a hook is a decision.
   */
  shot?: 0 | 1;
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

/**
 * What the string needs of an end to track it: where its knot is, and a climber's grip on it (which is
 * re-based when a bend appears or straightens out there, so the grip stays on the same bit of string).
 */
export interface RopeGrip extends Pt {
  ropeOff?: number;
  climbLen?: number;
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
/** a bend counts as folded back on itself when its two legs lie within 30° of each other (cos 150°) */
const FOLD_DOT = -0.866;
const MAX_WRAPS = 24;
/** the string corrects a bird at most this far per step: a big stretch resolves over a few steps, never a teleport */
const MAX_CORR = 24;
/** how far the string may stretch while both birds hold on, before even a grip has to give ground */
const GRIP_TOL = 20;

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
  /**
   * How much vine there is to go round, in pixels. ROPE_LEN, plus what a sprout has shot out over a
   * ring: a plant that shoots a vine grows that vine, so hooking a ring three tiles away doesn't
   * spend the slack that was keeping the pair together. It's paid back over SHOT_REEL seconds once
   * the ring is let go, so the vine draws itself in instead of snapping the pair back.
   */
  limit = ROPE_LEN;
  /** vine shot out and not yet drawn back in (limit = ROPE_LEN + this) */
  private grown = 0;
  private growWant = 0;
  /** seconds the vine will still wait for slack before drawing itself in regardless */
  private owed = 0;
  readonly ends: [RopeEnd, RopeEnd] = [
    { pivot: { x: 0, y: 0 }, pivotIsBird: true, pivotIsCorner: false, seg: 0, limit: ROPE_LEN, taut: false, active: false },
    { pivot: { x: 0, y: 0 }, pivotIsBird: true, pivotIsCorner: false, seg: 0, limit: ROPE_LEN, taut: false, active: false },
  ];
  /** a ghost was at one end: tie the string afresh once both birds are back (see follow) */
  private retie = false;
  /**
   * Is there a vine between the two sprouts at all?
   *
   * There isn't, to begin with. The sprouts are two independent creatures who happen to be in the
   * same level, and they are roped together only when one of them walks up to the other and presses
   * the vine button (see Session.shoot). Everything the string does hangs off this: the length
   * limit, swings, hangs, climbs, tugs, lifts, and the drawing of it.
   *
   * A pair tied together the whole time was the first shape of this game, and it made every moment
   * a negotiation — you could not cross a room without dragging someone out of theirs. Asking for
   * the vine turns that from a condition into a move.
   */
  tied = false;

  constructor(private readonly world: World) {}

  /** Straighten the string between two fresh positions (spawn, respawn, level start). */
  reset(a: RopeGrip, b: RopeGrip) {
    this.pts.length = 0;
    this.grown = this.growWant = 0;
    this.owed = 0;
    this.limit = ROPE_LEN;
    this.ax = a.x;
    this.ay = knotY(a);
    this.bx = b.x;
    this.by = knotY(b);
    this.repair();
    this.measure();
  }

  /** Tie the vine between the two sprouts, straight, from here. */
  tie(a: RopeGrip, b: RopeGrip) {
    this.tied = true;
    this.retie = false;
    this.reset(a, b);
  }

  /**
   * Let the vine go: the two sprouts are independent again.
   *
   * Clearing `active` on both ends is what releases anyone hanging from it — a bird drops off a
   * rope that isn't active of its own accord (see Bird.step), so there is nothing else to undo and
   * no way for a sprout to be left dangling from a vine that no longer exists.
   */
  untie() {
    this.tied = false;
    this.retie = false;
    this.pts.length = 0;
    this.length = 0;
    this.tension = 0;
    this.twang = 0;
    this.grown = this.growWant = 0;
    this.owed = 0;
    this.limit = ROPE_LEN;
    this.caught[0] = this.caught[1] = 0;
    for (const e of this.ends) {
      e.active = false;
      e.taut = false;
      e.pivotIsBird = true;
      e.pivotIsCorner = false;
      e.seg = 0;
      e.limit = ROPE_LEN;
    }
  }

  /**
   * Track the birds for one step. A string with a ghost (or nobody) at one end isn't there: it doesn't
   * wrap around whatever a ghost flies through, and it's tied afresh, straight, the moment both birds
   * are back — on both screens alike, whichever screen simulates the bird that died.
   */
  follow(a: RopeGrip & { present: boolean; ghost: boolean }, b: RopeGrip & { present: boolean; ghost: boolean }) {
    if (!this.tied) return;
    if (a.present && b.present && !a.ghost && !b.ghost) {
      if (this.retie) this.reset(a, b);
      else this.update(a, b);
      this.retie = false;
    } else if (a.ghost || b.ghost) this.retie = true;
  }

  /** Move the ends to new positions, wrapping around anything the string swept past. */
  update(a: RopeGrip, b: RopeGrip) {
    const ay = knotY(a);
    const by = knotY(b);
    const bend0 = this.bendAt(0);
    const bend1 = this.bendAt(1);
    if (a.x !== this.ax || ay !== this.ay) this.sweep(0, a.x, ay);
    if (b.x !== this.bx || by !== this.by) this.sweep(1, b.x, by);
    this.unwrap();
    // a string that has just straightened out can keep drifting into the corner on the other side of
    // a one-tile hole, a step or two after the bend let go: route it back over a corner
    this.repair();
    this.measure();
    this.regrip(a, ay, bend0, this.bendAt(0), b, by);
    this.regrip(b, by, bend1, this.bendAt(1), a, ay);
  }

  /** The bend this end pivots around, or null when the string runs straight to the other bird. */
  private bendAt(end: 0 | 1): Pt | null {
    const n = this.pts.length;
    if (!n) return null;
    const p = end === 0 ? this.pts[0] : this.pts[n - 1];
    return { x: p.x, y: p.y };
  }

  /**
   * Keep a climber's grip on the same point of the string when a bend appears or goes at its own end.
   * Its segment is measured to that pivot, so the pivot moving makes the segment jump; without the
   * same jump in `climbLen` the solver would reel the whole difference in (or pay it out) at its
   * per-step cap, which is felt as a yank of up to a hundred pixels.
   */
  private regrip(me: RopeGrip, ky: number, was: Pt | null, now: Pt | null, other: Pt, otherY: number) {
    if (me.climbLen === undefined || !Number.isFinite(me.climbLen)) return;
    if (!was && !now) return; // straight before and after: the other bird simply moved
    const from = was ?? { x: other.x, y: otherY };
    const to = now ?? { x: other.x, y: otherY };
    if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) < 0.5) return; // the same bend as before
    const shift = Math.hypot(me.x - to.x, ky - to.y) - Math.hypot(me.x - from.x, ky - from.y);
    // (within the same bounds a climber's own hands keep it to, see Bird.step)
    me.climbLen = Math.min(ROPE_LEN, Math.max(ROPE_MIN, me.climbLen + shift));
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

  /** Bends at either end straighten out once the string swings back past them — or fold away. */
  private unwrap() {
    for (let guard = 0; guard < MAX_WRAPS && this.pts.length; guard++) {
      const c = this.pts[0];
      if (c.shot !== undefined) break;
      const q = this.pts[1] ?? { x: this.bx, y: this.by };
      if (!this.straightened(this.ax, this.ay, c, q) && !this.folded(this.ax, this.ay, c, q)) break;
      if (!this.rebend(0, this.ax, this.ay, c, q.x, q.y)) this.pts.shift();
    }
    for (let guard = 0; guard < MAX_WRAPS && this.pts.length; guard++) {
      const n = this.pts.length;
      const c = this.pts[n - 1];
      if (c.shot !== undefined) break;
      const p = this.pts[n - 2] ?? { x: this.ax, y: this.ay };
      const q = { x: this.bx, y: this.by };
      if (!this.straightened(p.x, p.y, c, q) && !this.folded(p.x, p.y, c, q)) break;
      if (!this.rebend(n - 1, p.x, p.y, c, q.x, q.y)) this.pts.pop();
    }
  }

  /**
   * Is this end holding its vine over a ring it shot? (Wherever that bend sits in the path: another
   * one can appear between the sprout and its ring while it swings.)
   */
  hooked(end: 0 | 1) {
    return this.pts.find((w) => w.shot === end) ?? null;
  }

  /**
   * Shoot this end's vine over a ring: it becomes the end's pivot and stays there until it lets go,
   * and the vine grows by the sprout's reach to pay for the detour (see limit). Returns false when
   * even that isn't enough vine to go round, or when there's something solid in the way.
   */
  shoot(end: 0 | 1, peg: Pt, me: RopeGrip, other: RopeGrip, reach: number, force = false) {
    this.release(end);
    const myX = me.x;
    const myY = knotY(me);
    if (!force && !this.los(myX, myY, peg.x, peg.y)) return false;
    const w: Wrap = { x: peg.x, y: peg.y, s: 1, peg: true, shot: end };
    const pts = this.pts.slice();
    if (end === 0) pts.unshift(w);
    else pts.push(w);
    const [ax, ay] = end === 0 ? [myX, myY] : [other.x, knotY(other)];
    const [bx, by] = end === 0 ? [other.x, knotY(other)] : [myX, myY];
    // (a hook the partner's screen has already made stands: their sprout is theirs to simulate, and
    // two screens showing the vine over different rings would be worse than one showing a long one)
    if (!force && this.pathLength(pts, ax, ay, bx, by) > ROPE_LEN + reach) return false;
    if (end === 0) this.pts.unshift(w);
    else this.pts.push(w);
    // the shot vine is there at once (it's what reached the ring); it's only given back slowly
    this.growWant = Math.max(this.growWant, reach);
    this.grown = this.growWant;
    this.limit = ROPE_LEN + this.grown;
    this.measure();
    return true;
  }

  /**
   * Let go of a ring this end shot. The vine slips off it where it can lie straight past it — a
   * leftover detour would keep the vine long and drag whoever let go back toward the ring, which is
   * the opposite of what letting go of a swing should do.
   */
  release(end: 0 | 1) {
    const i = this.pts.findIndex((w) => w.shot === end);
    if (i < 0) return;
    delete this.pts[i].shot;
    const p = i > 0 ? this.pts[i - 1] : { x: this.ax, y: this.ay };
    const q = i < this.pts.length - 1 ? this.pts[i + 1] : { x: this.bx, y: this.by };
    if (this.los(p.x, p.y, q.x, q.y)) this.pts.splice(i, 1);
    if (!this.pts.some((w) => w.shot !== undefined)) {
      this.growWant = 0;
      this.owed = SHOT_OWED;
    }
    this.measure();
  }

  /**
   * Draw the shot vine back in once nobody is holding a ring with it. It only takes back slack, so
   * the coil never pulls on anyone — until it has been owed for SHOT_OWED seconds, after which it
   * comes in anyway rather than leaving the pair a longer vine than the levels are built for.
   */
  private reel(dt: number) {
    if (this.grown === this.growWant) return;
    if (this.grown < this.growWant) {
      this.grown = Math.min(this.growWant, this.grown + (ROPE_LEN / SHOT_REEL) * dt);
    } else {
      this.owed = Math.max(0, this.owed - dt);
      let step = (ROPE_LEN / SHOT_REEL) * dt;
      if (this.owed > 0) step = Math.min(step, Math.max(0, this.limit - this.length - 1));
      this.grown = Math.max(this.growWant, this.grown - step);
    }
    this.limit = ROPE_LEN + this.grown;
  }

  /** How long the string would be along `pts`: end 0's knot, through every bend, to end 1's. */
  private pathLength(pts: Wrap[], ax: number, ay: number, bx: number, by: number) {
    let total = 0;
    let px = ax;
    let py = ay;
    for (const w of pts) {
      total += Math.hypot(w.x - px, w.y - py);
      px = w.x;
      py = w.y;
    }
    return total + Math.hypot(bx - px, by - py);
  }

  /**
   * A bend that has straightened out, but whose straightened path would cut a corner of its own — at
   * a one-tile hole or the end of a wall the corner on the other side lies right inside the triangle
   * the string sweeps as it lets go. Bend around that one instead of lying through it. Returns false
   * when the bend really can go.
   */
  private rebend(i: number, px: number, py: number, c: Wrap, qx: number, qy: number) {
    if (this.los(px, py, qx, qy)) return false;
    const hit = this.firstCorner(px, py, c.x, c.y, qx, qy);
    if (!hit) return false;
    this.pts[i] = { x: hit.x, y: hit.y, s: Math.sign(cross(hit.x - px, hit.y - py, qx - hit.x, qy - hit.y)) || 1, peg: hit.peg };
    return true;
  }

  /**
   * A bend the string has folded right back along itself, with its two neighbours in plain sight of
   * each other: nothing holds it there, so it lets go. Climbing the string over a ledge corner and
   * mantling onto it leaves exactly this hairpin on the lip, and the winding-sign test below never
   * sees it (the string folded rather than swinging past), so the pair would stay hooked on the lip
   * and drag each other back to it.
   */
  private folded(px: number, py: number, c: Wrap, q: Pt) {
    if (c.peg) return false; // a ring is a hook: the string stays over it however it hangs
    const ux = c.x - px;
    const uy = c.y - py;
    const vx = q.x - c.x;
    const vy = q.y - c.y;
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    if (lu < 0.5 || lv < 0.5) return false;
    if ((ux * vx + uy * vy) / (lu * lv) > FOLD_DOT) return false;
    return this.los(px, py, q.x, q.y);
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
    if (!this.tied) return out;
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
    if (!this.tied) return;
    const [A, B] = birds;
    const active = A.present && B.present && !A.ghost && !B.ghost;
    this.reel(dt);
    const n = this.pts.length;
    const total = this.length;
    const excess = total - this.limit;
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
      e.limit = Math.min(this.limit - (total - e.seg), me.climbLen);
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
      // A bird holding on doesn't budge for the ordinary share — but with BOTH of them holding on,
      // nobody took any of the stretch and a mover carrying one away from the other pulled the vine
      // to 1.2× its length. Past GRIP_TOL the grips give ground: half each, so the two screens' halves
      // add up to the whole, and whoever gets pulled off their footing simply stops holding on.
      const grip = me.anchored && other.anchored ? (Math.max(0, excess) - GRIP_TOL) * 0.5 : 0;
      const corr = Math.min(MAX_CORR, Math.max(personal, Math.max(0, excess) * share, grip, me.anchored ? 0 : excess - this.slackTol));
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
          // (a frame of no length moved it nowhere in no time: keep the speed it already had)
          if (dt > 0) {
            me.vx = (me.x - me.prevX) / dt;
            me.vy = (me.y - me.prevY) / dt;
          }
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
    const target = Math.min(1, Math.max(0, (total - this.limit * 0.9) / (this.limit * 0.1)) + Math.min(1, maxPull * 0.2));
    this.tension += (target - this.tension) * 0.25;
  }

  /** Unit direction from a bird toward its pivot (for tugs), or null when it sits on it. */
  pullDir(end: 0 | 1, me: Pt & { ropeOff?: number }): Pt | null {
    if (!this.tied) return null;
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
