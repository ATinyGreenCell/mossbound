import { clamp } from './math';
import { IS_XBOX } from './platform';

/** One frame of player intent. Produced by Input (keyboard / pad / touch) — a Bird consumes it. */
export interface ControlFrame {
  /** right positive (-1..1) */
  moveX: number;
  /** up positive (-1..1): climb the string, or drop through a ledge when pulled down */
  moveY: number;
  jump: boolean;
  jumpPressed: boolean;
  /** held: plant your feet and hold the string */
  anchor: boolean;
  /** one-shot: yank the string */
  tugPressed: boolean;
  /** one-shot: a burst through the air (the small sprout) */
  dashPressed: boolean;
  /** one-shot: shoot the vine at a ring or a branch (both sprouts; the small one reaches further) */
  shootPressed: boolean;
  heartPressed: boolean;
  heyPressed: boolean;
}

export function makeControls(): ControlFrame {
  return { moveX: 0, moveY: 0, jump: false, jumpPressed: false, anchor: false, tugPressed: false, dashPressed: false, shootPressed: false, heartPressed: false, heyPressed: false };
}

export function resetControls(c: ControlFrame) {
  c.moveX = c.moveY = 0;
  c.jump = c.jumpPressed = c.anchor = c.tugPressed = c.dashPressed = c.shootPressed = c.heartPressed = c.heyPressed = false;
}

/** Which kind of device the player touched last — drives the touch overlay and the button names in hints. */
export type InputDevice = 'keyboard' | 'pad' | 'touch';

/**
 * Written by the on-screen touch controls (src/core/touch.ts) and merged in Input.update like a gamepad.
 * moveX/moveY and the held buttons are levels; the taps are press edges that Input consumes each frame.
 */
export interface TouchState {
  moveX: number;
  moveY: number;
  jump: boolean;
  anchor: boolean;
  /** a press since the last frame — a tap shorter than one frame still counts */
  jumpTap: boolean;
  tug: boolean;
  dash: boolean;
  shoot: boolean;
  heart: boolean;
}

export interface MenuInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  pause: boolean;
  any: boolean;
}

const makeMenu = (): MenuInput => ({ up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false, any: false });

function clearMenu(m: MenuInput) {
  m.up = m.down = m.left = m.right = m.confirm = m.back = m.pause = m.any = false;
}

function orMenu(into: MenuInput, m: MenuInput) {
  into.up ||= m.up;
  into.down ||= m.down;
  into.left ||= m.left;
  into.right ||= m.right;
  into.confirm ||= m.confirm;
  into.back ||= m.back;
  into.pause ||= m.pause;
  into.any ||= m.any;
}

/**
 * A control source a local player can own: the whole keyboard, one half of it (two players sharing a
 * laptop), or one gamepad.
 */
export type DeviceId = 'keys' | 'keysL' | 'keysR' | `pad${number}`;

export interface Device {
  readonly id: DeviceId;
  /** this frame's gameplay intent from this device alone */
  readonly controls: ControlFrame;
  /** this frame's menu presses from this device alone */
  readonly menu: MenuInput;
  /** gamepads come and go; the keyboard is always there */
  readonly connected: boolean;
  /**
   * Bumps each time a gamepad (re)connects in this slot. Slots are handed out in connection order and
   * identical pads report identical ids, so after a reconnect the slot may hold someone else's pad: a
   * player bound to an older generation has to press a button to claim it again.
   */
  readonly generation: number;
  /**
   * Still holding confirm (Ⓐ / jump), not just pressing it this frame. One physical pad can reach the
   * page as two devices (Steam Input's virtual pad beside the real one, a doubled driver) whose copies
   * of a press land a frame apart — so a seat is only ever taken while nobody who has one is holding.
   */
  holdingConfirm(): boolean;
  /** Spend this frame's presses (a press used to take a seat back mustn't also reach the sprout). */
  clearEdges(): void;
}

/** Name of a device for the screen ('KEYBOARD', 'PAD 2'). */
export const deviceLabel = (id: DeviceId) =>
  id === 'keys' ? 'KEYBOARD' : id === 'keysL' ? 'KEYBOARD · LEFT' : id === 'keysR' ? 'KEYBOARD · RIGHT' : `PAD ${Number(id.slice(3)) + 1}`;

/** Keys whose browser default (scrolling, focus moves) would fight the game. */
const BLOCK_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Slash', 'Quote']);

const deadzone = (v: number, dz = 0.22) => (Math.abs(v) < dz ? 0 : (Math.sign(v) * (Math.abs(v) - dz)) / (1 - dz));

/** Connected gamepads. Chromium only offers them on secure (HTTPS) pages and may throw elsewhere. */
function readPads(): readonly (Gamepad | null)[] {
  try {
    return navigator.getGamepads ? navigator.getGamepads() : [];
  } catch {
    return [];
  }
}

/** One source's raw intent for a frame, before press edges are derived. */
interface Intent {
  mx: number;
  my: number;
  /** held levels */
  jump: boolean;
  anchor: boolean;
  /** presses since the last frame (key-downs and touch taps; polled pads get their edges from the levels) */
  jumpTap: boolean;
  tug: boolean;
  dash: boolean;
  shoot: boolean;
  heart: boolean;
  hey: boolean;
}

const makeIntent = (): Intent => ({ mx: 0, my: 0, jump: false, anchor: false, jumpTap: false, tug: false, dash: false, shoot: false, heart: false, hey: false });

function clearIntent(i: Intent) {
  i.mx = i.my = 0;
  i.jump = i.anchor = i.jumpTap = i.tug = i.dash = i.shoot = i.heart = i.hey = false;
}

/** The stick value pushed furthest, of two. */
const stronger = (a: number, b: number) => (Math.abs(b) > Math.abs(a) ? b : a);

/** Merge another source's buttons in (the sticks are merged by the caller). */
function addButtons(into: Intent, i: Intent) {
  into.jump ||= i.jump;
  into.anchor ||= i.anchor;
  into.jumpTap ||= i.jumpTap;
  into.tug ||= i.tug;
  into.dash ||= i.dash;
  into.shoot ||= i.shoot;
  into.heart ||= i.heart;
  into.hey ||= i.hey;
}

/** Turns one source's intent into a ControlFrame: press edges for polled buttons. */
class Shaper {
  readonly out = makeControls();
  private prevJump = false;

  shape(i: Intent) {
    const c = this.out;
    c.moveX = clamp(i.mx, -1, 1);
    c.moveY = clamp(i.my, -1, 1);
    // gamepads are polled, so for them a press is an up→down change between frames
    const jump = i.jump || i.jumpTap;
    c.jumpPressed = i.jumpTap || (jump && !this.prevJump);
    c.jump = jump;
    this.prevJump = jump;
    c.anchor = i.anchor;
    c.tugPressed = i.tug;
    c.dashPressed = i.dash;
    c.shootPressed = i.shoot;
    c.heartPressed = i.heart;
    c.heyPressed = i.hey;
  }

  /** One-shot presses must only be seen by the first physics sub-step of a frame. */
  clearEdges() {
    const c = this.out;
    c.jumpPressed = c.tugPressed = c.dashPressed = c.shootPressed = c.heartPressed = c.heyPressed = false;
  }

  /** Let go of everything (held levels stay remembered, so a held button doesn't re-press). */
  reset() {
    resetControls(this.out);
  }
}

/** One gamepad slot (navigator.getGamepads() index): its own presses, stick edges and control frame. */
class Pad implements Device {
  readonly id: DeviceId;
  readonly intent = makeIntent();
  readonly menu = makeMenu();
  readonly shaper = new Shaper();
  connected = false;
  generation = 0;
  /** a button went down (or the left stick was pushed) this poll */
  active = false;
  /** identity of the pad the axis mask below was taken from */
  private key = '';
  /** axes that rested far from center when a non-standard pad appeared (triggers reported as axes) */
  private deadAxes: boolean[] = [];
  private prev: boolean[] = [];
  /** menu directions the stick is already counted as pushed in (see stickEdge) */
  private stickOn = { up: false, down: false, left: false, right: false };
  /** axes that were held when the page lost focus: ignored until they read near centre once */
  private stale: boolean[] = [];

  constructor(index: number) {
    this.id = `pad${index}`;
  }

  get controls() {
    return this.shaper.out;
  }

  holdingConfirm() {
    return this.connected && this.intent.jump;
  }

  clearEdges() {
    this.shaper.clearEdges();
    clearMenu(this.menu);
  }

  read(pad: Gamepad | null) {
    const it = this.intent;
    clearIntent(it);
    clearMenu(this.menu);
    this.active = false;
    if (!pad || !pad.connected) {
      if (this.connected) this.drop();
      return;
    }
    if (!this.connected) this.generation++;
    this.connected = true;
    const key = `${pad.index}:${pad.id}`;
    if (key !== this.key) {
      this.key = key;
      // Non-standard mappings can expose analog triggers as axes resting at -1. A stick never rests
      // there, so mask those axes rather than let the bird walk off on its own. Only a reading right
      // at the rail counts: browsers also reveal a pad on an axis pushed past 0.5, so a player whose
      // first move is the stick would otherwise lose that stick (raw() frees it again when it centres).
      this.deadAxes = pad.mapping === 'standard' ? [] : pad.axes.map((a) => Math.abs(a) > 0.97);
      // A pad that comes back with buttons already held mustn't fire them as fresh presses. The first
      // time a slot fills, though, they're real: browsers hide every pad until one is pressed, so the
      // press that shows it is the player's first move (on an Xbox, often the very first Ⓐ).
      const first = this.generation === 1;
      this.prev.length = pad.buttons.length;
      for (let i = 0; i < pad.buttons.length; i++) this.prev[i] = !first && !!pad.buttons[i]?.pressed;
      this.stale.length = pad.axes.length;
      for (let i = 0; i < pad.axes.length; i++) this.stale[i] = false;
    }
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    const bp = (i: number) => b(i) && !this.prev[i];
    const raw = (i: number) => {
      const v = pad.axes[i] ?? 0;
      // a stick comes back to centre; a trigger resting at a rail never does, so it stays masked
      if (this.deadAxes[i]) {
        if (Math.abs(v) > 0.08) return 0;
        this.deadAxes[i] = false;
      }
      // held when the page lost focus (see blurred()): wait for a centred reading before trusting it
      if (this.stale[i]) {
        if (Math.abs(v) > 0.2) return 0;
        this.stale[i] = false;
      }
      return v;
    };
    const ax = (i: number) => deadzone(raw(i));
    let any = false;
    for (let i = 0; i < pad.buttons.length; i++) if (bp(i)) any = true;

    // Standard (Xbox) layout: A jump · B tug · X / LT anchor · RB dash · RT shoot the vine · Y heart · LB hey · ☰ / ⧉ menu
    it.mx = ax(0) + (b(15) ? 1 : 0) - (b(14) ? 1 : 0);
    it.my = -ax(1) + (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
    it.jump = b(0);
    it.anchor = b(2) || b(6);
    it.tug = bp(1);
    it.dash = bp(5);
    it.shoot = bp(7);
    it.heart = bp(3);
    it.hey = bp(4);

    // menu navigation from d-pad and left stick edges
    const m = this.menu;
    const sx = raw(0);
    const sy = raw(1);
    m.up = bp(12) || this.stickEdge('up', -sy);
    m.down = bp(13) || this.stickEdge('down', sy);
    m.left = bp(14) || this.stickEdge('left', -sx);
    m.right = bp(15) || this.stickEdge('right', sx);
    m.confirm = bp(0);
    m.back = bp(1);
    // either small button: Edge on Xbox may keep ☰ for itself (held, it opens Edge's own menu)
    m.pause = bp(9) || bp(8);
    m.any = any;
    this.active = any || Math.abs(ax(0)) + Math.abs(ax(1)) > 0.5;

    this.prev.length = pad.buttons.length;
    for (let i = 0; i < pad.buttons.length; i++) this.prev[i] = !!pad.buttons[i]?.pressed;
  }

  /**
   * One menu move per push of the stick, with room to tremble: it fires once past 0.6 and only counts
   * again once the stick has come back under 0.35. Without that gap a gentle push that wobbles either
   * side of the threshold walked a menu several items at once.
   */
  private stickEdge(dir: 'up' | 'down' | 'left' | 'right', v: number) {
    if (v > 0.6) {
      if (this.stickOn[dir]) return false;
      this.stickOn[dir] = true;
      return true;
    }
    if (v < 0.35) this.stickOn[dir] = false;
    return false;
  }

  /**
   * The page lost focus (on an Xbox: the guide, or Edge going full screen) with buttons or a stick
   * possibly still held. Online levels keep running for the partner's sake, so don't let a reading
   * the browser may be repeating to an unfocused page play on: hold the sticks until each has come
   * back to centre once, and count every held button as already pressed (the next read puts prev
   * back in step with the pad, so only buttons held right now are swallowed).
   */
  blurred() {
    if (!this.connected) return;
    for (let i = 0; i < this.prev.length; i++) this.prev[i] = true;
    for (let i = 0; i < this.stale.length; i++) this.stale[i] = true;
    this.stickOn.up = this.stickOn.down = this.stickOn.left = this.stickOn.right = false;
    this.shaper.reset();
  }

  /** The pad went away: forget its buttons so it starts clean if it comes back. */
  drop() {
    this.connected = false;
    this.key = '';
    this.prev.length = 0;
    this.stale.length = 0;
    this.stickOn.up = this.stickOn.down = this.stickOn.left = this.stickOn.right = false;
    this.shaper.reset();
  }
}

/** Key bindings for one keyboard "device". */
interface KeyMap {
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  jump: string[];
  anchor: string[];
  tug: string[];
  dash: string[];
  shoot: string[];
  heart: string[];
  hey: string[];
  confirm: string[];
  back: string[];
  pause: string[];
}

// Two players on one laptop: WASD + Space/Shift/E/Q on the left, arrows + / . , M on the right.
const LEFT: KeyMap = {
  left: ['KeyA'],
  right: ['KeyD'],
  up: ['KeyW'],
  down: ['KeyS'],
  jump: ['Space', 'KeyZ'],
  anchor: ['ShiftLeft', 'KeyX'],
  tug: ['KeyE', 'KeyC'],
  dash: ['KeyR', 'KeyV'],
  shoot: ['KeyT', 'KeyB'],
  heart: ['KeyQ'],
  hey: ['KeyF'],
  confirm: ['Space'],
  back: ['Escape'],
  pause: ['Escape'],
};
const RIGHT: KeyMap = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  jump: ['Slash', 'Numpad0', 'ControlRight', 'Enter', 'NumpadEnter'],
  anchor: ['Period', 'NumpadDecimal'],
  tug: ['Comma', 'Quote'],
  dash: ['Semicolon', 'ShiftRight'],
  shoot: ['BracketLeft', 'Backslash'],
  heart: ['KeyM'],
  hey: ['KeyN'],
  confirm: ['Enter', 'NumpadEnter'],
  back: ['Backspace'],
  pause: ['KeyP'],
};
// One player on the whole keyboard: every binding of both halves, plus the J/K/L cluster.
const ALL: KeyMap = {
  left: [...LEFT.left, ...RIGHT.left],
  right: [...LEFT.right, ...RIGHT.right],
  up: [...LEFT.up, ...RIGHT.up],
  down: [...LEFT.down, ...RIGHT.down],
  jump: [...LEFT.jump, ...RIGHT.jump, 'KeyK'],
  // both Shifts hold on here, as the signs and the controls card promise ("SHIFT: hold on") — right
  // Shift is only a dash for the right-hand player of two sharing the keyboard
  anchor: [...LEFT.anchor, ...RIGHT.anchor, 'ShiftRight', 'KeyJ'],
  tug: [...LEFT.tug, ...RIGHT.tug, 'KeyL'],
  dash: [...LEFT.dash, ...RIGHT.dash.filter((c) => c !== 'ShiftRight'), 'KeyI'],
  shoot: [...LEFT.shoot, ...RIGHT.shoot, 'KeyO'],
  heart: [...LEFT.heart, ...RIGHT.heart, 'KeyH'],
  hey: [...LEFT.hey, ...RIGHT.hey, 'KeyG'],
  confirm: ['Enter', 'NumpadEnter', 'Space', 'KeyK'],
  back: ['Escape', 'Backspace'],
  pause: ['Escape', 'KeyP'],
};

/** A keyboard (or half of one) as a device. */
class Keys implements Device {
  readonly menu = makeMenu();
  readonly shaper = new Shaper();
  readonly intent = makeIntent();
  readonly connected = true;
  readonly generation = 0;
  /** confirm (or jump) held down, as of the last read */
  private held = false;
  constructor(
    readonly id: DeviceId,
    private readonly map: KeyMap,
  ) {}

  get controls() {
    return this.shaper.out;
  }

  holdingConfirm() {
    return this.held;
  }

  clearEdges() {
    this.shaper.clearEdges();
    clearMenu(this.menu);
  }

  read(k: (code: string) => boolean, kp: (code: string) => boolean) {
    const any = (codes: string[], f: (c: string) => boolean) => {
      for (const c of codes) if (f(c)) return true;
      return false;
    };
    const m = this.map;
    const it = this.intent;
    it.mx = (any(m.right, k) ? 1 : 0) - (any(m.left, k) ? 1 : 0);
    it.my = (any(m.up, k) ? 1 : 0) - (any(m.down, k) ? 1 : 0);
    // every key-down is its own press: a tap that's already back up still counts
    it.jumpTap = any(m.jump, kp);
    it.jump = any(m.jump, k);
    it.anchor = any(m.anchor, k);
    it.tug = any(m.tug, kp);
    it.dash = any(m.dash, kp);
    it.shoot = any(m.shoot, kp);
    it.heart = any(m.heart, kp);
    it.hey = any(m.hey, kp);
    const mn = this.menu;
    mn.up = any(m.up, kp);
    mn.down = any(m.down, kp);
    mn.left = any(m.left, kp);
    mn.right = any(m.right, kp);
    mn.confirm = any(m.confirm, kp);
    mn.back = any(m.back, kp);
    mn.pause = any(m.pause, kp);
    mn.any = mn.up || mn.down || mn.left || mn.right || mn.confirm || it.jumpTap || it.tug || it.dash || it.shoot || it.heart || it.hey || any(m.anchor, kp);
    this.held = it.jump || any(m.confirm, k);
  }
}

/**
 * Keyboard, mouse, gamepads and the touch overlay. `controls` / `menu` merge every source (one
 * player on this screen); `device(id)` gives one keyboard half or pad on its own (two players on one screen).
 */
export class Input {
  readonly menu: MenuInput = makeMenu();
  readonly touch: TouchState = { moveX: 0, moveY: 0, jump: false, anchor: false, jumpTap: false, tug: false, dash: false, shoot: false, heart: false };
  padConnected = false;
  /** a gamepad button went down in the latest update() */
  padPressed = false;
  lastDevice: InputDevice = 'keyboard';
  /** Called when the gamepad the player was using disconnects (e.g. to show a notice). */
  onDeviceLost: (() => void) | null = null;

  private readonly main = new Shaper();
  private readonly keysAll = new Keys('keys', ALL);
  private readonly keysL = new Keys('keysL', LEFT);
  private readonly keysR = new Keys('keysR', RIGHT);
  private readonly pads: Pad[] = [];
  private readonly all = makeIntent();
  private down = new Set<string>();
  /** key-downs not yet consumed, per key: two presses inside one slow frame come out over two frames */
  private pressed = new Map<string, number>();
  /** a touch/pen tap since the last update — counts as "any button" for menus that wait for one */
  private touchTap = false;
  /** the gamepad that last had input (its disconnect raises a notice) */
  private lastPad = -1;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      // typing in a text box (names, room codes) is not playing
      if (isTyping(e.target)) return;
      // Edge on Xbox also sends controller buttons as key presses with no key code: the controller
      // itself is read as a gamepad, and they mustn't make the hints name keyboard keys
      if (!e.code) return;
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.set(e.code, (this.pressed.get(e.code) ?? 0) + 1);
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      // a pad may still be held, and the browser may keep repeating that reading to a page without focus
      for (const p of this.pads) p.blurred();
    });
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      this.touchTap = true;
      this.lastDevice = 'touch';
    };
    target.addEventListener('pointerdown', onPointer);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('gamepaddisconnected', (e) => {
      this.pads[e.gamepad.index]?.drop();
      if (e.gamepad.index !== this.lastPad) return;
      this.lastPad = -1;
      if (this.lastDevice === 'pad') {
        this.lastDevice = 'keyboard';
        this.onDeviceLost?.();
      }
    });
  }

  /** The merged control frame (every keyboard, pad and touch input together). */
  get controls(): ControlFrame {
    return this.main.out;
  }

  /** One keyboard (half) or gamepad on its own (null for a pad slot that has never been seen). */
  device(id: DeviceId): Device | null {
    if (id === 'keys') return this.keysAll;
    if (id === 'keysL') return this.keysL;
    if (id === 'keysR') return this.keysR;
    return this.pads[Number(id.slice(3))] ?? null;
  }

  /**
   * Every device that could join a game right now: each connected pad, then both keyboard halves.
   * Pads come first, so when a controller press also arrives as a key press (some browsers send both)
   * the controller is the one that takes the seat.
   *
   * On an Xbox there is no keyboard at all, and Edge may deliver a controller button as a key press
   * too (Ⓐ as ENTER) — the two halves of one press landing a frame apart would hand the sprout to
   * half a keyboard, which can then only jump, never walk. So while a controller is connected there,
   * only controllers can hold a seat. On a laptop a pad and half a keyboard are two real players.
   */
  devices(): Device[] {
    const pads = this.pads.filter((p) => p.connected);
    if (IS_XBOX && pads.length) return pads;
    return [...pads, this.keysL, this.keysR];
  }

  /** Simulate a one-frame key press (e.g. the touch PAUSE button sends 'Escape'). */
  injectPress(code: string) {
    this.pressed.set(code, (this.pressed.get(code) ?? 0) + 1);
  }

  /** Drop any buffered presses (e.g. the click that started a level). */
  flush() {
    this.pressed.clear();
    this.touchTap = false;
    const t = this.touch;
    t.jumpTap = t.tug = t.dash = t.shoot = t.heart = false;
    this.main.reset();
    this.keysAll.shaper.reset();
    this.keysL.shaper.reset();
    this.keysR.shaper.reset();
    for (const p of this.pads) p.shaper.reset();
  }

  /** One-shot presses (and menu edges) must only be seen by the first physics sub-step of a frame. */
  clearEdges() {
    this.main.clearEdges();
    clearMenu(this.menu);
    for (const k of [this.keysAll, this.keysL, this.keysR]) {
      k.shaper.clearEdges();
      clearMenu(k.menu);
    }
    for (const p of this.pads) {
      p.shaper.clearEdges();
      clearMenu(p.menu);
    }
  }

  isDown(code: string) {
    return this.down.has(code);
  }

  wasPressed(code: string) {
    return this.pressed.has(code);
  }

  update() {
    const k = (code: string) => this.down.has(code);
    const kp = (code: string) => (this.pressed.get(code) ?? 0) > 0;

    // --- keyboard: the whole of it, and each half on its own (two players, one laptop) ---
    for (const keys of [this.keysAll, this.keysL, this.keysR]) {
      keys.read(k, kp);
      keys.shaper.shape(keys.intent);
    }

    // --- gamepads: each slot on its own, and all of them merged for a one-player screen. Sticks merge
    // by whichever is pushed furthest, not summed: a pad some drivers expose twice must not double its
    // deflection, and an idle pad mustn't drag on the one in use. ---
    const all = this.all;
    Object.assign(all, this.keysAll.intent);
    const m = this.menu;
    Object.assign(m, this.keysAll.menu);
    m.any ||= this.touchTap;
    const list = readPads();
    const n = Math.max(list.length, this.pads.length);
    let connected = false;
    let px = 0;
    let py = 0;
    this.padPressed = false;
    for (let i = 0; i < n; i++) {
      const pad = (this.pads[i] ??= new Pad(i));
      pad.read(list[i] ?? null);
      if (!pad.connected) continue;
      connected = true;
      px = stronger(px, pad.intent.mx);
      py = stronger(py, pad.intent.my);
      addButtons(all, pad.intent);
      orMenu(m, pad.menu);
      pad.shaper.shape(pad.intent);
      if (pad.active) {
        this.lastDevice = 'pad';
        this.lastPad = i;
        this.padPressed = true;
      }
    }
    this.padConnected = connected;
    all.mx += px;
    all.my += py;

    // --- on-screen touch controls ---
    const t = this.touch;
    all.mx += t.moveX;
    all.my += t.moveY;
    all.jumpTap ||= t.jumpTap;
    all.jump ||= t.jump;
    all.anchor ||= t.anchor;
    all.tug ||= t.tug;
    all.dash ||= t.dash;
    all.shoot ||= t.shoot;
    all.heart ||= t.heart;
    t.jumpTap = t.tug = t.dash = t.shoot = t.heart = false;

    this.main.shape(all);

    for (const [code, count] of this.pressed) {
      if (count > 1) this.pressed.set(code, count - 1);
      else this.pressed.delete(code);
    }
    this.touchTap = false;
  }
}

/** Keyboard focus is in a text field (the player is typing a name or a room code). */
export function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** What a sign calls each control. */
export type ButtonNames = Record<'jump' | 'anchor' | 'tug' | 'dash' | 'shoot' | 'heart' | 'climb' | 'move', string>;

/** Button names for hints, for whichever device the player used last. */
export const BUTTON_NAMES: Record<InputDevice, ButtonNames> = {
  keyboard: { jump: 'SPACE', anchor: 'SHIFT', tug: 'E', dash: 'R', shoot: 'T', heart: 'Q', climb: 'W / S', move: 'A / D' },
  pad: { jump: 'Ⓐ', anchor: 'Ⓧ or LT', tug: 'Ⓑ', dash: 'RB', shoot: 'RT', heart: 'Ⓨ', climb: 'stick up / down', move: 'stick' },
  touch: { jump: 'JUMP', anchor: 'HOLD', tug: 'TUG', dash: 'DASH', shoot: 'VINE', heart: '♥', climb: 'stick up / down', move: 'stick' },
};

/** The right-hand half of a shared keyboard (see RIGHT above): the arrows and the keys beside them. */
const KEYS_RIGHT_NAMES: ButtonNames = { jump: '/', anchor: '.', tug: ',', dash: ';', shoot: '[', heart: 'M', climb: '↑ / ↓', move: '← / →' };

/**
 * What to call the buttons of one seat in a game on one screen: the sign a sprout walks up to names
 * its own player's buttons, not those of whoever touched a device last. A seat on the whole keyboard
 * is one player who may also be holding a pad or playing on a phone, so that one follows lastDevice.
 */
export function seatButtonNames(seat: DeviceId, lastDevice: InputDevice): ButtonNames {
  if (seat === 'keysL') return BUTTON_NAMES.keyboard;
  if (seat === 'keysR') return KEYS_RIGHT_NAMES;
  if (seat !== 'keys') return BUTTON_NAMES.pad;
  return BUTTON_NAMES[lastDevice];
}
