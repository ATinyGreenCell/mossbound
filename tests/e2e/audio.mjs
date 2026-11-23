// Sound must never cost the game a press or a frame, and must sound exactly as it was written.
//
// What this guards, and why each part is measured the way it is (2026-11-21 audit, 1.9.1):
//   - The first press used to build the whole sound engine inside its own handler: the AudioContext,
//     a 2.2 s reverb impulse and its convolver, the worker — 136 ms on a laptop, 345 ms on a
//     phone-speed CPU, and the click itself waited for it. The old version of this test called
//     audio.unlock() from page.evaluate, where none of that is visible, so it passed. Now it presses
//     for real (a mouse click, a controller button) and reads the browser's own timing of the press.
//   - The library is built while the title is up, so the first press is heard.
//   - Leaving a song used to cut it dead (a click at every level start and exit).
//   - Each bar's pad was eight live oscillators and an automated filter on the audio thread; it is the
//     same voice rendered ahead of time now, so it must still be the same voice.
//   - Music at volume 0 still ran the whole graph.
//   - Overlapping effects went over full scale, and a compressor that never stopped them delayed every
//     sound by 6 ms: a limiter with no lookahead does the job now, at the same loudness.
//   - The reverb was a 2.2 s stereo convolver, about 60% of the audio thread's work: it rings for 1 s.
//   - A song change faded the song being left with a 0.15 s time constant, ringing on for a second: it
//     fades to silence over 0.3 s now.
//   - The music and the forest played on in a hidden tab (a creek from a pocket, a fifth of a core).
//   - A closed AudioContext was never replaced.
//   - Without a worker the library was rendered in pieces of up to 260 ms on a phone-speed CPU, a
//     stalled worker's work was thrown away after 15 s, and a song asked for in the middle of that
//     played without its forest.
//   - The fonts were fetched only once the script had run, and an unused weight was shipped.
import { launch, open, reporter, sleep, waitFor, padPress, SLOW } from './harness.mjs';

const browser = await launch();
const t = reporter();
const errors = [];

/**
 * Installed before the game's first line runs (evaluateOnNewDocument), so nothing is missed: the
 * browser's timing of presses and long tasks, every audio source started (and on which context),
 * the node that feeds each context's speakers, and — per `mode` — a worker that is missing or stalls.
 */
const WATCH = (mode) => {
  window.__firstInput = null;
  window.__pressAt = null;
  // (registered before the game's own listeners, so this is the moment the first press reached the page)
  addEventListener('pointerdown', () => { window.__pressAt ??= performance.now(); }, { capture: true });
  window.__long = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__firstInput ??= { name: e.name, start: e.startTime, procMs: e.processingEnd - e.processingStart }; }).observe({ type: 'first-input', buffered: true });
  } catch { /* no event timing here */ }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  } catch { /* no long-task timing here */ }
  // frames held up 50 ms or more, and the scripts that held them (which callback ran them, from where, for how long)
  window.__loaf = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__loaf.push({ start: e.startTime, dur: e.duration, scripts: e.scripts.map((x) => ({ inv: x.invoker, start: x.startTime, dur: x.duration })) });
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch { /* no long-animation-frame timing here */ }
  window.__starts = [];
  for (const proto of [AudioScheduledSourceNode.prototype, AudioBufferSourceNode.prototype]) {
    const orig = proto.start;
    proto.start = function (when = 0, ...rest) {
      window.__starts.push({ kind: this.constructor.name, buffer: this.buffer ?? null, when, ctx: this.context, at: performance.now() });
      return orig.call(this, when, ...rest);
    };
  }
  window.__final = new Map();
  window.__comp = new Map();
  // (what feeds each node — the last thing connected to it — so a test can walk back up the master chain)
  window.__into = new WeakMap();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dst, ...rest) {
    if (dst instanceof AudioDestinationNode && this.context instanceof AudioContext && !window.__final.has(this.context)) window.__final.set(this.context, this);
    if (dst instanceof AudioNode) window.__into.set(dst, this);
    return connect.call(this, dst, ...rest);
  };
  // A recorder on any node's output, each block stamped with its first frame on the context's clock, so
  // two recorders' takes line up to the sample. Returns a function that stops it: [frame, samples | null][].
  const stamped = new WeakMap();
  window.__tap = async (ctx, node) => {
    if (!stamped.has(ctx)) {
      const code = `class S extends AudioWorkletProcessor {
        constructor() { super(); this.chunks = []; this.port.onmessage = () => { this.port.postMessage(this.chunks); this.chunks = []; }; }
        process(inputs) { const ch = inputs[0] && inputs[0][0]; this.chunks.push([currentFrame, ch ? ch.slice(0) : null]); return true; }
      }
      registerProcessor('stamped', S);`;
      stamped.set(ctx, ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))));
    }
    await stamped.get(ctx);
    const m = new AudioWorkletNode(ctx, 'stamped', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    const z = ctx.createGain();
    z.gain.value = 0;
    node.connect(m).connect(z).connect(ctx.destination);
    return async () => {
      const chunks = await new Promise((res) => { m.port.onmessage = (e) => res(e.data); m.port.postMessage(0); });
      node.disconnect(m);
      z.disconnect();
      return chunks;
    };
  };
  /** the samples of a take from frame f0 up to f1 (silence where nothing came in) */
  window.__span = (chunks, f0, f1) => {
    const out = new Float32Array(Math.max(0, f1 - f0));
    for (const [f, d] of chunks) if (d) for (let i = 0; i < d.length; i++) if (f + i >= f0 && f + i < f1) out[f + i - f0] = d[i];
    return out;
  };
  window.__rms = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); };
  // the page hidden or shown again, as another tab or a phone's lock button does it
  window.__setVis = (v) => {
    Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
    Object.defineProperty(document, 'hidden', { value: v === 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const comp = BaseAudioContext.prototype.createDynamicsCompressor;
  BaseAudioContext.prototype.createDynamicsCompressor = function () {
    const c = comp.call(this);
    if (this instanceof AudioContext && !window.__comp.has(this)) window.__comp.set(this, c);
    return c;
  };
  const W = window.Worker;
  window.__workerAt = null;
  if (mode === 'noworker') {
    window.Worker = class {
      constructor() { throw new Error('no workers on this device'); }
    };
  } else if (mode === 'stall') {
    // the worker sends its first dozen sounds and then is never heard from again
    window.Worker = class extends W {
      constructor(...a) {
        super(...a);
        window.__workerAt ??= performance.now();
        let real = null;
        let n = 0;
        Object.defineProperty(this, 'onmessage', { get: () => real, set: (f) => { real = f; } });
        super.addEventListener('message', (e) => { if (n++ < 12 && real) real.call(this, e); });
      }
    };
  }
  window.__waitFrames = (n) => new Promise((res) => { const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : res()); step(n); });
};

/** A game page with WATCH installed before it boots (and the CPU throttled from the start, if asked). */
async function gamePage(mode, { cpu = 1, pads = 0 } = {}) {
  const blank = (await browser.pages()).find((p) => p.url() === 'about:blank' && !p.__taken) ?? (await browser.newPage());
  await blank.evaluateOnNewDocument(WATCH, mode);
  const cdp = await blank.target().createCDPSession();
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const page = await open(browser, { query: { audio: true }, pads });
  page.cdp = cdp;
  return page;
}

/** Everything the sound engine needs to be complete: every effect, every instrument sample, the reverb. */
const libraryDone = (page) =>
  page.evaluate(async () => {
    const a = window.__fb.audio;
    const { renderSfx } = await import('/src/audio/sfx.ts');
    return a.buffers.size === renderSfx.names.length && (a.seq?.samples.size ?? 0) === 13 && a.ready !== false && !!a.seq;
  });

const lib = (page) => page.evaluate(() => ({ sfx: window.__fb.audio.buffers.size, inst: window.__fb.audio.seq?.samples.size ?? 0, ready: window.__fb.audio.ready ?? null }));

// ------------------------------------------------------------------ the first press, and what follows it
{
  const page = await gamePage('worker');
  // the fonts the game draws with are fetched with the page, not after the script has run; an unused weight isn't shipped
  const fonts = await page.evaluate(() => {
    const pre = [...document.querySelectorAll('link[rel="preload"][as="font"]')].map((l) => l.getAttribute('href') ?? '');
    const weights = [...new Set([...document.fonts].map((f) => String(f.weight)))].sort();
    return { preloads: pre.map((h) => h.split('/').pop()), weights, crossorigin: [...document.querySelectorAll('link[rel="preload"][as="font"]')].every((l) => l.hasAttribute('crossorigin')) };
  });
  const has = (w) => fonts.preloads.some((p) => p.includes(`latin-${w}-normal`) && p.includes('.woff2'));
  t.check('the weights the game uses (400, 600, 700) are preloaded with the page', has(400) && has(600) && has(700) && fonts.crossorigin, fonts);
  t.check('no font weight is shipped that nothing uses (500)', !fonts.weights.includes('500'), fonts);

  // nobody has touched anything yet: the library should come together while the title is up
  const early = await waitFor(() => libraryDone(page), 10000, 'library before any press').catch(() => false);
  t.check('the whole library is built while the title is up, before any press', !!early, await lib(page));

  // the first press, for real: a click on SETTINGS (a button whose own work happens a frame later)
  await page.click('[data-act="settings"]');
  await waitFor(() => page.evaluate(() => !!window.__firstInput && window.__pressAt !== null), 5000, 'the first press').catch(() => undefined);
  await waitFor(() => page.evaluate(() => window.__starts.some((x) => x.buffer && x.buffer === window.__fb.audio.buffers.get('uiSelect'))), 2000, 'its sound').catch(() => undefined);
  const first = await page.evaluate(() => {
    const a = window.__fb.audio;
    const sel = a.buffers.get('uiSelect');
    const pressAt = window.__pressAt ?? Infinity;
    const s = window.__starts.find((x) => x.buffer && x.buffer === sel && x.at >= pressAt);
    return { firstInput: window.__firstInput && { name: window.__firstInput.name, procMs: +window.__firstInput.procMs.toFixed(1) }, uiSelectAfterMs: s ? Math.round(s.at - pressAt) : null, state: a.state };
  });
  // (the old unlock took 55-118 ms here; resuming a context takes well under 1)
  t.check('the first press does no audio work (its handlers run in under 10 ms)', !!first.firstInput && first.firstInput.procMs < 10, first);
  t.check('the first press is heard (its select sound starts)', first.uiSelectAfterMs !== null && first.uiSelectAfterMs < 400 * SLOW && first.state === 'running', first);

  // the title song is playing: switch songs, as starting a level does, and listen to the bus
  await waitFor(() => page.evaluate(() => window.__fb.audio.seq?.songId === 'title'), 8000, 'title song').catch(() => undefined);
  await sleep(4000);
  const sw = await page.evaluate(async () => {
    const a = window.__fb.audio;
    const ctx = a.ctx;
    const seq = a.seq;
    const code = `class R extends AudioWorkletProcessor {
      constructor() { super(); this.chunks = []; this.port.onmessage = () => { this.port.postMessage(this.chunks); this.chunks = []; }; }
      process(inputs) { const ch = inputs[0] && inputs[0][0]; this.chunks.push(ch ? ch.slice(0) : new Float32Array(128)); return true; }
    }
    registerProcessor('rec', R);`;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    const rec = new AudioWorkletNode(ctx, 'rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    const sink = ctx.createGain();
    sink.gain.value = 0;
    seq.bus.connect(rec).connect(sink).connect(ctx.destination);
    const t0 = ctx.currentTime;
    await new Promise((r) => setTimeout(r, 1000));
    const tSwitch = ctx.currentTime;
    a.music('garden');
    await new Promise((r) => setTimeout(r, 1200));
    const chunks = await new Promise((res) => { rec.port.onmessage = (e) => res(e.data); rec.port.postMessage(0); });
    rec.disconnect();
    const all = new Float32Array(chunks.length * 128);
    chunks.forEach((c, i) => all.set(c, i * 128));
    const rate = ctx.sampleRate;
    const at = Math.round((tSwitch - t0) * rate);
    const win = Math.round(0.01 * rate);
    const rms = (i) => { let s = 0; for (let k = 0; k < win; k++) s += all[i + k] ** 2; return Math.sqrt(s / win); };
    const before = rms(at - 2 * win);
    // how long the outgoing song takes to fall to a tenth of its level
    let fall = null;
    for (let i = at; i + win < all.length; i += win) if (rms(i) < before * 0.1) { fall = Math.round(((i - at) / rate) * 1000); break; }
    const steps = [];
    for (let i = 1; i < at - win; i++) steps.push(Math.abs(all[i] - all[i - 1]));
    steps.sort((x, y) => x - y);
    const p999 = steps[Math.floor(steps.length * 0.999)];
    let near = 0;
    for (let i = Math.max(1, at - win * 2); i < Math.min(all.length, at + win * 2); i++) near = Math.max(near, Math.abs(all[i] - all[i - 1]));
    return { rmsBefore: +before.toFixed(4), fallToTenthMs: fall, stepAtSwitch: +near.toFixed(4), p999StepBefore: +p999.toFixed(4) };
  });
  t.check('leaving a song fades it instead of cutting it (no click)', sw.stepAtSwitch <= 2.5 * sw.p999StepBefore && (sw.fallToTenthMs === null || sw.fallToTenthMs >= 100), sw);

  // the pads: once a song's chords are rendered, a bar is one buffer, not eight live oscillators — and the same sound
  await sleep(1500);
  const oscs = await page.evaluate(async () => {
    const a = window.__fb.audio;
    const from = performance.now();
    await new Promise((r) => setTimeout(r, 4200));
    return window.__starts.filter((s) => s.ctx === a.ctx && s.at >= from && s.kind === 'OscillatorNode').length;
  });
  t.check('a bar of pad is no longer eight live oscillators (only the drone is live)', oscs <= 2, { liveOscillatorsIn4s: oscs });
  const same = await page.evaluate(async () => {
    const m = await import('/src/audio/music.ts');
    if (typeof m.padVoice !== 'function' || typeof m.renderPad !== 'function') return { error: 'no padVoice/renderPad' };
    const rate = window.__fb.audio.ctx.sampleRate;
    const song = { root: 60, scale: [0, 2, 4, 5, 7, 9, 11] };
    const tr = { kind: 'pad', vol: 0.045, oct: -1, bright: 1000 };
    const len = 3.75;
    const off = 4801; // a frame offset, as a bar starts somewhere in the middle of the clock
    const frames = off + Math.ceil((len + 1.9) * rate);
    const live = new OfflineAudioContext(1, frames, rate);
    m.padVoice(live, live.destination, song, tr, 1, off / rate, len);
    const a = (await live.startRendering()).getChannelData(0);
    const buf = await m.renderPad(rate, song, tr, 1, len);
    const pre = new OfflineAudioContext(1, frames, rate);
    const src = pre.createBufferSource();
    src.buffer = buf;
    src.connect(pre.destination);
    src.start(off / rate);
    const b = (await pre.startRendering()).getChannelData(0);
    let diff = 0;
    let peak = 0;
    for (let i = 0; i < frames; i++) { diff = Math.max(diff, Math.abs(a[i] - b[i])); peak = Math.max(peak, Math.abs(a[i])); }
    return { maxDiff: diff, peak: +peak.toFixed(4) };
  });
  t.check('a pre-rendered pad bar is the same sound as the live one', !same.error && same.peak > 0.01 && same.maxDiff < 1e-5, same);

  // music at volume 0: the scheduler stops and the graph goes quiet; turned back up, the song comes back
  const quiet = await page.evaluate(async () => {
    const a = window.__fb.audio;
    a.setVolumes({ music: 0, sfx: 0.9 });
    await new Promise((r) => setTimeout(r, 1500));
    const from = performance.now();
    await new Promise((r) => setTimeout(r, 1500));
    const started = window.__starts.filter((s) => s.ctx === a.ctx && s.at >= from).length;
    const timer = a.seq?.timer ?? null;
    a.setVolumes({ music: 0.7, sfx: 0.9 });
    const back = performance.now();
    await new Promise((r) => setTimeout(r, 1500));
    return { sourcesWhileMuted: started, schedulerTimer: timer, song: a.seq?.songId ?? null, sourcesAfter: window.__starts.filter((s) => s.ctx === a.ctx && s.at >= back).length };
  });
  t.check('music at volume 0 stops the scheduler and the graph goes quiet', quiet.sourcesWhileMuted === 0 && !quiet.schedulerTimer, quiet);
  t.check('turning the music back up brings the song back', quiet.song === 'garden' && quiet.sourcesAfter > 0, quiet);

  // a pile-up of effects never goes over full scale, and one sound alone comes out exactly as it went in
  const clip = await page.evaluate(async () => {
    const a = window.__fb.audio;
    const ctx = a.ctx;
    const code = `class P extends AudioWorkletProcessor {
      constructor() { super(); this.peak = 0; this.port.onmessage = () => { this.port.postMessage(this.peak); this.peak = 0; }; }
      process(inputs) { for (const ch of inputs[0] ?? []) for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > this.peak) this.peak = v; } return true; }
    }
    registerProcessor('peak', P);`;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    const meter = (node) => {
      const m = new AudioWorkletNode(ctx, 'peak', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
      const z = ctx.createGain();
      z.gain.value = 0;
      node.connect(m).connect(z).connect(ctx.destination);
      return () => new Promise((res) => { m.port.onmessage = (e) => res(e.data); m.port.postMessage(0); });
    };
    const final = window.__final.get(ctx);
    const out = meter(final);
    // (what reaches the ceiling: whatever feeds the gain in front of it)
    const into = meter(window.__into.get(window.__into.get(final)));
    a.music(null);
    await new Promise((r) => setTimeout(r, 2500));
    await out();
    await into();
    a.play('uiSelect', 1);
    await new Promise((r) => setTimeout(r, 400));
    const one = { out: await out(), into: await into() };
    for (const [n, v, p, r] of [['jump', 0.55], ['jump', 0.55, 0, 1.08], ['land', 0.9], ['land', 0.9], ['tug', 0.9], ['catch', 0.8], ['grab', 0.75, 0, 1.05], ['zip', 0.8], ['snap', 0.65], ['die', 0.7]]) a.play(n, v, p ?? 0, r ?? 1);
    await new Promise((r) => setTimeout(r, 1200));
    const pile = { out: await out(), into: await into() };
    a.music('garden');
    return { onePeakOut: +one.out.toFixed(4), onePeakIn: +one.into.toFixed(4), pilePeakOut: +pile.out.toFixed(4), pilePeakIn: +pile.into.toFixed(4) };
  });
  t.check('a pile-up of effects never goes over full scale', clip.pilePeakOut > 0 && clip.pilePeakOut <= 1, clip);
  t.check('one sound alone comes out exactly as it went in', Math.abs(clip.onePeakOut - clip.onePeakIn) < 1e-3 && clip.onePeakOut > 0.1, clip);

  // the reverb: a second long, still in stereo. (2.2 s of stereo convolution was about 60% of the
  // audio thread's work — crackles on a phone's slow core — and 23-109 ms of main-thread work to set up.)
  const verb = await page.evaluate(() => {
    const a = window.__fb.audio;
    const b = a.seq?.verb?.buffer ?? null;
    const setUp = (a.work ?? []).filter((w) => w.what === 'reverb').map((w) => +w.ms.toFixed(1));
    return b ? { seconds: +b.duration.toFixed(4), channels: b.numberOfChannels, rate: b.sampleRate, setUpMs: setUp } : { none: true };
  });
  t.check('the reverb rings for a second, in stereo (it was 2.2 s)', !verb.none && verb.seconds >= 0.99 && verb.seconds <= 1 + 1 / verb.rate && verb.channels === 2, verb);

  // the master chain: a limiter with no lookahead in place of the compressor — no compressor made at all,
  // an effect reaches the speakers in the very sample it is played (the compressor held every sound 6 ms),
  // and the mix as loud as the compressor's makeup gain left it
  const chain = await page.evaluate(async () => {
    const a = window.__fb.audio;
    const ctx = a.ctx;
    const rate = ctx.sampleRate;
    const final = window.__final.get(ctx);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    a.music(null);
    await wait(2500);
    // a single sample into the effects bus, recorded where the chain starts and where it ends
    let inT = await window.__tap(ctx, a.sfxBus);
    let outT = await window.__tap(ctx, final);
    const one = ctx.createBuffer(1, 1, rate);
    one.getChannelData(0)[0] = 0.5;
    const click = ctx.createBufferSource();
    click.buffer = one;
    click.connect(a.sfxBus);
    const at = Math.round((ctx.currentTime + 0.1) * rate);
    click.start(at / rate);
    await wait(500);
    const peakAt = (chunks) => {
      const x = window.__span(chunks, at - 1024, at + 4096);
      let best = 0;
      let k = -1;
      for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > best) { best = Math.abs(x[i]); k = i; }
      return k < 0 ? null : k - 1024;
    };
    const inAt = peakAt(await inT());
    const outAt = peakAt(await outT());
    // a quiet steady tone through the chain, against today's chain (0.9, then a compressor at -10 dB,
    // ratio 4, whose makeup gain lifted it) rendered offline from the same tone
    inT = await window.__tap(ctx, a.sfxBus);
    outT = await window.__tap(ctx, final);
    const tone = ctx.createOscillator();
    tone.frequency.value = 440;
    const tg = ctx.createGain();
    tg.gain.value = 0.1;
    tone.connect(tg).connect(a.sfxBus);
    const t0 = Math.round((ctx.currentTime + 0.1) * rate);
    tone.start(t0 / rate);
    tone.stop(t0 / rate + 0.6);
    await wait(900);
    const steady = [t0 + Math.round(0.2 * rate), t0 + Math.round(0.5 * rate)];
    const gainDb = 20 * Math.log10(window.__rms(window.__span(await outT(), ...steady)) / window.__rms(window.__span(await inT(), ...steady)));
    const oc = new OfflineAudioContext(1, rate, rate);
    const o = oc.createOscillator();
    o.frequency.value = 440;
    const og = oc.createGain();
    og.gain.value = 0.09;
    const m = oc.createGain();
    m.gain.value = 0.9;
    const comp = oc.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    o.connect(og).connect(m).connect(comp).connect(oc.destination);
    o.start();
    const ref = (await oc.startRendering()).getChannelData(0).slice(Math.round(0.5 * rate));
    const wasDb = 20 * Math.log10(window.__rms(ref) / (0.09 / Math.SQRT2));
    return { compressor: window.__comp.has(ctx), delayFrames: inAt === null || outAt === null ? null : outAt - inAt, gainDb: +gainDb.toFixed(3), wasDb: +wasDb.toFixed(3) };
  });
  t.check('no compressor on the master: an effect is heard in the very sample it is played (the compressor delayed every one 6 ms)', !chain.compressor && chain.delayFrames === 0, chain);
  t.check('…and the mix is as loud as before (within 0.1 dB of the compressor’s makeup gain)', Math.abs(chain.gainDb - chain.wasDb) <= 0.1, chain);

  // a song change: the song being left fades from where it is to silence over 0.3 s, while the next comes up
  const fade = await page.evaluate(async () => {
    const a = window.__fb.audio;
    const ctx = a.ctx;
    const rate = ctx.sampleRate;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    a.music('garden');
    await wait(2500);
    // (the song's own output: everything it plays goes out through it, and only what it plays)
    const stop = await window.__tap(ctx, a.seq.songBus);
    await wait(700);
    const f0 = Math.round(ctx.currentTime * rate);
    a.music('woods');
    await wait(1000);
    const chunks = await stop();
    const before = window.__rms(window.__span(chunks, f0 - Math.round(0.5 * rate), f0));
    const early = window.__rms(window.__span(chunks, f0, f0 + Math.round(0.1 * rate)));
    let last = -1;
    for (const [f, d] of chunks) if (d) for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 1e-6) last = Math.max(last, f + i);
    return { rmsBefore: +before.toFixed(4), first100msOfBefore: +(early / before).toFixed(2), silentAfterMs: Math.round(((last - f0) / rate) * 1000) };
  });
  t.check('a song change crossfades: the song left fades from where it was to silence over 0.3 s (it rang on for a second)', fade.rmsBefore > 0.001 && fade.first100msOfBefore > 0.4 && fade.silentAfterMs >= 270 && fade.silentAfterMs <= 330, fade);

  // the page hidden: the sound stops (the context suspended, nothing new played); shown again, it carries on
  const vis = await page.evaluate(async () => {
    const a = window.__fb.audio;
    const c = a.ctx;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const before = c.state;
    window.__setVis('hidden');
    await wait(400);
    const hidden = c.state;
    const from = performance.now();
    await wait(1500);
    const playedHidden = window.__starts.filter((s) => s.ctx === c && s.at >= from).length;
    window.__setVis('visible');
    await wait(400);
    const shown = c.state;
    const back = performance.now();
    await wait(1500);
    return { before, hidden, playedHidden, shown, playedShown: window.__starts.filter((s) => s.ctx === c && s.at >= back).length, song: a.seq?.songId ?? null };
  });
  t.check('the sound stops while the page is hidden (the context suspended, nothing played) and carries on when it shows', vis.before === 'running' && vis.hidden === 'suspended' && vis.playedHidden === 0 && vis.shown === 'running' && vis.playedShown > 0 && vis.song === 'woods', vis);
  // …and where the browser won't let it resume without a press (iOS may not), the next press does
  const refused = await page.evaluate(async () => {
    const c = window.__fb.audio.ctx;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__setVis('hidden');
    await wait(300);
    c.resume = () => Promise.reject(new DOMException('only inside a press', 'NotAllowedError'));
    window.__setVis('visible');
    await wait(300);
    delete c.resume;
    delete document.visibilityState;
    delete document.hidden;
    return c.state;
  });
  await page.mouse.click(40, 40);
  const pressed = await waitFor(() => page.evaluate(() => window.__fb.audio.state === 'running'), 3000, 'a press resumes it').catch(() => false);
  t.check('…and where the browser won’t resume it without a press (iOS), the next press does', refused === 'suspended' && !!pressed, { stateBeforeThePress: refused, runningAfter: !!pressed });

  // the sounds still play (a buffer source per voice, and the voice cap still holds)
  const played = await page.evaluate(() => {
    const a = window.__fb.audio;
    a.play('jump');
    a.play('step');
    a.play('step');
    a.play('step');
    return { ctx: a.ctx?.state ?? null, step: a.voices.get('step') ?? 0 };
  });
  t.check('a sound plays, and the voice cap holds', played.ctx === 'running' && played.step > 0 && played.step <= 2, played);

  // a context the browser closed is replaced at the next press
  await page.evaluate(() => window.__fb.audio.ctx.close());
  await sleep(300);
  await page.mouse.click(40, 40);
  const back = await waitFor(() => page.evaluate(() => window.__fb.audio.state === 'running'), 4000, 'a new context').catch(() => false);
  await sleep(300);
  const after = await page.evaluate(() => {
    const a = window.__fb.audio;
    const from = performance.now();
    a.play('jump');
    return { state: a.state, started: window.__starts.some((s) => s.ctx === a.ctx && s.at >= from) };
  });
  t.check('a closed context is replaced at the next press, and sound plays again', !!back && after.started, after);
  errors.push(...page.errors.filter((e) => !/not useful when context is closed/.test(e)));
  await page.close();
}

// ------------------------------------------------------------------ no worker at all, on a phone-speed CPU
{
  const page = await gamePage('noworker', { cpu: 4 });
  // (a press on nothing in particular: a button's own card would put its layout among what is measured)
  await page.mouse.click(40, 40);
  // ask for a level's song while the instruments are still being made
  await waitFor(() => page.evaluate(() => !!window.__fb.audio.seq && window.__fb.audio.seq.samples.size < 13), 20000, 'the build under way').catch(() => undefined);
  await page.evaluate(() => window.__fb.audio.music('garden'));
  const done = await waitFor(() => libraryDone(page), 90000, 'library without a worker').catch(() => false);
  await sleep(1500);
  const r = await page.evaluate(() => {
    const a = window.__fb.audio;
    const work = a.work ?? [];
    // The only pieces that can't be cut smaller are the browser's own: making the context, and building
    // the reverb's convolution (see Sequencer.setReverb). They are named and reported, not counted.
    const theirs = work.filter((w) => w.what === 'context' || w.what === 'reverb');
    const isTheirs = (x) => theirs.some((w) => x.start <= w.at + w.ms && x.start + x.dur >= w.at);
    // the library's own long tasks: a timer or idle callback (where it is made) that ran 50 ms or more in one go
    // (any other long frame is the game's own drawing, or layout; on a slow GPU a frame is long while it waits,
    // and slices using that wait hold nothing up — so it is each task that counts, not each frame)
    const held = window.__loaf
      .flatMap((f) => f.scripts)
      .filter((x) => /^(TimerHandler|IdleRequestCallback)/.test(x.inv) && !isTheirs(x) && x.dur >= 50)
      .map((x) => Math.round(x.dur));
    const slices = work.filter((w) => w.what === 'slice' || w.what === 'keep').map((w) => w.ms).sort((x, y) => x - y);
    const q = (p) => (slices.length ? +slices[Math.min(slices.length - 1, Math.floor(p * slices.length))].toFixed(1) : null);
    return {
      song: a.seq?.songId ?? null,
      beds: !!a.seq?.beds,
      longTasksMs: held,
      browserStepsMs: theirs.map((w) => `${w.what} ${Math.round(w.ms)}`),
      slices: slices.length,
      sliceP50Ms: q(0.5),
      sliceP95Ms: q(0.95),
      sliceP99Ms: q(0.99),
      longestSliceMs: q(1),
    };
  });
  t.check('without a worker, the library is still built', !!done, await lib(page));
  // (one at most in a hundred: a machine busy with something else can stall any task — the old code, which
  // rendered a whole sound at a time, made seven or more out of 47)
  t.check('…with no long task of its own at 4× CPU (1 in 100 at most)', !!done && r.longTasksMs.length <= Math.max(1, Math.floor(r.slices / 100)), r);
  // Each slice stops at the first pause after its few ms of idle time, so a slice is long only when that last
  // stretch is: CDP's throttling stops the thread ~3 ms at a time, code runs slowly until it is optimised, and
  // a busy machine (another browser, another suite) takes the CPU away mid-slice. On a quiet machine 99 in
  // 100 come in under 16 ms; the check asks 95 in 100, so it measures this code and not the room it runs in.
  t.check('…in slices under 16 ms at 4× CPU (95 in 100)', !!done && r.sliceP95Ms !== null && r.sliceP95Ms < 16, r);
  t.check('a song asked for in the middle of it starts with its forest', r.song === 'garden' && r.beds, r);
  await page.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  errors.push(...page.errors);
  await page.close();
}

// ------------------------------------------------------------------ a worker that stalls halfway
{
  const page = await gamePage('stall');
  await page.mouse.click(40, 40);
  const done = await waitFor(() => libraryDone(page), 40000, 'library after a stalled worker').catch(() => false);
  const r = await page.evaluate(() => {
    const a = window.__fb.audio;
    const here = (a.work ?? []).filter((w) => w.what === 'render').length;
    return { readyAfterWorkerMs: window.__workerAt === null ? null : Math.round(performance.now() - window.__workerAt), renderedHere: here };
  });
  t.check('a stalled worker is given up on well before 15 s, and what it sent is kept', !!done && r.readyAfterWorkerMs !== null && r.readyAfterWorkerMs < 15000 && r.renderedHere === 47 - 12, r);
  errors.push(...page.errors);
  await page.close();
}

// ------------------------------------------------------------------ a controller press alone (an Xbox in game-controls mode)
{
  const page = await gamePage('worker', { pads: 1 });
  await waitFor(() => libraryDone(page), 10000, 'library').catch(() => undefined);
  // nobody has pressed anything: the page hidden and shown again must not start the sound by itself
  const boot = await page.evaluate(async () => {
    const a = window.__fb.audio;
    window.__setVis('hidden');
    await new Promise((r) => setTimeout(r, 300));
    window.__setVis('visible');
    await new Promise((r) => setTimeout(r, 500));
    const out = { context: a.c?.state ?? 'none', unlocked: a.unlocked };
    delete document.visibilityState;
    delete document.hidden;
    return out;
  });
  t.check('showing the page doesn\u2019t start the sound by itself: the engine made at boot still waits for a press', boot.context === 'suspended' && boot.unlocked === false, boot);
  await page.evaluate(() => {
    const app = window.__fb.app;
    const orig = app.onPadPress;
    window.__padMs = [];
    app.onPadPress = () => {
      const t0 = performance.now();
      orig?.();
      window.__padMs.push(performance.now() - t0);
    };
  });
  await padPress(page, 0, 3);
  const r = await waitFor(() => page.evaluate(() => (window.__fb.audio.state === 'running' ? { ms: +Math.max(...window.__padMs).toFixed(1), state: window.__fb.audio.state } : null)), 4000, 'sound from a pad').catch(() => null);
  // (the old unlock took 26-64 ms in that frame, depending on the machine; now well under 1)
  t.check('a controller press starts the sound with no audio work in its frame (under 10 ms)', !!r && r.ms < 10, r ?? (await page.evaluate(() => ({ padMs: window.__padMs, state: window.__fb.audio.state }))));
  errors.push(...page.errors);
  await page.close();
}

await browser.close();
t.finish('audio', errors);
