/**
 * The overworld's layout, worked out from WORLDS alone: a trail of stops running east (upstream), a
 * creek winding beside it and across it, side spots off the trail, and each world's landmarks.
 *
 * APPEND ONLY. A world's layout reads nothing but its own entry and where the world before it ended
 * (its last stop, the trail's heading there, which bank the creek was on). Adding world N+1 therefore
 * moves nothing in worlds 1..N — tests/e2e/overworld.mjs checks it. Every world draws its random
 * numbers from a generator seeded by its own id, always the same ones in the same order, so a stop
 * placed by hand (`at`) moves that stop and nothing else.
 *
 * The trail runs east: every stop on it is east of the one before (by MIN_DX at least). That lets the
 * creek be a curve over x — its centre is the trail's height plus an offset that changes sign where it
 * crosses the trail — which makes "is this in the water" one lookup, for painting and for placing trees.
 *
 * Pure: no DOM, so the test runs it in node.
 */
import { rng } from '../core/math';
import { levelDef, spotOf, type WorldDef } from '../game/worlds';

/** How far east each stop is from the last, roughly (map units: a sprout on the map is ~30 tall). */
export const HOP = 216;
/** extra room before a world's gate */
const GATE_GAP = 44;
/** how far a side spot sits from the stop it hangs off */
const BRANCH = 150;
/** the closest two stops on the trail may be, east to west (hand placement is held to it) */
const MIN_DX = 96;
/** the creek's half-width */
export const CREEK_W = 19;
/** the creek is sampled every STEP units of x */
export const STEP = 8;
/** how far the creek runs on downstream (west) of home */
const LEAD = 1600;

/** Each kind of stop's radius: also what no other stop may come within. */
export const RADIUS = { gate: 30, level: 24, boss: 46, side: 21 } as const;
export type NodeKind = keyof typeof RADIUS;

export interface MapNode {
  i: number;
  id: string;
  world: number;
  kind: NodeKind;
  x: number;
  y: number;
  r: number;
  /** on the trail itself (not a side spot) */
  main: boolean;
  /** a level that exists (levels.ts): playable once open */
  playable: boolean;
  /** a level not built yet: shown "coming soon", walked past */
  planned: boolean;
  /** always open (the practice ground, the test course) */
  free: boolean;
  name: string;
  subtitle: string;
  /** a landmark beside it (the gate's is its world's gate landmark) */
  mark: string;
  /** which side of the trail the creek is on here: -1 north, 1 south */
  creek: number;
  /** the direction a side spot points, out from the stop it hangs off (radians) */
  ang: number;
  /** edges touching it */
  edges: number[];
}

export interface MapEdge {
  i: number;
  /** unlocking runs from a to b (a < b always); the sprouts walk it both ways */
  a: number;
  b: number;
  world: number;
  main: boolean;
  /** points along it (x, y pairs), a few units apart */
  pts: Float32Array;
  /** distance along it at each point */
  acc: Float32Array;
  len: number;
  box: [number, number, number, number];
}

/** Where the trail crosses the creek: on stepping stones, or a little bridge. */
export interface Crossing {
  x: number;
  y: number;
  /** the trail's angle there */
  ang: number;
  edge: number;
  bridge: boolean;
}

/** A landmark: anchored somewhere near its stop, with a footprint nothing else is placed in. */
export interface Mark {
  kind: string;
  node: number;
  x: number;
  y: number;
  /** which side of its stop it stands on (-1 north, 1 south), and how big its footprint is */
  side: number;
  foot: number;
}

export interface Region {
  world: number;
  def: WorldDef;
  seed: number;
  /** where this world's painting starts, and where the next one's will (whether or not it exists yet) */
  x0: number;
  x1: number;
  /** the creek, sampled every STEP from cx0: centre y and half-height (thicker where it runs steep) */
  cx0: number;
  cy: Float32Array;
  cw: Float32Array;
  /** the trail's own y at the same samples (west of home: home's) */
  ty: Float32Array;
  /** the world's stops and trail */
  box: [number, number, number, number];
  crossings: Crossing[];
  marks: Mark[];
  nodes: number[];
  edges: number[];
  gate: number;
  last: number;
  /** the creek's offset from the trail at the last stop, and the trail's heading there (for the next world) */
  lastD: number;
  lastM: [number, number];
}

export interface MapLayout {
  nodes: MapNode[];
  edges: MapEdge[];
  regions: Region[];
  byId: Map<string, number>;
}

/** FNV-1a: a world's seed, from its id — so a world looks the same wherever it sits in the list. */
export function hashStr(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const smooth = (u: number) => u * u * (3 - 2 * u);
const sgn = (v: number) => (v < 0 ? -1 : 1);
const title = (id: string) => id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Lay out these worlds, in order. */
export function layoutWorlds(defs: readonly WorldDef[]): MapLayout {
  const L: MapLayout = { nodes: [], edges: [], regions: [], byId: new Map() };
  for (let w = 0; w < defs.length; w++) layWorld(L, w, defs[w]);
  return L;
}

function addNode(L: MapLayout, n: Omit<MapNode, 'i' | 'edges'>): MapNode {
  if (L.byId.has(n.id)) throw new Error(`overworld: two stops are called "${n.id}"`);
  const node: MapNode = { ...n, i: L.nodes.length, edges: [] };
  L.nodes.push(node);
  L.byId.set(node.id, node.i);
  return node;
}

/** An edge along the cubic Bézier a → c1 → c2 → b. */
function addEdge(L: MapLayout, a: MapNode, b: MapNode, c1x: number, c1y: number, c2x: number, c2y: number, world: number, main: boolean): MapEdge {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(12, Math.ceil(chord / 5));
  const pts = new Float32Array((n + 1) * 2);
  const acc = new Float32Array(n + 1);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    const x = u * u * u * a.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * b.x;
    const y = u * u * u * a.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * b.y;
    pts[k * 2] = x;
    pts[k * 2 + 1] = y;
    acc[k] = k ? acc[k - 1] + Math.hypot(x - pts[k * 2 - 2], y - pts[k * 2 - 1]) : 0;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const e: MapEdge = { i: L.edges.length, a: a.i, b: b.i, world, main, pts, acc, len: acc[n], box: [x0, y0, x1, y1] };
  L.edges.push(e);
  a.edges.push(e.i);
  b.edges.push(e.i);
  return e;
}

/** The trail's height at x along a main edge (its points run east). */
function edgeY(e: MapEdge, x: number) {
  const p = e.pts;
  const n = p.length / 2;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid * 2] <= x) lo = mid;
    else hi = mid;
  }
  const xa = p[lo * 2];
  const xb = p[hi * 2];
  const u = xb > xa ? Math.min(1, Math.max(0, (x - xa) / (xb - xa))) : 0;
  return p[lo * 2 + 1] + (p[hi * 2 + 1] - p[lo * 2 + 1]) * u;
}

/** Distance from (x, y) to an edge's points (close enough: they are a few units apart). */
export function edgeDist(e: MapEdge, x: number, y: number) {
  const p = e.pts;
  let best = Infinity;
  for (let k = 0; k < p.length; k += 2) {
    const d = (p[k] - x) ** 2 + (p[k + 1] - y) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function layWorld(L: MapLayout, w: number, def: WorldDef) {
  const seed = hashStr(def.id);
  const r = rng(seed);
  const prev = L.regions[w - 1];
  const E = prev ? L.nodes[prev.last] : null;
  const spots = def.levels.map(spotOf);
  const mains = spots.filter((s) => !s.from);
  const sides = spots.filter((s) => s.from);
  const rise = def.rise ?? 0;
  const landmark = def.gate?.landmark ?? (w === 0 ? 'home' : 'bridge');
  const n = mains.length + 1;

  // ---- the trail's stops: where the layout puts them, then where a hand put them
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  {
    const gj = (r() * 2 - 1) * 46;
    px[0] = E ? E.x + HOP + GATE_GAP : 0;
    py[0] = E ? E.y + gj - rise * 0.5 : 0;
    const ga = def.gate?.at;
    if (ga) {
      px[0] = (E?.x ?? 0) + ga[0];
      py[0] = (E?.y ?? 0) + ga[1];
    }
    if (E) px[0] = Math.max(px[0], E.x + MIN_DX);
    let s = r() < 0.5 ? 1 : -1;
    let ax = px[0];
    let ay = py[0];
    for (let i = 1; i < n; i++) {
      const jx = (r() * 2 - 1) * 20;
      const flip = r() < 0.75;
      const amp = 28 + r() * 70;
      if (flip) s = -s;
      const boss = !!def.boss && i === n - 1;
      ax += HOP + jx + (boss ? 34 : 0);
      let dy = s * amp - rise;
      // wander, but stay within 110 of the world's own line
      const off = ay + dy - (py[0] - rise * i);
      if (off > 110) dy -= off - 110;
      else if (off < -110) dy -= off + 110;
      ay += dy;
      px[i] = ax;
      py[i] = ay;
      const at = mains[i - 1].at;
      if (at) {
        px[i] = px[0] + at[0];
        py[i] = py[0] + at[1];
      }
    }
    for (let i = 1; i < n; i++) px[i] = Math.max(px[i], px[i - 1] + MIN_DX);
  }

  // ---- the nodes on the trail
  const gate = addNode(L, {
    id: `gate:${def.id}`,
    world: w,
    kind: 'gate',
    x: px[0],
    y: py[0],
    r: RADIUS.gate,
    main: true,
    playable: false,
    planned: false,
    free: false,
    name: def.gate?.name ?? def.name,
    subtitle: def.name,
    mark: landmark,
    creek: 0,
    ang: 0,
  });
  const trail: MapNode[] = [gate];
  for (let i = 1; i < n; i++) {
    const s = mains[i - 1];
    const ld = levelDef(s.id);
    const boss = !!def.boss && i === n - 1;
    const kind: NodeKind = boss ? 'boss' : 'level';
    trail.push(
      addNode(L, {
        id: s.id,
        world: w,
        kind,
        x: px[i],
        y: py[i],
        r: RADIUS[kind],
        main: true,
        playable: !!ld,
        planned: !ld,
        free: !!s.free,
        name: ld?.name ?? s.name ?? title(s.id),
        subtitle: ld?.subtitle ?? s.subtitle ?? '',
        mark: s.mark ?? '',
        creek: 0,
        ang: 0,
      }),
    );
  }

  // ---- which bank the creek is on at each stop, and how far off
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const flipR = r();
    const distR = r();
    const node = trail[i];
    let side: number;
    if (i === 0) {
      if (!prev) side = -1;
      else if (landmark === 'bridge') side = -sgn(prev.lastD);
      else if (landmark === 'fallsfoot' || landmark === 'millrace') side = -1;
      else side = sgn(prev.lastD);
    } else side = flipR < 0.3 ? -sgn(d[i - 1]) : sgn(d[i - 1]);
    // a cascade pours into the creek from the north: the creek runs north of its stop
    if (node.mark === 'cliff') side = -1;
    const ax = i > 0 ? px[i - 1] : E ? E.x : px[0] - HOP;
    const ay = i > 0 ? py[i - 1] : E ? E.y : py[0];
    const bx = i < n - 1 ? px[i + 1] : px[i] + HOP;
    const by = i < n - 1 ? py[i + 1] : py[i];
    const slope = (by - ay) / (bx - ax);
    const pond = node.mark === 'pond' ? 66 : 0;
    const dist = node.r + 16 + CREEK_W + 28 + distR * 28 + pond;
    d[i] = side * dist * Math.sqrt(1 + slope * slope);
    node.creek = side;
  }

  // ---- the trail's heading at each stop (Catmull-Rom; level at the world's last stop, for the next world)
  const mx = new Float64Array(n);
  const my = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      mx[i] = n > 1 ? px[i] - px[i - 1] : HOP;
      my[i] = 0;
    } else {
      const p0x = i > 0 ? px[i - 1] : E ? E.x : 2 * px[0] - px[1];
      const p0y = i > 0 ? py[i - 1] : E ? E.y : 2 * py[0] - py[1];
      mx[i] = (px[i + 1] - p0x) / 2;
      my[i] = (py[i + 1] - p0y) / 2;
    }
  }

  // ---- the trail's edges: in from the world before, then stop to stop
  const hops: { e: MapEdge; da: number; db: number; bulge: number; xa: number; xb: number }[] = [];
  const edgeList: number[] = [];
  if (E && prev) {
    const e = addEdge(L, E, gate, E.x + prev.lastM[0] / 3, E.y + prev.lastM[1] / 3, gate.x - mx[0] / 3, gate.y - my[0] / 3, w, true);
    hops.push({ e, da: prev.lastD, db: d[0], bulge: 12 + r() * 46, xa: E.x, xb: gate.x });
    edgeList.push(e.i);
  }
  for (let i = 1; i < n; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    const e = addEdge(L, a, b, a.x + mx[i - 1] / 3, a.y + my[i - 1] / 3, b.x - mx[i] / 3, b.y - my[i] / 3, w, true);
    hops.push({ e, da: d[i - 1], db: d[i], bulge: 12 + r() * 46, xa: a.x, xb: b.x });
    edgeList.push(e.i);
  }

  // ---- the creek: the trail's height plus an offset that bulges away between stops, and changes sign where it crosses
  const cx0 = E ? E.x : px[0] - LEAD;
  const cx1 = px[n - 1];
  const ns = Math.max(2, Math.floor((cx1 - cx0) / STEP) + 1);
  const cy = new Float32Array(ns);
  const cw = new Float32Array(ns);
  const ty = new Float32Array(ns);
  const ponds = trail.filter((t) => t.mark === 'pond');
  const phase = (seed % 1000) / 159;
  let h = 0;
  for (let k = 0; k < ns; k++) {
    const x = cx0 + k * STEP;
    if ((!E && x < px[0]) || !hops.length) {
      const back = px[0] - x;
      cy[k] = py[0] + d[0] + 46 * Math.sin(back / 190) * smooth(Math.min(1, back / 320));
      ty[k] = py[0];
    } else {
      while (h < hops.length - 1 && x > hops[h].xb) h++;
      const hp = hops[h];
      const u = Math.min(1, Math.max(0, (x - hp.xa) / (hp.xb - hp.xa)));
      let off = hp.da + (hp.db - hp.da) * smooth(u);
      // (sin²: level where it meets a stop, so the creek bends smoothly through)
      if (sgn(hp.da) === sgn(hp.db)) off += sgn(hp.da) * hp.bulge * Math.sin(Math.PI * u) ** 2;
      ty[k] = edgeY(hp.e, x);
      cy[k] = ty[k] + off;
    }
    let wd = CREEK_W * (0.9 + 0.2 * Math.sin(x * 0.013 + phase));
    for (const p of ponds) wd += 46 * Math.exp(-(((x - p.x) / 96) ** 2));
    cw[k] = wd;
  }
  // a steep stretch is thicker from top to bottom, so it stays as wide across
  for (let k = 0; k < ns; k++) {
    const s = (cy[Math.min(ns - 1, k + 1)] - cy[Math.max(0, k - 1)]) / (2 * STEP);
    cw[k] *= Math.min(2.4, Math.sqrt(1 + s * s));
  }

  // ---- where the trail crosses the creek
  const crossings: Crossing[] = [];
  for (const hp of hops) {
    const br = r();
    if (sgn(hp.da) === sgn(hp.db)) continue;
    let lo = 0;
    let hi = 1;
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2;
      if (sgn(hp.da + (hp.db - hp.da) * smooth(mid)) === sgn(hp.da)) lo = mid;
      else hi = mid;
    }
    const x = hp.xa + (hp.xb - hp.xa) * lo;
    const y = edgeY(hp.e, x);
    const y2 = edgeY(hp.e, x + 4);
    const isGate = hp.e.b === gate.i;
    crossings.push({ x, y, ang: Math.atan2(y2 - y, 4), edge: hp.e.i, bridge: isGate ? landmark === 'bridge' : br < 0.34 });
  }

  // ---- side spots: out from their stop, away from the creek
  const cAt = (x: number) => {
    const k = Math.max(0, Math.min(ns - 1, Math.round((x - cx0) / STEP)));
    return [cy[k], cw[k]];
  };
  const prevFirst = prev ? prev.nodes[0] : 0;
  const clear = (x: number, y: number, rad: number) => {
    for (let j = prevFirst; j < L.nodes.length; j++) {
      const o = L.nodes[j];
      if (Math.hypot(o.x - x, o.y - y) < o.r + rad + 34) return false;
    }
    for (const ei of edgeList) if (edgeDist(L.edges[ei], x, y) < rad + 22) return false;
    if (x >= cx0 && x <= cx1) {
      const [yc, wc] = cAt(x);
      if (Math.abs(y - yc) < wc + rad + 16) return false;
    }
    return true;
  };
  const sideCount = new Map<number, number>();
  const sideTotal = new Map<string, number>();
  for (const s of sides) sideTotal.set(s.from!, (sideTotal.get(s.from!) ?? 0) + 1);
  const ownIds = new Set(trail.map((t) => t.id));
  for (const s of sides) {
    const pid = s.from === 'gate' || !ownIds.has(s.from!) ? gate.i : L.byId.get(s.from!)!;
    const P = L.nodes[pid];
    const k = sideCount.get(pid) ?? 0;
    sideCount.set(pid, k + 1);
    const tot = sideTotal.get(s.from!) ?? 1;
    let ang: number;
    if (P.main) {
      const ti = trail.indexOf(P);
      const hx = mx[ti];
      const hy = my[ti];
      const away = -P.creek;
      // perpendicular to the trail, on the dry side; leaning back west, out of the next stop's way
      ang = Math.atan2(away * hx, -away * hy) + away * 0.32;
    } else ang = P.ang;
    ang += (k - (tot - 1) / 2) * 0.8;
    const ld = levelDef(s.id);
    const kind: NodeKind = s.free ? 'side' : 'level';
    const rad = RADIUS[kind];
    let x = P.x + Math.cos(ang) * BRANCH;
    let y = P.y + Math.sin(ang) * BRANCH;
    for (let tries = 0; tries < 14 && !clear(x, y, rad); tries++) {
      ang += (tries % 2 ? -1 : 1) * 0.3 * (tries + 1);
      const reach = BRANCH + (tries >> 2) * 30;
      x = P.x + Math.cos(ang) * reach;
      y = P.y + Math.sin(ang) * reach;
    }
    if (s.at) {
      x = gate.x + s.at[0];
      y = gate.y + s.at[1];
    }
    const node = addNode(L, {
      id: s.id,
      world: w,
      kind,
      x,
      y,
      r: rad,
      main: false,
      playable: !!ld,
      planned: !ld,
      free: !!s.free,
      name: ld?.name ?? s.name ?? title(s.id),
      subtitle: ld?.subtitle ?? s.subtitle ?? '',
      mark: s.mark ?? '',
      creek: P.creek,
      ang,
    });
    // a gentle curve out to it
    const dx = x - P.x;
    const dy = y - P.y;
    const e = addEdge(L, P, node, P.x + dx * 0.33 - dy * 0.12, P.y + dy * 0.33 + dx * 0.12, P.x + dx * 0.7 - dy * 0.08, P.y + dy * 0.7 + dx * 0.08, w, false);
    edgeList.push(e.i);
    ownIds.add(node.id);
  }

  // ---- landmarks, by their stops
  const marks: Mark[] = [];
  const FOOT: Record<string, number> = { home: 62, millrace: 96, fallsfoot: 150, hollowtree: 74, barn: 96, den: 62, nest: 64, cliff: 84 };
  const nodesNow = L.nodes.slice(gate.i);
  const fits = (x: number, y: number, foot: number) => {
    for (const o of nodesNow) if (Math.hypot(o.x - x, o.y - y) < o.r + foot * 0.8 + 8) return false;
    for (const ei of edgeList) if (edgeDist(L.edges[ei], x, y) < foot * 0.75 + 10) return false;
    if (x >= cx0 && x <= cx1) {
      const [yc, wc] = cAt(x);
      if (Math.abs(y - yc) < wc + foot * 0.6) return false;
    }
    return true;
  };
  /** tall landmarks stand behind their stop (north), never in front of it, where they'd hide it */
  const TALL_MARK: Record<string, boolean> = { hollowtree: true, nest: true };
  for (const node of trail) {
    const kind = node.mark;
    if (!kind) continue;
    const foot = FOOT[kind] ?? 0;
    const away = -node.creek;
    if (kind === 'millrace' || kind === 'fallsfoot' || kind === 'cliff') {
      // across the creek: the mill stands on the far bank, its wheel in the water; the falls pour in
      const x = node.x + (kind === 'millrace' ? 44 : kind === 'cliff' ? 52 : -10);
      const [yc, wc] = cAt(x);
      marks.push({ kind, node: node.i, x, y: yc + node.creek * wc, side: node.creek, foot });
      continue;
    }
    if (!foot) {
      marks.push({ kind, node: node.i, x: node.x, y: node.y, side: node.creek, foot: 0 });
      continue;
    }
    // on the dry side: straight out, else turning round the stop until it fits
    const tall = !!TALL_MARK[kind];
    const base = kind === 'home' ? Math.PI : tall ? -Math.PI / 2 : Math.atan2(away, 0);
    const dist = node.r + foot * 0.85 + 18;
    let best: [number, number] | null = null;
    for (let k = 0; k < 9 && !best; k++) {
      const turn = Math.ceil(k / 2) * (tall ? 0.36 : 0.42);
      const a = base + (k % 2 ? -1 : 1) * turn;
      const x = node.x + Math.cos(a) * dist;
      const y = node.y + Math.sin(a) * dist;
      if (fits(x, y, foot)) best = [x, y];
    }
    if (!best) best = [node.x + Math.cos(base) * dist, node.y + Math.sin(base) * dist];
    marks.push({ kind, node: node.i, x: best[0], y: best[1], side: away, foot });
  }

  // ---- the world's box, and where it is painted
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (let j = gate.i; j < L.nodes.length; j++) {
    const o = L.nodes[j];
    bx0 = Math.min(bx0, o.x - o.r);
    by0 = Math.min(by0, o.y - o.r);
    bx1 = Math.max(bx1, o.x + o.r);
    by1 = Math.max(by1, o.y + o.r);
  }
  for (const ei of edgeList) {
    const b = L.edges[ei].box;
    bx0 = Math.min(bx0, b[0]);
    by0 = Math.min(by0, b[1]);
    bx1 = Math.max(bx1, b[2]);
    by1 = Math.max(by1, b[3]);
  }
  const last = trail[n - 1];
  L.regions.push({
    world: w,
    def,
    seed,
    x0: E ? (E.x + gate.x) / 2 : -Infinity,
    x1: last.x + (HOP + GATE_GAP) / 2,
    cx0,
    cy,
    cw,
    ty,
    box: [bx0, by0, bx1, by1],
    crossings,
    marks,
    nodes: L.nodes.slice(gate.i).map((o) => o.i),
    edges: edgeList,
    gate: gate.i,
    last: last.i,
    lastD: d[n - 1],
    lastM: [mx[n - 1], my[n - 1]],
  });
}

/** The region painted at x (by its painting range). */
export function regionAt(L: MapLayout, x: number): number {
  const R = L.regions;
  let lo = 0;
  let hi = R.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (R[mid].x0 <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The creek at x: its centre's y and its half-height there, into `out`. Past the last world it runs
 * on east, level, into the mist.
 */
export function creekAt(L: MapLayout, x: number, out: [number, number] = [0, 0]): [number, number] {
  const R = L.regions;
  let lo = 0;
  let hi = R.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (R[mid].cx0 <= x) lo = mid;
    else hi = mid - 1;
  }
  const g = R[lo];
  const f = (x - g.cx0) / STEP;
  const n = g.cy.length;
  if (f <= 0) {
    out[0] = g.cy[0];
    out[1] = g.cw[0];
  } else if (f >= n - 1) {
    const end = x - (g.cx0 + (n - 1) * STEP);
    out[0] = g.cy[n - 1] + 40 * Math.sin(end / 170) * smooth(Math.min(1, end / 300));
    out[1] = CREEK_W;
  } else {
    const k = Math.floor(f);
    const u = f - k;
    out[0] = g.cy[k] + (g.cy[k + 1] - g.cy[k]) * u;
    out[1] = g.cw[k] + (g.cw[k + 1] - g.cw[k]) * u;
  }
  return out;
}

// ------------------------------------------------------------------ progress

/** What the save says, by level id: all the map needs to know. */
export interface MapProgress {
  /** levels finished at least once */
  cleared: ReadonlySet<string>;
  /**
   * Stops that open the way on as if cleared, without being cleared: an older journal's count of
   * levels unlocked, so nobody loses a level that was open to them (see overworld/progress.ts).
   */
  passed?: ReadonlySet<string>;
  /** fireflies found, as a bitmask of 3 */
  fireflies?: Readonly<Record<string, number>>;
  /** best time, seconds */
  best?: Readonly<Record<string, number>>;
  /** a run in progress: the lantern to continue from (-1 = the start) */
  lantern?: Readonly<Record<string, number>>;
  /** …and who it was played with */
  with?: Readonly<Record<string, string>>;
}

export const LOCKED = 0;
export const OPEN = 1;
export const CLEARED = 2;

export interface MapState {
  /** per node: LOCKED, OPEN or CLEARED (a planned level, reached, is OPEN) */
  node: Uint8Array;
  /** per edge: 1 when the sprouts may walk it */
  edge: Uint8Array;
}

/**
 * Who's open. The first world's gate is; past any stop that's cleared (or only planned, or a gate),
 * every edge out of it opens, and so does the stop at its end. Edges run from lower to higher node
 * index, so one pass in order settles everything.
 */
export function mapState(L: MapLayout, P: MapProgress): MapState {
  const node = new Uint8Array(L.nodes.length);
  const edge = new Uint8Array(L.edges.length);
  if (!L.nodes.length) return { node, edge };
  /**
   * The furthest stop along the trail the pair has got to. Everything on the trail behind it they
   * have already walked, whether or not each one is cleared — so a level added to the MIDDLE of a
   * world opens in front of them without shutting away the rest of the map behind it. Without this,
   * World 1 growing from two stops to five would have taken the mill, the cascades and the falls
   * back off anyone who had already finished them. (Node order is trail order: see MapLayout.)
   */
  let behind = -1;
  for (const nd of L.nodes) if (nd.main && (P.cleared.has(nd.id) || P.passed?.has(nd.id))) behind = nd.i;
  const reached = new Uint8Array(L.nodes.length);
  reached[0] = 1;
  for (const nd of L.nodes) {
    if (!reached[nd.i]) continue;
    const done = P.cleared.has(nd.id);
    node[nd.i] = done && nd.playable ? CLEARED : OPEN;
    const passed = done || nd.planned || nd.kind === 'gate' || !!P.passed?.has(nd.id) || (nd.main && nd.i < behind);
    if (!passed) continue;
    for (const ei of nd.edges) {
      const e = L.edges[ei];
      if (e.a !== nd.i) continue;
      edge[ei] = 1;
      reached[e.b] = 1;
    }
  }
  return { node, edge };
}

/**
 * The walk from `from` to `to` along open edges, shortest first: the edges in order, each with the
 * direction it's walked (+1 a→b, -1 b→a). Null when there's no way there.
 */
export function route(L: MapLayout, S: MapState, from: number, to: number): { e: number; dir: number }[] | null {
  if (from === to) return [];
  const dist = new Float64Array(L.nodes.length).fill(Infinity);
  const via = new Int32Array(L.nodes.length).fill(-1);
  const done = new Uint8Array(L.nodes.length);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) return null;
    if (u === to) break;
    done[u] = 1;
    for (const ei of L.nodes[u].edges) {
      if (!S.edge[ei]) continue;
      const e = L.edges[ei];
      const v = e.a === u ? e.b : e.a;
      if (dist[u] + e.len < dist[v]) {
        dist[v] = dist[u] + e.len;
        via[v] = ei;
      }
    }
  }
  const out: { e: number; dir: number }[] = [];
  for (let v = to; v !== from; ) {
    const e = L.edges[via[v]];
    const u = e.a === v ? e.b : e.a;
    out.unshift({ e: e.i, dir: e.a === u ? 1 : -1 });
    v = u;
  }
  return out;
}
