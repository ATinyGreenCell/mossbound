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
/** clinging to a wall: climbing up / down it */
export const WALL_UP = 120;
export const WALL_DOWN = 170;
/** jumping off a wall: sideways speed, and how long pushing back toward the wall is ignored */
export const WALL_JUMP_VX = 300;
export const WALL_JUMP_LOCK = 0.16;

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

// ---- death & regroup
export const GHOST_TIME = 0.95;
export const INVULN_TIME = 1.2;

// ---- camera: how much of the world fits on screen
export const VIEW_TILES_H = 14.5;
export const VIEW_TILES_MIN_W = 17;
export const VIEW_TILES_MAX_W = 34;
