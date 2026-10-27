import type { ControlFrame } from '../core/input';
import { approach, clamp } from '../core/math';
import type { Pt } from './level';
import type { RopeBird, RopeEnd } from './tether';
import {
  ACCEL_AIR,
  ACCEL_GROUND,
  AIR_CARRY,
  RELEASE_BOOST,
  RELEASE_MIN_UP,
  SLIDE_DECEL,
  SWING_DRAG,
  BIRD_H,
  BIRD_W,
  BOUNCE_V,
  BOUNCE_V_SOFT,
  CLIMB_SPEED,
  COYOTE,
  DECEL_AIR,
  DECEL_GROUND,
  FALL_MULT,
  FLUTTER_FALL,
  FLUTTER_TIME,
  GHOST_TIME,
  GRAVITY,
  HANG_HOP_V,
  INVULN_TIME,
  JUMP_BUFFER,
  JUMP_CUT,
  JUMP_V,
  LIFT_SPEED,
  MAX_SPEED,
  MAX_FALL,
  ROPE_LEN,
  ROPE_MIN,
  RUN_MAX,
  SPRING_V,
  SWING_ACCEL,
  T,
  TURN_BOOST,
  VENT_ACCEL,
  VENT_MAX_UP,
} from './tuning';
import type { BodyLike, World } from './world';

/** Things a bird did this step, for sounds, particles and the network. */
export type BirdFx =
  | { k: 'jump' }
  | { k: 'hop' }
  | { k: 'land'; v: number }
  | { k: 'flutter' }
  | { k: 'spring'; i: number }
  | { k: 'bounce' }
  | { k: 'bonk' }
  | { k: 'die'; cause: 'spikes' | 'fall' }
  | { k: 'respawn' }
  | { k: 'step' }
  | { k: 'grab' }
  | { k: 'mantle' };

/** The other bird, as this bird's step sees it. */
export interface Partner extends BodyLike {
  present: boolean;
  anchored: boolean;
  hanging: boolean;
}

export const BIRD_COLORS: { name: string; body: string; dark: string; belly: string }[] = [
  { name: 'coral', body: '#ff7b5c', dark: '#d4503a', belly: '#ffe3cc' },
  { name: 'sky', body: '#5cb8ff', dark: '#3384d4', belly: '#e3f4ff' },
  { name: 'sunny', body: '#ffc93c', dark: '#dc9614', belly: '#fff4c8' },
  { name: 'mint', body: '#5fd6a4', dark: '#2fa577', belly: '#e2fff1' },
  { name: 'lilac', body: '#b48cff', dark: '#8659e0', belly: '#f2eaff' },
  { name: 'rose', body: '#ff8fc0', dark: '#dd5b96', belly: '#ffe8f2' },
  { name: 'snow', body: '#f6f3ec', dark: '#c3bbb0', belly: '#ffffff' },
  { name: 'ink', body: '#565c7d', dark: '#363a54', belly: '#cfd3e6' },
];

export class Bird implements RopeBird {
  readonly w = BIRD_W;
  readonly h = BIRD_H;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  prevX = 0;
  prevY = 0;
  grounded = false;
  groundMover = -1;
  dropT = 0;
  facing: 1 | -1 = 1;
  /** simulated on this screen (false: mirrored from the partner's snapshots) */
  local = true;
  /** the partner is connected (online) — an absent bird has no string */
  present = true;
  coyote = 0;
  jumpBuf = 0;
  jumping = false;
  flutter = FLUTTER_TIME;
  fluttering = false;
  anchored = false;
  hanging = false;
  climbLen = Infinity;
  climbing = 0;
  ghost = false;
  ghostT = 0;
  private ghostFromX = 0;
  private ghostFromY = 0;
  invuln = 0;
  tugCd = 0;
  bounceCd = 0;
  /** just got yanked by the string: lighter gravity so the arc carries */
  tuggedT = 0;
  inGoal = false;
  inVent = false;
  /** walking into a taut string (straining animation) */
  strain = 0;
  /** carrying a hanging partner: walking away from them is slower */
  lifting = false;
  /** the string's pull on this bird, from the last solve */
  rope: RopeEnd | null = null;
  /** this step's swing energy (after pumping), NaN when not swinging — the string keeps it */
  swingE = NaN;
  /** ran into something this step */
  bumped = false;
  // --- animation (drawn identically for local and mirrored birds)
  squash = 0;
  squashV = 0;
  walkPhase = 0;
  wingPhase = 0;
  blinkT = 2;
  lookX = 1;
  lookY = 0;
  emote: 'heart' | 'hey' | null = null;
  emoteT = 0;
  /** seconds since landing (dust, squash) */
  airT = 0;
  readonly fx: BirdFx[] = [];
  private stepT = 0;

  constructor(readonly idx: 0 | 1) {}

  place(p: Pt) {
    this.x = this.prevX = p.x;
    this.y = this.prevY = p.y;
    this.vx = this.vy = 0;
    this.grounded = false;
    this.groundMover = -1;
    this.hanging = false;
    this.anchored = false;
    this.climbLen = Infinity;
    this.ghost = false;
    this.jumping = false;
    this.flutter = FLUTTER_TIME;
    this.tuggedT = 0;
  }

  /** One physics step of a bird simulated on this screen. */
  step(dt: number, c: ControlFrame, world: World, partner: Partner | null) {
    this.prevX = this.x;
    this.prevY = this.y;
    this.coyote -= dt;
    this.jumpBuf -= dt;
    this.invuln -= dt;
    this.tugCd -= dt;
    this.bounceCd -= dt;
    this.dropT -= dt;
    this.tuggedT -= dt;
    this.swingE = NaN;
    this.bumped = false;
    if (this.ghost) return;

    // ride the moving platform underfoot
    if (this.grounded && this.groundMover >= 0) {
      const m = this.groundMover;
      world.moveX(this, world.moverDX[m]);
      world.moveY(this, world.moverDY[m]);
    }

    const mx = Math.abs(c.moveX) > 0.15 ? c.moveX : 0;
    if (c.jumpPressed) this.jumpBuf = JUMP_BUFFER;
    this.anchored = c.anchor && this.grounded && !this.hanging;
    const rope = this.rope;

    // --- horizontal
    if (this.hanging && rope) {
      // swing: push along the arc, a pendulum does the rest
      const dx = this.x - rope.pivot.x;
      const dy = this.y - rope.pivot.y;
      const len = Math.hypot(dx, dy) || 1;
      let tx = -dy / len;
      let ty = dx / len;
      if (tx * mx < 0) {
        tx = -tx;
        ty = -ty;
      }
      const push = Math.abs(mx) * SWING_ACCEL * dt;
      this.vx += tx * push;
      this.vy += ty * push;
      const drag = 1 - SWING_DRAG * dt;
      this.vx *= drag;
      this.vy *= drag;
      this.swingE = 0.5 * (this.vx * this.vx + this.vy * this.vy) - GRAVITY * this.y;
      if (Math.abs(this.vx) > 30) this.facing = this.vx > 0 ? 1 : -1;
    } else if (this.anchored) {
      this.vx = approach(this.vx, 0, DECEL_GROUND * 2 * dt);
    } else {
      let max = RUN_MAX;
      // lifting a partner who hangs on the string: hard work, slower steps
      if (this.lifting && rope && mx * (this.x - rope.pivot.x) > 0) max *= LIFT_SPEED;
      const target = mx * max;
      const fast = Math.abs(this.vx) > max;
      const along = mx === 0 || Math.sign(mx) === Math.sign(this.vx);
      let accel: number;
      if (this.grounded) {
        if (mx === 0) accel = DECEL_GROUND;
        else if (this.vx !== 0 && Math.sign(mx) !== Math.sign(this.vx)) accel = ACCEL_GROUND * TURN_BOOST;
        // landed faster than a run and still pushing: carry that speed a while
        else accel = fast ? SLIDE_DECEL : ACCEL_GROUND;
      } else if (fast && along) {
        // momentum from swings and tugs carries; it bleeds off slowly unless you push against it
        accel = AIR_CARRY;
      } else accel = mx !== 0 ? ACCEL_AIR : DECEL_AIR;
      this.vx = approach(this.vx, target, accel * dt);
      if (mx !== 0) this.facing = mx > 0 ? 1 : -1;
    }

    // --- climbing the string
    this.climbing = 0;
    if (this.hanging && rope) {
      if (Math.abs(c.moveY) > 0.3) {
        const cur = Math.min(this.climbLen, rope.seg);
        this.climbLen = clamp(cur - c.moveY * CLIMB_SPEED * dt, ROPE_MIN, ROPE_LEN);
        this.climbing = Math.sign(c.moveY);
      }
    } else if (this.grounded && !this.anchored && c.moveY > 0.55 && rope && rope.taut) {
      // stand under the string and push up: grab it and start climbing
      const dx = rope.pivot.x - this.x;
      const dy = rope.pivot.y - this.y;
      if (dy < -T && Math.abs(dx) < -dy * 0.75) {
        this.hanging = true;
        this.grounded = false;
        this.climbLen = Math.max(ROPE_MIN, rope.seg - 6);
        this.vy = -60;
        this.fx.push({ k: 'grab' });
      }
    }

    // --- jumping
    if (this.jumpBuf > 0) {
      if (this.hanging) {
        // let go: fly off with the swing's own speed (plus a flourish) and a kick upward
        this.vx *= RELEASE_BOOST;
        this.vy = Math.min(this.vy * RELEASE_BOOST - HANG_HOP_V, -RELEASE_MIN_UP);
        this.hanging = false;
        this.climbLen = Infinity;
        // a launch isn't cut short by letting go of the button
        this.jumping = false;
        this.jumpBuf = 0;
        this.flutter = FLUTTER_TIME;
        this.squash = -0.25;
        this.fx.push({ k: 'hop' });
      } else if (this.grounded || this.coyote > 0) {
        if (c.moveY < -0.5 && this.onPlank(world)) {
          // down + jump on a plank: drop through
          this.dropT = 0.22;
          this.grounded = false;
          this.groundMover = -1;
        } else {
          this.vy = -JUMP_V;
          this.jumping = true;
          this.squash = -0.3;
          this.fx.push({ k: 'jump' });
        }
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuf = 0;
        this.anchored = false;
      }
    }
    // let go early for a short hop
    if (this.jumping && !c.jump && this.vy < 0) {
      this.vy *= JUMP_CUT;
      this.jumping = false;
    }
    if (this.vy >= 0) this.jumping = false;

    // --- gravity, flutter, updrafts
    let g = GRAVITY;
    // snappy falls — but not on the swing, where uneven gravity would pump a pendulum higher each pass
    if (this.vy > 0 && !this.hanging) g *= FALL_MULT;
    if (this.tuggedT > 0) g *= 0.55;
    this.vy += g * dt;
    const wasFluttering = this.fluttering;
    this.fluttering = false;
    if (!this.grounded && !this.hanging && c.jump && this.vy > 0 && this.flutter > 0) {
      this.flutter -= dt;
      this.fluttering = true;
      if (this.vy > FLUTTER_FALL) this.vy = approach(this.vy, FLUTTER_FALL, 5200 * dt);
      if (!wasFluttering) this.fx.push({ k: 'flutter' });
    }
    this.inVent = false;
    for (const v of world.L.vents) {
      if (this.x > v.x0 && this.x < v.x1 && this.y > v.top && this.y < v.bottom) {
        this.inVent = true;
        this.vy = Math.max(-VENT_MAX_UP, this.vy - VENT_ACCEL * dt);
        this.flutter = FLUTTER_TIME;
        this.jumping = false;
      }
    }
    // terminal velocity for falls — but a swing's downstroke is bounded by the string, not air
    if (this.vy > MAX_FALL && !this.hanging) this.vy = MAX_FALL;

    // --- move
    const wasGrounded = this.grounded;
    const fallV = this.vy;
    const dx = this.vx * dt;
    if (world.moveX(this, dx)) {
      // a lip a few pixels high (a lift that has started down, a crumb of ledge): step up onto it
      if (!(wasGrounded && mx !== 0 && this.stepUp(world, Math.sign(dx)))) {
        this.strain = mx !== 0 ? 1 : 0;
        this.vx = 0;
        this.bumped = true;
      }
    }
    const r = world.moveY(this, this.vy * dt);
    if (r !== 0) this.bumped = true;
    if (r === 1) {
      if (!wasGrounded) {
        if (fallV > 220) {
          this.squash = Math.min(0.42, fallV / 1700);
          this.fx.push({ k: 'land', v: fallV });
        }
        this.hanging = false;
        this.climbLen = Infinity;
        this.tuggedT = 0;
      }
      this.vy = 0;
      this.grounded = true;
      this.coyote = COYOTE;
      this.flutter = FLUTTER_TIME;
    } else {
      if (r === -1) {
        if (this.vy < -120) this.fx.push({ k: 'bonk' });
        this.vy = Math.max(0, this.vy);
        this.jumping = false;
      }
      if (this.grounded) {
        this.grounded = false;
        this.groundMover = -1;
      }
    }

    // --- springs
    const springs = world.L.springs;
    for (let i = 0; i < springs.length; i++) {
      const s = springs[i];
      const bot = this.y + this.h / 2;
      if (Math.abs(this.x - s.x) < 15 && bot > s.y + T / 2 - 15 && bot < s.y + T / 2 + 2 && this.vy >= -10) {
        this.vy = -SPRING_V;
        this.grounded = false;
        // (a jump pressed a moment later mustn't replace the launch with an ordinary hop)
        this.coyote = 0;
        this.jumpBuf = 0;
        this.jumping = false;
        this.hanging = false;
        this.climbLen = Infinity;
        this.flutter = FLUTTER_TIME;
        this.squash = -0.4;
        world.springT[i] = 0.35;
        this.fx.push({ k: 'spring', i });
      }
    }

    // --- bounce off your partner's head (not off one hanging on the string: bouncing off a partner
    // who hangs from you would haul you both up forever)
    if (partner && partner.present && !partner.ghost && !partner.hanging && this.bounceCd <= 0 && this.vy > 40) {
      const myBot = this.y + this.h / 2;
      const prevBot = this.prevY + this.h / 2;
      const top = partner.y - partner.h / 2;
      if (Math.abs(this.x - partner.x) < 20 && myBot >= top - 4 && myBot <= top + 14 && prevBot <= top + 8) {
        this.y = top - this.h / 2 - 0.5;
        this.vy = -(c.jump ? BOUNCE_V : BOUNCE_V_SOFT);
        this.jumping = c.jump;
        this.bounceCd = 0.25;
        this.flutter = FLUTTER_TIME;
        this.hanging = false;
        this.climbLen = Infinity;
        this.squash = -0.35;
        this.fx.push({ k: 'bounce' });
      }
    }

    // --- dangers
    if (this.invuln <= 0 && world.hazard(this)) this.die('spikes');
    // (a safety net: nothing in the game moves a bird faster than this)
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > MAX_SPEED) {
      this.vx *= MAX_SPEED / sp;
      this.vy *= MAX_SPEED / sp;
    }
    if (this.y > world.floorY) this.die('fall');

    // footsteps for dust puffs
    if (this.grounded && Math.abs(this.vx) > 60) {
      this.stepT -= dt * (Math.abs(this.vx) / RUN_MAX);
      if (this.stepT <= 0) {
        this.stepT = 0.16;
        this.fx.push({ k: 'step' });
      }
    }
  }

  /** Step up onto a lip no taller than 9 px, if there's room. */
  private stepUp(world: World, dir: number) {
    for (const up of [3, 6, 9]) {
      if (world.boxFree(this.x + dir * 2, this.y - up, this.w, this.h)) {
        this.y -= up;
        this.x += dir * 2;
        return true;
      }
    }
    return false;
  }

  private onPlank(world: World) {
    const ty = Math.floor((this.y + this.h / 2 + 1) / T);
    const tx0 = Math.floor((this.x - this.w / 2 + 0.5) / T);
    const tx1 = Math.floor((this.x + this.w / 2 - 0.5) / T);
    if (this.groundMover >= 0) return true;
    for (let tx = tx0; tx <= tx1; tx++) if (world.solidAt(tx, ty)) return false;
    for (let tx = tx0; tx <= tx1; tx++) if (world.onewayAt(tx, ty)) return true;
    return false;
  }

  /** After the string was solved: decide whether we're hanging from it. */
  afterRope(world: World) {
    const rope = this.rope;
    if (this.ghost || this.grounded || !rope || !rope.taut) {
      // (nobody at the other end — a ghost, or gone — and there's nothing to hang from)
      if (this.hanging && (this.grounded || this.ghost || !rope || !rope.active)) {
        this.hanging = false;
        this.climbLen = Infinity;
      }
      // a slack string while airborne: still holding on if we were climbing, else let go
      if (this.hanging && rope && !rope.taut && this.climbLen === Infinity) this.hanging = false;
      return;
    }
    if (rope.pivot.y < this.y - 2) {
      if (!this.hanging) {
        this.hanging = true;
        this.climbLen = Infinity;
      }
    } else if (this.hanging && this.climbLen === Infinity) {
      this.hanging = false;
    }
    // reached the top of a ledge (climbing, or hauled up by the partner): pop up onto it
    if ((this.hanging && this.climbing > 0 && rope.seg < ROPE_MIN + 6) || rope.seg < 16) this.tryMantle(world);
  }

  private tryMantle(world: World) {
    const rope = this.rope!;
    const p = rope.pivot;
    if (!rope.pivotIsCorner && !rope.pivotIsBird) return;
    // the side with ground under it: next to the partner, or just above a ledge corner
    const y = rope.pivotIsBird ? p.y - 0.5 : p.y - this.h / 2 - 1.5;
    const near = rope.pivotIsBird ? this.w + 2 : this.w / 2 + 3;
    for (const off of [near, -near, near * 2, -near * 2, 0]) {
      const x = p.x + off;
      if (!world.boxFree(x, y, this.w, this.h)) continue;
      if (world.boxFree(x, y + 6, this.w, this.h)) continue; // nothing to stand on there
      this.x = x;
      this.y = y;
      this.vx = this.vy = 0;
      this.hanging = false;
      this.climbLen = Infinity;
      this.grounded = true;
      this.squash = 0.2;
      this.fx.push({ k: 'mantle' });
      return;
    }
  }

  die(cause: 'spikes' | 'fall') {
    if (this.ghost) return;
    this.ghost = true;
    this.ghostT = 0;
    this.ghostFromX = this.x;
    this.ghostFromY = Math.min(this.y, 1e6);
    this.vx = this.vy = 0;
    this.hanging = false;
    this.anchored = false;
    this.climbLen = Infinity;
    this.grounded = false;
    this.fx.push({ k: 'die', cause });
  }

  /**
   * A ghost drifts to its partner and pops back beside them. With no partner to go to (they're a ghost
   * too, or gone) it reforms at `home` — the checkpoint.
   */
  stepGhost(dt: number, world: World, partner: Partner | null, home: Pt) {
    if (!this.ghost) return;
    this.prevX = this.x;
    this.prevY = this.y;
    this.ghostT += dt;
    const toPartner = !!partner && partner.present && !partner.ghost;
    const tx = toPartner ? partner!.x : home.x;
    const ty = toPartner ? partner!.y - 26 : home.y;
    const u = Math.min(1, this.ghostT / GHOST_TIME);
    const e = u * u * (3 - 2 * u);
    this.x = this.ghostFromX + (tx - this.ghostFromX) * e;
    // falls out of the world come back up from just below the screen, not from far away
    const fromY = Math.min(this.ghostFromY, world.floorY);
    this.y = fromY + (ty - fromY) * e - Math.sin(u * Math.PI) * 40;
    if (u < 1) return;
    const spot = toPartner ? freeSpotNear(world, partner!.x, partner!.y, this.w, this.h) : freeSpotNear(world, home.x, home.y, this.w, this.h);
    const p = spot ?? home;
    this.place(p);
    this.invuln = INVULN_TIME;
    this.vy = -200;
    this.squash = -0.3;
    this.fx.push({ k: 'respawn' });
  }

  /** Per-frame animation (both local and mirrored birds). */
  animate(dt: number, lookAt: Pt | null) {
    // springy squash & stretch — sub-stepped, so a slow frame (or a phone's hiccup) can't make the
    // spring blow up and draw a giant bird
    for (let left = Math.min(dt, 0.1); left > 1e-6; left -= 1 / 120) {
      const h = Math.min(1 / 120, left);
      this.squashV += (-this.squash * 220 - this.squashV * 14) * h;
      this.squash += this.squashV * h;
    }
    this.squash = clamp(this.squash, -0.6, 0.6);
    if (Math.abs(this.squash) < 0.002 && Math.abs(this.squashV) < 0.02) this.squash = this.squashV = 0;
    if (this.grounded && Math.abs(this.vx) > 20) this.walkPhase += dt * (6 + Math.abs(this.vx) * 0.05);
    else this.walkPhase = 0;
    const flapping = this.fluttering || (!this.grounded && !this.hanging && this.vy < -100) || this.ghost;
    this.wingPhase += dt * (flapping ? 26 : this.hanging ? 8 : 0);
    if (!flapping && !this.hanging) this.wingPhase = 0;
    this.blinkT -= dt;
    if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 3;
    this.airT = this.grounded ? 0 : this.airT + dt;
    this.strain = Math.max(0, this.strain - dt * 4);
    if (this.emoteT > 0) {
      this.emoteT -= dt;
      if (this.emoteT <= 0) this.emote = null;
    }
    // eyes: toward the partner when idle, else where we're going
    let lx = this.facing;
    let ly = 0;
    if (Math.abs(this.vx) < 30 && lookAt && this.grounded) {
      const dx = lookAt.x - this.x;
      const dy = lookAt.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      lx = dx / d;
      ly = dy / d;
    } else if (!this.grounded) {
      ly = clamp(this.vy / 900, -0.6, 0.8);
    }
    this.lookX += (lx - this.lookX) * Math.min(1, dt * 10);
    this.lookY += (ly - this.lookY) * Math.min(1, dt * 10);
  }
}

/** A free spot for a bird near a point (above it first), or null. */
export function freeSpotNear(world: World, x: number, y: number, w: number, h: number): Pt | null {
  for (const [dx, dy] of [
    [0, -2],
    [-16, -2],
    [16, -2],
    [0, -22],
    [-26, -6],
    [26, -6],
    [0, -40],
    [-40, -20],
    [40, -20],
  ]) {
    if (world.boxFree(x + dx, y + dy, w + 2, h + 2)) return { x: x + dx, y: y + dy };
  }
  return null;
}
