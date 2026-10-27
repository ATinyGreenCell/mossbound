import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import { deviceLabel, isTyping, type Device, type DeviceId } from '../core/input';
import { canSave, exportCode, importCode, latestRun, levelRecord, runSlot, save } from '../core/save';
import { saveSettings, settings, type PerfMode } from '../core/settings';
import { ceremony } from '../core/testmode';
import { IS_IOS, IS_STANDALONE, IS_XBOX, XBOX_HINT } from '../core/platform';
import type { Flow } from '../flow';
import { Bird, BIRD_COLORS } from '../game/bird';
import { LEVELS } from '../game/levels';
import { fmtTime } from '../game/session';
import { NetLink, preloadNet, type LinkStatus } from '../net/link';
import { isValidCode, makeRoomCode, normalizeCode, type CtrlMsg } from '../net/protocol';
import { drawBird, drawRope } from '../render/art';
import { Backdrop } from '../render/backdrop';
import { Particles, PK } from '../render/particles';
import { THEMES, type Theme } from '../render/theme';
import { ButtonList, esc } from './menu';

export const CONTROLS_HTML = `
<div class="ctl-cols">
  <div class="ctl-col">
    <h3>keyboard</h3>
    <dl>
      <dt>A D · ← →</dt><dd>walk</dd>
      <dt>W S · ↑ ↓</dt><dd>climb the string</dd>
      <dt>SPACE · Z · K</dt><dd>jump · hold while falling to flutter</dd>
      <dt>SHIFT · X · J</dt><dd>hold on (plant your feet)</dd>
      <dt>E · C · L</dt><dd>tug the string</dd>
      <dt>Q · H</dt><dd>♥ to your partner</dd>
      <dt>ESC</dt><dd>menu</dd>
    </dl>
  </div>
  <div class="ctl-col">
    <h3>controller</h3>
    <dl>
      <dt>stick · d-pad</dt><dd>walk · up/down climbs</dd>
      <dt>Ⓐ</dt><dd>jump · hold to flutter</dd>
      <dt>Ⓧ · triggers · RB</dt><dd>hold on</dd>
      <dt>Ⓑ</dt><dd>tug the string</dd>
      <dt>Ⓨ</dt><dd>♥</dd>
      <dt>☰</dt><dd>menu</dd>
    </dl>
    <h3>two on one keyboard</h3>
    <p>left: WASD · SPACE jump · SHIFT hold · E tug · Q ♥<br>right: arrows · / jump · . hold · , tug · M ♥</p>
  </div>
  <div class="ctl-col">
    <h3>phone</h3>
    <dl>
      <dt>left thumb</dt><dd>stick: walk · up/down climbs</dd>
      <dt>JUMP</dt><dd>jump · hold to flutter</dd>
      <dt>HOLD</dt><dd>hold on</dd>
      <dt>TUG</dt><dd>tug the string</dd>
      <dt>♥</dt><dd>send a heart</dd>
    </dl>
  </div>
</div>
<div class="ctl-tips">
  <span>The string keeps you within 8 tiles of each other — and catches you when you fall.</span>
  <span>Jump on your partner's head to bounce up high.</span>
  <span>Hang under your partner and climb up with ↑.</span>
  <span>The string wraps around corners and rings: swing under them.</span>
  <span>TUG yanks your partner to you. If they're holding on, it yanks <i>you</i> to them.</span>
  <span>Fall in? You float back to your partner.</span>
</div>`;

const HATS: { id: string; name: string; level: number }[] = [
  { id: 'flower', name: 'flower crown', level: 0 },
  { id: 'acorn', name: 'acorn cap', level: 1 },
  { id: 'straw', name: 'straw hat', level: 2 },
  { id: 'beret', name: 'beret', level: 3 },
  { id: 'star', name: 'star', level: 4 },
];

/** Hats you've earned: all three golden feathers of a level. */
export function unlockedHats() {
  return HATS.filter((h) => levelRecord(LEVELS[h.level]?.id ?? '').feathers === 7);
}

/**
 * A text box that has the keyboard keeps the menu keys (returns true). A controller can't type, so
 * Ⓑ or up/down on one leaves the box — and does what it does in the menu as well.
 */
function typingIn(app: App, m: { back: boolean; up: boolean; down: boolean }) {
  const el = document.activeElement;
  if (!isTyping(el)) return false;
  if (app.input.padConnected && (m.back || m.up || m.down)) {
    (el as HTMLElement).blur();
    return false;
  }
  return true;
}

// ------------------------------------------------------------------ the scene behind the menus

/**
 * Backdrops behind the menus, newest first. Painting one is a few full-screen strips (tens of ms on a
 * phone, tens of MB): the last few themes stay ready, older ones give their memory back.
 */
/** Shown wherever progress is, when this browser won't keep it (blocked or full storage). */
const SAVE_BLOCKED = 'This browser isn’t keeping your progress on this device. Playing together keeps it on your partner’s device too, and Settings has a save code to copy.';

const menuBackdrops: Backdrop[] = [];
const MENU_BACKDROPS = 2;

function menuBackdrop(theme: Theme) {
  const i = menuBackdrops.findIndex((b) => b.theme === theme);
  const b = i >= 0 ? menuBackdrops.splice(i, 1)[0] : new Backdrop(theme);
  menuBackdrops.unshift(b);
  while (menuBackdrops.length > MENU_BACKDROPS) menuBackdrops.pop()!.release();
  return b;
}

/** Two birds on a rooftop at sunset, tied by their string — drawn behind every menu. */
class MenuScene {
  private backdrop: Backdrop;
  private readonly birds: [Bird, Bird] = [new Bird(0), new Bird(1)];
  private readonly fx = new Particles();
  private hopT = [2, 3.4];
  private heartT = 5;
  private camX = 0;

  constructor(private theme: Theme = THEMES.paris) {
    this.backdrop = menuBackdrop(theme);
    this.birds[0].facing = 1;
    this.birds[1].facing = -1;
  }

  /** Change the scenery (the birds carry on where they are). */
  setTheme(theme: Theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    this.backdrop = menuBackdrop(theme);
  }

  /** Is this theme's scenery painted already (switching to it costs nothing)? */
  static ready(theme: Theme) {
    return menuBackdrops.some((b) => b.theme === theme && b.built);
  }

  draw(app: App, dt: number, colors: [number, number]) {
    const r = app.renderer;
    const ctx = r.ctx;
    const W = r.width;
    const H = r.height;
    const t = app.time;
    this.camX += dt * 14;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.backdrop.draw(ctx, W, H, this.camX, 0, 0, 1, t);
    const s = H / 420;
    const ground = H * 0.86;
    ctx.fillStyle = this.theme.ground.body;
    ctx.fillRect(0, ground, W, H - ground);
    ctx.fillStyle = this.theme.ground.top;
    ctx.fillRect(0, ground - 4 * s, W, 9 * s);
    ctx.fillStyle = this.theme.ground.topDark;
    ctx.fillRect(0, ground + 5 * s, W, 4 * s);
    // birds idle, blink, hop now and then, and swap hearts
    const cx = W * 0.5;
    const [A, B] = this.birds;
    for (let i = 0; i < 2; i++) {
      const b = this.birds[i];
      const homeX = (cx + (i === 0 ? -34 : 34) * s) / s;
      this.hopT[i] -= dt;
      if (this.hopT[i] <= 0 && b.grounded) {
        this.hopT[i] = 2.5 + Math.random() * 4;
        b.vy = -330;
        b.grounded = false;
        b.squash = -0.3;
      }
      b.x = homeX;
      if (!b.grounded) {
        b.vy += 1900 * dt;
        b.y += b.vy * dt;
        if (b.y >= ground / s - 10) {
          b.y = ground / s - 10;
          b.vy = 0;
          b.grounded = true;
          b.squash = 0.25;
        }
      } else b.y = ground / s - 10;
      b.facing = i === 0 ? 1 : -1;
      b.animate(dt, this.birds[1 - i]);
    }
    this.heartT -= dt;
    if (this.heartT <= 0) {
      this.heartT = 6 + Math.random() * 5;
      const b = this.birds[Math.random() < 0.5 ? 0 : 1];
      b.emote = 'heart';
      b.emoteT = 1.6;
      this.fx.burst(PK.Heart, b.x, b.y - 18, 5, 50, 1.4, 7, '#ff6f9a', -70, 2, 30);
    }
    this.fx.update(dt);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const ca = BIRD_COLORS[colors[0] % BIRD_COLORS.length];
    let cb = BIRD_COLORS[colors[1] % BIRD_COLORS.length];
    if (cb === ca) cb = BIRD_COLORS[(colors[1] + 1) % BIRD_COLORS.length];
    drawRope(ctx, [A, B], Math.abs(B.x - A.x), ca.body, cb.body, 0, 0, 0, t, this.theme.glow);
    drawBird(ctx, A, ca, t, this.theme.ink, settings.hat, false);
    drawBird(ctx, B, cb, t, this.theme.ink, 'none', false);
    this.fx.draw(ctx, -1e5, -1e5, 1e5, 1e5, s, 0, 0);
  }
}

// ------------------------------------------------------------------ title

export class TitleScreen implements Screen {
  private readonly el: HTMLDivElement;
  private readonly scene = new MenuScene();
  private list: ButtonList;
  private dt = 0;

  constructor(
    private readonly app: App,
    private readonly flow: Flow,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'screen title-screen';
    app.ui.appendChild(this.el);
    this.list = this.buildMain();
    audio.music('title');
    if (import.meta.env.DEV) Object.assign(window, { __fbTitle: this });
  }

  private buildMain() {
    const iosHint = IS_IOS && !IS_STANDALONE ? '<div class="foot-hint">tip: Share → <b>Add to Home Screen</b> to play full screen</div>' : '';
    this.el.innerHTML = `
      <div class="logo-wrap"><div class="logo">moss<span>bound</span></div><div class="logo-sub">two little birds · one string · any distance</div></div>
      <div class="menu">
        <div class="btn" data-act="online">PLAY ONLINE</div>
        <div class="btn" data-act="local">PLAY ON ONE SCREEN</div>
        <div class="btn small" data-act="controls">HOW TO PLAY</div>
        <div class="btn small" data-act="settings">SETTINGS</div>
      </div>
      ${IS_XBOX ? `<div class="xbox-hint">${XBOX_HINT}</div>` : iosHint}`;
    this.list?.dispose();
    return new ButtonList(this.el.querySelector('.menu')!, (a) => this.act(a));
  }

  private act(a: string) {
    switch (a) {
      case 'online':
        this.flow.online();
        break;
      case 'local':
        this.flow.local();
        break;
      case 'controls':
        this.flow.showControls();
        break;
      case 'settings':
        this.list.dispose();
        this.list = buildSettings(this.el, this.app, () => {
          this.list = this.buildMain();
          this.list.sel = 3;
          this.list.highlight();
        });
        break;
    }
  }

  frame(dt: number) {
    this.dt = dt;
    const m = this.app.input.menu;
    if (this.flow.pollControls(m)) return;
    if (typingIn(this.app, m)) return;
    this.list.update(m);
  }

  update() {}

  render() {
    this.scene.draw(this.app, this.dt, [settings.color, settings.color === 1 ? 0 : 1]);
  }

  dispose() {
    this.list.dispose();
    this.el.remove();
  }
}

/** The settings page (used from the title): fills `host` and returns its ButtonList. */
function buildSettings(host: HTMLElement, app: App, done: () => void): ButtonList {
  const hats = unlockedHats();
  const perfLabel: Record<PerfMode, string> = { auto: 'AUTO', high: 'SHARPEST', low: 'BATTERY SAVER' };
  // ◀ ▶ on a row are buttons of their own (a tap on the row itself steps forward)
  const arrows = '<em class="steps"><i data-dir="-1">◀</i><i data-dir="1">▶</i></em>';
  const render = () => {
    const sw = BIRD_COLORS.map((c, i) => `<i class="swatch${i === settings.color ? ' on' : ''}" data-act="color:${i}" style="background:${c.body}"></i>`).join('');
    const hatOpts = ['none', ...hats.map((h) => h.id)];
    host.innerHTML = `
      <div class="panel settings">
        <div class="panel-title">settings</div>
        <label class="field"><span>your name</span><input class="name-input" maxlength="12" value="${esc(settings.name)}" placeholder="a cute name" autocomplete="off" spellcheck="false"></label>
        <div class="field"><span>your bird</span><div class="swatches">${sw}</div></div>
        <div class="row" data-act="hat"><span>hat</span><b>${esc(hats.find((h) => h.id === settings.hat)?.name ?? (settings.hat === 'none' ? 'none' : 'none'))}</b>${hatOpts.length > 1 ? arrows : '<em>find all 3 golden feathers in a level</em>'}</div>
        <div class="row" data-act="music"><span>music</span><b>${Math.round(settings.music * 10)}</b>${arrows}</div>
        <div class="row" data-act="sfx"><span>sounds</span><b>${Math.round(settings.sfx * 10)}</b>${arrows}</div>
        <div class="row" data-act="shake"><span>screen shake</span><b>${settings.shake ? 'ON' : 'OFF'}</b></div>
        <div class="row" data-act="perf"><span>graphics</span><b>${perfLabel[settings.perf]}</b></div>
        <details class="advanced"><summary>your shared save</summary>
          <p>Your progress is shared with your partner every time you play together. To move it to a new device, copy the save code here and paste it there.</p>
          ${canSave() ? '' : `<p class="warn">${SAVE_BLOCKED}</p>`}
          <div class="btn small" data-act="copysave">COPY SAVE CODE</div>
          <code class="save-code" hidden></code>
          <label class="field"><span>paste a code</span><input class="save-input" placeholder="MB1-…" autocomplete="off" spellcheck="false"></label>
        </details>
        <details class="advanced"><summary>connection help</summary>
          <p>Online play connects you directly when it can, and through a relay when your network blocks that. If you still can't connect, add a TURN server here (free ones: metered.ca, expressturn.com).</p>
          <label class="field"><span>TURN url</span><input class="turn-url" value="${esc(settings.turn.urls)}" placeholder="turn:host:3478" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>username</span><input class="turn-user" value="${esc(settings.turn.username)}" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>password</span><input class="turn-pass" type="password" value="${esc(settings.turn.credential)}" autocomplete="off"></label>
        </details>
        <div class="btn small" data-act="back">BACK</div>
      </div>`;
    const name = host.querySelector<HTMLInputElement>('.name-input')!;
    name.addEventListener('input', () => {
      settings.name = name.value.slice(0, 12);
      saveSettings();
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') name.blur();
    });
    const saveIn = host.querySelector<HTMLInputElement>('.save-input')!;
    saveIn.addEventListener('change', () => {
      const ok = importCode(saveIn.value);
      saveIn.value = ok ? 'loaded ✓ — merged with this device' : 'that code didn’t work';
      if (ok) audio.play('join');
    });
    saveIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveIn.blur();
    });
    for (const [cls, key] of [
      ['.turn-url', 'urls'],
      ['.turn-user', 'username'],
      ['.turn-pass', 'credential'],
    ] as const) {
      const inp = host.querySelector<HTMLInputElement>(cls)!;
      inp.addEventListener('input', () => {
        settings.turn[key] = inp.value.trim();
        saveSettings();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') inp.blur();
      });
    }
  };
  render();
  const step = (a: string, dir: number) => {
    if (a.startsWith('color:')) settings.color = Number(a.slice(6));
    else if (a === 'hat') {
      const opts = ['none', ...hats.map((h) => h.id)];
      settings.hat = opts[(opts.indexOf(settings.hat) + dir + opts.length) % opts.length] ?? 'none';
    } else if (a === 'music') settings.music = Math.min(1, Math.max(0, Math.round(settings.music * 10 + dir) / 10));
    else if (a === 'sfx') settings.sfx = Math.min(1, Math.max(0, Math.round(settings.sfx * 10 + dir) / 10));
    else if (a === 'shake') settings.shake = !settings.shake;
    else if (a === 'perf') {
      const o: PerfMode[] = ['auto', 'high', 'low'];
      settings.perf = o[(o.indexOf(settings.perf) + (dir > 0 ? 1 : 2)) % 3];
      app.applyPerf();
    } else return;
    saveSettings();
    audio.setVolumes({ music: settings.music, sfx: settings.sfx });
    const keep = list.sel;
    render();
    list.refresh();
    list.sel = keep;
    list.highlight();
  };
  const list = new ButtonList(
    host,
    (a, el) => {
      if (a === 'back') done();
      else if (a === 'copysave') {
        const code = exportCode();
        // the clipboard said no (or there isn't one): show the code, to copy by hand
        const show = () => {
          el.textContent = 'COPY IT FROM BELOW';
          const box = host.querySelector<HTMLElement>('.save-code');
          if (!box) return;
          box.textContent = code;
          box.hidden = false;
        };
        const clip = navigator.clipboard;
        if (!clip?.writeText) show();
        else
          void clip
            .writeText(code)
            .then(() => (el.textContent = 'COPIED ✓'))
            .catch(show);
      } else step(a, 1);
    },
    done,
  );
  // a tap on ◀ or ▶ steps that way (before the row's own click, which would step forward)
  const onArrow = (e: Event) => {
    const arrow = (e.target as HTMLElement).closest<HTMLElement>('[data-dir]');
    const row = arrow?.closest<HTMLElement>('[data-act]');
    if (!arrow || !row || !host.contains(row)) return;
    e.stopPropagation();
    const i = list.items().indexOf(row);
    if (i >= 0) list.sel = i;
    audio.play('uiMove');
    step(row.dataset.act!, Number(arrow.dataset.dir));
  };
  host.addEventListener('click', onArrow, true);
  const dispose = list.dispose.bind(list);
  list.dispose = () => {
    host.removeEventListener('click', onArrow, true);
    dispose();
  };
  // left/right change the highlighted row
  const orig = list.update.bind(list);
  list.update = (m) => {
    if (m.left || m.right) {
      const el = list.items()[list.sel];
      const a = el?.dataset.act;
      if (a && a !== 'back') {
        if (a.startsWith('color:')) {
          const c = (settings.color + (m.right ? 1 : -1) + BIRD_COLORS.length) % BIRD_COLORS.length;
          settings.color = c;
          saveSettings();
          render();
          list.refresh();
          const idx = list.items().findIndex((x) => x.dataset.act === `color:${c}`);
          list.sel = idx >= 0 ? idx : list.sel;
          list.highlight();
        } else step(a, m.right ? 1 : -1);
        audio.play('uiMove');
        return;
      }
    }
    orig(m);
  };
  return list;
}

// ------------------------------------------------------------------ two players, one screen

/** Claim a controller (or half the keyboard) for each player, then pick a level. */
export class LocalScreen implements Screen {
  private readonly el: HTMLDivElement;
  private readonly scene = new MenuScene(THEMES.garden);
  private seats: (DeviceId | null)[] = [null, null];
  /** which connection of each seated controller (see SessionOpts.seatGen) */
  private gen: [number, number] = [0, 0];
  private dt = 0;
  private born = performance.now();

  constructor(
    private readonly app: App,
    private readonly flow: Flow,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'screen local-screen';
    app.ui.appendChild(this.el);
    this.build();
  }

  private build() {
    const seat = (i: number) => {
      const d = this.seats[i];
      const hint = i === 0 ? 'press Ⓐ on a controller, or SPACE' : 'press Ⓐ on another controller, or ENTER';
      return `<div class="seat s${i}${d ? ' on' : ''}"><b>player ${i + 1}</b><span>${d ? `${deviceLabel(d)} ✓` : hint}</span></div>`;
    };
    const touchOnly = !this.app.input.padConnected && this.app.input.lastDevice === 'touch';
    this.el.innerHTML = `
      <div class="panel">
        <div class="panel-title">two birds, one screen</div>
        <div class="seats">${seat(0)}${seat(1)}</div>
        <p class="note">${touchOnly ? 'This mode needs a keyboard or controllers. On phones, play online — each of you on your own phone.' : 'Keyboard players: left side uses WASD + SPACE, right side uses the arrows + / . ,'}</p>
        <div class="btn small" data-act="back">BACK</div>
      </div>`;
    this.el.querySelector('[data-act="back"]')!.addEventListener('click', () => this.flow.title());
  }

  frame(dt: number) {
    this.dt = dt;
    const input = this.app.input;
    if (performance.now() - this.born < 300) return;
    if (input.menu.back && !this.seats[0] && !this.seats[1]) {
      audio.play('uiBack');
      this.flow.title();
      return;
    }
    const devs = input.devices();
    const pressed = (d: Device) => d.menu.confirm || d.controls.jumpPressed;
    // a press on a seated controller is that player's — and some drivers show one controller twice, its
    // twin pressing in the same frame: nobody new sits down then, and at most one player a frame
    let sit = !devs.some((d) => this.seats.includes(d.id) && pressed(d));
    for (const d of devs) {
      const taken = this.seats.indexOf(d.id);
      if (d.menu.back && taken >= 0) {
        this.seats[taken] = null;
        audio.play('uiBack');
        this.build();
        continue;
      }
      if (!sit || !pressed(d) || taken >= 0) continue;
      const free = this.seats.indexOf(null);
      if (free < 0) continue;
      this.seats[free] = d.id;
      this.gen[free] = d.generation;
      sit = false;
      audio.play('join');
      this.build();
    }
    if (this.seats[0] && this.seats[1]) {
      const seats = this.seats as [DeviceId, DeviceId];
      const gen: [number, number] = [this.gen[0], this.gen[1]];
      setTimeout(() => this.flow.startLocal(seats, gen), 450 / ceremony(1));
      this.seats = [...this.seats];
      this.born = Infinity;
    }
  }

  update() {}

  render() {
    this.scene.draw(this.app, this.dt, [settings.color, settings.color === 1 ? 0 : 1]);
  }

  dispose() {
    this.el.remove();
  }
}

// ------------------------------------------------------------------ online lobby

/**
 * What's in the room-code box, made into a code: from an invite link (…#join=K7QX) if one was pasted,
 * else the code letters — the last four of a pasted message ("Room K7QX"), the first four typed.
 */
export function codeFrom(text: string, pasted = false) {
  const link = /join=([A-Za-z0-9]{4})/.exec(text);
  if (link) return normalizeCode(link[1]);
  const letters = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return pasted && letters.length > 4 ? letters.slice(-4) : normalizeCode(letters);
}

type OnlineState = 'menu' | 'host' | 'join' | 'connecting' | 'connected' | 'error';

export class OnlineScreen implements Screen {
  private readonly el: HTMLDivElement;
  private readonly scene = new MenuScene(THEMES.tower);
  private list: ButtonList;
  private state: OnlineState = 'menu';
  private error = '';
  /** the room a join was trying (TRY AGAIN tries it again) */
  private retryCode = '';
  private dt = 0;
  private codeInput: HTMLInputElement | null = null;
  private moveOnT = 0;

  constructor(
    private readonly app: App,
    private readonly flow: Flow,
    opts: { joinCode?: string },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'screen online-screen';
    app.ui.appendChild(this.el);
    this.list = new ButtonList(this.el, (a) => this.act(a), () => this.back());
    void preloadNet().catch(() => undefined);
    if (opts.joinCode && isValidCode(opts.joinCode)) this.join(opts.joinCode);
    else this.go('menu');
  }

  private go(s: OnlineState) {
    this.state = s;
    this.codeInput = null;
    const L = this.flow.link;
    const nameField = `<label class="field"><span>your name</span><input class="name-input" maxlength="12" value="${esc(settings.name)}" placeholder="so your partner knows it's you" autocomplete="off" spellcheck="false"></label>`;
    switch (s) {
      case 'menu':
        this.el.innerHTML = `
          <div class="panel">
            <div class="panel-title">play online</div>
            <p class="note">Each of you on your own phone, laptop or Xbox — anywhere in the world.</p>
            ${nameField}
            <div class="swatches small">${BIRD_COLORS.map((c, i) => `<i class="swatch${i === settings.color ? ' on' : ''}" data-act="color:${i}" style="background:${c.body}"></i>`).join('')}</div>
            <div class="btn" data-act="host">MAKE A ROOM</div>
            <div class="btn" data-act="join">JOIN A ROOM</div>
            ${!settings.lastRoom ? '' : settings.lastRole === 'guest' ? `<div class="btn small" data-act="rejoin">REJOIN ROOM ${esc(settings.lastRoom)}</div>` : `<div class="btn small" data-act="rehost">REOPEN ROOM ${esc(settings.lastRoom)}</div>`}
            <div class="btn small" data-act="back">BACK</div>
          </div>`;
        this.bindName();
        break;
      case 'host':
        this.el.innerHTML = `
          <div class="panel">
            <div class="panel-title">your room</div>
            <div class="code">${esc(L?.code ?? '····')}</div>
            <p class="note">Send this code to your partner — or the invite link, and they'll drop straight in.</p>
            <div class="btn" data-act="share">SEND INVITE LINK</div>
            <div class="status"><span class="spinner"></span><span>${L?.status === 'connecting' ? 'opening the room…' : 'waiting for your partner…'}</span></div>
            <div class="btn small" data-act="cancel">CANCEL</div>
          </div>`;
        break;
      case 'join':
        this.el.innerHTML = `
          <div class="panel">
            <div class="panel-title">join a room</div>
            <input class="code-input" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="CODE" aria-label="Room code" value="${esc(settings.lastRoom)}">
            <div class="btn" data-act="go">JOIN</div>
            <div class="btn small" data-act="menu">BACK</div>
          </div>`;
        this.codeInput = this.el.querySelector('.code-input');
        // last time's code is filled in, selected: typing or pasting a new one replaces it
        this.codeInput!.addEventListener('focus', () => setTimeout(() => this.codeInput?.select(), 0));
        this.codeInput!.addEventListener('input', (e) => {
          if (this.codeInput) this.codeInput.value = codeFrom(this.codeInput.value, (e as InputEvent).inputType === 'insertFromPaste');
        });
        this.codeInput!.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') this.act('go');
          if (e.key === 'Escape') this.codeInput?.blur();
        });
        setTimeout(() => this.codeInput?.focus(), 60);
        break;
      case 'connecting':
        this.el.innerHTML = `
          <div class="panel">
            <div class="panel-title">room ${esc(L?.code ?? '')}</div>
            <div class="status"><span class="spinner"></span><span>looking for your partner…</span></div>
            <div class="btn small" data-act="cancel">CANCEL</div>
          </div>`;
        break;
      case 'connected': {
        const p = this.flow.partner;
        this.el.innerHTML = `
          <div class="panel">
            <div class="panel-title">together!</div>
            <p class="note big">You're connected${p.name ? ` with <b>${esc(p.name)}</b>` : ''} ♥</p>
            <div class="status ok"><span>${L?.via === 'relay' ? 'through the relay' : 'direct connection'}${L?.rtt ? ` · ${Math.round(L.rtt)} ms` : ''}</span></div>
          </div>`;
        break;
      }
      case 'error':
        this.el.innerHTML = `
          <div class="panel">
            <div class="panel-title">no connection</div>
            <p class="note">${esc(this.error)}</p>
            <div class="btn" data-act="retry">TRY AGAIN</div>
            <div class="btn small" data-act="back">BACK</div>
          </div>`;
        break;
    }
    this.list.refresh(false);
    if (s === 'connecting') this.list.disarm();
  }

  private bindName() {
    const name = this.el.querySelector<HTMLInputElement>('.name-input');
    if (!name) return;
    name.addEventListener('input', () => {
      settings.name = name.value.slice(0, 12);
      saveSettings();
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') name.blur();
    });
  }

  private act(a: string) {
    if (a.startsWith('color:')) {
      settings.color = Number(a.slice(6));
      saveSettings();
      this.el.querySelectorAll('.swatch').forEach((s, i) => s.classList.toggle('on', i === settings.color));
      return;
    }
    switch (a) {
      case 'host':
      case 'rehost': {
        const code = a === 'rehost' ? settings.lastRoom : makeRoomCode();
        settings.lastRoom = code;
        // (only the one who made a room offers to reopen it: two devices both hosting one code clash)
        settings.lastRole = 'host';
        this.retryCode = '';
        saveSettings();
        this.flow.adopt(NetLink.open('host', code));
        this.go('host');
        break;
      }
      case 'join':
        this.go('join');
        break;
      case 'rejoin':
        if (isValidCode(settings.lastRoom)) this.join(settings.lastRoom);
        break;
      case 'retry':
        // a join that timed out tries the same room again; anything else starts over at the menu
        if (this.retryCode) this.join(this.retryCode);
        else this.act('menu');
        break;
      case 'go': {
        const code = normalizeCode(this.codeInput?.value ?? '');
        if (!isValidCode(code)) {
          audio.play('uiBack');
          this.codeInput?.classList.remove('bad');
          void this.codeInput?.offsetWidth;
          this.codeInput?.classList.add('bad');
          return;
        }
        this.codeInput?.blur();
        this.join(code);
        break;
      }
      case 'share':
        void this.share();
        break;
      case 'cancel':
      case 'menu':
        this.flow.title();
        this.flow.online();
        break;
      case 'back':
        this.back();
        break;
    }
  }

  private back() {
    if (this.state === 'join' || this.state === 'error') this.go('menu');
    else if (this.state === 'menu') this.flow.title();
    else this.act('cancel');
  }

  private join(code: string) {
    settings.lastRoom = code;
    settings.lastRole = 'guest';
    this.retryCode = code;
    saveSettings();
    this.flow.adopt(NetLink.open('guest', code));
    this.go('connecting');
  }

  private async share() {
    const code = this.flow.link?.code;
    if (!code) return;
    const url = `${location.origin}${location.pathname}#join=${code}`;
    const text = `Come play Mossbound with me! Room ${code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Mossbound', text, url });
        return;
      }
    } catch {
      // cancelled — fall back to copying
    }
    try {
      await navigator.clipboard.writeText(`${text}: ${url}`);
      const b = this.el.querySelector('[data-act="share"]');
      if (b) b.textContent = 'LINK COPIED ✓';
    } catch {
      const b = this.el.querySelector('[data-act="share"]');
      if (b) b.textContent = url;
    }
  }

  onLinkStatus(s: LinkStatus, detail: string) {
    if (s === 'connected') {
      audio.play('join');
      this.go('connected');
      this.moveOnT = 1.4 / ceremony(1);
    } else if (s === 'error' || (s === 'lost' && this.state !== 'connected')) {
      this.error = detail || 'The connection failed.';
      this.go('error');
    } else if (s === 'waiting' && this.state === 'host') this.go('host');
  }

  onCtrl(m: CtrlMsg) {
    if (m.t === 'profile' && this.state === 'connected') this.go('connected');
  }

  frame(dt: number) {
    this.dt = dt;
    if (this.moveOnT > 0) {
      this.moveOnT -= dt;
      if (this.moveOnT <= 0) this.flow.levels();
      return;
    }
    const m = this.app.input.menu;
    if (this.flow.pollControls(m)) return;
    if (typingIn(this.app, m)) return;
    this.list.update(m);
  }

  update() {}

  render() {
    this.scene.draw(this.app, this.dt, [settings.color, this.flow.partner.color]);
  }

  dispose() {
    this.list.dispose();
    this.el.remove();
  }
}

// ------------------------------------------------------------------ level select

export class LevelSelect implements Screen {
  private readonly el: HTMLDivElement;
  private readonly scene: MenuScene;
  private list: ButtonList;
  private dt = 0;
  private sel = 0;
  /** the scenery follows the picked level once the highlight settles (painting a theme takes a moment) */
  private settle = 0;
  private built = false;
  private readonly online: boolean;
  private readonly lead: boolean;

  constructor(
    private readonly app: App,
    private readonly flow: Flow,
  ) {
    this.online = flow.mode === 'online';
    this.lead = !this.online || flow.role === 'host';
    this.sel = Math.min(latestRun()?.index ?? save.unlocked, LEVELS.length - 1);
    this.scene = new MenuScene(THEMES[LEVELS[this.sel].theme]);
    this.el = document.createElement('div');
    this.el.className = 'screen levels-screen';
    app.ui.appendChild(this.el);
    this.list = new ButtonList(this.el, (a) => this.act(a), () => this.act('back'), 'both');
    this.build();
    audio.music('title');
  }

  private build() {
    const partner = this.flow.partner.name || 'your partner';
    // a rebuild (every save or profile from the partner) keeps the highlight where it was
    const was = this.built ? this.list.items()[this.list.sel]?.dataset.act : undefined;
    const latest = latestRun();
    const run = latest?.slot.run ?? null;
    let cont = '';
    if (latest && run) {
      const L = LEVELS[latest.index];
      const where = run.cp >= 0 ? `lantern ${run.cp + 1}` : 'the start';
      cont = `<div class="card continue t-${L.theme}" ${this.lead ? 'data-act="continue"' : ''}>
        <span class="num">▶</span><b>continue</b><em>${esc(L.name)} · from ${where}</em>
        <span class="best"><i class="seed-ico"></i> ${run.seeds.length}${run.with ? ` · ${esc(run.with)}` : ''}</span></div>`;
    }
    const cards = LEVELS.map((L, i) => {
      const rec = save.levels[L.id];
      const locked = i > save.unlocked;
      const f = rec?.feathers ?? 0;
      const feathers = [0, 1, 2].map((k) => `<i class="feather-ico${f & (1 << k) ? ' on' : ''}"></i>`).join('');
      // a level part-way through carries on from there (START THE LEVEL OVER is in its menu)
      const going = locked ? null : runSlot(L.id)?.run;
      const at = going ? `<span class="going">▶ ${going.cp >= 0 ? `lantern ${going.cp + 1}` : 'under way'}</span>` : '';
      return `<div class="card t-${L.theme}${locked ? ' locked off' : ''}${i === this.sel ? ' picked' : ''}" ${this.lead && !locked ? `data-act="lvl:${i}"` : ''}>
        <span class="num">${i + 1}</span><b>${esc(L.name)}</b><em>${esc(L.subtitle)}</em>
        <span class="feathers">${feathers}</span>${at}${rec?.time ? `<span class="best">⏱ ${fmtTime(rec.time)}</span>` : ''}${locked ? '<span class="lock">🔒</span>' : ''}</div>`;
    }).join('');
    const link = this.flow.link;
    const gone = this.online && link?.status === 'lost';
    let status = '';
    if (gone) status = `<div class="status small">${esc(partner)} left the room · they can come back with the code <b>${esc(link?.code ?? '')}</b></div>`;
    else if (this.online && link?.status === 'reconnecting') status = `<div class="status small"><span class="spinner"></span><span>waiting for ${esc(partner)}…</span></div>`;
    else if (this.online) status = `<div class="status ok small">${link?.via === 'relay' ? 'relay' : 'direct'} · ${Math.round(link?.rtt ?? 0)} ms · with ${esc(partner)}</div>`;
    if (!canSave()) status += `<div class="status small warn">${SAVE_BLOCKED}</div>`;
    this.el.innerHTML = `
      <div class="panel wide">
        <div class="panel-title">${this.online && !this.lead ? (gone ? `${esc(partner)} left` : `${esc(partner)} is picking…`) : 'pick a level'}</div>
        <div class="cards">${cont}${cards}</div>
        ${status}
        <div class="btn small" data-act="back">${this.online ? 'LEAVE ROOM' : 'BACK'}</div>
      </div>`;
    this.list.refresh();
    if (!this.lead) {
      // the guest's only button is LEAVE ROOM: nothing highlighted until they reach for it
      if (!this.built) this.list.disarm();
    } else {
      // the first time CONTINUE, if there's a run to continue (Ⓐ mustn't start that level over)
      const items = this.list.items();
      for (const a of [was, run ? 'continue' : '', `lvl:${this.sel}`]) {
        const i = a ? items.findIndex((el) => el.dataset.act === a) : -1;
        if (i >= 0) {
          this.list.sel = i;
          break;
        }
      }
      this.list.highlight();
    }
    this.built = true;
  }

  /** Show level `i` as picked; its scenery follows once the highlight settles. */
  private pick(i: number) {
    this.sel = i;
    const theme = THEMES[LEVELS[i].theme];
    this.settle = MenuScene.ready(theme) ? 0 : 0.15;
    if (!this.settle) this.scene.setTheme(theme);
  }

  private act(a: string) {
    if (a === 'back') {
      if (this.online) this.flow.leaveOnline();
      else this.flow.title();
      return;
    }
    if (a === 'continue') {
      const r = latestRun();
      if (r) this.flow.enterLevel(r.index);
      return;
    }
    if (a.startsWith('lvl:')) this.flow.enterLevel(Number(a.slice(4)));
  }

  /** The partner's half of the save arrived: show what they've unlocked too. */
  onSave() {
    this.build();
  }

  onCtrl(m: CtrlMsg) {
    if (m.t === 'pick' && !this.lead && m.level >= 0 && m.level < LEVELS.length) {
      this.pick(m.level);
      this.build();
    } else if (m.t === 'profile') this.build();
  }

  /** The partner left, dropped out or came back: say so (the guest would otherwise wait on "picking…"). */
  onLinkStatus() {
    if (this.online) this.build();
  }

  frame(dt: number) {
    this.dt = dt;
    if (this.settle > 0) {
      this.settle -= dt;
      if (this.settle <= 0) this.scene.setTheme(THEMES[LEVELS[this.sel].theme]);
    }
    const m = this.app.input.menu;
    if (this.flow.pollControls(m)) return;
    const before = this.list.sel;
    this.list.update(m);
    if (this.list.sel !== before && this.lead) {
      const a = this.list.items()[this.list.sel]?.dataset.act ?? '';
      const level = a.startsWith('lvl:') ? Number(a.slice(4)) : a === 'continue' ? (latestRun()?.index ?? -1) : -1;
      if (level >= 0 && level < LEVELS.length) {
        this.pick(level);
        if (this.online) this.flow.link?.send({ t: 'pick', level: this.sel, c: this.flow.nextCmd() });
        this.el.querySelectorAll<HTMLElement>('.card[data-act^="lvl:"], .card.locked').forEach((c, i) => c.classList.toggle('picked', i === this.sel));
      }
    }
  }

  update() {}

  render() {
    this.scene.draw(this.app, this.dt, [settings.color, this.flow.partner.color]);
  }

  dispose() {
    this.list.dispose();
    this.el.remove();
  }
}

// ------------------------------------------------------------------ the end

export class EndingScreen implements Screen {
  private readonly el: HTMLDivElement;
  private readonly scene = new MenuScene(THEMES.tower);
  private readonly fx = new Particles();
  private dt = 0;
  private boomT = 0;
  private list: ButtonList;

  constructor(
    private readonly app: App,
    private readonly flow: Flow,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'screen ending-screen';
    this.el.innerHTML = `
      <div class="ending">
        <div class="logo small">the end</div>
        <p>Two little birds, one long string,<br>and not a single tile too far apart.</p>
        <p class="soft">thank you for playing — together ♥</p>
        <div class="btn" data-act="title">BACK TO THE START</div>
      </div>`;
    app.ui.appendChild(this.el);
    this.list = new ButtonList(this.el, () => {
      if (this.flow.mode === 'online' && this.flow.link?.connected) this.flow.levels();
      else this.flow.title();
    });
    audio.music('tower');
    audio.play('clear');
  }

  frame(dt: number) {
    this.dt = dt;
    this.list.update(this.app.input.menu);
    this.boomT -= dt;
    if (this.boomT <= 0) {
      this.boomT = 0.5 + Math.random() * 0.7;
      const r = this.app.renderer;
      const x = r.width * (0.15 + Math.random() * 0.7);
      const y = r.height * (0.12 + Math.random() * 0.35);
      const c = ['#ffd75a', '#ff7fb0', '#7fd6ff', '#b48cff', '#ffffff'][Math.floor(Math.random() * 5)];
      this.fx.burst(PK.Spark, x, y, 40, 260 * (r.height / 600), 1.6, 5 * (r.height / 600), c, 90, 1.4);
    }
    this.fx.update(dt);
  }

  update() {}

  render() {
    this.scene.draw(this.app, this.dt, [settings.color, this.flow.partner.color || (settings.color === 1 ? 0 : 1)]);
    const ctx = this.app.renderer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.fx.draw(ctx, -1e5, -1e5, 1e5, 1e5);
  }

  dispose() {
    this.list.dispose();
    this.el.remove();
  }
}
