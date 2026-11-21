export type SongId = 'title' | 'garden' | 'woods' | 'mill' | 'paris' | 'tower';

/**
 * What the music plays from samples: a felt-hammered piano for the few notes there are, and the
 * forest under it — a bed of noise the wind, the leaves and the creek are filtered out of, a bubble
 * for the creek to babble with, five birds, a cricket and an owl. Each is rendered once (in the synth
 * worker, else here in slices) and replayed. The pads and the low drone are live oscillators instead
 * (see Sequencer.chord): they hold for as long as a chord lasts, which a sample would run out on.
 */
export type Inst = 'felt' | 'noise' | 'bubble' | 'bird0' | 'bird1' | 'bird2' | 'bird3' | 'bird4' | 'cricket' | 'owl';

const BIRDS = ['bird0', 'bird1', 'bird2', 'bird3', 'bird4'] as const;

type Track =
  /** a few felt-piano notes; `keep` is the chance each written note is played, so no pass is quite the last */
  | { kind: 'melody'; inst: Inst; vol: number; oct: number; keep: number; bars: string[] }
  /** the bar's chord as a seventh, four soft detuned voices held through a low-pass that opens to `bright` Hz */
  | { kind: 'pad'; vol: number; oct: number; bright: number }
  /** the chord's root, low and held */
  | { kind: 'drone'; vol: number; oct: number };

type PadTrack = Extract<Track, { kind: 'pad' }>;
type DroneTrack = Extract<Track, { kind: 'drone' }>;

/** The forest under the music, each 0..1 — what you'd hear standing there with the music off. */
interface Air {
  wind: number;
  leaves: number;
  creek: number;
  birds: number;
  crickets: number;
  owl: number;
}

interface Song {
  bpm: number;
  beats: number;
  sub: number;
  root: number;
  scale: number[];
  /** one chord (a scale degree, played as its seventh) per bar */
  chords: number[];
  tracks: Track[];
  air: Air;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

/**
 * Slow and soft: a pad on seventh chords, a low drone, and a felt piano with more rests than notes,
 * over the wind, the leaves, a creek and the birds. The melody's loop is a different length from the
 * chords' (and drops a note now and then), so the two drift against each other rather than repeating
 * every half minute. No drums, nothing bouncing.
 */
const SONGS: Record<SongId, Song> = {
  title: {
    bpm: 60,
    beats: 4,
    sub: 2,
    root: 62,
    scale: MAJOR,
    chords: [1, 4, 6, 4, 1, 4, 2, 5],
    tracks: [
      { kind: 'pad', vol: 0.05, oct: -1, bright: 900 },
      { kind: 'drone', vol: 0.039, oct: -2 },
      { kind: 'melody', inst: 'felt', vol: 0.2, oct: 0, keep: 0.85, bars: ['3 - - - . . 5 -', '6 - - - . . . .', '. . 5 - 3 - . .', '2 - - - . . . .', '. . 1 - 2 - 3 -', '. . . . . . . .'] },
    ],
    air: { wind: 0.6, leaves: 0.5, creek: 0.7, birds: 0.8, crickets: 0, owl: 0 },
  },
  garden: {
    bpm: 64,
    beats: 4,
    sub: 2,
    root: 60,
    scale: MAJOR,
    chords: [1, 6, 4, 1, 1, 6, 2, 5],
    tracks: [
      { kind: 'pad', vol: 0.045, oct: -1, bright: 1000 },
      { kind: 'drone', vol: 0.036, oct: -2 },
      { kind: 'melody', inst: 'felt', vol: 0.2, oct: 0, keep: 0.8, bars: ['5 - - - 6 - . .', '3 - - - . . . .', '. . 2 - 3 - 5 -', '6 - - - 5 - - -', '. . . . . . . .'] },
    ],
    air: { wind: 0.4, leaves: 0.4, creek: 0.5, birds: 1, crickets: 0, owl: 0 },
  },
  woods: {
    bpm: 58,
    beats: 4,
    sub: 2,
    root: 65,
    scale: MAJOR,
    chords: [4, 3, 2, 1, 4, 3, 2, 5],
    tracks: [
      { kind: 'pad', vol: 0.045, oct: -2, bright: 800 },
      { kind: 'drone', vol: 0.036, oct: -2 },
      { kind: 'melody', inst: 'felt', vol: 0.19, oct: 0, keep: 0.8, bars: ['1 - - - . . . .', '. . 6, - - - . .', '5, - - - . . 6, -', '1 - - - . . . .', '. . 3 - 2 - - -', '1 - - - . . . .', '. . . . . . . .'] },
    ],
    air: { wind: 0.9, leaves: 0.9, creek: 0.35, birds: 0.8, crickets: 0, owl: 0 },
  },
  mill: {
    bpm: 66,
    beats: 4,
    sub: 2,
    root: 62,
    scale: MAJOR,
    chords: [1, 6, 2, 5, 1, 6, 4, 4],
    tracks: [
      { kind: 'pad', vol: 0.045, oct: -1, bright: 950 },
      { kind: 'drone', vol: 0.036, oct: -2 },
      { kind: 'melody', inst: 'felt', vol: 0.19, oct: 0, keep: 0.8, bars: ['5 - - 6 - - . .', "1' - - - . . . .", '. . 6 - 5 - . .', '3 - - - . . . .', '2 - - 3 - - 5 -', '. . . . . . . .'] },
    ],
    air: { wind: 0.4, leaves: 0.3, creek: 1, birds: 0.6, crickets: 0, owl: 0 },
  },
  paris: {
    bpm: 62,
    beats: 4,
    sub: 2,
    root: 57,
    scale: DORIAN,
    chords: [1, 4, 1, 4, 3, 7, 1, 5],
    tracks: [
      { kind: 'pad', vol: 0.045, oct: -1, bright: 850 },
      { kind: 'drone', vol: 0.036, oct: -2 },
      { kind: 'melody', inst: 'felt', vol: 0.19, oct: 1, keep: 0.8, bars: ['5 - - - 7 - . .', "1' - - - . . . .", '. . 7 - 5 - - -', '4 - - - 3 - . .', '1 - - - . . . .', '. . . . . . . .'] },
    ],
    air: { wind: 0.6, leaves: 0.3, creek: 0, birds: 0.45, crickets: 0, owl: 0 },
  },
  tower: {
    bpm: 54,
    beats: 4,
    sub: 2,
    root: 60,
    scale: MAJOR,
    chords: [6, 4, 1, 5, 6, 4, 2, 5],
    tracks: [
      { kind: 'pad', vol: 0.045, oct: -1, bright: 750 },
      { kind: 'drone', vol: 0.033, oct: -2 },
      { kind: 'melody', inst: 'felt', vol: 0.17, oct: 0, keep: 0.75, bars: ['3 - - - . . . .', '. . . . 2 - - -', '1 - - - . . . .', '. . 5, - - - . .', '6, - - - . . . .', '. . . . . . . .', '. . . . . . . .'] },
    ],
    air: { wind: 0.5, leaves: 0.2, creek: 0.3, birds: 0, crickets: 1, owl: 1 },
  },
};

// ------------------------------------------------------------------ instruments

const TAU = Math.PI * 2;
/** the felt piano is rendered at these notes and repitched to the nearest */
const BASES = [52, 64, 76, 88];
/** how long a pad chord takes to die away after its bar (so one chord melts into the next) */
const PAD_RELEASE = 1.8;
const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

let nseed = 99;
const noise = () => {
  nseed = (nseed * 1664525 + 1013904223) >>> 0;
  return nseed / 2147483648 - 1;
};

/**
 * Every sample the music needs, in a fixed order. The worker that renders them off the main thread
 * and the fallback that renders them on it both walk this list, so the samples come out the same
 * (the noise above is seeded) whichever path ran. Everything but the felt piano is one pitch.
 */
export function instNotes(): [Inst, number][] {
  const out: [Inst, number][] = BASES.map((n) => ['felt', n]);
  for (const inst of ['noise', 'bubble', ...BIRDS, 'cricket', 'owl'] as const) out.push([inst, 60]);
  return out;
}

export function renderInst(inst: Inst, note: number, rate: number): Float32Array<ArrayBuffer> {
  const dur = { felt: 3.2, noise: 6, bubble: 0.1, bird0: 0.36, bird1: 0.75, bird2: 0.72, bird3: 0.95, bird4: 0.42, cricket: 0.12, owl: 1.7 }[inst];
  const n = Math.ceil(dur * rate);
  const b = new Float32Array(n);
  /** soft edges for a stretch `len` long: up over `a` seconds, down over the last `r` */
  const edge = (len: number, a: number, r: number) => (t: number) => Math.max(0, Math.min(1, t / a, (len - t) / r));
  /** a tone from `from` to `to` seconds, its pitch f(t) phase-accumulated so a sweep stays smooth */
  const tone = (from: number, to: number, f: (t: number) => number, amp: (t: number) => number, h2 = 0.08) => {
    let ph = 0;
    const i1 = Math.min(n, Math.ceil(to * rate));
    for (let i = Math.floor(from * rate); i < i1; i++) {
      const t = i / rate - from;
      ph += f(t) / rate;
      b[i] += (Math.sin(TAU * ph) + Math.sin(TAU * 2 * ph) * h2) * amp(t);
    }
  };
  switch (inst) {
    case 'felt': {
      // a soft hammer on a string: the fundamental rings, the overtones die quickly, the top is rolled off
      const f = midiHz(note);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const s = Math.sin(TAU * f * t) + Math.sin(TAU * 2 * f * t) * 0.3 * Math.exp(-t / 0.3) + Math.sin(TAU * 3 * f * t) * 0.1 * Math.exp(-t / 0.12) + noise() * 0.06 * Math.exp(-t / 0.008);
        lp += (s - lp) * 0.35;
        b[i] = lp * Math.min(1, t / 0.008) * Math.exp(-t / 0.9) * Math.min(1, (dur - t) / 0.3) * 0.5;
      }
      break;
    }
    case 'noise':
      // looped under the filters that make wind, leaves and water of it (white noise has no seam to hear)
      for (let i = 0; i < n; i++) b[i] = noise() * 0.9;
      break;
    case 'bubble':
      // a drop into water: a blip that rises as the little cavity under it closes
      tone(0, dur, (t) => 480 * Math.pow(2.4, t / 0.06), (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.022) * 0.6, 0);
      break;
    case 'bird0':
      // tsee-tsee: two quick sweeps upward
      for (const s of [0, 0.17]) tone(s, s + 0.1, (t) => 3300 + 15000 * t, (t) => edge(0.1, 0.01, 0.03)(t) * 0.42, 0.06);
      break;
    case 'bird1':
      // a trill, gliding down
      tone(0, 0.72, (t) => 4300 - 700 * t, (t) => edge(0.72, 0.05, 0.15)(t) * (0.5 + 0.5 * Math.sin(TAU * 27 * t)) ** 2 * 0.4);
      break;
    case 'bird2':
      // fee-bee: a clear two-note whistle
      tone(0, 0.3, (t) => 3950 - 400 * t, (t) => edge(0.3, 0.025, 0.06)(t) * 0.4, 0.03);
      tone(0.36, 0.7, (t) => 3350 - 180 * t, (t) => edge(0.34, 0.025, 0.1)(t) * 0.36, 0.03);
      break;
    case 'bird3':
      // a warble
      tone(0, 0.92, (t) => 2900 + 800 * Math.sin(TAU * 7 * t) + 350 * Math.sin(TAU * 13 * t + 1), (t) => Math.sin((Math.PI * t) / 0.92) ** 1.5 * 0.34);
      break;
    case 'bird4':
      // chip-chip-chip
      for (const s of [0, 0.13, 0.26]) tone(s, s + 0.05, (t) => 5600 - 36000 * t, (t) => edge(0.05, 0.004, 0.02)(t) * 0.38);
      break;
    case 'cricket':
      // four quick pulses of one high note
      for (const s of [0, 0.025, 0.05, 0.075]) tone(s, s + 0.016, () => 4650, (t) => Math.sin((Math.PI * t) / 0.016) * 0.33, 0.15);
      break;
    case 'owl': {
      // hoo… hoo-hoo, low and breathy
      const hoots: [number, number, number][] = [
        [0, 0.38, 392],
        [0.62, 0.2, 380],
        [0.88, 0.62, 360],
      ];
      for (const [s, len, f0] of hoots) tone(s, s + len, (t) => f0 - (18 * t) / len, (t) => edge(len, 0.06, 0.12)(t) * 0.4, 0.25);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        lp += (noise() - lp) * 0.05;
        b[i] += lp * Math.abs(b[i]) * 0.6;
      }
      break;
    }
  }
  return b;
}

/** Parse a bar ("3 - 5' . 1,") into per-step tokens: degree+octave, 'hold' or 'rest'. */
function parseBar(s: string) {
  return s
    .trim()
    .split(/\s+/)
    .map((tok) => {
      if (tok === '-') return 'hold' as const;
      if (tok === '.') return 'rest' as const;
      const m = /^(\d)([#b]?)(['",]*)$/.exec(tok);
      if (!m) return 'rest' as const;
      let oct = 0;
      for (const c of m[3]) oct += c === ',' ? -1 : 1;
      return { deg: Number(m[1]), acc: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, oct };
    });
}

type Token = ReturnType<typeof parseBar>[number];

/** The forest's continuous sounds while a song plays: three filtered copies of the noise loop. */
interface Beds {
  srcs: AudioBufferSourceNode[];
  wind: GainNode;
  windLp: BiquadFilterNode;
  leaves: GainNode;
  creek: GainNode;
}

/**
 * Schedules the current song a little ahead on the audio clock (so timing never depends on frame
 * rate): felt-piano samples and live pad and drone voices through a shared reverb, and the forest
 * under them — wind that gusts, leaves that hiss on the gusts, a creek that babbles, and birds (or,
 * at night, crickets and an owl) that come and go at their own pace.
 */
export class Sequencer {
  private samples = new Map<string, AudioBuffer>();
  private song: Song | null = null;
  private songId: SongId | null = null;
  private parsed: Token[][][] = [];
  private step = 0;
  private next = 0;
  private timer = 0;
  private bus: GainNode;
  private dry: GainNode;
  /**
   * This song's own two outputs (to the reverb, and straight to the bus). A pad or a drone outlives
   * the scheduling of its bar by seconds, so leaving a song fades and cuts these — otherwise the last
   * chord of one song would come back up under the next as the bus fades in.
   */
  private songDry: GainNode | null = null;
  private songBus: GainNode | null = null;
  private beds: Beds | null = null;
  /** when each kind of forest sound is next due, on the audio clock */
  private due = { gust: 0, babble: 0, bubble: 0, bird: 0, cricket: [0, 0], owl: 0 };

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
  ) {
    this.bus = ctx.createGain();
    this.dry = ctx.createGain();
    this.bus.connect(out);
    this.dry.connect(this.bus);
    try {
      const verb = ctx.createConvolver();
      verb.buffer = this.impulse(2.2);
      const wet = ctx.createGain();
      wet.gain.value = 0.36;
      this.dry.connect(verb).connect(wet).connect(this.bus);
    } catch {
      // no reverb on this device
    }
  }

  private impulse(sec: number) {
    const rate = this.ctx.sampleRate;
    const n = Math.floor(sec * rate);
    const buf = this.ctx.createBuffer(2, n, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = noise() * Math.pow(1 - i / n, 3);
    }
    return buf;
  }

  /** Keep a sample rendered somewhere else (the synth worker). */
  setSample(inst: Inst, note: number, data: Float32Array<ArrayBuffer>) {
    const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    buf.copyToChannel(data, 0);
    this.samples.set(`${inst}:${note}`, buf);
  }

  /** Render whatever samples are still missing (in slices, to keep frames smooth). */
  async prepare() {
    const rate = this.ctx.sampleRate;
    for (const [inst, note] of instNotes()) {
      if (this.samples.has(`${inst}:${note}`)) continue;
      const data = renderInst(inst, note, rate);
      this.setSample(inst, note, data);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  play(id: SongId) {
    if (id === this.songId) return;
    this.stop();
    const song = SONGS[id];
    this.song = song;
    this.songId = id;
    this.parsed = song.tracks.map((t) => (t.kind === 'melody' ? t.bars.map(parseBar) : []));
    this.step = 0;
    const now = this.ctx.currentTime;
    try {
      this.songDry = this.ctx.createGain();
      this.songBus = this.ctx.createGain();
      this.songDry.connect(this.dry);
      this.songBus.connect(this.bus);
    } catch {
      this.songDry = this.songBus = null;
    }
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(0, now);
    this.bus.gain.linearRampToValueAtTime(1, now + 1.2);
    this.next = now + 0.15;
    this.startAir(now);
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.song = null;
    this.songId = null;
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(0, now, 0.15);
    // this song's voices fade with the bus and are then cut off from it for good
    const outs = [this.songDry, this.songBus];
    this.songDry = this.songBus = null;
    for (const g of outs) {
      if (!g) continue;
      g.gain.cancelScheduledValues(now);
      g.gain.setTargetAtTime(0, now, 0.12);
      window.setTimeout(() => g.disconnect(), 1200);
    }
    const b = this.beds;
    this.beds = null;
    if (b) for (const s of b.srcs) {
      try {
        s.stop(now + 1);
      } catch {
        // already stopped
      }
    }
  }

  /** The three beds, from one looped noise sample: wind (low), leaves (a high hiss), creek (the middle). */
  private startAir(now: number) {
    const noiseBuf = this.samples.get('noise:60');
    const out = this.songBus;
    const ctx = this.ctx;
    this.beds = null;
    if (noiseBuf && out) {
      try {
        const loop = () => {
          const s = ctx.createBufferSource();
          s.buffer = noiseBuf;
          s.loop = true;
          // (each from somewhere else in the loop, or the three would be one sound filtered three ways)
          s.start(now, Math.random() * noiseBuf.duration);
          return s;
        };
        const filter = (type: BiquadFilterType, hz: number, q: number) => {
          const f = ctx.createBiquadFilter();
          f.type = type;
          f.frequency.value = hz;
          f.Q.value = q;
          return f;
        };
        const silent = () => {
          const g = ctx.createGain();
          g.gain.value = 0;
          g.connect(out);
          return g;
        };
        const w = loop();
        const windLp = filter('lowpass', 400, 0.5);
        const wind = silent();
        w.connect(windLp).connect(wind);
        const l = loop();
        const leaves = silent();
        l.connect(filter('bandpass', 4200, 0.6)).connect(leaves);
        const c = loop();
        const creek = silent();
        c.connect(filter('bandpass', 1000, 0.6)).connect(filter('lowpass', 2600, 0.5)).connect(creek);
        this.beds = { srcs: [w, l, c], wind, windLp, leaves, creek };
      } catch {
        this.beds = null;
      }
    }
    this.due = { gust: now, babble: now, bubble: now + 0.3, bird: now + 1 + Math.random() * 3, cricket: [now + 0.5, now + 0.9], owl: now + 8 + Math.random() * 12 };
  }

  private tick() {
    const song = this.song;
    if (!song) return;
    const now = this.ctx.currentTime;
    const stepDur = 60 / song.bpm / song.sub;
    // fell far behind (tab was hidden): skip ahead instead of machine-gunning notes
    if (this.next < now - 0.3) this.next = now + 0.05;
    while (this.next < now + 0.15) {
      this.schedule(song, this.step, this.next, stepDur);
      this.next += stepDur;
      this.step++;
    }
    this.tickAir(song.air, now);
  }

  private tickAir(air: Air, now: number) {
    const d = this.due;
    const ahead = now + 0.15;
    // (after the tab was hidden or the device slept: carry on from now rather than catching up)
    if (d.bubble < now - 0.5) d.bubble = now;
    if (d.bird < now - 0.5) d.bird = now + Math.random() * 2;
    d.cricket = d.cricket.map((at) => (at < now - 0.5 ? now + Math.random() * 0.5 : at));
    if (d.owl < now - 0.5) d.owl = now + 5 + Math.random() * 10;
    const b = this.beds;
    if (b) {
      if (now >= d.gust) {
        // a gust: the wind swells and brightens, and the leaves hiss with it
        const g = 0.35 + 0.65 * Math.random();
        b.wind.gain.setTargetAtTime(air.wind * 0.9 * g, now, 1.6);
        b.windLp.frequency.setTargetAtTime(250 + 650 * g, now, 1.6);
        b.leaves.gain.setTargetAtTime(air.leaves * 0.07 * g * g, now, 1.1);
        d.gust = now + 2.5 + Math.random() * 5;
      }
      if (air.creek > 0 && now >= d.babble) {
        b.creek.gain.setTargetAtTime(air.creek * 0.3 * (0.65 + 0.35 * Math.random()), now, 0.04);
        d.babble = now + 0.05 + Math.random() * 0.09;
      }
    }
    if (air.creek > 0) {
      while (d.bubble < ahead) {
        this.oneShot('bubble', d.bubble, air.creek * 0.07 * (0.3 + 0.7 * Math.random()), (Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 1.4, false);
        d.bubble += Math.max(0.02, -Math.log(1 - Math.random()) / (11 * air.creek));
      }
    }
    if (air.birds > 0 && d.bird < ahead) {
      // one bird, from somewhere off to one side, singing its phrase once or a few times over
      const k = BIRDS[Math.floor(Math.random() * BIRDS.length)];
      const reps = Math.random() < 0.4 ? (Math.random() < 0.4 ? 3 : 2) : 1;
      const pan = (Math.random() * 2 - 1) * 0.8;
      const rate = 0.92 + Math.random() * 0.16;
      const vol = air.birds * 0.15 * (0.35 + 0.65 * Math.random());
      const len = (this.samples.get(`${k}:60`)?.duration ?? 0.5) / rate;
      let t = d.bird;
      for (let r = 0; r < reps; r++) {
        this.oneShot(k, t, r ? vol * 0.85 : vol, pan, rate, true);
        t += len + 0.12 + Math.random() * 0.3;
      }
      d.bird = t + (2 + Math.random() * 6) / air.birds;
    }
    if (air.crickets > 0) {
      for (let i = 0; i < d.cricket.length; i++) {
        if (d.cricket[i] >= ahead) continue;
        this.oneShot('cricket', d.cricket[i], air.crickets * 0.05 * (0.75 + 0.25 * Math.random()), i ? 0.45 : -0.4, 1 + i * 0.035, true);
        // (now and then one of them stops for a breath)
        d.cricket[i] += Math.random() < 0.08 ? 1.5 + Math.random() * 2.5 : 0.48 + i * 0.11 + Math.random() * 0.05;
      }
    }
    if (air.owl > 0 && d.owl < ahead) {
      this.oneShot('owl', d.owl, air.owl * 0.09, (Math.random() * 2 - 1) * 0.7, 0.97 + Math.random() * 0.06, true);
      d.owl += 16 + Math.random() * 24;
    }
  }

  /** A forest sound: `far` ones go through the reverb, which is what puts them off among the trees. */
  private oneShot(inst: Inst, t: number, vol: number, pan: number, rate: number, far: boolean) {
    const buf = this.samples.get(`${inst}:60`);
    const out = far ? this.songDry : this.songBus;
    if (!buf || !out) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = this.ctx.createGain();
      g.gain.value = vol;
      src.connect(g);
      if (this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p).connect(out);
      } else g.connect(out);
      src.start(t);
    } catch {
      // context closing
    }
  }

  private noteOf(song: Song, deg: number, oct: number, acc = 0) {
    const d = deg - 1;
    const o = Math.floor(d / 7);
    const idx = ((d % 7) + 7) % 7;
    return song.root + (o + oct) * 12 + song.scale[idx] + acc;
  }

  private schedule(song: Song, step: number, t: number, stepDur: number) {
    const perBar = song.beats * song.sub;
    const bar = Math.floor(step / perBar);
    const s = step % perBar;
    const chord = song.chords[bar % song.chords.length];
    song.tracks.forEach((tr, ti) => {
      switch (tr.kind) {
        case 'melody': {
          const bars = this.parsed[ti];
          const tok = bars[bar % bars.length][s];
          if (!tok || tok === 'hold' || tok === 'rest' || Math.random() > tr.keep) return;
          // played by hand: a touch early or late, a touch softer or harder
          const at = Math.max(this.ctx.currentTime, t + (Math.random() - 0.5) * 0.04);
          this.note(tr.inst, this.noteOf(song, tok.deg, tr.oct + tok.oct, tok.acc), at, tr.vol * (0.75 + Math.random() * 0.35));
          return;
        }
        case 'pad':
          if (s === 0) this.chord(song, tr, chord, t, perBar * stepDur);
          return;
        case 'drone':
          if (s === 0) this.drone(song, tr, chord, t, perBar * stepDur);
          return;
      }
    });
  }

  /** The bar's chord as a seventh: four voices, each two detuned triangles, under a filter that breathes. */
  private chord(song: Song, tr: PadTrack, deg: number, t: number, len: number) {
    const out = this.songDry;
    if (!out) return;
    const ctx = this.ctx;
    try {
      const end = t + len + PAD_RELEASE;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.4;
      lp.frequency.setValueAtTime(tr.bright * 0.6, t);
      lp.frequency.linearRampToValueAtTime(tr.bright, t + len * 0.5);
      lp.frequency.linearRampToValueAtTime(tr.bright * 0.6, end);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(tr.vol, t + Math.min(1.4, len * 0.4));
      g.gain.setValueAtTime(tr.vol, t + len);
      g.gain.linearRampToValueAtTime(0, end);
      lp.connect(g).connect(out);
      for (const d of [deg, deg + 2, deg + 4, deg + 6]) {
        const f = midiHz(this.noteOf(song, d, tr.oct));
        for (const cents of [-6, 6]) {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(lp);
          o.start(t);
          o.stop(end + 0.05);
        }
      }
    } catch {
      // context closing
    }
  }

  /** The chord's root, two octaves down, held (dry: reverb on the low end is mud). */
  private drone(song: Song, tr: DroneTrack, deg: number, t: number, len: number) {
    const out = this.songBus;
    if (!out) return;
    try {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = midiHz(this.noteOf(song, deg, tr.oct));
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(tr.vol, t + 0.8);
      g.gain.setValueAtTime(tr.vol, t + len);
      g.gain.linearRampToValueAtTime(0, t + len + 1.2);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + len + 1.3);
    } catch {
      // context closing
    }
  }

  private note(inst: Inst, n: number, t: number, vol: number) {
    let base = BASES[0];
    for (const b of BASES) if (Math.abs(b - n) < Math.abs(base - n)) base = b;
    const buf = this.samples.get(`${inst}:${base}`);
    const out = this.songDry;
    if (!buf || !out) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = Math.pow(2, (n - base) / 12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      src.connect(g).connect(out);
      src.start(t);
    } catch {
      // context closing
    }
  }
}
