// Shared helpers for the end-to-end tests. Tests wait on the game's own state, never on fixed sleeps
// alone, so they stay reliable when many run in parallel on a busy machine.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

/** Chrome/Chromium binary (puppeteer-core brings no browser of its own). */
export const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
/** Dev server root; run.mjs starts one and passes it in. */
export const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:5199/';
/** Screenshots and logs (git-ignored). */
export const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '.out');
fs.mkdirSync(OUT, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Online play reaches out to public Nostr relays and MQTT brokers, and one of them being down is
 * normal (pairing goes through the others) — but the browser logs every failed attempt. Not a game error.
 */
export const relayNoise = (text) => /WebSocket connection to 'wss:\/\/[^']+' failed|ERR_NAME_NOT_RESOLVED|net::ERR_|Failed to load resource/.test(text);
/** Warnings caused by the tests themselves (pixel readbacks to check what's drawn), not by the game. */
export const testNoise = (text) => /willReadFrequently/.test(text);

/** The game URL with dev-only test switches: always ?fast, plus ?noaudio unless the test listens. */
export const url = ({ audio = false, extra = '', base = BASE } = {}) => `${base}?fast${audio ? '' : '&noaudio'}${extra ? `&${extra}` : ''}`;

/**
 * Headless Chrome on the machine's GPU (like a real phone or laptop: a level runs at a steady 60 fps).
 * E2E_SWIFTSHADER=1 uses the CPU renderer instead (no GPU, e.g. CI) — everything still passes, slowly.
 */
export async function launch() {
  const gpu = process.env.E2E_SWIFTSHADER ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--use-angle=default', '--enable-gpu-rasterization'];
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // (two pages are two devices: neither may be throttled as a background tab)
    args: [...gpu, '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  });
}

/** Edge on an Xbox Series X. */
export const XBOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

/**
 * A page that records errors. `pads` installs that many fake standard-mapping gamepads (window.__pads);
 * `hidePads` keeps them out of getGamepads() until window.__padsHidden is cleared, as a browser does
 * until a controller is first pressed. `storage` seeds localStorage before the game boots.
 */
export async function open(browser, { viewport = { width: 1280, height: 720 }, ua, pads = 0, hidePads = false, storage, query = {}, context } = {}) {
  // reuse Chrome's first blank tab: a page opened beside it is a background tab, and background tabs
  // get (almost) no animation frames — the game would barely run
  let page;
  if (!context) {
    const blank = (await browser.pages()).find((p) => p.url() === 'about:blank' && !p.__taken);
    page = blank ?? (await browser.newPage());
  } else page = await context.newPage();
  page.__taken = true;
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
  page.on('console', (m) => {
    const t = m.text();
    if ((m.type() === 'error' || m.type() === 'warn' || m.type() === 'warning') && !relayNoise(t) && !testNoise(t)) errors.push(`[${m.type()}] ${t}`);
  });
  if (ua) await page.setUserAgent(ua);
  await page.evaluateOnNewDocument(
    (pads, storage, hidePads) => {
      if (storage) for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
      if (pads > 0) {
        const mk = (i) => ({ index: i, id: `Test Pad ${i}`, mapping: 'standard', connected: true, timestamp: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] });
        window.__pads = Array.from({ length: pads }, (_, i) => mk(i));
        window.__padsHidden = hidePads;
        navigator.getGamepads = () => [0, 1, 2, 3].map((i) => (window.__padsHidden ? null : (window.__pads[i] ?? null)));
      }
    },
    pads,
    storage ?? null,
    hidePads,
  );
  await page.setViewport(viewport);
  await page.goto(url(query), { waitUntil: 'networkidle0' });
  await page.bringToFront();
  await waitFor(() => page.evaluate(() => !!window.__fb?.app?.current), 20000, 'boot');
  page.errors = errors;
  return page;
}

export async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(60);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Resolve after `n` animation frames (gamepads are polled once a frame). */
export const frames = (page, n) => page.evaluate((n) => new Promise((done) => { const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : done()); step(n); }), n);

/** Press a fake gamepad button for a couple of whole frames. */
export async function padPress(page, pad, button, hold = 2) {
  await page.evaluate((p, b) => { window.__pads[p].buttons[b] = { pressed: true, touched: true, value: 1 }; }, pad, button);
  await frames(page, hold);
  await page.evaluate((p, b) => { window.__pads[p].buttons[b] = { pressed: false, touched: false, value: 0 }; }, pad, button);
  await frames(page, 2);
}

export const padAxis = (page, pad, x, y = 0) => page.evaluate((p, x, y) => { window.__pads[p].axes[0] = x; window.__pads[p].axes[1] = y; }, pad, x, y);

export const screenName = (page) => page.evaluate(() => window.__fb?.app?.current?.constructor?.name ?? null);

/** Results reporter: `check(name, ok, detail)` prints a line; `finish(label)` prints the verdict and errors. */
export function reporter() {
  const checks = [];
  return {
    check(name, ok, detail = '') {
      checks.push(!!ok);
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
    },
    finish(label, errors = []) {
      const ok = checks.length > 0 && checks.every(Boolean);
      console.log(ok ? `${label} OK` : `${label} FAILED`);
      console.log('--- errors ---');
      console.log(errors.join('\n') || 'none');
      return ok && !errors.length;
    },
  };
}

/**
 * In-page simulation rig (no rendering): a level, two birds, the string and scripted controls, using
 * the game's own modules from the dev server. Installed as window.__rig(levelDefOrIndex).
 */
export async function installRig(page) {
  await page.evaluate(async () => {
    const { parseLevel } = await import('/src/game/level.ts');
    const { LEVELS } = await import('/src/game/levels.ts');
    const { World } = await import('/src/game/world.ts');
    const { Bird } = await import('/src/game/bird.ts');
    const { Tether } = await import('/src/game/tether.ts');
    const { makeControls } = await import('/src/core/input.ts');
    /** `kinds`: which sprout each bird is (see src/game/traits.ts) */
    window.__rig = (def, kinds = ['even', 'even']) => {
      const L = typeof def === 'number' ? parseLevel(LEVELS[def], def) : parseLevel(def, 0);
      const world = new World(L);
      const birds = [new Bird(0), new Bird(1)];
      birds.forEach((b, i) => { b.setKind(kinds[i]); b.place(L.spawns[i]); });
      const tether = new Tether(world);
      tether.reset(birds[0], birds[1]);
      const c = [makeControls(), makeControls()];
      let t = 0;
      const rig = {
        L, world, birds, tether, c, T: 32,
        /** put a bird with its feet on tile row `ty` (column tx) */
        place(i, tx, ty) { birds[i].place({ x: tx * 32 + 16, y: ty * 32 - 10.01 }); },
        reset() { tether.reset(birds[0], birds[1]); },
        /** set the clock that moving platforms run on */
        at(s) { t = s; world.setTime(s); },
        /** one physics step of `dt` seconds, leaving the one-shot presses for step()/frame() to spend */
        one(dt) {
          t += dt;
          world.stepMovers(t);
          for (let i = 0; i < 2; i++) {
            const b = birds[i];
            const o = birds[1 - i];
            if (b.ghost) { b.stepGhost(dt, world, o, L.spawns[i]); continue; }
            b.rope = tether.ends[i];
            b.lifting = b.grounded && b.rope.taut && !o.grounded && o.hanging;
            b.step(dt, c[i], world, o);
          }
          tether.follow(birds[0], birds[1]);
          tether.solve(birds, [true, true], dt);
          for (let i = 0; i < 2; i++) {
            birds[i].rope = tether.ends[i];
            birds[i].afterRope(world);
            birds[i].fx.length = 0;
            // (as the session does: letting go of the vine lets go of any ring it was shot over)
            if (birds[i].droppedVine || birds[i].ghost) rig.unhook(i);
            birds[i].droppedVine = false;
          }
          world.stepDynamic(dt, birds);
        },
        edges() { for (const cc of c) cc.jumpPressed = cc.tugPressed = cc.dashPressed = cc.shootPressed = cc.heartPressed = cc.heyPressed = false; },
        step(n = 1) { for (let k = 0; k < n; k++) { this.one(1 / 120); this.edges(); } },
        /**
         * One animation frame of `dt` seconds: sub-stepped and spending the one-shot presses on the
         * first sub-step, exactly as app.ts does. A held button stays held for the whole frame — so
         * this is what a test asks when the question is what a screen's refresh rate changes.
         */
        frame(dt) {
          const steps = Math.min(10, Math.max(1, Math.ceil(dt * 120 - 1e-6)));
          const h = dt / steps;
          for (let i = 0; i < steps; i++) {
            this.one(h);
            if (i === 0) this.edges();
          }
          this.edges();
        },
        secs(s) { this.step(Math.round(s * 120)); },
        /** run until pred() or timeout (s); returns seconds taken or -1 */
        until(pred, s) { for (let k = 0; k < s * 120; k++) { this.step(); if (pred()) return +(k / 120).toFixed(2); } return -1; },
        jump(i) { c[i].jump = true; c[i].jumpPressed = true; },
        /**
         * The session's vine shot (see Session.shoot): the ring most nearly where the stick points,
         * within this sprout's reach. Its numbers are copied from tuning.ts, as the yank's are.
         */
        shootAt(i, mx = 0, my = 0) {
          const b = birds[i];
          if (b.ghost || b.shotCd > 0) return null;
          if (tether.hooked(i)) {
            this.unhook(i);
            b.shotCd = 0.15;
            return null;
          }
          let ax = Math.abs(mx) > 0.3 ? mx : 0;
          let ay = Math.abs(my) > 0.3 ? -my : 0;
          if (!ax && !ay) { ax = b.facing; ay = -1.1; }
          const an = Math.hypot(ax, ay);
          ax /= an;
          ay /= an;
          const kx = b.x;
          const ky = b.y + b.ropeOff;
          const reach = b.traits.shot * 32;
          let best = null;
          let bestScore = -Infinity;
          for (const p of L.pegs) {
            const dx = p.x - kx, dy = p.y - ky, d = Math.hypot(dx, dy);
            if (d < 12 || d > reach) continue;
            const dot = (dx / d) * ax + (dy / d) * ay;
            if (dot < 0.35) continue;
            const score = dot - d / (reach * 6);
            if (score > bestScore) { bestScore = score; best = p; }
          }
          b.shotCd = 0.3;
          const other = birds[1 - i];
          if (!best || !other.present || other.ghost || !tether.shoot(i, best, b, other, reach)) return null;
          b.anchored = false;
          b.cling = 0;
          b.climbLen = Math.min(256, Math.max(18, Math.hypot(kx - best.x, ky - best.y) - 10));
          b.hooked = true;
          return best;
        },
        /** let go of the ring this sprout shot */
        unhook(i) {
          const b = birds[i];
          if (!tether.hooked(i)) return;
          tether.release(i);
          b.hooked = false;
          if (b.grounded || !b.hanging) {
            b.hanging = false;
            b.climbLen = Infinity;
          }
        },
        /** the session's tug yank, toward the bird's pivot */
        yank(i) {
          const b = birds[i]; const e = tether.ends[i];
          const dx = e.pivot.x - b.x, dy = e.pivot.y - b.y, d = Math.hypot(dx, dy);
          const tau = Math.min(0.5, Math.max(0.28, d / 640));
          let vx = (dx / tau) * 0.88, vy = (dy * 0.88) / tau - 0.5 * 1900 * 0.55 * tau - 140;
          const sp = Math.hypot(vx, vy); if (sp > 980) { vx *= 980 / sp; vy *= 980 / sp; }
          // (as Session.yank does, down to spending the coyote window — the throw is the launch)
          Object.assign(b, { vx, vy, grounded: false, hanging: false, anchored: false, cling: 0, climbLen: Infinity, tuggedT: 0.45, jumping: false, groundMover: -1, coyote: 0, jumpBuf: 0, jumpHold: 0 });
        },
        tile(i) { return { tx: +(birds[i].x / 32).toFixed(2), ty: +((birds[i].y + 10) / 32).toFixed(2) }; },
      };
      return rig;
    };
  });
}
