import { NO_AUDIO } from '../core/testmode';
import { renderSfxSteps, SFX_ORDER, type Sfx } from './sfx';
import { instNotes, renderImpulseSteps, renderInstSteps, Sequencer, type Inst, type SongId } from './music';
import type { Steps } from './steps';

export type { Sfx } from './sfx';
export type { SongId } from './music';

/** Voices of one sound allowed at once (footsteps and seeds shouldn't pile up into a roar). */
const MAX_VOICES: Partial<Record<Sfx, number>> = { step: 2, seed: 3, land: 2, flutter: 1, plate: 2 };
/** a render on the main thread (only when there is no worker) works in idle time, this much at a time at most and at least */
const SLICE_MAX = 6;
const SLICE_MIN = 2;
/** the synth worker is given up on after this long without a word from it (patience, not a deadline) */
const STALL_MS = 6000;
/** a sound asked for while a press is starting the context waits this long for it, at most */
const WAIT_MS = 400;
/**
 * The worker is a module in development, where Vite serves it as one, and a classic script in a build,
 * which is how Vite bundles it: an older Safari or Firefox can't start a module worker, and would
 * otherwise make the whole library on the main thread.
 */
const WORKER_OPTS: WorkerOptions = import.meta.env.DEV ? { type: 'module' } : {};

/** One sound on its own peaks at about 0.65 at full volume: under this, the ceiling isn't there at all. */
const CEILING_KNEE = 0.85;
/** the ceiling's curve reaches this many times full scale (the shaper sees the signal divided by it) */
const CEILING_RANGE = 4;
let ceiling: Float32Array<ArrayBuffer> | null = null;

/**
 * A ceiling at full scale, for when several effects land at once (a yank landing: the tug, the catch
 * and a landing peaked at 1.1; ten at once at 2.2, all of it clipped by the speakers). A WaveShaper
 * whose curve is the identity up to CEILING_KNEE and bends smoothly (tanh) towards 1 above it: no
 * lookahead, so no latency, and a sound on its own never reaches the bend, so it comes out exactly
 * as it went in. (The compressor before it, with its 30 dB knee and gain makeup, shapes the mix but
 * never stopped a pile-up going over.)
 */
function ceilingCurve() {
  if (ceiling) return ceiling;
  const n = 8193;
  ceiling = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const x = CEILING_RANGE * ((2 * k) / (n - 1) - 1);
    const a = Math.abs(x);
    ceiling[k] = a <= CEILING_KNEE ? x : Math.sign(x) * (CEILING_KNEE + (1 - CEILING_KNEE) * Math.tanh((a - CEILING_KNEE) / (1 - CEILING_KNEE)));
  }
  return ceiling;
}

type Made =
  | { k: 'sfx'; name: Sfx; data: Float32Array<ArrayBuffer> }
  | { k: 'inst'; inst: Inst; note: number; data: Float32Array<ArrayBuffer> }
  | { k: 'impulse'; data: Float32Array<ArrayBuffer>[] };

type Idle = (f: (d: { timeRemaining(): number }) => void, o: { timeout: number }) => number;
const idle = (): Idle | undefined => (window as unknown as { requestIdleCallback?: Idle }).requestIdleCallback;

/** A moment the page isn't busy (between frames), or 500 ms from now, whichever is first. */
const whenIdle = () =>
  new Promise<void>((r) => {
    const ric = idle();
    if (ric) ric(() => r(), { timeout: 500 });
    else setTimeout(r, 50);
  });

/**
 * The next stretch of main-thread time a render may have, and how long it is (ms): the idle time
 * before the next frame is due where the browser says (requestIdleCallback), else a slot right after a
 * frame has been drawn. Frames always come first — a run of short tasks back to back can hold the next
 * frame off as surely as one long one.
 */
const slot = () =>
  new Promise<number>((r) => {
    const ric = idle();
    if (ric) {
      // (and if no idle time comes within 20 ms — a slow GPU draws a frame a few times a second — a short slice anyway)
      ric((d) => r(Math.min(SLICE_MAX, Math.max(SLICE_MIN, d.timeRemaining()))), { timeout: 20 });
      return;
    }
    let went = false;
    const go = () => {
      if (went) return;
      went = true;
      setTimeout(() => r(SLICE_MIN * 2), 0);
    };
    requestAnimationFrame(go);
    // (a hidden tab draws no frames)
    setTimeout(go, 50);
  });

/**
 * Sound: every effect is synthesized once into an AudioBuffer, then played as a sample — no per-sound
 * node graphs to build mid-game. Music is a small sequencer scheduling notes ahead on the audio clock.
 *
 * None of it is made in answer to a press. The context is made at boot, once the title is up, and is
 * suspended until a press asks for sound (iOS lets a context start only from a press; every other
 * browser that blocks autoplay, likewise); the library is rendered then too, in the synth worker, each
 * sound turned into an AudioBuffer as it arrives. The press itself only resumes the context — so the
 * first press is as quick as any other, and is heard.
 */
class Audio {
  /** the context, made at boot (see `ctx`) */
  private c: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private buffers = new Map<Sfx, AudioBuffer>();
  private voices = new Map<Sfx, number>();
  private seq: Sequencer | null = null;
  private wantSong: SongId | null = null;
  private vol = { music: 0.7, sfx: 0.9 };
  /** a press has asked for sound: until then nothing plays, even where the browser would allow it */
  private unlocked = false;
  /** music at volume 0: no song is scheduled at all, and the music's graph goes quiet */
  private muted = false;
  /** the instrument samples and the reverb are in place, so music can start */
  ready = false;
  /** the instrument samples and the reverb's impulse, kept: a replacement context is built from them without rendering anything again */
  private inst = new Map<string, AudioBuffer>();
  private impulse: Float32Array<ArrayBuffer>[] | null = null;
  private library: Promise<void> | null = null;
  /** presses starting the context right now (sounds asked for meanwhile wait for it, briefly) */
  private resuming = 0;
  private waiting: { name: Sfx; vol: number; pan: number; rate: number; at: number }[] = [];
  /** development builds: each piece of main-thread work the sound engine did, and how long it took (for the tests) */
  readonly work: { what: string; at: number; ms: number }[] = [];

  /** The context the sound plays on, once a press has started it (null until then). */
  get ctx() {
    return this.unlocked ? this.c : null;
  }

  /** Is the music clock running (for tests). */
  get state() {
    return this.ctx?.state ?? 'none';
  }

  /**
   * At boot, once the title has drawn its first frame and the page is idle: make the context
   * (suspended) and start on the library. Making the first context of a browser session costs the
   * browser some tens of ms on the main thread; here that lands on the title, not on a press.
   */
  warm() {
    if (NO_AUDIO || this.c) return;
    requestAnimationFrame(() => void whenIdle().then(() => this.c || this.start()));
  }

  /**
   * A press: start the sound. Must run inside the gesture's handler (iOS); safe to call repeatedly.
   * It only resumes the context — anything else waits for the next task, so the press itself is quick.
   */
  unlock() {
    if (NO_AUDIO) return;
    const first = !this.unlocked;
    this.unlocked = true;
    try {
      // (no context yet — a press before the title was idle — or one the browser closed: make one now)
      if (!this.c || this.c.state === 'closed') this.start();
      const c = this.c;
      if (!c) return;
      if (c.state !== 'running') {
        this.resuming++;
        void Promise.resolve(c.resume())
          .catch(() => undefined)
          .then(() => {
            this.resuming--;
            this.flush();
          });
      }
      if (first) setTimeout(() => this.sync(), 0);
    } catch {
      // no sound on this device
    }
  }

  /** A new context: its master chain, its sequencer, and the library (rendered once, kept for any later context). */
  private start() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const t0 = performance.now();
    let c: AudioContext;
    try {
      c = new AC({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    this.note('context', t0);
    const old = this.seq;
    this.seq = null;
    this.ready = false;
    old?.stop();
    try {
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      const master = c.createGain();
      master.gain.value = 0.9;
      const pre = c.createGain();
      pre.gain.value = 1 / CEILING_RANGE;
      const top = c.createWaveShaper();
      top.curve = ceilingCurve();
      top.oversample = 'none';
      master.connect(comp).connect(pre).connect(top).connect(c.destination);
      const sfxBus = c.createGain();
      const musicBus = c.createGain();
      sfxBus.connect(master);
      musicBus.connect(master);
      this.c = c;
      this.sfxBus = sfxBus;
      this.musicBus = musicBus;
    } catch {
      return;
    }
    c.onstatechange = () => {
      if (c === this.c && c.state === 'running') this.flush();
    };
    // until a press asks for sound there is none, even where the browser would let it start (as it always was)
    if (!this.unlocked && c.state === 'running') void c.suspend().catch(() => undefined);
    this.applyVolumes();
    void this.build(c);
  }

  /** The sequencer for this context, once the library is made: the reverb's impulse goes in at an idle moment, then the music can start. */
  private async build(c: AudioContext) {
    const seq = new Sequencer(c, this.musicBus!);
    this.seq = seq;
    this.library ??= this.makeLibrary(c.sampleRate);
    await this.library;
    if (this.c !== c) return;
    for (const [k, b] of this.inst) seq.samples.set(k, b);
    if (this.impulse) {
      // (the one piece the browser does in one go — see Sequencer.setReverb)
      await whenIdle();
      if (this.c !== c) return;
      const t0 = performance.now();
      seq.setReverb(this.impulse);
      this.note('reverb', t0);
    }
    this.ready = true;
    this.sync();
  }

  /**
   * Every effect, instrument sample and the reverb's impulse: from the worker as each is done, each
   * turned into an AudioBuffer in a task of its own; whatever the worker didn't deliver (there is no
   * worker, or it stopped answering) made here, a short slice at a time. The two make the same samples
   * to the last bit, so a worker's work is kept however far it got.
   */
  private async makeLibrary(rate: number) {
    const missing = new Set<string>([...SFX_ORDER.map((n) => `sfx:${n}`), ...instNotes().map(([i, n]) => `inst:${i}:${n}`), 'impulse']);
    await this.fromWorker(rate, (m) => this.keep(m, rate, missing));
    for (const key of [...missing]) {
      const t0 = performance.now();
      const [kind, a, b] = key.split(':');
      if (kind === 'sfx') this.keep({ k: 'sfx', name: a as Sfx, data: await this.sliced(renderSfxSteps(a as Sfx, rate)) }, rate, missing);
      else if (kind === 'inst') this.keep({ k: 'inst', inst: a as Inst, note: Number(b), data: await this.sliced(renderInstSteps(a as Inst, Number(b), rate)) }, rate, missing);
      else this.keep({ k: 'impulse', data: await this.sliced(renderImpulseSteps(rate)) }, rate, missing);
      this.note('render', t0);
    }
  }

  private keep(m: Made, rate: number, missing: Set<string>) {
    const t0 = performance.now();
    if (m.k === 'sfx') {
      this.buffers.set(m.name, this.toBuffer(m.data, rate));
      missing.delete(`sfx:${m.name}`);
    } else if (m.k === 'inst') {
      this.inst.set(`${m.inst}:${m.note}`, this.toBuffer(m.data, rate));
      missing.delete(`inst:${m.inst}:${m.note}`);
    } else {
      this.impulse = m.data;
      missing.delete('impulse');
    }
    this.note('keep', t0);
  }

  private toBuffer(data: Float32Array<ArrayBuffer>, rate: number) {
    const buf = this.c!.createBuffer(1, data.length, rate);
    buf.copyToChannel(data, 0);
    return buf;
  }

  /** The library from the synth worker, each piece handed to `take` as it comes; resolves when it is done, fails or stops answering. */
  private fromWorker(rate: number, take: (m: Made) => void) {
    return new Promise<void>((done) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./synth.worker.ts', import.meta.url), /* @vite-ignore */ WORKER_OPTS);
      } catch {
        done();
        return;
      }
      let timer = 0;
      const finish = () => {
        window.clearTimeout(timer);
        worker.terminate();
        done();
      };
      // (patience, not a deadline: a slow phone that is getting through it is let finish)
      const patience = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(finish, STALL_MS);
      };
      patience();
      worker.onerror = finish;
      worker.onmessage = (e: MessageEvent<{ k?: string; name?: Sfx; inst?: Inst; note?: number; data?: Float32Array<ArrayBuffer> | Float32Array<ArrayBuffer>[] }>) => {
        const m = e.data;
        if (m?.k === 'done' || m?.k === 'failed') return finish();
        if (m?.k === 'sfx' && m.name && m.data instanceof Float32Array) take({ k: 'sfx', name: m.name, data: m.data });
        else if (m?.k === 'inst' && m.inst && typeof m.note === 'number' && m.data instanceof Float32Array) take({ k: 'inst', inst: m.inst, note: m.note, data: m.data });
        else if (m?.k === 'impulse' && Array.isArray(m.data) && m.data.length === 2) take({ k: 'impulse', data: m.data });
        patience();
      };
      worker.postMessage({ rate });
    });
  }

  /** A render on the main thread, in the page's idle time, a slice of a few ms at a time, each in a task of its own. */
  private async sliced<T>(work: Steps<T>): Promise<T> {
    for (;;) {
      const budget = await slot();
      const t0 = performance.now();
      let r = work.next();
      while (!r.done && performance.now() - t0 < budget) r = work.next();
      this.note('slice', t0);
      if (r.done) return r.value;
    }
  }

  private note(what: string, t0: number) {
    if (import.meta.env.DEV) this.work.push({ what, at: t0, ms: performance.now() - t0 });
  }

  /** Bring the music in line with what is wanted: the song, unless it's muted, once everything is ready (and heard once a press has started the sound). */
  private sync() {
    const seq = this.seq;
    const c = this.c;
    if (!seq || !this.ready || !c || c.state === 'closed') return;
    const song = this.muted ? null : this.wantSong;
    if (!song) {
      seq.stop();
      return;
    }
    seq.prepare(song);
    if (this.unlocked) seq.play(song);
  }

  setVolumes(v: { music: number; sfx: number }) {
    this.vol = v;
    this.applyVolumes();
    const muted = !(v.music > 0);
    if (muted !== this.muted) {
      this.muted = muted;
      this.sync();
    }
  }

  private applyVolumes() {
    if (!this.c) return;
    const t = this.c.currentTime;
    this.musicBus?.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.05);
    this.sfxBus?.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  play(name: Sfx, vol = 1, pan = 0, rate = 1) {
    const c = this.c;
    if (!c || !this.unlocked || !this.sfxBus) return;
    if (c.state !== 'running') {
      // the press that is starting the context is very likely the press that wants this sound: it plays
      // the moment the context does, if that's soon
      if (this.resuming > 0 && this.buffers.has(name)) {
        const now = performance.now();
        this.waiting = this.waiting.filter((w) => now - w.at <= WAIT_MS);
        if (this.waiting.length < 8) this.waiting.push({ name, vol, pan, rate, at: now });
      }
      return;
    }
    this.voice(c, name, vol, pan, rate);
  }

  /** The sounds that waited for the context, now that it runs (any that waited too long are dropped). */
  private flush() {
    const c = this.c;
    if (!c || c.state !== 'running') return;
    const w = this.waiting;
    this.waiting = [];
    const now = performance.now();
    for (const x of w) if (now - x.at <= WAIT_MS) this.voice(c, x.name, x.vol, x.pan, x.rate);
  }

  private voice(c: AudioContext, name: Sfx, vol: number, pan: number, rate: number) {
    const buf = this.buffers.get(name);
    if (!buf || !this.sfxBus) return;
    const max = MAX_VOICES[name];
    const n = this.voices.get(name) ?? 0;
    if (max !== undefined && n >= max) return;
    try {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = c.createGain();
      g.gain.value = vol;
      let node: AudioNode = g;
      if (pan && c.createStereoPanner) {
        const p = c.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p);
        node = p;
      }
      src.connect(g);
      node.connect(this.sfxBus);
      this.voices.set(name, n + 1);
      src.onended = () => this.voices.set(name, Math.max(0, (this.voices.get(name) ?? 1) - 1));
      src.start();
    } catch {
      // a busy or closing context: skip the sound
    }
  }

  music(song: SongId | null) {
    this.wantSong = song;
    this.sync();
  }
}

export const audio = new Audio();
