// Logic that's hard to reach through play, driven directly: the game's own modules, imported into a
// page from the dev server. Playback of the partner's bird across clock steps (a phone that slept with
// its clock stopped) and hostile timestamps; the shared save against junk and dead heats; the relay's
// MQTT client against a socket that dies without closing; the quality governor on displays that aren't
// 60 Hz; and the online flow against a scripted partner (host commands across rooms and dropouts, a
// partner leaving the lobby, the guest's end-of-level card).
import { frames, launch, open, reporter, sleep, waitFor } from './harness.mjs';

const browser = await launch();
const t = reporter();
const page = await open(browser, { query: { extra: 'noaudio&norender' } });

// ---- the partner's bird across clock steps
const feed = await page.evaluate(async () => {
  const { RemoteFeed } = await import('/src/game/remote.ts');
  const world = { L: { movers: [] }, moverX: [], moverY: [], boxFree: () => true };
  // a sender 40 times a second, walking right at 200 px/s; frames at 60 Hz on our side.
  // `skew(T)`: our clock minus theirs at real time T (changes when a clock stops during a sleep)
  const run = ({ sleepAt, sleepFor, whoSleeps }) => {
    const f = new RemoteFeed();
    const bird = { x: 0, y: 0 };
    let sent = 0;
    let seq = 0;
    const log = [];
    for (let T = 0; T < 14000; T += 1000 / 60) {
      const asleep = T >= sleepAt && T < sleepAt + sleepFor;
      const after = T >= sleepAt + sleepFor;
      // the sleeper's clock stood still while asleep
      const theirs = whoSleeps === 'them' && after ? T - sleepFor : T;
      const ours = whoSleeps === 'us' && after ? T - sleepFor : T;
      while (sent <= T) {
        if (!(sent >= sleepAt && sent < sleepAt + sleepFor)) {
          const st = whoSleeps === 'them' && sent >= sleepAt + sleepFor ? sent - sleepFor : sent;
          f.push({ seq: ++seq, t: st, x: 100 + 0.2 * st, y: 0, vx: 200, vy: 0, flags: 1, mover: -1, rx: 0, ry: 0, n: 1 }, ours + 40);
        }
        sent += 25;
      }
      if (asleep) continue;
      f.sample(bird, world, 1 / 60, ours + 40);
      // how far behind the newest snapshot playback runs (ms of their time)
      if (after && T > sleepAt + sleepFor + 1000) log.push(theirs - (bird.x - 100) / 0.2);
    }
    return { worst: Math.round(Math.max(...log)), best: Math.round(Math.min(...log)) };
  };
  const hostile = () => {
    const f = new RemoteFeed();
    const bird = { x: 0, y: 0 };
    let seq = 0;
    const lag = [];
    for (let T = 0; T < 6000; T += 1000 / 60) {
      if (Math.round(T) % 25 < 17) {
        // one snapshot from the far future at 2 s, then honest ones
        const st = Math.abs(T - 2000) < 9 ? 1e15 : T;
        f.push({ seq: ++seq, t: st, x: 100 + 0.2 * T, y: 0, vx: 200, vy: 0, flags: 1, mover: -1, rx: 0, ry: 0, n: 1 }, T + 40);
      }
      f.sample(bird, world, 1 / 60, T + 40);
      if (T > 3500) lag.push(T - (bird.x - 100) / 0.2);
    }
    // a sender stuck on one timestamp mustn't grow the buffer without end
    const g = new RemoteFeed();
    for (let i = 1; i <= 5000; i++) g.push({ seq: i, t: 1000, x: 0, y: 0, vx: 0, vy: 0, flags: 1, mover: -1, rx: 0, ry: 0, n: 1 }, 1000 + i);
    return { worstLag: Math.round(Math.max(...lag)), finite: Number.isFinite(bird.x), stuckBuffer: g.buf.length };
  };
  return {
    usSlept: run({ sleepAt: 4000, sleepFor: 8000 - 2000, whoSleeps: 'us' }),
    themSlept: run({ sleepAt: 4000, sleepFor: 6000, whoSleeps: 'them' }),
    hostile: hostile(),
  };
});
t.check(`our clock stopped for 6 s (we slept): playback re-locks (${feed.usSlept.worst} ms behind)`, feed.usSlept.worst < 400 && feed.usSlept.best > 0, feed.usSlept);
t.check(`their clock stopped for 6 s: playback re-locks (${feed.themSlept.worst} ms behind)`, feed.themSlept.worst < 400 && feed.themSlept.best > -150, feed.themSlept);
t.check('a snapshot from the far future can’t derail playback, a stuck clock can’t grow the buffer', feed.hostile.finite && feed.hostile.worstLag < 400 && feed.hostile.stuckBuffer <= 256, feed.hostile);

// ---- the shared save against junk and dead heats
const saves = await page.evaluate(async () => {
  const S = await import('/src/core/save.ts');
  const reset = (o) => {
    for (const k of Object.keys(S.save.levels)) delete S.save.levels[k];
    Object.assign(S.save, structuredClone(o));
  };
  // a real record, then a copy whose level list is 64 made-up ids (which sort before real ones)
  reset({ unlocked: 1, levels: { garden: { seeds: 10, feathers: 5, time: 100, clears: 1 } }, finished: false, run: null, runAt: 0 });
  S.persist();
  const junk = { unlocked: 1, levels: Object.fromEntries(Array.from({ length: 64 }, (_, i) => [String(i), { seeds: 1, feathers: 0, time: 0, clears: 0 }])), finished: false, run: null, runAt: 0 };
  S.mergeSave(junk);
  const stored = S.cleanSave(JSON.parse(localStorage.getItem('mossbound.save.v2')));
  const survived = stored?.levels.garden?.feathers === 5 && !Object.keys(stored.levels).some((k) => /^\d+$/.test(k));
  // both devices touched their run in the same millisecond: they must still end up agreeing
  const A = { unlocked: 1, levels: {}, finished: false, run: { level: 0, cp: 1, seeds: [1], feathers: 0, time: 10, with: 'A' }, runAt: 5000 };
  const B = { ...A, run: { ...A.run, time: 12, with: 'B' } };
  reset(A);
  S.mergeSave(B);
  const one = JSON.stringify(S.save.run);
  reset(B);
  S.mergeSave(A);
  const two = JSON.stringify(S.save.run);
  return { survived, kept: Object.keys(stored?.levels ?? {}), agree: one === two, one, two };
});
t.check('a save full of made-up levels can’t crowd out the real records', saves.survived, saves.kept);
t.check('a dead heat between two runs is settled the same way on both devices', saves.agree, saves);

// ---- the relay's MQTT client: a socket that dies without closing is noticed and replaced
const mqtt = await page.evaluate(async () => {
  const { MqttClient } = await import('/src/net/mqtt.ts');
  const Real = window.WebSocket;
  const made = [];
  class FakeWS {
    static OPEN = 1;
    readyState = 0;
    bufferedAmount = 0;
    binaryType = 'blob';
    silent = false;
    dead = false;
    constructor() {
      made.push(this);
      setTimeout(() => {
        if (this.dead) return;
        this.readyState = 1;
        this.onopen?.();
      }, 5);
    }
    reply(bytes) {
      setTimeout(() => !this.silent && this.readyState === 1 && this.onmessage?.({ data: new Uint8Array(bytes).buffer }), 5);
    }
    send(d) {
      const b = new Uint8Array(d);
      if (b[0] === 0x10) this.reply([0x20, 2, 0, 0]);
      if (b[0] === 0xc0) this.reply([0xd0, 0]);
    }
    close() {
      this.readyState = 3;
      setTimeout(() => this.onclose?.(), 1);
    }
  }
  window.WebSocket = FakeWS;
  const until = async (f, ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (f()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  try {
    const c = new MqttClient('wss://broker.invalid/mqtt', { keepalive: 3, deadAfter: 1500, connectTimeout: 800 });
    c.connect();
    const up = await until(() => c.connected, 1000);
    // the network changes under us: the socket stays "open" but nothing comes back any more
    made[0].silent = true;
    const noticed = await until(() => !c.connected, 4000);
    const again = await until(() => c.connected && made.length >= 2, 6000);
    c.close();
    // a broker that never finishes the handshake
    made.length = 0;
    const d = new MqttClient('wss://broker.invalid/mqtt', { keepalive: 3, deadAfter: 1500, connectTimeout: 800 });
    FakeWS.prototype.send = function () {};
    d.connect();
    const retried = await until(() => made.length >= 2, 4000);
    d.close();
    return { up, noticed, again, retried };
  } finally {
    window.WebSocket = Real;
  }
});
t.check('a relay socket that goes silent without closing is dropped and replaced', mqtt.up && mqtt.noticed && mqtt.again, mqtt);
t.check('a broker that never answers the handshake is given up on and retried', mqtt.retried, mqtt);

// ---- online at 30 fps (a phone in low-power mode): moving platforms keep their riders
const ride = await page.evaluate(async () => {
  const { Session } = await import('/src/game/session.ts');
  const { app, flow } = window.__fb;
  let now = 100000;
  // the host's side of a link: its own clock is the shared one
  const link = { role: 'host', status: 'connected', connected: true, rtt: 30, via: 'direct', peerGen: 0, sharedNow: () => now, send() {}, sendSnap: () => true };
  const s = new Session(app, flow, { level: 2, mode: 'online', link, me: 0, nonce: 1, profiles: flow.profiles() });
  try {
    const b = s.birds[0];
    const lift = 0;
    b.place({ x: s.world.moverX[lift] + 48, y: s.world.moverY[lift] - 10.01 });
    const dt = 1 / 30;
    // (at the bottom of its run the lift is flush with the floor: standing on either is riding)
    let air = 0;
    let below = 0;
    let jumps = 0;
    let last = s.sharedT;
    for (let f = 0; f < 300; f++) {
      now += dt * 1000;
      s.frame(dt);
      for (let k = 0; k < 4; k++) s.update(dt / 4);
      if (Math.abs(s.sharedT - last - dt) > 0.1) jumps++;
      last = s.sharedT;
      if (f > 0 && !b.grounded) air++;
      if (b.y + 10 > s.world.moverY[lift] + 2) below++;
    }
    return { airborneFrames: air, framesBelowTop: below, clockJumps: jumps };
  } finally {
    s.dispose();
  }
});
t.check('online at 30 fps a bird rides the lift for 10 s (the platform clock never jumps)', ride.airborneFrames === 0 && ride.framesBelowTop === 0 && ride.clockJumps === 0, ride);

// ---- the quality governor, against the display it's on. Frames are whole display intervals (as a
// browser presents them) averaging the work they take; resolution `level` scales the GPU's share.
const gov = await page.evaluate(async () => {
  const { Governor } = await import('/src/app.ts');
  const run = (secs, vsync, work) => {
    const g = new Governor();
    let t = 0;
    let acc = 0;
    let low = 0;
    let level = 1;
    while (t < secs) {
      const v = typeof vsync === 'function' ? vsync(t) : vsync;
      acc += Math.max(v, work(level, t));
      const n = Math.max(1, Math.round(acc / v));
      acc -= n * v;
      const ms = n * v;
      const r = g.sample(ms, Math.min(0.1, ms / 1000));
      if (r !== null) level = r;
      t += ms / 1000;
      if (level < 0.999) low += ms / 1000;
    }
    return { level: +level.toFixed(2), lowFor: +low.toFixed(1) };
  };
  return {
    // a phone in low-power mode: the browser runs everything at 30 fps
    capped: run(40, 33.33, () => 10),
    // a 50 Hz TV: a heavy moment, then light again
    tv50: run(60, 20, (l, t) => (t > 5 && t < 9 ? 10 + 20 * l * l : 12)),
    // 60 Hz, drawing too slow at full resolution (about 45 fps)
    gpu: run(30, 16.67, (l) => 6 + 16 * l * l),
    // 60 Hz, the CPU is the limit (a smaller picture doesn't help)
    cpu: run(60, 16.67, () => 25),
    // 120 Hz with room to spare
    hz120: run(20, 8.33, () => 6),
  };
});
t.check('governor: a 30 fps cap isn’t mistaken for slow drawing', gov.capped.level === 1 && gov.capped.lowFor === 0, gov.capped);
t.check('governor: on a 50 Hz screen it comes back to full resolution', gov.tv50.level === 1, gov.tv50);
t.check('governor: 45 fps on a 60 Hz screen steps down until it keeps up', gov.gpu.level < 1, gov.gpu);
t.check('governor: when a smaller picture doesn’t help, it goes back (and mostly stays)', gov.cpu.level === 1 && gov.cpu.lowFor < 10, gov.cpu);
t.check('governor: 120 Hz with room to spare stays sharp', gov.hz120.level === 1 && gov.hz120.lowFor === 0, gov.hz120);

// ---- the online flow against a scripted partner link
await page.evaluate(() => {
  window.__fake = (role) => ({
    role, code: 'ABCD', status: 'connected', connected: true, peerGen: 0, rtt: 30, via: 'direct', sent: [],
    send(m) { this.sent.push(m); }, sendSnap: () => true, close() { this.closed = true; }, sharedNow: () => performance.now(),
    onStatus: null, onCtrl: null, onSnap: null,
    set(s) { this.status = s; this.connected = s === 'connected'; this.onStatus?.(s, ''); },
  });
});
const current = () => page.evaluate(() => window.__fb.app.current?.constructor.name);
// a guest who played in one room joins another: the new host counts its commands from 1 again
await page.evaluate(() => { const l = window.__fake('guest'); window.__fb.flow.adopt(l); l.onCtrl({ t: 'lobby', c: 40 }); });
await waitFor(async () => (await current()) === 'LevelSelect', 3000, 'guest lobby');
await page.evaluate(() => { const l = (window.__l2 = window.__fake('guest')); window.__fb.flow.adopt(l); l.onCtrl({ t: 'load', level: 0, n: 7, c: 1 }); });
const followed = await waitFor(async () => (await current()) === 'Session', 3000, 'session').catch(() => false);
t.check('a guest in a new room obeys its host from the first command', !!followed, await current());
// the guest's end-of-level card has only LEAVE ROOM: a jump still held from the landing (or Ⓐ by habit) mustn't press it
await page.evaluate(() => { const l = window.__fake('guest'); window.__fb.flow.adopt(l); l.onCtrl({ t: 'load', level: 0, n: 8, c: 1e6 }); });
await waitFor(async () => (await current()) === 'Session', 3000, 'guest session');
await page.evaluate(() => window.__fbSession.onCtrl({ t: 'clear', n: 8, time: 12 }));
await waitFor(() => page.evaluate(() => !!document.querySelector('.overlay.clear')), 3000, 'clear card');
await sleep(100);
await page.keyboard.press('Enter');
await page.keyboard.press('Space');
await frames(page, 6);
const stayed = await page.evaluate(() => window.__fb.app.current?.constructor.name === 'Session' && !!document.querySelector('.overlay.clear'));
t.check('ENTER / SPACE on the guest’s end-of-level card doesn’t leave the room', stayed);
// host: the guest drops out right as a level starts; when they're back, it reaches them
await page.evaluate(() => { const l = (window.__h = window.__fake('host')); window.__fb.flow.adopt(l); window.__fb.flow.playLevel(0); });
await waitFor(async () => (await current()) === 'Session', 3000, 'host session');
const drop = await page.evaluate(async () => {
  const l = window.__h;
  const n = l.sent.find((m) => m.t === 'load')?.n;
  l.sent.length = 0;
  l.set('reconnecting');
  await new Promise((r) => setTimeout(r, 2600));
  l.set('connected');
  const atOnce = l.sent.filter((m) => m.t === 'load' && m.n === n).length;
  await new Promise((r) => setTimeout(r, 2200));
  return { atOnce, later: l.sent.filter((m) => m.t === 'load' && m.n === n).length };
});
t.check('the host’s level start reaches a guest who was away, and keeps trying until they confirm', drop.atOnce >= 1 && drop.later > drop.atOnce, drop);
// the lobby: the host leaves — the guest is told, not left on "picking…"
await page.evaluate(() => { const l = (window.__g = window.__fake('guest')); window.__fb.flow.adopt(l); l.onCtrl({ t: 'lobby', c: 2e6 }); });
await waitFor(async () => (await current()) === 'LevelSelect', 3000, 'guest lobby again');
await frames(page, 2);
const lobby = await page.evaluate(() => {
  const text = () => document.querySelector('.levels-screen .panel')?.textContent ?? '';
  const before = text();
  window.__g.set('lost');
  return { before: /picking/.test(before), after: /left/.test(text()) };
});
t.check('the guest’s lobby says when the host has left', lobby.before && lobby.after, lobby);
// the host reaches THE END: the guest goes to the ending too (instead of waiting on "picking…")
await page.evaluate(() => { const l = window.__fake('guest'); window.__fb.flow.adopt(l); l.onCtrl({ t: 'end', c: 3e6 }); });
const ending = await waitFor(async () => (await current()) === 'EndingScreen', 3000, 'ending').catch(() => false);
t.check('the guest sees the ending when the host gets there', !!ending, await current());
await page.evaluate(() => window.__fb.flow.title());

const errs = [...page.errors];
await browser.close();
t.finish('units', errs);
