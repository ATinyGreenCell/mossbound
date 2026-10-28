import { T, VENT_HEIGHT } from './tuning';

export type ThemeId = 'garden' | 'woods' | 'mill' | 'paris' | 'tower';
export type SongId = 'garden' | 'woods' | 'mill' | 'paris' | 'tower' | 'title';

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
  };
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
