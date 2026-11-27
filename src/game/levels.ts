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
  // a beetle on the ledge you land on after the springboard — met once you are over, never on the
  // run-up, which is the one strip of ground that crossing has to have
  m.set(87, F - 4, 'i');
  m.set(96, F - 4, 'b');
  // down to the meadow and the nest
  m.fill(99, F - 2, 101, F - 1, '#');
  m.set(103, F - 1, 'i');
  m.seeds(104, 112, F - 1, 2);
  m.set(114, F - 1, 'S');
  m.row(112, 118, F - 7, '=');
  m.set(115, F - 8, 'F');
  m.seeds(113, 117, F - 10);
  m.set(119, F - 1, 'i');
  m.set(123, F - 1, 't');
  m.seeds(120, 132, F - 2, 3);
  // a patch of soil: the small sprout grows a leaf platform, and from it both of them reach the
  // seeds hanging above — two rows higher than a jump from the meadow can manage. (Clear of the seed
  // row above: a leaf unfurls over three tiles two rows up, and would be drawn over a seed sitting there.)
  m.set(131, F - 1, 'i');
  m.set(134, F, ',');
  m.seeds(133, 135, F - 6);
  m.set(140, F - 1, 'N');
  return {
    id: 'garden',
    name: 'Mossy Creek',
    subtitle: 'morning · learn the ropes',
    theme: 'garden',
    song: 'garden',
    map: m.build(),
    signs: [
      'Hello, little sprouts! {move} to walk, {jump} to jump. You two go your own way — until you stand together and {shoot} to tie your vines. Then the vine keeps you close (and {shoot} again lets it go).',
      'Hold {jump} while falling to glide down on a leaf. The small sprout can {dash} in mid-air, and climb walls.',
      'Fell in? If you are tied together and your partner is on the ground, the vine catches you — push {climb} to climb back up.',
      'Too high to jump? Stand still and let your partner hop on your head!',
      'Left down here? Tied together, stand below and push {climb} to climb the vine.',
      'Too far to jump. Tie up first, then leap over the ring — the vine wraps around it. Push {move} to pump the swing, {jump} to let go.',
      'A branch, too high to jump to. Point at it and {shoot} to throw your vine over it — then swing, {climb} to pull yourself up, or {shoot} again to let go.',
      'Too far again! Run and bounce off your partner’s head to sail across — then {tug} to yank them over (too heavy? hold on while they climb).',
      'A bristle beetle. It only ever paces its own patch — walk round it, or hop over. Those bristles smart.',
      'Flowers bounce. And send your partner a {heart} now and then.',
      'And a snaptrap, rooted there. Come close and it rears up — that is your moment. Lure it with one of you, cross with the other.',
      'Soil! Small sprout — stand on it and {shoot} your vine into the ground. Something will grow for you both to stand on.',
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
  // tucked against the trunk at 12-13, so its walk ends well before the stream's launch strip
  m.set(14, F - 1, 'b');
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
  // a beetle to get past before the bridge, so you reach it already moving — at the far end of the
  // bank, where its walk cannot reach back to the lantern at 45
  m.set(55, F + 3, 'b');
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
  // a patch of soil in the clearing: a grown leaf is the step up to the seeds in the branches
  m.set(92, F - 3, 'i');
  m.set(94, F - 2, ',');
  m.seeds(93, 95, F - 8);
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
  // the canopy: a beetle, then a trap rooted in the last stretch before the nest
  m.set(143, F - 3, 'b');
  m.set(152, F - 3, 't');
  m.set(160, F - 3, 'N');
  return {
    id: 'woods',
    name: 'Fern Falls',
    subtitle: 'golden hour · swings and stumps',
    theme: 'woods',
    song: 'woods',
    map: m.build(),
    signs: [
      'Old rings in the trees: tied together, the vine wraps around them, so you can swing.',
      'Swing, land, swing again. Push along the swing to build it up — {jump} to let go.',
      'This bridge is cracking! Cross it quickly — whoever falls, the other catches.',
      'A blossom! It bounces you up the old oak — or hop on your partner.',
      'More soil here. Grow a leaf and hop up — the tall one can use it too.',
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
  // back from the airlocks: its walk has to end before the strip the first gate is played from
  m.set(13, F - 1, 'b');
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
  m.set(66, F - 10, 'b');
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
  m.set(121, F - 7, 't');
  // the mill roof: one more springboard, and the nest
  m.ground(131, 169, 6);
  m.set(136, 5, 'i');
  m.pit(140, 145, 6);
  m.seeds(141, 144, 2);
  m.seeds(147, 155, 5, 2);
  m.set(152, 5, 'b');
  m.set(160, 5, 'N');
  return {
    id: 'mill',
    name: 'The Old Mill',
    subtitle: 'afternoon · by the millrace',
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
      'The lift goes up the mill wall. Tie up and hop on together — the vine won’t stretch for one of you.',
      'The ferry crosses the mill race. Ride it together!',
      'Fans in the floor: the warm air floats you up to the loft.',
      'Remember the springboard? Bounce, sail across, then {tug} (too heavy? hold on while they climb).',
    ],
  };
}

// ------------------------------------------------------------------ 4 · the cascades (Paris's rooftops until 1.9.0)

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
  m.set(25, 13, 'b');
  m.seeds(31, 34, 10);
  m.ground(35, 52, 13);
  // a chimney updraft to the tall roof
  m.set(42, 12, 'b');
  m.set(47, 12, 'i');
  m.set(50, 13, 'U');
  m.set(49, 1, 'F');
  m.ground(53, 70, 4);
  m.set(56, 3, 'C');
  m.seeds(58, 64, 3, 2);
  m.set(61, 3, 't');
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
  m.set(123, 5, 'b');
  // loose tiles over the courtyard (a feather down there, for whoever gets lowered)
  m.set(124, 5, 'i');
  m.row(131, 142, 6, '%');
  m.set(134, 12, 'F');
  m.seeds(132, 141, 4, 3);
  m.ground(143, 189, 6);
  m.seeds(145, 160, 5, 3);
  m.set(155, 5, 't');
  // the rooftop garden, and the nest with a view of the tower
  m.set(165, 5, 'i');
  m.set(176, 5, 'N');
  return {
    id: 'paris',
    name: 'The Cascades',
    subtitle: 'sunset · ledges and spray',
    theme: 'cascade',
    song: 'paris',
    map: m.build(),
    movers: [{ x: 71, y: 6, w: 3, path: [[7, 0]], period: 8 }],
    signs: [
      'The cascades at sunset! The gaps between the ledges are narrow up here — hop across.',
      'Spray off the falls floats you up. Tied together, ride it as a pair — the high ledge is out of one vine’s reach!',
      'Hop on the lily pad together — it drifts across.',
      'The big blossoms are bouncy!',
      'Loose stones! Run across — they come back in a moment.',
      'Listen — the great falls. Shall we climb beside them? ♥',
    ],
  };
}

// ------------------------------------------------------------------ 5 · the great falls (a climb; the Eiffel Tower until 1.9.0)

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
  // beetles pacing the staircase: a girder you have to land on at the right moment, not just reach
  m.set(19, 101, 'b');
  m.set(27, 98, 'b');
  plank(2, 43, 81);
  m.set(24, 80, 'C');
  // Well clear of the lantern at 24 — a trap you respawn into is a trap you never get past — and
  // at the other end of the girder from the fan at 34, which has to be walked up to and ridden.
  m.set(14, 80, 't');
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
  m.set(12, 57, 'b');
  m.set(36, 52, 'F');
  // stage 3: the service lift
  m.set(24, 57, 'i');
  for (let y = 54; y >= 40; y -= 3) m.set(27, y, '*');
  plank(10, 35, 36);
  m.set(16, 35, 'C');
  m.set(30, 35, 't');
  // stage 4: the spire
  m.set(12, 35, 'S');
  plank(11, 16, 29);
  plank(19, 24, 26);
  plank(12, 17, 23);
  plank(20, 26, 20);
  m.set(25, 20, 'U');
  for (const [x, y] of [[14, 28], [21, 25], [14, 22], [22, 19]]) m.set(x, y, '*');
  // (not the girder at 20: end to end that one is the step up, and a beetle would own all of it)
  m.set(16, 22, 'b');
  plank(14, 31, 9);
  m.set(18, 8, 'i');
  m.set(22, 8, 'N');
  m.set(22, 3, 'F');
  m.seeds(15, 20, 8, 2);
  return {
    id: 'tower',
    name: 'The Great Falls',
    subtitle: 'night · up, up, together',
    theme: 'falls',
    song: 'tower',
    map: m.build(),
    vertical: true,
    movers: [{ x: 26, y: 58, w: 3, path: [[0, -22]], period: 11 }],
    signs: [
      'Up, up, together! Whoever slips, the other one catches.',
      'The spray off the falls blows you up the shaft — ride it together.',
      'A log lift on a rope — ride it up together!',
      'We made it to the top. Look at the falls in the moonlight ♥',
    ],
  };
}

// ------------------------------------------------------------------ World 1's middle stops
//
// The Shallows, Lily Pond and Reed Run are stops 3, 4 and 5 of the first world (see game/worlds.ts),
// between Fern Falls and Old Snip's rapids — but they are appended to LEVELS here, after the tower,
// because the order of LEVELS is what two devices NAME a level by when one of them starts it for
// both, and an older build on the other side goes by the same list. Where a level sits on the map is
// worlds.ts's business, and nothing in the save or on the wire depends on it.
//
// They are also the first levels built around the creek rather than beside it. The creek's surface
// sits a tile and a quarter up from a map's bottom edge (Session.waterTop), so how deep the water
// comes depends on how many rows a map keeps under its floor: keep two, and a sprout standing down
// there is in it to the ankles, with a splash as it drops in (the same check that splashes into a
// pit). The Shallows wades those; Lily Pond holds its floor well clear of the water, so its pond is
// deep and the way over is the pads drifting across it.

// ------------------------------------------------------------------ stations
//
// The pieces the creek levels are made of. Each is a shape whose distances are already right (see the
// note at the top of this file), so a long level is composed of them rather than placed tile by tile —
// and the same thing means the same thing wherever it turns up. Where they go, in what order, and
// what is put between them is each level's own business, which is the part worth making by hand.

/** Shin-deep water: two rows down, so the creek comes over the gravel. Walk in, through, and out. */
const wade = (m: Map, x0: number, x1: number, F: number) => m.fill(x0, F, x1, F + 1, ' ');
/** A stone standing out of a wade, its top level with the bank either side. */
const stone = (m: Map, x: number, F: number) => m.fill(x, F, x, F + 1, '#');
/** A mat of old reeds over the water: it goes as you cross it. */
const mat = (m: Map, x0: number, x1: number, row: number) => m.pit(x0, x1, row).row(x0, x1, row, '%');
/** A plank shelf out over nothing: five rows over the ground is nobody's jump, so it takes two of you. */
const shelf = (m: Map, x0: number, x1: number, row: number) => m.row(x0, x1, row, '=');

// ------------------------------------------------------------------ 6 · the shallows (World 1 · 3)

/**
 * A broad, braided reach of the creek at midday: gravel bars, channels shin-deep enough to walk
 * through, and the deep ones that are not. Wading is the whole idea — the first three levels treat
 * water as the thing at the bottom of a pit, and here you stand in it on the second screen.
 *
 * Eighteen rows with the floor at 15 puts the creek three quarters of a tile over a wade's gravel and
 * a tile and three quarters under the bank: a wade is a two-row dip you hop out of, like the practice
 * ground's dips, and nothing about it is new code.
 *
 * It runs four acts and a shade over four hundred tiles, with seven lanterns: down the braided
 * shallows, over the first deep channel, up out of the water and back down into it twice more. The
 * first hundred and fifty of them are the level as 1.13 first built it, which is why the stations
 * there sit where they do.
 */
function shallows(): LevelDef {
  const m = new Map(440, 18);
  const F = 15;
  m.ground(0, 439, F);
  // ===== act one: the braided shallows
  m.set(3, F - 1, '1').set(5, F - 1, '2');
  m.set(9, F - 1, 'i');
  m.seeds(11, 15, F - 2);
  // --- the first wade: two rows down, which the creek comes most of the way up. In, through, out.
  m.set(16, F - 1, 'i');
  wade(m, 18, 24, F);
  m.seeds(19, 23, F - 1);
  // --- a gravel bar with a beetle pacing it. Its walk (BEETLE_REACH is 4 tiles each way) stays well
  // inside the bar, so it can reach neither wade's edge — which is where a crossing is launched from.
  m.set(27, F - 1, 'i');
  m.set(32, F - 1, 'b');
  m.seeds(28, 39, F - 2, 2);
  // --- a wider wade, with a stone standing in it: through the water, or stone to stone and dry
  wade(m, 41, 48, F);
  stone(m, 44, F);
  m.seeds(42, 47, F - 2, 2);
  // --- up onto the long bar, and the brambles along the top of it
  m.ground(53, 72, F - 1);
  m.set(55, F - 2, 'C');
  m.set(58, F - 2, 'i');
  m.row(62, 63, F - 2, '^');
  m.seeds(61, 65, F - 4);
  m.seeds(67, 70, F - 2);
  // --- the deep channel: six tiles of it, with a ring over the middle, and the firefly hanging three
  // rows under the ring — which is exactly where a shot from the lip leaves you when you step off it.
  //
  // WHERE A FIREFLY CAN GO. A sprout collects whatever its pickup box (20 x 22 px) passes, not just
  // what it can stand on, and the small one's jump is 4.1 tiles. So nothing within about four and a
  // half rows of ground that a sprout can stand on is gated by anything: to need a plant, a stump, a
  // spring or a vine, a firefly has to be five rows up or out over the water.
  m.set(71, F - 2, 'i');
  m.pit(73, 78, F - 1);
  m.set(75, F - 3, 'o');
  m.set(75, F, 'F');
  m.seeds(74, 77, F - 5);
  // the far side is two rows below the lip you left, so the swing arrives falling
  m.fill(79, F, 96, F, ' ');
  m.set(82, F, 'i');
  m.set(85, F, 'C');
  m.seeds(84, 88, F - 1, 2);
  m.set(90, F, 't');
  // --- out of the water again, and the willow leaning over the creek. Its branch is four rows up:
  // over a jump, inside every sprout's shot, and the seeds it serves are picked up at the top of the
  // climb. The shelf past it is five rows up, which is nobody's jump at all.
  m.ground(97, 150, F - 1);
  m.set(103, F - 2, 'i');
  m.set(107, F - 5, 'o');
  m.seeds(106, 108, F - 6);
  m.set(110, F - 2, 'i');
  shelf(m, 112, 118, F - 6);
  m.seeds(113, 117, F - 8, 2);
  // (a trap rather than a beetle: a beetle's four-tile walk either side would reach the shelf the
  // bounce is played from on one side or the lantern on the other, and a rooted thing reaches neither)
  m.set(120, F - 2, 't');
  m.seeds(123, 127, F - 3, 2);
  m.set(126, F - 2, 'C');
  // --- the kingcups: a flower bounces you to the top of the bank
  m.set(128, F - 2, 'i');
  m.set(131, F - 2, 'S');
  shelf(m, 128, 134, F - 7);
  m.seeds(129, 133, F - 10, 2);
  // --- a nipper beside the patch of soil, and the bar runs out
  m.set(133, F - 2, 'i');
  m.set(136, F - 2, 'n');
  m.set(138, F - 1, ',');
  m.seeds(137, 139, F - 6);
  // ===== act two: back down into the braided middle
  m.set(152, F - 1, 'i');
  wade(m, 156, 170, F);
  stone(m, 158, F);
  stone(m, 168, F);
  // fifteen tiles of wade and a five-tile loop: there is a safe end of it either side of the
  // dragonfly, which is what a thing on a beat needs if its beat is to be any use to you
  m.set(163, F, 'd');
  m.seeds(157, 169, F - 1, 3);
  m.set(174, F - 1, 'C');
  m.set(182, F - 1, 'b');
  m.seeds(172, 186, F - 2, 3);
  // --- a gap of four tiles, which is a jump, with a chub breaking the surface in it
  m.set(187, F - 1, 'i');
  m.pit(189, 192, F);
  m.set(190, F + 2, 'f');
  m.set(199, F - 1, 't');
  m.set(207, F - 1, 'n');
  m.seeds(195, 212, F - 2, 3);
  // --- up two rows, past the brambles, to the kingcups and the second firefly
  m.ground(215, 250, F - 2);
  m.row(220, 221, F - 3, '^');
  m.seeds(219, 222, F - 5);
  m.set(238, F - 3, 'S');
  shelf(m, 235, 242, F - 8);
  m.set(238, F - 9, 'F');
  m.seeds(236, 241, F - 11, 2);
  m.set(246, F - 3, 'C');
  // ===== act three: the mat, the second channel, and the clearing above it
  m.ground(251, 350, F - 1);
  m.set(254, F - 2, 'i');
  mat(m, 258, 265, F - 1);
  m.seeds(259, 264, F - 3, 2);
  m.set(266, F - 2, 'n');
  m.seeds(268, 274, F - 3, 2);
  m.pit(278, 283, F - 1);
  m.set(280, F - 3, 'o');
  m.seeds(279, 282, F - 5);
  m.fill(284, F - 1, 300, F, ' ');
  m.set(292, F, 't');
  m.seeds(286, 298, F - 1, 3);
  m.set(305, F - 2, 'C');
  m.set(310, F - 1, ',');
  m.seeds(309, 311, F - 6);
  m.set(320, F - 4, 'd');
  m.set(325, F - 2, 'b');
  m.seeds(315, 332, F - 3, 3);
  shelf(m, 340, 346, F - 6);
  m.set(343, F - 7, 'F');
  m.seeds(341, 345, F - 8, 2);
  // ===== act four: the long run home
  m.ground(351, 439, F);
  wade(m, 358, 372, F);
  stone(m, 360, F);
  stone(m, 370, F);
  m.set(365, F, 'd');
  m.seeds(359, 371, F - 1, 3);
  m.set(378, F - 1, 'C');
  m.set(382, F - 1, 'n');
  m.row(390, 391, F - 1, '^');
  m.seeds(388, 393, F - 3);
  m.set(398, F - 1, 'b');
  m.seeds(396, 410, F - 2, 3);
  m.set(415, F - 1, 'i');
  m.set(428, F - 1, 'N');
  return {
    id: 'shallows',
    name: 'The Shallows',
    subtitle: 'midday · in the creek for once',
    theme: 'shallows',
    song: 'shallows',
    map: m.build(),
    signs: [
      'The creek goes wide and shallow here. Keep on upstream — the jay went this way.',
      'Shin-deep, this one. Walk straight through it, and {jump} to hop out the far side.',
      'A beetle on the gravel. It only ever paces its own patch — go round it, or hop over.',
      'Brambles. They can’t really hurt you: whoever gets caught drifts back to your partner as a seed.',
      'This channel is deep. Tie up and leap over the ring to swing across — or {shoot} your vine over the ring and let yourself down to the firefly under it.',
      'Careful: a snaptrap. One of you keep its attention while the other walks past.',
      'A willow branch, well over a jump. Point at it and {shoot} to throw your vine over it, then {climb} up.',
      'That shelf is too high for either of you alone. Stand still and let your partner hop off your head — then hold on while they climb up.',
      'Kingcups! They bounce.',
      'A nipper — one of Old Snip’s young. It rears up before it darts, every time: wait for it to crawl back and walk past behind it.',
      'A dragonfly goes round and round over this one. Watch it once from the end of the wade and you will know when to walk.',
      'Something leaps out of the gap. Wait at the edge until it goes back under, then jump.',
      'Another mat of old reeds. Over it quickly: whoever drops, the other catches.',
      'The rapids are somewhere up ahead. Not far now ♥',
    ],
  };
}

// ------------------------------------------------------------------ 7 · lily pond (World 1 · 4)

/**
 * Where the creek slows and spreads into a still green pond. Nothing here is wadeable: the pond is
 * deep, and the way over it is the pads drifting across — which are the mill's ferry under another
 * coat of paint (drawMover paints a mover as a floating leaf in any garden-coloured theme, which is
 * why the cascades' sign already calls theirs a lily pad).
 *
 * The pads are what makes this a pair's level rather than a platformer's: a pad is three tiles wide
 * and the vine is eight, so one of you can step off onto the stone while the other rides on — but
 * the second crossing's two pads pass each other, so whoever goes first waits.
 */
function lilypond(): LevelDef {
  const m = new Map(448, 20);
  const F = 16;
  m.ground(0, 447, F);
  // the near shore
  m.set(3, F - 1, '1').set(5, F - 1, '2');
  m.set(9, F - 1, 'i');
  m.seeds(11, 17, F - 2, 2);
  // --- the first pad: sixteen tiles of open water, and one leaf going over it
  m.set(18, F - 1, 'i');
  m.pit(20, 35, F);
  m.seeds(22, 33, F - 3, 3);
  // a chub under the water halfway over. It breaks the surface right at the deck a sprout stands on,
  // so a tap of a hop clears it — which is all you can do on a pad that moves on while you are off
  // it — and the rest of its round it is nothing at all. The ride is a beat to read, not a walk.
  m.set(26, F + 3, 'f');
  // --- the island, with a patch of soil on it: the grown leaf is the step up to the firefly
  m.set(39, F - 1, 'C');
  m.set(42, F - 1, 'i');
  m.set(45, F, ',');
  m.seeds(44, 46, F - 6);
  // --- two pads this time, passing each other, with a stone in the middle to wait on
  m.set(48, F - 1, 'i');
  m.pit(51, 76, F);
  m.ground(62, 65, F - 1);
  m.seeds(53, 59, F - 3, 3);
  m.seeds(67, 74, F - 3, 3);
  // --- the far shore, a snaptrap on it, and a bay with a firefly out over the water
  m.set(80, F - 1, 'C');
  m.set(84, F - 1, 't');
  m.seeds(87, 94, F - 2, 2);
  m.set(90, F - 1, 'i');
  m.pit(97, 104, F);
  m.set(99, F - 2, 'o');
  m.set(99, F + 1, 'F');
  m.seeds(98, 103, F - 5, 2);
  // --- out of the pond: a stump four rows high. The small sprout clings to its face and climbs it
  // like ivy; the tall one hops off their head, or holds on while they climb. The shelf off its top
  // carries on over the reeds.
  m.set(106, F - 4, 'd');
  m.set(107, F - 1, 'i');
  m.ground(110, 147, F - 2);
  m.seeds(111, 115, F - 4);
  m.fill(116, F - 7, 117, F - 3, 'X');
  m.row(118, 126, F - 7, '=');
  m.seeds(119, 125, F - 9, 2);
  // ===== act two: the long reach, and three pads over it in turn
  m.set(130, F - 3, 'C');
  m.set(134, F - 3, 'n');
  m.seeds(132, 140, F - 4, 3);
  m.set(144, F - 3, 'i');
  // down two rows to the water's own level, and out over it
  m.fill(148, F - 3, 170, F - 1, ' ');
  m.pit(150, 168, F);
  m.set(159, F + 3, 'f');
  m.seeds(152, 166, F - 3, 3);
  // the island in the middle of the reach, with a stump on it for the one that climbs
  m.fill(171, F - 3, 200, F - 1, ' ');
  m.set(174, F - 1, 'C');
  m.set(178, F - 1, 'i');
  m.fill(183, F - 5, 184, F - 1, 'X');
  shelf(m, 185, 193, F - 5);
  m.set(189, F - 6, 'F');
  m.seeds(186, 192, F - 7, 2);
  m.set(197, F - 1, 'b');
  // --- a bay of still water, with a branch over it
  m.pit(202, 218, F);
  // (a branch over the middle of it: seventeen tiles is a long way to trust two pads for, and a ring
  // is the other way across. No firefly under this one — three to a level, one to an act)
  m.set(210, F - 2, 'o');
  m.seeds(204, 216, F - 4, 3);
  // ===== act three: the reed beds along the far shore
  m.fill(219, F - 3, 300, F - 1, ' ');
  m.set(222, F - 1, 'i');
  m.set(226, F - 1, 't');
  m.set(234, F - 2, 'd');
  m.seeds(228, 246, F - 2, 3);
  m.set(240, F - 1, 'C');
  m.pit(250, 253, F);
  m.set(251, F + 2, 'f');
  m.set(258, F - 1, 'n');
  m.seeds(256, 268, F - 2, 3);
  mat(m, 272, 279, F);
  m.seeds(273, 278, F - 2, 2);
  m.set(270, F - 1, 'i');
  m.set(286, F - 1, 'b');
  m.set(294, F - 1, 'C');
  m.seeds(284, 298, F - 2, 3);
  // ===== act four: up out of the pond for the last time, and home
  m.ground(301, 447, F - 2);
  m.set(306, F - 3, ',');
  m.seeds(305, 307, F - 8);
  m.set(314, F - 3, 'n');
  m.seeds(310, 326, F - 4, 3);
  m.set(322, F - 4, 'd');
  m.set(330, F - 3, 'C');
  m.fill(336, F - 7, 337, F - 3, 'X');
  shelf(m, 338, 346, F - 7);
  m.set(342, F - 8, 'F');
  m.seeds(339, 345, F - 9, 2);
  m.set(352, F - 3, 't');
  m.pit(360, 365, F - 2);
  m.set(362, F - 4, 'o');
  m.seeds(361, 364, F - 6);
  m.fill(366, F - 2, 386, F - 1, ' ');
  m.set(370, F - 1, 'i');
  m.set(376, F - 1, 'b');
  m.seeds(368, 384, F - 2, 3);
  m.set(390, F - 3, 'C');
  m.set(398, F - 3, 'n');
  m.seeds(394, 412, F - 4, 3);
  m.set(416, F - 3, 'i');
  m.set(430, F - 3, 'N');
  return {
    id: 'lilypond',
    name: 'Lily Pond',
    subtitle: 'green noon · pads adrift',
    theme: 'pond',
    song: 'pond',
    map: m.build(),
    movers: [
      { x: 20, y: F, w: 3, path: [[13, 0]], period: 9, dwell: 1.1 },
      { x: 51, y: F, w: 3, path: [[8, 0]], period: 7, dwell: 1 },
      { x: 66, y: F, w: 3, path: [[8, 0]], period: 7, phase: 0.5, dwell: 1 },
      { x: 97, y: F, w: 3, path: [[5, 0]], period: 6, dwell: 0.9 },
      { x: 150, y: F, w: 3, path: [[16, 0]], period: 10, dwell: 1.1 },
      { x: 202, y: F, w: 3, path: [[7, 0]], period: 7, dwell: 1 },
      { x: 211, y: F, w: 3, path: [[5, 0]], period: 6, phase: 0.5, dwell: 1 },
      { x: 360, y: F - 2, w: 3, path: [[3, 0]], period: 6, dwell: 1 },
    ],
    signs: [
      'The creek goes quiet and green along here. Look — lily pads.',
      'Hop on a pad together and it drifts across with the both of you. Something down there leaps — {jump} over it, or wait for it to go back under.',
      'Soil, on the island. Small sprout — stand on it and {shoot} your vine into the ground.',
      'Two pads, passing each other, and a stone to wait on. One of you over, then the other.',
      'One more pad over the bay — and a dead branch over the water. {shoot} your vine over the branch, then step off the edge: the firefly is right where you hang.',
      'A dragonfly on its round, and a stump the small sprout climbs like ivy. Too heavy for that? Hop off their head, or hold on while they climb.',
      'The reach opens out. One long pad over this one — and something under the water that leaps.',
      'Another stump, and a shelf off the top of it. The firefly up there is for whoever gets up first.',
      'Reed beds all along this shore. Mind the snaptrap, and the dragonfly on its round.',
      'One more mat of reeds. Quickly, now.',
      'Down at the water’s edge again. Beetles along here, and the last of the pond ahead.',
      'Up out of the pond for the last time. The rapids are round the next bend ♥',
    ],
  };
}

// ------------------------------------------------------------------ 8 · reed run (World 1 · 5)

/**
 * The last stop before the rapids: the creek narrows into a reed bed and the way on is upward, in
 * three steps — a mat of old reeds that goes as you cross it, a shaft between two stalks, and the
 * spray off a chute.
 *
 * The shaft is the first place in the game where the wall kick is the way through rather than a
 * station on the practice ground: seven rows of two stalks three tiles apart, capped by a plank you
 * pass up through. There is a lantern on the ground right in front of it, so trying it costs
 * nothing, and it has two other answers — the small sprout can cling and climb a stalk, and whoever
 * gets up first can drop the vine for the other.
 */
function reedrun(): LevelDef {
  const m = new Map(456, 22);
  const F = 18;
  m.ground(0, 455, F);
  // the near bank
  m.set(3, F - 1, '1').set(5, F - 1, '2');
  m.set(9, F - 1, 'i');
  m.seeds(11, 15, F - 2);
  // --- the old reed mat over the water: eight tiles of it, and it goes as you cross
  m.set(16, F - 1, 'i');
  m.pit(18, 25, F);
  m.row(18, 25, F, '%');
  m.seeds(19, 24, F - 2, 2);
  // and a chub under the mat, breaking the surface through the hole it leaves behind you
  m.set(22, F + 3, 'f');
  // --- the bank between, with a beetle on it and the lantern right at the foot of the shaft
  m.set(34, F - 1, 'b');
  m.seeds(28, 32, F - 2, 2);
  m.set(42, F - 1, 'C');
  m.set(44, F - 1, 'i');
  // --- the shaft: two stalks, three tiles apart, seven rows of them, with a plank over the top
  // (the left stalk stops three rows up so the pair can walk in under it — a shaft closed at the
  // bottom is a shaft nobody can get into, which is how the practice ground's is built too. And the
  // climb is seven rows, not eight: the vine is eight, so a pair who climb it one at a time would
  // have had the first one stopped by the rope exactly at the plank.)
  m.fill(45, F - 6, 45, F - 3, 'X');
  m.fill(49, F - 6, 49, F - 1, 'X');
  m.seeds(46, 48, F - 3, 2);
  m.row(46, 58, F - 7, '=');
  m.set(53, F - 8, 'F');
  m.seeds(55, 58, F - 9, 2);
  // --- the middle terrace. It runs on past the chute, so a miss up there drops you back onto it
  // rather than into the creek, and the way up is the one thing it is.
  m.ground(59, 99, F - 4);
  m.set(62, F - 5, 'C');
  m.set(65, F - 5, 'i');
  m.set(70, F - 5, 't');
  m.set(77, F - 4, ',');
  m.seeds(73, 82, F - 9, 3);
  m.set(79, F - 5, 'i');
  m.set(82, F - 5, 'n');
  // --- the chute: the spray off it carries you both to the top of the reeds
  m.set(85, F - 5, 'i');
  m.set(88, F - 4, 'U');
  m.row(89, 98, F - 13, '=');
  m.seeds(93, 98, F - 15, 2);
  // --- the top of the reeds, and the long run along it
  m.ground(100, 175, F - 12);
  m.set(103, F - 13, 'C');
  m.set(107, F - 13, 'i');
  mat(m, 110, 117, F - 12);
  m.seeds(111, 116, F - 14, 2);
  m.set(122, F - 13, 'b');
  m.set(130, F - 13, 't');
  m.seeds(118, 128, F - 14, 3);
  // ===== act two: along the top, down the shoulder, and a shaft back up
  m.set(136, F - 13, 'i');
  m.set(140, F - 13, 'n');
  m.seeds(142, 152, F - 13, 3);
  mat(m, 156, 163, F - 12);
  m.seeds(157, 162, F - 14, 2);
  // (no lantern between the mat and the shoulder: a dragonfly's loop is five tiles across and would
  // have reached one anywhere there was room for it. The next one is just down the shoulder.)
  m.set(168, F - 14, 'd');
  // the shoulder: six rows down to the pool under it
  m.ground(176, 229, F - 6);
  m.set(180, F - 7, 'C');
  m.set(184, F - 7, 'i');
  m.set(188, F - 7, 't');
  m.set(196, F - 8, 'd');
  m.seeds(182, 200, F - 7, 3);
  m.set(204, F - 7, 'n');
  mat(m, 208, 215, F - 6);
  m.seeds(209, 214, F - 8, 2);
  m.set(219, F - 7, 'b');
  // --- a second shaft, seven rows of it, with the plank over the top and the firefly above that
  m.set(224, F - 7, 'i');
  m.fill(226, F - 12, 226, F - 9, 'X');
  m.fill(230, F - 12, 230, F - 7, 'X');
  m.seeds(227, 229, F - 9, 2);
  m.row(227, 240, F - 13, '=');
  m.set(234, F - 14, 'F');
  m.seeds(236, 240, F - 15, 2);
  // ===== act three: the reed tops again, and a swing down off them
  m.ground(241, 350, F - 12);
  m.set(246, F - 13, 'C');
  m.set(252, F - 13, 'n');
  m.seeds(248, 264, F - 13, 3);
  m.set(266, F - 13, 'i');
  mat(m, 270, 277, F - 12);
  m.seeds(271, 276, F - 14, 2);
  m.set(284, F - 14, 'd');
  m.set(292, F - 13, 't');
  m.seeds(280, 300, F - 14, 3);
  m.pit(304, 309, F - 12);
  m.set(306, F - 14, 'o');
  m.seeds(305, 308, F - 16);
  m.fill(310, F - 12, 330, F - 11, ' ');
  m.set(314, F - 11, 'C');
  m.set(322, F - 11, 'b');
  m.seeds(312, 328, F - 12, 3);
  m.set(336, F - 13, 'n');
  m.seeds(332, 348, F - 13, 3);
  // ===== act four: down to the last pool, and the pot in sight of the rapids
  m.ground(351, 455, F - 6);
  m.set(356, F - 7, 'i');
  m.set(360, F - 7, 't');
  m.set(368, F - 8, 'd');
  m.seeds(362, 380, F - 7, 3);
  m.set(386, F - 7, 'C');
  mat(m, 392, 399, F - 6);
  m.seeds(393, 398, F - 8, 2);
  m.set(406, F - 7, 'n');
  m.set(412, F - 7, 'b');
  m.seeds(404, 414, F - 8, 3);
  m.set(416, F - 7, 'i');
  shelf(m, 418, 424, F - 11);
  m.set(421, F - 12, 'F');
  m.seeds(419, 423, F - 13, 2);
  m.set(428, F - 7, 'i');
  m.set(438, F - 7, 'N');
  return {
    id: 'reedrun',
    name: 'Reed Run',
    subtitle: 'afternoon · up through the reeds',
    theme: 'reeds',
    song: 'reeds',
    map: m.build(),
    signs: [
      'Hear that? The rapids, up ahead somewhere. The reeds are thick along here.',
      'This old mat of reeds won’t hold you. Over it quickly — and something in the water under it leaps.',
      'Two stalks, close together. Brush one in mid-air and {jump} straight away to kick off it, then kick off the other: take them in turns and you climb. The same stalk twice running won’t have you.',
      'A snaptrap in the reeds. It rears up before it bites, and that is your moment.',
      'A nipper. It rears, darts, waits, then crawls back — the same every time. Go past behind it.',
      'The spray off the chute lifts you both. Tie up and ride it together.',
      'Another mat. Keep moving!',
      'The reeds go on and on up here. A nipper on the path, and a dragonfly over it.',
      'Down the shoulder to the pool under it. Reeds, a trap, and another mat.',
      'Two more stalks. Same as before: brush one, {jump} at once, then take the other — and the firefly is over the top.',
      'Back up on the reed tops. One more mat, and then a ring to swing down off the end of them.',
      'The last pool. Mind the trap.',
      'That shelf has the last firefly on it. Off your partner’s head, then hold on while they climb.',
      'The rapids are just round the bend. Ready? ♥',
    ],
  };
}

export const LEVELS: LevelDef[] = [garden(), woods(), mill(), paris(), tower(), shallows(), lilypond(), reedrun()];

// ------------------------------------------------------------------ the practice ground (solo)

/**
 * A place to learn the moves, on your own. Every station stands on one long flat floor and is
 * optional: you can walk past any of them, come back to any of them, and nothing can be failed or
 * lost. The dips are two tiles deep rather than pits, so falling in is a hop back out; the only
 * thing that hurts is the patch of thorns at the end, which is there to show you that it doesn't.
 *
 * It isn't in LEVELS on purpose: it has no place in the level select, it unlocks nothing, and it
 * keeps no run (see SessionOpts.practice), so nothing a player does here touches their save.
 */
function practice(): LevelDef {
  const m = new Map(232, 20);
  const F = 15;
  m.ground(0, 231, F);
  // --- walking and jumping
  m.set(3, F - 1, '1').set(5, F - 1, '2');
  m.set(8, F - 1, 'i');
  m.set(11, F - 1, 'i');
  m.fill(13, F - 2, 15, F - 1, '#');
  m.fill(17, F - 4, 19, F - 1, '#');
  m.seeds(13, 19, F - 5, 3);
  // --- a dip to hop in and out of, and to glide into
  m.set(21, F - 1, 'i');
  m.fill(23, F, 28, F + 1, ' ');
  // --- the glide: steps up to a high shelf, then a long drop
  m.set(30, F - 1, 'i');
  m.fill(31, F - 3, 32, F - 1, '#');
  m.fill(33, F - 5, 34, F - 1, '#');
  m.fill(35, F - 7, 39, F - 1, '#');
  m.seeds(36, 38, F - 8);
  // --- the wall-kick shaft: two walls three tiles apart, a way in at the bottom left
  m.set(44, F - 1, 'i');
  m.fill(46, F - 11, 46, F - 3, '#');
  m.fill(50, F - 11, 50, F - 1, '#');
  m.row(51, 54, F - 12, '#');
  m.set(52, F - 13, 'F');
  // --- a wall to cling to and climb (the small sprout), with planks for the tall one
  m.set(56, F - 1, 'i');
  m.fill(58, F - 9, 58, F - 1, '#');
  m.row(60, 61, F - 3, '=');
  m.row(62, 63, F - 5, '=');
  m.fill(64, F - 6, 66, F - 6, '#');
  m.seeds(64, 66, F - 7);
  // --- a ring to swing from, over a dip
  m.set(70, F - 1, 'i');
  m.fill(72, F, 79, F + 1, ' ');
  m.set(75, F - 6, 'o');
  m.seeds(73, 78, F - 3, 2);
  // --- a ring too high to reach: shoot the vine at it
  m.set(84, F - 1, 'i');
  m.set(90, F - 8, 'o');
  m.fill(92, F - 5, 95, F - 1, '#');
  m.seeds(88, 92, F - 6, 2);
  // --- a shelf only a head-bounce reaches
  m.set(98, F - 1, 'i');
  m.set(100, F - 1, 'C');
  m.row(103, 107, F - 6, '#');
  m.set(105, F - 7, 'F');
  // --- the tug: a gap, and a shelf on the far side
  m.set(112, F - 1, 'i');
  m.fill(114, F, 119, F + 1, ' ');
  m.fill(120, F - 4, 123, F - 1, '#');
  m.seeds(120, 123, F - 5);
  // --- a flower that bounces you
  m.set(126, F - 1, 'i');
  m.set(130, F - 1, 'S');
  m.row(128, 132, F - 7, '=');
  m.seeds(128, 132, F - 8, 2);
  // --- an updraft to ride
  m.set(136, F - 1, 'i');
  m.set(141, F, 'U');
  m.fill(143, F - 9, 146, F - 9, '#');
  m.set(144, F - 10, 'F');
  // --- a pad and a gate, with a pad on either side so neither of you can be shut out
  m.set(148, F - 1, 'i');
  m.set(151, F - 1, 'p');
  m.fill(156, F - 3, 156, F - 1, 'P');
  m.set(159, F - 1, 'p');
  m.fill(160, F - 4, 162, F - 1, '#');
  m.seeds(160, 162, F - 5);
  // --- blocks that crumble underfoot
  m.set(163, F - 1, 'i');
  m.fill(165, F - 5, 166, F - 1, '#');
  m.row(167, 172, F - 5, '%');
  m.fill(173, F - 5, 174, F - 1, '#');
  m.seeds(167, 172, F - 6, 2);
  // --- a ferry across a dip
  m.set(177, F - 1, 'i');
  m.fill(179, F, 186, F + 1, ' ');
  // --- a patch of soil to grow something out of
  m.set(190, F - 1, 'i');
  m.set(193, F, ',');
  m.seeds(192, 194, F - 6);
  // --- a beetle, with nothing at stake: learn its pace and that it only ever paces
  m.set(197, F - 1, 'i');
  m.set(202, F - 1, 'b');
  // --- a snaptrap, to learn how long the rear-up gives you before the bite
  m.set(208, F - 1, 'i');
  m.set(213, F - 1, 't');
  // --- thorns, to show that they only send you back to your partner
  m.set(218, F - 1, 'i');
  m.set(220, F - 1, 'C');
  m.row(223, 225, F - 1, '^');
  m.set(228, F - 1, 'N');
  return {
    id: 'practice',
    name: 'The Practice Ground',
    subtitle: 'on your own · take your time',
    theme: 'garden',
    song: 'garden',
    map: m.build(),
    doorHold: 3,
    movers: [{ x: 179, y: F - 3, w: 3, path: [[5, 0]], period: 6 }],
    signs: [
      'The practice ground. Nothing here is a race and nothing can be lost — try a thing, then try it again. {move} to walk, {jump} to jump. Stand beside your partner and {shoot} to tie your vines together; {shoot} again unties them.',
      'Steps. A jump carries you about three tiles up — the small sprout a little higher.',
      'A dip. Hop in, hop out. Or hold {jump} as you fall and a leaf opens to float you down.',
      'Up the steps, then off the edge — hold {jump} the whole way down for the long glide.',
      'A shaft. Touch a wall in mid-air and {jump} straight away to kick off it; kick off the far wall next, and take the two in turns to climb. The same wall twice running won’t do.',
      'A wall. The small sprout pushes into it in mid-air to cling on, then {climb} to go up it like ivy. The tall one takes the planks.',
      'A ring. Leap past it and the vine catches on it — push {move} to pump the swing, {jump} to let go.',
      'This one is too high to jump to. Point at it and {shoot} to throw your vine over it, then {climb} to pull yourself up.',
      'Too high again, and no ring. Stand your partner still and hop off their head.',
      '{tug} yanks your partner to you — and if they’re holding on ({anchor}), it yanks you to them instead. Get a feel for it here; crossing on it takes two.',
      'Flowers bounce.',
      'An updraft. Ride it up — it lifts you both.',
      'Stand on a pad to open the gate. There’s a pad on each side, so neither of you can be shut out.',
      'These crumble under your feet. Keep moving.',
      'A ferry. Hop on, ride across.',
      'Soil. The small sprout stands on it and {shoot}s its vine into the ground — something grows for you both to stand on.',
      'A bristle beetle. It paces its own patch and nothing else — it will never come after you. Walk round it, hop over it, or swing past on the vine.',
      'A snaptrap, rooted in the ground. Come near and it rears up: that is your warning, and it is about as long as a breath. It can only bite the once before it has to rest.',
      'Thorns. They can’t really hurt you: you’ll drift back to your partner as a seed. The pot is just past them.',
    ],
  };
}

/** The solo practice ground — deliberately not one of LEVELS (see practice()). */
export const PRACTICE: LevelDef = practice();

// ------------------------------------------------------------------ the test course (two players)

/**
 * The practice ground's stations played by the two of you, with nobody walked for you: the first
 * card on the level select, open from the start, on one screen or online. Every move in the game in
 * a few minutes, and nothing to fail — the quick way to try something out together.
 *
 * Like the practice ground it is not one of LEVELS, and it keeps nothing: no run, no fireflies
 * banked, nothing unlocked (see Session.offRecord). Its level number is COURSE_INDEX, which is also
 * what a host's `load` says to send a guest here (protocol 7) — and since the level after it is
 * COURSE_INDEX + 1, its NEXT LEVEL is the first real one.
 */
export const COURSE_INDEX = -1;
export const COURSE: LevelDef = {
  ...PRACTICE,
  id: 'course',
  name: 'The Test Course',
  subtitle: 'the two of you · every move · nothing to lose',
  signs: [
    'The test course: every move in the game, one station after another, and nothing here can be lost. {move} to walk, {jump} to jump. Stand beside each other and {shoot} to tie your vines together; {shoot} again unties them.',
    ...(PRACTICE.signs ?? []).slice(1),
  ],
};
