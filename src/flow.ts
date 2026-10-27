import { audio } from './audio/audio';
import type { App } from './app';
import type { DeviceId } from './core/input';
import { freshGen, keepStorage, mergeSave, onSaveChange, persist, resumeOf, sameSave, save } from './core/save';
import { settings } from './core/settings';
import { LEVELS } from './game/levels';
import { Session } from './game/session';
import { NetLink, type LinkStatus } from './net/link';
import type { CtrlMsg, Profile, Resume, Role } from './net/protocol';
import { CONTROLS_HTML, EndingScreen, LevelSelect, LocalScreen, OnlineScreen, TitleScreen } from './ui/screens';

/** Screens that want the partner's messages while they're up. */
export interface NetAware {
  onCtrl?(m: CtrlMsg): void;
  onSnap?(raw: unknown): void;
  onLinkStatus?(s: LinkStatus, detail: string): void;
  /** the shared save changed (merged from the partner) */
  onSave?(): void;
  /** the partner's name / color / hat arrived or changed */
  onProfile?(): void;
}

export const myProfile = (): Profile => ({ name: settings.name.trim().slice(0, 12), color: settings.color, hat: settings.hat });

/** How often the host repeats a level load until the guest confirms it. */
const LOAD_RETRY_MS = 1000;

/**
 * Moves between screens and owns what outlives them: the online link (one per room, kept from the
 * lobby through every level), who plays which bird, the local players' controllers, and keeping the
 * shared save in step with the partner's copy.
 */
export class Flow {
  link: NetLink | null = null;
  mode: 'local' | 'online' = 'local';
  seats: [DeviceId, DeviceId] = ['keysL', 'keysR'];
  /** which connection of each seat's controller (see SessionOpts.seatGen) */
  seatGen: [number, number] = [0, 0];
  partner: Profile = { name: '', color: 1, hat: 'none' };
  /** level session counter (host): packets from an older level are ignored */
  private nonce = 0;
  private controlsEl: HTMLDivElement | null = null;
  private openedAt = 0;
  private loadRetry = 0;
  private saveTimer = 0;
  private peerGen = 0;
  /** host: the command counter; guest: the newest command obeyed (see protocol 'c') */
  private cmd = 0;
  private lastCmd = 0;
  /** host: the latest command (load / lobby / end), sent again whenever the partner reconnects */
  private lastSent: CtrlMsg | null = null;

  constructor(readonly app: App) {
    app.onRecover = () => this.title();
    // another tab of the game saved: whatever shows the save catches up
    onSaveChange(() => this.screen?.onSave?.());
  }

  /** where the partner's messages go: the screen taking over, if one is (see App.next) */
  private get screen() {
    return this.app.next as unknown as NetAware | null;
  }

  get role(): Role {
    return this.link?.role ?? 'host';
  }

  /** Profiles by bird index (bird 0 = host / player 1). */
  profiles(): [Profile, Profile] {
    const me = myProfile();
    if (this.mode === 'online') return this.role === 'host' ? [me, this.partner] : [this.partner, me];
    return [{ ...me, name: me.name || 'P1' }, { name: 'P2', color: me.color === 1 ? 0 : 1, hat: 'none' }];
  }

  title() {
    this.dropLink();
    this.app.setScreen(new TitleScreen(this.app, this));
  }

  local() {
    this.dropLink();
    this.mode = 'local';
    this.app.setScreen(new LocalScreen(this.app, this));
  }

  startLocal(seats: [DeviceId, DeviceId], gen: [number, number]) {
    this.seats = seats;
    this.seatGen = gen;
    this.mode = 'local';
    this.levels();
  }

  online(opts: { joinCode?: string } = {}) {
    this.mode = 'online';
    this.app.setScreen(new OnlineScreen(this.app, this, opts));
  }

  /** The online screen made (or joined) a room. */
  adopt(link: NetLink) {
    this.dropLink();
    this.link = link;
    this.mode = 'online';
    this.peerGen = link.peerGen;
    // a new room: how far some earlier host's command counter got means nothing here
    this.lastCmd = 0;
    this.lastSent = null;
    link.onStatus = (s, d) => {
      if (s === 'connected') {
        // a new partner (or the same one after a reload): introduce ourselves and swap saves
        link.send({ t: 'profile', p: myProfile() });
        link.send({ t: 'save', s: save });
        if (link.peerGen !== this.peerGen) {
          this.peerGen = link.peerGen;
          // a different partner instance (e.g. their page reloaded): their command counter starts over
          this.lastCmd = 0;
          this.partnerRejoined();
        } else if (this.role === 'host' && this.lastSent) {
          // the same partner back from a dropout: whatever they missed meanwhile, the latest command
          // brings them to where we are (they ignore it if they already have it)
          link.send(this.lastSent);
        }
      }
      this.screen?.onLinkStatus?.(s, d);
    };
    link.onCtrl = (m) => this.onCtrl(m);
    link.onSnap = (m) => this.screen?.onSnap?.(m);
  }

  private onCtrl(m: CtrlMsg) {
    // host commands that arrive out of order (over two paths): only ever obey the newest
    if ((m.t === 'load' || m.t === 'lobby' || m.t === 'pick' || m.t === 'end') && this.role === 'guest') {
      if (!Number.isInteger(m.c) || m.c <= this.lastCmd) {
        // (a repeat of the load we're in still gets its acknowledgement)
        if (m.t === 'load' && m.n === this.nonce) this.link?.send({ t: 'loaded', n: m.n });
        return;
      }
      this.lastCmd = m.c;
    }
    switch (m.t) {
      case 'profile': {
        const p = m.p as Partial<Profile> | undefined;
        this.partner = { name: String(p?.name ?? '').slice(0, 12), color: Math.abs(Math.floor(Number(p?.color) || 0)) % 64, hat: String(p?.hat ?? 'none').slice(0, 16) };
        this.screen?.onProfile?.();
        break;
      }
      case 'save': {
        const changed = mergeSave(m.s);
        // their copy was missing something of ours: send ours back (stops once both match)
        if (!sameSave(m.s, save)) this.shareSave(true);
        if (changed) this.screen?.onSave?.();
        return;
      }
      case 'load':
        // the host picked a level: everyone in
        if (this.role === 'guest' && Number.isInteger(m.level) && m.level >= 0 && m.level < LEVELS.length && Number.isInteger(m.n)) {
          this.link?.send({ t: 'loaded', n: m.n });
          const cur = this.app.next;
          if (cur instanceof Session && this.nonce === m.n) return; // a repeat of the load we're already in
          this.nonce = m.n;
          this.startSession(m.level, cleanResume(m.resume), Number.isInteger(m.gen) && (m.gen as number) > 0 ? m.gen : undefined);
          return;
        }
        break;
      case 'loaded':
        if (this.role === 'host' && m.n === this.nonce) window.clearInterval(this.loadRetry);
        return;
      case 'lobby':
        if (this.role === 'guest' && !(this.app.next instanceof LevelSelect)) {
          this.levels();
          return;
        }
        break;
      case 'end':
        if (this.role === 'guest') {
          this.ending();
          return;
        }
        break;
    }
    this.screen?.onCtrl?.(m);
  }

  /** Host: a new command number (for 'pick' from the level select). */
  nextCmd() {
    return ++this.cmd;
  }

  /** Host: tell the guest where we're going, and remember it (see onStatus). */
  private command(m: CtrlMsg) {
    this.lastSent = m;
    this.link?.send(m);
  }

  /** Send our save to the partner (coalesced). */
  shareSave(now = false) {
    if (this.mode !== 'online' || !this.link?.connected) return;
    window.clearTimeout(this.saveTimer);
    const send = () => this.link?.send({ t: 'save', s: save });
    if (now) send();
    else this.saveTimer = window.setTimeout(send, 400);
  }

  /** The guest came back after a reload: start the level over for both, from the shared lantern. */
  private partnerRejoined() {
    if (this.role !== 'host') return;
    const cur = this.app.next;
    if (cur instanceof Session && cur.state === 'play') this.playLevel(cur.L.index, cur.resumeState());
    else if (cur instanceof LevelSelect) this.command({ t: 'lobby', c: ++this.cmd });
    else if (this.lastSent) this.link?.send(this.lastSent);
  }

  levels() {
    if (this.mode === 'online') {
      // (a partner who left can come back to the room: it stays open — only a dead link ends it)
      if (!this.link || this.link.status === 'error') {
        this.title();
        return;
      }
      if (this.role === 'host') this.command({ t: 'lobby', c: ++this.cmd });
    }
    window.clearInterval(this.loadRetry);
    this.app.setScreen(new LevelSelect(this.app, this));
  }

  /** Go into level `i`: where its run got to, if it has one, else from the start. */
  enterLevel(i: number) {
    this.playLevel(i, resumeOf(i) ?? undefined);
  }

  /**
   * Start a level — continuing `resume`, or (without one) a fresh start of it: locally right away;
   * online the host tells the guest to follow (until they confirm).
   */
  playLevel(i: number, resume?: Resume) {
    if (i >= LEVELS.length) {
      this.ending();
      return;
    }
    // (there's progress worth keeping now: ask the browser not to clear it away)
    keepStorage();
    const id = LEVELS[i].id;
    // which start of this level the run is: both devices record it under the same number
    const gen = resume ? (resume.gen ?? save.runs[id]?.gen ?? 1) : freshGen(id);
    if (this.mode === 'online') {
      if (this.role !== 'host' || !this.link) return;
      this.nonce = (this.nonce + 1 + Math.floor(Math.random() * 1000)) % 1_000_000_000;
      const msg: CtrlMsg = { t: 'load', level: i, n: this.nonce, c: ++this.cmd, gen, ...(resume ? { resume } : {}) };
      this.command(msg);
      window.clearInterval(this.loadRetry);
      let tries = 0;
      this.loadRetry = window.setInterval(() => {
        // paused while they're away (it goes out again the moment they're back)
        if (!this.link?.connected) return;
        if (++tries > 20) window.clearInterval(this.loadRetry);
        else this.link.send(msg);
      }, LOAD_RETRY_MS);
    }
    this.startSession(i, resume, gen);
  }

  private startSession(i: number, resume?: Resume, gen?: number) {
    const online = this.mode === 'online';
    this.app.setScreen(
      new Session(this.app, this, {
        level: i,
        mode: online ? 'online' : 'local',
        link: online ? this.link : null,
        me: online ? (this.role === 'host' ? 0 : 1) : 0,
        nonce: this.nonce,
        seats: online ? undefined : this.seats,
        seatGen: online ? undefined : this.seatGen,
        profiles: this.profiles(),
        resume,
        runGen: gen,
      }),
    );
  }

  ending() {
    save.finished = true;
    persist();
    this.shareSave();
    if (this.mode === 'online' && this.role === 'host' && this.link) {
      window.clearInterval(this.loadRetry);
      this.command({ t: 'end', c: ++this.cmd });
    }
    this.app.setScreen(new EndingScreen(this.app, this));
  }

  leaveOnline() {
    audio.play('leave');
    this.title();
  }

  private dropLink() {
    window.clearInterval(this.loadRetry);
    window.clearTimeout(this.saveTimer);
    if (!this.link) return;
    this.link.onStatus = this.link.onCtrl = this.link.onSnap = null;
    this.link.close();
    this.link = null;
  }

  /** The controls card, over whatever screen is up. */
  showControls() {
    if (this.controlsEl) return;
    const el = document.createElement('div');
    el.className = 'overlay controls-panel';
    el.innerHTML = `<div class="ov-card wide"><div class="ov-title">how to play</div>${CONTROLS_HTML}<div class="ov-hint">tap, ESC, ENTER or Ⓑ to close</div></div>`;
    el.addEventListener('click', () => this.closeControls());
    this.app.ui.appendChild(el);
    this.controlsEl = el;
    this.openedAt = performance.now();
  }

  closeControls() {
    this.controlsEl?.remove();
    this.controlsEl = null;
  }

  /**
   * Screens call this first thing in their menu handling: while the controls card is up it eats the
   * menu input (and closes on back/confirm). Returns true while it's open.
   */
  pollControls(m: { back: boolean; confirm: boolean; pause: boolean }) {
    if (!this.controlsEl) return false;
    if ((m.back || m.confirm || m.pause) && performance.now() - this.openedAt > 200) {
      audio.play('uiBack');
      this.closeControls();
    }
    return true;
  }
}

/** A resume block from the wire, or undefined if it isn't a sane one. */
function cleanResume(r: unknown): Resume | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const o = r as Partial<Resume>;
  const seeds = Array.isArray(o.seeds) ? o.seeds.filter((s) => Number.isInteger(s) && s >= 0 && s < 5000).slice(0, 5000) : [];
  return {
    cp: Number.isInteger(o.cp) ? Math.max(-1, Math.min(64, o.cp as number)) : -1,
    seeds,
    feathers: Number.isInteger(o.feathers) ? (o.feathers as number) & 7 : 0,
    time: typeof o.time === 'number' && Number.isFinite(o.time) ? Math.max(0, Math.min(360000, o.time)) : 0,
    ...(Number.isInteger(o.gen) && (o.gen as number) > 0 ? { gen: o.gen } : {}),
  };
}
