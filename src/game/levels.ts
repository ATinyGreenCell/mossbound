import type { LevelDef } from './level';

/**
 * Tiny terrain builder: levels are sculpted with code (ground runs, pits, ledges) and come out as the
 * ASCII map the parser reads, which keeps big maps easy to edit and impossible to misalign.
 *
 * Distances are tuned to the birds (see tuning.ts, verified in tests/e2e/physics.mjs):
 *   jump up ≤ 3 tiles · jump across ≤ 4 (5 with a flutter) · bounce off a partner ≤ 6 up
 *   springs ≤ 7 up · updrafts ≤ 12 up · the string is 8 tiles · a ring swing crosses a 6-tile pit
 *   when the ring is 2.5 tiles out and 1.5 up and the far side is a tile lower · a tug carries ~8.
 * Anything that takes one bird more than ~7 tiles from the other needs both of them (the string),
 * which is the point: lifts, ferries, fans and tall updrafts are ridden together.
 */
class Map {
  readonly g: string[][];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.g = Array.from({ length: h }, () => Array.from({ length: w }, () => ' '));
  }
  set(x: number, y: number, c: string) {
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.g[y][x] = c;
    return this;
  }
  /** Fill the rectangle x0..x1 × y0..y1 (inclusive). */
  fill(x0: number, y0: number, x1: number, y1: number, c: string) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
    return this;
  }
  /** Solid ground from row `top` to the bottom, columns x0..x1. */
  ground(x0: number, x1: number, top: number, c = '#') {
    return this.fill(x0, top, x1, this.h - 1, c);
  }
  /** Empty columns x0..x1 from row `top` down (a pit). */
  pit(x0: number, x1: number, top = 0) {
    return this.fill(x0, top, x1, this.h - 1, ' ');
  }
  row(x0: number, x1: number, y: number, c: string) {
    return this.fill(x0, y, x1, y, c);
  }
  /** Seeds along a row (every `step` tiles), only into empty space. */
  seeds(x0: number, x1: number, y: number, step = 1) {
    for (let x = x0; x <= x1; x += step) if (this.g[y]?.[x] === ' ') this.set(x, y, '*');
    return this;
  }
  build() {
    return this.g.map((r) => r.join(''));
  }
}

// ------------------------------------------------------------------ 1 · the garden (learn the ropes)

function garden(): LevelDef {
  const m = new Map(150, 18);
  const F = 14; // floor row
  m.ground(0, 149, F);
  m.set(3, F - 1, '1').set(5, F - 1, '2');
  m.set(8, F - 1, 'i');
  m.seeds(10, 13, F - 2);
  m.fill(15, F - 2, 17, F - 1, '#');
  m.seeds(15, 17, F - 3);
  m.seeds(19, 21, F - 2);
  // two little pits
  m.set(22, F - 1, 'i');
  m.pit(24, 26, F);
  m.set(24, F - 3, '*').set(25, F - 4, '*').set(26, F - 3, '*');
  m.set(29, F - 1, 'i');
  m.pit(31, 34, F);
  m.set(31, F - 3, '*').set(32, F - 4, '*').set(33, F - 4, '*').set(34, F - 3, '*');
  m.set(38, F - 1, 'C');
  // a ledge too high to jump: bounce off your partner, then climb the string
  m.row(40, 42, F - 5, '=');
  m.set(41, F - 6, 'F');
  m.set(44, F - 1, 'i');
  m.set(46, F - 1, 'i');
  m.ground(49, 64, F - 5);
  m.seeds(51, 57, F - 6);
  // the chasm: swing under the ring
  m.set(60, F - 6, 'i');
  m.pit(65, 70, F - 5);
  m.set(67, F - 7, 'o');
  m.set(66, F - 9, '*').set(67, F - 9, '*').set(68, F - 9, '*');
  m.ground(71, 80, F - 3);
  m.set(74, F - 4, 'C');
  // a branch four rows up — higher than a jump, so the way to it is a vine shot
  m.set(71, F - 4, 'i');
  m.set(72, F - 7, 'o');
  m.seeds(70, 74, F - 5, 2);
  // the springboard: one sails across off the other's head, then tugs the other over
  m.set(77, F - 4, 'i');
  m.pit(81, 85, F - 3);
  m.set(83, F - 9, 'F');
  m.seeds(82, 84, F - 6);
  m.ground(86, 98, F - 3);
  m.seeds(88, 95, F - 4);
  // down to the meadow and the nest
  m.fill(99, F - 2, 101, F - 1, '#');
  m.set(103, F - 1, 'i');
  m.seeds(104, 112, F - 1, 2);
  m.set(114, F - 1, 'S');
  m.row(112, 118, F - 7, '=');
  m.set(115, F - 8, 'F');
  m.seeds(113, 117, F - 10);
  m.seeds(120, 132, F - 2, 3);
  m.set(140, F - 1, 'N');
  return {
    id: 'garden',
    name: 'The Garden',
    subtitle: 'morning · learn the ropes',
    theme: 'garden',
    song: 'garden',
    map: m.build(),
    signs: [
      'Hello, little sprouts! {move} to walk, {jump} to jump. The vine keeps you two close.',
      'Hold {jump} while falling to glide down on a leaf. The small sprout can {dash} in mid-air, and climb walls.',
      'Fell in? If your partner is on the ground, the vine catches you — push {climb} to climb back up.',
      'Too high to jump? Stand still and let your partner hop on your head!',
      'Left down here? Stand below and push {climb} to climb the vine.',
      'Too far to jump. Leap over the ring — the vine wraps around it. Push {move} to pump the swing, {jump} to let go.',
      'A branch, too high to jump to. Point at it and {shoot} to throw your vine over it — then swing, {climb} to pull yourself up, or {shoot} again to let go.',
      'Too far again! Run and bounce off your partner’s head to sail across — then {tug} to yank them over (too heavy? hold on while they climb).',
      'Flowers bounce. And send your partner a {heart} now and then.',
    ],
  };
}

// ------------------------------------------------------------------ 2 · woodland pegs

function woods(): LevelDef {
  const m = new Map(172, 24);
  const F = 14;
  // start among the trunks
  m.ground(0, 25, F);
  m.set(3, F - 1, '1').set(5, F - 1, '2');
  m.set(8, F - 1, 'i');
  m.fill(12, F - 2, 13, F - 1, 'X');
  m.seeds(15, 21, F - 2, 2);
  // the stream: swing to the island, swing again
  m.set(23, F - 1, 'i');
  m.pit(26, 31);
  m.set(28, F - 2, 'o');
  m.seeds(27, 30, F - 5);
  m.ground(32, 35, F + 2);
  m.pit(36, 41);
  m.set(38, F, 'o');
  m.seeds(37, 40, F - 3);
  m.ground(42, 55, F + 4);
  m.set(45, F + 3, 'C');
  // the cracking bridge, and a feather down in the hollow (lower your partner on the string)
  m.set(49, F + 3, 'i');
  m.pit(56, 63);
  m.row(56, 63, F + 4, '%');
  m.seeds(57, 62, F + 3);
  m.set(60, F + 6, 'F');
  m.ground(64, 80, F + 4);
  m.seeds(66, 70, F + 3, 2);
  // the old oak: a blossom (or your partner's head) bounces you up
  m.set(72, F + 3, 'i');
  m.set(78, F + 3, 'S');
  m.ground(81, 100, F - 2);
  m.set(84, F - 3, 'C');
  m.row(88, 90, F - 8, '=');
  m.set(89, F - 9, 'F');
  m.seeds(86, 98, F - 3, 2);
  // stepping stumps: take turns swinging, each a little lower
  m.set(97, F - 3, 'i');
  m.pit(101, 106);
  m.set(103, F - 4, 'o');
  m.ground(107, 109, F);
  m.pit(110, 115);
  m.set(112, F - 2, 'o');
  m.ground(116, 118, F + 2);
  m.set(117, F - 4, 'F');
  m.pit(119, 124);
  m.set(121, F, 'o');
  m.ground(125, 171, F + 4);
  m.set(128, F + 3, 'C');
  m.seeds(129, 133, F + 3);
  // roots arch over that stretch a tile above the ground: the seeds under them are the small
  // sprout's to fetch, since the tall one doesn't fit through a one-tile gap
  m.fill(129, F + 2, 133, F + 2, 'X');
  // up into the canopy
  m.fill(134, F + 1, 136, F + 3, 'X');
  m.ground(137, 171, F - 2);
  m.seeds(139, 155, F - 3, 2);
  m.set(160, F - 3, 'N');
  return {
    id: 'woods',
    name: 'Woodland Rings',
    subtitle: 'golden hour · swings and stumps',
    theme: 'woods',
    song: 'woods',
    map: m.build(),
    signs: [
      'Old rings in the trees: the vine wraps around them, so you can swing.',
      'Swing, land, swing again. Push along the swing to build it up — {jump} to let go.',
      'This bridge is cracking! Cross it quickly — whoever falls, the other catches.',
      'A blossom! It bounces you up the old oak — or hop on your partner.',
      'Take turns: one swings to the next stump, then the other follows.',
    ],
  };
}

// ------------------------------------------------------------------ 3 · the old mill

function mill(): LevelDef {
  const m = new Map(170, 22);
  const F = 16;
  m.ground(0, 51, F);
  m.set(3, F - 1, '1').set(5, F - 1, '2');
  m.set(8, F - 1, 'i');
  m.seeds(10, 16, F - 2, 2);
  // two airlocks: hold the gate for each other
  m.set(21, F - 1, 'p');
  m.fill(26, 0, 26, F - 5, 'X');
  m.fill(26, F - 4, 26, F - 1, 'P');
  m.set(28, F - 1, 'p');
  m.row(28, 30, F - 5, '=');
  m.set(29, F - 6, 'F');
  m.set(32, F - 1, 'q');
  m.fill(34, 0, 34, F - 5, 'X');
  m.fill(34, F - 4, 34, F - 1, 'Q');
  m.set(37, F - 1, 'q');
  // the millstone gate: a slab only the tall sprout is heavy enough to hold down, and a latch on the
  // far side for the small one to hold open on the way back — one of them can't do it alone either way
  m.set(39, F - 1, 'i');
  m.set(41, F - 1, 'Z');
  m.fill(44, 0, 44, F - 5, 'X');
  m.fill(44, F - 4, 44, F - 1, 'R');
  m.set(47, F - 1, 'r');
  m.seeds(38, 40, F - 2);
  // the lift up the mill wall (shaft 49..51)
  m.set(46, F - 1, 'i');
  for (let y = F - 2; y >= F - 8; y -= 2) m.set(50, y, '*');
  m.ground(52, 70, F - 9);
  m.set(55, F - 10, 'C');
  m.seeds(57, 68, F - 10, 2);
  // the mill race: ride the ferry together
  m.ground(71, 76, F - 6);
  m.set(73, F - 7, 'i');
  m.pit(77, 90);
  m.set(84, F - 10, 'o');
  m.set(84, F - 12, 'F');
  m.seeds(79, 88, F - 8, 3);
  m.ground(91, 130, F - 6);
  // the fans: warm air from the millstones floats you up to the loft
  m.set(98, F - 7, 'C');
  m.set(102, F - 7, 'i');
  m.set(106, F - 6, 'U');
  m.row(102, 130, 3, 'X');
  m.set(106, 3, ' ');
  m.row(112, 118, 3, '%');
  m.set(103, 4, 'F');
  m.seeds(108, 111, 2);
  m.seeds(119, 128, 2, 3);
  m.seeds(110, 124, F - 7, 2);
  // the mill roof: one more springboard, and the nest
  m.ground(131, 169, 6);
  m.set(136, 5, 'i');
  m.pit(140, 145, 6);
  m.seeds(141, 144, 2);
  m.seeds(147, 155, 5, 2);
  m.set(160, 5, 'N');
  return {
    id: 'mill',
    name: 'The Old Mill',
    subtitle: 'afternoon · plates and gates',
    theme: 'mill',
    song: 'mill',
    map: m.build(),
    movers: [
      { x: 49, y: F, w: 3, path: [[0, -9]], period: 8 },
      { x: 77, y: F - 6, w: 3, path: [[11, 0]], period: 9 },
    ],
    signs: [
      'Plates open the gates of their color. Stand on one so your partner can pass — then swap.',
      'This millstone slab is heavy — only the tall sprout can hold it down. Small one, slip through and stand on the latch.',
      'The lift goes up the mill wall. Hop on together — the vine won’t stretch for one of you.',
      'The ferry crosses the mill race. Ride it together!',
      'Fans in the floor: the warm air floats you up to the loft.',
      'Remember the springboard? Bounce, sail across, then {tug} (too heavy? hold on while they climb).',
    ],
  };
}

// ------------------------------------------------------------------ 4 · rooftops of paris

function paris(): LevelDef {
  const m = new Map(190, 26);
  // rooftops (streets between them are drops into the dark)
  m.ground(0, 14, 14);
  m.set(3, 13, '1').set(5, 13, '2');
  m.set(8, 13, 'i');
  m.seeds(10, 13, 12);
  m.seeds(15, 17, 11);
  m.ground(18, 30, 14);
  m.seeds(20, 28, 13, 2);
  m.seeds(31, 34, 10);
  m.ground(35, 52, 13);
  // a chimney updraft to the tall roof
  m.set(47, 12, 'i');
  m.set(50, 13, 'U');
  m.set(49, 1, 'F');
  m.ground(53, 70, 4);
  m.set(56, 3, 'C');
  m.seeds(58, 64, 3, 2);
  // the boulevard: ride the window-washer's gondola (a feather waits on a balcony below)
  m.set(66, 3, 'i');
  m.set(76, 1, 'o');
  m.row(78, 80, 11, '=');
  m.set(79, 10, 'F');
  m.ground(81, 95, 6);
  m.set(88, 5, 'C');
  m.seeds(84, 94, 5, 2);
  // café awnings up the tall facade
  m.ground(96, 110, 12);
  m.set(99, 11, 'i');
  m.seeds(100, 106, 11, 2);
  m.set(108, 11, 'S');
  m.ground(111, 130, 6);
  m.set(114, 5, 'C');
  m.seeds(116, 122, 5, 2);
  // loose tiles over the courtyard (a feather down there, for whoever gets lowered)
  m.set(124, 5, 'i');
  m.row(131, 142, 6, '%');
  m.set(134, 12, 'F');
  m.seeds(132, 141, 4, 3);
  m.ground(143, 189, 6);
  m.seeds(145, 160, 5, 3);
  // the rooftop garden, and the nest with a view of the tower
  m.set(165, 5, 'i');
  m.set(176, 5, 'N');
  return {
    id: 'paris',
    name: 'Rooftops of Paris',
    subtitle: 'sunset · chimneys and awnings',
    theme: 'paris',
    song: 'paris',
    map: m.build(),
    movers: [{ x: 71, y: 6, w: 3, path: [[7, 0]], period: 8 }],
    signs: [
      'Paris at sunset! The streets are narrow up here — hop across.',
      'Warm chimney air floats you up. Ride it together — the tall roof is out of one vine’s reach!',
      'Hop on the window-washer’s gondola together.',
      'Café awnings are bouncy!',
      'Loose tiles! Run across — they come back in a moment.',
      'Look — the tower. Shall we climb it? ♥',
    ],
  };
}

// ------------------------------------------------------------------ 5 · the iron lady (a climb)

function tower(): LevelDef {
  const W = 46;
  const H = 112;
  const G = 108;
  const m = new Map(W, H);
  m.ground(0, W - 1, G);
  // the legs: the tower narrows as you climb
  const inset = (y: number) => (y >= 96 ? 1 : Math.min(13, 1 + Math.floor((96 - y) / 7)));
  for (let y = 0; y < G; y++) {
    const k = inset(y);
    m.fill(0, y, k, y, '#');
    m.fill(W - 1 - k, y, W - 1, y, '#');
  }
  /** A girder plank, kept inside the tower at that height. */
  const plank = (x0: number, x1: number, y: number, c = '=') => m.row(Math.max(x0, inset(y) + 1), Math.min(x1, W - 2 - inset(y)), y, c);
  m.set(20, G - 1, '1').set(24, G - 1, '2');
  m.set(16, G - 1, 'i');
  m.seeds(26, 32, G - 1, 2);
  // stage 1: a staircase of girders, then a big step (bounce + climb)
  plank(6, 12, 105);
  plank(14, 20, 102);
  plank(22, 28, 99);
  plank(30, 36, 96);
  plank(22, 27, 93);
  plank(14, 19, 90);
  plank(4, 12, 84);
  m.set(6, 79, 'F');
  for (const [x, y] of [[9, 104], [17, 101], [25, 98], [33, 95], [24, 92], [16, 89]]) m.set(x, y, '*');
  plank(2, 43, 81);
  m.set(24, 80, 'C');
  // stage 2: the fan shaft, a ring swing across, a crumbling ledge
  m.set(20, 80, 'i');
  m.set(34, 81, 'U');
  plank(35, 40, 70);
  m.set(32, 68, 'o');
  plank(23, 28, 72);
  plank(15, 20, 69);
  // (girder 66 reaches left to column 20, over the end of girder 63: the step up to 63 is three rows,
  // all a tall sprout's jump has, so it needs a takeoff edge above the landing rather than two
  // columns short of it. At 22-27 it was the tightest step in the game — a tenth of a second wide.)
  plank(20, 25, 66);
  plank(14, 19, 63);
  plank(21, 26, 61, '%');
  for (const [x, y] of [[37, 69], [25, 71], [17, 68], [22, 65], [16, 62]]) m.set(x, y, '*');
  plank(7, 38, 58);
  m.set(20, 57, 'C');
  m.set(36, 52, 'F');
  // stage 3: the service lift
  m.set(24, 57, 'i');
  for (let y = 54; y >= 40; y -= 3) m.set(27, y, '*');
  plank(10, 35, 36);
  m.set(16, 35, 'C');
  // stage 4: the spire
  m.set(12, 35, 'S');
  plank(11, 16, 29);
  plank(19, 24, 26);
  plank(12, 17, 23);
  plank(20, 26, 20);
  m.set(25, 20, 'U');
  for (const [x, y] of [[14, 28], [21, 25], [14, 22], [22, 19]]) m.set(x, y, '*');
  plank(14, 31, 9);
  m.set(18, 8, 'i');
  m.set(22, 8, 'N');
  m.set(22, 3, 'F');
  m.seeds(15, 20, 8, 2);
  return {
    id: 'tower',
    name: 'The Iron Lady',
    subtitle: 'night · up, up, together',
    theme: 'tower',
    song: 'tower',
    map: m.build(),
    vertical: true,
    movers: [{ x: 26, y: 58, w: 3, path: [[0, -22]], period: 11 }],
    signs: [
      'Up, up, together! Whoever slips, the other one catches.',
      'The fan in the floor blows you up the shaft — ride it together.',
      'The service lift — ride it up together!',
      'We made it to the top. Look at all the lights ♥',
    ],
  };
}

export const LEVELS: LevelDef[] = [garden(), woods(), mill(), paris(), tower()];
