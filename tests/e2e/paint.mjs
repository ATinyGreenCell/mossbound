// What a frame costs to draw, counted rather than timed: draw calls, pixels painted, chunks and
// backdrops painted again. A software renderer (the CI runner, a weak phone) pays for every
// anti-aliased path and every full-screen blit, and the time it takes depends on the machine — but how
// many of them a frame asks for does not. So every check here counts, and holds on any machine.
import { frames, launch, open, reporter, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const t = reporter();
const page = await open(browser, { storage: { 'mossbound.settings.v1': { perf: 'high' } } });
/** Run one part; if it throws (say, on a build that hasn't what it measures), that's a failed check, not a crash. */
const part = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    t.check(`${label} — could not be measured: ${String(e?.message ?? e).split('\n')[0]}`, false);
  }
};

// ---------------------------------------------------------------- the tile cache
// A TileCache driven directly, the camera swept along each level at a run's speed, at a small chunk
// size (cheap to paint on any machine) with the view the same number of chunks across as a 1280×720
// screen's. Every chunk painted is sorted: ahead of time (the ring round the view) or in the very frame
// it was needed (on screen). Once the cache is full it must still paint ahead — it used to stop.
await part('the tile cache', async () => {
  const sweep = await page.evaluate(async () => {
    const { TileCache } = await import('/src/render/tiles.ts');
    const { parseLevel } = await import('/src/game/level.ts');
    const { LEVELS } = await import('/src/game/levels.ts');
    const { THEMES } = await import('/src/render/theme.ts');
    const T = 32;
    const scale = 0.25;
    const D = 256 * scale;
    // 1280×720 at the camera's full scale shows 3.22 × 1.81 chunks
    const viewW = Math.round(3.22 * D);
    const viewH = Math.round(1.81 * D);
    const out = [];
    for (let li = 0; li < LEVELS.length; li++) {
      const L = parseLevel(LEVELS[li], li);
      const tc = new TileCache(L, THEMES[L.def.theme]);
      const c = document.createElement('canvas');
      c.width = c.height = 2;
      const ctx = c.getContext('2d');
      let view = null;
      let frame = 0;
      const stats = { visible: 0, ahead: 0, visibleWhenFull: 0, aheadWhenFull: 0, emptyPainted: 0, emptyDrawn: 0, full: false, chunks: 0 };
      const proto = Object.getPrototypeOf(tc);
      const capOf = () => proto.cap.call(tc);
      // a chunk with nothing that paintRegion paints in it or its one-tile margin
      const paints = (t) => t !== 0 && t !== 6 && t !== 7 && t !== 9;
      // (below the map, the bottom row carries on where it's solid: ground, stone or a vent)
      const solid = (t) => t === 1 || t === 2 || t === 8;
      const tileAt = (tx, ty) => {
        if (tx < 0 || tx >= L.w || ty < 0) return 0;
        if (ty >= L.h) return solid(L.tiles[(L.h - 1) * L.w + tx]) ? L.tiles[(L.h - 1) * L.w + tx] : 0;
        return L.tiles[ty * L.w + tx];
      };
      const isEmpty = (cx, cy) => {
        for (let ty = cy * 8 - 1; ty <= cy * 8 + 8; ty++) for (let tx = cx * 8 - 1; tx <= cx * 8 + 8; tx++) if (paints(tileAt(tx, ty))) return false;
        return true;
      };
      const chunkOf = new Map();
      tc.bake = function (cx, cy) {
        const inView = cx >= Math.floor(view.ox / D) && cx <= Math.floor((view.ox + viewW) / D) && cy >= Math.floor(view.oy / D) && cy <= Math.floor((view.oy + viewH) / D);
        // (the first frame paints the whole view: nothing could have been painted ahead of it)
        if (frame > 1) {
          if (inView) stats.visible++;
          else stats.ahead++;
          if (stats.full) {
            if (inView) stats.visibleWhenFull++;
            else stats.aheadWhenFull++;
          }
        }
        if (isEmpty(cx, cy)) stats.emptyPainted++;
        const ch = proto.bake.call(this, cx, cy);
        chunkOf.set(ch.canvas, [cx, cy]);
        return ch;
      };
      const draw = ctx.drawImage;
      ctx.drawImage = function (img, ...a) {
        const at = chunkOf.get(img);
        if (at && isEmpty(at[0], at[1])) stats.emptyDrawn++;
        return draw.call(this, img, ...a);
      };
      // run the length of the level and back (a tall level: up and back down) at 215 px/s, 60 frames a second
      const tall = L.h > L.w;
      const span = (tall ? L.h : L.w) * T * scale - (tall ? viewH : viewW);
      const step = (215 / 60) * scale;
      const along = [];
      for (let p = 0; p <= span; p += step) along.push(p);
      for (let p = span; p >= 0; p -= step) along.push(p);
      const across = tall ? 0 : Math.max(0, L.h * T * scale - viewH);
      for (const p of along) {
        frame++;
        view = tall ? { ox: Math.max(0, (L.w * T * scale - viewW) / 2), oy: p } : { ox: p, oy: across };
        tc.draw(ctx, scale, scale, view.ox, view.oy, viewW, viewH);
        if (!stats.full && tc.chunks.size >= capOf()) stats.full = true;
      }
      stats.chunks = tc.chunks.size;
      stats.cap = capOf();
      stats.frames = frame;
      tc.clear();
      out.push({ level: L.def.name, ...stats });
    }
    return out;
  });
  for (const s of sweep) {
    t.check(`${s.level}: once the tile cache is full it still paints ahead — nothing is painted the frame it scrolls into view (${s.visibleWhenFull} were, ${s.aheadWhenFull} ahead)`, !s.full || (s.visibleWhenFull === 0 && s.aheadWhenFull > 0), s);
    t.check(`${s.level}: a chunk with nothing in it is never painted or drawn (${s.emptyPainted} painted, ${s.emptyDrawn} drawn)`, s.emptyPainted === 0 && s.emptyDrawn === 0, s);
  }
});

// a screen 1600 rows tall, the camera zoomed all the way out: the cache must hold the whole view
await part('the tile cache', async () => {
  const big = await page.evaluate(async () => {
    const { TileCache } = await import('/src/render/tiles.ts');
    const { parseLevel } = await import('/src/game/level.ts');
    const { LEVELS } = await import('/src/game/levels.ts');
    const { THEMES } = await import('/src/render/theme.ts');
    const L = parseLevel(LEVELS[1], 1);
    const tc = new TileCache(L, THEMES[L.def.theme]);
    // paint nothing (this is about how many, not what): a chunk is still a full-size canvas
    const proto = Object.getPrototypeOf(tc);
    const full = Math.round((1600 / (14.5 * 32)) * 256) / 256;
    const scale = Math.round(full * 0.7 * 256) / 256;
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const D = 256 * scale;
    const viewW = 2560;
    const viewH = 1600;
    // (a view straddling chunk edges both ways: 6 columns × 4 rows, the most it can cover)
    const ox = Math.round(2 * D + 600);
    const oy = 300;
    // how many chunks the view covers, counted the way the cache counts them
    const cols = Math.min(Math.ceil(L.w / 8) - 1, Math.floor((ox + viewW) / D)) - Math.floor(ox / D) + 1;
    const rows = Math.min(Math.ceil(L.h / 8) + 1, Math.floor((oy + viewH) / D)) - Math.floor(oy / D) + 1;
    tc.draw(c.getContext('2d'), scale, full, ox, oy, viewW, viewH);
    const cap = proto.cap.call(tc);
    const px = Math.round(256 * full);
    tc.clear();
    return { view: cols * rows, cap, px, mb: +((cap * px * px * 4) / 2 ** 20).toFixed(0) };
  });
  t.check(`a 1600-row screen zoomed out: the tile cache holds the whole view (${big.view} chunks of ${big.px} px; the cap is ${big.cap}, ${big.mb} MB)`, big.cap >= big.view, big);
});

// ---------------------------------------------------------------- the backdrop's layers and sky
// Every theme's layers, drawn by the game from only the parts with anything in them, against the same
// layers drawn the way they used to be (each a whole strip), at fractional offsets, risen and not, at
// 720 and 1080 rows, over the same flat colour. A part in the wrong place, or cut short, would differ by
// whole colours along its edges (a part 3 px out: up to 204 in 255); what's allowed is the last bit of
// rounding a renderer gives a texture of another size (SwiftShader: up to 2 in 255 on under 0.5% of
// values; the GPU here: nothing at all).
await part("the backdrop's layers and sky", async () => {
  const same = await page.evaluate(async () => {
    const { Backdrop } = await import('/src/render/backdrop.ts');
    const { THEMES } = await import('/src/render/theme.ts');
    const { rng } = await import('/src/core/math.ts');
    const out = [];
    const diff = (a, b, n) => {
      let worst = 0;
      let differing = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d) {
          differing++;
          if (d > worst) worst = d;
        }
      }
      return { worst, differing };
    };
    for (const H of [720, 1080]) {
      const W = Math.round((H * 16) / 9);
      const mk = () => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        return c;
      };
      for (const id of ['creek', 'garden', 'woods', 'mill', 'cascade', 'falls']) {
        const th = { ...THEMES[id], stars: 0, sun: null, moon: false, clouds: null };
        const b = new Backdrop(th);
        b.draw(mk().getContext('2d'), W, H, 0, 1000, 1000, 1, 0);
        const strips = th.layers.map((layer, i) => {
          const w = Math.ceil(layer.period * H);
          const c = document.createElement('canvas');
          c.width = w;
          c.height = H;
          layer.paint(c.getContext('2d'), w, H, rng(1000 + i * 77));
          return { c, w };
        });
        let worst = 0;
        let differing = 0;
        for (const [camX, rise] of [[0, 0], [1234.567, 0], [987.25, 37.3], [5555.5, 250.75]]) {
          const scale = 1.55;
          const a = mk();
          const r = mk();
          const ga = a.getContext('2d', { willReadFrequently: true });
          const gr = r.getContext('2d', { willReadFrequently: true });
          ga.fillStyle = gr.fillStyle = '#336699';
          ga.fillRect(0, 0, W, H);
          gr.fillRect(0, 0, W, H);
          b.layers.forEach((L, i) => {
            const layer = th.layers[i];
            const { c, w } = strips[i];
            const off = -((((camX * scale * layer.fx) % w) + w) % w);
            const dy = Math.min(H * 0.9, rise * layer.fy);
            for (let x = off; x < W; x += w) {
              if (L.canvas.width) ga.drawImage(L.canvas, x + L.left, dy + L.top);
              gr.drawImage(c, x, dy);
            }
          });
          const d = diff(ga.getImageData(0, 0, W, H).data, gr.getImageData(0, 0, W, H).data, W * H * 4);
          worst = Math.max(worst, d.worst);
          differing += d.differing;
        }
        // and the sky: one row per row without smoothing, against stretched with it
        const s1 = mk();
        const s2 = mk();
        const g1 = s1.getContext('2d', { willReadFrequently: true });
        const g2 = s2.getContext('2d', { willReadFrequently: true });
        const sky = b.sky;
        g1.imageSmoothingEnabled = sky.height !== H;
        g1.drawImage(sky, 0, 0, W, H);
        g2.drawImage(sky, 0, 0, W, H);
        const ds = diff(g1.getImageData(0, 0, W, H).data, g2.getImageData(0, 0, W, H).data, W * H * 4);
        b.release();
        out.push({ id, H, worst, differing, of: W * H * 4 * 4, skyWorst: ds.worst, skyDiffering: ds.differing });
      }
    }
    return out;
  });
  // (a handful of values can come out a few levels apart when the GPU is busy — 24 of 33 million, by 17,
  // once, with six browsers drawing at the same time — which no eye can see; a layer put back in the wrong
  // place differs by up to 204 across thousands of values, which is what this is here to catch)
  const bad = same.filter((s) => (s.worst > 3 && s.differing > Math.max(64, s.of * 1e-5)) || s.worst > 48 || s.skyWorst > 1 || s.differing > s.of * 0.01);
  const most = Math.max(...same.map((s) => s.differing / s.of));
  t.check(`every backdrop layer and sky is the same picture, drawn from only the parts with anything in them (${same.length} theme × height; worst difference ${Math.max(...same.map((s) => s.worst))} and ${Math.max(...same.map((s) => s.skyWorst))} in 255, on ${(most * 100).toFixed(2)}% of values at most)`, bad.length === 0, bad.length ? bad : same.map((s) => `${s.id}@${s.H} ${s.worst}/${s.differing} sky ${s.skyWorst}/${s.skyDiffering}`).join(' | '));
});

// how much of the screen the backdrop blits a frame, and how big its layers are kept, on every level
// (the sky is one screen; each layer used to be another whole screen, mostly clear)
await part("the backdrop's layers and sky", async () => {
  const levels = [];
  for (let n = 0; n < 5; n++) {
    await page.evaluate((n) => window.__fb.flow.debug(n), n);
    await waitFor(() => page.evaluate((n) => window.__fbSession?.L?.index === n && window.__fb.app.current?.constructor.name === 'Session', n), 20000, `level ${n + 1}`);
    await frames(page, 3);
    levels.push(
      await page.evaluate(() => {
        const s = window.__fbSession;
        const r = window.__fb.app.renderer;
        const ctx = r.ctx;
        const W = r.width;
        const H = r.height;
        let area = 0;
        let skySmooth = null;
        const draw = ctx.drawImage;
        ctx.drawImage = function (img, ...a) {
          const [x, y, w, h] = a.length === 2 ? [a[0], a[1], img.width, img.height] : a.length === 4 ? a : a.slice(4);
          const x0 = Math.max(0, x);
          const y0 = Math.max(0, y);
          const x1 = Math.min(W, x + w);
          const y1 = Math.min(H, y + h);
          if (x1 > x0 && y1 > y0) area += (x1 - x0) * (y1 - y0);
          if (img === s.backdrop.sky) skySmooth = this.imageSmoothingEnabled;
          return draw.call(this, img, ...a);
        };
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const cam = s.cam;
        s.backdrop.draw(ctx, W, H, cam.x, cam.y + cam.viewH / 2, s.L.h * 32, cam.scale, window.__fb.app.time);
        ctx.drawImage = draw;
        const kept = s.backdrop.layers.reduce((n, l) => n + l.canvas.width * l.canvas.height, 0);
        const whole = s.backdrop.layers.reduce((n, l) => n + l.w * H, 0);
        return { level: s.L.def.name, theme: s.theme.id, screens: +(area / (W * H)).toFixed(3), kept: +(kept / whole).toFixed(3), skySmooth, H };
      }),
    );
  }
  // the most each level's backdrop may blit, in screens: the sky, plus each layer's content, plus sun and clouds
  const BUDGET = { garden: 2.35, woods: 3.1, mill: 2.25, cascade: 2.55, falls: 2.3 };
  for (const l of levels) t.check(`${l.level}: the backdrop blits ${l.screens} screens a frame (at most ${BUDGET[l.theme]}) and keeps ${Math.round(l.kept * 100)}% of its strips`, l.screens <= BUDGET[l.theme] && l.kept <= 0.85, l);
  t.check(`the sky is drawn one row per row, without smoothing, at ${levels[0].H} rows (it is the same picture, and cheaper)`, levels.every((l) => l.skySmooth === false), levels.map((l) => l.skySmooth));
});

// ---------------------------------------------------------------- the creek along the bottom of a level
// Its ripples were one big stroked path on the game canvas every frame — on a software renderer 8-17 ms,
// more than two full-screen blits. And their round ends were only round because whatever was drawn last
// had left the canvas's lineCap at 'round'. Now: no stroke at all; the same picture whatever cap was
// left behind; and the same picture as the old way but for the corners of the ripples' ends (square now:
// at 1.6 px wide, a few pixels a ripple a little lighter or darker).
await part('the creek along the bottom of a level', async () => {
  await page.evaluate(() => window.__fb.flow.debug(0));
  await waitFor(() => page.evaluate(() => window.__fbSession?.L?.index === 0 && window.__fb.app.current?.constructor.name === 'Session'), 20000, 'the first level');
  await frames(page, 4);
  const water = await page.evaluate(() => {
    const s = window.__fbSession;
    const r = window.__fb.app.renderer;
    const ctx = r.ctx;
    const cam = s.cam;
    const T = 32;
    const sc = cam.scale;
    const x0 = cam.ox / sc - T;
    const y0 = cam.oy / sc - T;
    const x1 = x0 + cam.viewW + 2 * T;
    const y1 = y0 + cam.viewH + 2 * T;
    const pal = s.theme.water;
    const top = (s.L.h - 1.25) * T;
    const tt = 1.2345;
    const fract = (v) => v - Math.floor(v);
    // the band's rows on screen
    const r0 = Math.max(0, Math.floor(top * sc - cam.oy) - 3);
    const rows = Math.max(1, Math.min(r.height - r0, Math.ceil(36 * sc)));
    const back = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#204060';
      ctx.fillRect(0, 0, r.width, r.height);
      ctx.setTransform(sc, 0, 0, sc, -cam.ox, -cam.oy);
    };
    const read = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return ctx.getImageData(0, r0, r.width, rows).data;
    };
    // (a) strokes on the game canvas for one frame of creek
    let strokes = 0;
    const stroke = ctx.stroke;
    ctx.stroke = function (...a) {
      strokes++;
      return stroke.apply(this, a);
    };
    back();
    s.drawWater(ctx, pal, x0, x1, y1, tt);
    ctx.stroke = stroke;
    // (b) the same picture whatever lineCap was left on the canvas
    back();
    ctx.lineCap = 'butt';
    s.drawWater(ctx, pal, x0, x1, y1, tt);
    const butt = read();
    back();
    ctx.lineCap = 'round';
    s.drawWater(ctx, pal, x0, x1, y1, tt);
    const round = read();
    let capDiff = 0;
    for (let i = 0; i < butt.length; i++) if (butt[i] !== round[i]) capDiff++;
    // (c) the old way: one stroke straight onto the game canvas, round ends, at 0.45
    back();
    const g = ctx.createLinearGradient(0, top, 0, top + 2.5 * T);
    g.addColorStop(0, pal.top);
    g.addColorStop(1, pal.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(x0, top, x1 - x0, Math.max(y1, s.L.h * T + 4 * T) - top);
    const flow = tt * 18;
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (let i = Math.floor((x0 + flow) / 44) - 1; i * 44 - flow < x1; i++) {
      const h1 = fract(Math.sin(i * 12.9898) * 43758.5453);
      const h2 = fract(Math.sin(i * 78.233) * 12345.678);
      const x = i * 44 + h1 * 20 - flow;
      const y = top + 7 + h2 * 22 + Math.sin(tt * 1.5 + i) * 1.2;
      ctx.moveTo(x, y);
      ctx.lineTo(x + 8 + h1 * 14, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = pal.light;
    ctx.fillRect(x0, top - 1, x1 - x0, 2);
    ctx.globalAlpha = 1;
    const old = read();
    let worst = 0;
    let off = 0;
    let lit = 0;
    for (let i = 0; i < old.length; i += 4) {
      const d = Math.max(Math.abs(old[i] - round[i]), Math.abs(old[i + 1] - round[i + 1]), Math.abs(old[i + 2] - round[i + 2]));
      worst = Math.max(worst, d);
      if (d > 24) off++;
      // (pixels the ripples touch at all: lighter than the plain water under them)
      if (round[i] + round[i + 1] + round[i + 2] !== butt[i] + butt[i + 1] + butt[i + 2] || old[i] > 140) lit++;
    }
    ctx.setTransform(sc, 0, 0, sc, -cam.ox, -cam.oy);
    return { strokes, capDiff, worst, off, pixels: old.length / 4, rows };
  });
  t.check(`the creek's ripples are no stroke on the game canvas (${water.strokes} a frame)`, water.strokes === 0, water);
  t.check(`the ripples' round ends no longer depend on what was drawn before them (${water.capDiff} values differ with the cap left at 'butt')`, water.capDiff === 0, water);
  t.check(`the ripples look as they did but for their square ends (${water.off} of ${water.pixels} pixels differ by more than 24 in 255; worst ${water.worst})`, water.off <= water.pixels * 0.002 && water.worst <= 64, water);
});

// ---------------------------------------------------------------- the sprouts' own little canvases
// Each sprout is painted onto a canvas of its own sized to its pose, then laid onto the screen. Too
// small a box would cut a leaf or a foot off: so every kind of sprout, in every pose there is (a glide's
// leaf held overhead, a dash, hanging at every angle, clinging, braced, squashed and stretched to the
// limits, every hat, a ghost), is painted straight and its pixels must all lie inside the box.
await part("the sprouts' own little canvases", async () => {
  const fit = await page.evaluate(async () => {
    const { Bird, BIRD_COLORS } = await import('/src/game/bird.ts');
    const { paintSprout, sproutBox } = await import('/src/render/sprouts.ts');
    const S = 2;
    const N = 320;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true });
    const hats = ['none', 'beret', 'flower', 'acorn', 'straw', 'star'];
    let seed = 12345;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let worst = -Infinity;
    let poses = 0;
    const escapes = [];
    for (const kind of ['tall', 'small', 'even']) {
      for (let i = 0; i < 250; i++) {
        const b = new Bird(0);
        b.setKind(kind);
        b.x = 100;
        b.y = 100;
        b.facing = r() < 0.5 ? 1 : -1;
        const st = Math.floor(r() * 8);
        b.grounded = st <= 1;
        b.fluttering = st === 2 || r() < 0.15;
        b.hanging = st === 3;
        b.anchored = st === 4;
        b.cling = st === 5 ? (r() < 0.5 ? 1 : -1) : 0;
        b.dashT = st === 6 || r() < 0.1 ? 0.1 : 0;
        b.ghost = st === 7 && r() < 0.5;
        b.vx = (r() - 0.5) * 1600;
        b.vy = (r() - 0.5) * 1600;
        b.rope = b.hanging || b.anchored ? { pivot: { x: 100 + (r() - 0.5) * 300, y: 100 + (r() - 0.5) * 300 } } : null;
        b.squash = (r() - 0.5) * 1.4;
        b.airLean = (r() - 0.5) * 0.6;
        b.strain = r();
        b.invuln = r() < 0.2 ? 1 : 0;
        b.blinkT = r() < 0.2 ? -1 : 1;
        b.walkPhase = r() * 6.3;
        b.wingPhase = r() * 6.3;
        b.climbing = r() < 0.3 ? 1 : 0;
        b.lookX = r() * 2 - 1;
        b.lookY = r() * 2 - 1;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, N, N);
        g.setTransform(S, 0, 0, S, N / 2 - 100 * S, N / 2 - 100 * S);
        paintSprout(g, b, BIRD_COLORS[i % BIRD_COLORS.length], r() * 10, '#24331c', hats[Math.floor(r() * hats.length)], r() < 0.1);
        const d = g.getImageData(0, 0, N, N).data;
        let x0 = N;
        let y0 = N;
        let x1 = -1;
        let y1 = -1;
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            if (!d[(y * N + x) * 4 + 3]) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
        if (x1 < 0) continue;
        const box = sproutBox(b);
        // how far the painting reaches past the box, in device px (the canvas keeps one spare all round)
        const over = Math.max(N / 2 + box[0] * S - x0, N / 2 + box[1] * S - y0, x1 + 1 - (N / 2 + box[2] * S), y1 + 1 - (N / 2 + box[3] * S));
        if (over > 1) escapes.push({ kind, st, over: +over.toFixed(2), fluttering: b.fluttering, dash: b.dashT > 0, squash: +(b.squash + b.airLean).toFixed(2) });
        worst = Math.max(worst, over);
        poses++;
      }
    }
    return { poses, worst: +worst.toFixed(2), escapes: escapes.slice(0, 6), outside: escapes.length };
  });
  t.check(`a sprout's canvas holds all of it, in all ${fit.poses} poses tried (${fit.outside} reach past it; at most ${fit.worst} px past the box, 1 to spare)`, fit.poses >= 700 && fit.outside === 0, fit);

  // drawn the new way on the game's own canvas against drawn straight: the same sprout in the same place
  const same = await page.evaluate(async () => {
    const { paintSprout, drawSprout } = await import('/src/render/sprouts.ts');
    const s = window.__fbSession;
    const r = window.__fb.app.renderer;
    const ctx = r.ctx;
    const cam = s.cam;
    const shot = (fn) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#9fd6c6';
      ctx.fillRect(0, 0, r.width, r.height);
      ctx.setTransform(cam.scale, 0, 0, cam.scale, -cam.ox, -cam.oy);
      for (const b of s.birds) fn(ctx, b, s.colors[b.idx], 1.234, s.theme.ink, 'straw', false);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return ctx.getImageData(0, 0, r.width, r.height).data;
    };
    const a = shot(paintSprout);
    const b = shot(drawSprout);
    let touched = 0;
    let big = 0;
    let worst = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (a[i] !== 0x9f || a[i + 1] !== 0xd6 || a[i + 2] !== 0xc6) touched++;
      if (d > 96) big++;
      worst = Math.max(worst, d);
    }
    ctx.setTransform(cam.scale, 0, 0, cam.scale, -cam.ox, -cam.oy);
    return { touched, big, worst };
  });
  t.check(`the sprouts are the same picture in the same place, but for the anti-aliasing of thin outlines (${same.big} of ${same.touched} pixels differ by more than 96 in 255; worst ${same.worst})`, same.touched > 500 && same.big <= same.touched * 0.01 && same.worst < 160, same);
});

// ---------------------------------------------------------------- anti-aliased paths on the game canvas
// What a frame costs a GPU's canvas — a software renderer above all — is mostly how many anti-aliased
// paths it fills and strokes (a stroke ~0.65 ms each on SwiftShader). The two sprouts were ~48 strokes
// of every frame, a sign two more, the lanterns and the flower pot more again. Counted on one frame at
// the start of every level, once the camera has settled.
await part('anti-aliased paths on the game canvas', async () => {
  const ops = [];
  for (let n = 0; n < 5; n++) {
    await page.evaluate((n) => window.__fb.flow.debug(n), n);
    await waitFor(() => page.evaluate((n) => window.__fbSession?.L?.index === n && window.__fb.app.current?.constructor.name === 'Session', n), 20000, `level ${n + 1}`);
    await frames(page, 30);
    ops.push(
      await page.evaluate(() => {
        const s = window.__fbSession;
        const ctx = window.__fb.app.renderer.ctx;
        const n = { stroke: 0, fill: 0 };
        const st = ctx.stroke;
        const fi = ctx.fill;
        ctx.stroke = function (...a) {
          n.stroke++;
          return st.apply(this, a);
        };
        ctx.fill = function (...a) {
          n.fill++;
          return fi.apply(this, a);
        };
        s.render();
        delete ctx.stroke;
        delete ctx.fill;
        return { level: s.L.def.name, ...n };
      }),
    );
  }
  for (const o of ops) t.check(`${o.level}: a frame strokes ${o.stroke} paths and fills ${o.fill} on the game canvas (at most 20 and 45)`, o.stroke <= 20 && o.fill <= 45, o);
});

// ---------------------------------------------------------------- the props' pictures, more of them than are kept
// More signs at more scales and places than the pictures kept (48): the oldest are let go of, never the
// one about to be drawn (that drew a zero-sized canvas, threw every frame, and sent the game back to the
// title), and no more than 48 are kept.
await part("the props' pictures, more of them than are kept", async () => {
  const many = await page.evaluate(async () => {
    const art = await import('/src/render/art.ts');
    const { THEMES } = await import('/src/render/theme.ts');
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    let errors = 0;
    let made = 0;
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (tag, ...a) {
      if (String(tag).toLowerCase() === 'canvas') made++;
      return create.call(this, tag, ...a);
    };
    for (const s of [1.5, 1.75, 2]) {
      for (let i = 0; i < 40; i++) {
        g.setTransform(s, 0, 0, s, 0, 0);
        // (each sign drawn often enough at this scale to be stamped)
        for (let k = 0; k < 14; k++) {
          try {
            art.drawSign(g, 10 + i * 0.37, 10 + i * 0.29, THEMES.garden, i % 2 === 0);
          } catch {
            errors++;
          }
        }
      }
    }
    Document.prototype.createElement = create;
    return { errors, made };
  });
  t.check(`120 signs at three scales, more than the 48 pictures kept: every one drawn without an error (${many.errors} errors, ${many.made} pictures made)`, many.errors === 0 && many.made >= 48, many);
});

// ---------------------------------------------------------------- what gets painted again, and what's kept
// A whole evening's screens at an Xbox's 1080 rows: the level select, a level, the governor stepping
// down and back, a small resize, a big one, then the title again — counting every backdrop painted
// (each theme's first layer being painted is one) and every time the title's still picture is painted,
// and, in the middle of the level, how much canvas each part of the renderer is holding on to.
await part("what gets painted again, and what's kept", async () => {
  // every canvas the renderer makes is tagged with the file that made it, from before the game boots
  await page.evaluateOnNewDocument(() => {
    window.__canvases = [];
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (tag, ...a) {
      const el = create.call(this, tag, ...a);
      if (String(tag).toLowerCase() === 'canvas') {
        const st = new Error().stack ?? '';
        el.__from = /render\/backdrop/.test(st) ? 'backdrop' : /render\/creek/.test(st) ? 'creek' : /render\/tiles/.test(st) ? 'tiles' : 'other';
        window.__canvases.push(new WeakRef(el));
      }
      return el;
    };
  });
  await page.setViewport({ width: 1920, height: 1080 });
  await page.reload({ waitUntil: 'networkidle0' });
  await waitFor(() => page.evaluate(() => !!window.__fb?.app?.current), 20000, 'boot');
  await frames(page, 5);
  const cdp = await page.createCDPSession();
  await page.evaluate(async () => {
    const { THEMES } = await import('/src/render/theme.ts');
    const { CreekScene } = await import('/src/render/creek.ts');
    window.__paints = {};
    for (const [id, th] of Object.entries(THEMES)) {
      const L = th.layers[0];
      const p = L.paint;
      L.paint = function (...a) {
        window.__paints[id] = (window.__paints[id] ?? 0) + 1;
        return p.apply(this, a);
      };
    }
    window.__stills = 0;
    const sp = CreekScene.prototype.paint;
    CreekScene.prototype.paint = function (...a) {
      window.__stills++;
      return sp.apply(this, a);
    };
  });
  const paints = () => page.evaluate(() => ({ ...window.__paints, stills: window.__stills }));
  const since = async (before) => {
    const now = await paints();
    const d = {};
    for (const k of new Set([...Object.keys(now), ...Object.keys(before)])) if ((now[k] ?? 0) !== (before[k] ?? 0)) d[k] = (now[k] ?? 0) - (before[k] ?? 0);
    return d;
  };
  const settle = () => frames(page, 6);
  // the level select, showing the first level's scenery
  await page.evaluate(() => {
    const f = window.__fb.flow;
    f.mode = 'local';
    f.seats = ['keysL', 'keysR'];
    f.levels();
  });
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'LevelSelect'), 10000, 'the level select');
  await settle();
  let p0 = await paints();
  await page.evaluate(() => window.__fb.flow.playLevel(0));
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session' && window.__fbSession?.L?.index === 0), 10000, 'the level');
  await settle();
  const entering = await since(p0);
  t.check(`entering a level paints no backdrop: the level select already painted it (${JSON.stringify(entering)})`, !entering.garden, entering);
  // what the renderer keeps, mid-level (after a collection, so only what's really held is counted)
  await cdp.send('HeapProfiler.collectGarbage');
  await sleep(200);
  const held = await page.evaluate(() => {
    const by = {};
    for (const r of window.__canvases) {
      const c = r.deref();
      if (!c || !c.width || !c.height) continue;
      by[c.__from] = (by[c.__from] ?? 0) + c.width * c.height * 4;
    }
    const b = window.__fbSession.backdrop;
    const one = [b.sky, b.sunGlow, ...b.clouds, ...b.layers.map((l) => l.canvas)].reduce((n, c) => n + (c ? c.width * c.height * 4 : 0), 0);
    const mb = (v) => +((v ?? 0) / 2 ** 20).toFixed(1);
    return { backdropMB: mb(by.backdrop), creekMB: mb(by.creek), tilesMB: mb(by.tiles), oneBackdropMB: mb(one) };
  });
  t.check(`in a level at 1080 rows only one backdrop is kept (${held.backdropMB} MB of backdrop canvases for one of ${held.oneBackdropMB} MB; the title's still ${held.creekMB} MB, tiles ${held.tilesMB} MB)`, held.backdropMB <= held.oneBackdropMB * 1.05 + 0.1, held);
  // the governor steps down and back up, a small resize and back: nothing is painted again
  p0 = await paints();
  await page.evaluate(() => window.__fb.app.renderer.setScale(0.85));
  await settle();
  await page.evaluate(() => window.__fb.app.renderer.setScale(1));
  await settle();
  const governor = await since(p0);
  t.check(`a governor step down and back up paints no backdrop (${JSON.stringify(governor)})`, !governor.garden, governor);
  p0 = await paints();
  await page.setViewport({ width: 1920, height: 1037 });
  await settle();
  await page.setViewport({ width: 1920, height: 1080 });
  await settle();
  const small = await since(p0);
  t.check(`a small resize (4% shorter, and back) paints no backdrop (${JSON.stringify(small)})`, !small.garden, small);
  // a big one (a window maximised, a phone turned) still does: scaled that far it would be soft
  p0 = await paints();
  await page.setViewport({ width: 1000, height: 1400 });
  await settle();
  const big = await since(p0);
  t.check(`a big resize paints the backdrop afresh (${JSON.stringify(big)})`, big.garden >= 1, big);
  await page.setViewport({ width: 1920, height: 1080 });
  await settle();
  // and back to the title: its still picture is already painted
  p0 = await paints();
  await page.evaluate(() => window.__fb.flow.title());
  await waitFor(() => page.evaluate(() => window.__fb.app.current?.constructor.name === 'TitleScreen'), 10000, 'the title');
  await settle();
  const title = await since(p0);
  t.check(`coming back to the title paints nothing (${JSON.stringify(title)})`, !title.stills && !title.creek, title);
  await page.setViewport({ width: 1280, height: 720 });
});

await browser.close();
t.finish('paint', page.errors);
