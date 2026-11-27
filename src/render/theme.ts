import { rng, TAU } from '../core/math';
import type { ThemeId } from '../game/level';
import { cascadeFar, cascadeNear, fallsFar, fallsNear, gardenFar, gardenNear, millFar, millNear, pondNear, reedsNear, shallowsFar, shallowsNear, woodsFar, woodsNear } from './scenery';

export interface GroundPal {
  /** the moss on top, lit and shaded (also the menus' band of ground) */
  top: string;
  topDark: string;
  /** the earth, and a darker shade of it */
  body: string;
  bodyDark: string;
  /** grit in the earth, light and dark */
  speck: string;
  speck2: string;
  /** the moss cushion's four tones, sunlit to shaded */
  moss: [string, string, string, string];
  /** little flowers in the moss (none: the theme has things of its own on its tops) */
  bloom: string[];
  /** the earth's strata: a lighter band and a darker one */
  strata: [string, string];
  /** pebbles in the earth */
  pebble: [string, string, string];
  /** roots and rootlets */
  root: string;
  /** what the earth darkens toward, the deeper under the surface it is */
  deep: string;
  /** soil with strata and pebbles, or courses of cut stone (the mill's walls) */
  kind: 'soil' | 'blocks';
}

export interface Layer {
  /** horizontal parallax factor (0 = fixed to the screen, 1 = moves with the world) */
  fx: number;
  /** vertical parallax factor */
  fy: number;
  /** strip width as a multiple of the screen height */
  period: number;
  paint(ctx: CanvasRenderingContext2D, W: number, H: number, r: () => number): void;
  /** the same painting a part at a time (a yield between parts), for painting it over several frames */
  steps?(ctx: CanvasRenderingContext2D, W: number, H: number, r: () => number): Generator<void>;
}

export interface Theme {
  id: ThemeId;
  sky: [string, string, string];
  sun: { x: number; y: number; r: number; core: string; glow: string } | null;
  moon: boolean;
  stars: number;
  clouds: { color: string; alpha: number; count: number } | null;
  layers: Layer[];
  ground: GroundPal;
  stone: { face: string; light: string; dark: string; line: string };
  plank: { top: string; side: string; dark: string };
  /** thorns: their lit side, the dark vine and shaded side, and the colour of their points */
  spikes: { a: string; b: string; tip: string };
  ambient: 'petals' | 'leaves' | 'motes' | 'twinkle';
  ambientColor: string[];
  /** string glow strength (brighter at night) */
  glow: number;
  ink: string;
  /** the creek along the bottom of a level — the pits are water (see Session.drawWater); none if absent */
  water?: { top: string; bottom: string; light: string };
}

const hills = (ctx: CanvasRenderingContext2D, W: number, H: number, base: number, amp: number, color: string, seed: number, waves = 3) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  const r = rng(seed);
  const ph = [r() * TAU, r() * TAU, r() * TAU];
  for (let x = 0; x <= W; x += 8) {
    const u = (x / W) * TAU;
    const y = base - amp * (0.55 * Math.sin(u * waves + ph[0]) + 0.3 * Math.sin(u * waves * 2 + ph[1]) + 0.15 * Math.sin(u * waves * 5 + ph[2]));
    ctx.lineTo(x, y * H);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
};

/** Height of hills() at x, so trees can sit on them. */
const hillY = (W: number, x: number, base: number, amp: number, seed: number, waves = 3) => {
  const r = rng(seed);
  const ph = [r() * TAU, r() * TAU, r() * TAU];
  const u = (x / W) * TAU;
  return base - amp * (0.55 * Math.sin(u * waves + ph[0]) + 0.3 * Math.sin(u * waves * 2 + ph[1]) + 0.15 * Math.sin(u * waves * 5 + ph[2]));
};

const roundTree = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, leaf: string, trunk: string) => {
  ctx.fillStyle = trunk;
  ctx.fillRect(x - s * 0.08, y - s * 0.55, s * 0.16, s * 0.55);
  ctx.fillStyle = leaf;
  ctx.beginPath();
  ctx.arc(x, y - s * 0.75, s * 0.42, 0, TAU);
  ctx.arc(x - s * 0.28, y - s * 0.55, s * 0.3, 0, TAU);
  ctx.arc(x + s * 0.3, y - s * 0.58, s * 0.3, 0, TAU);
  ctx.fill();
};

export const THEMES: Record<ThemeId, Theme> = {
  // the title: a yellow-green morning over a mossy creek (the creek, the fall and the banks themselves
  // are render/creek.ts — this is the sky and the woods behind them)
  creek: {
    id: 'creek',
    sky: ['#9fd4c4', '#d3ecbf', '#f4f1c8'],
    sun: { x: 0.2, y: 0.2, r: 0.065, core: '#fffbe2', glow: 'rgba(255,246,190,0.55)' },
    moon: false,
    stars: 0,
    clouds: { color: '#fbfff0', alpha: 0.55, count: 4 },
    layers: [
      {
        fx: 0.04,
        fy: 0.02,
        period: 2.4,
        paint(ctx, W, H) {
          hills(ctx, W, H, 0.5, 0.05, '#d2e6b2', 31, 2);
          hills(ctx, W, H, 0.57, 0.05, '#bfdb9c', 32, 3);
        },
      },
      {
        fx: 0.1,
        fy: 0.05,
        period: 2.2,
        paint(ctx, W, H, r) {
          hills(ctx, W, H, 0.62, 0.04, '#a6cb72', 41, 3);
          for (let i = 0; i < 26; i++) {
            const x = r() * W;
            roundTree(ctx, x, hillY(W, x, 0.62, 0.04, 41, 3) * H + 6, H * (0.12 + r() * 0.08), ['#9cc65c', '#adcf66', '#8dbb52'][Math.floor(r() * 3)], '#6f5d3e');
          }
          hills(ctx, W, H, 0.7, 0.03, '#86b24f', 42, 4);
          for (let i = 0; i < 30; i++) {
            const x = r() * W;
            roundTree(ctx, x, hillY(W, x, 0.7, 0.03, 42, 4) * H + 8, H * (0.14 + r() * 0.1), ['#7aaa45', '#6c9c3e', '#88b84c'][Math.floor(r() * 3)], '#5e4e34');
          }
        },
      },
    ],
    ground: {
      top: '#a8cc4a', topDark: '#7fa83a', body: '#6b5236', bodyDark: '#54402a', speck: '#86a346', speck2: '#4d3a26',
      moss: ['#dbeb84', '#b2d256', '#8db942', '#5f8a2a'], bloom: ['#fffbe6', '#f6e266'], strata: ['#7c6044', '#56402a'],
      pebble: ['#a9a593', '#8d8a7a', '#c4bda6'], root: '#3e2a1a', deep: '#241810', kind: 'soil',
    },
    stone: { face: '#8d9a83', light: '#aab69f', dark: '#6d7a63', line: '#56614e' },
    plank: { top: '#dca36a', side: '#b77c45', dark: '#8c5a2e' },
    spikes: { a: '#3f7d3a', b: '#2b5a28', tip: '#b8503c' },
    ambient: 'motes',
    ambientColor: ['#e8f59a', '#ffffff', '#c8e86a'],
    glow: 0.35,
    ink: '#24331c',
  },
  // 1 · Mossy Creek: a yellow-green morning, the hills streaked with far-off falls
  garden: {
    id: 'garden',
    sky: ['#9fd6c6', '#d2ecc0', '#f6f2cc'],
    sun: { x: 0.78, y: 0.18, r: 0.065, core: '#fffbe2', glow: 'rgba(255,246,190,0.55)' },
    moon: false,
    stars: 0,
    clouds: { color: '#fbfff0', alpha: 0.75, count: 6 },
    layers: [
      // far off: a rocky ridge with three falls coming down it, woods at its foot, haze in the valley
      { fx: 0.12, fy: 0.05, period: 2.4, ...gardenFar },
      // nearer: a meadow, trees with lit crowns, bushes along the front
      { fx: 0.32, fy: 0.12, period: 2.0, ...gardenNear },
    ],
    ground: {
      top: '#a8cc4a', topDark: '#6d9632', body: '#a08756', bodyDark: '#7d6940', speck: '#c8b682', speck2: '#5a4a2a',
      moss: ['#dbeb84', '#b2d256', '#8db942', '#5f8a2a'], bloom: ['#fffbe6', '#f6e266', '#ffb0c4', '#c9adff'], strata: ['#b29b66', '#887346'],
      pebble: ['#b4ae98', '#958f7c', '#cfc6ab'], root: '#57401f', deep: '#2e3418', kind: 'soil',
    },
    stone: { face: '#98a58c', light: '#bcc8ab', dark: '#6e7b66', line: '#56614e' },
    plank: { top: '#dca36a', side: '#b77c45', dark: '#8c5a2e' },
    spikes: { a: '#3f7d3a', b: '#2b5a28', tip: '#b8503c' },
    ambient: 'petals',
    ambientColor: ['#f6ffd8', '#ffffff', '#e6f5a0'],
    glow: 0.35,
    ink: '#24331c',
    water: { top: '#6fa88f', bottom: '#3f7d82', light: '#e4f7ee' },
  },
  // 2 · Fern Falls: golden hour in the pines, a tall fall between them
  woods: {
    id: 'woods',
    sky: ['#ffc98a', '#ffe2a8', '#f1efbf'],
    sun: { x: 0.2, y: 0.42, r: 0.09, core: '#fff3cf', glow: 'rgba(255,200,120,0.6)' },
    moon: false,
    stars: 0,
    clouds: { color: '#fff1dc', alpha: 0.6, count: 4 },
    layers: [
      // far off: rows of pines going pale in the haze, and the tall fall the level is named for
      { fx: 0.1, fy: 0.05, period: 2.2, ...woodsFar },
      // nearer: trunks up past the top of the screen, light slanting between them, ferns. Held still
      // vertically: the old version slid down as the camera climbed and opened a band of sky above a
      // flat-topped wood (found in the 2026-11-21 review)
      { fx: 0.3, fy: 0, period: 1.8, ...woodsNear },
    ],
    ground: {
      top: '#b4c955', topDark: '#7e9a3a', body: '#9a7650', bodyDark: '#7a5a3a', speck: '#c4a077', speck2: '#56402a',
      moss: ['#e0e27c', '#b8c955', '#8fa83e', '#61802c'], bloom: [], strata: ['#aa865c', '#7e5f3e'],
      pebble: ['#a6968a', '#887a6e', '#c4b4a2'], root: '#4e3721', deep: '#32301c', kind: 'soil',
    },
    stone: { face: '#9b6a45', light: '#bb875c', dark: '#72492d', line: '#5a3820' },
    plank: { top: '#c98f5a', side: '#9e6a3a', dark: '#734a25' },
    spikes: { a: '#5a3a5a', b: '#3d2640', tip: '#c9506a' },
    ambient: 'leaves',
    ambientColor: ['#f0953f', '#e86f3a', '#f7c45a'],
    glow: 0.45,
    ink: '#2b1a24',
    water: { top: '#8fae7e', bottom: '#4e7f78', light: '#fff1d8' },
  },
  // 3 · The Old Mill: an afternoon by the millrace, the fall that turns the wheel behind the village
  mill: {
    id: 'mill',
    sky: ['#8fd2e6', '#d0eee4', '#fbf8e6'],
    sun: { x: 0.62, y: 0.16, r: 0.06, core: '#ffffff', glow: 'rgba(255,250,220,0.5)' },
    moon: false,
    stars: 0,
    clouds: { color: '#ffffff', alpha: 0.85, count: 6 },
    layers: [
      // far off: hills in the afternoon haze, the fall that feeds the millrace, woods
      { fx: 0.1, fy: 0.05, period: 2.4, ...millFar },
      // nearer: the old mill and its wheel under the flume, cottages, trees, the race
      { fx: 0.3, fy: 0.12, period: 2.2, ...millNear },
    ],
    ground: {
      top: '#a9d05e', topDark: '#6fab45', body: '#bdb6a8', bodyDark: '#98917f', speck: '#d6d0c4', speck2: '#857d6c',
      moss: ['#d3ea84', '#aad35e', '#84b347', '#5a8a36'], bloom: ['#ffffff', '#ffe27a'], strata: ['#cfc8b9', '#a39b8a'],
      pebble: ['#a8a194', '#8d8678', '#c8c1b2'], root: '#6a5f4f', deep: '#3d3a33', kind: 'blocks',
    },
    stone: { face: '#c98d52', light: '#e3ab72', dark: '#9a6634', line: '#7a4c22' },
    plank: { top: '#cf9c63', side: '#a67340', dark: '#7a5026' },
    spikes: { a: '#7a8090', b: '#4f5462', tip: '#a8aebb' },
    ambient: 'motes',
    ambientColor: ['#ffffff', '#fff6c8'],
    glow: 0.35,
    ink: '#2a2238',
    water: { top: '#6aa6a6', bottom: '#3a7488', light: '#e8f6f6' },
  },
  // 4 · The Cascades: a sunset cliff the water comes down in steps
  cascade: {
    id: 'cascade',
    sky: ['#f3a07c', '#ffd3a0', '#f7efc0'],
    sun: { x: 0.72, y: 0.5, r: 0.1, core: '#fff0c0', glow: 'rgba(255,180,120,0.55)' },
    moon: false,
    stars: 0,
    clouds: { color: '#ffd6c4', alpha: 0.55, count: 5 },
    layers: [
      // far off: mesas in the haze, and the cliff the water comes down in two steps
      { fx: 0.06, fy: 0.03, period: 2.6, ...cascadeFar },
      // nearer: olive-gold hills, trees lit by the low sun
      { fx: 0.24, fy: 0.08, period: 2.0, ...cascadeNear },
    ],
    ground: {
      top: '#c3c759', topDark: '#8a9a3e', body: '#a07d5a', bodyDark: '#7d6045', speck: '#c9aa86', speck2: '#58402d',
      moss: ['#ece582', '#c8c95a', '#9dab44', '#6b7d34'], bloom: ['#fff3dc', '#ffcf73'], strata: ['#b19170', '#83664a'],
      pebble: ['#b9a796', '#9a897c', '#d6c3ac'], root: '#523326', deep: '#36281e', kind: 'soil',
    },
    stone: { face: '#a89a8a', light: '#cbbba8', dark: '#7c6e62', line: '#5d5249' },
    plank: { top: '#d09a62', side: '#a8743f', dark: '#7a5026' },
    spikes: { a: '#4d6b2f', b: '#34501f', tip: '#c0503a' },
    ambient: 'leaves',
    ambientColor: ['#ffb36b', '#ff8f6b', '#ffd58a'],
    glow: 0.55,
    ink: '#3a2230',
    water: { top: '#c79a8a', bottom: '#5a7a86', light: '#fff0e4' },
  },
  // 5 · The Great Falls: a climb by moonlight beside a fall the height of the sky
  falls: {
    id: 'falls',
    sky: ['#0b1330', '#1b2d55', '#2f5068'],
    sun: null,
    moon: true,
    stars: 140,
    clouds: { color: '#5a6a9a', alpha: 0.3, count: 4 },
    layers: [
      // the cliff the height of the sky, the great fall down it (held still: it stays beside the climb)
      { fx: 0.05, fy: 0, period: 2.6, ...fallsFar },
      // pines against the night, silvered on the moon's side
      { fx: 0.2, fy: 0, period: 2.0, ...fallsNear },
    ],
    ground: {
      top: '#6f9f50', topDark: '#466e38', body: '#424a52', bodyDark: '#343b44', speck: '#56606a', speck2: '#2a2f36',
      moss: ['#9cc874', '#73a052', '#547f3e', '#36562c'], bloom: [], strata: ['#4c5560', '#373e48'],
      pebble: ['#5c6474', '#4a5262', '#76808e'], root: '#25292f', deep: '#0e1218', kind: 'soil',
    },
    stone: { face: '#4b5563', light: '#667080', dark: '#353d4a', line: '#2a303a' },
    plank: { top: '#8a6a4a', side: '#6e5236', dark: '#4e3a26' },
    spikes: { a: '#3a5a3a', b: '#263c26', tip: '#9a5a8a' },
    ambient: 'twinkle',
    ambientColor: ['#e8f59a', '#c8f0ff', '#ffffff'],
    glow: 0.85,
    ink: '#14182e',
    water: { top: '#3d6680', bottom: '#162a42', light: '#cfe6f2' },
  },
  // 6 · The Shallows: the same creek at midday, gone wide and bright over pale gravel
  shallows: {
    id: 'shallows',
    sky: ['#8ed2dd', '#cfeccb', '#f8f6da'],
    sun: { x: 0.52, y: 0.1, r: 0.055, core: '#ffffff', glow: 'rgba(255,252,214,0.5)' },
    moon: false,
    stars: 0,
    clouds: { color: '#ffffff', alpha: 0.8, count: 7 },
    layers: [
      // far off: the low shelf with its string of small falls, and the braided flat under it
      { fx: 0.12, fy: 0.05, period: 2.4, ...shallowsFar },
      // nearer: a shingle bank, willows leaning over it, rushes along the front
      { fx: 0.3, fy: 0.12, period: 2.0, ...shallowsNear },
    ],
    ground: {
      top: '#b6d653', topDark: '#86b03c', body: '#bfae84', bodyDark: '#9c8c66', speck: '#ded0ab', speck2: '#6e6248',
      moss: ['#e6f291', '#c2dc62', '#9cc247', '#6c9430'], bloom: ['#fffbe6', '#ffe473', '#ffffff'], strata: ['#cbbb92', '#a3936e'],
      pebble: ['#c9c3ae', '#a8a292', '#e0d8c1'], root: '#6a5330', deep: '#3a3a20', kind: 'soil',
    },
    stone: { face: '#a8b49a', light: '#c9d3b7', dark: '#7e8a74', line: '#5f6a57' },
    plank: { top: '#dca96f', side: '#b6803f', dark: '#8a5a2a' },
    spikes: { a: '#3f7d3a', b: '#2b5a28', tip: '#c2543c' },
    ambient: 'motes',
    ambientColor: ['#f4ffb0', '#ffffff', '#d6f27a'],
    glow: 0.3,
    ink: '#24331c',
    water: { top: '#86cdc0', bottom: '#46949c', light: '#f2ffff' },
  },
  // 7 · Lily Pond: still, green and shaded — Mossy Creek's hills behind a pond of its own
  pond: {
    id: 'pond',
    sky: ['#7fc0bd', '#b8dcaa', '#e4ecb4'],
    sun: { x: 0.3, y: 0.13, r: 0.05, core: '#fdffe6', glow: 'rgba(236,255,196,0.42)' },
    moon: false,
    stars: 0,
    clouds: { color: '#eef8e2', alpha: 0.45, count: 4 },
    layers: [
      // the same valley as the first level, a little further up it
      { fx: 0.1, fy: 0.05, period: 2.4, ...gardenFar },
      // nearer: the pond itself, the wood lying upside down on it, pads, bulrushes
      { fx: 0.28, fy: 0.1, period: 2.0, ...pondNear },
    ],
    ground: {
      top: '#8ec24c', topDark: '#5f8f33', body: '#705a3c', bodyDark: '#54422c', speck: '#8b7550', speck2: '#3e3220',
      moss: ['#cfe877', '#a6ca52', '#7fa73c', '#547f28'], bloom: ['#ffffff', '#ffe9a8', '#e9c2ff'], strata: ['#7d6544', '#5b482e'],
      pebble: ['#8f8f7e', '#767668', '#aaa897'], root: '#3b2a18', deep: '#1f2412', kind: 'soil',
    },
    stone: { face: '#7d6a4e', light: '#9b8663', dark: '#5d4e38', line: '#443829' },
    plank: { top: '#c89a62', side: '#9e7340', dark: '#745026' },
    spikes: { a: '#3a6f36', b: '#28512a', tip: '#b8503c' },
    ambient: 'motes',
    ambientColor: ['#d8f5a8', '#ffffff', '#9ee0c0'],
    glow: 0.4,
    ink: '#1e2d1c',
    water: { top: '#5a9a76', bottom: '#2a5f52', light: '#dcf4d6' },
  },
  // 8 · Reed Run: afternoon in the reed bed, the Shallows' flat behind it
  reeds: {
    id: 'reeds',
    sky: ['#92cdc2', '#d8eab0', '#f8f0c4'],
    sun: { x: 0.74, y: 0.3, r: 0.075, core: '#fff8d2', glow: 'rgba(255,230,150,0.5)' },
    moon: false,
    stars: 0,
    clouds: { color: '#fff8e8', alpha: 0.5, count: 5 },
    layers: [
      // the braided flat again: the rapids are the next stop up from here
      { fx: 0.12, fy: 0.05, period: 2.4, ...shallowsFar },
      // nearer: three depths of reed, the front row's seed-heads in the afternoon sun
      { fx: 0.3, fy: 0.1, period: 1.9, ...reedsNear },
    ],
    ground: {
      top: '#bcd05a', topDark: '#8aa63c', body: '#9b7f52', bodyDark: '#7a6240', speck: '#c3a879', speck2: '#564428',
      moss: ['#e8ea86', '#c3d45e', '#9bb344', '#6d8a2e'], bloom: ['#fffbe0', '#ffd96a'], strata: ['#ab8f62', '#826a46'],
      pebble: ['#b0a493', '#918678', '#ccc0ab'], root: '#4f3a22', deep: '#33301c', kind: 'soil',
    },
    stone: { face: '#9a8a52', light: '#bda96a', dark: '#73683c', line: '#554c2a' },
    plank: { top: '#d2a166', side: '#a87742', dark: '#7c5428' },
    spikes: { a: '#4a7a34', b: '#315524', tip: '#c2543c' },
    ambient: 'leaves',
    ambientColor: ['#e8e07a', '#f2c75a', '#d8e86a'],
    glow: 0.4,
    ink: '#2a2c18',
    water: { top: '#79ac8c', bottom: '#3f7a78', light: '#eefbe8' },
  },
};
