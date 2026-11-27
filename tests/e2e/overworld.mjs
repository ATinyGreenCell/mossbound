// The overworld map's layout, checked as logic rather than through a browser (like creatures.mjs):
//
//   stops never overlap one another, and every stop can be reached along the trail;
//   the creek keeps clear of the stops, and the trail stays out of the water except where it crosses;
//   APPEND ONLY: worlds 1-3 are laid out exactly the same with and without a world after them (and a
//   50-world map's first 49 with and without its 50th), down to every point of the creek;
//   unlocking runs in order, planned levels are walked past, and the side spots are open from the start;
//   the map's painted pieces stay bounded at 50 worlds: a camera walked from one end of the map to the
//   other keeps a fixed number of chunks however long the map is, and paints at most one ahead a frame.
//
// It bundles the overworld's own modules through Vite, so it tests exactly what ships.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(DIR, '../..');
const OUT = path.join(DIR, '.out/overworld');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, 'entry.ts'),
  `export { layoutWorlds, mapState, route, creekAt, RADIUS, LOCKED, OPEN, CLEARED } from '${ROOT}/src/overworld/layout';
   export { WORLDS } from '${ROOT}/src/game/worlds';
   export { stressWorlds } from '${ROOT}/src/overworld/stress';
   export { ChunkCache, CHUNK } from '${ROOT}/src/overworld/chunks';
   export { scatter, K } from '${ROOT}/src/overworld/scatter';
   export { MAP_THEMES, mapTheme } from '${ROOT}/src/overworld/themes';
   export { viewUnits } from '${ROOT}/src/overworld/view';\n`,
);
await build({
  root: ROOT,
  logLevel: 'error',
  build: {
    write: true,
    outDir: OUT,
    emptyOutDir: false,
    lib: { entry: path.join(OUT, 'entry.ts'), formats: ['es'], fileName: 'ow' },
    rollupOptions: { output: { entryFileNames: 'ow.mjs' } },
    minify: false,
    target: 'es2022',
  },
});
const M = await import(path.join(OUT, 'ow.mjs'));
const { layoutWorlds, mapState, route, creekAt, LOCKED, OPEN, CLEARED, WORLDS, stressWorlds, ChunkCache, CHUNK, scatter, K, mapTheme, viewUnits } = M;

let checks = 0;
const errors = [];
const ok = (cond, what) => {
  checks++;
  if (!cond) errors.push(what);
};

/** everything a layout says about where things are, for comparing two of them */
const snapshot = (L, worlds) => {
  const nodes = L.nodes.filter((n) => n.world < worlds).map((n) => [n.id, n.kind, n.x, n.y, n.r, n.creek, n.mark]);
  const edges = L.edges.filter((e) => e.world < worlds).map((e) => [e.a, e.b, Array.from(e.pts)]);
  const regions = L.regions.slice(0, worlds).map((g) => [g.x0, g.x1, g.cx0, Array.from(g.cy), Array.from(g.cw), JSON.stringify(g.crossings), JSON.stringify(g.marks)]);
  return JSON.stringify({ nodes, edges, regions });
};

function checkLayout(L, label) {
  // ids, and edges running forward
  ok(new Set(L.nodes.map((n) => n.id)).size === L.nodes.length, `${label}: every stop has its own id`);
  for (const e of L.edges) ok(e.a < e.b, `${label}: edge ${L.nodes[e.a].id}→${L.nodes[e.b].id} runs forward`);
  // no two stops overlap (a margin to spare for the sprouts and the fireflies)
  for (let i = 0; i < L.nodes.length; i++) {
    const a = L.nodes[i];
    for (let j = i + 1; j < L.nodes.length; j++) {
      const b = L.nodes[j];
      if (Math.abs(a.x - b.x) > 200) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      ok(d >= a.r + b.r + 16, `${label}: ${a.id} and ${b.id} are ${d.toFixed(0)} apart (need ${a.r + b.r + 16})`);
    }
  }
  // every stop reachable from home along the trail (edges either way)
  const seen = new Set([0]);
  const todo = [0];
  while (todo.length) {
    const u = todo.pop();
    for (const ei of L.nodes[u].edges) {
      const e = L.edges[ei];
      const v = e.a === u ? e.b : e.a;
      if (!seen.has(v)) {
        seen.add(v);
        todo.push(v);
      }
    }
  }
  ok(seen.size === L.nodes.length, `${label}: every stop is on the trail (${seen.size}/${L.nodes.length} reached)`);
  // with everything cleared, everything opens
  const all = mapState(L, { cleared: new Set(L.nodes.map((n) => n.id)) });
  ok(all.node.every((s) => s !== LOCKED), `${label}: clearing everything opens everything`);
  // the trail runs east, stop to stop
  for (const e of L.edges) {
    if (!e.main) continue;
    let back = 0;
    for (let k = 2; k < e.pts.length; k += 2) if (e.pts[k] < e.pts[k - 2] - 0.01) back++;
    ok(back === 0, `${label}: the trail into ${L.nodes[e.b].id} runs east all the way`);
  }
  // the creek keeps clear of the stops
  const c = [0, 0];
  for (const n of L.nodes) {
    let worst = Infinity;
    for (let x = n.x - n.r; x <= n.x + n.r; x += 4) {
      creekAt(L, x, c);
      worst = Math.min(worst, Math.abs(n.y - c[0]) - c[1]);
    }
    ok(worst >= n.r * 0.7, `${label}: ${n.id} is clear of the creek (${worst.toFixed(0)} from the water)`);
  }
  // the trail is out of the water except where it crosses
  for (const g of L.regions) {
    for (const ei of g.edges) {
      const e = L.edges[ei];
      if (!e.main) continue;
      for (let k = 0; k < e.pts.length; k += 2) {
        const x = e.pts[k];
        const y = e.pts[k + 1];
        creekAt(L, x, c);
        if (Math.abs(y - c[0]) >= c[1]) continue;
        const near = g.crossings.some((q) => q.edge === ei && Math.abs(q.x - x) < 60);
        ok(near, `${label}: the trail into ${L.nodes[e.b].id} is in the water at ${x.toFixed(0)},${y.toFixed(0)} with no crossing there`);
        if (!near) break;
      }
    }
  }
}

// ---- the real map
const L3 = layoutWorlds(WORLDS);
checkLayout(L3, 'worlds');
ok(L3.regions.length === 3, 'three worlds');
ok(L3.nodes.filter((n) => n.kind === 'boss').length === 3, 'three bosses');
ok(L3.nodes.filter((n) => n.kind === 'gate').length === 3, 'three gates');
ok(['garden', 'woods', 'shallows', 'lilypond', 'reedrun', 'mill', 'paris', 'tower', 'practice', 'course'].every((id) => L3.byId.has(id) && L3.nodes[L3.byId.get(id)].playable), 'the levels that exist are on the map, playable');
ok(L3.nodes.filter((n) => n.planned).length === 10, `ten planned levels (${L3.nodes.filter((n) => n.planned).length})`);

// ---- unlocking
{
  const id = (s) => L3.byId.get(s);
  const S0 = mapState(L3, { cleared: new Set() });
  ok(S0.node[id('garden')] === OPEN, 'a new game: Mossy Creek is open');
  ok(S0.node[id('practice')] === OPEN && S0.node[id('course')] === OPEN, 'a new game: the practice ground and the test course are open');
  ok(S0.node[id('woods')] === LOCKED, 'a new game: Fern Falls is locked');
  const S2 = mapState(L3, { cleared: new Set(['garden', 'woods']) });
  ok(S2.node[id('garden')] === CLEARED && S2.node[id('woods')] === CLEARED, 'cleared levels show cleared');
  ok(S2.node[id('shallows')] === OPEN, 'the stop after a cleared one is open');
  ok(S2.node[id('lilypond')] === LOCKED && S2.node[id('mill')] === LOCKED, '…and the levels past that one are not');
  // world 1's built levels all cleared: its planned boss is walked past, so world 2 opens
  const S5 = mapState(L3, { cleared: new Set(['garden', 'woods', 'shallows', 'lilypond', 'reedrun']) });
  ok(S5.node[id('rapids')] === OPEN, 'a planned level past a cleared one is reached (walked past)');
  ok(S5.node[id('mill')] === OPEN, 'the planned boss does not lock The Old Mill');
  ok(S5.node[id('millpond')] === LOCKED, 'past The Old Mill stays locked until it is cleared');
  const way = route(L3, S5, id('gate:creek'), id('mill'));
  ok(way && way.length === 8, `a walk from home to the mill, stop by stop (${way?.length})`);
  ok(route(L3, S5, id('gate:creek'), id('paris')) === null, 'no walk to a locked level');
  // ---- a journal from before a world grew: levels added in front of a cleared stop must not take
  // it away again. (World 1 went from two stops to five in 1.13; the mill was already finished.)
  const Sold = mapState(L3, { cleared: new Set(['garden', 'woods', 'mill']) });
  ok(Sold.node[id('shallows')] === OPEN && Sold.node[id('lilypond')] === OPEN && Sold.node[id('reedrun')] === OPEN, 'levels added in front of a cleared one are open');
  ok(Sold.node[id('mill')] === CLEARED && Sold.node[id('millpond')] === OPEN, '…and what was cleared before them is still reached');
  ok(route(L3, Sold, id('gate:creek'), id('mill')) !== null, '…and can still be walked to');
}

// ---- append only: a fourth world moves nothing in the first three
{
  // (the example world from docs/MAKING-WORLDS.md, so the guide's example is known to work)
  const extra = {
    id: 'meadows',
    name: 'The High Meadows',
    mapTheme: 'meadow',
    gate: { name: 'The Stile', landmark: 'bridge' },
    story: ['First page of the storybook.', 'Second page.'],
    levels: [
      { id: 'buttercups', name: 'Buttercup Hill' },
      { id: 'beehive', name: 'The Beehive', mark: 'barn' },
      { id: 'honey', name: 'Honey Pot', from: 'beehive' },
      { id: 'windmill', name: 'Windy Top' },
      { id: 'queen', name: "The Queen's Lawn" },
    ],
    boss: { name: 'Old Snip', line: 'back for more', art: 'snip' },
  };
  const L4 = layoutWorlds([...WORLDS, extra]);
  checkLayout(L4, 'four worlds');
  ok(L4.nodes[L4.byId.get('queen')].kind === 'boss' && !L4.nodes[L4.byId.get('honey')].main, "the guide's world: the last stop is the boss's, a `from` stop is off the trail");
  const allBuilt = new Set(L3.nodes.filter((n) => n.playable).map((n) => n.id));
  ok(mapState(L4, { cleared: allBuilt }).node[L4.byId.get('queen')] === OPEN, "the guide's world opens once the levels before it are cleared (planned ones walked past)");
  ok(snapshot(L3, 3) === snapshot(L4, 3), 'adding a fourth world moves nothing in worlds 1-3');
  const d3 = scatter(L3, 2, mapTheme('falls'));
  const d4 = scatter(L4, 2, mapTheme('falls'));
  ok(d3.count === d4.count && JSON.stringify([...d3.buckets]) === JSON.stringify([...d4.buckets]), 'nor anything growing in world 3');
  // a hand-placed stop moves that stop and nothing else
  const moved = WORLDS.map((w) => (w.id === 'mill' ? { ...w, levels: w.levels.map((s) => (s === 'mill' ? { id: 'mill', at: [200, 90] } : s)) } : w));
  const Lm = layoutWorlds(moved);
  const a = L3.nodes[L3.byId.get('mill')];
  const b = Lm.nodes[Lm.byId.get('mill')];
  ok(b.x === Lm.nodes[Lm.byId.get('gate:mill')].x + 200 && b.y === Lm.nodes[Lm.byId.get('gate:mill')].y + 90, '`at` puts a stop where it says, from its gate');
  ok(a.x !== b.x && Lm.nodes[Lm.byId.get('millpond')].x === L3.nodes[L3.byId.get('millpond')].x, 'and moves no other stop');
}

// ---- odd worlds: empty ones, no boss, a side spot off a side spot, a hand-placed side spot
{
  const odd = [
    { id: 'o1', name: 'Empty', mapTheme: 'meadow', levels: [] },
    { id: 'o2', name: 'Branchy', mapTheme: 'cascade', levels: ['p1', { id: 'p2', from: 'p1' }, { id: 'p3', from: 'p2' }, 'p4', { id: 'p5', from: 'gate', free: true }] },
    { id: 'o3', name: 'Empty too', mapTheme: 'nonsense', levels: [] },
    { id: 'o4', name: 'Placed', mapTheme: 'woods', levels: ['q1', { id: 'q2', from: 'q1', at: [60, 200] }, 'q3'], boss: { name: 'J', line: 'j', art: 'jangle' } },
  ];
  const L = layoutWorlds(odd);
  checkLayout(L, 'odd worlds');
  const p3 = L.nodes[L.byId.get('p3')];
  ok(L.edges.some((e) => L.nodes[e.a].id === 'p2' && e.b === p3.i), 'a side spot can hang off a side spot');
  const g4 = L.nodes[L.byId.get('gate:o4')];
  const q2 = L.nodes[L.byId.get('q2')];
  ok(q2.x === g4.x + 60 && q2.y === g4.y + 200, 'a side spot placed by hand goes where it says');
  // (a level theme with no map theme of its own: 'cascade'. The 1.9 'paris' and 'tower' themes are gone, and fall back)
  ok(mapTheme('nonsense').id === 'meadow' && mapTheme('tower').id === 'meadow' && mapTheme('cascade').id === 'level:cascade', 'an unknown theme falls back to the meadow, a level theme makes its own');
}

// ---- fifty worlds
const W50 = stressWorlds(50);
const L50 = layoutWorlds(W50);
const L49 = layoutWorlds(W50.slice(0, 49));
checkLayout(L50, '50 worlds');
ok(snapshot(L49, 49) === snapshot(L50, 49), 'fifty worlds: the 50th moves nothing in the first 49');
{
  // things growing: bounded per chunk, never in the water or on the trail
  let worst = 0;
  let total = 0;
  const c = [0, 0];
  for (let w = 0; w < L50.regions.length; w++) {
    const D = scatter(L50, w, mapTheme(L50.regions[w].def.mapTheme));
    total += D.count;
    for (const b of D.buckets.values()) worst = Math.max(worst, b.length);
    for (const b of D.buckets.values()) {
      for (const it of b) {
        if (it.k === K.lily || it.k === K.wetrock || it.k === K.foam || it.k === K.mark) continue;
        creekAt(L50, it.x, c);
        if (Math.abs(it.y - c[0]) < c[1]) {
          ok(false, `world ${w + 1}: a ${it.k} grows in the creek at ${it.x.toFixed(0)},${it.y.toFixed(0)}`);
          break;
        }
      }
    }
  }
  ok(worst <= 90, `at most 90 things in any chunk (${worst})`);
  console.log(`50 worlds: ${L50.nodes.length} stops, ${L50.edges.length} edges, ${total} things growing; busiest chunk ${worst}`);

  // a camera walked along the whole map, at the Xbox's and a phone's view
  for (const [label, W, H, dpr] of [
    ['1920x1080', 1920, 1080, 1],
    ['844x390@3', 844, 390, 3],
  ]) {
    const units = viewUnits(W, H);
    const k = (H / units) * Math.min(dpr, 2);
    const px = Math.round(CHUNK * k);
    let baked = 0;
    let freed = 0;
    const cache = new ChunkCache({ bake: () => (baked++, {}), free: () => freed++ });
    const vw = (W * Math.min(dpr, 2)) / k;
    const vh = (H * Math.min(dpr, 2)) / k;
    let worstFrame = 0;
    let frames = 0;
    let lastVis = 0;
    const main = L50.nodes.filter((n) => n.main);
    for (let i = 0; i < main.length - 1; i++) {
      const a = main[i];
      const b = main[i + 1];
      for (let f = 0; f < 20; f++) {
        const u = f / 20;
        const x = a.x + (b.x - a.x) * u;
        const y = a.y + (b.y - a.y) * u;
        const before = baked;
        cache.view(x - vw / 2, y - vh / 2, x + vw / 2, y + vh / 2, px, Math.sign(b.x - a.x), Math.sign(b.y - a.y) * 0.5);
        if (frames > 0) worstFrame = Math.max(worstFrame, baked - before);
        lastVis = cache.vis.length;
        frames++;
        ok(cache.size <= cache.cap(), `${label}: ${cache.size} chunks kept, within the cap of ${cache.cap()}`);
      }
    }
    const perView = (Math.ceil(vw / CHUNK) + 1) * (Math.ceil(vh / CHUNK) + 1);
    ok(cache.stats.peak <= Math.max(perView + 2 * (Math.ceil(vw / CHUNK) + Math.ceil(vh / CHUNK) + 6), cache.cap()), `${label}: peak ${cache.stats.peak} chunks over the whole map`);
    ok(lastVis <= perView, `${label}: ${lastVis} chunks on screen (at most ${perView})`);
    // (the ring is painted ahead, one a frame: a frame paints a whole new row only if the camera outruns it)
    ok(worstFrame <= Math.max(Math.ceil(vw / CHUNK), Math.ceil(vh / CHUNK)) + 1, `${label}: at most a row of chunks painted in a frame while walking (${worstFrame})`);
    console.log(`${label}: ${units.toFixed(0)} units tall, chunk ${px}px, peak ${cache.stats.peak} kept (cap ${cache.cap()}), ${baked} painted over ${frames} frames (worst frame ${worstFrame}), ${freed} let go`);
  }
}

console.log(`\n--- errors ---\n${errors.length ? errors.slice(0, 40).map((e) => `  ${e}`).join('\n') : 'none'}`);
console.log(`${checks - errors.length}/${checks} checks`);
if (!errors.length) console.log('overworld OK');
process.exit(errors.length ? 1 : 0);
