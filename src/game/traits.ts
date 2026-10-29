/**
 * The two sprouts. The tall one is sturdy: heavy on the vine (it holds the small one without budging,
 * drags it along rather than being stopped by it, and its tug flings it far), but it jumps lower and
 * can't fit through a one-tile gap. Both of them can kick off a wall they brush in mid-air, and climb
 * a shaft by taking its two walls in turns. The small one is nimble: it jumps higher, fits through tight
 * spaces, clings to walls like ivy and climbs them, has a burst of speed through the air once per
 * jump, grows plants out of soil, and shoots its vine nearly twice as far. It stands about a head
 * shorter than the tall one. Both run at the same speed and fall the same way
 * (springs, bounces and updrafts lift them alike); the small one's jump just launches harder, for a
 * higher arc that tops out a moment later.
 *
 * Player 1 (whoever made the room, or held the first controller) starts as the tall one; either can
 * swap at the level select. "The same" (Settings) gives both sprouts one body with every ability, for
 * anyone who'd rather not have different powers.
 */
export type Kind = 'tall' | 'small' | 'even';

export interface Traits {
  /** body box, px */
  w: number;
  h: number;
  /** jump launch speed, and gravity (the same for every body: what lifts one lifts the other alike) */
  jumpV: number;
  gravity: number;
  /** weight on the vine: the heavier end drags the lighter one */
  mass: number;
  /** a tug throws the partner this many times as hard */
  tug: number;
  /** walking away from a partner who hangs below: × run speed */
  lift: number;
  /** how far a vine shot reaches, in tiles: the small sprout's goes further */
  shot: number;
  /** heavy enough to hold a millstone slab down (see the W Y Z plates in level.ts) */
  heavy: boolean;
  /** grows a leaf platform out of a patch of soil (the `,` tiles) */
  grow: boolean;
  /** clings to walls, climbs them, jumps off them */
  climb: boolean;
  /** one burst through the air per jump */
  dash: boolean;
  /**
   * How big to draw the seedling body (drawSeedling's scale; the tall sprout has a drawing of its
   * own and ignores it). It lives here beside `h` on purpose: the box and the picture of it were set
   * in two different files, so changing one left the other behind.
   */
  art: number;
}

export const TRAITS: Record<Kind, Traits> = {
  // a jump of ~3.3 tiles (104 px)
  tall: { w: 22, h: 40, jumpV: 630, gravity: 1900, mass: 2, tug: 1.3, lift: 0.85, shot: 4, heavy: true, grow: false, climb: false, dash: false, art: 1 },
  // ~4.1 tiles (131 px), at the top 0.04 s after the tall one. Two thirds of the tall sprout's
  // height — a head shorter, rather than the knee-high thing it was at 16, which read as a pet
  // following you around instead of the other player. Still well under a tile, so every gap it was
  // meant to squeeze through is still a gap it fits; the width is untouched.
  small: { w: 16, h: 26, jumpV: 705, gravity: 1900, mass: 1, tug: 0.55, lift: 0.35, shot: 7, heavy: false, grow: true, climb: true, dash: true, art: 1.6 },
  // the original body (~3.4 tiles), with everything both can do — including the weight for a slab,
  // so "the same" leaves every puzzle solvable by either of them
  even: { w: 18, h: 20, jumpV: 640, gravity: 1900, mass: 1, tug: 1, lift: 0.55, shot: 6, heavy: true, grow: true, climb: true, dash: true, art: 1.2 },
};

/** Which sprout each bird index is: [player 1's, player 2's]. */
export function kindsFor(even: boolean, swapped: boolean): [Kind, Kind] {
  if (even) return ['even', 'even'];
  return swapped ? ['small', 'tall'] : ['tall', 'small'];
}

/** A kind from the wire or storage, or null. */
export const isKind = (k: unknown): k is Kind => k === 'tall' || k === 'small' || k === 'even';
