/**
 * What grows on the map — trees, pines, bushes, rocks, ferns, flowers, reeds — and the landmarks:
 * placed once per world, from its seed, clear of the creek, the trail, the stops and each other, and
 * sorted into the chunks they show up in. A world's things live between where its creek starts (its
 * first stop's approach) and its last stop, and read nothing of the worlds after it, so a world added
 * later changes none of them. Pure (no DOM): the test counts what lands in a chunk.
 */
import { rng } from '../core/math';
import { CHUNK, ChunkCache } from './chunks';
import { STEP, type MapLayout, type Mark } from './layout';
import type { DecorKind, MapTheme } from './themes';

/** Kinds of thing, by number (stored per item). */
export const K = {
  tree: 0,
  pine: 1,
  bush: 2,
  rock: 3,
  boulder: 4,
  fern: 5,
  flowers: 6,
  tuft: 7,
  reeds: 8,
  mushroom: 9,
  stump: 10,
  lily: 11,
  wetrock: 12,
  foam: 13,
  mark: 14,
} as const;

export interface Item {
  k: number;
  x: number;
  y: number;
  /** size (about its radius) */
  s: number;
  /** variety: two numbers 0..1 and a colour pick */
  a: number;
  b: number;
  c: number;
  mark?: Mark;
}

export interface RegionDecor {
  /** chunk key → the items showing in it, back to front */
  buckets: Map<number, Item[]>;
  count: number;
  /** where this world's things live (x) */
  x0: number;
  x1: number;
}

/** [smallest, largest] size per kind */
const SIZE: Record<DecorKind, [number, number]> = {
  tree: [17, 25],
  pine: [15, 23],
  bush: [9, 14],
  rock: [5, 10],
  boulder: [12, 17],
  fern: [9, 13],
  flowers: [7, 11],
  tuft: [5, 7],
  reeds: [8, 12],
  mushroom: [4, 6],
  stump: [6, 8],
};
/** how much ground it covers, × size */
const FOOT: Record<DecorKind, number> = { tree: 0.75, pine: 0.6, bush: 0.95, rock: 1, boulder: 1, fern: 0.8, flowers: 0.6, tuft: 0.5, reeds: 0.5, mushroom: 1, stump: 1 };
/** stands up out of the ground: its top must not hide the trail behind it */
const TALL: Partial<Record<DecorKind, boolean>> = { tree: true, pine: true, bush: true, boulder: true };
/** how far it reaches from (x, y), × size: [either side, up, down] — for sorting it into chunks */
const EXT: [number, number, number][] = [
  [1.2, 2.2, 0.55],
  [0.85, 2.4, 0.5],
  [1.25, 1.4, 0.55],
  [1.3, 1.2, 0.8],
  [1.3, 1.3, 0.8],
  [1.4, 1.5, 0.6],
  [1.4, 0.9, 0.9],
  [1.3, 1.5, 0.5],
  [1.1, 2.7, 0.5],
  [1.5, 2.4, 0.6],
  [1.4, 1.5, 0.9],
  [1.5, 1.1, 1.1],
  [1.6, 1.3, 1.1],
  [1.6, 0.9, 0.9],
];
/** a landmark's reach, × its footprint: [either side, up, down] */
const MARK_EXT: Record<string, [number, number, number]> = {
  home: [1.3, 1.4, 0.9],
  millrace: [1.5, 2.4, 1.1],
  fallsfoot: [1.5, 2.6, 0.9],
  hollowtree: [1.4, 2.6, 0.8],
  barn: [1.4, 1.9, 0.9],
  den: [1.4, 1.5, 0.9],
  nest: [1.3, 2.3, 0.8],
  cliff: [1.4, 1.6, 0.9],
};
const ORDER: DecorKind[] = ['tree', 'pine', 'bush', 'rock', 'boulder', 'fern', 'flowers', 'tuft', 'reeds', 'mushroom', 'stump'];

/** Grow world w's things. */
export function scatter(L: MapLayout, w: number, th: MapTheme): RegionDecor {
  const g = L.regions[w];
  const r = rng((g.seed ^ 0x5bd1e995) >>> 0);
  const ns = g.cy.length;
  const ax0 = g.cx0;
  const ax1 = g.cx0 + (ns - 1) * STEP;
  const ay0 = g.box[1] - 720;
  const ay1 = g.box[3] + 720;
  const C = 16;
  const gw = Math.ceil((ax1 - ax0) / C) + 1;
  const gh = Math.ceil((ay1 - ay0) / C) + 1;
  // what nothing may be placed on (the trail, the stops, the landmarks), and what's already taken
  const hard = new Uint8Array(gw * gh);
  const soft = new Uint8Array(gw * gh);
  const mark = (grid: Uint8Array, x: number, y: number, rad: number) => {
    const i0 = Math.max(0, Math.floor((x - rad - ax0) / C));
    const i1 = Math.min(gw - 1, Math.floor((x + rad - ax0) / C));
    const j0 = Math.max(0, Math.floor((y - rad - ay0) / C));
    const j1 = Math.min(gh - 1, Math.floor((y + rad - ay0) / C));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * gw + i] = 1;
  };
  const free = (grid: Uint8Array, x: number, y: number, rad: number) => {
    const i0 = Math.max(0, Math.floor((x - rad - ax0) / C));
    const i1 = Math.min(gw - 1, Math.floor((x + rad - ax0) / C));
    const j0 = Math.max(0, Math.floor((y - rad - ay0) / C));
    const j1 = Math.min(gh - 1, Math.floor((y + rad - ay0) / C));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (grid[j * gw + i]) return false;
    return true;
  };
  const nodes = w > 0 ? [L.regions[w - 1].last, ...g.nodes] : g.nodes;
  for (const ni of nodes) {
    const n = L.nodes[ni];
    mark(hard, n.x, n.y, n.r + 24);
    // the stop's things stand behind it (a boss, a book): keep the ground there clear too
    mark(hard, n.x, n.y - n.r * 1.2, n.r);
  }
  for (const ei of g.edges) {
    const p = L.edges[ei].pts;
    for (let k = 0; k < p.length; k += 4) mark(hard, p[k], p[k + 1], 18);
  }
  for (const c of g.crossings) mark(hard, c.x, c.y, 30);
  for (const m of g.marks) if (m.foot) mark(hard, m.x, m.y, m.foot);

  const at = (x: number) => Math.max(0, Math.min(ns - 1, Math.round((x - g.cx0) / STEP)));
  /** the creek at x, between samples */
  const creek = (x: number): [number, number] => {
    const f = Math.max(0, Math.min(ns - 1.001, (x - g.cx0) / STEP));
    const k = Math.floor(f);
    const u = f - k;
    return [g.cy[k] + (g.cy[k + 1] - g.cy[k]) * u, Math.max(g.cw[k], g.cw[k + 1])];
  };
  const items: Item[] = [];
  // (reeds grow only at the water's edge, below)
  const weights = ORDER.map((k) => (k === 'reeds' ? 0 : th.decor[k] ?? 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const pick = (u: number): DecorKind => {
    let acc = 0;
    for (let i = 0; i < ORDER.length; i++) {
      acc += weights[i] / total;
      if (u < acc) return ORDER[i];
    }
    return 'tuft';
  };
  const push = (k: DecorKind | 'lily' | 'wetrock' | 'foam', x: number, y: number, s: number, a: number, b: number, c: number) => {
    items.push({ k: K[k], x, y, s, a, b, c });
  };

  // ---- the meadow: a jittered grid of chances, thinning out away from the trail
  const CELL = 34;
  for (let gy = ay0; gy < ay1; gy += CELL) {
    for (let gx = ax0; gx < ax1; gx += CELL) {
      const x = gx + r() * CELL;
      const y = gy + r() * CELL;
      const kindR = r();
      const sizeR = r();
      const a = r();
      const b = r();
      const c = r();
      const keep = r();
      const k = at(x);
      const dTrail = Math.abs(y - g.ty[k]);
      if (keep > (dTrail < 320 ? 0.62 : dTrail < 640 ? 0.44 : 0.28)) continue;
      const [yc, wc] = creek(x);
      const bank = Math.abs(y - yc) - wc;
      if (bank < 5) continue;
      let kind: DecorKind;
      if (bank < 22) kind = kindR < 0.45 && th.decor.reeds ? 'reeds' : kindR < 0.7 ? 'rock' : 'tuft';
      else kind = pick(kindR);
      const [s0, s1] = SIZE[kind];
      const s = s0 + sizeR * (s1 - s0);
      const foot = FOOT[kind] * s;
      if (!free(hard, x, y, foot + 4)) continue;
      if (TALL[kind] && !free(hard, x, y - s * 1.1, s * 0.85)) continue;
      if (!free(soft, x, y, foot)) continue;
      push(kind, x, y, s, a, b, c);
      mark(soft, x, y, TALL[kind] || kind === 'rock' || kind === 'fern' ? foot : foot * 0.5);
    }
  }

  // ---- clusters by the stops that ask for them
  for (const m of g.marks) {
    const n = L.nodes[m.node];
    if (m.kind === 'reeds' || m.kind === 'ferns' || m.kind === 'crags') {
      for (let i = 0; i < 26; i++) {
        const u = r();
        const v = r();
        const s = r();
        const a = r();
        const b = r();
        let x: number;
        let y: number;
        let kind: DecorKind;
        if (m.kind === 'reeds') {
          x = n.x + (u * 2 - 1) * 150;
          const [yc, wc] = creek(x);
          y = yc + (v < 0.5 ? -1 : 1) * (wc + 5 + s * 10);
          kind = 'reeds';
        } else {
          const ang = u * Math.PI * 2;
          const d = n.r + 30 + v * 90;
          x = n.x + Math.cos(ang) * d;
          y = n.y + Math.sin(ang) * d * 0.8;
          const k = at(x);
          if (Math.abs(y - g.cy[k]) - g.cw[k] < 6) continue;
          kind = m.kind === 'ferns' ? 'fern' : s < 0.45 ? 'boulder' : 'rock';
        }
        if (x < ax0 || x > ax1) continue;
        const [s0, s1] = SIZE[kind];
        const sz = s0 + a * (s1 - s0);
        if (!free(hard, x, y, FOOT[kind] * sz + 2) || !free(soft, x, y, FOOT[kind] * sz * 0.8)) continue;
        push(kind, x, y, sz, a, b, s);
        mark(soft, x, y, FOOT[kind] * sz * 0.8);
      }
    } else if (m.kind === 'pond' || m.kind === 'rapids') {
      const pond = m.kind === 'pond';
      for (let i = 0; i < (pond ? 22 : 30); i++) {
        const u = r();
        const v = r();
        const a = r();
        const b = r();
        const x = n.x + (u * 2 - 1) * (pond ? 110 : 140);
        if (x < ax0 || x > ax1) continue;
        const k = at(x);
        const y = g.cy[k] + (v * 2 - 1) * g.cw[k] * (pond ? 0.72 : 0.6);
        if (!free(hard, x, y, pond ? 10 : 8)) continue;
        if (pond) push('lily', x, y, 6 + a * 4, a, b, u);
        else push(i % 3 === 2 ? 'foam' : 'wetrock', x, y, i % 3 === 2 ? 7 + a * 5 : 4.5 + a * 4, a, b, u);
      }
    }
  }

  // ---- the landmarks
  for (const m of g.marks) if (MARK_EXT[m.kind]) items.push({ k: K.mark, x: m.x, y: m.y, s: m.foot, a: 0, b: 0, c: 0, mark: m });

  // ---- into chunks, back to front
  const buckets = new Map<number, Item[]>();
  for (const it of items) {
    let ex: number;
    let up: number;
    let dn: number;
    if (it.mark) [ex, up, dn] = MARK_EXT[it.mark.kind].map((f) => f * it.s);
    else [ex, up, dn] = EXT[it.k].map((f) => f * it.s);
    const cx0 = Math.floor((it.x - ex) / CHUNK);
    const cx1 = Math.floor((it.x + ex) / CHUNK);
    const cy0 = Math.floor((it.y - up) / CHUNK);
    const cy1 = Math.floor((it.y + dn) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = ChunkCache.key(cx, cy);
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = []));
        b.push(it);
      }
    }
  }
  for (const b of buckets.values()) b.sort((p, q) => p.y - q.y || p.x - q.x);
  return { buckets, count: items.length, x0: ax0, x1: ax1 };
}
