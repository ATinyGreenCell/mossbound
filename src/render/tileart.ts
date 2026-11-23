/**
 * The pieces the tile painters lay down: textures for the earth, the rock and the planks, the moss
 * cushion along every top, and small sprites — the cushion's rounded ends, moss creeping down faces
 * and hanging off overhangs, tufts, flowers, rootlets, pebbles, thorns, vents, crates. All painted once
 * per theme and scale, a few dozen paths each, then shared by every chunk of the level: a chunk is
 * pattern fills and drawImage calls from one atlas, so the rich look costs a chunk less to paint than
 * the old flat one did, and nothing at all per frame.
 *
 * Every texture tiles (whatever crosses an edge is painted again on the other side) and is anchored to
 * the world, so neighbouring tiles and chunks join without a seam.
 */
import { hash2, rng, TAU } from '../core/math';
import { canvasEpoch, settle } from './renderer';
import type { Theme } from './theme';

type G = CanvasRenderingContext2D;

/** The moss cushion along a top: how far it reaches above the tile's top (lumps, blades) and below it (its fringe). */
export const MOSS_UP = 9;
export const MOSS_DOWN = 28;
/**
 * How far below a tile's top the cushion is painted: its lumps' tops then meet the line the sprouts
 * walk on, so their feet stand on the moss rather than in it (only blades of grass rise above).
 */
const SINK = 4;
/** its period along the ground, world px (long, so it doesn't visibly repeat) */
const MOSS_P = 384;
/** A plank's strip: its height (the board and the shade under it) and period (two boards a tile). */
export const PLANK_H = 11;
const PLANK_P = 128;
const SOIL_W = 192;
const SOIL_H = 160;
const ROCK_S = 128;

/** A picture in the atlas: where it is (device px) and where it goes relative to its anchor (world px). */
export interface Sprite {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface Kit {
  theme: Theme;
  /** device px per world px it was painted at */
  k: number;
  epoch: number;
  atlas: HTMLCanvasElement;
  /** the ground's body: soil with strata and pebbles, or courses of cut stone */
  earth: Pat;
  /** a stone tile's body (rock, mossy blocks, bark), or null where stone is a sprite (the mill's crates) */
  stone: Pat | null;
  /** the moss cushion, repeating along x; its row 0 is MOSS_UP above a tile's top */
  moss: Pat;
  /** the plank strip, repeating along x; its row 0 is the tile's top */
  plank: Pat;
  s: Record<string, Sprite[]>;
}

/** A pattern, and the size in world px its canvas stands for (its transform maps it back to the world). */
export interface Pat {
  p: CanvasPattern;
  c: HTMLCanvasElement;
  sx: number;
  sy: number;
}

// ------------------------------------------------------------------ colour

const rgbOf = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgba = (c: string, a: number) => {
  const [r, g, b] = rgbOf(c);
  return `rgba(${r},${g},${b},${a})`;
};
export const mix = (a: string, b: string, t: number) => {
  const A = rgbOf(a);
  const B = rgbOf(b);
  const h = (i: number) =>
    Math.round(A[i] + (B[i] - A[i]) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${h(0)}${h(1)}${h(2)}`;
};

// ------------------------------------------------------------------ the kit

/** Kits painted, the latest used first. A level needs one (two, across a change of scale): two are kept. */
const kits: Kit[] = [];
const KEEP = 2;

/**
 * The kit for a theme at k device px per world px: one already painted within reach of it (drawn a
 * little smaller or larger: a governor step or a small resize paints nothing new), or a new one,
 * painted a touch larger than asked so that a step back up finds it too.
 */
export function kitFor(th: Theme, k: number): Kit {
  let kit: Kit | null;
  while (!(kit = kitStep(th, k)));
  return kit;
}

/** The kit being painted a step at a time (see kitStep). */
let job: { theme: Theme; k: number; epoch: number; steps: Generator<void, Kit> } | null = null;

/**
 * The kit for a theme at k, if it's painted; else a step more of painting it — the sprites, or one of
 * the textures — and null. A frame or a timer can then get a kit ready without one long frame for it.
 */
export function kitStep(th: Theme, k: number): Kit | null {
  const near = (c: { k: number }) => c.k >= k * 0.92 && c.k <= k * 1.4;
  let kit = kits.find((c) => c.theme === th && c.epoch === canvasEpoch && near(c)) ?? null;
  if (kit) kits.splice(kits.indexOf(kit), 1);
  else {
    if (!job || job.theme !== th || job.epoch !== canvasEpoch || !near(job)) {
      const kk = Math.min(5, k * 1.1);
      job = { theme: th, k: kk, epoch: canvasEpoch, steps: build(th, kk) };
    }
    const n = job.steps.next();
    if (!n.done) return null;
    job = null;
    kit = n.value;
  }
  kits.unshift(kit);
  // (the rest give their memory back now: a phone has little to spare)
  for (const old of kits.splice(KEEP)) for (const c of [old.atlas, old.earth.c, old.stone?.c, old.moss.c, old.plank.c]) if (c) c.width = c.height = 0;
  return kit;
}

/** Lay a sprite down with its anchor at (x, y), world px. */
export function stamp(ctx: G, kit: Kit, s: Sprite, x: number, y: number) {
  ctx.drawImage(kit.atlas, s.sx, s.sy, s.sw, s.sh, x + s.dx, y + s.dy, s.dw, s.dh);
}

/** Lay a sprite down stretched over a rectangle (world px). */
export function stretch(ctx: G, kit: Kit, s: Sprite, x: number, y: number, w: number, h: number) {
  ctx.drawImage(kit.atlas, s.sx, s.sy, s.sw, s.sh, x, y, w, h);
}

/** Set a pattern up to fill from world (ox, oy). */
export function anchor(pat: Pat, ox: number, oy: number) {
  pat.p.setTransform(new DOMMatrix([pat.sx, 0, 0, pat.sy, ox, oy]));
  return pat.p;
}

interface Spec {
  name: string;
  /** the box it's painted in, relative to its anchor (world px) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  paint: (g: G) => void;
}

/** A tiling texture, w × h world px painted at about k px per world px (exactly the canvas's size: it must tile). */
function texture(w: number, h: number, k: number, rep: 'repeat' | 'repeat-x', paint: (g: G) => void): Pat {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w * k));
  c.height = Math.max(2, Math.round(h * k));
  const g = c.getContext('2d')!;
  g.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);
  paint(g);
  return { p: g.createPattern(c, rep)!, c, sx: w / c.width, sy: h / c.height };
}

function* build(th: Theme, k: number): Generator<void, Kit> {
  const specs = spritesFor(th);
  // shelf-pack them into one canvas (2 px apart: a filtered edge never picks up a neighbour)
  const PAD = 2;
  const sized = specs.map((s) => ({ s, w: Math.max(1, Math.ceil((s.x1 - s.x0) * k)), h: Math.max(1, Math.ceil((s.y1 - s.y0) * k)) }));
  const area = sized.reduce((n, z) => n + (z.w + PAD) * (z.h + PAD), 0);
  const AW = Math.max(64, Math.min(4096, Math.ceil(Math.sqrt(area) * 1.25)), ...sized.map((z) => z.w + PAD * 2));
  let x = PAD;
  let y = PAD;
  let row = 0;
  const at = sized.map((z) => {
    if (x + z.w + PAD > AW) {
      x = PAD;
      y += row + PAD;
      row = 0;
    }
    const p = { x, y };
    x += z.w + PAD;
    row = Math.max(row, z.h);
    return p;
  });
  const atlas = document.createElement('canvas');
  atlas.width = AW;
  atlas.height = y + row + PAD;
  const g = atlas.getContext('2d')!;
  const s: Record<string, Sprite[]> = {};
  for (const [i, z] of sized.entries()) {
    // (a dozen sprites a step, each dozen painted by the GPU in its own step: see settle)
    if (i && i % 12 === 0) {
      settle(atlas);
      yield;
    }
    const { x: ax, y: ay } = at[i];
    const sp = z.s;
    g.save();
    g.beginPath();
    g.rect(ax, ay, z.w, z.h);
    g.clip();
    g.setTransform(k, 0, 0, k, ax - sp.x0 * k, ay - sp.y0 * k);
    sp.paint(g);
    g.restore();
    (s[sp.name] ??= []).push({ sx: ax, sy: ay, sw: z.w, sh: z.h, dx: sp.x0, dy: sp.y0, dw: z.w / k, dh: z.h / k });
  }
  settle(atlas);
  yield;
  const seed = seedOf(th);
  const earth = th.ground.kind === 'blocks' ? texture(128, 64, k, 'repeat', (c) => paintBlocks(c, 128, 64, blockPal(th, 'ground'), seed)) : texture(SOIL_W, SOIL_H, k, 'repeat', (c) => paintSoil(c, th, SOIL_W, SOIL_H, seed));
  yield;
  let stone: Pat | null = null;
  if (stoneKind(th) === 'blocks') stone = texture(128, 64, k, 'repeat', (c) => paintBlocks(c, 128, 64, blockPal(th, 'stone'), seed + 1));
  else if (stoneKind(th) === 'rock') stone = texture(ROCK_S, ROCK_S, k, 'repeat', (c) => paintRock(c, th, ROCK_S, ROCK_S, seed + 2));
  else if (stoneKind(th) === 'bark') stone = texture(64, 64, k, 'repeat', (c) => paintBark(c, th, 64, 64, seed + 3));
  if (stone) yield;
  const moss = texture(MOSS_P, MOSS_UP + MOSS_DOWN, k, 'repeat-x', (c) => {
    c.translate(0, MOSS_UP + SINK);
    paintMossBand(c, th, MOSS_P, seed + 4);
  });
  yield;
  const plank = texture(PLANK_P, PLANK_H, k, 'repeat-x', (c) => paintPlankStrip(c, th, PLANK_P, seed + 5));
  return { theme: th, k, epoch: canvasEpoch, atlas, earth, stone, moss, plank, s };
}

const seedOf = (th: Theme) => [...th.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);

/** What a stone tile is in this theme. */
export const stoneKind = (th: Theme): 'blocks' | 'rock' | 'bark' | 'crate' => (th.id === 'woods' ? 'bark' : th.id === 'mill' ? 'crate' : th.id === 'cascade' || th.id === 'falls' ? 'rock' : 'blocks');

/** Does a stone tile grow the moss cushion on its top? (Not a crate, and a log shows its rings.) */
export const stoneMossy = (th: Theme) => stoneKind(th) === 'blocks' || stoneKind(th) === 'rock';

// ------------------------------------------------------------------ painting helpers

/** Call `f` at (x, y) and again wherever a copy shifted by the texture's size would show (within `r` of an edge). */
function wrap(W: number, H: number, x: number, y: number, r: number, f: (x: number, y: number) => void) {
  const xs = [x];
  if (x - r < 0) xs.push(x + W);
  if (x + r > W) xs.push(x - W);
  const ys = [y];
  if (H) {
    if (y - r < 0) ys.push(y + H);
    if (y + r > H) ys.push(y - H);
  }
  for (const a of xs) for (const b of ys) f(a, b);
}

/** Dots over a tiling texture, one path per colour. */
function dots(g: G, W: number, H: number, n: number, x0: number, y0: number, x1: number, y1: number, rMin: number, rMax: number, color: string, r: () => number) {
  const p = new Path2D();
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * (x1 - x0);
    const y = y0 + r() * (y1 - y0);
    const rad = rMin + r() * (rMax - rMin);
    wrap(W, H, x, y, rad, (a, b) => {
      p.moveTo(a + rad, b);
      p.arc(a, b, rad, 0, TAU);
    });
  }
  g.fillStyle = color;
  g.fill(p);
}

const ell = (g: G | Path2D, x: number, y: number, rx: number, ry: number, rot = 0) => {
  g.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
  g.ellipse(x, y, rx, ry, rot, 0, TAU);
};

const tri = (p: Path2D, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
  p.moveTo(ax, ay);
  p.lineTo(bx, by);
  p.lineTo(cx, cy);
  p.closePath();
};

function fillEll(g: G, color: string, x: number, y: number, rx: number, ry: number, rot = 0) {
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, TAU);
  g.fill();
}

/** A pebble: where it is, its radii and tilt, and its colour. */
type Peb = [x: number, y: number, rx: number, ry: number, rot: number, col: string];

/**
 * Pebbles set in the earth: their shadows, their bodies, their shaded halves and a glint of light —
 * a path for each, whatever the number of pebbles (a software renderer pays by the fill).
 */
function pebbles(g: G, list: Peb[], deep: string) {
  const layer = (color: string, f: (p: Peb) => [number, number, number, number]) => {
    g.fillStyle = color;
    g.beginPath();
    for (const p of list) ell(g, ...f(p), p[4]);
    g.fill();
  };
  layer(rgba(deep, 0.45), ([x, y, rx, ry]) => [x + 0.5, y + 0.9, rx + 0.8, ry + 0.7]);
  for (const col of new Set(list.map((p) => p[5]))) {
    g.fillStyle = col;
    g.beginPath();
    for (const [x, y, rx, ry, rot, c] of list) if (c === col) ell(g, x, y, rx, ry, rot);
    g.fill();
  }
  layer(rgba(deep, 0.2), ([x, y, rx, ry]) => [x + rx * 0.16, y + ry * 0.3, rx * 0.8, ry * 0.62]);
  layer('rgba(255,253,236,0.42)', ([x, y, rx, ry]) => [x - rx * 0.32, y - ry * 0.4, rx * 0.42, ry * 0.3]);
}

/**
 * Moss lumps, each lit from above: the shaded mass under them, the lumps, their lit caps. `dark` takes
 * them a tone down the moss's four (a row further back, or a face out of the sun).
 */
function lumps(g: G, m: string[], list: [number, number, number][], dark = 0) {
  const a = new Path2D();
  const b = new Path2D();
  const c = new Path2D();
  for (const [x, y, r] of list) {
    a.moveTo(x + r + 0.6, y + 1);
    a.arc(x + 0.6, y + 1, r, 0, TAU);
    b.moveTo(x + r * 0.9, y);
    b.arc(x, y, r * 0.9, 0, TAU);
    c.moveTo(x - r * 0.3 + r * 0.48, y - r * 0.38);
    c.arc(x - r * 0.3, y - r * 0.38, r * 0.48, 0, TAU);
  }
  g.fillStyle = m[Math.min(3, 2 + dark)];
  g.fill(a);
  g.fillStyle = m[1 + dark];
  g.fill(b);
  g.fillStyle = m[dark];
  g.fill(c);
}

/** Blades of grass or moss fronds fanning up from (x, y): a path for each colour. */
function blades(g: G, x: number, y: number, n: number, len: number, spread: number, colors: string[], r: () => number) {
  const paths = colors.map(() => new Path2D());
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + ((i + 0.5) / n - 0.5) * spread + (r() - 0.5) * 0.3;
    const l = len * (0.6 + r() * 0.5);
    const w = 0.7 + r() * 0.6;
    const tx = x + Math.cos(a) * l;
    const ty = y + Math.sin(a) * l;
    const bend = (r() - 0.5) * 2;
    const p = paths[i % colors.length];
    p.moveTo(x - w, y);
    p.quadraticCurveTo((x + tx) / 2 + bend - w * 0.3, (y + ty) / 2, tx, ty);
    p.quadraticCurveTo((x + tx) / 2 + bend + w * 0.3, (y + ty) / 2, x + w, y);
    p.closePath();
  }
  paths.forEach((p, i) => {
    g.fillStyle = colors[i];
    g.fill(p);
  });
}

/**
 * Small fern fronds, as on the title's banks: curved stems with paired leaflets, smaller toward the
 * tip. `fronds` are [length, angle, bend] from (x, y); all the stems are one stroke, the leaves one fill.
 */
function ferns(g: G, x: number, y: number, fronds: [number, number, number][], color: string) {
  const stems = new Path2D();
  const leaves = new Path2D();
  const steps = 6;
  for (const [len, angle, bend] of fronds) {
    let px = x;
    let py = y;
    let a = angle;
    stems.moveTo(px, py);
    for (let i = 0; i < steps; i++) {
      const nx = px + Math.cos(a) * (len / steps);
      const ny = py + Math.sin(a) * (len / steps);
      stems.lineTo(nx, ny);
      const leaf = len * 0.2 * (1 - i / (steps + 1));
      for (const side of [-1, 1]) {
        const la = a + side * 1.15;
        ell(leaves, nx + Math.cos(la) * leaf * 0.5, ny + Math.sin(la) * leaf * 0.5, leaf * 0.55, leaf * 0.22, la);
      }
      px = nx;
      py = ny;
      a += bend;
    }
  }
  g.strokeStyle = color;
  g.lineWidth = 0.8;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke(stems);
  g.fillStyle = color;
  g.fill(leaves);
}

// ------------------------------------------------------------------ the earth

/** Soil: strata in a few shades, soft mottling, grit, and pebbles with light and shadow. */
function paintSoil(g: G, th: Theme, W: number, H: number, seed: number) {
  const p = th.ground;
  const r = rng(seed * 13 + 1);
  g.fillStyle = p.body;
  g.fillRect(0, 0, W, H);
  // strata: wavy bands across the whole width (whole waves of it, so it tiles)
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const c = ((i + 0.2 + r() * 0.6) * H) / bands;
    const half = 2.5 + r() * 5;
    const n1 = 1 + Math.floor(r() * 2);
    const n2 = 3 + Math.floor(r() * 3);
    const ph1 = r() * TAU;
    const ph2 = r() * TAU;
    const ph3 = r() * TAU;
    const a1 = 1.5 + r() * 3;
    const a2 = 0.5 + r() * 1.2;
    const mid = (x: number) => c + a1 * Math.sin((x / W) * TAU * n1 + ph1) + a2 * Math.sin((x / W) * TAU * n2 + ph2);
    const thick = (x: number) => half * (0.55 + 0.45 * Math.sin((x / W) * TAU * 2 + ph3));
    g.fillStyle = rgba(p.strata[i % 2], 0.55 + r() * 0.3);
    for (const dy of [-H, 0, H]) {
      if (c + dy + half + a1 + a2 < 0 || c + dy - half - a1 - a2 > H) continue;
      g.beginPath();
      for (let x = 0; x <= W; x += 4) g.lineTo(x, mid(x) - thick(x) + dy);
      for (let x = W; x >= 0; x -= 4) g.lineTo(x, mid(x) + thick(x) + dy);
      g.closePath();
      g.fill();
    }
  }
  // soft mottling, then grit
  dots(g, W, H, 90, 0, 0, W, H, 2.5, 6.5, rgba(p.bodyDark, 0.25), r);
  dots(g, W, H, 60, 0, 0, W, H, 2, 5, rgba(p.strata[0], 0.3), r);
  dots(g, W, H, 330, 0, 0, W, H, 0.55, 1.15, rgba(p.speck2, 0.6), r);
  dots(g, W, H, 160, 0, 0, W, H, 0.5, 1.0, rgba(p.speck, 0.65), r);
  // moss and lichen in the soil, here and there
  dots(g, W, H, 70, 0, 0, W, H, 0.6, 1.4, rgba(th.ground.moss[2], 0.55), r);
  dots(g, W, H, 26, 0, 0, W, H, 1.2, 2.6, rgba(th.ground.moss[1], 0.35), r);
  // gravel (the bigger pebbles are sprites, scattered by tile: in a texture they'd repeat in a grid)
  const gravel: Peb[] = [];
  for (let i = 0; i < 14; i++) {
    const x = r() * W;
    const y = r() * H;
    const rx = 1.2 + r() * 1.3;
    const ry = rx * (0.6 + r() * 0.3);
    const rot = (r() - 0.5) * 0.8;
    const col = p.pebble[Math.floor(r() * p.pebble.length)];
    wrap(W, H, x, y, rx + 2, (a, b) => gravel.push([a, b, rx, ry, rot, col]));
  }
  pebbles(g, gravel, p.deep);
}

interface BlockPal {
  base: string;
  light: string;
  dark: string;
  mortar: string;
  speck: string;
  moss: string[] | null;
}

const blockPal = (th: Theme, which: 'ground' | 'stone'): BlockPal =>
  which === 'ground'
    ? { base: th.ground.body, light: th.ground.strata[0], dark: th.ground.bodyDark, mortar: th.ground.strata[1], speck: th.ground.speck2, moss: null }
    : { base: th.stone.face, light: th.stone.light, dark: th.stone.dark, mortar: th.stone.line, speck: th.stone.dark, moss: th.ground.moss };

/** Courses of cut stone, two a tile, the joints on the tile grid: each block its own shade, lit on top. */
function paintBlocks(g: G, W: number, H: number, c: BlockPal, seed: number) {
  const r = rng(seed * 7 + 3);
  g.fillStyle = c.mortar;
  g.fillRect(0, 0, W, H);
  const cols = W / 32;
  // each block one of five shades, a path for each shade; their lit tops and shaded feet a path each
  const SHADES = 5;
  const blocks = Array.from({ length: SHADES }, () => new Path2D());
  const lit = new Path2D();
  const foot = new Path2D();
  const chips = new Path2D();
  for (let row = 0; row < H / 16; row++) {
    const off = (row & 1) * 16;
    const y = row * 16;
    for (let i = -1; i < cols; i++) {
      const x = i * 32 + off;
      // (a block's look comes from its column on the texture, so the half at each edge matches the other)
      const id = (i + cols) % cols;
      blocks[Math.floor(hash2(id, row, seed) * SHADES)].roundRect(x + 0.9, y + 0.9, 30.2, 14.2, 2.4);
      lit.rect(x + 2.2, y + 1.3, 27.6, 1.3);
      foot.rect(x + 2.2, y + 12.8, 27.6, 1.5);
      // a chip off a corner, now and then
      if (hash2(id, row, seed + 1) < 0.35) ell(chips, x + 3 + hash2(id, row, seed + 2) * 26, y + 3 + hash2(id, row, seed + 3) * 9, 1.6, 1.1);
    }
  }
  blocks.forEach((p, i) => {
    const v = (i + 0.5) / SHADES - 0.5;
    g.fillStyle = mix(c.base, v < 0 ? c.dark : c.light, Math.abs(v) * 0.9);
    g.fill(p);
  });
  g.fillStyle = rgba(c.light, 0.6);
  g.fill(lit);
  g.fillStyle = rgba(c.dark, 0.55);
  g.fill(foot);
  g.fillStyle = rgba(c.dark, 0.5);
  g.fill(chips);
  dots(g, W, H, 160, 0, 0, W, H, 0.45, 0.95, rgba(c.speck, 0.45), r);
  dots(g, W, H, 80, 0, 0, W, H, 0.45, 0.9, 'rgba(255,255,245,0.35)', r);
  if (c.moss) {
    // moss in the joints
    const m = c.moss;
    const tufts = [new Path2D(), new Path2D(), new Path2D()];
    for (let row = 0; row <= H / 16; row++) {
      for (let i = 0; i < 26; i++) {
        const x = r() * W;
        const rad = 0.8 + r() * 1.6;
        const y = row * 16 + (r() - 0.5);
        wrap(W, H, x, y, rad + 1, (a, b) => ell(tufts[i % 3], a, b, rad * 1.4, rad * 0.8));
      }
    }
    tufts.forEach((p, i) => {
      g.fillStyle = rgba(m[3 - i], 0.85);
      g.fill(p);
    });
  }
}

/** Wet rock: a mottled face, lichen and grit, and a few cracks with a lit lip. */
function paintRock(g: G, th: Theme, W: number, H: number, seed: number) {
  const s = th.stone;
  const m = th.ground.moss;
  const r = rng(seed * 5 + 11);
  g.fillStyle = s.face;
  g.fillRect(0, 0, W, H);
  dots(g, W, H, 26, 0, 0, W, H, 5, 12, rgba(s.light, 0.22), r);
  dots(g, W, H, 26, 0, 0, W, H, 5, 12, rgba(s.dark, 0.2), r);
  dots(g, W, H, 50, 0, 0, W, H, 0.8, 2.4, rgba(m[1], 0.42), r);
  dots(g, W, H, 40, 0, 0, W, H, 0.8, 2.0, rgba(m[3], 0.4), r);
  dots(g, W, H, 200, 0, 0, W, H, 0.45, 0.95, rgba(s.line, 0.55), r);
  dots(g, W, H, 120, 0, 0, W, H, 0.45, 0.9, 'rgba(255,255,240,0.35)', r);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const cracks = new Path2D();
  const lips = new Path2D();
  for (let i = 0; i < 6; i++) {
    let x = 10 + r() * (W - 20);
    let y = 10 + r() * (H - 20);
    const pts: [number, number][] = [[x, y]];
    let a = (r() - 0.5) * 1.2 + (r() < 0.5 ? Math.PI / 2 : 0);
    for (let j = 0; j < 3; j++) {
      const l = 4 + r() * 6;
      x = Math.min(W - 4, Math.max(4, x + Math.cos(a) * l));
      y = Math.min(H - 4, Math.max(4, y + Math.sin(a) * l));
      pts.push([x, y]);
      a += (r() - 0.5) * 1.4;
    }
    pts.forEach(([px, py], j) => (j ? lips.lineTo(px + 0.7, py + 0.7) : lips.moveTo(px + 0.7, py + 0.7)));
    pts.forEach(([px, py], j) => (j ? cracks.lineTo(px, py) : cracks.moveTo(px, py)));
  }
  g.strokeStyle = rgba(s.light, 0.55);
  g.lineWidth = 0.8;
  g.stroke(lips);
  g.strokeStyle = s.line;
  g.lineWidth = 1.1;
  g.stroke(cracks);
}

/** Bark: deep vertical furrows with lit ridges between, a knot, lichen. */
function paintBark(g: G, th: Theme, W: number, H: number, seed: number) {
  const s = th.stone;
  const r = rng(seed * 3 + 17);
  g.fillStyle = s.face;
  g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  const n = 8;
  const ridges = new Path2D();
  const furrows = new Path2D();
  for (let i = 0; i < n; i++) {
    const x0 = ((i + 0.5 + (r() - 0.5) * 0.5) * W) / n;
    const a = 0.8 + r() * 1.4;
    const cyc = 1 + Math.floor(r() * 2);
    const ph = r() * TAU;
    const xAt = (y: number) => x0 + a * Math.sin((y / H) * TAU * cyc + ph);
    // (whole waves down it, so it tiles; a copy either side where it nears an edge)
    for (const dx of [-W, 0, W]) {
      if (x0 + dx + 6 < 0 || x0 + dx - 6 > W) continue;
      ridges.moveTo(xAt(0) + dx + 2, 0);
      furrows.moveTo(xAt(0) + dx, 0);
      for (let y = 4; y <= H; y += 4) {
        ridges.lineTo(xAt(y) + dx + 2, y);
        furrows.lineTo(xAt(y) + dx, y);
      }
    }
  }
  g.strokeStyle = rgba(s.light, 0.55);
  g.lineWidth = 1;
  g.stroke(ridges);
  g.strokeStyle = s.dark;
  g.lineWidth = 1.7;
  g.stroke(furrows);
  dots(g, W, H, 26, 0, 0, W, H, 0.8, 1.8, rgba(th.ground.moss[1], 0.5), r);
  dots(g, W, H, 90, 0, 0, W, H, 0.4, 0.8, rgba(s.line, 0.5), r);
  const kx = 18 + r() * 28;
  const ky = 14 + r() * 36;
  fillEll(g, s.dark, kx, ky, 3.2, 4.4);
  g.strokeStyle = s.light;
  g.lineWidth = 0.8;
  g.beginPath();
  g.ellipse(kx, ky, 2, 2.9, 0, 0, TAU);
  g.stroke();
}

// ------------------------------------------------------------------ the moss cushion

/**
 * The cushion along every top, painted for y = 0 at the tile's top: a ragged fringe of the darkest moss
 * with tongues hanging onto the earth, the cushion over it, a lumpy top lit from above, stipple, and
 * blades poking up. Whole waves of everything along its length, so it repeats without a seam.
 */
function paintMossBand(g: G, th: Theme, P: number, seed: number) {
  const m = th.ground.moss;
  const r = rng(seed * 11 + 5);
  const w = [5 + Math.floor(r() * 3), 13 + Math.floor(r() * 4), 29 + Math.floor(r() * 6)];
  const ph = [r() * TAU, r() * TAU, r() * TAU];
  const foot = (x: number) => 11 + 1.7 * Math.sin((x / P) * TAU * w[0] + ph[0]) + 1.1 * Math.sin((x / P) * TAU * w[1] + ph[1]) + 0.6 * Math.sin((x / P) * TAU * w[2] + ph[2]);
  // the fringe, with tongues of moss hanging over the earth
  const fr = new Path2D();
  fr.moveTo(0, 0);
  for (let x = 0; x <= P; x += 3) fr.lineTo(x, foot(x));
  fr.lineTo(P, 0);
  fr.closePath();
  for (let x = r() * 8; x < P; x += 6 + r() * 15) {
    const hw = 1.5 + r() * 2.2;
    const len = 3 + Math.pow(r(), 1.4) * 7.5;
    const f = foot(x) - 1;
    wrap(P, 0, x, 0, hw + 1, (a) => ell(fr, a, f + len / 2 - 1.5, hw, len / 2 + 1.5));
  }
  g.fillStyle = m[3];
  g.fill(fr);
  // the cushion
  const body = new Path2D();
  body.moveTo(0, 0);
  for (let x = 0; x <= P; x += 3) body.lineTo(x, foot(x) - 2.6);
  body.lineTo(P, 0);
  body.closePath();
  g.fillStyle = m[2];
  g.fill(body);
  // three rows of lumps, back to front, each lump lit on its top (the back row a tone darker: depth)
  const rows: [number, number, number, number, number][] = [
    // [y, y jitter, radius, radius jitter, spacing]
    [-0.5, 1.6, 3.2, 2.4, 1.05],
    [3.2, 1.6, 3.6, 2.8, 1.2],
    [6.6, 1.4, 2.8, 2.2, 1.5],
  ];
  rows.forEach(([y0, yj, r0, rj, sp], i) => {
    const list: [number, number, number][] = [];
    for (let x = r() * 5; x < P; ) {
      const rad = r0 + r() * rj;
      const y = y0 + r() * yj;
      wrap(P, 0, x, y, rad + 1.5, (a) => list.push([a, y, rad]));
      x += rad * (sp + r() * 0.8);
    }
    lumps(g, m, list, i === 1 ? 0 : 1);
  });
  // stipple: lit flecks high, shaded ones low, and pale specks
  dots(g, P, 0, 190, 0, -5, P, 4, 0.5, 1.1, m[0], r);
  dots(g, P, 0, 150, 0, 4, P, 10, 0.5, 1.1, m[3], r);
  dots(g, P, 0, 44, 0, -3, P, 8, 0.45, 0.9, 'rgba(250,252,205,0.85)', r);
  // blades poking up out of it
  const b0 = new Path2D();
  const b1 = new Path2D();
  for (let x = r() * 6; x < P; x += 4 + r() * 10) {
    const lean = (r() - 0.5) * 3.4;
    const h = 4 + r() * 5;
    const hw = 0.65 + r() * 0.55;
    const p = r() < 0.5 ? b0 : b1;
    const base = -1 + r() * 2;
    wrap(P, 0, x, 0, 4, (a) => {
      p.moveTo(a - hw, base);
      p.quadraticCurveTo(a + lean * 0.25, base - h * 0.55, a + lean, base - h);
      p.quadraticCurveTo(a + lean * 0.3 + hw * 0.4, base - h * 0.5, a + hw, base);
      p.closePath();
    });
  }
  g.fillStyle = m[1];
  g.fill(b1);
  g.fillStyle = m[0];
  g.fill(b0);
}

// ------------------------------------------------------------------ planks

/** A plank strip: lit top, grain, joints with their nails, a knot here and there, the dark edge under it. */
function paintPlankStrip(g: G, th: Theme, P: number, seed: number) {
  const p = th.plank;
  const r = rng(seed * 17 + 9);
  g.fillStyle = p.side;
  g.fillRect(0, 0, P, 8);
  g.lineCap = 'round';
  const grain = [new Path2D(), new Path2D()];
  for (let i = 0; i < 5; i++) {
    const y0 = 2.8 + i * 1.05 + r() * 0.4;
    const n = 1 + Math.floor(r() * 3);
    const ph = r() * TAU;
    const p2 = grain[i % 2];
    p2.moveTo(0, y0 + 0.45 * Math.sin(ph));
    for (let x = 4; x <= P; x += 4) p2.lineTo(x, y0 + 0.45 * Math.sin((x / P) * TAU * n + ph));
  }
  g.lineWidth = 0.55;
  g.strokeStyle = rgba(p.top, 0.4);
  g.stroke(grain[0]);
  g.strokeStyle = rgba(p.dark, 0.45);
  g.stroke(grain[1]);
  const knots = new Path2D();
  const knotLit = new Path2D();
  for (let i = 0; i < 3; i++) {
    const kx = 8 + r() * (P - 16);
    ell(knots, kx, 4.6, 2.2, 1.25);
    ell(knotLit, kx - 0.3, 4.4, 1.0, 0.5);
  }
  g.fillStyle = rgba(p.dark, 0.75);
  g.fill(knots);
  g.fillStyle = rgba(p.top, 0.6);
  g.fill(knotLit);
  g.fillStyle = p.top;
  g.fillRect(0, 0, P, 2.6);
  g.fillStyle = 'rgba(255,246,222,0.42)';
  g.fillRect(0, 0.35, P, 0.75);
  // the dark edge under it, the joints (mid-tile, as they always were) and a nail either side of each
  const dark = new Path2D();
  const lit = new Path2D();
  const nails = new Path2D();
  const glints = new Path2D();
  dark.rect(0, 6.9, P, 1.7);
  for (let j = 16; j < P; j += 32) {
    dark.rect(j - 0.5, 0.6, 1, 6.8);
    lit.rect(j + 0.5, 0.8, 0.6, 6.2);
    for (const nx of [j - 4, j + 4.6]) {
      ell(nails, nx, 4.3, 0.95, 0.95);
      ell(glints, nx - 0.3, 3.95, 0.35, 0.35);
    }
  }
  g.fillStyle = p.dark;
  g.fill(dark);
  g.fillStyle = rgba(p.top, 0.55);
  g.fill(lit);
  g.fillStyle = '#4f4338';
  g.fill(nails);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fill(glints);
  const sh = g.createLinearGradient(0, 8.6, 0, PLANK_H);
  sh.addColorStop(0, 'rgba(0,0,0,0.22)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh;
  g.fillRect(0, 8.6, P, PLANK_H - 8.6);
}

// ------------------------------------------------------------------ sprites

function spritesFor(th: Theme): Spec[] {
  const m = th.ground.moss;
  const deep = th.ground.deep;
  const seed = seedOf(th);
  const out: Spec[] = [];
  const add = (name: string, x0: number, y0: number, x1: number, y1: number, paint: (g: G) => void) => out.push({ name, x0, y0, x1, y1, paint });
  const mirrored = (paint: (g: G) => void) => (g: G) => {
    g.scale(-1, 1);
    paint(g);
  };

  // the cushion's rounded end, rolling over the corner (left; the right is its mirror)
  for (let v = 0; v < 2; v++) {
    const cap = (g: G) => {
      const r = rng(seed + 100 + v);
      g.translate(0, SINK);
      // the shaded mass rolling over the corner and a little way down the face, then lumps over it
      g.fillStyle = m[3];
      g.beginPath();
      ell(g, 2, 4.5, 6.2, 7.5);
      ell(g, 1, 11, 3.4, 5.5 + v * 2);
      ell(g, 11, 9, 9, 4.6);
      g.fill();
      g.fillStyle = m[2];
      g.beginPath();
      ell(g, 3, 3, 6, 6);
      ell(g, 11.5, 4.5, 8, 5);
      g.fill();
      lumps(g, m, [
        [8.5, -1.6, 4.4],
        [16, -0.6, 4],
      ], 1);
      lumps(g, m, [
        [3.4, 0.2, 5.4 - v * 0.4],
        [11.5, 3, 4.6],
        [0.6, 6.4, 3.2],
        [6.5, 7.6, 3],
        [18, 4.2, 3.6],
      ]);
      blades(g, 7 + v * 4, -4, 3, 7, 1.4, [m[1], m[0]], r);
      g.fillStyle = 'rgba(250,252,205,0.8)';
      g.beginPath();
      for (let i = 0; i < 6; i++) ell(g, 1 + r() * 16, -4 + r() * 8, 0.5, 0.5);
      g.fill();
    };
    add('capL', -7, -13 + SINK, 23, 21 + SINK, cap);
    add('capR', -23, -13 + SINK, 7, 21 + SINK, mirrored(cap));
  }

  // moss clinging to a face from (0, 0) down, on the face's line: a column of lumps, out of the sun
  // (left face; the right is its mirror)
  for (let v = 0; v < 3; v++) {
    const len = [14, 22, 30][v];
    const drip = (g: G) => {
      const r = rng(seed + 200 + v);
      const list: [number, number, number][] = [];
      for (let y = 1; y < len; ) {
        const t = y / len;
        const rad = (1 - t * 0.55) * (2.3 + r() * 1.5);
        list.push([0.9 + (r() - 0.5) * 1.4, y, rad]);
        y += rad * (0.9 + r() * 0.5);
      }
      // (a tongue hanging from its foot)
      fillEll(g, m[3], 1.2, len - 1, 1.4, 3.4);
      lumps(g, m, list, 1);
      g.fillStyle = rgba(m[0], 0.9);
      g.beginPath();
      for (let i = 0; i < 4; i++) ell(g, -0.6 + r() * 2, 1 + r() * len * 0.8, 0.55, 0.55);
      g.fill();
    };
    add('dripL', -5, -5, 8, len + 4, drip);
    add('dripR', -8, -5, 5, len + 4, mirrored(drip));
  }

  // tufts of grass in the moss, standing on (0, 0)
  for (let v = 0; v < 3; v++) {
    add('tuft', -8, -14, 8, 2, (g) => {
      const r = rng(seed + 300 + v);
      fillEll(g, m[2], 0, 0.3, 3.8, 1.8);
      blades(g, 0, 0.6, 5 + v * 2, 8 + v * 1.5, 1.9, [m[2], m[1], m[0]], r);
    });
  }

  // flowers (each colour of the theme's), standing on (0, 0)
  th.ground.bloom.forEach((col, v) => {
    add('bloom', -7, -15, 7, 2, (g) => {
      const r = rng(seed + 400 + v);
      const heads: [number, number, number][] = v % 2 ? [[-2.5, -8, 1], [2.8, -11, 1.15]] : [[0.5, -10.5, 1.2]];
      const stems = new Path2D();
      for (const [hx, hy] of heads) {
        stems.moveTo(hx * 0.3, 0.5);
        stems.quadraticCurveTo(hx * 0.2 + (r() - 0.5) * 2, hy * 0.5, hx, hy);
      }
      g.strokeStyle = m[3];
      g.lineWidth = 0.9;
      g.lineCap = 'round';
      g.stroke(stems);
      fillEll(g, m[2], -1.6, -2.4, 2.4, 0.9, -0.5);
      fillEll(g, m[1], 1.8, -3.6, 2.2, 0.85, 0.5);
      // (every head's petals one path: their shade first, then them)
      const petals = (dx: number, dy: number) => {
        const p = new Path2D();
        for (const [hx, hy, s] of heads) for (let k = 0; k < 5; k++) ell(p, hx + Math.cos((k * TAU) / 5 - 1.2) * 1.9 * s + dx, hy + Math.sin((k * TAU) / 5 - 1.2) * 1.9 * s + dy, 1.45 * s, 1.45 * s);
        return p;
      };
      g.fillStyle = rgba(deep, 0.25);
      g.fill(petals(0.3, 0.4));
      g.fillStyle = col;
      g.fill(petals(0, 0));
      const mids = new Path2D();
      const glints = new Path2D();
      for (const [hx, hy, s] of heads) {
        ell(mids, hx, hy, s, s);
        ell(glints, hx - 0.3, hy - 0.3, 0.4 * s, 0.4 * s);
      }
      g.fillStyle = '#e3a33a';
      g.fill(mids);
      g.fillStyle = 'rgba(255,250,210,0.9)';
      g.fill(glints);
    });
  });

  // the theme's own things on the tops: mushrooms, ferns, glowing toadstools, pebbles
  if (th.id === 'woods') {
    for (let v = 0; v < 2; v++) {
      add('decor', -8, -12, 8, 2, (g) => {
        const cap = v ? '#c48a3a' : '#d9573b';
        fillEll(g, rgba(deep, 0.35), 0.6, 0.4, 5, 1.4);
        g.fillStyle = '#efe2cf';
        g.beginPath();
        g.moveTo(-1.6, 0.5);
        g.lineTo(-1.2, -5.5);
        g.lineTo(1.2, -5.5);
        g.lineTo(1.7, 0.5);
        g.closePath();
        g.fill();
        g.fillStyle = 'rgba(120,80,50,0.35)';
        g.fillRect(0.4, -5.5, 1.1, 6);
        g.fillStyle = mix(cap, '#3a1a10', 0.35);
        g.beginPath();
        g.ellipse(0, -5.2, 6, 1.6, 0, 0, Math.PI);
        g.fill();
        g.fillStyle = cap;
        g.beginPath();
        g.ellipse(0, -5.4, 6, 4.4, 0, Math.PI, TAU);
        g.fill();
        fillEll(g, 'rgba(255,240,220,0.45)', -2.2, -7.6, 2, 1.1, -0.3);
        if (!v) {
          g.fillStyle = '#fbefe0';
          g.beginPath();
          ell(g, -2.6, -6.6, 0.9, 0.7);
          ell(g, 1.2, -8.2, 0.8, 0.6);
          ell(g, 3.3, -6.1, 0.7, 0.55);
          g.fill();
        }
      });
    }
  } else if (th.id === 'mill') {
    for (let v = 0; v < 2; v++) {
      add('decor', -7, -6, 7, 2, (g) => {
        const list: Peb[] = [[0, -1.6 + v * 0.3, 4.4 - v, 2.8 - v * 0.4, 0, th.ground.pebble[v]]];
        if (v) list.push([4.2, -0.9, 2, 1.4, 0.3, th.ground.pebble[2]]);
        pebbles(g, list, deep);
      });
    }
  } else if (th.id === 'cascade' || th.id === 'falls') {
    for (let v = 0; v < 2; v++) {
      add('decor', -11, -15, 11, 2, (g) => {
        // (the outer two fronds a shade darker than the middle one)
        ferns(g, 0, 0.5, [-1, 1].map((k) => [10 + v * 2, -Math.PI / 2 + k * 0.7, k * 0.12]), m[2]);
        ferns(g, 0, 0.5, [[12 + v * 2, -Math.PI / 2, 0]], m[1]);
      });
    }
    if (th.id === 'falls') {
      // a toadstool that glows a little in the dark
      add('glow', -10, -16, 10, 2, (g) => {
        const rg = g.createRadialGradient(0, -6, 0, 0, -6, 10);
        rg.addColorStop(0, 'rgba(170,230,255,0.45)');
        rg.addColorStop(1, 'rgba(170,230,255,0)');
        g.fillStyle = rg;
        g.fillRect(-10, -16, 20, 18);
        g.fillStyle = '#e8f5ff';
        g.fillRect(-0.9, -5, 1.8, 5.5);
        g.fillStyle = '#9fe0ff';
        g.beginPath();
        g.ellipse(0, -5, 4.2, 2.9, 0, Math.PI, TAU);
        g.fill();
        fillEll(g, 'rgba(255,255,255,0.7)', -1.4, -6.4, 1.3, 0.6);
      });
    }
  }

  // moss spreading into the earth just under the cushion, thinning out downward (from the tile's top-left)
  for (let v = 0; v < 2; v++) {
    add('creep', 0, 8, 32, 30, (g) => {
      const r = rng(seed + 450 + v);
      for (const [n, col, a] of [
        [26, m[3], 0.55],
        [22, m[2], 0.6],
        [10, m[1], 0.5],
      ] as const) {
        g.fillStyle = rgba(col, a);
        g.beginPath();
        for (let i = 0; i < n; i++) {
          // (most near the top: the deeper, the fewer)
          const y = 12 + Math.pow(r(), 2.2) * 16;
          const rad = 0.7 + r() * 1.6 * (1 - (y - 12) / 20);
          ell(g, 1.5 + r() * 29, y, rad * 1.3, rad);
        }
        g.fill();
      }
    });
  }

  // rootlets in the earth under the cushion, from the tile's top-left
  for (let v = 0; v < 3; v++) {
    add('root', 0, 4, 32, 31, (g) => {
      const r = rng(seed + 500 + v);
      // (the thick upper parts, the thin lower parts and the hairs off them: a stroke each)
      const thick = new Path2D();
      const thin = new Path2D();
      const hairs = new Path2D();
      const n = 2 + (v % 2);
      for (let i = 0; i < n; i++) {
        let x = 4 + ((i + r() * 0.8) / n) * 24;
        let y = 10 + SINK;
        const len = 9 + r() * 13;
        const steps = 5;
        let a = Math.PI / 2 + (r() - 0.5) * 0.7;
        for (let j = 0; j < steps; j++) {
          const nx = x + Math.cos(a) * (len / steps);
          const ny = Math.min(29.5, y + Math.sin(a) * (len / steps));
          const p2 = j < 2 ? thick : thin;
          p2.moveTo(x, y);
          p2.lineTo(nx, ny);
          if (r() < 0.45) {
            const ba = a + (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.5);
            hairs.moveTo(nx, ny);
            hairs.lineTo(nx + Math.cos(ba) * (2 + r() * 3), Math.min(30, ny + Math.sin(ba) * (2 + r() * 3)));
          }
          x = Math.max(1, Math.min(31, nx));
          y = ny;
          a += (r() - 0.5) * 0.8;
        }
      }
      g.lineCap = 'round';
      g.strokeStyle = rgba(th.ground.root, 0.85);
      g.lineWidth = 1.6;
      g.stroke(thick);
      g.lineWidth = 0.95;
      g.stroke(thin);
      g.lineWidth = 0.55;
      g.stroke(hairs);
    });
  }

  // moss and roots hanging off an overhang, from the tile's bottom-left
  for (let v = 0; v < 3; v++) {
    add('strand', -2, -4, 34, 27, (g) => {
      const r = rng(seed + 600 + v);
      const lip = new Path2D();
      const lip2 = new Path2D();
      for (let x = 1; x < 32; x += 3.2 + r() * 2) {
        ell(lip, x, 0.6, 2.6 + r() * 1.2, 2 + r() * 0.8);
        ell(lip2, x + 0.4, -0.2, 1.8, 1.2);
      }
      g.fillStyle = m[3];
      g.fill(lip);
      g.fillStyle = m[2];
      g.fill(lip2);
      const strands = new Path2D();
      const roots = new Path2D();
      const leaves = [new Path2D(), new Path2D()];
      const n = 3 + v;
      for (let i = 0; i < n; i++) {
        const x0 = 3 + ((i + r()) / n) * 26;
        const len = 5 + Math.pow(r(), 0.8) * (14 + v * 2);
        const sway = (r() - 0.5) * 4;
        const root = r() < 0.3;
        const p2 = root ? roots : strands;
        p2.moveTo(x0, 1);
        p2.quadraticCurveTo(x0 + sway * 0.2, len * 0.5, x0 + sway, len);
        if (root) continue;
        const lv = leaves[i % 2];
        for (let t = 0.3; t < 1; t += 0.22) {
          const left = (t * 10) % 2 < 1;
          ell(lv, x0 + sway * t * t + (left ? -1.1 : 1.1), len * t, 1.3, 0.75, left ? 0.5 : -0.5);
        }
        ell(lv, x0 + sway, len + 0.5, 1.2, 1.5);
      }
      g.lineCap = 'round';
      g.strokeStyle = m[2];
      g.lineWidth = 1.3;
      g.stroke(strands);
      g.strokeStyle = rgba(th.ground.root, 0.9);
      g.lineWidth = 0.8;
      g.stroke(roots);
      g.fillStyle = m[2];
      g.fill(leaves[0]);
      g.fillStyle = m[1];
      g.fill(leaves[1]);
    });
  }

  // pebbles bedded in a face, standing a little proud of it (left face; the right is its mirror)
  for (let v = 0; v < 2; v++) {
    const peb = (g: G) => pebbles(g, [[1.2, 0, 3.6 + v, 2.6 + v * 0.5, v ? 0.4 : -0.3, th.ground.pebble[v]]], deep);
    add('pebL', -5, -5, 7, 5, peb);
    add('pebR', -7, -5, 5, 5, mirrored(peb));
  }

  // pebbles bedded in the earth, scattered a tile at a time (in the texture they'd repeat in a grid)
  for (let v = 0; v < 4; v++) {
    add('gravel', -10, -7, 10, 7, (g) => {
      const r = rng(seed + 900 + v);
      const n = 1 + (v % 3);
      const list: Peb[] = [];
      for (let i = 0; i < n; i++) {
        const rx = i ? 1.5 + r() * 1.5 : 2.6 + r() * 2.4;
        const x = i ? (r() - 0.5) * 9 : 0;
        const y = i ? (r() - 0.5) * 5 : 0;
        list.push([x, y, rx, rx * (0.6 + r() * 0.25), (r() - 0.5) * 0.8, th.ground.pebble[Math.floor(r() * 3)]]);
      }
      pebbles(g, list, deep);
    });
  }

  // the dark rims of an exposed face, laid over the body (stretched along the face)
  const rim = (g: G) => {
    const gr = g.createLinearGradient(0, 0, 9, 0);
    gr.addColorStop(0, rgba(deep, 0.55));
    gr.addColorStop(0.35, rgba(deep, 0.22));
    gr.addColorStop(1, rgba(deep, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 9, 4);
    g.fillStyle = rgba(deep, 0.5);
    g.fillRect(0, 0, 1.3, 4);
  };
  add('edgeL', 0, 0, 9, 4, rim);
  add('edgeR', -9, 0, 0, 4, mirrored(rim));
  add('edgeB', 0, -9, 4, 0, (g) => {
    g.rotate(-Math.PI / 2);
    rim(g);
  });
  // the shade the cushion casts on the earth just under it (stretched along the top)
  add('shade', 0, 0, 4, 16, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 16);
    gr.addColorStop(0, rgba(deep, 0.5));
    gr.addColorStop(1, rgba(deep, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 16);
  });

  // thorns: a bramble on the floor (from the tile's bottom-left), and hanging from a ceiling
  const sp = th.spikes;
  const thorny = th.id !== 'mill';
  const thorn = (g: G) => {
    if (thorny) {
      fillEll(g, rgba(deep, 0.35), 16, -2.2, 17, 3.4);
      fillEll(g, sp.b, 16, -5, 17, 6);
      fillEll(g, rgba(sp.a, 0.85), 15, -7.2, 13, 2.6);
      g.strokeStyle = rgba(mix(sp.b, '#000000', 0.3), 0.8);
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(2, -3.5);
      g.bezierCurveTo(10, -7, 20, -1.5, 30, -5.5);
      g.stroke();
      // the four thorns: their lit sides, their shaded sides, their points and a glint up each, a path each
      const lit = new Path2D();
      const shaded = new Path2D();
      const points = new Path2D();
      const glints = new Path2D();
      for (let k = 0; k < 4; k++) {
        const bx = 3 + k * 8.5;
        const tip = -17 - (k & 1) * 3;
        tri(lit, bx - 3, -6, bx + 1, tip, bx + 3, -6);
        tri(shaded, bx + 0.3, -6, bx + 1, tip, bx + 3, -6);
        tri(points, bx + 1, tip, bx - 0.2 - 0.05 * tip, tip + 5.5, bx + 2.1 + 0.03 * tip, tip + 5.5);
        glints.moveTo(bx - 1.8, -7);
        glints.lineTo(bx + 0.8, tip + 1.5);
      }
      g.fillStyle = sp.a;
      g.fill(lit);
      g.fillStyle = mix(sp.b, '#000000', 0.15);
      g.fill(shaded);
      g.fillStyle = sp.tip;
      g.fill(points);
      g.strokeStyle = 'rgba(255,250,225,0.55)';
      g.lineWidth = 0.6;
      g.stroke(glints);
    } else {
      g.fillStyle = sp.b;
      g.fillRect(1, -4, 30, 4);
      const spikes = new Path2D();
      const lit = new Path2D();
      const shaded = new Path2D();
      for (let k = 0; k < 4; k++) {
        const bx = 4 + k * 8;
        tri(spikes, bx - 3.6, -3, bx, -15, bx + 3.6, -3);
        tri(lit, bx - 1, -4, bx, -14, bx + 0.4, -4);
        tri(shaded, bx + 0.6, -4, bx, -14, bx + 3.4, -3.2);
      }
      g.fillStyle = sp.a;
      g.fill(spikes);
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.fill(lit);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fill(shaded);
    }
  };
  add('thorn', -2, -21, 34, 1, thorn);
  add('thornC', -2, -1, 34, 21, (g) => {
    g.scale(1, -1);
    thorn(g);
  });

  // an updraft vent: a mossy rock split down the middle (the spray breathes out of the crack)
  const st = th.stone;
  add('vent', -2, -6, 34, 32, (g) => {
    const r = rng(seed + 700);
    g.fillStyle = st.dark;
    g.beginPath();
    g.roundRect(0, 1, 32, 31, 6);
    g.fill();
    g.save();
    g.beginPath();
    g.roundRect(2, 3, 28, 26, 5);
    g.clip();
    const gr = g.createLinearGradient(0, 3, 0, 29);
    gr.addColorStop(0, st.light);
    gr.addColorStop(1, st.face);
    g.fillStyle = gr;
    g.fillRect(2, 3, 28, 26);
    g.fillStyle = rgba(st.dark, 0.4);
    g.beginPath();
    for (let i = 0; i < 14; i++) ell(g, 3 + r() * 26, 5 + r() * 22, 0.6 + r() * 1.6, 0.6 + r() * 1.2);
    g.fill();
    g.fillStyle = rgba(m[1], 0.5);
    g.beginPath();
    for (let i = 0; i < 10; i++) ell(g, 3 + r() * 26, 8 + r() * 20, 0.7 + r() * 1.3, 0.6 + r());
    g.fill();
    g.restore();
    g.fillStyle = '#1e2a22';
    g.beginPath();
    g.moveTo(12, 3);
    g.lineTo(20, 3);
    g.lineTo(17, 25);
    g.lineTo(14, 25);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(19.6, 4, 0.8, 18);
    lumps(g, m, [
      [4.5, 3.2, 3.6],
      [9.5, 2.6, 3.2],
      [23, 2.6, 3.2],
      [28, 3.4, 3.4],
    ]);
  });

  // the mill's crates
  if (stoneKind(th) === 'crate') {
    add('crate', 0, 0, 32, 32, (g) => {
      const r = rng(seed + 800);
      g.fillStyle = st.face;
      g.fillRect(0, 0, 32, 32);
      const grain = new Path2D();
      for (let b = 0; b < 3; b++) {
        g.fillStyle = mix(st.face, b % 2 ? st.dark : st.light, 0.25);
        g.fillRect(2, 2 + b * 9.4, 28, 9);
        for (let i = 0; i < 3; i++) {
          const y0 = 4 + b * 9.4 + i * 2.4 + r();
          grain.moveTo(2, y0);
          grain.bezierCurveTo(10, y0 + r() - 0.5, 20, y0 + r() - 0.5, 30, y0);
        }
      }
      g.strokeStyle = rgba(st.dark, 0.45);
      g.lineWidth = 0.5;
      g.stroke(grain);
      g.strokeStyle = st.dark;
      g.lineWidth = 2.2;
      g.strokeRect(2, 2, 28, 28);
      g.beginPath();
      g.moveTo(3.5, 28.5);
      g.lineTo(28.5, 3.5);
      g.stroke();
      g.strokeStyle = rgba(st.light, 0.75);
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(4.5, 29.5);
      g.lineTo(29.5, 4.5);
      g.moveTo(1, 1.2);
      g.lineTo(31, 1.2);
      g.stroke();
      g.fillStyle = st.light;
      g.fillRect(2, 2, 28, 1.6);
      const nails = new Path2D();
      const glints = new Path2D();
      for (const [nx, ny] of [[4.5, 4.5], [27.5, 4.5], [4.5, 27.5], [27.5, 27.5]]) {
        ell(nails, nx, ny, 0.95, 0.95);
        ell(glints, nx - 0.3, ny - 0.3, 0.35, 0.35);
      }
      g.fillStyle = '#4f4338';
      g.fill(nails);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fill(glints);
      g.fillStyle = rgba(st.line, 0.5);
      g.fillRect(0, 30.5, 32, 1.5);
    });
  }

  // a log's cut top, its rings
  if (stoneKind(th) === 'bark') {
    add('ring', 0, -1, 32, 8, (g) => {
      fillEll(g, st.light, 16, 3, 16, 4);
      fillEll(g, mix(st.light, '#fff2d8', 0.25), 16, 2.6, 13, 2.8);
      g.strokeStyle = st.line;
      g.lineWidth = 0.8;
      for (const s of [0.75, 0.48, 0.22]) {
        g.beginPath();
        g.ellipse(16, 3, 16 * s, 4 * s, 0, 0, TAU);
        g.stroke();
      }
    });
  }

  // a plank's sawn ends (left; the right is its mirror)
  const end = (g: G) => {
    g.fillStyle = th.plank.dark;
    g.beginPath();
    g.roundRect(0, 0, 2.6, 8.6, 1);
    g.fill();
    g.fillStyle = rgba(th.plank.top, 0.6);
    g.fillRect(0.5, 0.6, 0.8, 6.5);
  };
  add('plankL', 0, 0, 3, 9, end);
  add('plankR', -3, 0, 0, 9, mirrored(end));
  return out;
}
