import { clamp } from '../core/math';
import {
  F_ANCHOR,
  F_CLIMB_DOWN,
  F_CLING,
  F_DASH,
  F_CLIMB_UP,
  F_FLUTTER,
  F_GHOST,
  F_GOAL,
  F_GROUND,
  F_HANG,
  F_INVULN,
  F_LEFT,
  F_MENU,
  F_STRAIN,
  F_VENT,
  type Snap,
} from '../net/protocol';
import type { Bird } from './bird';
import { BIRD_H, BIRD_W, FALL_MULT, FLUTTER_FALL, GRAVITY, MAX_FALL } from './tuning';
import type { World } from './world';

/** Snapshots older than this are dropped from the buffer. */
const KEEP_MS = 1500;
/** Window for the "fastest packet" transit estimate. */
const OFFSET_WINDOW_MS = 4000;
/** Extrapolate at most this far past the newest snapshot, then hold still. */
const MAX_EXTRAP_S = 0.12;
/** Playback slows down over this much of the extrapolation window (ms) instead of stopping dead. */
const EASE_MS = 80;
/** A late (reordered) snapshot is still slotted in if it's at most this many behind the newest. */
const REORDER_SEQ = 64;
/** Never buffer more than this many (they're pruned by age; this caps a misbehaving sender). */
const MAX_BUF = 256;
/** How fast a correction to the drawn position melts away (seconds). */
const SMOOTH_TAU = 0.1;
/** Corrections bigger than this snap instead (a respawn or a teleport). */
const SNAP_DIST = 96;

/**
 * The partner's bird, mirrored from their snapshots. A jitter buffer plays them back slightly in
 * the past so motion stays smooth through uneven delivery and lost packets:
 *  - each snapshot's arrival is mapped onto our clock by the fastest transit seen recently (no clock
 *    sync needed, and drift just slides the window);
 *  - the playback delay follows the measured jitter and send interval, slewed so time never jumps;
 *  - the playback clock runs a little fast to catch up and slows down as the buffer runs dry, so a
 *    burst of loss makes the bird hesitate rather than freeze and then leap;
 *  - late (reordered) snapshots are slotted in rather than wasted;
 *  - positions use Hermite curves through the snapshot velocities (jump arcs stay round);
 *  - whatever jump remains (new data correcting a guess) melts away over a tenth of a second;
 *  - a bird standing on a moving platform is drawn relative to it, so it never slides off.
 */
export class RemoteFeed {
  /** the partner's body (its sprout): set by the session */
  body: FeedBody = { g: GRAVITY, w: BIRD_W, h: BIRD_H };
  private buf: Snap[] = [];
  private lastSeq = -1;
  private offs: { at: number; off: number }[] = [];
  private minOff = Infinity;
  /** minOff, slewed (what playback actually uses) */
  private baseOff = NaN;
  private jitter = 10;
  private interval = 33;
  /** playback delay behind the newest snapshot's estimated arrival, ms */
  delay = 90;
  /** performance.now() when the last snapshot arrived */
  lastHeard = 0;
  /** level nonce of the last accepted snapshot */
  nonce = -1;
  private prevGrounded = false;
  private prevVy = 0;
  /** playback time on the sender's clock (NaN until the first sample) */
  private play = NaN;
  /** the raw playback position last frame, and the correction being melted into the drawn one */
  private rawX = NaN;
  private rawY = 0;
  private errX = 0;
  private errY = 0;

  reset() {
    this.buf.length = 0;
    this.lastSeq = -1;
    this.offs.length = 0;
    this.minOff = Infinity;
    this.baseOff = NaN;
    this.play = NaN;
    this.rawX = NaN;
    this.errX = this.errY = 0;
  }

  get hasData() {
    return this.buf.length > 0;
  }

  /** Feed one snapshot (they may arrive out of order or not at all). */
  push(s: Snap, now = performance.now()) {
    const buf = this.buf;
    // the partner reloaded or restarted their counter, or their clock went backwards: start over
    if (this.lastSeq >= 0 && s.seq < this.lastSeq - 200) this.reset();
    else if (buf.length && s.seq > this.lastSeq && s.t < buf[buf.length - 1].t - 1000) this.reset();
    // after a long silence (their phone slept, perhaps with its clock stopped) transit is measured
    // afresh: the old fastest-packet estimate may belong to a different clock now
    if (this.lastHeard && now - this.lastHeard > 1000) {
      this.offs.length = 0;
      this.minOff = Infinity;
    }
    let at = buf.length;
    if (s.seq <= this.lastSeq) {
      // late: overtaken by a newer one. Still worth slotting in unless it's a duplicate or ancient.
      if (s.seq < this.lastSeq - REORDER_SEQ) return;
      while (at > 0 && buf[at - 1].seq > s.seq) at--;
      if (at === 0 || buf[at - 1].seq === s.seq) return;
    }
    const prev = buf[buf.length - 1];
    this.lastHeard = now;
    const off = now - s.t;
    this.offs.push({ at: now, off });
    if (off < this.minOff) this.minOff = off;
    // expire old samples (recompute the minimum only when the best one leaves the window)
    let expired = false;
    while (this.offs.length && now - this.offs[0].at > OFFSET_WINDOW_MS) {
      if (this.offs[0].off <= this.minOff) expired = true;
      this.offs.shift();
    }
    if (expired) {
      this.minOff = Infinity;
      for (const o of this.offs) if (o.off < this.minOff) this.minOff = o.off;
    }
    if (Number.isNaN(this.baseOff)) this.baseOff = this.minOff;
    // how late this one was compared with the best case: rises fast, settles slowly
    const late = clamp(off - this.minOff, 0, 2000);
    this.jitter += (late - this.jitter) * (late > this.jitter ? 0.25 : 0.015);
    if (at < buf.length) {
      buf.splice(at, 0, s);
      return;
    }
    this.lastSeq = s.seq;
    this.nonce = s.n;
    if (prev && s.t > prev.t) this.interval += (clamp(s.t - prev.t, 5, 250) - this.interval) * 0.1;
    buf.push(s);
    while (buf.length > 2 && (buf[0].t < s.t - KEEP_MS || buf.length > MAX_BUF)) buf.shift();
  }

  /**
   * Write the partner's state at playback time into `bird` (position, velocity, flags). `dt` is the
   * frame time (slews the delay); `world` supplies moving platform positions at the shared clock.
   */
  sample(bird: Bird, world: World, dt: number, now = performance.now()) {
    const buf = this.buf;
    if (!buf.length) return false;
    // follow the fastest-transit estimate slowly so the timeline never jumps — except a clock step
    // (a device slept with its clock stopped), which re-locks at once instead of slewing for minutes
    if (Number.isFinite(this.minOff)) {
      const d = this.minOff - this.baseOff;
      if (Number.isNaN(this.baseOff) || Math.abs(d) > 250) this.baseOff = this.minOff;
      else this.baseOff += clamp(d, -40 * dt, 40 * dt);
    }
    // (rises quickly when the network gets worse, settles back slowly; the playback clock below
    // turns either into a gentle change of pace)
    const target = clamp(this.interval * 1.5 + this.jitter * 1.6 + 10, 40, 320);
    this.delay += clamp(target - this.delay, -40 * dt, 150 * dt);
    // the playback clock (sender's time) chases `want`: a little fast when behind, a little slow when
    // ahead, easing to a stop at the end of the extrapolation window rather than holding with a jolt
    const want = now - this.delay - this.baseOff;
    const prevPlay = this.play;
    if (Number.isNaN(this.play) || Math.abs(want - this.play) > 600) {
      this.play = want;
      this.rawX = NaN;
    } else {
      let rate = clamp(1 + (want - this.play) / 400, 0.8, 1.3);
      const room = buf[buf.length - 1].t + MAX_EXTRAP_S * 1000 - this.play;
      rate *= clamp(room / EASE_MS, 0, 1);
      this.play += dt * rate * 1000;
    }
    const cur = this.at(this.play, world, CUR);
    // keep the drawn bird continuous: when fresh data reshapes the curve under the playback point
    // (a guess corrected, a gap filled), the jump becomes an offset that melts away. The test is
    // exact: today's curve at last frame's time vs. what was drawn from it then. Platforms (which
    // move between frames) and real teleports are exempt.
    if (!Number.isNaN(this.rawX) && !cur.snap && cur.mover < 0) {
      const then = this.at(prevPlay, world, THEN);
      if (!then.snap && then.mover < 0) {
        this.errX -= then.x - this.rawX;
        this.errY -= then.y - this.rawY;
      }
    }
    this.rawX = cur.x;
    this.rawY = cur.y;
    const keep = Math.exp(-dt / SMOOTH_TAU);
    this.errX *= keep;
    this.errY *= keep;
    if (cur.snap || cur.mover >= 0 || Math.hypot(this.errX, this.errY) > SNAP_DIST) this.errX = this.errY = 0;
    bird.prevX = bird.x;
    bird.prevY = bird.y;
    bird.x = cur.x + this.errX;
    bird.y = cur.y + this.errY;
    bird.vx = cur.vx;
    bird.vy = cur.vy;
    bird.groundMover = cur.mover;
    this.applyFlags(bird, cur.flags);
    return true;
  }

  /** The playback curve at time `rt` (sender's clock), written into `o`. */
  private at(rt: number, world: World, o: Point) {
    const buf = this.buf;
    let i = buf.length - 1;
    while (i > 0 && buf[i].t > rt) i--;
    const a = buf[i];
    const b = buf[i + 1];
    o.mover = -1;
    o.snap = false;
    if (b && rt >= a.t) {
      const span = (b.t - a.t) / 1000;
      const u = clamp((rt - a.t) / (b.t - a.t || 1), 0, 1);
      o.flags = u < 0.5 ? a.flags : b.flags;
      // a teleport (respawn) snaps; a long gap at speed legitimately covers a lot of ground
      const reach = SNAP_DIST + Math.max(Math.hypot(a.vx, a.vy), Math.hypot(b.vx, b.vy)) * span * 1.5;
      const jump = Math.hypot(b.x - a.x, b.y - a.y) > reach || ((a.flags ^ b.flags) & F_GHOST) !== 0;
      if (a.mover >= 0 && a.mover === b.mover && a.mover < world.L.movers.length) {
        o.mover = a.mover;
        o.x = world.moverX[a.mover] + a.rx + (b.rx - a.rx) * u;
        o.y = world.moverY[a.mover] + a.ry + (b.ry - a.ry) * u;
      } else if (jump) {
        o.x = u < 0.5 ? a.x : b.x;
        o.y = u < 0.5 ? a.y : b.y;
        o.snap = true;
      } else if (span > 0.2) {
        o.x = a.x + (b.x - a.x) * u;
        o.y = a.y + (b.y - a.y) * u;
      } else {
        const u2 = u * u;
        const u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;
        o.x = h00 * a.x + h10 * span * a.vx + h01 * b.x + h11 * span * b.vx;
        o.y = h00 * a.y + h10 * span * a.vy + h01 * b.y + h11 * span * b.vy;
      }
      o.vx = a.vx + (b.vx - a.vx) * u;
      o.vy = a.vy + (b.vy - a.vy) * u;
      return o;
    }
    // past the newest (or before the oldest): coast briefly, then hold
    const s = rt < a.t ? buf[0] : a;
    o.flags = s.flags;
    o.vx = s.vx;
    o.vy = s.vy;
    if (s.mover >= 0 && s.mover < world.L.movers.length) {
      o.mover = s.mover;
      o.x = world.moverX[s.mover] + s.rx;
      o.y = world.moverY[s.mover] + s.ry;
    } else coast(s, clamp((rt - s.t) / 1000, 0, MAX_EXTRAP_S), world, o, this.body);
    return o;
  }

  private applyFlags(bird: Bird, f: number) {
    const grounded = (f & F_GROUND) !== 0;
    // landing squash, worked out on this side
    if (grounded && !this.prevGrounded && this.prevVy > 220) bird.squash = Math.min(0.42, this.prevVy / 1700);
    this.prevGrounded = grounded;
    this.prevVy = bird.vy;
    bird.grounded = grounded;
    bird.anchored = (f & F_ANCHOR) !== 0;
    bird.hanging = (f & F_HANG) !== 0;
    bird.ghost = (f & F_GHOST) !== 0;
    bird.inGoal = (f & F_GOAL) !== 0;
    bird.facing = (f & F_LEFT) !== 0 ? -1 : 1;
    bird.fluttering = (f & F_FLUTTER) !== 0;
    bird.climbing = (f & F_CLIMB_UP) !== 0 ? 1 : (f & F_CLIMB_DOWN) !== 0 ? -1 : 0;
    bird.inVent = (f & F_VENT) !== 0;
    bird.invuln = (f & F_INVULN) !== 0 ? 0.5 : 0;
    bird.cling = (f & F_CLING) !== 0 ? bird.facing : 0;
    bird.dashT = (f & F_DASH) !== 0 ? 0.05 : 0;
    if ((f & F_STRAIN) !== 0) bird.strain = 1;
    menuOpen.set(bird, (f & F_MENU) !== 0);
  }

  /** Milliseconds since the partner's last snapshot arrived. */
  silence(now = performance.now()) {
    return this.lastHeard ? now - this.lastHeard : Infinity;
  }
}

/** A point on the playback curve. */
interface Point {
  x: number;
  y: number;
  vx: number;
  vy: number;
  flags: number;
  mover: number;
  /** on a teleport segment (drawn as a jump, not smoothed) */
  snap: boolean;
}
const CUR: Point = { x: 0, y: 0, vx: 0, vy: 0, flags: 0, mover: -1, snap: false };
const THEN: Point = { ...CUR };

/**
 * Best guess at where the bird is `ahead` seconds after snapshot `s` (no newer one yet): a bird in
 * free flight follows its arc (gravity, flutter, terminal speed), one on the ground slows down, one
 * on the string or in a draft carries on straight; nothing goes through walls or floors.
 */
/** The partner's body, as far as guessing its motion goes (see traits.ts). */
export interface FeedBody {
  g: number;
  w: number;
  h: number;
}

function coast(s: Snap, ahead: number, world: World, o: Point, body: FeedBody) {
  const grounded = (s.flags & F_GROUND) !== 0;
  // (on a wall, on the string, in a dash or an updraft: no free fall to guess)
  const free = !grounded && (s.flags & (F_HANG | F_ANCHOR | F_VENT | F_CLING | F_DASH)) === 0;
  const flutter = (s.flags & F_FLUTTER) !== 0;
  const vx = s.vx * (grounded || (s.flags & F_ANCHOR) !== 0 ? 0.5 : 1);
  let vy = grounded ? 0 : s.vy;
  let x = s.x;
  let y = s.y;
  for (let t = 0; t < ahead - 1e-6; ) {
    const h = Math.min(1 / 120, ahead - t);
    t += h;
    if (free) {
      vy += (vy > 0 ? body.g * FALL_MULT : body.g) * h;
      if (flutter && vy > FLUTTER_FALL) vy = FLUTTER_FALL;
      if (vy > MAX_FALL) vy = MAX_FALL;
    }
    const nx = x + vx * h;
    const ny = y + vy * h;
    if (!world.boxFree(nx, ny, body.w, body.h)) break;
    x = nx;
    y = ny;
  }
  o.x = x;
  o.y = y;
}

/** The partner has their pause menu open (shown as a "…" bubble). */
export const menuOpen = new WeakMap<Bird, boolean>();
