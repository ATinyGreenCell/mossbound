import { makeControls, type ControlFrame } from '../core/input';
import type { Bird } from './bird';
import { T } from './tuning';

/**
 * Where it likes to stand: a pace and a half to one side of you, never at your feet. Walking at the
 * player themselves ends with it climbing onto their head, bouncing off it, landing on it again and
 * bouncing for ever — a partner that stands *beside* you can't.
 */
const STAND_OFF = 1.6 * T;
/**
 * Where it stands when you're in the flower pot. The pot only counts a sprout within 2.2 tiles of
 * its middle, and the usual standing-off distance plus the slack below can leave it just outside —
 * so the level would refuse to finish with both of you apparently standing in it.
 */
const STAND_IN_POT = 0.8 * T;
/** it sets off when it's this far from that spot, and stops when it's this close: no shuffling */
const START = 0.9 * T;
const STOP = 0.25 * T;
/** how long it keeps trying to climb after walking into something */
const HOP_TIME = 0.35;
/** it only climbs a wall it has got stuck on while you are at least this far above it */
const CLIMB_UP = 8;

/**
 * The practice partner: the second sprout, driven by the game rather than a second player, so one
 * person can practise the moves that take two. It only ever walks, hops and plants its roots —
 * tugging, shooting and dashing are left to the player, because those are the moves being learnt.
 *
 * What it does is deliberately plain, so it reads as a patient friend rather than as a player:
 * it walks to you and stops, and the moment the vine goes tight with you off the ground it plants
 * its roots and holds — which is what makes swinging, climbing the vine and being tugged practisable
 * alone. It can't be left behind, because the vine won't let it; if it does get itself stuck, the
 * pause menu brings it back.
 */
export class Dummy {
  private readonly c = makeControls();
  private hopT = 0;
  /** true while it is walking somewhere: kept between frames so it doesn't shuffle on the spot */
  private walking = false;

  /** The controls for `me` this frame, following `you`. */
  step(dt: number, me: Bird, you: Bird): ControlFrame {
    const c = this.c;
    c.moveX = 0;
    c.moveY = 0;
    c.jump = false;
    c.jumpPressed = false;
    c.anchor = false;
    c.tugPressed = c.dashPressed = c.shootPressed = c.heartPressed = c.heyPressed = false;
    this.hopT -= dt;
    if (me.ghost || !you.present) return c;
    // the vine is tight and they're off the ground: plant roots and be their anchor
    const rope = me.rope;
    if (rope?.taut && !you.grounded) {
      c.anchor = true;
      this.walking = false;
      return c;
    }
    // Gripping a wall it walked into: climb while they're above, let go when they aren't. Holding on
    // is what pushing into the wall does, so a partner that never presses climb hangs there for good —
    // and the ground can't be finished, since the pot wants both of you standing in it.
    if (me.cling !== 0) {
      this.walking = true;
      if (you.y < me.y - CLIMB_UP) {
        c.moveX = me.cling;
        c.moveY = 1;
      } else {
        c.moveX = -me.cling;
      }
      return c;
    }
    // keep to whichever side of them we're already on, and stand off a pace and a half from it
    const side = me.x <= you.x ? -1 : 1;
    // if we've ended up on top of them anyway (a fall, a bounce, a lift), step off sideways
    if (me.y + me.h / 2 < you.y - you.h / 2 + 6 && Math.abs(you.x - me.x) < T) {
      c.moveX = side;
      this.walking = true;
      return c;
    }
    const dx = you.x + side * (you.inGoal ? STAND_IN_POT : STAND_OFF) - me.x;
    const far = Math.abs(dx);
    if (far > START) this.walking = true;
    else if (far < STOP) this.walking = false;
    if (!this.walking) return c;
    c.moveX = Math.sign(dx);
    // Walked into a step, or they're well above us: hop. (A hop it doesn't need costs nothing — it
    // lands straight back where it was.) `blockedX`, not `bumped`: a bird resting on the ground falls
    // a hair and lands again every step, so `bumped` is true the whole time it is standing there —
    // which had the partner hopping without pause instead of walking.
    if (me.grounded && (me.blockedX || you.y < me.y - 2.5 * T)) this.hopT = HOP_TIME;
    if (this.hopT > 0) {
      c.jump = true;
      if (me.grounded) c.jumpPressed = true;
    }
    return c;
  }
}
