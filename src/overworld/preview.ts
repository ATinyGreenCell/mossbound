/**
 * The overworld's preview page (overworld.html, dev only: `npm run dev`, then /overworld.html).
 * Not part of the game's build: nothing in the game imports this, and Vite builds index.html alone.
 *
 * URL switches (combine with &):
 *   cleared=garden,woods   levels cleared (`all`: every level that exists)
 *   ff=garden:2,woods:3    fireflies found per level (how many of 3)
 *   best=garden:83         best times, seconds
 *   run=woods:1            a run in progress, continuing from lantern 1 (0 = from the start)
 *   at=mill                the stop to start on
 *   worlds=50              a long map: the three worlds, then made-up ones repeating them
 *   extra=tower            one more made-up world at the end, in a level's theme (the generic map theme)
 *   stats                  frame time and chunk counts, top right
 *   auto                   walk the whole open trail, end to end and back (for measuring)
 *   coords                 the card says where the stop is from its world's gate (for `at:` in worlds.ts)
 *   slow=4                 everything four times slower (for looking at a walk frame by frame)
 * Keys: arrows / WASD walk, Enter / Space / Z is Ⓐ, Esc closes the story. Pads and touch work too.
 * C clears the level you're on (watch the bloom and the vines), F finds a firefly there, R starts over.
 */
import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-600.css';
import { settings } from '../core/settings';
import { kindsFor } from '../game/traits';
import { levelDef, spotOf, WORLDS, type WorldDef } from '../game/worlds';
import { CARD_CSS, cardHtml } from './card';
import type { MapProgress } from './layout';
import { OverworldMap, type MapEvent } from './map';
import { stressWorlds } from './stress';
import { setCpuChunks } from './paint';

if (new URLSearchParams(location.search).has('gpuchunks')) setCpuChunks(false);

const q = new URLSearchParams(location.search);
const worlds: WorldDef[] = q.has('worlds') ? stressWorlds(Math.max(1, Math.min(200, Number(q.get('worlds')) || 3))) : [...WORLDS];
// extra=tower: one more made-up world at the end, in that theme (a level theme: the generic map theme made from it)
const extraTheme = q.get('extra');
if (extraTheme)
  worlds.push({
    id: `extra-${extraTheme}`,
    name: `A ${extraTheme} world`,
    mapTheme: extraTheme,
    levels: [`${extraTheme}-1`, `${extraTheme}-2`, { id: `${extraTheme}-bonus`, from: `${extraTheme}-2`, name: 'A bonus level' }, `${extraTheme}-3`, `${extraTheme}-4`, `${extraTheme}-5`],
    boss: { name: 'Old Snip', line: 'back again', art: 'snip' },
    story: ['A world made of nothing but one line of data.'],
  });
const pairs = (key: string) => (q.get(key) ?? '').split(',').filter(Boolean).map((p) => p.split(':') as [string, string?]);

function progressFromUrl(): MapProgress {
  const all = worlds.flatMap((w) => w.levels.map(spotOf).map((s) => s.id)).filter((id) => levelDef(id));
  const cleared = new Set(q.get('cleared') === 'all' ? all : pairs('cleared').map(([id]) => id));
  const fireflies: Record<string, number> = {};
  for (const [id, n] of pairs('ff')) fireflies[id] = (1 << Math.max(0, Math.min(3, Number(n) || 0))) - 1;
  const best: Record<string, number> = {};
  for (const [id, s] of pairs('best')) best[id] = Number(s) || 0;
  const lantern: Record<string, number> = {};
  for (const [id, k] of pairs('run')) lantern[id] = (Number(k) || 0) - 1;
  return { cleared, fireflies, best, lantern };
}

// ------------------------------------------------------------------ the page

const style = document.createElement('style');
style.textContent = `
html, body { margin: 0; height: 100%; overflow: hidden; background: #1d2b4a; touch-action: none; user-select: none; -webkit-user-select: none; }
canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; }
.ow-story { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(20,24,40,0.45); font-family: 'Fredoka', system-ui, sans-serif; }
.ow-story.hide { display: none; }
.ow-book { width: min(560px, 86vw); padding: 22px 28px; border-radius: 18px; background: #fff6e2; color: #2b2140; box-shadow: 0 10px 40px rgba(0,0,0,0.35); font-size: clamp(15px, 2.6vh, 21px); line-height: 1.4; }
.ow-book h2 { margin: 0 0 8px; color: #8a5a34; font-size: 0.8em; letter-spacing: 0.08em; text-transform: uppercase; }
.ow-book .more { margin-top: 14px; color: #8a5a34; font-weight: 600; font-size: 0.8em; }
.ow-toast { position: fixed; left: 50%; top: 42%; transform: translate(-50%, -50%); color: #fff8ea; font: 600 clamp(16px, 3vh, 26px) 'Fredoka', system-ui, sans-serif; }
.ow-perf { position: fixed; right: 8px; top: 8px; padding: 6px 10px; border-radius: 8px; background: rgba(0,0,0,0.55); color: #e8ffd0; font: 12px/1.35 ui-monospace, monospace; white-space: pre; pointer-events: none; }
${CARD_CSS}`;
document.head.appendChild(style);
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d', { alpha: false })!;
const card = document.createElement('div');
card.className = 'ow-card hide';
document.body.appendChild(card);
const story = document.createElement('div');
story.className = 'ow-story hide';
document.body.appendChild(story);
const toast = document.createElement('div');
toast.className = 'ow-toast';
document.body.appendChild(toast);
const statsEl = q.has('stats') ? document.body.appendChild(Object.assign(document.createElement('div'), { className: 'ow-perf' })) : null;

let storyPages: string[] = [];
let storyAt = 0;
let storyTitle = '';
function showStory() {
  story.classList.toggle('hide', !storyPages.length);
  if (!storyPages.length) return;
  const last = storyAt >= storyPages.length - 1;
  story.innerHTML = `<div class="ow-book"><h2>${storyTitle}</h2>${storyPages[storyAt]}<div class="more">${last ? 'Ⓐ close' : 'Ⓐ turn the page'}</div></div>`;
}
function storyNext() {
  storyAt++;
  if (storyAt >= storyPages.length) storyPages = [];
  showStory();
}

/** ?coords: where a stop sits from its world's gate, to copy into worlds.ts as `at: [x, y]` */
function coords(id: string) {
  if (!q.has('coords')) return '';
  const L = map.L;
  const n = L.nodes[L.byId.get(id)!];
  const g = L.nodes[L.regions[n.world].gate];
  return `<div class="ow-sub">at: [${Math.round(n.x - g.x)}, ${Math.round(n.y - g.y)}]</div>`;
}

let progress = progressFromUrl();
const kinds = kindsFor(settings.even, settings.swap);
const map: OverworldMap = new OverworldMap({
  worlds,
  progress,
  at: q.get('at') ?? undefined,
  colors: [settings.color, settings.color + 1],
  kinds,
  hats: [settings.hat, 'none'],
  onEvent: (e: MapEvent) => {
    if (e.type === 'focus') {
      if (e.info) card.innerHTML = cardHtml(e.info) + coords(e.info.id);
      card.classList.toggle('hide', !e.info);
    } else if (e.type === 'enter') {
      toast.textContent = `→ ${map.L.nodes[map.L.byId.get(e.id)!].name}`;
      setTimeout(() => {
        toast.textContent = '';
        map.reopen();
      }, 900);
    } else if (e.type === 'story') {
      storyPages = e.pages;
      storyAt = 0;
      storyTitle = `World ${e.world + 1} · ${worlds[e.world].name}`;
      showStory();
    }
  },
});

// ------------------------------------------------------------------ input: keys, pads, taps

const keys = new Set<string>();
let pressed = false;
/** the direction of the last press: a tap can come and go between two frames */
let pressDir: [number, number] = [0, 0];
let aPressed = false;
const DIRS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
};
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (DIRS[e.code]) {
    pressed = true;
    pressDir = DIRS[e.code];
  }
  if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyZ') {
    if (storyPages.length) storyNext();
    else aPressed = true;
  }
  if (e.code === 'Escape' || e.code === 'KeyX') {
    storyPages = [];
    showStory();
  }
  const here = map.L.nodes[map.cur];
  if (e.code === 'KeyC' && here.playable) {
    progress = { ...progress, cleared: new Set([...progress.cleared, here.id]) };
    map.setProgress(progress, true);
  }
  if (e.code === 'KeyF' && here.playable) {
    const m = progress.fireflies?.[here.id] ?? 0;
    progress = { ...progress, fireflies: { ...progress.fireflies, [here.id]: ((m << 1) | 1) & 7 } };
    map.setProgress(progress, false);
  }
  if (e.code === 'KeyR') {
    progress = { cleared: new Set() };
    map.setProgress(progress, false);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('pointerdown', (e) => {
  if (storyPages.length) return storyNext();
  map.tap(e.offsetX, e.offsetY);
});
story.addEventListener('pointerdown', () => storyNext());
card.addEventListener('pointerdown', () => map.act());

let padDir = '';
let padA = false;
function readPad(): [number, number] {
  for (const p of navigator.getGamepads?.() ?? []) {
    if (!p) continue;
    let x = p.axes[0] ?? 0;
    let y = p.axes[1] ?? 0;
    if (Math.hypot(x, y) < 0.5) x = y = 0;
    if (p.buttons[14]?.pressed) x = -1;
    if (p.buttons[15]?.pressed) x = 1;
    if (p.buttons[12]?.pressed) y = -1;
    if (p.buttons[13]?.pressed) y = 1;
    // a new direction (an eighth of a turn round) counts as a press
    const dir = x || y ? String(Math.round((Math.atan2(y, x) / Math.PI) * 4)) : '';
    if (dir && dir !== padDir) {
      pressed = true;
      pressDir = [x, y];
    }
    padDir = dir;
    const a = !!p.buttons[0]?.pressed;
    if (a && !padA) {
      if (storyPages.length) storyNext();
      else aPressed = true;
    }
    if (p.buttons[1]?.pressed && storyPages.length) {
      storyPages = [];
      showStory();
    }
    padA = a;
    if (x || y) return [x, y];
  }
  return [0, 0];
}

// ------------------------------------------------------------------ the loop

let W = 0;
let H = 0;
let dpr = 1;
function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  W = Math.round(innerWidth * dpr);
  H = Math.round(innerHeight * dpr);
  canvas.width = W;
  canvas.height = H;
}
window.addEventListener('resize', resize);
resize();

// auto: walk to the far end of what's open, and back, for ever (for measuring)
const auto = q.has('auto');
let autoTo = '';
function autoWalk() {
  if (map.walking) return;
  const open = map.L.nodes.filter((n) => n.main && map.state.node[n.i] !== 0);
  const far = open[open.length - 1]?.id ?? '';
  autoTo = map.L.nodes[map.cur].id === far ? map.L.nodes[0].id : far;
  map.walkTo(autoTo);
}

/** per frame: [draw ms, ms since the frame before, chunks painted, ms painting them] — for scripts */
const frames: number[][] = [];
const ow = { map, frames, recording: false };
(window as unknown as { __ow: typeof ow }).__ow = ow;

let last = performance.now();
let acc = { n: 0, draw: 0, worst: 0, int: 0, t: 0 };
const slow = Math.max(1, Number(q.get('slow')) || 1);
function frame(now: number) {
  const dt = (now - last) / 1000 / slow;
  last = now;
  let [x, y] = readPad();
  if (!x && !y) {
    for (const k of keys) {
      const d = DIRS[k];
      if (d) {
        x += d[0];
        y += d[1];
      }
    }
  }
  // (a key tapped and let go since the last frame still counts, in the direction it was)
  if (pressed && !x && !y) [x, y] = pressDir;
  if (auto) autoWalk();
  const bakes0 = map.chunks.stats.bakes;
  const bakeMs0 = map.chunks.stats.bakeMs;
  map.update(dt, { x: Math.sign(x), y: Math.sign(y), pressed, a: aPressed });
  pressed = false;
  aPressed = false;
  map.draw(ctx, W, H, dpr);
  const s = map.chunks.stats;
  if (ow.recording) frames.push([map.stats.drawMs, dt * 1000 * slow, s.bakes - bakes0, s.bakeMs - bakeMs0, ...map.stats.parts]);
  if (statsEl) {
    acc.n++;
    acc.draw += map.stats.drawMs;
    acc.worst = Math.max(acc.worst, map.stats.drawMs);
    acc.int += dt * 1000;
    acc.t += dt;
    if (acc.t > 0.5) {
      statsEl.textContent = `${(1000 / (acc.int / acc.n)).toFixed(0)} fps  draw ${(acc.draw / acc.n).toFixed(2)} ms (worst ${acc.worst.toFixed(1)})
chunks ${s.visible} on screen, ${s.live} kept (peak ${s.peak})
painted ${s.bakes}, ${(s.bakeMs / Math.max(1, s.bakes)).toFixed(1)} ms each (worst ${s.maxBakeMs.toFixed(1)})
grown ${map.painter.scatterMs.toFixed(0)} ms · ${map.L.regions.length} worlds, ${map.L.nodes.length} stops`;
      acc = { n: 0, draw: 0, worst: 0, int: 0, t: 0 };
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
