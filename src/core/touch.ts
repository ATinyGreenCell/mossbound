import '../ui/touch.css';
import type { TouchHooks } from '../app';
import type { Input, TouchState } from './input';

type ButtonId = 'jump' | 'tug' | 'anchor' | 'heart' | 'dash';

interface ButtonDef {
  id: ButtonId;
  label: string;
  /** center distance from the right / bottom edge and diameter, in base px (scaled by --s) */
  x: number;
  y: number;
  d: number;
}

// Right-thumb arc around JUMP.
const BUTTONS: ButtonDef[] = [
  { id: 'jump', label: 'JUMP', x: 80, y: 86, d: 104 },
  { id: 'tug', label: 'TUG', x: 196, y: 62, d: 74 },
  { id: 'anchor', label: 'HOLD', x: 184, y: 166, d: 74 },
  { id: 'heart', label: '♥', x: 70, y: 204, d: 54 },
  // (only for a sprout that can dash: see setDash)
  { id: 'dash', label: 'DASH', x: 298, y: 92, d: 66 },
];

const TAP: Partial<Record<ButtonId, keyof Pick<TouchState, 'tug' | 'heart' | 'dash'>>> = { tug: 'tug', heart: 'heart', dash: 'dash' };
const HOLD: Partial<Record<ButtonId, keyof Pick<TouchState, 'jump' | 'anchor'>>> = { jump: 'jump', anchor: 'anchor' };

/** base joystick radius (px at --s = 1) */
const STICK_RADIUS = 52;
const STICK_DEADZONE = 0.14;

interface Button {
  def: ButtonDef;
  el: HTMLDivElement;
  pointer: number | null;
}

/**
 * On-screen controls for phones and tablets: a floating joystick on the left, a thumb arc of
 * jump / tug / hold / heart buttons on the right, and a pause button. Writes into Input.touch.
 */
export class TouchControls implements TouchHooks {
  private readonly el: HTMLDivElement;
  private readonly zone: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly rotate: HTMLDivElement;
  private readonly buttons: Button[] = [];
  private readonly coarse: MediaQueryList | null;
  private readonly off: (() => void)[] = [];
  private stickPointer: number | null = null;
  private originX = 0;
  private originY = 0;
  private scale = 1;
  private playActive = false;
  private seenTouch = false;
  private shown = false;

  constructor(
    root: HTMLElement,
    private readonly input: Input,
  ) {
    this.coarse = typeof matchMedia === 'function' ? matchMedia('(hover: none) and (pointer: coarse)') : null;

    this.el = document.createElement('div');
    this.el.className = 'tc';
    this.el.style.display = 'none';

    this.zone = document.createElement('div');
    this.zone.className = 'tc-zone';
    this.base = document.createElement('div');
    this.base.className = 'tc-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'tc-knob';
    this.base.appendChild(this.knob);
    this.zone.appendChild(this.base);
    this.el.appendChild(this.zone);

    for (const def of BUTTONS) {
      const b = document.createElement('div');
      b.className = `tc-btn tc-${def.id}`;
      b.textContent = def.label;
      b.style.setProperty('--x', String(def.x));
      b.style.setProperty('--y', String(def.y));
      b.style.setProperty('--d', String(def.d));
      this.el.appendChild(b);
      const btn: Button = { def, el: b, pointer: null };
      this.buttons.push(btn);
      this.listen(b, 'pointerdown', (e: PointerEvent) => this.press(btn, e));
      const up = (e: PointerEvent) => this.release(btn, e.pointerId);
      this.listen(b, 'pointerup', up);
      this.listen(b, 'pointercancel', up);
      this.listen(b, 'lostpointercapture', up);
    }

    const pause = document.createElement('div');
    pause.className = 'tc-pause';
    pause.setAttribute('aria-label', 'Pause');
    pause.innerHTML = '<i></i><i></i>';
    this.el.appendChild(pause);
    this.listen(pause, 'pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      this.input.injectPress('Escape');
    });

    this.rotate = document.createElement('div');
    this.rotate.className = 'tc-rotate';
    this.rotate.innerHTML = '<div class="tc-phone"></div><div>turn your phone sideways</div><small>nothing happens? switch off rotation lock</small>';

    this.listen(this.zone, 'pointerdown', (e: PointerEvent) => this.stickDown(e));
    this.listen(this.zone, 'pointermove', (e: PointerEvent) => this.stickMove(e));
    const stickUp = (e: PointerEvent) => {
      if (e.pointerId === this.stickPointer) this.stickRelease();
    };
    this.listen(this.zone, 'pointerup', stickUp);
    this.listen(this.zone, 'pointercancel', stickUp);
    this.listen(this.zone, 'lostpointercapture', stickUp);
    this.listen(this.el, 'contextmenu', (e: Event) => e.preventDefault());

    // any touch anywhere switches the game into touch mode; keys / pad switch it back
    this.listen(
      window,
      'pointerdown',
      (e: PointerEvent) => {
        if (e.pointerType === 'mouse') return;
        this.input.lastDevice = 'touch';
        if (!this.seenTouch) {
          this.seenTouch = true;
          this.updateBodyClass();
        }
        this.refresh();
      },
      { capture: true, passive: true },
    );
    this.listen(window, 'keydown', () => this.refresh());
    this.listen(window, 'resize', () => this.layout());
    this.listen(window, 'blur', () => this.releaseAll());
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });

    root.appendChild(this.el);
    root.appendChild(this.rotate);
    this.updateBodyClass();
    this.layout();
    if (import.meta.env.DEV) (window as unknown as { __fbTouch?: TouchControls }).__fbTouch = this;
  }

  get enabled() {
    return this.seenTouch || (this.coarse?.matches ?? false);
  }

  setPlayActive(on: boolean) {
    this.playActive = on;
    this.refresh();
  }

  /** Show the DASH button (this player's sprout can dash) or not. */
  setDash(on: boolean) {
    const b = this.buttons.find((x) => x.def.id === 'dash');
    if (b) b.el.style.display = on ? '' : 'none';
  }

  /** Called each frame by the app: a pad or keyboard taking over hides the overlay. */
  poll() {
    if (this.shown && this.input.lastDevice !== 'touch') this.refresh();
  }

  dispose() {
    this.releaseAll();
    for (const f of this.off) f();
    this.off.length = 0;
    this.el.remove();
    this.rotate.remove();
    document.body.classList.remove('touch', 'touch-play');
  }

  // ------------------------------------------------------------------ internals

  private listen<E extends Event>(
    target: EventTarget,
    type: string,
    fn: (e: E) => void,
    opts: AddEventListenerOptions = { passive: false },
  ) {
    const h = fn as EventListener;
    target.addEventListener(type, h, opts);
    this.off.push(() => target.removeEventListener(type, h, opts));
  }

  private updateBodyClass() {
    document.body.classList.toggle('touch', this.enabled);
  }

  /** Show the overlay only while a level is live and the player is actually using touch. */
  private refresh() {
    const show = this.playActive && this.enabled && this.input.lastDevice === 'touch';
    if (show === this.shown) return;
    this.shown = show;
    this.el.style.display = show ? '' : 'none';
    document.body.classList.toggle('touch-play', show);
    if (!show) this.releaseAll();
  }

  private layout() {
    const s = Math.min(window.innerHeight / 390, window.innerWidth / 844);
    this.scale = Math.max(0.85, Math.min(1.6, s));
    this.el.style.setProperty('--s', this.scale.toFixed(3));
  }

  private press(btn: Button, e: PointerEvent) {
    e.preventDefault();
    if (btn.pointer !== null) return;
    btn.pointer = e.pointerId;
    try {
      btn.el.setPointerCapture(e.pointerId);
    } catch {
      // synthetic/inactive pointer — release still arrives via pointerup
    }
    btn.el.classList.add('on');
    const t = this.input.touch;
    const tap = TAP[btn.def.id];
    const hold = HOLD[btn.def.id];
    if (tap) t[tap] = true;
    if (hold) t[hold] = true;
    if (hold === 'jump') t.jumpTap = true;
    try {
      navigator.vibrate?.(btn.def.id === 'tug' ? 14 : 6);
    } catch {
      // vibration unsupported or blocked
    }
  }

  private release(btn: Button, pointerId: number) {
    if (btn.pointer !== pointerId) return;
    btn.pointer = null;
    btn.el.classList.remove('on');
    const hold = HOLD[btn.def.id];
    if (hold) this.input.touch[hold] = false;
  }

  private stickDown(e: PointerEvent) {
    e.preventDefault();
    if (e.pointerType === 'mouse' || this.stickPointer !== null) return;
    this.stickPointer = e.pointerId;
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      // see press()
    }
    // the base appears under the thumb, kept fully on screen
    const r = (64 * this.scale) | 0;
    this.originX = Math.max(r, Math.min(window.innerWidth - r, e.clientX));
    this.originY = Math.max(r, Math.min(window.innerHeight - r, e.clientY));
    const zr = this.zone.getBoundingClientRect();
    this.base.classList.add('on');
    this.base.style.left = `${this.originX - zr.left}px`;
    this.base.style.top = `${this.originY - zr.top}px`;
    this.stickMove(e);
  }

  private stickMove(e: PointerEvent) {
    if (e.pointerId !== this.stickPointer) return;
    const R = STICK_RADIUS * this.scale;
    let dx = e.clientX - this.originX;
    let dy = e.clientY - this.originY;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      // the base follows a thumb that slides past the rim, so turning around is never a long trip back
      const pull = d - R;
      this.originX += (dx / d) * pull;
      this.originY += (dy / d) * pull;
      const zr = this.zone.getBoundingClientRect();
      this.base.style.left = `${this.originX - zr.left}px`;
      this.base.style.top = `${this.originY - zr.top}px`;
      dx *= R / d;
      dy *= R / d;
    }
    this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    let x = dx / R;
    let y = -dy / R;
    const m = Math.hypot(x, y);
    if (m < STICK_DEADZONE) x = y = 0;
    else {
      const k = (m - STICK_DEADZONE) / (1 - STICK_DEADZONE) / m;
      x *= k;
      y *= k;
    }
    this.input.touch.moveX = x;
    this.input.touch.moveY = y;
  }

  private stickRelease() {
    this.stickPointer = null;
    this.base.classList.remove('on');
    this.base.style.left = '';
    this.base.style.top = '';
    this.knob.style.transform = '';
    this.input.touch.moveX = this.input.touch.moveY = 0;
  }

  private releaseAll() {
    if (this.stickPointer !== null) this.stickRelease();
    for (const b of this.buttons) if (b.pointer !== null) this.release(b, b.pointer);
    const t = this.input.touch;
    t.moveX = t.moveY = 0;
    t.jump = t.anchor = t.jumpTap = t.tug = t.dash = t.heart = false;
  }
}
