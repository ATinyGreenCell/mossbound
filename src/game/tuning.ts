/** Tile size in world pixels. Everything else is in world pixels and seconds. */
export const T = 32;

// ---- body
export const BIRD_W = 20;
export const BIRD_H = 20;

// ---- running & jumping (Mario-ish: snappy acceleration, variable jump, coyote time, jump buffer)
export const RUN_MAX = 215;
export const ACCEL_GROUND = 2300;
export const DECEL_GROUND = 2700;
/** extra acceleration when reversing direction on the ground */
export const TURN_BOOST = 1.6;
export const ACCEL_AIR = 1450;
export const DECEL_AIR = 420;
/** airborne faster than a run (after a swing or a tug): speed bleeds off this slowly */
export const AIR_CARRY = 150;
/** landed faster than a run and still pushing that way: slide down to running speed this slowly */
export const SLIDE_DECEL = 900;
export const GRAVITY = 1900;
/** gravity multiplier while falling or after letting go of jump early */
export const FALL_MULT = 1.6;
export const JUMP_V = 640;
/** letting go of jump while rising keeps this much of the upward speed */
export const JUMP_CUT = 0.45;
/**
 * A jump rises for at least this long before letting go can cut it short. Without it the shortest hop
 * is "one animation frame at full speed" — 24 px on a 144 Hz laptop, 28 on a 60 Hz TV, 36 on a phone
 * the browser has dropped to 30 — so the same tap gave a different hop on every screen. 1/60 s keeps
 * the hop a 60 Hz screen always gave, which is the one most of this game is played on.
 */
export const JUMP_MIN_HOLD = 1 / 60;
export const MAX_FALL = 840;
/** nothing moves a bird faster than this (springs, tugs and big swings stay well under it) */
export const MAX_SPEED = 2000;
export const COYOTE = 0.1;
export const JUMP_BUFFER = 0.13;
/** hold jump while falling: little wings flap and slow the fall, for a moment per jump */
export const FLUTTER_TIME = 0.4;
export const FLUTTER_FALL = 300;
/** a bump on the head from a ceiling: slide around corners this close */
export const CORNER_NUDGE = 7;

// ---- the small sprout's moves (see traits.ts)
/** air dash: its speed, and how long it holds before gravity takes over again */
export const DASH_V = 560;
export const DASH_TIME = 0.15;
/** after a dash, this much of its speed carries on */
export const DASH_KEEP = 0.7;
/**
 * How hard a landing squashes a sprout: `/V` of the speed it hit the ground at, up to `MAX`. The
 * mirrored partner's landing is worked out on this side too (remote.ts), so both screens use these.
 */
/**
 * A landing kicks the camera by how far the sprout fell, not how fast: a fall reaches terminal velocity
 * in about four tiles, so by speed a plummet and a hop arrive the same. A sprout's own jump tops out at
 * ~4.1 tiles, so the kick starts just past that — below it, every hop would twitch the view.
 */
export const LAND_KICK_DROP = 4.6 * T;
export const LAND_KICK_FULL = 12 * T;
export const LAND_SQUASH_MAX = 0.56;
export const LAND_SQUASH_V = 1250;

/** clinging to a wall: climbing up / down it */
export const WALL_UP = 120;
export const WALL_DOWN = 170;
/** jumping off a wall: sideways speed, and how long pushing back toward the wall is ignored */
export const WALL_JUMP_VX = 300;
export const WALL_JUMP_LOCK = 0.16;
/**
 * Brushing a wall in mid-air leaves a kick available for this long — the Mario-style wall jump, which
 * both sprouts have (the climber's sticky cling is its own thing). Time two of them against opposite
 * walls and you climb a shaft; the same wall twice running is refused, so it's a climb, not a lift.
 */
export const WALL_KICK_WINDOW = 0.12;

// ---- the string
export const ROPE_LEN = 8 * T;
/** shortest a bird can climb the string to */
export const ROPE_MIN = 18;
export const CLIMB_SPEED = 130;
/** tangential push while swinging */
export const SWING_ACCEL = 760;
/** fraction of swing speed lost per second (a whisper: swings keep their height) */
export const SWING_DRAG = 0.012;
/** letting go of a swing: the swing's own speed (× this) plus an upward kick */
export const RELEASE_BOOST = 1.08;
export const HANG_HOP_V = 310;
/** a let-go always rises at least this fast */
export const RELEASE_MIN_UP = 200;
/** the string catches a fall with this much give (fraction of the speed bounced back) */
export const CATCH_BOUNCE = 0.12;
/** walking away from a partner who hangs on the string (you're lifting them) */
export const LIFT_SPEED = 0.55;
export const TUG_COOLDOWN = 0.75;
/** the string must be at least this long for a tug to do anything */
export const TUG_MIN = 2.2 * T;

// ---- the vine shot (a grapple): hook a ring or a branch and swing, climb or haul your partner up
/**
 * How wide of where you're pointing a shot still finds its ring (the cosine of the half-angle). A
 * grapple on a stick or a thumb is aimed roughly, so the shot picks the best ring in that direction
 * rather than asking for a line — the same forgiveness a swing gets from wrapping on its own.
 */
export const SHOT_CONE = 0.35;
/** pointing at nothing in particular shoots up and ahead, at this slope */
export const SHOT_DEFAULT_UP = 1.1;
/** you can't shoot again for this long — a miss costs a moment, as a tug does */
export const SHOT_COOLDOWN = 0.3;
/** a fresh hook holds the vine this much shorter than it is, so it goes taut and swings at once */
export const SHOT_TAKEUP = 10;
/**
 * Seconds for the vine to draw itself back in after a ring is let go. A shot grows the vine by the
 * sprout's reach, so a hook doesn't spend the slack keeping the pair together; letting go gives that
 * length back over this long, which reads as the vine coiling up rather than snapping the pair back.
 */
export const SHOT_REEL = 0.8;
/**
 * How long the vine waits for slack to appear before drawing the shot length in regardless. It would
 * rather not pull on anyone, but a pair who keep it taut can't keep a longer vine than the levels are
 * built around either.
 */
export const SHOT_OWED = 1.5;

// ---- co-op moves
/** landing on your partner's head bounces you up (holding jump: the full height) */
export const BOUNCE_V = 860;
/** landing on your partner without holding jump: a gentle hop (won't fling you off a lift) */
export const BOUNCE_V_SOFT = 420;

// ---- level things
export const SPRING_V = 1000;
export const VENT_ACCEL = 4200;
export const VENT_MAX_UP = 430;
export const VENT_HEIGHT = 12;
export const CRUMBLE_SHAKE = 0.45;
export const CRUMBLE_GONE = 3.2;
export const DOOR_HOLD = 0.5;

/** seconds a plant takes to unfurl its leaves after the small sprout grows it */
export const GROW_TIME = 0.45;

// ---- creatures
/**
 * Both creatures are kept in step between two screens the way everything else in the world is, and
 * nothing here may break that. A beetle's position is worked out from the shared clock alone (like a
 * moving platform), so it is never integrated and can never drift. A snaptrap never moves at all: it
 * runs a timer that always comes back round to dormant, so two screens starting it a few frames
 * apart end up in the same place, exactly as a crumbling block does.
 */
/** how fast a beetle trundles, px/s — about a third of RUN_MAX, so you can always outrun one */
export const BEETLE_SPEED = 70;
/**
 * How far it wanders either side of where the map put it, in tiles. A beetle measures its own
 * ledge, and without this a long floor would give one a forty-tile beat nobody can read or time.
 * Capping it means dropping a `b` somewhere says what that beetle will do: this much, each way,
 * less wherever a wall or a drop comes first.
 */
export const BEETLE_REACH = 4;
/** it pauses at each end of its ledge before turning round (seconds) */
export const BEETLE_TURN = 0.55;
export const BEETLE_W = 26;
export const BEETLE_H = 18;

/** how close a sprout has to come for a snaptrap to wake (px, from the trap's middle) */
export const TRAP_RANGE = 74;
/** it rears up for this long before it bites — the warning that makes it fair */
export const TRAP_TELL = 0.42;
/** and bites for this long, which is the only time it can hurt anyone */
export const TRAP_BITE = 0.22;
/** then hangs open, then shuts and rests. It can't be woken again until it is dormant. */
export const TRAP_HOLD = 0.3;
export const TRAP_REST = 1.15;
export const TRAP_W = 30;
/** closed, and reared up mid-bite */
export const TRAP_H = 20;
export const TRAP_H_OPEN = 44;

// ---- death & regroup
export const GHOST_TIME = 0.95;
export const INVULN_TIME = 1.2;

// ---- camera: how much of the world fits on screen
export const VIEW_TILES_H = 14.5;
export const VIEW_TILES_MIN_W = 17;
export const VIEW_TILES_MAX_W = 34;

// ---- the debug ground (core/debug.ts): dev tooling, never reachable in ordinary play
/** free-flight speed with noclip on; holding the hold-on button makes it three times that */
export const NOCLIP_SPEED = 340;
