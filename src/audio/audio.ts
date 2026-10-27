import { NO_AUDIO } from '../core/testmode';
import { renderSfx, type Sfx } from './sfx';
import { Sequencer, type SongId } from './music';

export type { Sfx } from './sfx';
export type { SongId } from './music';

/** Voices of one sound allowed at once (footsteps and seeds shouldn't pile up into a roar). */
const MAX_VOICES: Partial<Record<Sfx, number>> = { step: 2, seed: 3, land: 2, flutter: 1, plate: 2 };

/**
 * Sound: every effect is synthesized once into an AudioBuffer when audio first unlocks (a user
 * gesture), then played as a sample — no per-sound node graphs to build mid-game. Music is a small
 * sequencer scheduling pre-rendered instrument notes ahead of time on the audio clock.
 */
class Audio {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private buffers = new Map<Sfx, AudioBuffer>();
  private voices = new Map<Sfx, number>();
  private seq: Sequencer | null = null;
  private wantSong: SongId | null = null;
  private vol = { music: 0.7, sfx: 0.9 };
  private building = false;

  /** Create/resume the context. Must run inside a user gesture on iOS; safe to call repeatedly. */
  unlock() {
    if (NO_AUDIO) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC({ latencyHint: 'interactive' });
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.ratio.value = 4;
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(comp).connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain();
        this.musicBus = this.ctx.createGain();
        this.sfxBus.connect(this.master);
        this.musicBus.connect(this.master);
        this.applyVolumes();
        void this.build();
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null;
    }
  }

  /** Render the sound library in small slices so the first frames never hitch. */
  private async build() {
    if (this.building || !this.ctx) return;
    this.building = true;
    const rate = this.ctx.sampleRate;
    const names = renderSfx.names;
    for (const n of names) {
      const data = renderSfx(n, rate);
      const buf = this.ctx.createBuffer(1, data.length, rate);
      buf.copyToChannel(data, 0);
      this.buffers.set(n, buf);
      await new Promise((r) => setTimeout(r, 0));
    }
    this.seq = new Sequencer(this.ctx, this.musicBus!);
    await this.seq.prepare();
    if (this.wantSong) this.seq.play(this.wantSong);
  }

  setVolumes(v: { music: number; sfx: number }) {
    this.vol = v;
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus?.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.05);
    this.sfxBus?.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  play(name: Sfx, vol = 1, pan = 0, rate = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.sfxBus) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const max = MAX_VOICES[name];
    const n = this.voices.get(name) ?? 0;
    if (max !== undefined && n >= max) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = vol;
      let node: AudioNode = g;
      if (pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
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
    if (!this.seq) return;
    if (song) this.seq.play(song);
    else this.seq.stop();
  }

  /** Is the music clock running (for tests). */
  get state() {
    return this.ctx?.state ?? 'none';
  }
}

export const audio = new Audio();
