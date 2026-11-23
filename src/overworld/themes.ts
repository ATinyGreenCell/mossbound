/**
 * Map themes: how a world's stretch of the map looks. A theme is a palette and a decoration set —
 * which things grow there, and how often — plus the time of day across the world (a tint the painted
 * map is multiplied by, start to end, and how dark it is: at night the windows light up and the creek
 * glints). The things themselves are drawn by decor.ts, the same for every theme, in its colours.
 *
 * A world names its theme in WORLDS (`mapTheme`). A name that isn't one of these is looked up as a
 * level theme (render/theme.ts) and a map theme is made from that level's palette, so a new world
 * needs no theme of its own to look right (and a name that's neither gets the meadow).
 */
import type { ThemeId } from '../game/level';
import { THEMES, type Theme } from '../render/theme';

export type DecorKind = 'tree' | 'pine' | 'bush' | 'rock' | 'boulder' | 'fern' | 'flowers' | 'tuft' | 'reeds' | 'mushroom' | 'stump';

export interface MapTheme {
  id: string;
  ink: string;
  /** the meadow: its own colour, darker patches, lighter patches */
  ground: [string, string, string];
  /** specks and grass tufts */
  specks: string[];
  /** the creek's mossy rim */
  bank: string;
  /** deep, shallow, glint */
  water: [string, string, string];
  path: { moss: string; mossDark: string; stone: string; stoneDark: string };
  /** face, light, dark */
  stone: [string, string, string];
  leaf: string[];
  leafDark: string;
  leafLight: string;
  trunk: string;
  pine: string[];
  flowers: string[];
  /** the time of day from the world's start to its end: multiply tints */
  grade: string[];
  /** how dark it is at each of those, 0 (day) to 1 (midnight) */
  night: number[];
  /** what grows here, and how often */
  decor: Partial<Record<DecorKind, number>>;
}

export const MAP_THEMES: Record<string, MapTheme> = {
  // World 1: a sunny yellow-green meadow along the creek, morning to golden hour
  meadow: {
    id: 'meadow',
    ink: '#2b3a1d',
    ground: ['#bad85e', '#a5c851', '#cfe479'],
    specks: ['#98bd47', '#cde27c', '#8db244', '#e3eea0'],
    bank: '#8fb04a',
    water: ['#4b9792', '#70b9a8', '#e2f7e8'],
    path: { moss: '#8dbb3e', mossDark: '#5d8a2a', stone: '#e4dcc0', stoneDark: '#a99f84' },
    stone: ['#aab39a', '#ccd3bc', '#7f886f'],
    leaf: ['#8cc04a', '#7ab245', '#9ccb52'],
    leafDark: '#5a8c2c',
    leafLight: '#c1e070',
    trunk: '#7d5b38',
    pine: ['#5e9a4e', '#6aa656'],
    flowers: ['#fff8de', '#ffd84a', '#ff9dbb', '#cdb0ff'],
    grade: ['#f2fbf6', '#fffbea', '#fff2d2', '#ffdcab'],
    night: [0, 0, 0, 0],
    decor: { tree: 5, bush: 3, fern: 1.5, rock: 2, flowers: 4, tuft: 4, stump: 0.4, mushroom: 0.3, reeds: 2 },
  },
  // World 2: the mill, the hollow tree and the farmyard, from a warm afternoon into a blue-violet midnight
  millnight: {
    id: 'millnight',
    ink: '#262238',
    ground: ['#a4c95c', '#8fb550', '#b8d870'],
    specks: ['#88ae4a', '#bad874', '#7ea246', '#d6e89a'],
    bank: '#7f9f46',
    water: ['#3f7f8c', '#62a3a6', '#e0f4f4'],
    path: { moss: '#86b040', mossDark: '#587f2c', stone: '#e0d8c4', stoneDark: '#a19a88' },
    stone: ['#a5aaa4', '#c6cac2', '#7a7f7a'],
    leaf: ['#72a84a', '#629a44', '#80b452'],
    leafDark: '#4a7a2e',
    leafLight: '#a6d06a',
    trunk: '#6c4c33',
    pine: ['#4f8a52', '#5a9658'],
    flowers: ['#f2eaff', '#ffe08a', '#ffb2c8'],
    grade: ['#fff4dc', '#ffd8b4', '#b4b2de', '#8a94d0', '#7078c0'],
    night: [0, 0.15, 0.5, 0.8, 1],
    decor: { tree: 4, bush: 3, rock: 2, mushroom: 1.6, flowers: 1.5, tuft: 4, stump: 1.2, fern: 1, reeds: 1.5 },
  },
  // World 3: cliffs, cascades and spray under a sunset, a night, a sunrise
  falls: {
    id: 'falls',
    ink: '#2a2630',
    ground: ['#aac466', '#94b05a', '#c0d67e'],
    specks: ['#8ea65a', '#c4d888', '#a89c8c', '#d8e2a8'],
    bank: '#8c9c66',
    water: ['#4a86a2', '#74aec2', '#f0faff'],
    path: { moss: '#8aac48', mossDark: '#5e7e34', stone: '#e6dccc', stoneDark: '#a89a8a' },
    stone: ['#ab9f92', '#cdc2b4', '#7e7268'],
    leaf: ['#7aae54', '#6aa250', '#88ba5c'],
    leafDark: '#4e7a3a',
    leafLight: '#b0d47a',
    trunk: '#6e5040',
    pine: ['#4c8658', '#5a9462', '#437a50'],
    flowers: ['#fff2f0', '#ffd27a', '#ffa8b8'],
    grade: ['#ffcfae', '#e4b6cc', '#9ea8dc', '#cdbcde', '#ffe4b6'],
    night: [0.1, 0.35, 0.8, 0.35, 0],
    decor: { pine: 5, rock: 4, boulder: 2, tree: 1.5, bush: 2, tuft: 3, flowers: 0.6, fern: 1 },
  },
};

// ------------------------------------------------------------------ colour

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const hex2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');

/** a + (b - a)·t, as #rrggbb. */
export function mix(a: string, b: string, t: number) {
  const A = rgb(a);
  const B = rgb(b);
  return `#${hex2(A[0] + (B[0] - A[0]) * t)}${hex2(A[1] + (B[1] - A[1]) * t)}${hex2(A[2] + (B[2] - A[2]) * t)}`;
}

/**
 * A map theme made from a level's palette: the meadow's, leaning toward the level's ground, stone and
 * water, in the level's light (its sky sets the time of day; a moon makes it night). Leaning, not
 * copying: a level's ground is often rooftops or a tower's floor, and a map is still countryside.
 */
function fromLevel(th: Theme): MapTheme {
  const M = MAP_THEMES.meadow;
  const g = th.ground;
  const k = 0.4;
  const lean = (a: string, b: string) => mix(a, b, k);
  const water: [string, string, string] = th.water ? [lean(M.water[0], th.water.bottom), lean(M.water[1], th.water.top), th.water.light] : [mix(M.water[0], th.sky[0], 0.2), mix(M.water[1], th.sky[0], 0.15), M.water[2]];
  return {
    id: `level:${th.id}`,
    ink: th.ink,
    ground: [lean(M.ground[0], g.top), lean(M.ground[1], g.topDark), lean(M.ground[2], g.top)],
    specks: M.specks.map((c, i) => lean(c, i % 2 ? g.topDark : g.speck)),
    bank: lean(M.bank, g.topDark),
    water,
    path: { moss: lean(M.path.moss, g.topDark), mossDark: lean(M.path.mossDark, th.ink), stone: lean(M.path.stone, th.stone.light), stoneDark: lean(M.path.stoneDark, th.stone.dark) },
    stone: [lean(M.stone[0], th.stone.face), lean(M.stone[1], th.stone.light), lean(M.stone[2], th.stone.dark)],
    leaf: M.leaf.map((c) => lean(c, g.top)),
    leafDark: lean(M.leafDark, g.topDark),
    leafLight: lean(M.leafLight, g.top),
    trunk: lean(M.trunk, g.body),
    pine: M.pine.map((c) => lean(c, g.topDark)),
    flowers: th.ambientColor.length ? th.ambientColor : M.flowers,
    grade: th.moon ? [mix(th.sky[2], '#ffffff', 0.62), mix(th.sky[1], '#ffffff', 0.48)] : [mix(th.sky[2], '#ffffff', 0.78), mix(th.sky[0], '#ffffff', 0.68)],
    night: th.moon ? [0.55, 0.85] : [0, 0],
    decor: { tree: 4, bush: 3, rock: 2, flowers: 2, tuft: 3, stump: 0.5, reeds: 1 },
  };
}

const made = new Map<string, MapTheme>();

/** The map theme called `id`: one of MAP_THEMES, else one made from the level theme of that name, else the meadow. */
export function mapTheme(id: string): MapTheme {
  const own = MAP_THEMES[id];
  if (own) return own;
  let t = made.get(id);
  if (!t) {
    const lv = (THEMES as Record<string, Theme>)[id as ThemeId];
    t = lv ? fromLevel(lv) : MAP_THEMES.meadow;
    made.set(id, t);
  }
  return t;
}
