/**
 * The overworld map: the two sprouts on the trail, walking stop to stop, Mario-World style.
 *
 *   The stick or d-pad walks to the stop the path leaves toward in that direction, and stops there.
 *   Hold it to keep going; press during a walk and the press waits for the next stop. A tap (or click)
 *   on a stop walks there along open paths; a tap on the stop you're on is Ⓐ. Ⓐ on a level zooms in
 *   and says 'enter'; on a gate it says 'story' (the storybook card).
 *   The camera follows, looking ahead, and stays over the part of the map you've opened.
 *   Clearing a level (setProgress, animated) opens a bloom on its stone and grows the newly opened
 *   paths in as vines, about a second each.
 *
 * The host (the preview page now; a menu screen later) owns the canvas, the input and the save. It
 * calls update() and draw() every frame, and listens for events.
 */
import { clamp, damp } from '../core/math';
import { Bird, BIRD_COLORS } from '../game/bird';
import type { Kind } from '../game/traits';
import { WORLDS, type WorldDef } from '../game/worlds';
import { drawBubble, drawRope, glow } from '../render/art';
import { canvasEpoch } from '../render/renderer';
import { drawSprout, sproutTop } from '../render/sprouts';
import { CHUNK, ChunkCache } from './chunks';
import { bloom, bud } from './decor';
import { CLEARED, layoutWorlds, LOCKED, mapState, OPEN, route, type MapLayout, type MapNode, type MapProgress, type MapState } from './layout';
import { BLOOM_AT, MapPainter, MIST_IN, MIST_OUT, pointAt, standAt } from './paint';
import { viewUnits } from './view';

export interface MapInput {
  /**
   * The direction held now (stick, d-pad, keys), each -1..1 — or, on a frame with a press, the
   * direction pressed (a quick tap can be let go again before the frame reads it).
   */
  x: number;
  y: number;
  /** a direction was pressed this frame (not just still held) */
  pressed: boolean;
  /** Ⓐ pressed this frame */
  a: boolean;
}

export interface NodeInfo {
  id: string;
  kind: MapNode['kind'];
  world: string;
  worldNo: number;
  name: string;
  subtitle: string;
  /** 'soon': a level not built yet */
  state: 'open' | 'cleared' | 'soon' | 'locked';
  playable: boolean;
  /** fireflies found (of 3), best time (s, 0 = none), the lantern a saved run continues from (null = none) */
  fireflies: number;
  best: number;
  lantern: number | null;
  /** who that run was played with */
  with?: string;
  boss?: { name: string; line: string };
  /** a gate with a storybook */
  story: boolean;
}

export type MapEvent =
  | { type: 'enter'; id: string }
  | { type: 'story'; world: number; pages: string[] }
  | { type: 'focus'; info: NodeInfo | null }
  | { type: 'blocked'; id: string }
  /** the pair set off from one stop for the next (online, the host tells the guest) */
  | { type: 'hop'; from: string; to: string }
  /** the pair stopped on a stop */
  | { type: 'arrive'; id: string }
  /** Ⓐ on a level: the zoom into it starts ('enter' follows when it closes) */
  | { type: 'zoom'; id: string };

export interface MapOptions {
  worlds?: readonly WorldDef[];
  progress: MapProgress;
  /** the stop to start on (default: the furthest open level not cleared yet, else home) */
  at?: string;
  /** BIRD_COLORS indices, kinds and hats for player 1's sprout and player 2's */
  colors?: [number, number];
  kinds?: [Kind, Kind];
  hats?: [string, string];
  onEvent?: (e: MapEvent) => void;
  /** this player walks the pair (false: online, the guest — the pair follows the host's, see mirror) */
  lead?: boolean;
}

/** the sprouts' size on the map (× their size in a level) */
const SPROUT = 0.68;
/** the second sprout walks this far behind the first, along the trail (map units) */
const GAP = 28;
/** a hop from stop to stop takes about this long (s), whatever its length */
const HOP_MIN = 0.28;
const HOP_MAX = 0.4;
const HOP_SPEED = 620;
/** the zoom into a level, and back out */
const ENTER = 0.4;
/**
 * Holding a direction carries the pair on past a stop only once it has been held this long (game time)
 * and over this many frames: a quick press is one hop, and so is a press that happens to stay down
 * across one slow frame (a third of a second on a software renderer).
 */
const HOLD_MIN = 0.25;
const HOLD_FRAMES = 3;
const VINE_SPEED = 260;
const P: [number, number] = [0, 0];

interface Hop {
  e: number;
  /** +1 walking a → b, -1 b → a */
  dir: number;
}

interface Grow {
  e: number;
  start: number;
  dur: number;
  /** the stop at its far end, shown locked until the vine gets there */
  to: number;
  /** -1 growing, then the time it finished (it fades once its chunks are painted again) */
  done: number;
}

const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const back = (u: number) => {
  const c = 2.2;
  return u >= 1 ? 1 : 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
};
const bits = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);

export class OverworldMap {
  readonly L: MapLayout;
  state: MapState;
  progress: MapProgress;
  readonly painter: MapPainter;
  readonly chunks: ChunkCache<HTMLCanvasElement>;
  /** the stop the sprouts are on (or last left) */
  cur: number;
  private walk: { hops: Hop[]; i: number; s: number; route: boolean } | null = null;
  private queued: [number, number] | null = null;
  private held: [number, number] = [0, 0];
  private cameFrom = -1;
  readonly cam = { x: 0, y: 0 };
  private explored: [number, number, number, number] = [0, 0, 0, 0];
  private readonly birds: [Bird, Bird] = [new Bird(0), new Bird(1)];
  private readonly feet: [number, number][] = [
    [0, 0],
    [0, 0],
  ];
  /** where the first sprout has been: the second one walks it after */
  private crumbs: number[] = [];
  private grows: Grow[] = [];
  private pops: { n: number; t: number; bloom: boolean }[] = [];
  private shakeT = 0;
  /** entering a level: 0..ENTER closing in, then held; leaving: counting back down */
  private enterT = -1;
  private enterDir = 0;
  private entered = false;
  private enterNode = -1;
  private readonly byX: number[];
  private readonly emit: (e: MapEvent) => void;
  private lastInfo = '';
  private colors: [number, number];
  private hats: [string, string];
  private readonly lead: boolean;
  /** how long (game time, and frames) the current direction has been held */
  private holdT = 0;
  private holdFrames = 0;
  t = 0;
  /** the last frame's view, for taps: device px per map unit, the view's corner, the pixel ratio */
  private kd = 1;
  private ox = 0;
  private oy = 0;
  private dpr = 1;
  private viewW = 1000;
  readonly stats = { drawMs: 0, nodes: 0, chunks: 0, parts: [0, 0, 0, 0] };
  private epoch = canvasEpoch;

  constructor(o: MapOptions) {
    this.L = layoutWorlds(o.worlds ?? WORLDS);
    this.progress = o.progress;
    this.state = mapState(this.L, o.progress);
    this.painter = new MapPainter(this.L, this.state);
    this.chunks = new ChunkCache(this.painter);
    this.emit = o.onEvent ?? (() => undefined);
    this.colors = o.colors ?? [0, 1];
    this.hats = o.hats ?? ['none', 'none'];
    this.lead = o.lead ?? true;
    const kinds = o.kinds ?? ['tall', 'small'];
    this.birds.forEach((b, i) => b.setKind(kinds[i]));
    this.byX = this.L.nodes.map((n) => n.i).sort((a, b) => this.L.nodes[a].x - this.L.nodes[b].x);
    let start = o.at !== undefined ? this.L.byId.get(o.at) ?? -1 : -1;
    if (start < 0 || this.state.node[start] === LOCKED) {
      start = 0;
      for (const n of this.L.nodes) if (n.playable && n.main && this.state.node[n.i] === OPEN) start = n.i;
    }
    this.cur = start;
    this.place();
    this.findExplored();
    const [sx, sy] = standAt(this.L.nodes[this.cur]);
    this.cam.x = sx;
    this.cam.y = sy;
  }

  // ------------------------------------------------------------------ progress

  /**
   * The save changed. Animated: a level just cleared opens its bloom, then the paths it opened grow in
   * as vines, one after another along the trail; each stop they reach pops up as they get there.
   */
  setProgress(p: MapProgress, animate = true) {
    const before = this.state;
    const after = mapState(this.L, p);
    this.progress = p;
    this.state = after;
    this.painter.state = after;
    const P = this.painter;
    // (the sprouts can't be left on a stop that's locked now: back home)
    if (after.node[this.cur] === LOCKED) {
      this.walk = null;
      this.cur = 0;
      this.place();
    }
    if (!animate) {
      // paint again what changed (and what was held back for an animation), a couple of chunks a frame
      for (const i of [...P.holdNodes.keys()]) this.repaintNode(i);
      for (const i of [...P.holdEdges.keys()]) this.repaintEdge(i);
      P.holdEdges.clear();
      P.holdNodes.clear();
      this.grows = [];
      this.pops = [];
      for (const n of this.L.nodes) if (before.node[n.i] !== after.node[n.i]) this.repaintNode(n.i);
      for (const e of this.L.edges) if (before.edge[e.i] !== after.edge[e.i]) this.repaintEdge(e.i);
      this.findExplored();
      return;
    }
    // what changed, and when each vine starts: after the one that reached its stop
    const ready = new Map<number, number>();
    for (const n of this.L.nodes) {
      const was = before.node[n.i];
      const is = after.node[n.i];
      if (was === is) continue;
      if (is === CLEARED) {
        P.holdNodes.set(n.i, was);
        this.pops.push({ n: n.i, t: this.t, bloom: true });
        ready.set(n.i, this.t + 0.45);
      }
    }
    for (const e of this.L.edges) {
      if (before.edge[e.i] || !after.edge[e.i]) continue;
      const start = ready.get(e.a) ?? this.t + 0.2;
      const dur = clamp(e.len / VINE_SPEED, 0.55, 1.0);
      P.holdEdges.set(e.i, 0);
      if (before.node[e.b] === LOCKED) P.holdNodes.set(e.b, LOCKED);
      this.grows.push({ e: e.i, start, dur, to: e.b, done: -1 });
      if (!ready.has(e.b)) ready.set(e.b, start + dur);
    }
    // anything else that changed (no animation for it): paint it again
    for (const n of this.L.nodes) if (before.node[n.i] !== after.node[n.i] && !P.holdNodes.has(n.i)) this.repaintNode(n.i);
    this.findExplored();
  }

  private repaintNode(i: number) {
    const b = this.painter.nodeBox(this.L.nodes[i]);
    this.chunks.invalidate(b[0], b[1], b[2], b[3]);
  }

  private repaintEdge(i: number) {
    const b = this.L.edges[i].box;
    this.chunks.invalidate(b[0] - 12, b[1] - 12, b[2] + 12, b[3] + 12);
  }

  /** Let go of the painted map (leaving the map for a level); it paints itself again when drawn. */
  release() {
    this.chunks.clear();
  }

  /** The part of the map opened so far: every stop reached, and the ones just past them. */
  private findExplored() {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const take = (n: MapNode) => {
      x0 = Math.min(x0, n.x - n.r);
      y0 = Math.min(y0, n.y - n.r - (n.kind === 'boss' ? 70 : 30));
      x1 = Math.max(x1, n.x + n.r);
      y1 = Math.max(y1, n.y + n.r);
    };
    for (const n of this.L.nodes) {
      if (this.state.node[n.i] === LOCKED) continue;
      take(n);
      for (const ei of n.edges) {
        const e = this.L.edges[ei];
        take(this.L.nodes[e.a === n.i ? e.b : e.a]);
      }
    }
    this.explored = [x0 - 170, y0 - 150, x1 + 170, y1 + 130];
    // the mist starts past the last stop opened: paint the chunks it moved over again
    const P = this.painter;
    const mist = x1 + 110;
    if (mist !== P.mistX) {
      const lo = Math.min(mist, Number.isFinite(P.mistX) ? P.mistX : mist) - MIST_IN - 8;
      const hi = Math.max(mist, Number.isFinite(P.mistX) ? P.mistX : mist) + MIST_OUT + 8;
      P.mistX = mist;
      this.chunks.invalidate(lo, -1e9, hi, 1e9);
    }
  }

  // ------------------------------------------------------------------ walking

  /** Put the sprouts on the current stop, side by side. */
  private place() {
    const [x, y] = standAt(this.L.nodes[this.cur]);
    this.feet[0] = [x - 2, y];
    this.feet[1] = [x - 21, y];
    this.crumbs = [x - 21, y, x - 2, y];
  }

  private hopAt(h: Hop) {
    const e = this.L.edges[h.e];
    return { e, from: this.L.nodes[h.dir > 0 ? e.a : e.b], to: this.L.nodes[h.dir > 0 ? e.b : e.a] };
  }

  /** The open path from the current stop that best goes (dx, dy) — not `skip` — or null; `blocked`: one goes that way but is locked. */
  private pick(dx: number, dy: number, skip: number): { hop: Hop | null; blocked: boolean } {
    const n = this.L.nodes[this.cur];
    const dl = Math.hypot(dx, dy) || 1;
    let best: Hop | null = null;
    let bestScore = 0.4;
    let blocked = false;
    for (const ei of n.edges) {
      if (ei === skip) continue;
      const e = this.L.edges[ei];
      const dir = e.a === n.i ? 1 : -1;
      const probe = Math.min(56, e.len * 0.45);
      pointAt(e, dir > 0 ? probe : e.len - probe, P);
      const far = this.L.nodes[dir > 0 ? e.b : e.a];
      const px = P[0] - n.x;
      const py = P[1] - n.y;
      const pl = Math.hypot(px, py) || 1;
      const fx = far.x - n.x;
      const fy = far.y - n.y;
      const fl = Math.hypot(fx, fy) || 1;
      const vx = (px / pl) * 0.6 + (fx / fl) * 0.4;
      const vy = (py / pl) * 0.6 + (fy / fl) * 0.4;
      const score = (vx * dx + vy * dy) / ((Math.hypot(vx, vy) || 1) * dl);
      if (score <= bestScore) continue;
      if (!this.state.edge[ei]) {
        blocked = true;
        continue;
      }
      bestScore = score;
      best = { e: ei, dir };
    }
    return { hop: best, blocked: blocked && !best };
  }

  private start(hops: Hop[], viaRoute: boolean) {
    if (!hops.length) return;
    // the second sprout sets off from where it stands
    const f = this.feet[1];
    const l = this.feet[0];
    this.crumbs = [f[0], f[1], l[0], l[1]];
    this.walk = { hops, i: 0, s: 0, route: viaRoute };
    this.queued = null;
    this.hopped(hops[0]);
    this.focus();
  }

  private hopped(h: Hop) {
    const { from, to } = this.hopAt(h);
    this.emit({ type: 'hop', from: from.id, to: to.id });
  }

  /** Go one stop (dx, dy) from here, if a path goes that way. */
  private go(dx: number, dy: number, skip = -1) {
    const { hop, blocked } = this.pick(dx, dy, skip);
    if (hop) this.start([hop], false);
    else if (blocked) this.nope(this.L.nodes[this.cur].id);
    return !!hop;
  }

  private nope(id: string) {
    this.shakeT = 0.35;
    this.emit({ type: 'blocked', id });
  }

  /** Ⓐ: on a level, go in; on a gate, the story; on a stop still to come, a shake of the head. */
  act() {
    if (this.walk || this.enterT >= 0) return;
    const n = this.L.nodes[this.cur];
    const g = this.L.regions[n.world].def;
    // (the storybook is anyone's to read; the levels are the leader's to go into)
    if (n.kind === 'gate') {
      if (g.story?.length) this.emit({ type: 'story', world: n.world, pages: g.story });
      return;
    }
    if (!this.lead) return;
    if (n.playable && this.state.node[n.i] !== LOCKED) {
      this.emit({ type: 'zoom', id: n.id });
      this.enterT = 0;
      this.enterDir = 1;
      this.entered = false;
      this.enterNode = n.i;
      this.focus();
      return;
    }
    this.nope(n.id);
  }

  /** Back out of the zoom (the level was left, or in the preview, after a moment). */
  reopen() {
    if (this.enterT < 0) return;
    this.enterDir = -1;
  }

  /** A tap or click at (x, y), CSS pixels from the canvas's corner. */
  tap(x: number, y: number) {
    if (this.enterT >= 0 || !this.lead) return;
    const mx = (x * this.dpr + this.ox) / this.kd;
    const my = (y * this.dpr + this.oy) / this.kd;
    let best = -1;
    let bd = Infinity;
    for (const i of this.nodesIn(mx - 90, mx + 90)) {
      const n = this.L.nodes[i];
      const d = Math.hypot(n.x - mx, (n.y - my) * 1.25 - (n.kind === 'boss' ? -20 : 0));
      if (d < n.r + 18 && d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return;
    if (!this.walk && best === this.cur) return this.act();
    if (this.walk) {
      // finish this hop, then route on from where it lands
      const h = this.walk.hops[this.walk.i];
      const to = this.hopAt(h).to.i;
      const way = route(this.L, this.state, to, best);
      if (way) this.walk.hops = [...this.walk.hops.slice(0, this.walk.i + 1), ...way];
      this.walk.route = true;
      return;
    }
    const way = route(this.L, this.state, this.cur, best);
    if (way) this.start(way, true);
    else this.nope(this.L.nodes[best].id);
  }

  /**
   * Online, the guest's pair follows the host's: it set off from `at` toward `to` (the same stop: it
   * stands there). Out of step (a message lost, a late join) it's put on `at` first, then walks on.
   */
  mirror(at: string, to: string) {
    const a = this.L.byId.get(at);
    const b = this.L.byId.get(to);
    if (a === undefined || b === undefined || this.enterT >= 0) return;
    if (this.walk) {
      // still on the last hop: finish it there, at once
      this.cur = this.hopAt(this.walk.hops[this.walk.hops.length - 1]).to.i;
      this.walk = null;
      this.place();
    }
    if (this.cur !== a) {
      this.cur = a;
      this.place();
    }
    if (a === b) return;
    const e = this.L.nodes[a].edges.find((ei) => {
      const x = this.L.edges[ei];
      return (x.a === a && x.b === b) || (x.b === a && x.a === b);
    });
    if (e === undefined) {
      this.cur = b;
      this.place();
      this.focus();
      return;
    }
    this.start([{ e, dir: this.L.edges[e].a === a ? 1 : -1 }], true);
  }

  /** Put the pair on this stop (no walk): coming back from a level, continuing a run. */
  standOn(id: string) {
    const i = this.L.byId.get(id);
    if (i === undefined) return;
    this.walk = null;
    this.cur = i;
    this.place();
    const [x, y] = standAt(this.L.nodes[i]);
    this.cam.x = x;
    this.cam.y = y;
    this.focus();
  }

  /** A sprout says something: a heart, or a "hey!" (bird 0 is player 1's). */
  emote(i: 0 | 1, e: 'heart' | 'hey') {
    const b = this.birds[i];
    b.emote = e;
    b.emoteT = 2.2;
    b.squash = -0.2;
  }

  /** Who's which sprout, in which colours and hats, changed. */
  setLook(colors: [number, number], kinds: [Kind, Kind], hats: [string, string]) {
    this.colors = colors;
    this.hats = hats;
    this.birds.forEach((b, i) => {
      if (b.kind !== kinds[i]) {
        b.setKind(kinds[i]);
        const [x, y] = this.feet[i];
        b.y = y / SPROUT - b.h / 2;
        b.x = x / SPROUT;
      }
    });
  }

  /** The id of the stop the pair is on (or last left). */
  get here() {
    return this.L.nodes[this.cur].id;
  }

  /** Walk to the stop with this id along open paths (for scripts and tests). True if there's a way. */
  walkTo(id: string) {
    const to = this.L.byId.get(id);
    if (to === undefined || this.walk) return false;
    const way = route(this.L, this.state, this.cur, to);
    if (way) this.start(way, true);
    return !!way;
  }

  get walking() {
    return !!this.walk;
  }

  /** vines still growing in (or fading into their path) */
  get growing() {
    return this.grows.length;
  }

  /** zooming into a level (or back out of one) */
  get entering() {
    return this.enterT >= 0;
  }

  /** The stops whose x is in x0..x1 (they're kept sorted by x). */
  private nodesIn(x0: number, x1: number): number[] {
    const xs = this.byX;
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.L.nodes[xs[mid]].x < x0) lo = mid + 1;
      else hi = mid;
    }
    const out: number[] = [];
    for (let i = lo; i < xs.length && this.L.nodes[xs[i]].x <= x1; i++) out.push(xs[i]);
    return out;
  }

  update(dt: number, inp: MapInput) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    if (this.enterT >= 0) {
      this.enterT = clamp(this.enterT + dt * this.enterDir, 0, ENTER);
      if (this.enterDir > 0 && this.enterT >= ENTER && !this.entered) {
        this.entered = true;
        this.emit({ type: 'enter', id: this.L.nodes[this.enterNode].id });
      }
      if (this.enterDir < 0 && this.enterT <= 0) {
        this.enterT = -1;
        this.focus();
      }
    } else if (this.lead) {
      const mag = Math.hypot(inp.x, inp.y);
      const was = this.held;
      this.held = mag > 0.5 ? [Math.sign(inp.x), Math.sign(inp.y)] : [0, 0];
      if (this.held[0] !== was[0] || this.held[1] !== was[1] || inp.pressed) {
        this.holdT = 0;
        this.holdFrames = 0;
      }
      if (this.held[0] || this.held[1]) {
        this.holdT += dt;
        this.holdFrames++;
      }
      if (inp.pressed && mag > 0.5) {
        if (this.walk) this.queued = [inp.x, inp.y];
        else this.go(inp.x, inp.y);
      }
      if (inp.a && !this.walk) this.act();
    }
    this.step(dt);
    this.animate(dt);
    this.camera(dt);
    this.focus();
  }

  /** Move along the walk. */
  private step(dt: number) {
    const w = this.walk;
    if (!w) return;
    let h = w.hops[w.i];
    let { e } = this.hopAt(h);
    const dur = clamp(e.len / HOP_SPEED, HOP_MIN, HOP_MAX);
    w.s += (dt / dur) * e.len;
    while (w.s >= e.len) {
      // at a stop
      const left = w.s - e.len;
      this.cur = this.hopAt(h).to.i;
      this.cameFrom = h.e;
      w.i++;
      w.s = 0;
      if (w.i >= w.hops.length) {
        // a press made during the hop goes first, then a held direction carries on (never straight back)
        const q = this.queued;
        this.queued = null;
        const holding = (this.held[0] || this.held[1]) && this.holdT >= HOLD_MIN && this.holdFrames >= HOLD_FRAMES;
        const more = !this.lead ? null : q ? this.pick(q[0], q[1], -1).hop : holding ? this.pick(this.held[0], this.held[1], this.cameFrom).hop : null;
        if (!more) {
          this.walk = null;
          this.birds[0].squash = 0.18;
          this.emit({ type: 'arrive', id: this.L.nodes[this.cur].id });
          return;
        }
        w.hops = [more];
        w.i = 0;
      }
      h = w.hops[w.i];
      this.hopped(h);
      e = this.hopAt(h).e;
      w.s = Math.min(left, e.len * 0.5);
    }
  }

  /** Where the first sprout's feet are now: on the trail, eased between where it stands on each stop. */
  private leaderAt(out: [number, number]) {
    const w = this.walk;
    if (!w) {
      const [x, y] = standAt(this.L.nodes[this.cur]);
      out[0] = x - 2;
      out[1] = y;
      return out;
    }
    const h = w.hops[w.i];
    const { e, from, to } = this.hopAt(h);
    pointAt(e, h.dir > 0 ? w.s : e.len - w.s, out);
    const u = ease(w.s / e.len);
    const [ax, ay] = standAt(from);
    const [bx, by] = standAt(to);
    out[0] += (ax - from.x - 2) * (1 - u) + (bx - to.x - 2) * u;
    out[1] += (ay - from.y) * (1 - u) + (by - to.y) * u;
    // little hops along the way
    out[1] -= Math.abs(Math.sin((w.s / 30) * Math.PI)) * 3.2;
    return out;
  }

  private animate(dt: number) {
    const lead = this.leaderAt([0, 0]);
    const [A, B] = this.birds;
    const prev = this.feet[0];
    const vx = (lead[0] - prev[0]) / Math.max(dt, 1e-3);
    this.feet[0] = lead;
    // breadcrumbs for the second sprout
    const cr = this.crumbs;
    const lx = cr[cr.length - 2];
    const ly = cr[cr.length - 1];
    if (Math.hypot(lead[0] - lx, lead[1] - ly) > 2) {
      cr.push(lead[0], lead[1]);
      if (cr.length > 240) cr.splice(0, cr.length - 240);
    }
    const f = this.feet[1];
    let fvx = 0;
    if (this.walk) {
      // GAP back along the crumbs
      let need = GAP;
      let px = lead[0];
      let py = lead[1];
      let tx = px;
      let ty = py;
      for (let i = cr.length - 2; i >= 0; i -= 2) {
        const d = Math.hypot(cr[i] - px, cr[i + 1] - py);
        if (d >= need) {
          const u = need / (d || 1);
          tx = px + (cr[i] - px) * u;
          ty = py + (cr[i + 1] - py) * u;
          need = 0;
          break;
        }
        need -= d;
        px = cr[i];
        py = cr[i + 1];
        tx = px;
        ty = py;
      }
      fvx = (tx - f[0]) / Math.max(dt, 1e-3);
      this.feet[1] = [tx, ty];
    } else {
      // beside the first, on the side it came from
      const side = f[0] < lead[0] ? -1 : 1;
      const tx = lead[0] + side * 19;
      const ty = lead[1];
      const k = damp(12, dt);
      fvx = ((tx - f[0]) * k) / Math.max(dt, 1e-3);
      this.feet[1] = [f[0] + (tx - f[0]) * k, f[1] + (ty - f[1]) * k];
    }
    const moving = [Math.abs(vx) > 4 || (this.walk !== null), Math.abs(fvx) > 4];
    const look = [this.feet[1], this.feet[0]];
    [A, B].forEach((b, i) => {
      const [x, y] = this.feet[i];
      b.x = x / SPROUT;
      b.y = y / SPROUT - b.h / 2;
      b.grounded = true;
      b.vx = moving[i] ? 260 * Math.sign((i ? fvx : vx) || 1) : 0;
      if (moving[i] && Math.abs(i ? fvx : vx) > 4) b.facing = (i ? fvx : vx) > 0 ? 1 : -1;
      else if (!this.walk) b.facing = look[i][0] > x ? 1 : -1;
      b.animate(dt, { x: look[i][0] / SPROUT, y: look[i][1] / SPROUT - b.h / 2 });
    });
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      A.squash = Math.sin(this.shakeT * 40) * 0.08;
    }
  }

  private camera(dt: number) {
    const lead = this.feet[0];
    let tx = lead[0];
    let ty = lead[1] - 20;
    const w = this.walk;
    if (w) {
      const to = this.hopAt(w.hops[w.hops.length - 1]).to;
      const dx = to.x - lead[0];
      const dy = to.y - lead[1];
      const d = Math.hypot(dx, dy) || 1;
      const ahead = Math.min(this.viewW * 0.16, 160, d);
      tx += (dx / d) * ahead;
      ty += (dy / d) * ahead * 0.6;
    } else tx += 30;
    if (this.enterT >= 0) {
      const n = this.L.nodes[this.enterNode];
      tx = n.x;
      ty = n.y - 12;
    }
    const k = damp(this.enterT >= 0 ? 10 : 4.5, dt);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  }

  /** Clamp the camera to the explored part of the map, for a view vw × vh map units. */
  private clampCam(vw: number, vh: number) {
    const [x0, y0, x1, y1] = this.explored;
    if (x1 - x0 <= vw) this.cam.x = (x0 + x1) / 2;
    else this.cam.x = clamp(this.cam.x, x0 + vw / 2, x1 - vw / 2);
    if (y1 - y0 <= vh) this.cam.y = (y0 + y1) / 2;
    else this.cam.y = clamp(this.cam.y, y0 + vh / 2, y1 - vh / 2);
  }

  // ------------------------------------------------------------------ the card

  /** What the card should say: the stop the sprouts stand on (null while walking or zooming in). */
  info(): NodeInfo | null {
    if (this.walk || this.enterT >= 0) return null;
    const n = this.L.nodes[this.cur];
    const st = this.state.node[n.i];
    const def = this.L.regions[n.world].def;
    const p = this.progress;
    const lantern = p.lantern?.[n.id];
    return {
      id: n.id,
      kind: n.kind,
      world: def.name,
      worldNo: n.world + 1,
      name: n.name,
      subtitle: n.kind === 'gate' ? def.name : n.subtitle,
      state: n.planned ? 'soon' : st === CLEARED ? 'cleared' : st === OPEN ? 'open' : 'locked',
      playable: n.playable && st !== LOCKED,
      fireflies: bits(p.fireflies?.[n.id] ?? 0),
      best: p.best?.[n.id] ?? 0,
      lantern: lantern === undefined ? null : lantern,
      with: p.with?.[n.id] || undefined,
      boss: n.kind === 'boss' && def.boss ? { name: def.boss.name, line: def.boss.line } : undefined,
      story: n.kind === 'gate' && !!def.story?.length,
    };
  }

  private focus() {
    const info = this.info();
    const key = info ? JSON.stringify(info) : '';
    if (key === this.lastInfo) return;
    this.lastInfo = key;
    this.emit({ type: 'focus', info });
  }

  // ------------------------------------------------------------------ drawing

  /**
   * Draw a frame: W × H device pixels, `dpr` of them to a CSS pixel. The chunks under the view, then
   * what moves — vines growing, fireflies, the sprouts — then the mist over what's still to come.
   */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number) {
    const t0 = performance.now();
    const t = this.t;
    // the GPU let go of every canvas's pixels (a lost context, restored): paint the map again
    if (this.epoch !== canvasEpoch) {
      this.epoch = canvasEpoch;
      this.chunks.clear();
    }
    const units = viewUnits(W / dpr, H / dpr);
    const k = H / units;
    const zoom = this.enterT >= 0 ? 1 + 1.5 * ease(this.enterT / ENTER) : 1;
    const kd = k * zoom;
    const vw = W / kd;
    const vh = H / kd;
    this.viewW = W / k;
    if (this.enterT < 0) this.clampCam(W / k, H / k);
    const ox = Math.round((this.cam.x - vw / 2) * kd);
    const oy = Math.round((this.cam.y - vh / 2) * kd);
    this.kd = kd;
    this.ox = ox;
    this.oy = oy;
    this.dpr = dpr;
    const vx0 = ox / kd;
    const vy0 = oy / kd;
    // the painted map
    const px = Math.round(CHUNK * Math.min(k, 2.6));
    let hx = 0;
    let hy = 0;
    if (this.walk) {
      const to = this.hopAt(this.walk.hops[this.walk.i]).to;
      hx = Math.sign(to.x - this.feet[0][0]);
      hy = Math.sign(to.y - this.feet[0][1]) * 0.5;
    }
    const vis = this.chunks.view(vx0, vy0, vx0 + vw, vy0 + vh, px, hx, hy);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    const t1 = performance.now();
    const D = CHUNK * kd;
    for (const c of vis) {
      const x = Math.round(c.cx * D - ox);
      const y = Math.round(c.cy * D - oy);
      const w = Math.round((c.cx + 1) * D - ox) - x;
      const h = Math.round((c.cy + 1) * D - oy) - y;
      if (w === c.px && h === c.px) ctx.drawImage(c.c, x, y);
      else ctx.drawImage(c.c, x, y, w, h);
    }
    const t2 = performance.now();
    // what moves, in map units
    ctx.setTransform(kd, 0, 0, kd, -ox, -oy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this.drawGrows(ctx, t);
    const nodes = this.nodesIn(vx0 - 60, vx0 + vw + 60);
    this.stats.nodes = nodes.length;
    for (const i of nodes) this.drawNodeLife(ctx, this.L.nodes[i], t);
    const t3 = performance.now();
    this.drawSprouts(ctx, kd, ox, oy, t);
    const t4 = performance.now();
    // the zoom into a level closes in to a circle round it
    if (this.enterT >= 0) {
      const u = ease(this.enterT / ENTER);
      const n = this.L.nodes[this.enterNode];
      const cx = n.x * kd - ox;
      const cy = (n.y - 12) * kd - oy;
      const r = Math.hypot(W, H) * (1 - u) + 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#1d2b4a';
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
      ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.stats.chunks = vis.length;
    this.stats.drawMs = performance.now() - t0;
    const pt = this.stats.parts;
    pt[0] = t1 - t0;
    pt[1] = t2 - t1;
    pt[2] = t3 - t2;
    pt[3] = t4 - t3;
  }

  /** Vines growing along newly opened paths; a pop where one reaches a stop; then they fade into the path. */
  private drawGrows(ctx: CanvasRenderingContext2D, t: number) {
    const P2: [number, number] = [0, 0];
    for (let gi = this.grows.length - 1; gi >= 0; gi--) {
      const g = this.grows[gi];
      const e = this.L.edges[g.e];
      const u = clamp((t - g.start) / g.dur, 0, 1);
      if (u <= 0) continue;
      if (u >= 1 && g.done < 0) {
        g.done = t;
        // the path is open now: paint it so, and the stop it reached
        this.painter.holdEdges.delete(g.e);
        this.repaintEdge(g.e);
        if (this.painter.holdNodes.get(g.to) === LOCKED) {
          this.painter.holdNodes.delete(g.to);
          this.repaintNode(g.to);
          this.pops.push({ n: g.to, t, bloom: false });
        }
      }
      let alpha = 1;
      if (g.done >= 0) {
        if (this.chunks.pending(e.box[0], e.box[1], e.box[2], e.box[3])) g.done = t;
        alpha = 1 - (t - g.done) / 0.35;
        if (alpha <= 0) {
          this.grows.splice(gi, 1);
          continue;
        }
      }
      const len = e.len * ease(u);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let s = 0; s <= len; s += 4) {
        pointAt(e, s, P2);
        ctx.lineTo(P2[0], P2[1]);
      }
      pointAt(e, len, P2);
      ctx.lineTo(P2[0], P2[1]);
      ctx.strokeStyle = '#3f6a1a';
      ctx.lineWidth = 4.2;
      ctx.stroke();
      ctx.strokeStyle = '#8cc63f';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      // leaves, unfolding as the tip passes
      for (let s = 14, side = 1; s < len - 4; s += 16, side = -side) {
        const grow = clamp((len - s) / 24, 0, 1);
        pointAt(e, s, P2);
        const x = P2[0];
        const y = P2[1];
        pointAt(e, s + 2, P2);
        const a = Math.atan2(P2[1] - y, P2[0] - x) + side * 1.05;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.scale(grow, grow);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(4, -3.4, 9, 0);
        ctx.quadraticCurveTo(4, 3.4, 0, 0);
        ctx.fillStyle = side > 0 ? '#a8d64a' : '#95c63e';
        ctx.fill();
        ctx.strokeStyle = '#3f6a1a';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.restore();
      }
      // the growing tip
      if (u < 1) glow(ctx, P2[0], P2[1], 12, '214,255,140', 0.6);
      ctx.globalAlpha = 1;
    }
  }

  /** What's alive on a stop: its fireflies, the ring round the one you're on, a bloom opening, a stop popping up. */
  private drawNodeLife(ctx: CanvasRenderingContext2D, n: MapNode, t: number) {
    const st = this.painter.holdNodes.get(n.i) ?? this.state.node[n.i];
    const ink = this.painter.themes[n.world].ink;
    for (let pi = this.pops.length - 1; pi >= 0; pi--) {
      const p = this.pops[pi];
      if (p.n !== n.i) continue;
      const u = (t - p.t) / (p.bloom ? 0.7 : 0.45);
      if (p.bloom) {
        if (u >= 1) {
          if (this.painter.holdNodes.has(n.i)) {
            this.painter.holdNodes.delete(n.i);
            this.repaintNode(n.i);
          }
          const b = this.painter.nodeBox(n);
          const [bx, by, bs] = BLOOM_AT(n);
          if (!this.chunks.pending(b[0], b[1], b[2], b[3])) this.pops.splice(pi, 1);
          else bloom(ctx, bx, by, bs, 1, ink);
          continue;
        }
        const [bx, by, bs] = BLOOM_AT(n);
        bloom(ctx, bx, by, bs, back(u), ink);
        // a ring of sparkles
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const r = 10 + u * 26;
          glow(ctx, n.x + Math.cos(a) * r, n.y - 8 + Math.sin(a) * r * 0.6, 5, '255,236,150', 0.8 * (1 - u));
        }
      } else {
        if (u >= 1) {
          this.pops.splice(pi, 1);
          continue;
        }
        const [bx, by] = BLOOM_AT(n);
        if (!n.planned && n.kind === 'level') bud(ctx, bx, by + (1 - back(u)) * 6, 12 * back(u), ink);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.4;
          const r = 8 + u * 22;
          ctx.fillStyle = '#a8d64a';
          ctx.globalAlpha = 1 - u;
          ctx.beginPath();
          ctx.ellipse(n.x + Math.cos(a) * r, n.y - 4 + Math.sin(a) * r * 0.6, 2.2, 1.6, a, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
    if (st === LOCKED) return;
    // fireflies found here: three little lights over the stone
    if (n.playable && !n.free && (n.kind === 'level' || n.kind === 'boss')) {
      const m = this.progress.fireflies?.[n.id] ?? 0;
      const by = n.y + n.r * 0.6 + 11;
      for (let i = 0; i < 3; i++) {
        const x = n.x - 9 + i * 9;
        const y = by - Math.abs(i - 1) * 2 + (m & (1 << i) ? Math.sin(t * 2.2 + i * 2) * 1.2 : 0);
        if (m & (1 << i)) {
          glow(ctx, x, y, 7, '226,255,120', 0.55 + 0.2 * Math.sin(t * 3 + i * 1.7));
          ctx.fillStyle = '#f6ffc4';
          ctx.beginPath();
          ctx.ellipse(x, y, 1.9, 1.9, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(30,40,24,0.35)';
          ctx.beginPath();
          ctx.ellipse(x, y, 1.6, 1.6, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // the stop you're on
    if (n.i === this.cur && !this.walk && this.enterT < 0) {
      const r = n.r + 5 + Math.sin(t * 4) * 1.4;
      ctx.strokeStyle = '#fff6c8';
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(n.x, n.y + (n.kind === 'gate' ? 2 : 0), r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawSprouts(ctx: CanvasRenderingContext2D, kd: number, ox: number, oy: number, t: number) {
    const [A, B] = this.birds;
    const s = kd * SPROUT;
    ctx.setTransform(s, 0, 0, s, -ox, -oy);
    const ca = BIRD_COLORS[this.colors[0] % BIRD_COLORS.length];
    let cb = BIRD_COLORS[this.colors[1] % BIRD_COLORS.length];
    if (cb === ca) cb = BIRD_COLORS[(this.colors[1] + 1) % BIRD_COLORS.length];
    const th = this.painter.themeAt(this.feet[0][0]);
    const ground = Math.max(this.feet[0][1], this.feet[1][1]) / SPROUT - 1;
    const pa = { x: A.x, y: A.y + A.ropeOff };
    const pb = { x: B.x, y: B.y + B.ropeOff };
    drawRope(ctx, [pa, pb], Math.max(Math.hypot(pb.x - pa.x, pb.y - pa.y), 215), ca.body, cb.body, 0, 0, 0, t, 0.3, (_x, y) => y > ground);
    // the nearer one (lower on the map) in front
    const order = this.feet[0][1] > this.feet[1][1] ? [1, 0] : [0, 1];
    for (const i of order) drawSprout(ctx, this.birds[i], i ? cb : ca, t, th.ink, this.hats[i], false);
    for (const b of this.birds) if (b.emote) drawBubble(ctx, b.x + 10, b.y - sproutTop(b) - 8, b.emote, 2.2 - b.emoteT, th.ink);
  }
}
