export type SongId = 'title' | 'garden' | 'woods' | 'mill' | 'paris' | 'tower';

export type Inst = 'bell' | 'pluck' | 'pad' | 'bass' | 'reed' | 'flute' | 'marimba' | 'kick' | 'shaker' | 'click';

type Track =
  | { kind: 'melody'; inst: Inst; vol: number; oct: number; bars: string[] }
  | { kind: 'chord'; inst: Inst; vol: number; oct: number; style: 'pad' | 'arp' | 'arp2' | 'oompah' | 'offbeat' }
  | { kind: 'bass'; inst: Inst; vol: number; oct: number; steps: number[] }
  | { kind: 'drum'; inst: Inst; vol: number; pattern: string };

interface Song {
  bpm: number;
  beats: number;
  sub: number;
  root: number;
  scale: number[];
  chords: number[];
  tracks: Track[];
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];

const SONGS: Record<SongId, Song> = {
  title: {
    bpm: 92,
    beats: 3,
    sub: 2,
    root: 72,
    scale: MAJOR,
    chords: [1, 6, 4, 5, 1, 6, 2, 5],
    tracks: [
      { kind: 'melody', inst: 'bell', vol: 0.32, oct: 0, bars: ['3 - 2 - 1 -', '6, - 1 - 3 -', '4 - 6 - 5 -', '5 - - - 7, -', '3 - 5 - 1\' -', '7 - 6 - 3 -', '2 - 4 - 6 -', '5 - - - . .'] },
      { kind: 'chord', inst: 'pad', vol: 0.14, oct: -1, style: 'pad' },
      { kind: 'chord', inst: 'bell', vol: 0.07, oct: -1, style: 'arp' },
    ],
  },
  garden: {
    bpm: 112,
    beats: 4,
    sub: 2,
    root: 72,
    scale: MAJOR,
    chords: [1, 5, 6, 4, 1, 5, 4, 5],
    tracks: [
      { kind: 'melody', inst: 'marimba', vol: 0.34, oct: 0, bars: ['5 . 5 6 5 . 3 .', '2 . 2 3 2 . 7, .', '1 . 1 2 3 . 6, .', '4 - - . 3 2 1 .', '5 . 5 6 5 . 1\' .', '7 . 7 1\' 2\' . 7 .', '6 . 5 4 3 . 2 .', '5, . 7, . 2 . . .'] },
      { kind: 'chord', inst: 'pluck', vol: 0.12, oct: -1, style: 'arp' },
      { kind: 'bass', inst: 'bass', vol: 0.3, oct: -2, steps: [0, 4] },
      { kind: 'drum', inst: 'kick', vol: 0.22, pattern: 'x...x...' },
      { kind: 'drum', inst: 'click', vol: 0.08, pattern: '..x...x.' },
      { kind: 'drum', inst: 'shaker', vol: 0.05, pattern: 'xxxxxxxx' },
    ],
  },
  woods: {
    bpm: 72,
    beats: 2,
    sub: 3,
    root: 67,
    scale: MAJOR,
    chords: [1, 4, 1, 5, 6, 4, 5, 1],
    tracks: [
      { kind: 'melody', inst: 'flute', vol: 0.3, oct: 0, bars: ['3 - 2 1 - 3', '4 - 3 2 - 1', '3 - 5 5 - 3', '2 - - - . .', '6, - 1 3 - 2', '1 - 6, 4, - 6,', '5, - 7, 2 - 7,', '1 - - - . .'] },
      { kind: 'chord', inst: 'pluck', vol: 0.15, oct: -1, style: 'arp' },
      { kind: 'bass', inst: 'bass', vol: 0.28, oct: -2, steps: [0, 3] },
      { kind: 'drum', inst: 'click', vol: 0.07, pattern: 'x..x..' },
      { kind: 'drum', inst: 'shaker', vol: 0.05, pattern: '.x..x.' },
    ],
  },
  mill: {
    bpm: 116,
    beats: 2,
    sub: 4,
    root: 65,
    scale: MAJOR,
    chords: [1, 5, 5, 1, 4, 1, 5, 1],
    tracks: [
      { kind: 'melody', inst: 'marimba', vol: 0.32, oct: 0, bars: ['1 . 3 . 5 . 3 .', '5 . 7 . 2\' . 7 .', '4\' . 2\' . 7 . 5 .', '3\' - 1\' - . . . .', '6 . 1\' . 4\' . 1\' .', '5 . 3 . 1 . 3 .', '2 . 5 . 7 . 2\' .', '1\' - - - . . . .'] },
      { kind: 'chord', inst: 'pluck', vol: 0.14, oct: -1, style: 'offbeat' },
      { kind: 'bass', inst: 'bass', vol: 0.3, oct: -2, steps: [0, 4] },
      { kind: 'drum', inst: 'kick', vol: 0.2, pattern: 'x...x...' },
      { kind: 'drum', inst: 'click', vol: 0.1, pattern: '..x...x.' },
    ],
  },
  paris: {
    bpm: 168,
    beats: 3,
    sub: 2,
    root: 69,
    scale: HARM_MINOR,
    chords: [1, 1, 4, 4, 5, 5, 1, 1, 6, 6, 4, 4, 5, 5, 1, 1],
    tracks: [
      {
        kind: 'melody',
        inst: 'reed',
        vol: 0.3,
        oct: 0,
        bars: ['5 - 1\' - 3\' -', '2\' 1\' 7 1\' 5 -', '4 - 6 - 1\' -', '7 6 5 6 4 -', '2 - 5 - 7 -', '2\' 1\' 7 6 5 -', '1 - 3 - 5 -', '1\' - - - . .', '6 - 1\' - 3\' -', '4\' 3\' 2\' 3\' 1\' -', '4 - 6 - 2\' -', '1\' 7 6 7 6 -', '5 - 7 - 2\' -', '4\' 3\' 2\' 1\' 7 -', '1\' - 5 - 3 -', '1 - - - . .'],
      },
      { kind: 'chord', inst: 'pluck', vol: 0.13, oct: -1, style: 'oompah' },
      { kind: 'bass', inst: 'bass', vol: 0.32, oct: -2, steps: [0] },
      { kind: 'drum', inst: 'shaker', vol: 0.04, pattern: '..x.x.' },
    ],
  },
  tower: {
    bpm: 70,
    beats: 4,
    sub: 4,
    root: 75,
    scale: MAJOR,
    chords: [1, 6, 4, 5, 1, 6, 2, 5],
    tracks: [
      {
        kind: 'melody',
        inst: 'bell',
        vol: 0.26,
        oct: 0,
        bars: [
          '5 . . . 3 . . . 2 . 1 . . . . .',
          '6, . . . 1 . . . 3 . 2 . . . . .',
          '4 . . . 6 . . . 1\' . 6 . . . . .',
          '5 . . . . . . . 7, . . . 2 . . .',
          '3 . . . 5 . . . 1\' . 7 . 6 . 5 .',
          '3 . . . . . . . 1 . . . 6, . . .',
          '2 . . . 4 . . . 6 . 5 . 4 . . .',
          '5 . . . . . . . . . . . . . . .',
        ],
      },
      { kind: 'chord', inst: 'pad', vol: 0.15, oct: -2, style: 'pad' },
      { kind: 'chord', inst: 'bell', vol: 0.07, oct: -1, style: 'arp2' },
    ],
  },
};

// ------------------------------------------------------------------ instruments

const TAU = Math.PI * 2;
/** pitched instruments are rendered at these notes and repitched to the nearest */
const BASES = [52, 64, 76, 88];
const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

let nseed = 99;
const noise = () => {
  nseed = (nseed * 1664525 + 1013904223) >>> 0;
  return nseed / 2147483648 - 1;
};

const SUSTAINED: Partial<Record<Inst, true>> = { pad: true, reed: true, flute: true };

/**
 * Every instrument sample the songs need, in a fixed order. The worker that renders them off the
 * main thread and the fallback that renders them on it both walk this list, so the samples come out
 * the same (the noise above is seeded) whichever path ran.
 */
export function instNotes(): [Inst, number][] {
  const insts = new Set<Inst>();
  for (const s of Object.values(SONGS)) for (const t of s.tracks) insts.add(t.inst);
  const out: [Inst, number][] = [];
  for (const inst of insts) for (const note of inst === 'kick' || inst === 'shaker' || inst === 'click' ? [60] : BASES) out.push([inst, note]);
  return out;
}

export function renderInst(inst: Inst, note: number, rate: number): Float32Array<ArrayBuffer> {
  const f = midiHz(note);
  const dur = { bell: 1.6, pluck: 1.3, pad: 2.6, bass: 0.9, reed: 1.6, flute: 1.5, marimba: 0.8, kick: 0.28, shaker: 0.07, click: 0.05 }[inst];
  const n = Math.ceil(dur * rate);
  const b = new Float32Array(n);
  switch (inst) {
    case 'bell':
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const e = Math.min(1, t / 0.002) * Math.exp(-t / 0.45);
        b[i] = Math.sin(TAU * f * t + Math.sin(TAU * f * 3.5 * t) * 1.8 * Math.exp(-t / 0.2)) * e * 0.5;
      }
      break;
    case 'pluck': {
      const N = Math.max(2, Math.round(rate / f));
      const ring = new Float32Array(N);
      let lp = 0;
      for (let i = 0; i < N; i++) {
        lp += (noise() - lp) * 0.6;
        ring[i] = lp;
      }
      for (let i = 0; i < n; i++) {
        const a = ring[i % N];
        const c = ring[(i + 1) % N];
        ring[i % N] = (a + c) * 0.5 * 0.997;
        b[i] = a * 0.8 * Math.min(1, (n - i) / (rate * 0.05));
      }
      break;
    }
    case 'pad':
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        let s = 0;
        for (const d of [-0.006, 0, 0.007]) {
          const p = (f * (1 + d) * t) % 1;
          s += 1 - 4 * Math.abs(p - 0.5);
        }
        const e = Math.min(1, t / 0.35) * (t > dur - 0.4 ? (dur - t) / 0.4 : 1);
        b[i] = s * 0.17 * e;
      }
      break;
    case 'bass':
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const e = Math.min(1, t / 0.006) * Math.exp(-t / 0.3);
        b[i] = (Math.sin(TAU * f * t) * 0.8 + Math.sin(TAU * f * 2 * t) * 0.15) * e;
      }
      break;
    case 'reed': {
      // accordion: two reeds tuned slightly apart (the musette shimmer), softened
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const p1 = (f * t) % 1;
        const p2 = (f * 1.006 * t) % 1;
        const p3 = (f * 0.5 * t) % 1;
        const raw = (2 * p1 - 1) * 0.5 + (2 * p2 - 1) * 0.5 + (p3 < 0.5 ? 0.25 : -0.25);
        lp += (raw - lp) * 0.22;
        const e = Math.min(1, t / 0.03) * (t > dur - 0.3 ? (dur - t) / 0.3 : 1) * (1 + Math.sin(TAU * 5.5 * t) * 0.06);
        b[i] = lp * 0.42 * e;
      }
      break;
    }
    case 'flute':
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const vib = 1 + Math.sin(TAU * 5 * t) * 0.006 * Math.min(1, t / 0.3);
        const e = Math.min(1, t / 0.07) * (t > dur - 0.3 ? (dur - t) / 0.3 : 1);
        b[i] = (Math.sin(TAU * f * vib * t) * 0.7 + Math.sin(TAU * f * 2 * vib * t) * 0.08 + noise() * 0.03) * e * 0.6;
      }
      break;
    case 'marimba':
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const e = Math.min(1, t / 0.002);
        b[i] = (Math.sin(TAU * f * t) * Math.exp(-t / 0.28) * 0.7 + Math.sin(TAU * f * 4 * t) * Math.exp(-t / 0.03) * 0.25) * e;
      }
      break;
    case 'kick': {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        ph += (45 + 90 * Math.exp(-t / 0.04)) / rate;
        b[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.09) * 0.9;
      }
      break;
    }
    case 'shaker': {
      let prev = 0;
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const x = noise();
        b[i] = (x - prev) * 0.5 * Math.min(1, t / 0.006) * Math.exp(-t / 0.02);
        prev = x;
      }
      break;
    }
    case 'click':
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        b[i] = (Math.sin(TAU * 1250 * t) * 0.6 + noise() * 0.2) * Math.exp(-t / 0.012);
      }
      break;
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

/**
 * Schedules the current song a little ahead on the audio clock (so timing never depends on frame
 * rate), playing pre-rendered instrument samples through a shared reverb.
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
      wet.gain.value = 0.28;
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
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(0, now);
    this.bus.gain.linearRampToValueAtTime(1, now + 0.6);
    this.next = now + 0.15;
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
  }

  private tick() {
    const song = this.song;
    if (!song) return;
    const stepDur = 60 / song.bpm / song.sub;
    // fell far behind (tab was hidden): skip ahead instead of machine-gunning notes
    if (this.next < this.ctx.currentTime - 0.3) this.next = this.ctx.currentTime + 0.05;
    while (this.next < this.ctx.currentTime + 0.15) {
      this.schedule(song, this.step, this.next, stepDur);
      this.next += stepDur;
      this.step++;
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
          const toks = bars[bar % bars.length];
          const tok = toks[s];
          if (!tok || tok === 'hold' || tok === 'rest') return;
          let len = 1;
          while (toks[s + len] === 'hold') len++;
          this.note(tr.inst, this.noteOf(song, tok.deg, tr.oct + tok.oct, tok.acc), t, len * stepDur, tr.vol);
          return;
        }
        case 'chord': {
          const triad = [chord, chord + 2, chord + 4];
          const beat = s % song.sub === 0;
          switch (tr.style) {
            case 'pad':
              if (s === 0) for (const d of triad) this.note(tr.inst, this.noteOf(song, d, tr.oct), t, perBar * stepDur, tr.vol);
              return;
            case 'arp':
              this.note(tr.inst, this.noteOf(song, triad[s % 3], tr.oct), t, stepDur * 2, tr.vol);
              return;
            case 'arp2': {
              const seq = [0, 1, 2, 3, 2, 1];
              const k = seq[s % seq.length];
              this.note(tr.inst, this.noteOf(song, k === 3 ? chord + 7 : triad[k], tr.oct), t, stepDur * 2, tr.vol);
              return;
            }
            case 'oompah':
              if (beat && s !== 0) for (const d of triad) this.note(tr.inst, this.noteOf(song, d, tr.oct), t, stepDur, tr.vol);
              return;
            case 'offbeat':
              if (s % song.sub === song.sub / 2) for (const d of triad) this.note(tr.inst, this.noteOf(song, d, tr.oct), t, stepDur, tr.vol);
              return;
          }
          return;
        }
        case 'bass':
          if (tr.steps.includes(s)) this.note(tr.inst, this.noteOf(song, chord, tr.oct), t, stepDur * 2, tr.vol);
          return;
        case 'drum': {
          const c = tr.pattern[s % tr.pattern.length];
          if (c === 'x' || c === 'o') this.note(tr.inst, 60, t, stepDur, tr.vol * (c === 'o' ? 0.5 : 1));
          return;
        }
      }
    });
  }

  private note(inst: Inst, n: number, t: number, len: number, vol: number) {
    const drum = inst === 'kick' || inst === 'shaker' || inst === 'click';
    let base = 60;
    if (!drum) {
      base = BASES[0];
      for (const b of BASES) if (Math.abs(b - n) < Math.abs(base - n)) base = b;
    }
    const buf = this.samples.get(`${inst}:${base}`);
    if (!buf) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = drum ? 1 : Math.pow(2, (n - base) / 12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      src.connect(g).connect(this.dry);
      src.start(t);
      if (SUSTAINED[inst]) {
        const end = t + len;
        g.gain.setValueAtTime(vol, end);
        g.gain.linearRampToValueAtTime(0, end + 0.12);
        src.stop(end + 0.15);
      }
    } catch {
      // context closing
    }
  }
}
