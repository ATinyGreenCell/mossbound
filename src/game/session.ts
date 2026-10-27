import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import { BUTTON_NAMES, makeControls, type ControlFrame, type Device, type DeviceId } from '../core/input';
import { clamp } from '../core/math';
import { recordClear, setRun } from '../core/save';
import { ceremony } from '../core/testmode';
import type { Flow } from '../flow';
import type { NetLink } from '../net/link';
import {
  F_ANCHOR,
  F_CLIMB_DOWN,
  F_CLIMB_UP,
  F_FLUTTER,
  F_GHOST,
  F_GOAL,
  F_GROUND,
  F_HANG,
  F_INVULN,
  F_LEFT,
  F_MENU,
  F_STRAIN,
  F_VENT,
  packSnap,
  unpackSnap,
  type CtrlMsg,
  type GameEvent,
  type Profile,
  type Resume,
} from '../net/protocol';
import { drawBird, drawBubble, drawCheckpoint, drawCrumble, drawDoor, drawFeather, drawLooseEnd, drawMover, drawNest, drawPeg, drawPlate, drawRope, drawSeed, drawSign, drawSpring, nameLabel } from '../render/art';
import { Backdrop } from '../render/backdrop';
import { Particles, PK } from '../render/particles';
import { THEMES, type Theme } from '../render/theme';
import { TileCache } from '../render/tiles';
import { ButtonList, esc } from '../ui/menu';
import { Hud } from '../ui/hud';
import { Bird, BIRD_COLORS, type BirdFx } from './bird';
import { Camera } from './camera';
import { parseLevel, type LevelData, type Pt } from './level';
import { LEVELS } from './levels';
import { menuOpen, RemoteFeed } from './remote';
import { Tether } from './tether';
import { T, TUG_COOLDOWN, TUG_MIN } from './tuning';
import { World } from './world';

export interface SessionOpts {
  level: number;
  mode: 'local' | 'online';
  link?: NetLink | null;
  /** online: which bird this screen plays (0 = host) */
  me?: 0 | 1;
  /** online: level session id, so packets from a previous level are ignored */
  nonce?: number;
  /** local: the device each player holds */
  seats?: [DeviceId, DeviceId];
  /**
   * local: which connection of that device (Device.generation). A controller that drops out and comes
   * back may come back in another player's slot, so it has to be claimed again. Updated in place when
   * a player takes their bird back.
   */
  seatGen?: [number, number];
  profiles: [Profile, Profile];
  /** continue a run: from this lantern, with these seeds and feathers already found */
  resume?: Resume;
}

/** Snapshots per second to the partner (the relay path thins this to what its broker allows). */
const SNAP_HZ = 40;
/** Silence from the partner after which the level holds still until they're back. */
const FREEZE_MS = 1600;
const NEUTRAL = makeControls();

/**
 * One level being played by two birds: locally on one screen (both simulated here), or online (this
 * screen simulates its own bird and mirrors the partner's from snapshots).
 */
export class Session implements Screen {
  readonly L: LevelData;
  readonly world: World;
  readonly birds: [Bird, Bird];
  readonly tether: Tether;
  readonly cam = new Camera();
  readonly fx = new Particles();
  readonly theme: Theme;
  private readonly backdrop: Backdrop;
  private readonly tiles: TileCache;
  private readonly hud: Hud;
  private readonly online: boolean;
  private readonly link: NetLink | null;
  private readonly feed: RemoteFeed | null;
  /** which birds this screen simulates */
  readonly auth: [boolean, boolean];
  readonly me: 0 | 1;
  private readonly nonce: number;
  private readonly seats: [DeviceId, DeviceId] | null;
  private colors: [(typeof BIRD_COLORS)[number], (typeof BIRD_COLORS)[number]];
  /** names, colors and hats by bird (online, the partner's arrives — or changes — over the network) */
  private profiles: [Profile, Profile];
  readonly seedTaken: Uint8Array;
  feathers = 0;
  checkpoint = -1;
  /** seconds of play (the level timer) */
  time = 0;
  private sharedT = 0;
  state: 'play' | 'clear' = 'play';
  paused = false;
  private frozen = false;
  private everHeard = false;
  private goalT = 0;
  private sendT = 0;
  private seq = 0;
  /** the time my bird's current state is for: the last frame that stepped it (see sendSnapshot) */
  private stateAt = 0;
  private stepAt = 0;
  private worldT = 0;
  private overlay: { el: HTMLDivElement; list: ButtonList } | null = null;
  private readonly path: Pt[] = [];
  private ambientT = 0;
  private hintSign = -1;
  /** the shared save's run needs updating (seed, feather, lantern) */
  private runDirty = false;
  private runT = 0;
  private clearRepeat = 0;
  private readonly offResize: () => void;
  private seatLost = [false, false];
  private readonly seatGen: [number, number] | null;

  constructor(
    private readonly app: App,
    private readonly flow: Flow,
    readonly opts: SessionOpts,
  ) {
    this.L = parseLevel(LEVELS[opts.level], opts.level);
    this.world = new World(this.L);
    this.theme = THEMES[this.L.def.theme];
    this.online = opts.mode === 'online';
    this.link = opts.link ?? null;
    this.me = opts.me ?? 0;
    this.nonce = opts.nonce ?? 0;
    this.seats = opts.seats ?? null;
    this.seatGen = this.seats ? (opts.seatGen ?? [app.input.device(this.seats[0])?.generation ?? 0, app.input.device(this.seats[1])?.generation ?? 0]) : null;
    this.auth = this.online ? [this.me === 0, this.me === 1] : [true, true];
    this.feed = this.online ? new RemoteFeed() : null;
    this.birds = [new Bird(0), new Bird(1)];
    this.birds.forEach((b, i) => {
      b.local = this.auth[i];
      b.place(this.L.spawns[i]);
      b.facing = i === 0 ? 1 : -1;
    });
    this.tether = new Tether(this.world);
    this.tether.slackTol = this.online ? 44 : 8;
    this.tether.reset(this.birds[0], this.birds[1]);
    this.profiles = opts.profiles;
    this.colors = colorsOf(this.profiles);
    this.seedTaken = new Uint8Array(this.L.seeds.length);
    this.backdrop = new Backdrop(this.theme);
    this.tiles = new TileCache(this.L, this.theme);
    this.hud = new Hud(app.ui, this.L.def.name, this.L.def.subtitle);
    this.hud.onMenu = () => this.togglePause();
    const r = opts.resume;
    if (r) {
      for (const i of r.seeds) if (i >= 0 && i < this.seedTaken.length) this.seedTaken[i] = 1;
      this.feathers = r.feathers & ((1 << this.L.feathers.length) - 1);
      this.checkpoint = r.cp >= 0 && r.cp < this.L.checkpoints.length ? r.cp : -1;
      this.time = r.time;
      for (const b of this.birds) b.place(this.home(b.idx));
      this.tether.reset(this.birds[0], this.birds[1]);
    }
    let seeds = 0;
    for (const v of this.seedTaken) seeds += v;
    this.hud.setSeeds(seeds, this.L.seeds.length);
    this.hud.setFeathers(this.feathers);
    this.fx.density = app.fxDensity;
    this.sharedT = this.online && this.link ? this.link.sharedNow() / 1000 : 0;
    this.world.setTime(this.sharedT);
    this.offResize = app.renderer.onResize(() => this.fitCamera());
    this.fitCamera();
    this.followCamera(0, true);
    audio.music(this.L.def.song);
    if (import.meta.env.DEV) Object.assign(window, { __fbSession: this });
  }

  enter() {
    if (this.state === 'play' && !this.overlay) this.app.touch?.setPlayActive(true);
    this.app.keepAwake(true);
  }

  private fitCamera() {
    this.cam.fit(this.app.renderer.width, this.app.renderer.height);
  }

  // ------------------------------------------------------------------ network in

  /** Gameplay messages from the partner (the flow forwards them while this screen is up). */
  onCtrl(m: CtrlMsg) {
    switch (m.t) {
      case 'ev':
        if (m.n === this.nonce) this.handleEvent(m.e);
        break;
      case 'world':
        if (m.n !== this.nonce) break;
        for (const i of m.seeds) if (i >= 0 && i < this.seedTaken.length) this.takeSeed(i, false);
        for (let i = 0; i < 3; i++) if (m.feathers & (1 << i)) this.takeFeather(i, false);
        if (m.cp > this.checkpoint) this.light(m.cp, false);
        break;
      case 'clear':
        if (m.n === this.nonce && this.state === 'play') this.clear(m.time);
        break;
    }
  }

  /** The partner's profile arrived or changed (online): names, colors and hats follow. */
  onProfile() {
    this.profiles = this.flow.profiles();
    this.colors = colorsOf(this.profiles);
  }

  onSnap(raw: unknown) {
    const s = unpackSnap(raw);
    if (!s || !this.feed || s.n !== this.nonce) return;
    this.feed.push(s);
  }

  private handleEvent(e: GameEvent) {
    const mine = this.birds[this.me];
    const other = this.birds[1 - this.me];
    switch (e.k) {
      case 'tug':
        if (!mine.anchored && !mine.ghost) this.yank(mine, other.idx);
        this.tether.twang = 1;
        this.tether.twangFrom = other.idx;
        audio.play('tug', 0.8);
        break;
      case 'emote':
        this.emote(other, e.e, false);
        break;
      case 'seed':
        this.takeSeed(e.i, false);
        break;
      case 'feather':
        this.takeFeather(e.i, false);
        break;
      case 'cp':
        this.light(e.i, false);
        break;
      case 'bounce':
        mine.squash = 0.4;
        audio.play('bounce', 0.5);
        break;
      case 'regroup':
        for (const b of this.birds) if (b.local) b.die('fall');
        break;
    }
  }

  private send(e: GameEvent) {
    if (this.online && this.link) this.link.send({ t: 'ev', n: this.nonce, e });
  }

  // ------------------------------------------------------------------ per frame

  frame(dt: number) {
    const input = this.app.input;
    // the physics stepped last frame put my bird where it was at that frame's time
    this.stateAt = this.stepAt || this.app.frameNow;
    this.stepAt = this.app.frameNow;
    if (this.flow.pollControls(input.menu)) {
      // the controls card is up and eats the menu presses
    } else if (this.overlay) {
      this.overlay.list.update(input.menu);
    } else if (input.menu.pause) {
      this.togglePause();
    }
    // online, the partner's bird plays back from their snapshots
    if (this.feed) {
      const other = this.birds[1 - this.me];
      const live = this.link?.connected ?? false;
      if (this.feed.sample(other, this.world, dt, this.app.frameNow)) this.everHeard = true;
      const quiet = this.feed.silence() > FREEZE_MS || !live;
      // hold the level still while the partner is away (their side does the same), so the string
      // never yanks across a gap when they come back — even past the grace period: they may yet
      this.frozen = this.everHeard && quiet;
      other.present = this.everHeard && !quiet;
      if (this.link?.status === 'lost') other.present = false;
      // the shared clock (host's) drives moving platforms on both screens. Ours runs with the physics
      // steps (update) and is nudged toward it, by the same amount per second at any frame rate; a big
      // disagreement (a stall, a resync) jumps — during the next step, so riders are carried along
      const want = this.link!.sharedNow() / 1000 - dt;
      const err = want - this.sharedT;
      if (Math.abs(err) > 0.25) this.sharedT = want;
      else this.sharedT += err * Math.min(1, 3 * dt);
    }
    this.updateNotices();
    this.runT -= dt;
    if (this.runDirty && this.runT <= 0) this.saveRun();
    // stream my bird to the partner — always, even while frozen, paused or cleared: the stream is also
    // the heartbeat that tells their screen we're here (without it, two frozen screens wait for each
    // other forever)
    if (this.online && this.link) {
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT += 1 / SNAP_HZ;
        if (this.sendT < 0) this.sendT = 0;
        this.sendSnapshot();
      }
      this.worldT -= dt;
      if (this.worldT <= 0) {
        this.worldT = 2;
        const seeds: number[] = [];
        this.seedTaken.forEach((v, i) => v && seeds.push(i));
        this.link.send({ t: 'world', n: this.nonce, seeds, feathers: this.feathers, cp: this.checkpoint });
      }
    }
    if (this.paused || this.state !== 'play') {
      this.animate(dt);
      return;
    }
    if (this.frozen) {
      this.animate(dt);
      return;
    }
    // one-shot actions (this frame's presses are only visible before the first sub-step)
    for (let i = 0; i < 2; i++) {
      if (!this.auth[i]) continue;
      const c = this.controlsFor(i);
      const b = this.birds[i];
      if (c.tugPressed) this.tug(b);
      if (c.heartPressed) this.emote(b, 'heart', true);
      if (c.heyPressed) this.emote(b, 'hey', true);
    }
    this.animate(dt);
  }

  private controlsFor(i: number): ControlFrame {
    if (this.overlay || this.paused) return NEUTRAL;
    // online — or a local seat on 'keys' (everything: keyboard, pads and touch together)
    if (this.online || this.seats?.[i] === 'keys') return this.app.input.controls;
    const dev = this.seats ? this.app.input.device(this.seats[i]) : null;
    if (!dev) return i === 0 ? this.app.input.controls : NEUTRAL;
    if (!dev.connected || (this.seatGen && dev.generation !== this.seatGen[i])) {
      this.seatLost[i] = true;
      return NEUTRAL;
    }
    return dev.controls;
  }

  private sendSnapshot() {
    const b = this.birds[this.me];
    let f = 0;
    if (b.grounded) f |= F_GROUND;
    if (b.anchored) f |= F_ANCHOR;
    if (b.hanging) f |= F_HANG;
    if (b.ghost) f |= F_GHOST;
    if (b.inGoal) f |= F_GOAL;
    if (b.facing < 0) f |= F_LEFT;
    if (b.fluttering) f |= F_FLUTTER;
    if (b.climbing > 0) f |= F_CLIMB_UP;
    if (b.climbing < 0) f |= F_CLIMB_DOWN;
    if (this.overlay || this.paused) f |= F_MENU;
    if (b.inVent) f |= F_VENT;
    if (b.strain > 0.5) f |= F_STRAIN;
    if (b.invuln > 0) f |= F_INVULN;
    const m = b.grounded ? b.groundMover : -1;
    this.link!.sendSnap(
      packSnap({
        seq: ++this.seq,
        // stamped with the time this state is for, not the (later, uneven) moment it goes out:
        // the partner's playback curve goes through the right points at the right times
        t: this.stateAt,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        flags: f,
        mover: m,
        rx: m >= 0 ? b.x - this.world.moverX[m] : 0,
        ry: m >= 0 ? b.y - this.world.moverY[m] : 0,
        n: this.nonce,
      }),
    );
  }

  // ------------------------------------------------------------------ physics step

  update(dt: number) {
    if (this.paused || this.state !== 'play' || this.frozen) return;
    this.time += dt;
    // the platforms' clock (online it's also kept in step with the host's, in frame())
    this.sharedT += dt;
    this.world.stepMovers(this.sharedT);
    const [A, B] = this.birds;
    for (let i = 0; i < 2; i++) {
      const b = this.birds[i];
      if (!this.auth[i]) continue;
      const other = this.birds[1 - i];
      if (b.ghost) {
        b.stepGhost(dt, this.world, other.present ? other : null, this.home(i));
        continue;
      }
      b.rope = this.tether.ends[i];
      b.lifting = b.grounded && b.rope.taut && other.present && !other.grounded && other.hanging;
      b.step(dt, this.controlsFor(i), this.world, other);
    }
    this.tether.follow(A, B);
    if (this.time >= this.ropeOffUntil) this.tether.solve(this.birds, [this.auth[0], this.auth[1]], dt);
    for (let i = 0; i < 2; i++) {
      const b = this.birds[i];
      b.rope = this.tether.ends[i];
      if (this.auth[i]) b.afterRope(this.world);
    }
    this.world.stepDynamic(dt, this.birds);
    for (let i = 0; i < 2; i++) if (this.auth[i]) this.pickups(this.birds[i]);
    this.checkGoal(dt);
    this.tether.twang = Math.max(0, this.tether.twang - dt * 1.6);
    for (let i = 0; i < 2; i++) {
      const hit = this.tether.caught[i];
      if (hit > 0) {
        this.tether.caught[i] = 0;
        if (this.auth[i] && hit > 320) {
          audio.play('catch', clamp(hit / 900, 0.3, 0.8));
          if (this.tether.twang < 0.4) {
            this.tether.twang = 0.7;
            this.tether.twangFrom = (1 - i) as 0 | 1;
          }
          if (hit > 600) this.cam.shake(1);
        }
      }
      this.drainFx(this.birds[i]);
    }
  }

  private home(i: number): Pt {
    const cp = this.checkpoint >= 0 ? this.L.checkpoints[this.checkpoint] : null;
    if (!cp) return this.L.spawns[i];
    return { x: cp.x + (i === 0 ? -14 : 14), y: cp.y - 4 };
  }

  private pickups(b: Bird) {
    if (b.ghost) return;
    const L = this.L;
    for (let i = 0; i < L.seeds.length; i++) {
      if (this.seedTaken[i]) continue;
      const s = L.seeds[i];
      if (Math.abs(s.x - b.x) < 16 && Math.abs(s.y - b.y) < 18) {
        this.takeSeed(i, true);
        this.send({ k: 'seed', i });
      }
    }
    for (let i = 0; i < L.feathers.length; i++) {
      if (this.feathers & (1 << i)) continue;
      const s = L.feathers[i];
      if (Math.abs(s.x - b.x) < 20 && Math.abs(s.y - b.y) < 22) {
        this.takeFeather(i, true);
        this.send({ k: 'feather', i });
      }
    }
    for (let i = 0; i < L.checkpoints.length; i++) {
      if (i <= this.checkpoint) continue;
      const c = L.checkpoints[i];
      if (Math.abs(c.x - b.x) < 22 && Math.abs(c.y - b.y) < 30) {
        this.light(i, true);
        this.send({ k: 'cp', i });
      }
    }
    const n = L.nest;
    b.inGoal = Math.abs(b.x - n.x) < 2.2 * T && b.y > n.y - 1.6 * T && b.y < n.y + T;
  }

  /** (tests) the string rests until then, so a teleported bird isn't reeled back before the partner's view catches up */
  private ropeOffUntil = 0;

  /** Dev/test hook: move this screen's bird somewhere (online, the partner's screen follows by snapshot). */
  devTeleport(x: number, y: number, i = this.me) {
    this.birds[i].place({ x, y });
    this.tether.reset(this.birds[0], this.birds[1]);
    this.ropeOffUntil = this.time + 1.5;
  }

  /** What a continued run needs: lantern, seeds, feathers, time. */
  resumeState(): Resume {
    const seeds: number[] = [];
    this.seedTaken.forEach((v, i) => v && seeds.push(i));
    return { cp: this.checkpoint, seeds, feathers: this.feathers, time: this.time };
  }

  private saveRun() {
    this.runDirty = false;
    this.runT = 1.5;
    if (this.state !== 'play') return;
    const r = this.resumeState();
    // both names (the run is shared: "with" reads the same on either device)
    const [a, b] = this.profiles;
    setRun({ level: this.L.index, ...r, with: this.online ? [a.name, b.name].filter(Boolean).join(' & ') : '' });
    this.flow.shareSave();
  }

  private takeSeed(i: number, mine: boolean) {
    if (this.seedTaken[i]) return;
    this.seedTaken[i] = 1;
    this.runDirty = true;
    const s = this.L.seeds[i];
    this.fx.burst(PK.Spark, s.x, s.y, 6, 120, 0.4, 4, '#ffe28a', 0, 4);
    let n = 0;
    for (const v of this.seedTaken) n += v;
    if (mine) audio.play('seed', 0.6, 0, 1 + (n % 8) * 0.04);
    else audio.play('seed', 0.35, 0, 1.1);
    this.hud.setSeeds(n, this.L.seeds.length);
  }

  private takeFeather(i: number, mine: boolean) {
    if (this.feathers & (1 << i)) return;
    this.feathers |= 1 << i;
    this.runDirty = true;
    this.runT = 0;
    const s = this.L.feathers[i];
    if (!s) return;
    this.fx.burst(PK.Star, s.x, s.y, 14, 200, 0.8, 6, '#ffd75a', 0, 3);
    this.fx.add(PK.Ring, s.x, s.y, 0, 0, 0.6, 22, '#ffe9a8');
    audio.play('feather', mine ? 0.8 : 0.6);
    this.hud.setFeathers(this.feathers);
    this.hud.toast(`golden feather ${popcount(this.feathers)} / 3`);
  }

  private light(i: number, mine: boolean) {
    if (i <= this.checkpoint || i >= this.L.checkpoints.length) return;
    this.checkpoint = i;
    this.runDirty = true;
    this.runT = 0;
    const c = this.L.checkpoints[i];
    this.fx.burst(PK.Spark, c.x + 7, c.y - 6, 12, 140, 0.7, 4, '#ffd68a', -60, 3);
    audio.play('checkpoint', mine ? 0.7 : 0.5);
  }

  private checkGoal(dt: number) {
    const [A, B] = this.birds;
    const both = A.inGoal && B.inGoal && !A.ghost && !B.ghost && B.present && A.present;
    this.goalT = both ? this.goalT + dt : 0;
    // online, the host calls it (the guest hears 'clear')
    if (this.goalT > 0.5 && (!this.online || this.me === 0)) {
      if (this.online) this.link?.send({ t: 'clear', n: this.nonce, time: this.time });
      this.clear(this.time);
    }
  }

  // ------------------------------------------------------------------ co-op moves

  private tug(b: Bird) {
    if (b.ghost || b.tugCd > 0) return;
    const other = this.birds[1 - b.idx];
    if (!other.present || other.ghost) return;
    if (this.tether.length < TUG_MIN) {
      b.tugCd = 0.2;
      return;
    }
    b.tugCd = TUG_COOLDOWN;
    this.tether.twang = 1;
    this.tether.twangFrom = b.idx;
    this.cam.shake(1.5);
    if (other.anchored) {
      // your partner is holding on: the tug pulls YOU to them
      this.yank(b, other.idx);
      audio.play('zip', 0.8);
    } else if (other.local) {
      this.yank(other, b.idx);
      audio.play('tug', 0.9);
    } else {
      // their screen yanks their bird
      this.send({ k: 'tug' });
      audio.play('tug', 0.9);
    }
  }

  /** Throw a bird along the string toward its pivot (the nearest bend, or the partner). */
  private yank(b: Bird, _toward: number) {
    const end = this.tether.ends[b.idx];
    const dx = end.pivot.x - b.x;
    const dy = end.pivot.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < 20) return;
    // aim to arrive in a fraction of a second, a little short of the pivot, with an arc
    const tau = clamp(d / 640, 0.28, 0.5);
    const g = 1900 * 0.55;
    let vx = (dx / tau) * 0.88;
    let vy = (dy * 0.88) / tau - 0.5 * g * tau - 140;
    const sp = Math.hypot(vx, vy);
    if (sp > 980) {
      vx *= 980 / sp;
      vy *= 980 / sp;
    }
    b.vx = vx;
    b.vy = vy;
    b.grounded = false;
    b.hanging = false;
    b.anchored = false;
    b.climbLen = Infinity;
    b.tuggedT = 0.45;
    b.jumping = false;
    b.squash = -0.35;
    b.groundMover = -1;
    this.fx.burst(PK.Dust, b.x, b.y + 8, 6, 90, 0.4, 5, '#f4ead8', 0, 4);
  }

  private emote(b: Bird, kind: 'heart' | 'hey', mine: boolean) {
    b.emote = kind;
    b.emoteT = 2.2;
    const other = this.birds[1 - b.idx];
    const close = Math.hypot(b.x - other.x, b.y - other.y) < 44 && !other.ghost && other.present;
    if (kind === 'heart') {
      this.fx.burst(PK.Heart, b.x, b.y - 18, close ? 10 : 4, close ? 90 : 50, 1.2, close ? 9 : 7, '#ff6f9a', -80, 2.5, 30);
      audio.play(close ? 'nuzzle' : 'heart', 0.7, 0, 0.95 + b.idx * 0.1);
      if (close) {
        b.squash = other.squash = 0.25;
        b.facing = other.x > b.x ? 1 : -1;
      }
    } else {
      audio.play('hey', 0.7, 0, 0.95 + b.idx * 0.1);
    }
    if (mine) this.send({ k: 'emote', e: kind });
  }

  /** Turn birds' step events into sounds, dust and messages. */
  private drainFx(b: Bird) {
    if (!b.fx.length) return;
    const pan = clamp((b.x - this.cam.x) / (this.cam.viewW / 2), -1, 1) * 0.6;
    const vol = b.local ? 1 : 0.55;
    for (const e of b.fx) this.onFx(b, e, pan, vol);
    b.fx.length = 0;
  }

  private onFx(b: Bird, e: BirdFx, pan: number, vol: number) {
    const fx = this.fx;
    switch (e.k) {
      case 'jump':
        audio.play('jump', 0.55 * vol, pan, 0.95 + b.idx * 0.08);
        fx.burst(PK.Dust, b.x, b.y + 9, 4, 60, 0.35, 4, '#f2e8d8', 0, 5);
        break;
      case 'hop':
        audio.play('hop', 0.6 * vol, pan);
        break;
      case 'land':
        audio.play('land', clamp(e.v / 900, 0.25, 0.9) * vol, pan);
        fx.burst(PK.Dust, b.x, b.y + 9, Math.round(clamp(e.v / 120, 3, 10)), 90, 0.4, 5, '#f2e8d8', 0, 5);
        if (e.v > 700 && b.local) this.cam.shake(1.2);
        break;
      case 'flutter':
        audio.play('flutter', 0.5 * vol, pan, 1 + b.idx * 0.1);
        fx.burst(PK.Feather, b.x, b.y, 2, 40, 0.8, 4, this.colors[b.idx].body, 60, 1);
        break;
      case 'spring':
        audio.play('spring', 0.7 * vol, pan);
        fx.burst(PK.Spark, b.x, b.y + 8, 8, 160, 0.4, 4, '#ffffff', 0, 4);
        break;
      case 'bounce':
        audio.play('bounce', 0.7 * vol, pan);
        if (b.local) {
          const other = this.birds[1 - b.idx];
          if (other.local) other.squash = 0.4;
          else this.send({ k: 'bounce' });
        }
        break;
      case 'bonk':
        audio.play('bonk', 0.5 * vol, pan);
        break;
      case 'die':
        audio.play('die', 0.7 * vol, pan);
        fx.burst(PK.Feather, b.x, Math.min(b.y, this.world.floorY), 10, 160, 1.2, 5, this.colors[b.idx].body, 120, 1.5);
        if (b.local) this.cam.shake(2);
        break;
      case 'respawn':
        audio.play('respawn', 0.6 * vol, pan);
        fx.burst(PK.Star, b.x, b.y, 10, 120, 0.6, 5, '#fff3c0', 0, 3);
        break;
      case 'step':
        if (Math.random() < 0.5) fx.add(PK.Dust, b.x - b.facing * 6, b.y + 9, -b.facing * 20, -10, 0.3, 3, '#efe4d2', 0, 4);
        audio.play('step', 0.25 * vol, pan, 0.9 + Math.random() * 0.25);
        break;
      case 'grab':
        audio.play('grab', 0.5 * vol, pan);
        break;
      case 'mantle':
        audio.play('mantle', 0.5 * vol, pan);
        fx.burst(PK.Dust, b.x, b.y + 8, 4, 50, 0.3, 4, '#f2e8d8', 0, 5);
        break;
    }
  }

  // ------------------------------------------------------------------ level clear, pause

  private clear(time: number) {
    if (this.state === 'clear') return;
    this.state = 'clear';
    this.app.touch?.setPlayActive(false);
    audio.play('clear', 0.8);
    const n = this.L.nest;
    for (let k = 0; k < 3; k++) this.fx.burst(PK.Heart, n.x, n.y - 20, 8, 160, 1.6, 9, ['#ff6f9a', '#ffb3c8', '#ffd75a'][k], -60, 1.5, 40);
    let seeds = 0;
    for (const v of this.seedTaken) seeds += v;
    recordClear(this.L.def.id, this.L.index, seeds, this.feathers, time);
    this.flow.shareSave();
    // a 'clear' lost in a path hand-over would strand the guest in the level: keep repeating it
    if (this.online && this.me === 0) this.clearRepeat = window.setInterval(() => this.link?.send({ t: 'clear', n: this.nonce, time }), 1500);
    const last = this.L.index >= LEVELS.length - 1;
    const lead = !this.online || this.me === 0;
    const partner = this.profiles[1 - this.me]?.name || 'your partner';
    setTimeout(
      () => {
        if (this.disposed) return;
        const stars = [0, 1, 2].map((i) => `<i class="feather-ico${this.feathers & (1 << i) ? ' on' : ''}"></i>`).join('');
        const buttons = lead
          ? `${last ? '<div class="btn" data-act="ending">THE END ♥</div>' : '<div class="btn" data-act="next">NEXT LEVEL</div>'}
             <div class="btn small" data-act="again">PLAY AGAIN</div>
             <div class="btn small" data-act="levels">LEVELS</div>`
          : `<p class="ov-note">waiting for ${esc(partner)} to pick what's next…</p><div class="btn small" data-act="leave">LEAVE ROOM</div>`;
        this.openOverlay(
          `<div class="ov-title">home sweet nest!</div>
           <div class="ov-stats"><span><i class="seed-ico"></i> ${seeds} / ${this.L.seeds.length}</span><span class="feathers">${stars}</span><span>⏱ ${fmtTime(time)}</span></div>
           <div class="ov-buttons">${buttons}</div>`,
          (a) => {
            if (a === 'next') this.flow.playLevel(this.L.index + 1);
            else if (a === 'again') this.flow.playLevel(this.L.index);
            else if (a === 'levels') this.flow.levels();
            else if (a === 'ending') this.flow.ending();
            else if (a === 'leave') this.flow.leaveOnline();
          },
          null,
          'clear',
        );
        // (the guest's only button leaves the room: a jump still held from the landing mustn't press it)
        if (!lead) this.overlay?.list.disarm();
      },
      1600 / ceremony(1),
    );
  }

  togglePause() {
    if (this.state !== 'play') return;
    if (this.overlay) {
      this.closeOverlay();
      return;
    }
    this.paused = !this.online;
    this.app.touch?.setPlayActive(false);
    const leave = this.online ? (this.me === 0 ? 'BACK TO LEVELS' : 'LEAVE ROOM') : 'QUIT TO LEVELS';
    this.openOverlay(
      `<div class="ov-title">${this.online ? 'menu' : 'paused'}</div>
       ${this.online ? `<p class="ov-note">the game keeps going for ${esc(this.profiles[1 - this.me]?.name || 'your partner')}</p>` : ''}
       <div class="ov-buttons">
         <div class="btn" data-act="resume">RESUME</div>
         <div class="btn small" data-act="regroup">REGROUP AT THE LANTERN</div>
         <div class="btn small" data-act="controls">HOW TO PLAY</div>
         <div class="btn small" data-act="quit">${leave}</div>
       </div>`,
      (a) => {
        if (a === 'resume') this.closeOverlay();
        else if (a === 'regroup') {
          this.closeOverlay();
          for (const b of this.birds) if (b.local) b.die('fall');
          this.send({ k: 'regroup' });
        } else if (a === 'controls') this.flow.showControls();
        else if (a === 'quit') {
          if (this.online && this.me === 1) this.flow.leaveOnline();
          else this.flow.levels();
        }
      },
      () => this.closeOverlay(),
    );
  }

  private openOverlay(html: string, act: (a: string) => void, back: (() => void) | null, cls = '') {
    this.closeOverlay();
    const el = document.createElement('div');
    el.className = `overlay ${cls}`;
    el.innerHTML = `<div class="ov-card">${html}</div>`;
    this.app.ui.appendChild(el);
    const list = new ButtonList(el, act, back);
    this.overlay = { el, list };
  }

  private closeOverlay() {
    if (!this.overlay) return;
    this.overlay.list.dispose();
    this.overlay.el.remove();
    this.overlay = null;
    this.paused = false;
    this.app.input.flush();
    if (this.state === 'play') this.app.touch?.setPlayActive(true);
  }

  suspend() {
    // a local game pauses when the page is hidden; online it keeps running (the partner waits for us)
    if (!this.online && this.state === 'play' && !this.overlay) this.togglePause();
  }

  private updateNotices() {
    if (this.online && this.link) {
      const p = this.profiles[1 - this.me];
      const away = this.frozen || this.link.status === 'reconnecting';
      this.hud.setPartner({ name: p.name || 'partner', color: this.colors[1 - this.me].body, ping: this.link.rtt, via: this.link.via, state: !this.everHeard ? 'waiting' : away ? 'away' : 'ok' });
      if (this.link.status === 'lost') this.hud.notice(`<b>${esc(p.name || 'your partner')} left the room</b><span>open the menu to head back</span>`);
      else if (away) this.hud.notice(`<b>waiting for ${esc(p.name || 'your partner')}…</b><span>their connection dropped — the level holds still until they're back</span>`);
      else if (!this.everHeard) this.hud.notice(`<b>waiting for ${esc(p.name || 'your partner')}…</b>`);
      else this.hud.notice(null);
      return;
    }
    const lost = this.seatLost.findIndex((v) => v);
    if (lost >= 0 && this.seats) {
      this.reclaim(lost);
      this.hud.notice(`<b>player ${lost + 1}'s controller disconnected</b><span>reconnect it and press Ⓐ to keep playing</span>`);
    } else this.hud.notice(null);
  }

  /**
   * Player `i`'s controller went away. Whoever presses Ⓐ (or jump) on a controller the other player
   * isn't holding takes the bird back — a reconnected pad can turn up in another slot, so it's never
   * handed back by slot number alone.
   */
  private reclaim(i: number) {
    const seats = this.seats!;
    const gen = this.seatGen!;
    const devs = this.app.input.devices();
    const pressed = (d: Device) => d.menu.confirm || d.controls.jumpPressed;
    const holds = (d: Device, k: number) => !this.seatLost[k] && d.id === seats[k] && d.generation === gen[k];
    // a press on the other player's controller is theirs — and some drivers show one controller twice,
    // its twin pressing in the same frame
    if (devs.some((d) => holds(d, 1 - i) && pressed(d))) return;
    const d = devs.find(pressed);
    if (!d) return;
    seats[i] = d.id;
    gen[i] = d.generation;
    this.seatLost[i] = false;
    audio.play('join');
  }

  // ------------------------------------------------------------------ animation & camera

  private animate(dt: number) {
    const [A, B] = this.birds;
    A.animate(dt, B.present ? B : null);
    B.animate(dt, A.present ? A : null);
    this.fx.update(dt);
    this.followCamera(dt, false);
    this.spawnAmbient(dt);
    this.updateHint();
  }

  private followCamera(dt: number, snap: boolean) {
    const [A, B] = this.birds;
    const me = this.birds[this.me];
    const other = this.birds[1 - this.me];
    const pts: Pt[] = [];
    const w: number[] = [];
    if (this.online) {
      if (!me.ghost || !other.present) {
        pts.push(me);
        w.push(other.present && !other.ghost ? 0.62 : 1);
      }
      if (other.present && !other.ghost) {
        pts.push(other);
        w.push(me.ghost ? 1 : 0.38);
      }
    } else {
      if (!A.ghost) pts.push(A);
      if (!B.ghost) pts.push(B);
      for (let i = 0; i < pts.length; i++) w.push(1 / pts.length);
    }
    if (!pts.length) {
      pts.push(me);
      w.push(1);
    }
    const lead = { x: this.online ? me.facing * 18 + me.vx * 0.12 : 0, y: 0 };
    // the view stops at the map's bottom edge, unless someone hangs on the string below it
    let low = 0;
    for (const p of pts) low = Math.max(low, p.y);
    const bottom = Math.min(this.world.floorY, Math.max(this.L.h * T, low + 3 * T));
    this.cam.follow(dt, pts, w, lead, { w: this.L.w * T, h: bottom }, snap);
  }

  private spawnAmbient(dt: number) {
    this.ambientT -= dt * this.fx.density;
    const th = this.theme;
    const cam = this.cam;
    const x0 = cam.x - cam.viewW / 2;
    const y0 = cam.y - cam.viewH / 2;
    while (this.ambientT <= 0) {
      this.ambientT += 0.18;
      const c = th.ambientColor[Math.floor(Math.random() * th.ambientColor.length)];
      const x = x0 + Math.random() * cam.viewW;
      if (th.ambient === 'petals' || th.ambient === 'leaves') this.fx.add(PK.Leaf, x, y0 - 10, 20 + Math.random() * 20, 30 + Math.random() * 25, 7, th.ambient === 'leaves' ? 4 : 3, c, 0, 0);
      else if (th.ambient === 'twinkle') this.fx.add(PK.Star, x, y0 + Math.random() * cam.viewH, 0, 0, 1.2, 3 + Math.random() * 2, c, 0, 0);
      else this.fx.add(PK.Dust, x, y0 + Math.random() * cam.viewH, 4, -8, 3, 1.4, c, 0, 0);
    }
    // updrafts show as rising streaks (and chimney smoke on the rooftops)
    for (const v of this.L.vents) {
      if (v.x1 < x0 || v.x0 > x0 + cam.viewW) continue;
      if (Math.random() < dt * 14 * this.fx.density) {
        const x = v.x0 + 4 + Math.random() * (v.x1 - v.x0 - 8);
        if (th.id === 'paris') this.fx.add(PK.Smoke, x, v.bottom - 4, (Math.random() - 0.5) * 10, -120, 1.6, 6, 'rgba(240,230,240,0.9)', 0, 0.2);
        else this.fx.add(PK.Wind, x, v.bottom, 0, -280 - Math.random() * 100, (v.bottom - v.top) / 330, 10 + Math.random() * 10, '#ffffff', 0, 0);
      }
    }
  }

  private updateHint() {
    let best = -1;
    let bestD = 64;
    for (let i = 0; i < this.L.signs.length; i++) {
      const s = this.L.signs[i];
      for (let k = 0; k < 2; k++) {
        const b = this.birds[k];
        if (!this.auth[k] || b.ghost) continue;
        const d = Math.hypot(b.x - s.x, b.y - s.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    this.hintSign = best;
    if (best < 0 || this.overlay) {
      this.hud.hint(null);
      return;
    }
    const s = this.L.signs[best];
    const names = BUTTON_NAMES[this.app.input.lastDevice];
    const text = esc(s.text).replace(/\{(\w+)\}/g, (_m, k: string) => `<b>${names[k as keyof typeof names] ?? k}</b>`);
    const p = this.cam.toCss(s.x, s.y - 34, this.app.renderer.pixelRatio);
    this.hud.hint(text, p.x, p.y);
  }

  // ------------------------------------------------------------------ drawing

  render() {
    const r = this.app.renderer;
    const ctx = r.ctx;
    const cam = this.cam;
    const th = this.theme;
    const W = r.width;
    const H = r.height;
    const t = this.app.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    this.backdrop.draw(ctx, W, H, cam.x, cam.y + cam.viewH / 2, this.L.h * T, cam.scale, t);
    // world space
    const s = cam.scale;
    ctx.setTransform(s, 0, 0, s, -cam.ox, -cam.oy);
    const x0 = cam.ox / s - T;
    const y0 = cam.oy / s - T;
    const x1 = x0 + cam.viewW + 2 * T;
    const y1 = y0 + cam.viewH + 2 * T;
    const vis = (x: number, y: number, m = 0) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m;
    // things behind the tiles
    for (const p of this.L.pegs) if (vis(p.x, p.y)) drawPeg(ctx, p.x, p.y, th, t, this.tether.pts.some((w) => w.peg && w.x === p.x && w.y === p.y));
    for (let i = 0; i < this.L.movers.length; i++) {
      const x = this.world.moverX[i];
      const y = this.world.moverY[i];
      if (vis(x, y, this.L.movers[i].w)) drawMover(ctx, x, y, this.L.movers[i].w, th);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.tiles.draw(ctx, s, cam.fullScale, cam.ox, cam.oy, W, H);
    ctx.setTransform(s, 0, 0, s, -cam.ox, -cam.oy);
    // dynamic level pieces
    const w = this.world;
    for (const d of this.L.doors) if (vis(d.tx * T, d.ty * T, T)) drawDoor(ctx, d.tx, d.ty, w.doorOpen[d.group], d.group, th);
    for (let i = 0; i < this.L.crumbles.length; i++) {
      const c = this.L.crumbles[i];
      if (vis(c.tx * T, c.ty * T, T)) drawCrumble(ctx, c.tx, c.ty, w.crumbleShake(i), th, t);
    }
    for (let i = 0; i < this.L.plates.length; i++) {
      const p = this.L.plates[i];
      if (vis(p.tx * T, p.ty * T, T)) drawPlate(ctx, p.tx, p.ty, !!w.plateDown[i], p.group, th.ink);
    }
    for (let i = 0; i < this.L.springs.length; i++) {
      const sp = this.L.springs[i];
      if (vis(sp.x, sp.y)) drawSpring(ctx, sp.x, sp.y, w.springT[i], th);
    }
    for (let i = 0; i < this.L.signs.length; i++) {
      const sg = this.L.signs[i];
      if (vis(sg.x, sg.y)) drawSign(ctx, sg.x, sg.y, th, i === this.hintSign);
    }
    for (let i = 0; i < this.L.checkpoints.length; i++) {
      const c = this.L.checkpoints[i];
      if (vis(c.x, c.y, T)) drawCheckpoint(ctx, c.x, c.y, i <= this.checkpoint, t, th);
    }
    const n = this.L.nest;
    if (vis(n.x, n.y, 3 * T)) drawNest(ctx, n.x, n.y, t, +this.birds[0].inGoal + +this.birds[1].inGoal, th);
    for (let i = 0; i < this.L.seeds.length; i++) {
      if (this.seedTaken[i]) continue;
      const sd = this.L.seeds[i];
      if (vis(sd.x, sd.y)) drawSeed(ctx, sd.x, sd.y, t, i);
    }
    for (let i = 0; i < this.L.feathers.length; i++) {
      if (this.feathers & (1 << i)) continue;
      const f = this.L.feathers[i];
      if (vis(f.x, f.y, T)) drawFeather(ctx, f.x, f.y, t);
    }
    // the string
    const [A, B] = this.birds;
    const ink = th.ink;
    if (A.present && B.present && !A.ghost && !B.ghost) {
      drawRope(ctx, this.tether.path(this.path), this.tether.length, this.colors[0].body, this.colors[1].body, this.tether.tension, this.tether.twang, this.tether.twangFrom, t, th.glow, this.solidPx);
    } else {
      for (const b of this.birds) if (b.present && !b.ghost) drawLooseEnd(ctx, b, this.colors[b.idx].body, t);
    }
    // birds (mine on top)
    const order = this.online ? [1 - this.me, this.me] : [0, 1];
    for (const i of order) {
      const b = this.birds[i];
      if (!b.present && !b.local) continue;
      const prof = this.profiles[i];
      drawBird(ctx, b, this.colors[i], t, ink, prof.hat || 'none', !b.local && (menuOpen.get(b) ?? false));
    }
    this.fx.draw(ctx, x0, y0, x1, y1, s, cam.ox, cam.oy);
    for (const i of order) {
      const b = this.birds[i];
      if (!b.present && !b.local) continue;
      if (b.emote) drawBubble(ctx, b.x + 10, b.y - 30, b.emote, 2.2 - b.emoteT, ink);
      else if (!b.local && menuOpen.get(b)) drawBubble(ctx, b.x + 10, b.y - 30, 'menu', t, ink);
    }
    // names, crisp in screen space
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const px = Math.round(clamp(11 * r.pixelRatio, 10, 26));
    for (const i of order) {
      const b = this.birds[i];
      const name = this.profiles[i].name;
      if (!name || b.ghost || (!b.present && !b.local)) continue;
      if (this.online && i === this.me) continue;
      const lab = nameLabel(name, '#ffffff', px);
      const sx = Math.round(b.x * s - cam.ox - lab.width / 2);
      const sy = Math.round((b.y - 28) * s - cam.oy - lab.height - (b.emote ? 26 * s : 0));
      ctx.drawImage(lab, sx, sy);
    }
    if (th.tint) {
      ctx.fillStyle = th.tint;
      ctx.fillRect(0, 0, W, H);
    }
  }

  private readonly solidPx = (x: number, y: number) => this.world.solidAt(Math.floor(x / T), Math.floor(y / T)) || this.world.onewayAt(Math.floor(x / T), Math.floor(y / T));

  private disposed = false;

  dispose() {
    this.disposed = true;
    window.clearInterval(this.clearRepeat);
    this.closeOverlay();
    this.hud.dispose();
    this.offResize();
    // (a level's painted tiles and scenery are tens of MB: give them back now, not at some later GC)
    this.tiles.clear();
    this.backdrop.release();
    this.app.touch?.setPlayActive(false);
    this.app.keepAwake(false);
    if (import.meta.env.DEV && (window as unknown as { __fbSession?: Session }).__fbSession === this) delete (window as unknown as { __fbSession?: Session }).__fbSession;
  }
}

const popcount = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);

function colorsOf(p: [Profile, Profile]): [(typeof BIRD_COLORS)[number], (typeof BIRD_COLORS)[number]] {
  const c0 = BIRD_COLORS[Math.abs(p[0].color) % BIRD_COLORS.length];
  let c1 = BIRD_COLORS[Math.abs(p[1].color) % BIRD_COLORS.length];
  if (c1 === c0) c1 = BIRD_COLORS[(Math.abs(p[1].color) + 1) % BIRD_COLORS.length];
  return [c0, c1];
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}
