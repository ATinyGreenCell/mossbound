import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import { deviceLabel, isTyping, type Device, type DeviceId } from '../core/input';
import { debugOn } from '../core/debug';
import { canSave, exportCode, importCode, latestRun, levelRecord, runSlot, save } from '../core/save';
import { saveSettings, settings, type PerfMode } from '../core/settings';
import { ceremony } from '../core/testmode';
import { canInstall, install, onInstallable } from '../core/install';
import { IS_IOS, IS_STANDALONE, IS_XBOX, XBOX_HINT } from '../core/platform';
import type { Flow } from '../flow';
import { Bird, BIRD_COLORS } from '../game/bird';
import { LEVELS } from '../game/levels';
import { fmtTime } from '../game/session';
import { NetLink, preloadNet, type LinkStatus } from '../net/link';
import { isValidCode, makeRoomCode, normalizeCode, type CtrlMsg } from '../net/protocol';
import { drawRope } from '../render/art';
import { drawSprout, sproutTop } from '../render/sprouts';
import { kindsFor } from '../game/traits';
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
      <dt>W S · ↑ ↓</dt><dd>climb the vine (and walls)</dd>
      <dt>SPACE · Z · K</dt><dd>jump · hold while falling to glide · against a wall, kick off it</dd>
      <dt>SHIFT · X · J</dt><dd>hold on (plant your roots)</dd>
      <dt>E · C · L</dt><dd>tug the vine</dd>
      <dt>R · V · ;</dt><dd>dash (small sprout)</dd>
      <dt>T · B · [</dt><dd>your vine — beside your partner it ties you together (press again to let go); otherwise at a ring, or into soil to grow a plant</dd>
      <dt>Q · H</dt><dd>♥ to your partner</dd>
      <dt>ESC</dt><dd>menu</dd>
    </dl>
  </div>
  <div class="ctl-col">
    <h3>controller</h3>
    <dl>
      <dt>stick · d-pad</dt><dd>walk · up/down climbs</dd>
      <dt>Ⓐ</dt><dd>jump · hold to glide · against a wall, kick off it</dd>
      <dt>Ⓧ · triggers</dt><dd>hold on</dd>
      <dt>Ⓑ</dt><dd>tug the vine</dd>
      <dt>RB</dt><dd>dash (small sprout)</dd>
      <dt>RT</dt><dd>your vine — beside your partner it ties you together (again to let go); otherwise at a ring, or into soil</dd>
      <dt>Ⓨ</dt><dd>♥</dd>
      <dt>☰ · ⧉</dt><dd>menu</dd>
    </dl>
    <h3>two on one keyboard</h3>
    <p>left: WASD · SPACE jump · SHIFT hold · E tug · R dash · T vine · Q ♥<br>right: arrows · / jump · . hold · , tug · ; dash · [ vine · M ♥</p>
  </div>
  <div class="ctl-col">
    <h3>phone</h3>
    <dl>
      <dt>left thumb</dt><dd>stick: walk · up/down climbs</dd>
      <dt>JUMP</dt><dd>jump · hold to glide · wall kick</dd>
      <dt>HOLD</dt><dd>hold on</dd>
      <dt>TUG</dt><dd>tug the vine</dd>
      <dt>DASH</dt><dd>dash (small sprout)</dd>
      <dt>VINE</dt><dd>beside your partner, ties you together (again to let go) · otherwise at a ring, or into soil</dd>
      <dt>♥</dt><dd>send a heart</dd>
    </dl>
  </div>
</div>
<div class="ctl-tips">
  <span>You start loose: two sprouts going their own way. Stand next to your partner and press VINE to tie the vine between you — then it keeps you within 8 tiles of each other, and catches you when you fall. Press it again to let go.</span>
  <span>The tall sprout is strong: it can't be budged, and its tug flings the small one far. The small one jumps higher, climbs walls and dashes through the air.</span>
  <span>Jump on your partner's head to bounce up high.</span>
  <span>Touch a wall in mid-air and jump straight away to kick off it — take the two walls of a shaft in turns and you climb it. The same wall twice running won't do.</span>
  <span>Hang under your partner and climb up with ↑.</span>
  <span>The vine wraps around corners and rings: swing under them.</span>
  <span>Tied together, you can also shoot the vine straight at a ring and hang from it. The small sprout's shot reaches nearly twice as far; climb up with ↑, or tug your partner over to you.</span>
  <span>Standing on a patch of soil, the small sprout's vine goes into the ground instead: a plant grows, with leaves you can both stand on.</span>
  <span>TUG yanks your partner to you. If they're holding on, it yanks <i>you</i> to them.</span>
  <span>Fall in? You float back to your partner as a little seed.</span>
</div>`;

const HATS: { id: string; name: string; level: number }[] = [
  { id: 'flower', name: 'flower crown', level: 0 },
  { id: 'acorn', name: 'acorn cap', level: 1 },
  { id: 'straw', name: 'straw hat', level: 2 },
  { id: 'beret', name: 'beret', level: 3 },
  { id: 'star', name: 'star', level: 4 },
];

/** Hats you've earned: all three fireflies of a level. */
export function unlockedHats() {
  return HATS.filter((h) => levelRecord(LEVELS[h.level]?.id ?? '').feathers === 7);
}

/**
 * A text box that has the keyboard keeps the menu keys (returns true). A controller can't type, so a
 * press on one leaves the box: Ⓑ and Ⓐ then do what they do in the menu as well (keyboard keys never
 * reach input.menu while a box has focus, so a confirm here can only be a pad's Ⓐ), while up/down
 * only step out — leaving the box is the whole of that press, so the highlight stays where it is.
 */
function typingIn(app: App, m: { back: boolean; up: boolean; down: boolean; confirm: boolean }) {
  const el = document.activeElement;
  if (!isTyping(el)) return false;
  if (!app.input.padConnected) return true;
  if (m.back || m.confirm) {
    (el as HTMLElement).blur();
    return false;
  }
  if (m.up || m.down) (el as HTMLElement).blur();
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
    // sprouts idle, blink, hop now and then, and swap hearts
    const cx = W * 0.5;
    const [A, B] = this.birds;
    const kinds = kindsFor(settings.even, settings.swap);
    for (let i = 0; i < 2; i++) {
      const b = this.birds[i];
      if (b.kind !== kinds[i]) b.setKind(kinds[i]);
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
        if (b.y >= ground / s - b.h / 2) {
          b.y = ground / s - b.h / 2;
          b.vy = 0;
          b.grounded = true;
          b.squash = 0.25;
        }
      } else b.y = ground / s - b.h / 2;
      b.facing = i === 0 ? 1 : -1;
      b.animate(dt, this.birds[1 - i]);
    }
    this.heartT -= dt;
    if (this.heartT <= 0) {
      this.heartT = 6 + Math.random() * 5;
      const b = this.birds[Math.random() < 0.5 ? 0 : 1];
      b.emote = 'heart';
      b.emoteT = 1.6;
      this.fx.burst(PK.Heart, b.x, b.y - sproutTop(b) + 6, 5, 50, 1.4, 7, '#ff6f9a', -70, 2, 30);
    }
    this.fx.update(dt);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const ca = BIRD_COLORS[colors[0] % BIRD_COLORS.length];
    let cb = BIRD_COLORS[colors[1] % BIRD_COLORS.length];
    if (cb === ca) cb = BIRD_COLORS[(colors[1] + 1) % BIRD_COLORS.length];
    const floor = ground / s - 2;
    drawRope(ctx, [{ x: A.x, y: A.y + A.ropeOff }, { x: B.x, y: B.y + B.ropeOff }], Math.abs(B.x - A.x), ca.body, cb.body, 0, 0, 0, t, this.theme.glow, (_x, y) => y > floor);
    drawSprout(ctx, A, ca, t, this.theme.ink, settings.hat, false);
    drawSprout(ctx, B, cb, t, this.theme.ink, 'none', false);
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
    // The browser decides whether it will take an install a moment after the page loads, which is
    // usually after this screen has been built — so the button has to be able to arrive late. It is
    // in the menu from the start and merely hidden, and showing it is one attribute.
    //
    // Rebuilding the menu instead was the obvious thing and it was wrong. buildMain() assigns
    // innerHTML, which destroys every button in it: a finger already on PLAY ONLINE would have had
    // the row taken out from under it the instant Chrome made up its mind. (A hidden button is not
    // in `items()` either, so it is not somewhere the highlight can land before it is there.)
    onInstallable(() => this.showInstall());
    if (import.meta.env.DEV) Object.assign(window, { __fbTitle: this });
  }

  /** Show or hide INSTALL to match what the browser will take, without disturbing anything else. */
  private showInstall() {
    const el = this.el.querySelector<HTMLElement>('[data-act="install"]');
    if (!el) return;
    const want = !IS_STANDALONE && canInstall();
    if (el.hidden === !want) return;
    el.hidden = !want;
    // the highlight may have been sitting on a row that has just moved; nothing is rebuilt
    this.list.refresh();
  }

  private buildMain() {
    // Android and the desktops offer a real install once the browser says it will take one (see
    // core/install.ts); iOS never fires that event and installs from Safari's own Share menu, so it
    // gets the sentence instead. Installed already? Neither is any use, and both go.
    const iosHint = IS_IOS && !IS_STANDALONE ? '<div class="foot-hint">tip: Share → <b>Add to Home Screen</b> to play full screen</div>' : '';
    const installBtn = IS_STANDALONE ? '' : `<div class="btn small" data-act="install"${canInstall() ? '' : ' hidden'}>INSTALL</div>`;
    this.el.innerHTML = `
      <div class="logo-wrap"><div class="logo">moss<span>bound</span></div><div class="logo-sub">two little sprouts · one vine · any distance</div></div>
      <div class="menu">
        <div class="btn" data-act="online">PLAY ONLINE</div>
        <div class="btn" data-act="local">PLAY ON ONE SCREEN</div>
        <div class="btn small" data-act="practice">PRACTICE ON YOUR OWN</div>
        <div class="btn small" data-act="controls">HOW TO PLAY</div>
        <div class="btn small" data-act="settings">SETTINGS</div>
        ${installBtn}
        ${debugOn() ? '<div class="btn small" data-act="debug">DEBUG GROUND</div>' : ''}
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
      case 'practice':
        this.flow.practice();
        break;
      case 'debug':
        this.flow.debug();
        break;
      case 'controls':
        this.flow.showControls();
        break;
      case 'install':
        // the browser takes it from here; the offer is spent either way, so the button goes
        void install().then(() => this.showInstall());
        break;
      case 'settings':
        this.list.dispose();
        this.list = buildSettings(this.el, this.app, () => {
          this.list = this.buildMain();
          // (the row SETTINGS itself is on: PLAY ONLINE, PLAY ON ONE SCREEN, PRACTICE, HOW TO PLAY)
          this.list.sel = 4;
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
    // changing a setting draws the panel again: a section someone opened stays open
    const wasOpen = [...host.querySelectorAll('details')].map((d) => d.open);
    host.innerHTML = `
      <div class="panel settings">
        <div class="panel-title">settings</div>
        <label class="field"><span>your name</span><input class="name-input" maxlength="12" value="${esc(settings.name)}" placeholder="a cute name" autocomplete="off" spellcheck="false"></label>
        <div class="field"><span>your sprout</span><div class="swatches">${sw}</div></div>
        <div class="row" data-act="hat"><span>hat</span><b>${esc(hats.find((h) => h.id === settings.hat)?.name ?? (settings.hat === 'none' ? 'none' : 'none'))}</b>${hatOpts.length > 1 ? arrows : '<em>find all 3 fireflies in a level</em>'}</div>
        <div class="row" data-act="even"><span>sprouts</span><b>${settings.even ? 'ALIKE' : 'TALL & SMALL'}</b></div>
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
    host.querySelectorAll('details').forEach((d, i) => {
      d.open = wasOpen[i] ?? false;
      // a clicked <summary> keeps the keyboard focus, and the next ENTER would both fold the section
      // and press whatever row is highlighted: let go of it again
      d.querySelector('summary')?.addEventListener('click', (e) => (e.currentTarget as HTMLElement).blur());
    });
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
    else if (a === 'even') settings.even = !settings.even;
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
  /** the countdown to the level select, once both are seated — cancelled if the screen goes first */
  private startTimer = 0;

  constructor(
    private readonly app: App,
    private readonly flow: Flow,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'screen local-screen';
    app.ui.appendChild(this.el);
    this.build();
    // On Xbox a click is a controller's Ⓐ in Edge's browsing controls, which never reaches the game:
    // point at how to hand the controllers over
    if (IS_XBOX) this.el.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('[data-act]')) this.nudge();
    });
  }

  private build() {
    const seat = (i: number) => {
      const d = this.seats[i];
      const hint = IS_XBOX
        ? i === 0 ? 'press Ⓐ on a controller' : 'press Ⓐ on the other controller'
        : i === 0 ? 'press Ⓐ on a controller, or SPACE' : 'press Ⓐ on another controller, or ENTER';
      return `<div class="seat s${i}${d ? ' on' : ''}"><b>player ${i + 1}</b><span>${d ? `${deviceLabel(d)} ✓` : hint}</span></div>`;
    };
    const touchOnly = !this.app.input.padConnected && this.app.input.lastDevice === 'touch';
    const note = touchOnly
      ? 'This mode needs a keyboard or controllers. On phones, play online — each of you on your own phone.'
      : IS_XBOX
        ? 'Each of you takes a controller and presses Ⓐ.'
        : 'Keyboard players: left side uses WASD + SPACE, right side uses the arrows + / . ,';
    this.el.innerHTML = `
      <div class="panel">
        <div class="panel-title">two sprouts, one screen</div>
        <div class="seats">${seat(0)}${seat(1)}</div>
        <p class="note">${note}</p>
        <div class="btn small" data-act="back">BACK</div>
      </div>
      ${IS_XBOX ? `<div class="xbox-hint">${XBOX_HINT}</div>` : ''}`;
    this.el.querySelector('[data-act="back"]')!.addEventListener('click', () => this.leave());
  }

  /**
   * Go back to the title, and stop the countdown on the way out.
   *
   * `dispose()` stops it too, but a screen is swapped in at the start of the NEXT frame, and the
   * countdown is a wall-clock timer — 450 ms, and 90 under ?fast. Where a frame lasts longer than
   * that the timer fires first and the game starts behind the player who just asked to leave, which
   * is the one thing this screen must not do. Nothing here can be left for the next frame to undo.
   */
  private leave() {
    window.clearTimeout(this.startTimer);
    this.startTimer = 0;
    this.flow.title();
  }

  private nudge() {
    const hint = this.el.querySelector<HTMLElement>('.xbox-hint');
    if (!hint) return;
    audio.play('bonk');
    hint.classList.remove('nudge');
    void hint.offsetWidth;
    hint.classList.add('nudge');
  }

  frame(dt: number) {
    this.dt = dt;
    const input = this.app.input;
    if (performance.now() - this.born < 300) return;
    // a seat whose controller has gone (flat batteries, unplugged) lets go of it — otherwise the seat
    // is stuck, and on a console there's no keyboard or mouse to get out of the lobby with
    for (let i = 0; i < 2; i++) {
      const id = this.seats[i];
      if (id && input.device(id)?.connected === false) {
        this.seats[i] = null;
        this.build();
      }
    }
    if (input.menu.back && !this.seats[0] && !this.seats[1]) {
      audio.play('uiBack');
      this.leave();
      return;
    }
    const devs = input.devices();
    const pressed = (d: Device) => d.menu.confirm || d.controls.jumpPressed;
    // still holding the button down from their own press (a press lasts many frames; the twin copies
    // below do not land in the same one)
    const holding = (d: Device) => d.holdingConfirm();
    // a press on a seated controller is that player's — and some drivers show one controller twice, the
    // copies reporting that press a frame or two apart: while a seated controller is still holding its
    // Ⓐ nobody new sits down, so one person can't fill both seats (and at most one player a frame)
    let sit = !devs.some((d) => this.seats.includes(d.id) && (pressed(d) || holding(d)));
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
      this.startTimer = window.setTimeout(() => this.flow.startLocal(seats, gen), 450 / ceremony(1));
      this.seats = [...this.seats];
      this.born = Infinity;
    }
  }

  update() {}

  render() {
    this.scene.draw(this.app, this.dt, [settings.color, settings.color === 1 ? 0 : 1]);
  }

  dispose() {
    // whoever leaves this screen — BACK, Ⓑ, an error — means it: the game mustn't start behind them
    window.clearTimeout(this.startTimer);
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
    // the swatches are one stop in the list (←/→ walk the colours); a tap goes to the one it landed on
    this.el.addEventListener(
      'click',
      (e) => {
        const sw = (e.target as HTMLElement).closest<HTMLElement>('[data-color]');
        if (!sw) return;
        e.stopPropagation();
        if (this.list.guarded()) return;
        this.select('color');
        audio.play('uiSelect');
        this.setColor(Number(sw.dataset.color));
      },
      true,
    );
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
            <div class="swatches small" data-act="color">${BIRD_COLORS.map((c, i) => `<i class="swatch${i === settings.color ? ' on' : ''}" data-color="${i}" style="background:${c.body}"></i>`).join('')}</div>
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
    // the Ⓐ a controller player presses on arriving belongs to the main action — the room they were
    // in last time, else MAKE A ROOM — and not to the first colour swatch
    if (s === 'menu') this.select('rejoin', 'rehost', 'host');
    if (s === 'connecting') this.list.disarm();
  }

  /** Put the highlight on the first of these actions that's on screen. */
  private select(...acts: string[]) {
    const items = this.list.items();
    for (const a of acts) {
      const i = items.findIndex((el) => el.dataset.act === a);
      if (i >= 0) {
        this.list.sel = i;
        this.list.highlight();
        return;
      }
    }
  }

  private setColor(i: number) {
    settings.color = i;
    saveSettings();
    this.el.querySelectorAll('.swatch').forEach((s, k) => s.classList.toggle('on', k === settings.color));
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
    if (a === 'color') {
      // Ⓐ / a tap on the row itself takes the next colour (←/→ walk them either way)
      this.setColor((settings.color + 1) % BIRD_COLORS.length);
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
    // ←/→ with the colour row highlighted walk the colours (the row is one stop, like in settings)
    if ((m.left || m.right) && this.list.items()[this.list.sel]?.dataset.act === 'color') {
      this.setColor((settings.color + (m.right ? 1 : -1) + BIRD_COLORS.length) % BIRD_COLORS.length);
      audio.play('uiMove');
      return;
    }
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
  /** which list item the picked level follows (the pointer can move the highlight between frames) */
  private shown = -1;
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
    // who's which sprout (whoever leads can trade)
    const [k0] = this.flow.kinds();
    const [p0, p1] = this.flow.profiles();
    const [tall, small] = k0 === 'small' ? [p1, p0] : [p0, p1];
    const who =
      k0 === 'even'
        ? '<div class="sprouts">two sprouts alike · Settings can make one tall and one small</div>'
        : `<div class="sprouts"><span><b>${esc(tall.name || 'player 1')}</b> is the tall sprout · <b>${esc(small.name || 'player 2')}</b> the small one</span>${this.lead ? '<span class="btn small inline" data-act="swap">SWAP</span>' : ''}</div>`;
    this.el.innerHTML = `
      <div class="panel wide">
        <div class="panel-title">${this.online && !this.lead ? (gone ? `${esc(partner)} left` : `${esc(partner)} is picking…`) : 'pick a level'}</div>
        <div class="cards">${cont}${cards}</div>
        ${who}
        ${status}
        <div class="btn small" data-act="back">${this.online ? 'LEAVE ROOM' : 'BACK'}</div>
      </div>`;
    this.list.refresh();
    if (!this.lead) {
      // the guest's only button is LEAVE ROOM: nothing highlighted until they reach for it — and for a
      // moment nothing at all, since the partner put this screen here, under a Ⓑ mid-tug (or an ESC)
      if (!this.built) {
        this.list.disarm();
        this.list.arm();
      }
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
    this.shown = this.list.sel;
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
    if (a === 'swap') {
      this.flow.swapSprouts();
      audio.play('uiMove');
      this.build();
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
    } else if (m.t === 'profile' || m.t === 'kinds') this.build();
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
    this.list.update(m);
    // (what's picked follows the highlight however it moved — arrows, d-pad or the pointer, which
    // moves it between frames)
    if (this.list.sel !== this.shown && this.lead) {
      this.shown = this.list.sel;
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
    // the ending arrives on its own, straight out of the last level's card: hold off the Ⓐ still
    // being tapped, so the two little birds are seen at all
    this.list.arm();
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
