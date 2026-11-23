/**
 * The level select: the overworld map (src/overworld), the two sprouts walking the trail up the creek.
 *
 *   The stick, the d-pad or the arrows walk them stop to stop; Ⓐ goes into the level they stand on (or
 *   continues its run: the card says from which lantern), or opens the storybook at a world's gate. A tap
 *   on a stop walks there, a tap on the stop they're on goes in. Ⓧ (or the SWAP button) trades who's
 *   which sprout; ♥ and "hey" work as in a level. Ⓑ goes back — online, LEAVE ROOM, which asks first.
 *   The map opens where the pair was last: on the level just played (its path to the next stop growing
 *   in when it was cleared), else the level played last, else home.
 *   Online the host walks the pair and the guest's pair follows, live, as stop ids ('walk'); going in
 *   is the same 'load' as ever, so a build from before the map plays along with its own level select.
 *   Each world's storybook opens by itself the first time this device sees the pair at its gate.
 */
import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import { canSave } from '../core/save';
import { saveSettings, settings } from '../core/settings';
import { ceremony } from '../core/testmode';
import type { Flow } from '../flow';
import { COURSE_INDEX, LEVELS } from '../game/levels';
import { WORLDS } from '../game/worlds';
import { Backdrop } from '../render/backdrop';
import { THEMES } from '../render/theme';
import type { CtrlMsg } from '../net/protocol';
import { CARD_CSS, cardHtml } from '../overworld/card';
import type { MapProgress } from '../overworld/layout';
import { OverworldMap, type MapEvent, type NodeInfo } from '../overworld/map';
import { allOpen, lastPlayed, mapProgress } from '../overworld/progress';
import { paintStory, storyText } from '../overworld/story';
import { ButtonList, esc } from './menu';
import { linkLive, SAVE_BLOCKED } from './screens';

/** how long a map nobody asked for (back from a level, or put up by the host) ignores Ⓐ */
const ARM_MS = 600;
const ARM_POLLS = 3;
const NO_INPUT = { x: 0, y: 0, pressed: false, a: false };

let cssDone = false;

export class LevelSelect implements Screen {
  readonly map: OverworldMap;
  private readonly el: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly side: HTMLDivElement;
  private readonly list: ButtonList;
  private readonly online: boolean;
  private readonly lead: boolean;
  private readonly debug: boolean;
  private info: NodeInfo | null = null;
  private storyEl: HTMLDivElement | null = null;
  private storyAt = 0;
  /** the scenery of the level being zoomed into, got ready a step a frame while the iris closes (see 'zoom') */
  private warm: Backdrop | null = null;
  private armUntil = 0;
  private armPolls = 0;
  private readonly onTap: (e: PointerEvent) => void;

  constructor(
    private readonly app: App,
    private readonly flow: Flow,
    opts: { from?: string; before?: MapProgress } = {},
  ) {
    this.online = flow.mode === 'online';
    this.lead = !this.online || flow.role === 'host';
    this.debug = flow.ground === 'debug';
    if (!cssDone) {
      cssDone = true;
      const st = document.createElement('style');
      st.textContent = CARD_CSS;
      document.head.appendChild(st);
    }
    // (the page first: the map tells it what to show from the moment it's made)
    this.el = document.createElement('div');
    this.el.className = 'screen levels-screen map-screen';
    this.el.innerHTML = '<div class="ow-card hide"></div><div class="map-side"></div>';
    this.card = this.el.querySelector('.ow-card')!;
    this.side = this.el.querySelector('.map-side')!;
    app.ui.appendChild(this.el);
    const now = this.progress();
    // (the debug ground's map is all open, and changes nothing: nothing grows in on it)
    const before = this.debug ? undefined : opts.before;
    // where the pair stands: the level just played, else the one played last, else home
    const at = opts.from ?? lastPlayed() ?? 'gate:creek';
    this.map = new OverworldMap({ worlds: WORLDS, progress: before ?? now, at, ...this.look(), lead: this.lead, onEvent: (e) => this.onMap(e) });
    // back from a clear: the bloom on its stone, and the paths it opened growing in
    if (before) this.map.setProgress(now, true);
    // (back from a level, or put up by the host: the Ⓐ still being pressed isn't for this screen)
    if (opts.from || !this.lead) this.arm();
    // (the buttons are pressed by pointer, or Ⓑ for BACK: the stick and Ⓐ belong to the map)
    this.list = new ButtonList(this.el, (a) => this.act(a), () => (this.online ? this.list.pressAct('back') : this.act('back')));
    // nothing highlighted: Ⓐ is the map's (until Ⓑ puts the highlight on LEAVE ROOM, or a pointer on a button)
    this.list.sel = -1;
    // (and, put up by the host or back from a level, its buttons ignore the Ⓑ still being pressed — a tug)
    if (opts.from || !this.lead) this.list.arm();
    this.build();
    // a guest's pair stands where the host's does (the host may have said so before this screen was up)
    if (!this.lead && flow.mapAt) this.map.mirror(flow.mapAt.at, flow.mapAt.to);
    this.onTap = (e: PointerEvent) => {
      if (this.storyEl) return this.closeStory();
      const r = this.app.renderer.canvas.getBoundingClientRect();
      this.map.tap(e.clientX - r.left, e.clientY - r.top);
    };
    app.renderer.canvas.addEventListener('pointerdown', this.onTap);
    audio.music('title');
    // the storybook, if the pair starts at a gate this device hasn't read yet (home, the very first time)
    this.storyCheck();
    if (this.online && this.lead) this.tellWhere();
  }

  /** What the map shows: the journal (on the debug ground, everything open). */
  private progress(): MapProgress {
    return this.debug ? allOpen() : mapProgress();
  }

  private look() {
    const [p0, p1] = this.flow.profiles();
    return { colors: [p0.color, p1.color] as [number, number], kinds: this.flow.kinds(), hats: [p0.hat || 'none', p1.hat || 'none'] as [string, string] };
  }

  private arm() {
    this.armUntil = performance.now() + ARM_MS / ceremony(1);
    this.armPolls = ARM_POLLS;
  }

  private get armed() {
    return this.armPolls <= 0 && performance.now() >= this.armUntil;
  }

  // ------------------------------------------------------------------ the page over the map

  private build() {
    const partner = this.flow.partner.name || 'your partner';
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
        : `<div class="sprouts"><span><b>${esc(tall.name || 'player 1')}</b> is the tall sprout · <b>${esc(small.name || 'player 2')}</b> the small one</span>${this.lead ? '<span class="btn small inline" data-act="swap">SWAP <i>Ⓧ</i></span>' : ''}</div>`;
    const lead = this.online && !this.lead ? `<div class="status small">${gone ? `${esc(partner)} left` : `${esc(partner)} leads the way`}</div>` : '';
    this.side.innerHTML = `<div class="btn small" data-act="back"${this.online ? ' data-confirm>LEAVE ROOM' : '>BACK'}</div>${who}${lead}${status}`;
    // (rebuilt by news — the partner's profile, the link — the highlight stays where it was, and a
    // LEAVE ROOM that was asking goes on asking)
    this.list.refresh();
    this.showCard();
  }

  private showCard() {
    const i = this.info;
    this.card.classList.toggle('hide', !i);
    if (!i) return;
    let act: { act: string; label: string } | null = null;
    if (i.kind === 'gate') act = i.story ? { act: 'story', label: 'Ⓐ read the story' } : null;
    else if (!this.lead) act = { act: '', label: `${esc(this.flow.partner.name || 'your partner')} leads the way` };
    else if (i.id === 'practice' && this.online) act = { act: '', label: 'on your own · from the title' };
    else if (i.playable) act = i.lantern !== null ? { act: 'continue', label: 'Ⓐ continue' } : { act: 'go', label: i.state === 'cleared' ? 'Ⓐ play again' : 'Ⓐ play' };
    this.card.innerHTML = cardHtml(i, act);
    // (the whole card is that button too: a big thing to tap — and what the CONTINUE card was)
    if (act?.act) this.card.dataset.act = act.act;
    else delete this.card.dataset.act;
  }

  // ------------------------------------------------------------------ the storybook

  /** The pair is at a gate whose storybook this device hasn't shown: show it. */
  private storyCheck() {
    if (this.storyEl) return;
    const id = this.map.here;
    if (!id.startsWith('gate:')) return;
    const w = WORLDS.findIndex((d) => `gate:${d.id}` === id);
    const def = WORLDS[w];
    if (!def?.story?.length || settings.stories.includes(def.id)) return;
    this.openStory(w);
  }

  private openStory(w: number) {
    const def = WORLDS[w];
    if (!def?.story?.length || this.storyEl) return;
    if (!settings.stories.includes(def.id)) {
      settings.stories.push(def.id);
      saveSettings();
    }
    const [p0, p1] = this.flow.profiles();
    // (local players are P1 and P2 to the game, but the story calls them by their names: Pip and Bo)
    const names: [string, string] = this.online ? [p0.name, p1.name] : [settings.name, ''];
    const el = document.createElement('div');
    el.className = 'story-wrap';
    el.innerHTML = `<div class="story-card"><canvas class="story-art"></canvas><div class="story-world">World ${w + 1} · ${esc(def.name)}</div>${storyText(def, names)
      .map((p) => `<p>${esc(p)}</p>`)
      .join('')}<div class="story-hint">Ⓐ · tap to close</div></div>`;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.closeStory();
    });
    this.el.appendChild(el);
    const art = el.querySelector<HTMLCanvasElement>('.story-art')!;
    const wCss = Math.min(420, Math.max(220, window.innerWidth * 0.42));
    paintStory(art, def, wCss, Math.round(wCss * 0.48), Math.min(2, window.devicePixelRatio || 1));
    this.storyEl = el;
    this.storyAt = performance.now();
    audio.play('uiMove');
  }

  private closeStory() {
    // (the press that opened it — a tap, Ⓐ at the book — mustn't also close it)
    if (!this.storyEl || performance.now() - this.storyAt < 250) return;
    this.storyEl.remove();
    this.storyEl = null;
    audio.play('uiBack');
    this.arm();
  }

  // ------------------------------------------------------------------ what happens on the map

  private onMap(e: MapEvent) {
    switch (e.type) {
      case 'focus':
        this.info = e.info;
        this.showCard();
        break;
      case 'enter':
        this.finishWarm();
        this.goIn(e.id);
        break;
      case 'zoom': {
        // the level's scenery is got ready while the iris closes, a step a frame (all at once, it was a
        // long frame mid-zoom: 0.1 s on a GPU, more without one), and the level takes the painting up
        this.dropWarm();
        const L = LEVELS.find((d) => d.id === e.id);
        if (L) this.warm = new Backdrop(THEMES[L.theme]);
        break;
      }
      case 'story':
        this.openStory(e.world);
        break;
      case 'blocked':
        audio.play('uiBack');
        break;
      case 'hop':
        audio.play('uiMove');
        // (however the walk began — a press, a tap on the map — Ⓐ is the map's again: the highlight
        // comes off a button the mouse left it on)
        if (this.lead && this.list.sel >= 0) {
          this.list.sel = -1;
          this.list.highlight();
        }
        if (this.online && this.lead) this.flow.link?.send({ t: 'walk', at: e.from, to: e.to, c: this.flow.nextCmd() });
        break;
      case 'arrive':
        if (this.online && this.lead) this.tellWhere();
        this.storyCheck();
        break;
    }
  }

  /** Host: where the pair stands — for a guest on the map, and a guest with a level select of its own ('pick'). */
  private tellWhere() {
    const link = this.flow.link;
    if (!link) return;
    const here = this.map.here;
    link.send({ t: 'walk', at: here, to: here, c: this.flow.nextCmd() });
    const i = LEVELS.findIndex((L) => L.id === here);
    if (i >= 0) link.send({ t: 'pick', level: i, c: this.flow.nextCmd() });
  }

  /** Into the stop with this id: a level (on the debug ground, its debug ground), the test course, the practice ground. */
  private goIn(id: string) {
    if (!this.lead) return;
    if (id === 'practice') {
      if (!this.online) this.flow.practice(settings.swap, 'map');
      return;
    }
    if (id === 'course') {
      this.flow.enterLevel(COURSE_INDEX);
      return;
    }
    const i = LEVELS.findIndex((L) => L.id === id);
    if (i < 0) return;
    if (this.debug) this.flow.debug(i);
    else this.flow.enterLevel(i);
  }

  /**
   * A button, or a script: 'back', 'swap', 'go' / 'continue' / 'story' (Ⓐ on this stop), and straight
   * in without walking — 'lvl:N' (level N), 'course', 'practice'.
   */
  act(a: string) {
    if (a === 'back') {
      if (this.online) this.flow.leaveOnline();
      else this.flow.title();
      return;
    }
    if (a === 'swap') {
      if (!this.lead || this.flow.kinds()[0] === 'even') return;
      this.flow.swapSprouts();
      audio.play('uiMove');
      this.restyle();
      return;
    }
    if (a === 'go' || a === 'continue' || a === 'story') {
      this.map.act();
      return;
    }
    if (a === 'course' || a === 'practice') this.goIn(a);
    else if (a.startsWith('lvl:') && LEVELS[Number(a.slice(4))]) this.goIn(LEVELS[Number(a.slice(4))].id);
  }

  /** Who's which sprout, or what they look like, changed. */
  private restyle() {
    const l = this.look();
    this.map.setLook(l.colors, l.kinds, l.hats);
    this.build();
  }

  // ------------------------------------------------------------------ news from the partner

  /** The partner's half of the save arrived (or another tab's): show what it opened, growing in. */
  onSave() {
    this.map.setProgress(this.progress(), true);
  }

  onCtrl(m: CtrlMsg) {
    if (m.t === 'walk' && !this.lead) {
      if (typeof m.at === 'string' && typeof m.to === 'string') this.map.mirror(m.at, m.to);
    }
    // (a host from before the map has a level select: its pick puts the pair on that level's stop)
    else if (m.t === 'pick' && !this.lead && Number.isInteger(m.level) && LEVELS[m.level] && !this.flow.mapAt) this.map.mirror(LEVELS[m.level].id, LEVELS[m.level].id);
    else if (m.t === 'emote' && (m.e === 'heart' || m.e === 'hey')) this.map.emote(this.lead ? 1 : 0, m.e);
    else if (m.t === 'profile' || m.t === 'kinds') this.restyle();
  }

  onProfile() {
    this.restyle();
  }

  /** The partner left, dropped out or came back: say so — and a host tells a partner back where the pair is. */
  onLinkStatus() {
    if (!this.online) return;
    this.build();
    if (this.lead && this.flow.link?.status === 'connected') this.tellWhere();
  }

  // ------------------------------------------------------------------ every frame

  frame(dt: number) {
    if (this.armPolls > 0) this.armPolls--;
    const input = this.app.input;
    const m = input.menu;
    if (this.flow.pollControls(m)) {
      this.map.update(dt, NO_INPUT);
      return;
    }
    if (this.storyEl) {
      if ((m.confirm || m.back) && this.armed) this.closeStory();
      this.map.update(dt, NO_INPUT);
      return;
    }
    // a fresh press walks (never a held one repeating: a press that stays down over a slow frame is
    // one press); holding on carries the pair on past a stop (the map times the hold)
    const dx = (m.right ? 1 : 0) - (m.left ? 1 : 0);
    const dy = (m.down ? 1 : 0) - (m.up ? 1 : 0);
    const pressed = !m.repeat && (dx !== 0 || dy !== 0);
    // Ⓑ is BACK, or LEAVE ROOM (which asks first, and then has the highlight: Ⓐ presses it, as on any
    // menu); a walk takes the highlight off a button, and a question with it
    if (pressed && this.list.sel >= 0) {
      this.list.sel = -1;
      this.list.highlight();
    }
    const onButton = this.list.sel >= 0;
    this.list.update({ ...m, up: false, down: false, left: false, right: false, confirm: onButton && m.confirm });
    const c = input.controls;
    const hx = Math.abs(c.moveX) > 0.5 ? Math.sign(c.moveX) : 0;
    // (the controls' y is up-positive; the map's is down, like the screen's)
    const hy = Math.abs(c.moveY) > 0.5 ? -Math.sign(c.moveY) : 0;
    this.map.update(dt, { x: pressed ? dx : hx, y: pressed ? dy : hy, pressed, a: m.confirm && !onButton && this.armed });
    // Ⓧ trades sprouts (the anchor button: it ties nothing here)
    if (c.anchorPressed) this.act('swap');
    this.emotes();
  }

  /** ♥ and "hey": each local player's own sprout; online, mine, and the partner hears it. */
  private emotes() {
    const input = this.app.input;
    if (this.online) {
      const c = input.controls;
      const e = c.heartPressed ? 'heart' : c.heyPressed ? 'hey' : null;
      if (!e) return;
      this.map.emote(this.lead ? 0 : 1, e);
      this.flow.link?.send({ t: 'emote', e });
      audio.play(e === 'heart' ? 'heart' : 'hey');
      return;
    }
    const seats = this.flow.seats;
    for (let i = 0; i < 2; i++) {
      const c = input.device(seats[i])?.controls;
      const e = c?.heartPressed ? 'heart' : c?.heyPressed ? 'hey' : null;
      if (!e) continue;
      this.map.emote(i as 0 | 1, e);
      audio.play(e === 'heart' ? 'heart' : 'hey');
    }
  }

  awake() {
    return linkLive(this.flow);
  }

  update() {}

  render() {
    const r = this.app.renderer;
    // (a step of the zoomed-into level's scenery: nothing is drawn on the screen, see Backdrop.prepare)
    this.warm?.prepare(r.ctx, r.width, r.height);
    this.map.draw(r.ctx, r.width, r.height, r.width / Math.max(1, r.cssW));
  }

  /**
   * The iris has closed: what's left of the level's scenery is painted now, while nothing on the screen
   * moves (a slow device's 0.4 s zoom is over before its steps are), and the level takes the painting up.
   */
  private finishWarm() {
    const b = this.warm;
    if (!b) return;
    this.warm = null;
    const r = this.app.renderer;
    for (let i = 0; i < 500 && !b.prepare(r.ctx, r.width, r.height); i++);
    b.release();
  }

  private dropWarm() {
    this.warm?.release();
    this.warm = null;
  }

  dispose() {
    this.dropWarm();
    this.app.renderer.canvas.removeEventListener('pointerdown', this.onTap);
    this.list.dispose();
    this.el.remove();
    this.map.release();
  }

  /** (for scripts and tests: how many frames this map has drawn, and whether the pair is walking) */
  get walking() {
    return this.map.walking;
  }
}
