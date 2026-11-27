import { TAU } from '../core/math';
import {
  BEETLE_H, BEETLE_REACH, BEETLE_SPEED, BEETLE_TURN, BEETLE_W,
  CHUB_DRIFT, CHUB_H, CHUB_LEAP, CHUB_OUT, CHUB_PERIOD, CHUB_W,
  FLY_H, FLY_LOOP, FLY_PERIOD, FLY_RISE, FLY_W,
  NIP_BACK, NIP_DART, NIP_H, NIP_HOLD, NIP_OUT, NIP_PERIOD, NIP_TELL, NIP_W,
  T, TRAP_H, TRAP_W, VENT_HEIGHT,
} from './tuning';

/** (`creek` is the title's: a mossy creek with a waterfall, see render/creek.ts — no level uses it) */
// (`cascade` and `falls` are the creek-and-waterfall looks the fourth and fifth levels took on in
// 1.9.0. Those levels' ids and songs are still `paris` and `tower`: saves and the network know them so)
export type ThemeId = 'garden' | 'woods' | 'mill' | 'creek' | 'cascade' | 'falls' | 'shallows' | 'pond' | 'reeds';
export type SongId = 'garden' | 'woods' | 'mill' | 'paris' | 'tower' | 'title' | 'shallows' | 'pond' | 'reeds';

export interface MoverDef {
  /** tile column/row of the platform's left end at the path start */
  x: number;
  y: number;
  /** width in tiles */
  w: number;
  /** waypoints in tiles, relative to the start (the start itself is implied) */
  path: [number, number][];
  /** seconds for one full trip (there and back for pingpong) */
  period: number;
  /** 0..1 offset into the cycle */
  phase?: number;
  mode?: 'pingpong' | 'loop';
  /** seconds a pingpong platform waits at each end (default 0.8) — time to hop on and off */
  dwell?: number;
}

/**
 * A level, as authored. Map legend:
 *   #  ground          X  stone / brick / girder      =  plank you can jump up through
 *   ^  spikes          v  ceiling spikes               %  crumbling block
 *   o  peg (the string wraps around it)                S  spring
 *   U  updraft vent (blows up the column above it)
 *   p q r  pressure plates — holding any plate of a letter opens its doors P Q R
 *   W Y Z  heavy plates for those same doors: only the tall sprout's weight holds one down
 *   ,  a patch of soil — the small sprout grows a leaf platform out of it, two rows above
 *   b  a beetle — trundles along whatever ledge you put it on, turning at each end
 *   t  a snaptrap — rooted; rears up when a sprout comes near, then bites
 *   n  a nipper — on a ledge: rears up, darts out along it, waits, crawls back. A beat, not a chase
 *   d  a dragonfly — flies a loop over whatever it is put over (the loop is trimmed clear of walls)
 *   f  a chub — under the water: leaps out of it on a beat, and is nothing at all while it is under
 *   *  seed            F  firefly (3 per level)          C  checkpoint (lantern)
 *   N  the nest (both birds in it = level clear)       1 2  where the birds start
 *   i  a sign — its text is the next entry of `signs`, signs taken left to right
 */
export interface LevelDef {
  id: string;
  name: string;
  subtitle: string;
  theme: ThemeId;
  song: SongId;
  map: string[];
  movers?: MoverDef[];
  signs?: string[];
  /** the level climbs upward: checkpoints/feathers are ordered bottom to top */
  vertical?: boolean;
  /** seconds doors stay open after their plates are let go (default DOOR_HOLD) */
  doorHold?: number;
}

export const enum Tile {
  Empty = 0,
  Ground = 1,
  Stone = 2,
  Plank = 3,
  Spikes = 4,
  CeilSpikes = 5,
  Door = 6,
  Crumble = 7,
  Vent = 8,
  /** a leaf a plant has grown: a plank once its patch of soil has been grown, nothing before */
  Leaf = 9,
}

export interface Pt {
  x: number;
  y: number;
}

export interface Plate {
  tx: number;
  ty: number;
  group: number;
  /** only the tall sprout's weight holds this one down (W Y Z on the map) */
  heavy?: boolean;
}

export interface DoorTile {
  tx: number;
  ty: number;
  group: number;
}

/** A patch of soil and the leaves it grows (see Session.growSoil). */
export interface Soil {
  tx: number;
  ty: number;
  /** tile indices of the leaf platform it sprouts */
  leaves: number[];
}

export interface Vent {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface SignPost {
  x: number;
  y: number;
  text: string;
}

export const enum Creature {
  Beetle = 0,
  Snaptrap = 1,
  Nipper = 2,
  Dragonfly = 3,
  Chub = 4,
}

/** Whether a kind stands on something (so the map must give it footing) or is in the air or water. */
export const standsOnGround = (k: Creature) => k === Creature.Beetle || k === Creature.Snaptrap || k === Creature.Nipper;

/**
 * A creature, as the map placed it. A beetle's whole journey is settled here, at parse time: the
 * ledge it stands on is measured once and never looked at again, so its position is a function of
 * the shared clock and nothing else, and two screens cannot disagree about where it is. A beetle
 * with no ledge to walk (`span` 0) simply stays put.
 */
export interface CreatureSpec {
  kind: Creature;
  /** where it sits: the middle of its body, world px */
  x: number;
  y: number;
  w: number;
  h: number;
  /** beetle: the left end of its walk, and how far it goes (world px) */
  x0: number;
  span: number;
  /** beetle: seconds for one full there-and-back trip, including the pauses at each end */
  period: number;
  /** beetle: where in that trip it starts, 0..1 — from its own position, so two on one ledge
   * don't march in step, and both screens work out the same thing */
  phase: number;
  /** dragonfly: the loop's half-width and half-height · chub: how far it carries and how high it leaps */
  ax: number;
  ay: number;
  /** nipper: which way it darts · chub: which way it arcs (+1 right) */
  dir: number;
}

/** Where a creature is, and how far into whatever it is doing (for the art). */
export interface CreaturePos {
  x: number;
  y: number;
  face: number;
  /** 0..1 through its move — and for a chub, 0 exactly while it is under the water and harmless */
  u: number;
}

export interface MoverPath {
  def: MoverDef;
  /** world px: platform left/top at path start */
  x0: number;
  y0: number;
  w: number;
  /** cumulative waypoint list in world px (including the start) */
  pts: Pt[];
  cum: number[];
  total: number;
}

export interface LevelData {
  def: LevelDef;
  index: number;
  w: number;
  h: number;
  tiles: Uint8Array;
  /** door group per tile (-1 none) */
  doorAt: Int8Array;
  /** crumble index per tile (-1 none) */
  crumbleAt: Int16Array;
  /** patch of soil per tile (-1 none), for the soil itself and for each leaf it grows */
  soilAt: Int16Array;
  leafAt: Int16Array;
  /**
   * Convex corners the string can wrap around, per grid vertex ((w+1)*(h+1)):
   * 0 none, else which of the four tiles around the vertex is the solid one: 1 TL, 2 TR, 3 BL, 4 BR.
   */
  corners: Uint8Array;
  pegs: Pt[];
  seeds: Pt[];
  feathers: Pt[];
  checkpoints: Pt[];
  spawns: [Pt, Pt];
  nest: Pt;
  springs: Pt[];
  vents: Vent[];
  plates: Plate[];
  doors: DoorTile[];
  doorGroups: number;
  crumbles: { tx: number; ty: number }[];
  soils: Soil[];
  signs: SignPost[];
  movers: MoverPath[];
  creatures: CreatureSpec[];
}

const DOOR_LETTERS = 'PQR';
const PLATE_LETTERS = 'pqr';
/** heavy plates: the same door groups, but only the tall sprout is heavy enough to hold one down */
const HEAVY_LETTERS = 'WYZ';

export const isSolidTile = (t: number) => t === Tile.Ground || t === Tile.Stone || t === Tile.Vent;

export function parseLevel(def: LevelDef, index: number): LevelData {
  const h = def.map.length;
  const w = Math.max(...def.map.map((r) => r.length));
  const tiles = new Uint8Array(w * h);
  const doorAt = new Int8Array(w * h).fill(-1);
  const crumbleAt = new Int16Array(w * h).fill(-1);
  const soilAt = new Int16Array(w * h).fill(-1);
  const leafAt = new Int16Array(w * h).fill(-1);
  const pegs: Pt[] = [];
  const seeds: Pt[] = [];
  const feathers: Pt[] = [];
  const checkpoints: Pt[] = [];
  const springs: Pt[] = [];
  const ventTiles: { tx: number; ty: number }[] = [];
  const plates: Plate[] = [];
  const doors: DoorTile[] = [];
  const crumbles: { tx: number; ty: number }[] = [];
  const soilTiles: { tx: number; ty: number }[] = [];
  const signPts: Pt[] = [];
  const creatureTiles: { tx: number; ty: number; kind: Creature }[] = [];
  let spawn1: Pt | null = null;
  let spawn2: Pt | null = null;
  let nest: Pt | null = null;
  let doorGroups = 0;
  const center = (tx: number, ty: number): Pt => ({ x: tx * T + T / 2, y: ty * T + T / 2 });

  for (let ty = 0; ty < h; ty++) {
    const row = def.map[ty];
    for (let tx = 0; tx < w; tx++) {
      const c = row[tx] ?? ' ';
      const i = ty * w + tx;
      switch (c) {
        case '#':
          tiles[i] = Tile.Ground;
          break;
        case 'X':
          tiles[i] = Tile.Stone;
          break;
        case '=':
          tiles[i] = Tile.Plank;
          break;
        case '^':
          tiles[i] = Tile.Spikes;
          break;
        case 'v':
          tiles[i] = Tile.CeilSpikes;
          break;
        case '%':
          tiles[i] = Tile.Crumble;
          crumbleAt[i] = crumbles.length;
          crumbles.push({ tx, ty });
          break;
        case 'U':
          tiles[i] = Tile.Vent;
          ventTiles.push({ tx, ty });
          break;
        case ',':
          // a patch of soil is ground you can stand on; the plant grows above it
          tiles[i] = Tile.Ground;
          soilTiles.push({ tx, ty });
          break;
        case 'o':
          pegs.push(center(tx, ty));
          break;
        case '*':
          seeds.push(center(tx, ty));
          break;
        case 'F':
          feathers.push(center(tx, ty));
          break;
        case 'C':
          checkpoints.push(center(tx, ty));
          break;
        case 'S':
          springs.push(center(tx, ty));
          break;
        case 'N':
          nest = center(tx, ty);
          break;
        case '1':
          spawn1 = center(tx, ty);
          break;
        case '2':
          spawn2 = center(tx, ty);
          break;
        case 'i':
          signPts.push(center(tx, ty));
          break;
        case 'b':
          creatureTiles.push({ tx, ty, kind: Creature.Beetle });
          break;
        case 't':
          creatureTiles.push({ tx, ty, kind: Creature.Snaptrap });
          break;
        case 'n':
          creatureTiles.push({ tx, ty, kind: Creature.Nipper });
          break;
        case 'd':
          creatureTiles.push({ tx, ty, kind: Creature.Dragonfly });
          break;
        case 'f':
          creatureTiles.push({ tx, ty, kind: Creature.Chub });
          break;
        default: {
          const d = DOOR_LETTERS.indexOf(c);
          if (d >= 0) {
            tiles[i] = Tile.Door;
            doorAt[i] = d;
            doors.push({ tx, ty, group: d });
            doorGroups = Math.max(doorGroups, d + 1);
            break;
          }
          const p = PLATE_LETTERS.indexOf(c);
          if (p >= 0) {
            plates.push({ tx, ty, group: p });
            doorGroups = Math.max(doorGroups, p + 1);
            break;
          }
          const hv = HEAVY_LETTERS.indexOf(c);
          if (hv >= 0) {
            plates.push({ tx, ty, group: hv, heavy: true });
            doorGroups = Math.max(doorGroups, hv + 1);
          }
        }
      }
    }
  }

  const solid = (tx: number, ty: number): boolean => {
    if (tx < 0 || tx >= w) return true;
    if (ty < 0) return false;
    if (ty >= h) return isSolidTile(tiles[(h - 1) * w + tx]);
    return isSolidTile(tiles[ty * w + tx]);
  };

  // convex corners (static solids only — doors and crumbles come and go)
  const corners = new Uint8Array((w + 1) * (h + 1));
  for (let gy = 0; gy <= h; gy++) {
    for (let gx = 0; gx <= w; gx++) {
      const tl = solid(gx - 1, gy - 1);
      const tr = solid(gx, gy - 1);
      const bl = solid(gx - 1, gy);
      const br = solid(gx, gy);
      const n = +tl + +tr + +bl + +br;
      if (n !== 1) continue;
      corners[gy * (w + 1) + gx] = tl ? 1 : tr ? 2 : bl ? 3 : 4;
    }
  }

  // Each patch of soil sprouts a leaf platform two rows above it, as wide as there's room for (up to
  // three tiles), and only into open air: a plant grows where a sprout could stand, not through a
  // girder. A patch with nowhere to grow keeps no leaves, so it simply does nothing.
  const soils: Soil[] = soilTiles.map(({ tx, ty }, si) => {
    soilAt[ty * w + tx] = si;
    const leaves: number[] = [];
    const ly = ty - 2;
    if (ly >= 0) {
      for (let lx = tx - 1; lx <= tx + 1; lx++) {
        if (lx < 0 || lx >= w) continue;
        const i = ly * w + lx;
        if (tiles[i] !== Tile.Empty) continue;
        tiles[i] = Tile.Leaf;
        leafAt[i] = si;
        leaves.push(i);
      }
    }
    return { tx, ty, leaves };
  });

  // vents blow up their column until the first solid tile
  const vents: Vent[] = ventTiles.map(({ tx, ty }) => {
    let top = ty;
    for (let k = 1; k <= VENT_HEIGHT; k++) {
      if (ty - k < 0 || solid(tx, ty - k)) break;
      top = ty - k;
    }
    return { x0: tx * T - 3, x1: tx * T + T + 3, top: top * T, bottom: ty * T };
  });

  // Anything a sprout could stand on holds a beetle up too — which includes the planks the whole
  // tower is built from. Measuring against `solid` alone would leave every beetle up there frozen
  // on the spot, looking like a bug in the clock rather than a girder it cannot walk.
  const footing = (tx: number, ty: number) => solid(tx, ty) || (tx >= 0 && tx < w && ty >= 0 && ty < h && tiles[ty * w + tx] === Tile.Plank);
  // Creatures stand on the tile below the one they are drawn on, like a sprout does. A beetle's
  // ledge is measured here, once: out from its own tile while the footing holds and the way is
  // clear, stopping at a wall or a drop. After this nothing about a beetle depends on the level.
  /** Is a box of this size clear of the scenery here? (parse time, static solids only) */
  const freeBox = (px: number, py: number, bw: number, bh: number) => {
    const x0 = Math.floor((px - bw / 2) / T);
    const x1 = Math.floor((px + bw / 2) / T);
    const y0 = Math.floor((py - bh / 2) / T);
    const y1 = Math.floor((py + bh / 2) / T);
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) if (solid(xx, yy)) return false;
    return true;
  };
  /** How far a thing on this tile can travel each way along its ledge, in tiles, up to `reach`. */
  const ledge = (tx: number, ty: number, reach: number) => {
    const floor = ty + 1;
    let left = tx;
    let right = tx;
    while (left - 1 >= 0 && tx - left < reach && footing(left - 1, floor) && !solid(left - 1, ty)) left--;
    while (right + 1 < w && right - tx < reach && footing(right + 1, floor) && !solid(right + 1, ty)) right++;
    return { left, right };
  };
  const creatures: CreatureSpec[] = creatureTiles.map(({ tx, ty, kind }) => {
    const floor = ty + 1;
    const cx = tx * T + T / 2;
    // its own spot's share of the beat, so two of a kind side by side never move in step — and both
    // screens work the same thing out, because it comes from the map and nothing else
    const phase = (((tx * 7 + ty * 13) % 10) / 10 + 0.05) % 1;
    const way = (tx * 5 + ty * 3) % 2 ? -1 : 1;
    const base = { kind, x: cx, y: floor * T - BEETLE_H / 2, w: BEETLE_W, h: BEETLE_H, x0: 0, span: 0, period: 1, phase, ax: 0, ay: 0, dir: 1 };
    if (kind === Creature.Snaptrap) {
      return { ...base, y: floor * T - TRAP_H / 2, w: TRAP_W, h: TRAP_H, phase: 0 };
    }
    if (kind === Creature.Beetle) {
      // out from its own tile while the footing holds and the way is clear, stopping at a wall or a
      // drop. After this nothing about a beetle depends on the level.
      const { left, right } = ledge(tx, ty, BEETLE_REACH);
      const x0 = left * T + BEETLE_W / 2;
      const span = Math.max(0, (right + 1) * T - BEETLE_W / 2 - x0);
      return { ...base, x0, span, period: (2 * span) / BEETLE_SPEED + 2 * BEETLE_TURN };
    }
    if (kind === Creature.Nipper) {
      // measured onto its ledge like a beetle, and it darts whichever way it has more room to
      const { left, right } = ledge(tx, ty, NIP_DART);
      const roomL = (tx - left) * T;
      const roomR = (right - tx) * T;
      const dir = roomR >= roomL ? 1 : -1;
      const span = Math.max(0, Math.min(NIP_DART * T, dir > 0 ? roomR : roomL));
      return { ...base, y: floor * T - NIP_H / 2, w: NIP_W, h: NIP_H, dir, span, x0: Math.min(cx, cx + dir * span), period: NIP_PERIOD };
    }
    if (kind === Creature.Dragonfly) {
      // The loop is shrunk until every point of it is clear of the scenery: a dragonfly can then be
      // dropped anywhere without ever being drawn inside a wall, and one with nowhere to fly hovers.
      const cy = ty * T + T / 2;
      const clear = (rx: number, ry: number) => {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * TAU;
          if (!freeBox(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, FLY_W, FLY_H)) return false;
        }
        return true;
      };
      let ax = FLY_LOOP * T;
      let ay = FLY_RISE * T;
      while (ax > 6 && !clear(ax, ay)) {
        ax *= 0.8;
        ay *= 0.8;
      }
      if (!clear(ax, ay)) ax = ay = 0;
      return { ...base, y: cy, w: FLY_W, h: FLY_H, ax, ay, period: FLY_PERIOD, x0: cx - ax, span: 2 * ax };
    }
    // a chub: it lies under the water where the map put it and leaps out of it, as high as there is
    // room for. Its home is its own tile's middle, which is where it is while it is nothing at all.
    const cy = ty * T + T / 2;
    let ay = CHUB_LEAP * T;
    while (ay > T && !freeBox(cx, cy - ay, CHUB_W, CHUB_H)) ay -= T / 2;
    const ax = freeBox(cx + way * CHUB_DRIFT * T, cy - ay / 2, CHUB_W, CHUB_H) ? CHUB_DRIFT * T : 0;
    return { ...base, y: cy, w: CHUB_W, h: CHUB_H, ax, ay, dir: way, period: CHUB_PERIOD, x0: cx - ax, span: 2 * ax };
  });

  const byProgress = (a: Pt, b: Pt) => (def.vertical ? b.y - a.y : a.x - b.x || a.y - b.y);
  checkpoints.sort(byProgress);
  feathers.sort(byProgress);
  // signs are read in the order you meet them: left to right, or bottom to top on a climb
  signPts.sort(def.vertical ? (a, b) => b.y - a.y || a.x - b.x : (a, b) => a.x - b.x || a.y - b.y);
  const signs = signPts.map((p, k) => ({ x: p.x, y: p.y, text: def.signs?.[k] ?? '' }));

  const movers: MoverPath[] = (def.movers ?? []).map((m) => {
    const x0 = m.x * T;
    const y0 = m.y * T;
    const pts: Pt[] = [{ x: x0, y: y0 }, ...m.path.map(([dx, dy]) => ({ x: x0 + dx * T, y: y0 + dy * T }))];
    if (m.mode === 'loop') pts.push({ x: x0, y: y0 });
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    return { def: m, x0, y0, w: m.w * T, pts, cum, total: cum[cum.length - 1] };
  });

  if (!spawn1 || !spawn2) throw new Error(`level ${def.id}: needs spawns 1 and 2`);
  if (!nest) throw new Error(`level ${def.id}: needs a nest N`);

  return {
    def,
    index,
    w,
    h,
    tiles,
    doorAt,
    crumbleAt,
    soilAt,
    leafAt,
    corners,
    pegs,
    seeds,
    feathers,
    checkpoints,
    spawns: [spawn1, spawn2],
    nest,
    springs,
    vents,
    plates,
    doors,
    doorGroups,
    crumbles,
    soils,
    signs,
    movers,
    creatures,
  };
}

/**
 * Where a beetle's middle is at shared time `t`. There and back along its ledge, with a pause at
 * each end to turn round. Like moverPos this is worked out from the clock alone — never stepped —
 * so it is identical on both screens however differently their frames fall.
 */
export function beetlePos(c: CreatureSpec, t: number, out: { x: number; face: number } = { x: 0, face: 1 }): { x: number; face: number } {
  // (written into `out`, as moverPos does: the world asks this for every beetle on every step)
  out.face = 1;
  if (c.span <= 0) {
    out.x = c.x;
    return out;
  }
  const walk = c.span / BEETLE_SPEED;
  const u = ((((t / c.period + c.phase) % 1) + 1) % 1) * c.period;
  if (u < walk) out.x = c.x0 + BEETLE_SPEED * u;
  else if (u < walk + BEETLE_TURN) out.x = c.x0 + c.span;
  else if (u < 2 * walk + BEETLE_TURN) {
    out.x = c.x0 + c.span - BEETLE_SPEED * (u - walk - BEETLE_TURN);
    out.face = -1;
  } else {
    out.x = c.x0;
    out.face = -1;
  }
  return out;
}

/**
 * Where a creature is at shared time `t`, whatever kind it is — worked out from the clock alone, the
 * same on both screens however differently their frames fall. A snaptrap never moves, so it answers
 * with its own spot; everything about it is its round (see World.stepDynamic).
 */
export function creaturePos(c: CreatureSpec, t: number, out: CreaturePos = { x: 0, y: 0, face: 1, u: 0 }): CreaturePos {
  out.x = c.x;
  out.y = c.y;
  out.face = c.dir || 1;
  out.u = 0;
  const u = ((((t / c.period + c.phase) % 1) + 1) % 1);
  if (c.kind === Creature.Beetle) {
    const b = beetlePos(c, t);
    out.x = b.x;
    out.face = b.face;
    out.u = 1;
    return out;
  }
  if (c.kind === Creature.Nipper) {
    // rear up where you can see it, dart, wait out there, crawl back, rest
    const s = u * c.period;
    const t1 = NIP_TELL;
    const t2 = t1 + NIP_OUT;
    const t3 = t2 + NIP_HOLD;
    const t4 = t3 + NIP_BACK;
    let k = 0;
    if (s < t1) out.u = s / NIP_TELL;
    else if (s < t2) {
      k = (s - t1) / NIP_OUT;
      out.u = 1;
    } else if (s < t3) {
      k = 1;
      out.u = 1;
    } else if (s < t4) {
      k = 1 - (s - t3) / NIP_BACK;
      out.u = 1;
    }
    out.x = c.x + c.dir * c.span * k;
    return out;
  }
  if (c.kind === Creature.Dragonfly) {
    const a = u * TAU;
    out.x = c.x + Math.cos(a) * c.ax;
    out.y = c.y + Math.sin(a) * c.ay;
    out.face = Math.sin(a) > 0 ? -1 : 1;
    out.u = u;
    return out;
  }
  // a chub, out of the water for the first share of its round and under it for the rest
  if (u < CHUB_OUT) {
    const k = u / CHUB_OUT;
    out.x = c.x + c.dir * c.ax * (k - 0.5) * 2;
    out.y = c.y - c.ay * Math.sin(k * Math.PI);
    out.u = k;
  }
  return out;
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Where a moving platform's left/top corner is at shared time `t` (seconds). */
export function moverPos(m: MoverPath, t: number, out: Pt) {
  const d = m.def;
  if (m.total <= 0) {
    out.x = m.x0;
    out.y = m.y0;
    return out;
  }
  let u = (((t / d.period + (d.phase ?? 0)) % 1) + 1) % 1;
  if (d.mode !== 'loop') {
    // there and back, easing in and out, waiting a moment at each end
    const a = Math.min(d.dwell ?? 0.8, d.period * 0.2) / d.period;
    const run = 0.5 - a;
    if (u < a / 2) u = 0;
    else if (u < a / 2 + run) u = smooth((u - a / 2) / run);
    else if (u < 0.5 + a / 2) u = 1;
    else if (u < 1 - a / 2) u = 1 - smooth((u - 0.5 - a / 2) / run);
    else u = 0;
  }
  const s = u * m.total;
  let k = 1;
  while (k < m.cum.length - 1 && m.cum[k] < s) k++;
  const a = m.pts[k - 1];
  const b = m.pts[k];
  const seg = m.cum[k] - m.cum[k - 1] || 1;
  const f = Math.min(1, Math.max(0, (s - m.cum[k - 1]) / seg));
  out.x = a.x + (b.x - a.x) * f;
  out.y = a.y + (b.y - a.y) * f;
  return out;
}
