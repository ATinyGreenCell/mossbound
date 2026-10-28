import { Input } from './core/input';
import { settings } from './core/settings';
import { IS_XBOX, XBOX_REFOCUS } from './core/platform';
import { NO_RENDER } from './core/testmode';
import { Renderer } from './render/renderer';

export interface Screen {
  update(dt: number): void;
  render(): void;
  dispose(): void;
  /**
   * The screen takes over (the one before it has been disposed). Switch on what's shared — the touch
   * controls, the wake lock — here, not in the constructor: the old screen switches them off on its
   * way out, after this one was built.
   */
  enter?(): void;
  /** The page lost focus or was hidden — pause if that matters for this screen. */
  suspend?(): void;
  /** Called once per frame before the physics sub-steps (input already polled). */
  frame?(dt: number): void;
}

/** Implemented by the on-screen touch controls (src/core/touch.ts). */
export interface TouchHooks {
  /** Show the touch controls (only while a level is live and unpaused). */
  setPlayActive(on: boolean): void;
  /** Offer the DASH button (this player's sprout can dash). */
  setDash?(on: boolean): void;
  poll(): void;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The part of a screen wake lock (WakeLockSentinel) we use; not every browser has the API. */
interface WakeLockLike {
  readonly released?: boolean;
  release(): Promise<void>;
}

/** Physics never steps more than this at once; slow frames are split into several sub-steps. */
const MAX_STEP = 1 / 120;
const MAX_SUBSTEPS = 10;

/**
 * Adaptive quality: trades resolution for frame rate when drawing can't keep up with the display, and
 * claws resolution back when there's headroom.
 *
 * It measures against the display's own frame interval — the quick end of recent frames: 16.7 ms at
 * 60 Hz, 8.3 at 120, 33 when a phone in low-power mode caps the browser at 30 — not a fixed 60 Hz
 * yardstick. And it checks its work: a step down that doesn't make frames quicker is taken back and not
 * tried again for a while (the limit is elsewhere, the CPU or a frame-rate cap, and a blurrier picture
 * would buy nothing); a step up that brings the trouble back is undone, and the next waits longer.
 */
export class Governor {
  level = 1;
  private ema = 0;
  /** the display's frame interval (ms) */
  private vsync = 0;
  private second: number[] = [];
  private timer = 0;
  private clock = 0;
  private goodFor = 0;
  /** seconds of headroom wanted before a step up */
  private patience = 5;
  /** the latest step up, on probation for a few seconds: from where, and when */
  private raised: { from: number; at: number } | null = null;
  /** a step down on trial: taken back unless frames got quicker */
  private trial: { from: number; ema: number; at: number } | null = null;
  /** no steps down before then (after one that didn't help), and how long the next such pause is */
  private calmUntil = 0;
  private calm = 10;

  /** Another screen, another load: what was learnt about the last one no longer holds. */
  newScene() {
    this.patience = 5;
    this.raised = this.trial = null;
    this.calmUntil = 0;
    this.calm = 10;
    this.goodFor = 0;
  }

  sample(rawMs: number, dt: number): number | null {
    if (rawMs > 250) return null; // tab switch / breakpoint, not a real frame
    if (rawMs >= 4) this.second.push(rawMs);
    this.ema = this.ema ? this.ema + (rawMs - this.ema) * 0.06 : rawMs;
    this.clock += dt;
    this.timer += dt;
    if (this.timer < 1) return null;
    this.timer = 0;
    // the display's interval: the quick end of this second's frames (not the very quickest: an odd early
    // frame isn't a faster display), followed down at once and up only slowly (slow frames are more
    // often load than a slower display)
    if (this.second.length) {
      const s = this.second.sort((a, b) => a - b);
      const m = s[Math.floor(s.length * 0.1)];
      this.vsync = !this.vsync || m < this.vsync ? m : this.vsync + (m - this.vsync) * 0.05;
      this.second.length = 0;
    }
    const now = this.clock;
    if (this.trial) {
      if (now - this.trial.at < 2) return null;
      const t = this.trial;
      this.trial = null;
      if (this.ema > t.ema * 0.9) {
        this.calmUntil = now + this.calm;
        this.calm = Math.min(160, this.calm * 2);
        this.level = t.from;
        this.goodFor = 0;
        return this.level;
      }
      this.calm = 10;
    }
    const slow = this.ema > this.vsync * 1.12;
    if (slow && this.raised && now - this.raised.at < 6) {
      // that step up was one too many: back to where it was fine
      this.level = this.raised.from;
      this.raised = null;
      this.patience = Math.min(80, this.patience * 2);
      this.goodFor = 0;
      return this.level;
    }
    if (slow && this.level > 0.5 && now >= this.calmUntil) {
      this.trial = { from: this.level, ema: this.ema, at: now };
      this.level = Math.max(0.5, round2(this.level - 0.15));
      this.goodFor = 0;
      return this.level;
    }
    this.goodFor = this.ema < this.vsync * 1.04 ? this.goodFor + 1 : 0;
    if (this.goodFor >= this.patience && this.level < 1) {
      this.goodFor = 0;
      this.raised = { from: this.level, at: now };
      this.level = Math.min(1, round2(this.level + 0.1));
      return this.level;
    }
    return null;
  }
}

/** Owns the renderer, input and the active screen; runs the frame loop. */
export class App {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly ui: HTMLDivElement;
  touch: TouchHooks | null = null;
  /** Called when the active screen keeps throwing — the flow sends the player back to the title. */
  onRecover: (() => void) | null = null;
  /** A gamepad button went down this frame (Chromium counts that as a user gesture: audio can start). */
  onPadPress: (() => void) | null = null;
  /** seconds since boot, advanced by real frame time (clamped) */
  time = 0;
  /** this frame's vsync timestamp (performance.now() timeline): what the frame shows */
  frameNow = 0;
  private screen: Screen | null = null;
  private pending: Screen | null = null;
  private last = 0;
  private governor = new Governor();
  private errors: number[] = [];
  private fpsEl: HTMLDivElement | null = null;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private wakeLock: WakeLockLike | null = null;
  private wantAwake = false;
  private wakeBusy = false;
  /** Edge on Xbox: seconds the page has been showing without focus, and the note that says so */
  private unfocused = 0;
  private refocusEl: HTMLDivElement | null = null;

  constructor(readonly root: HTMLElement) {
    this.renderer = new Renderer(root);
    this.ui = document.createElement('div');
    this.ui.className = 'ui';
    root.appendChild(this.ui);
    this.input = new Input(root);
    this.applyPerf();
    const suspend = () => this.screen?.suspend?.();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) suspend();
      // (the browser lets go of the wake lock while the page is hidden: take it again)
      else void this.syncWake();
    });
    window.addEventListener('blur', suspend);
    window.addEventListener('error', (e) => console.error('[mossbound]', e.error ?? e.message));
    window.addEventListener('unhandledrejection', (e) => console.error('[mossbound] unhandled rejection', e.reason));
  }

  get current() {
    return this.screen;
  }

  /**
   * The screen about to take over (or the current one). Network messages go here: a level that was
   * just created must get its partner's first messages even before its first frame.
   */
  get next() {
    return this.pending ?? this.screen;
  }

  /** Apply the PERFORMANCE setting (auto lets the governor decide). */
  applyPerf() {
    if (settings.perf === 'high') this.renderer.setScale(1);
    else if (settings.perf === 'low') this.renderer.setScale(0.6);
    else this.renderer.setScale(this.governor.level);
  }

  /** Particle density for the current performance level. */
  get fxDensity() {
    if (settings.perf === 'low') return 0.5;
    if (settings.perf === 'high') return 1;
    return this.governor.level < 0.75 ? 0.6 : 1;
  }

  /** Swap screens at the start of the next frame, so a screen can request a change mid-update. */
  setScreen(s: Screen) {
    this.pending?.dispose();
    this.pending = s;
  }

  /** Keep the phone's screen on while playing (no-op where unsupported). */
  keepAwake(on: boolean) {
    this.wantAwake = on;
    void this.syncWake();
  }

  /**
   * Bring the wake lock in line with what's wanted. Requests and releases take a moment, and screens
   * switch it on and off in quick succession: one at a time, until it matches the latest wish.
   */
  private async syncWake() {
    if (this.wakeBusy) return;
    this.wakeBusy = true;
    try {
      for (let i = 0; i < 4; i++) {
        const held = this.wakeLock !== null && !this.wakeLock.released;
        if (this.wantAwake && !held && !document.hidden) {
          const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<WakeLockLike> } }).wakeLock;
          if (!wl) break;
          this.wakeLock = await wl.request('screen');
        } else if (!this.wantAwake && this.wakeLock) {
          const lock = this.wakeLock;
          this.wakeLock = null;
          await lock.release();
        } else break;
      }
    } catch {
      // denied or unsupported
    } finally {
      this.wakeBusy = false;
    }
  }

  start() {
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const rawMs = now - this.last;
    this.last = now;
    this.frameNow = now;
    // clamp: a background tab or a long GC pause must not fast-forward the world
    const dt = Math.min(0.1, Math.max(0, rawMs / 1000) || 0);
    this.time += dt;
    if (IS_XBOX) this.watchFocus(dt);
    if (this.pending) {
      const old = this.screen;
      this.screen = this.pending;
      this.pending = null;
      try {
        old?.dispose();
      } catch (err) {
        console.error('[mossbound] dispose failed', err);
      }
      try {
        this.screen.enter?.();
      } catch (err) {
        console.error('[mossbound] enter failed', err);
      }
      this.governor.newScene();
      this.input.flush();
    }
    this.renderer.flush();
    if (this.renderer.lost || !this.screen) return;

    if (settings.perf === 'auto') {
      const lvl = this.governor.sample(rawMs, dt);
      if (lvl !== null) this.renderer.setScale(lvl);
    }
    this.updateFps(rawMs);

    try {
      // (checked before update(), which consumes this frame's key presses)
      if (this.input.wasPressed('Backquote')) this.toggleFps();
      this.input.update();
      if (this.input.padPressed) this.onPadPress?.();
      this.touch?.poll();
      this.screen.frame?.(dt);
      // A frame of no length — two animation callbacks sharing a timestamp, or a tab coming back —
      // has nothing to advance, and dividing by it leaves the vine's solver (and then the camera,
      // for good) at NaN. Menus still ran above, so this frame's presses are still spent.
      if (dt > 0) {
        // sub-step slow frames so collisions, swings and jump arcs behave the same at 30 fps as at 144 fps
        const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / MAX_STEP - 1e-6)));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
          this.screen.update(h);
          if (this.pending) break;
          // one-shot presses must only be seen by the first sub-step of a frame
          if (i === 0) this.input.clearEdges();
        }
      } else this.input.clearEdges();
      if (!this.pending && !NO_RENDER) this.screen.render();
    } catch (err) {
      this.handleError(err, now);
    }
  };

  /**
   * Edge on Xbox can leave the page showing but without focus (the View button's full screen does it,
   * and so can the guide), and then no controller reaches the game until the Xbox button is pressed
   * twice. A local level pauses on the way (blur); this says how to get the controllers back.
   */
  private watchFocus(dt: number) {
    this.unfocused = !document.hidden && !document.hasFocus() ? this.unfocused + dt : 0;
    const show = this.unfocused > 1;
    if (show === !!this.refocusEl) return;
    if (show) {
      this.refocusEl = document.createElement('div');
      this.refocusEl.className = 'xbox-refocus';
      this.refocusEl.textContent = XBOX_REFOCUS;
      this.root.appendChild(this.refocusEl);
    } else {
      this.refocusEl!.remove();
      this.refocusEl = null;
    }
  }

  private handleError(err: unknown, now: number) {
    console.error('[mossbound] frame error', err);
    this.errors.push(now);
    this.errors = this.errors.filter((t) => now - t < 3000);
    // a one-off glitch is survivable; a screen that throws every frame gets replaced
    if (this.errors.length >= 5 && this.onRecover) {
      this.errors.length = 0;
      this.onRecover();
    }
  }

  private toggleFps() {
    if (this.fpsEl) {
      this.fpsEl.remove();
      this.fpsEl = null;
      return;
    }
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps-meter';
    this.root.appendChild(this.fpsEl);
  }

  private updateFps(ms: number) {
    if (!this.fpsEl) return;
    this.fpsAcc += ms;
    this.fpsFrames++;
    if (this.fpsAcc < 500) return;
    const fps = (this.fpsFrames * 1000) / this.fpsAcc;
    const r = this.renderer;
    this.fpsEl.textContent = `${fps.toFixed(0)} FPS · ${r.width}×${r.height} · q${r.scale.toFixed(2)}`;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
  }
}
