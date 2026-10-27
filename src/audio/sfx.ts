export type Sfx =
  | 'jump'
  | 'hop'
  | 'land'
  | 'flutter'
  | 'spring'
  | 'bounce'
  | 'bonk'
  | 'die'
  | 'respawn'
  | 'step'
  | 'grab'
  | 'mantle'
  | 'tug'
  | 'zip'
  | 'catch'
  | 'seed'
  | 'feather'
  | 'checkpoint'
  | 'door'
  | 'plate'
  | 'crumble'
  | 'heart'
  | 'hey'
  | 'nuzzle'
  | 'clear'
  | 'uiMove'
  | 'uiSelect'
  | 'uiBack'
  | 'join'
  | 'leave';

const TAU = Math.PI * 2;

// a fixed-seed noise source so every device synthesizes the same sounds
let seed = 12345;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2147483648 - 1;
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Exponential-ish envelope: attack, then decay to silence. */
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));

interface ToneOpts {
  f0: number;
  f1?: number;
  dur: number;
  at?: number;
  vol?: number;
  attack?: number;
  decay?: number;
  type?: 'sine' | 'tri' | 'square' | 'saw';
  /** vibrato: [rate Hz, depth (fraction of pitch)] */
  vib?: [number, number];
}

function tone(buf: Float32Array, rate: number, o: ToneOpts) {
  const start = Math.floor((o.at ?? 0) * rate);
  const n = Math.min(buf.length - start, Math.floor(o.dur * rate));
  const vol = o.vol ?? 0.5;
  const attack = o.attack ?? 0.005;
  const decay = o.decay ?? o.dur / 4;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const u = i / n;
    let f = o.f1 !== undefined ? o.f0 * Math.pow(o.f1 / o.f0, u) : o.f0;
    if (o.vib) f *= 1 + Math.sin(TAU * o.vib[0] * t) * o.vib[1];
    ph += f / rate;
    const p = ph % 1;
    let s: number;
    switch (o.type ?? 'sine') {
      case 'tri':
        s = 1 - 4 * Math.abs(p - 0.5);
        break;
      case 'square':
        s = p < 0.5 ? 0.6 : -0.6;
        break;
      case 'saw':
        s = 2 * p - 1;
        break;
      default:
        s = Math.sin(TAU * p);
    }
    // a short fade at the very end avoids clicks
    const tail = Math.min(1, (n - i) / (rate * 0.004));
    buf[start + i] += s * vol * env(t, attack, decay) * tail;
  }
}

/** Filtered noise burst; `lp` / `hp` are one-pole cutoffs in Hz (lp may sweep to lp1). */
function hiss(buf: Float32Array, rate: number, o: { dur: number; at?: number; vol?: number; lp?: number; lp1?: number; hp?: number; attack?: number; decay?: number }) {
  const start = Math.floor((o.at ?? 0) * rate);
  const n = Math.min(buf.length - start, Math.floor(o.dur * rate));
  let lp = 0;
  let hpPrev = 0;
  let hpOut = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const u = i / n;
    const cut = o.lp ? (o.lp1 ? o.lp * Math.pow(o.lp1 / o.lp, u) : o.lp) : rate / 2;
    const a = Math.min(1, (TAU * cut) / rate);
    lp += (noise() - lp) * a;
    let s = lp;
    if (o.hp) {
      const k = 1 / (1 + (TAU * o.hp) / rate);
      hpOut = k * (hpOut + s - hpPrev);
      hpPrev = s;
      s = hpOut;
    }
    const tail = Math.min(1, (n - i) / (rate * 0.004));
    buf[start + i] += s * (o.vol ?? 0.4) * env(t, o.attack ?? 0.002, o.decay ?? o.dur / 4) * tail;
  }
}

/** Karplus-Strong plucked string (the string's twang). */
function pluck(buf: Float32Array, rate: number, f: number, o: { at?: number; dur: number; vol?: number; damp?: number; bend?: number }) {
  const start = Math.floor((o.at ?? 0) * rate);
  const n = Math.min(buf.length - start, Math.floor(o.dur * rate));
  let N = Math.max(2, Math.round(rate / f));
  const ring = new Float32Array(Math.round(rate / (f * Math.min(1, o.bend ?? 1))) + 4);
  for (let i = 0; i < N; i++) ring[i] = noise() * 0.9;
  let idx = 0;
  const damp = o.damp ?? 0.996;
  for (let i = 0; i < n; i++) {
    if (o.bend && o.bend !== 1) {
      // pitch slides by stretching the loop
      const target = Math.round(rate / (f * (1 + (o.bend - 1) * (i / n))));
      if (target !== N && target < ring.length - 1) N = Math.max(2, target);
    }
    const a = ring[idx % N];
    const b = ring[(idx + 1) % N];
    const out = a;
    ring[idx % N] = (a + b) * 0.5 * damp;
    idx++;
    const tail = Math.min(1, (n - i) / (rate * 0.01));
    buf[start + i] += out * (o.vol ?? 0.5) * tail;
  }
}

/** FM bell (music box / chime). */
function bell(buf: Float32Array, rate: number, f: number, o: { at?: number; dur: number; vol?: number; ratio?: number; index?: number }) {
  const start = Math.floor((o.at ?? 0) * rate);
  const n = Math.min(buf.length - start, Math.floor(o.dur * rate));
  const ratio = o.ratio ?? 3.5;
  const idx0 = o.index ?? 2.2;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const e = env(t, 0.002, o.dur / 5);
    const m = Math.sin(TAU * f * ratio * t) * idx0 * e;
    const tail = Math.min(1, (n - i) / (rate * 0.005));
    buf[start + i] += Math.sin(TAU * f * t + m) * (o.vol ?? 0.4) * e * tail;
  }
}

/** A quick bird chirp: a fast upward FM sweep. */
function chirp(buf: Float32Array, rate: number, f0: number, f1: number, at: number, dur: number, vol: number) {
  tone(buf, rate, { f0, f1, dur, at, vol, attack: 0.004, decay: dur * 0.6, vib: [55, 0.03] });
  tone(buf, rate, { f0: f0 * 2, f1: f1 * 2, dur: dur * 0.8, at, vol: vol * 0.15, attack: 0.004, decay: dur * 0.4 });
}

function normalize(buf: Float32Array<ArrayBuffer>, peak: number) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
  return buf;
}

const LEN: Record<Sfx, number> = {
  jump: 0.16,
  hop: 0.22,
  land: 0.14,
  flutter: 0.24,
  spring: 0.42,
  bounce: 0.26,
  bonk: 0.1,
  die: 0.6,
  respawn: 0.6,
  step: 0.04,
  grab: 0.18,
  mantle: 0.14,
  tug: 0.7,
  zip: 0.45,
  catch: 0.4,
  seed: 0.22,
  feather: 0.9,
  checkpoint: 1.1,
  door: 0.5,
  plate: 0.12,
  crumble: 0.45,
  heart: 0.32,
  hey: 0.24,
  nuzzle: 0.9,
  clear: 1.8,
  uiMove: 0.05,
  uiSelect: 0.14,
  uiBack: 0.14,
  join: 0.6,
  leave: 0.45,
};

const PEAK: Partial<Record<Sfx, number>> = { step: 0.12, flutter: 0.3, seed: 0.42, uiMove: 0.25, land: 0.5, plate: 0.45 };

/** Synthesize one sound at `rate` Hz. */
export function renderSfx(name: Sfx, rate: number): Float32Array<ArrayBuffer> {
  seed = 12345 + name.length * 977;
  const b = new Float32Array(Math.ceil(LEN[name] * rate));
  switch (name) {
    case 'jump':
      tone(b, rate, { f0: 360, f1: 760, dur: 0.12, vol: 0.5, decay: 0.05 });
      tone(b, rate, { f0: 720, f1: 1500, dur: 0.08, vol: 0.12, decay: 0.03, type: 'tri' });
      break;
    case 'hop':
      tone(b, rate, { f0: 480, f1: 980, dur: 0.12, vol: 0.5, decay: 0.05 });
      chirp(b, rate, 2200, 3000, 0.08, 0.08, 0.2);
      break;
    case 'land':
      tone(b, rate, { f0: 150, f1: 60, dur: 0.1, vol: 0.6, decay: 0.035 });
      hiss(b, rate, { dur: 0.08, vol: 0.4, lp: 900, decay: 0.02 });
      break;
    case 'flutter':
      for (let k = 0; k < 4; k++) hiss(b, rate, { dur: 0.05, at: k * 0.05, vol: 0.5, lp: 1600, hp: 300, attack: 0.008, decay: 0.012 });
      break;
    case 'spring':
      tone(b, rate, { f0: 200, f1: 560, dur: 0.4, vol: 0.5, decay: 0.14, vib: [16, 0.09] });
      tone(b, rate, { f0: 400, f1: 1120, dur: 0.3, vol: 0.12, decay: 0.09, type: 'tri' });
      break;
    case 'bounce':
      tone(b, rate, { f0: 300, f1: 700, dur: 0.22, vol: 0.5, decay: 0.08, vib: [20, 0.07] });
      chirp(b, rate, 1800, 2500, 0.02, 0.06, 0.15);
      break;
    case 'bonk':
      tone(b, rate, { f0: 230, f1: 120, dur: 0.08, vol: 0.6, decay: 0.03 });
      hiss(b, rate, { dur: 0.02, vol: 0.4, lp: 3000, decay: 0.005 });
      break;
    case 'die':
      tone(b, rate, { f0: 640, f1: 150, dur: 0.5, vol: 0.45, decay: 0.2, type: 'tri', vib: [11, 0.05] });
      hiss(b, rate, { dur: 0.35, at: 0.05, vol: 0.25, lp: 2400, lp1: 400, decay: 0.12 });
      break;
    case 'respawn':
      for (let k = 0; k < 4; k++) tone(b, rate, { f0: midi(72 + k * 4), f1: midi(79 + k * 4), dur: 0.35, at: k * 0.05, vol: 0.18, decay: 0.12 });
      for (let k = 0; k < 6; k++) bell(b, rate, midi(88 + ((k * 5) % 12)), { at: 0.1 + k * 0.06, dur: 0.25, vol: 0.06 });
      break;
    case 'step':
      hiss(b, rate, { dur: 0.035, vol: 0.6, lp: 2200, hp: 400, decay: 0.008 });
      break;
    case 'grab':
      pluck(b, rate, 330, { dur: 0.16, vol: 0.4, damp: 0.98 });
      hiss(b, rate, { dur: 0.04, vol: 0.2, lp: 4000, hp: 1500, decay: 0.01 });
      break;
    case 'mantle':
      tone(b, rate, { f0: 300, f1: 520, dur: 0.1, vol: 0.45, decay: 0.04 });
      break;
    case 'tug':
      pluck(b, rate, 128, { dur: 0.65, vol: 0.75, damp: 0.995, bend: 0.82 });
      pluck(b, rate, 256, { dur: 0.3, vol: 0.2, damp: 0.99 });
      break;
    case 'zip':
      hiss(b, rate, { dur: 0.4, vol: 0.45, lp: 500, lp1: 4500, hp: 200, attack: 0.05, decay: 0.15 });
      pluck(b, rate, 196, { dur: 0.3, vol: 0.35, damp: 0.99 });
      break;
    case 'catch':
      pluck(b, rate, 92, { dur: 0.38, vol: 0.6, damp: 0.993 });
      break;
    case 'seed':
      tone(b, rate, { f0: 1320, dur: 0.2, vol: 0.4, decay: 0.05 });
      tone(b, rate, { f0: 1980, dur: 0.15, at: 0.035, vol: 0.3, decay: 0.04 });
      break;
    case 'feather':
      [84, 88, 91, 96, 100].forEach((m, k) => bell(b, rate, midi(m), { at: k * 0.06, dur: 0.6, vol: 0.22, ratio: 2, index: 1.4 }));
      break;
    case 'checkpoint':
      bell(b, rate, midi(79), { dur: 1.0, vol: 0.35, ratio: 3.5, index: 1.6 });
      bell(b, rate, midi(84), { at: 0.12, dur: 0.95, vol: 0.3, ratio: 3.5, index: 1.6 });
      break;
    case 'door':
      hiss(b, rate, { dur: 0.45, vol: 0.5, lp: 260, attack: 0.04, decay: 0.2 });
      tone(b, rate, { f0: 95, f1: 80, dur: 0.4, vol: 0.18, type: 'saw', vib: [7, 0.05], decay: 0.18 });
      break;
    case 'plate':
      hiss(b, rate, { dur: 0.015, vol: 0.5, lp: 5000, decay: 0.004 });
      tone(b, rate, { f0: 180, f1: 120, dur: 0.08, at: 0.008, vol: 0.5, decay: 0.03 });
      break;
    case 'crumble':
      for (let k = 0; k < 9; k++) hiss(b, rate, { dur: 0.06, at: k * 0.04 + noise() * 0.01 + 0.01, vol: 0.4, lp: 900 + k * 60, decay: 0.02 });
      tone(b, rate, { f0: 90, f1: 50, dur: 0.3, vol: 0.3, decay: 0.1 });
      break;
    case 'heart':
      chirp(b, rate, 2300, 3300, 0, 0.07, 0.4);
      chirp(b, rate, 2500, 3500, 0.12, 0.08, 0.4);
      break;
    case 'hey':
      chirp(b, rate, 1700, 2900, 0, 0.16, 0.45);
      break;
    case 'nuzzle':
      chirp(b, rate, 2300, 3300, 0, 0.07, 0.3);
      chirp(b, rate, 2100, 3100, 0.1, 0.07, 0.3);
      [76, 81, 84, 88].forEach((m, k) => bell(b, rate, midi(m), { at: 0.18 + k * 0.08, dur: 0.6, vol: 0.18, ratio: 2, index: 1.2 }));
      break;
    case 'clear':
      [72, 76, 79, 84].forEach((m, k) => bell(b, rate, midi(m), { at: k * 0.11, dur: 0.9, vol: 0.26, ratio: 2, index: 1.6 }));
      [72, 76, 79, 84, 88].forEach((m) => bell(b, rate, midi(m), { at: 0.5, dur: 1.25, vol: 0.14, ratio: 3, index: 1.2 }));
      tone(b, rate, { f0: midi(48), dur: 1.2, at: 0.5, vol: 0.25, decay: 0.5, type: 'tri' });
      break;
    case 'uiMove':
      tone(b, rate, { f0: 1100, dur: 0.035, vol: 0.4, decay: 0.012 });
      break;
    case 'uiSelect':
      tone(b, rate, { f0: 660, dur: 0.06, vol: 0.4, decay: 0.03 });
      tone(b, rate, { f0: 990, dur: 0.08, at: 0.05, vol: 0.4, decay: 0.03 });
      break;
    case 'uiBack':
      tone(b, rate, { f0: 880, dur: 0.06, vol: 0.4, decay: 0.03 });
      tone(b, rate, { f0: 590, dur: 0.08, at: 0.05, vol: 0.4, decay: 0.03 });
      break;
    case 'join':
      [79, 84, 88].forEach((m, k) => bell(b, rate, midi(m), { at: k * 0.09, dur: 0.45, vol: 0.28, ratio: 2, index: 1.2 }));
      break;
    case 'leave':
      [84, 79, 72].forEach((m, k) => bell(b, rate, midi(m), { at: k * 0.1, dur: 0.3, vol: 0.25, ratio: 2, index: 1.2 }));
      break;
  }
  return normalize(b, PEAK[name] ?? 0.7);
}

renderSfx.names = Object.keys(LEN) as Sfx[];
