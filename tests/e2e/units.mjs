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

// ---- a snapshot counter from nowhere: every honest one after it looks ancient by comparison, and the
// partner's sprout stops being drawn where it is
const counter = await page.evaluate(async () => {
  const { packSnap, unpackSnap } = await import('/src/net/protocol.ts');
  const { RemoteFeed } = await import('/src/game/remote.ts');
  const world = { L: { movers: [] }, moverX: [], moverY: [], boxFree: () => true };
  const snap = (seq, t) => ({ seq, t, x: 100 + 0.2 * t, y: 0, vx: 200, vy: 0, flags: 1, mover: -1, rx: 0, ry: 0, n: 1 });
  const f = new RemoteFeed();
  const bird = { x: 0, y: 0 };
  let seq = 0;
  let last = NaN;
  const steps = [];
  // a sender 40 times a second, walking right at a steady 200 px/s — with one counter from nowhere
  for (let T = 0; T < 4000; T += 1000 / 60) {
    if (Math.round(T) % 25 < 17) {
      const wire = packSnap(snap(Math.abs(T - 2000) < 9 ? 2 ** 40 : ++seq, T));
      const s = unpackSnap(wire);
      if (s) f.push(s, T + 40);
    }
    f.sample(bird, world, 1 / 60, T + 40);
    if (T > 1000) steps.push(bird.x - last);
    last = bird.x;
  }
  steps.shift();
  return { rejected: unpackSnap(packSnap(snap(2 ** 40, 1000))) === null, kept: !!unpackSnap(packSnap(snap(9, 1000))), back: +Math.min(...steps).toFixed(2), leap: +Math.max(...steps).toFixed(2) };
});
t.check(`a snapshot counter from nowhere can’t stall the partner’s sprout (steps ${counter.back}…${counter.leap} px)`, counter.rejected && counter.kept && counter.back > 0 && counter.leap < 12, counter);

// ---- stepping off a moving platform (and back on). A rider is drawn on the platform where it is now;
// off it, the partner is drawn where they were a playback delay ago — and the platform has travelled
// since. That difference must melt away, not land as a jump.
const stepOff = await page.evaluate(async () => {
  const { RemoteFeed } = await import('/src/game/remote.ts');
  const { F_GROUND } = await import('/src/net/protocol.ts');
  // one platform sliding right at `speed` px/s past a sprout who waits for it, rides it, then gets off
  // (the stream is continuous throughout: standing still, then the platform's own motion, then still)
  const run = (speed, hz) => {
    const world = { L: { movers: [{}] }, moverX: [0], moverY: [200], boxFree: () => true };
    const f = new RemoteFeed();
    const bird = { x: 0, y: 0 };
    const at = (t) => speed * (t / 1000);
    const X0 = 400;
    const rx = X0 - at(2000);
    let seq = 0;
    let sent = 0;
    let lastX = NaN;
    let lastY = 0;
    const steps = [];
    for (let T = 0; T < 6000; T += 1000 / 60) {
      world.moverX[0] = at(T);
      while (sent <= T) {
        // waiting on the ground, aboard from 2 s to 4 s, then off again where it dropped them
        const on = sent >= 2000 && sent < 4000;
        const x = sent < 2000 ? X0 : on ? at(sent) + rx : at(4000) + rx;
        f.push({ seq: ++seq, t: sent, x, y: 190, vx: on ? speed : 0, vy: 0, flags: F_GROUND, mover: on ? 0 : -1, rx, ry: -10, n: 1 }, sent);
        sent += 1000 / hz;
      }
      f.sample(bird, world, 1 / 60, T);
      if (T > 1000 && !Number.isNaN(lastX)) steps.push(Math.hypot(bird.x - lastX, bird.y - lastY));
      lastX = bird.x;
      lastY = bird.y;
    }
    // riding, the sprout moves a platform-step a frame; a teleport is a multiple of that
    return { worst: +Math.max(...steps).toFixed(1), ride: +(speed / 60).toFixed(1) };
  };
  return { slow30: run(120, 30), fast30: run(260, 30), fast15: run(260, 15), fast60: run(260, 60) };
});
const rates = Object.entries(stepOff);
t.check(`stepping off a moving platform doesn’t teleport the partner (worst step ${rates.map(([k, v]) => `${k}: ${v.worst}/${v.ride}`).join(', ')} px)`, rates.every(([, v]) => v.worst < v.ride + 2), stepOff);

// ---- the shared save against junk and dead heats
const saves = await page.evaluate(async () => {
  const S = window.__fb.save;
  const reset = (o) => {
    for (const k of Object.keys(S.save.levels)) delete S.save.levels[k];
    for (const k of Object.keys(S.save.runs)) delete S.save.runs[k];
    // through cleanSave, as a real device's copy always is: whatever a run holds, every copy of it on
    // every device is built the same way. Assigning a raw object here would compare two shapes.
    Object.assign(S.save, structuredClone(S.cleanSave(o) ?? o));
  };
  // a real record, then a copy whose level list is 64 made-up ids (which sort before real ones)
  reset({ unlocked: 1, levels: { garden: { seeds: 10, feathers: 5, time: 100, clears: 1 } }, finished: false, runs: {}, clock: 0 });
  S.persist();
  const junk = { unlocked: 1, levels: Object.fromEntries(Array.from({ length: 64 }, (_, i) => [String(i), { seeds: 1, feathers: 0, time: 0, clears: 0 }])), finished: false, runs: {} };
  S.mergeSave(junk);
  const stored = S.cleanSave(JSON.parse(localStorage.getItem('mossbound.save.v3')));
  const survived = stored?.levels.garden?.feathers === 5 && !Object.keys(stored.levels).some((k) => /^\d+$/.test(k));
  // both devices touched a level's run at the same moment of the shared count: they must still end up agreeing
  const run = (time, w) => ({ cp: 1, seeds: [1], feathers: 0, time, with: w, sig: '' });
  const A = { unlocked: 1, levels: {}, finished: false, runs: { garden: { gen: 1, at: 5000, run: run(10, 'A') } }, clock: 5000 };
  const B = { ...A, runs: { garden: { gen: 1, at: 5000, run: run(12, 'B') } } };
  reset(A);
  S.mergeSave(B);
  const one = JSON.stringify(S.save.runs.garden);
  reset(B);
  S.mergeSave(A);
  const two = JSON.stringify(S.save.runs.garden);
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

// ---- in-level messages from a partner on a damaged build (or from no partner of ours at all): a
// nonsense index must be ignored, never throw inside the handler (which drops the whole update) and
// never leave the level's own state holding a value that isn't one
const ctrl = await page.evaluate(async () => {
  const { Session } = await import('/src/game/session.ts');
  const { app, flow } = window.__fb;
  const link = { role: 'host', status: 'connected', connected: true, rtt: 30, via: 'direct', peerGen: 0, sharedNow: () => performance.now(), send() {}, sendSnap: () => true };
  const s = new Session(app, flow, { level: 0, mode: 'online', link, me: 0, nonce: 1, profiles: flow.profiles() });
  const fire = (m) => {
    try {
      s.onCtrl(m);
      return 'ok';
    } catch (e) {
      return `THREW: ${e.message.slice(0, 60)}`;
    }
  };
  try {
    const o = {};
    o.seedsNotArray = fire({ t: 'world', n: 1, seeds: 5, feathers: 0, cp: -1 });
    // a million indices would be walked on the main thread: there are only ever as many as the level holds
    const t0 = performance.now();
    o.seedsFlood = fire({ t: 'world', n: 1, seeds: new Array(1e6).fill(1e6), feathers: 0, cp: -1 });
    o.floodMs = Math.round(performance.now() - t0);
    o.worldCpFraction = fire({ t: 'world', n: 1, seeds: [], feathers: 0, cp: 1.5 });
    o.evSeedOutOfRange = fire({ t: 'ev', n: 1, e: { k: 'seed', i: 999999 } });
    o.evSeedFraction = fire({ t: 'ev', n: 1, e: { k: 'seed', i: 1.5 } });
    o.evFeatherOutOfRange = fire({ t: 'ev', n: 1, e: { k: 'feather', i: 999999 } });
    o.evCpString = fire({ t: 'ev', n: 1, e: { k: 'cp', i: 'x' } });
    o.evCpFraction = fire({ t: 'ev', n: 1, e: { k: 'cp', i: 1.5 } });
    // a vine shot over a ring that isn't there (1.2.0): the vine must be left alone, not bent to nowhere
    o.evHookOutOfRange = fire({ t: 'ev', n: 1, e: { k: 'hook', i: 999999 } });
    o.evHookFraction = fire({ t: 'ev', n: 1, e: { k: 'hook', i: 1.5 } });
    o.evHookString = fire({ t: 'ev', n: 1, e: { k: 'hook', i: 'x' } });
    o.evUnhookUnhooked = fire({ t: 'ev', n: 1, e: { k: 'unhook' } });
    o.vine = { wraps: s.tether.pts.length, limit: Math.round(s.tether.limit) };
    // a plant grown in a patch of soil that isn't there (1.3.0)
    o.evGrowOutOfRange = fire({ t: 'ev', n: 1, e: { k: 'grow', i: 999999 } });
    o.evGrowFraction = fire({ t: 'ev', n: 1, e: { k: 'grow', i: 1.5 } });
    o.evGrowString = fire({ t: 'ev', n: 1, e: { k: 'grow', i: 'x' } });
    o.worldGrownNotArray = fire({ t: 'world', n: 1, seeds: [], feathers: 0, cp: -1, grown: 7 });
    o.worldGrownFlood = fire({ t: 'world', n: 1, seeds: [], feathers: 0, cp: -1, grown: new Array(1e5).fill(1e6) });
    o.grown = [...s.world.grown].reduce((a, b) => a + b, 0);
    o.left = { cp: s.checkpoint, feathers: s.feathers, seeds: [...s.seedTaken].reduce((a, b) => a + b, 0) };
    // and the real thing still arrives
    o.realSeed = fire({ t: 'ev', n: 1, e: { k: 'seed', i: 0 } });
    o.realWorld = fire({ t: 'world', n: 1, seeds: [1], feathers: 1, cp: 0 });
    o.took = { seeds: [...s.seedTaken].reduce((a, b) => a + b, 0), cp: s.checkpoint, feathers: s.feathers };
    return o;
  } finally {
    s.dispose();
  }
});
const threw = Object.entries(ctrl).filter(([, v]) => typeof v === 'string' && v.startsWith('THREW'));
t.check('a nonsense seed / firefly / lantern index from the partner is ignored, not thrown on', threw.length === 0, threw.length ? threw : ctrl);
t.check('…and leaves the lantern, the fireflies and the seeds as they were', ctrl.left.cp === -1 && ctrl.left.feathers === 0 && ctrl.left.seeds === 0, ctrl.left);
t.check('a vine shot at a ring that isn’t there leaves the vine as it was', ctrl.vine.wraps === 0 && ctrl.vine.limit === 256, ctrl.vine);
t.check('a plant grown in a patch of soil that isn’t there grows nothing', ctrl.grown === 0, ctrl.grown);
t.check(`…while a flood of seed indices can’t eat a frame (${ctrl.floodMs} ms)`, ctrl.floodMs < 20, ctrl.floodMs);
t.check('the partner’s real pickups still arrive', ctrl.took.seeds === 2 && ctrl.took.cp === 0 && ctrl.took.feathers === 1, ctrl.took);

// ---- the same guard one layer in. Every caller checks its index now, but these two write level state
// from one, and both used to take anything: a shift by a huge index silently wraps (1 << 999999 is
// 1 << 31, banking a firefly the level doesn't have) and the lantern comparisons are false for a
// string, which would then be stored as the lantern we're standing at.
const inner = await page.evaluate(async () => {
  const { Session } = await import('/src/game/session.ts');
  const { app, flow } = window.__fb;
  const link = { role: 'host', status: 'connected', connected: true, rtt: 30, via: 'direct', peerGen: 0, sharedNow: () => performance.now(), send() {}, sendSnap: () => true };
  const s = new Session(app, flow, { level: 0, mode: 'online', link, me: 0, nonce: 1, profiles: flow.profiles() });
  const call = (name, i) => {
    try {
      s[name](i, false);
      return 'ok';
    } catch (e) {
      return `THREW: ${e.message.slice(0, 50)}`;
    }
  };
  try {
    const o = {};
    o.featherHuge = call('takeFeather', 999999);
    o.featherFraction = call('takeFeather', 1.5);
    o.featherNegative = call('takeFeather', -1);
    o.lanternString = call('light', 'x');
    o.lanternFraction = call('light', 1.5);
    o.left = { cp: s.checkpoint, feathers: s.feathers };
    o.realFeather = call('takeFeather', 0);
    o.realLantern = call('light', 0);
    o.took = { cp: s.checkpoint, feathers: s.feathers };
    return o;
  } finally {
    s.dispose();
  }
});
const innerThrew = Object.entries(inner).filter(([, v]) => typeof v === 'string' && v.startsWith('THREW'));
t.check('an index that isn’t one reaches neither the fireflies nor the lanterns', innerThrew.length === 0 && inner.left.cp === -1 && inner.left.feathers === 0, innerThrew.length ? innerThrew : inner);
t.check('…and a real firefly and lantern still count', inner.took.feathers === 1 && inner.took.cp === 0, inner.took);

// ---- the shared clock (the host's: it runs the moving platforms and the level timer on both screens).
// It's built from 'pong' replies, and a partner on a damaged build can put anything in one.
const clock = await page.evaluate(async () => {
  const { NetLink } = await import('/src/net/link.ts');
  // a guest's clock machinery on its own: the guest is the side that applies an offset
  const link = NetLink.bare('guest');
  try {
    // a pong whose sender's clock reads `ahead` ms more than ours, over a healthy 30 ms round trip
    const pong = (ahead) => link.recvPing({ t: 'pong', a: performance.now() - 30, b: performance.now() + ahead }, 'direct');
    const skew = () => Math.round(link.sharedNow() - performance.now());
    const o = {};
    for (let i = 0; i < 4; i++) pong(500);
    o.locked = skew();
    // one made-up reply time: a finite number, a healthy round trip, a clock reading from nowhere
    pong(1e15);
    o.afterWild = skew();
    // and one that's within reason but still a jump nobody's clock made
    pong(6e5);
    o.afterJump = skew();
    for (let i = 0; i < 2; i++) pong(500);
    o.back = skew();
    // their phone slept with its clock stopped: a step that's really there is on the next ping too
    pong(90500);
    o.stepOnce = skew();
    pong(90500);
    o.stepTwice = skew();
    return o;
  } finally {
    link.close();
  }
});
t.check(`a made-up ‘pong’ can’t move the shared clock (${clock.afterWild} ms, locked at ${clock.locked})`, Math.abs(clock.afterWild - clock.locked) < 50 && Math.abs(clock.afterJump - clock.locked) < 50 && Math.abs(clock.back - clock.locked) < 50, clock);
t.check(`a clock step that’s really there is taken on the next ping (${clock.stepTwice} ms)`, Math.abs(clock.stepOnce - clock.locked) < 50 && Math.abs(clock.stepTwice - 90500) < 200, clock);

// ---- the partner's sprout, mirrored from their snapshots, riding a moving platform: it must stay put
// on the platform rather than sink into it, float over it or slide along it as the platform travels
const riding = await page.evaluate(async () => {
  const { Session } = await import('/src/game/session.ts');
  const { F_GROUND } = await import('/src/net/protocol.ts');
  const { app, flow } = window.__fb;
  let now = performance.now();
  const link = { role: 'host', status: 'connected', connected: true, rtt: 30, via: 'direct', peerGen: 0, sharedNow: () => now, send() {}, sendSnap: () => true };
  const s = new Session(app, flow, { level: 2, mode: 'online', link, me: 0, nonce: 1, profiles: flow.profiles() });
  const frameNow = app.frameNow;
  try {
    const w = s.world;
    const B = s.birds[1];
    const dt = 1 / 60;
    let sendAt = now;
    let seq = 0;
    const worst = { x: 0, y: 0 };
    // the gondola (1) slides sideways, the mill lift (0) climbs: both carry a rider
    for (const m of [1, 0]) {
      const rx = 48;
      const ry = -10.01;
      s.feed.reset();
      for (let f = 0; f < 240; f++) {
        now += dt * 1000;
        app.frameNow = now;
        // their side sends 30 a second, stamped with the moment the state is for
        while (sendAt <= now) {
          s.feed.push({ seq: ++seq, t: sendAt, x: w.moverX[m] + rx, y: w.moverY[m] + ry, vx: 0, vy: 0, flags: F_GROUND, mover: m, rx, ry, n: 1 }, sendAt);
          sendAt += 1000 / 30;
        }
        s.frame(dt);
        for (let k = 0; k < 4; k++) s.update(dt / 4);
        // (the first frames are the jitter buffer filling up)
        if (f > 30) {
          worst.x = Math.max(worst.x, Math.abs(B.x - (w.moverX[m] + rx)));
          worst.y = Math.max(worst.y, Math.abs(B.y - (w.moverY[m] + ry)));
        }
      }
    }
    return { offX: +worst.x.toFixed(2), offY: +worst.y.toFixed(2), present: B.present, frozen: s.frozen, mover: B.groundMover };
  } finally {
    app.frameNow = frameNow;
    s.dispose();
  }
});
t.check(`the partner’s sprout rides a moving platform without sinking or sliding (off by ${riding.offX} / ${riding.offY} px)`, riding.present && !riding.frozen && riding.offX < 0.25 && riding.offY < 0.25, riding);

// ---- the vine is drawn from its own ends, which track the sprouts. The string solver moves the
// sprouts after that, so what's drawn must be caught up afterwards or the vine hangs off its sprout
// by the solver's last correction — most visible at a high frame rate, where corrections are frequent.
const vine = await page.evaluate(async () => {
  const { Session } = await import('/src/game/session.ts');
  const { app, flow } = window.__fb;
  let now = performance.now();
  const link = { role: 'host', status: 'connected', connected: true, rtt: 30, via: 'direct', peerGen: 0, sharedNow: () => now, send() {}, sendSnap: () => true };
  const s = new Session(app, flow, { level: 0, mode: 'online', link, me: 0, nonce: 1, profiles: flow.profiles() });
  try {
    const [A, B] = s.birds;
    B.present = true;
    const home = { x: A.x, y: A.y };
    const far = s.tether.ends[0].limit + 30;
    // every step starts the same way: the partner out past the vine's reach, the vine straight between
    // them, so each one measures that step's own correction
    const run = (dt, n) => {
      let worst = 0;
      let cost = 0;
      for (let f = 0; f < n; f++) {
        A.place(home);
        B.place({ x: home.x + far, y: home.y });
        s.tether.tie(A, B);
        now += dt * 1000;
        const t0 = performance.now();
        s.update(dt);
        cost += performance.now() - t0;
        worst = Math.max(worst, Math.abs(s.tether.ax - A.x));
      }
      return { lag: +worst.toFixed(2), msPerStep: +(cost / n).toFixed(3) };
    };
    run(1 / 60, 120); // past the moment at the start of a level where the vine isn't tied yet
    return { hz144: run(1 / 144, 400), hz60: run(1 / 60, 400) };
  } finally {
    s.dispose();
  }
});
t.check(`the vine is drawn where the string left the sprout (lag ${vine.hz144.lag} px at 144 Hz, ${vine.hz60.lag} px at 60 Hz)`, vine.hz144.lag < 0.01 && vine.hz60.lag < 0.01, vine);
t.check(`…and a step still costs well under a frame (${vine.hz144.msPerStep} ms at 144 Hz)`, vine.hz144.msPerStep < 1 && vine.hz60.msPerStep < 1, vine);

// ---- REGROUP while the level is clearing. Online the pause menu doesn't pause, so the level can
// clear with it open — and a ceremony is no place for both sprouts to die and stay ghosts.
await page.evaluate(async () => {
  const { Session } = await import('/src/game/session.ts');
  const { app, flow } = window.__fb;
  const link = { role: 'host', status: 'connected', connected: true, rtt: 30, via: 'direct', peerGen: 0, sharedNow: () => performance.now(), send() {}, sendSnap: () => true };
  const s = (window.__regroup = new Session(app, flow, { level: 0, mode: 'online', link, me: 0, nonce: 1, profiles: flow.profiles() }));
  s.togglePause();
});
await sleep(400); // the menu's buttons ignore a click for the first moment (a held jump mustn't press one)
const regrouped = await page.evaluate(() => {
  const s = window.__regroup;
  try {
    const o = { menu: !!document.querySelector('.overlay .btn[data-act="regroup"]'), sent: [] };
    s.link.send = (m) => o.sent.push(m);
    // the goal was reached while the menu was open
    s.onCtrl({ t: 'clear', n: 1, time: 5 });
    o.state = s.state;
    document.querySelector('.overlay .btn[data-act="regroup"]')?.click();
    o.afterButton = s.birds.map((b) => b.ghost);
    o.toldPartner = o.sent.some((m) => m.t === 'ev' && m.e?.k === 'regroup');
    o.menuClosed = !document.querySelector('.overlay .btn[data-act="regroup"]');
    // and the same from the partner's side
    s.onCtrl({ t: 'ev', n: 1, e: { k: 'regroup' } });
    o.afterEvent = s.birds.map((b) => b.ghost);
    return o;
  } finally {
    s.dispose();
    delete window.__regroup;
  }
});
t.check('REGROUP pressed during the end-of-level ceremony doesn’t turn both sprouts into ghosts', regrouped.menu && regrouped.state === 'clear' && !regrouped.afterButton.some(Boolean) && !regrouped.toldPartner && regrouped.menuClosed, regrouped);
t.check('…nor does the partner’s regroup arriving then', !regrouped.afterEvent.some(Boolean), regrouped);
// ...and while the level is being played it still does what it says
await page.evaluate(async () => {
  const { Session } = await import('/src/game/session.ts');
  const { app, flow } = window.__fb;
  const link = { role: 'host', status: 'connected', connected: true, rtt: 30, via: 'direct', peerGen: 0, sharedNow: () => performance.now(), send() {}, sendSnap: () => true };
  const s = (window.__regroup = new Session(app, flow, { level: 0, mode: 'online', link, me: 0, nonce: 1, profiles: flow.profiles() }));
  s.togglePause();
});
await sleep(400);
const stillWorks = await page.evaluate(() => {
  const s = window.__regroup;
  try {
    const sent = [];
    s.link.send = (m) => sent.push(m);
    document.querySelector('.overlay .btn[data-act="regroup"]')?.click();
    return { state: s.state, mine: s.birds[0].ghost, told: sent.some((m) => m.t === 'ev' && m.e?.k === 'regroup') };
  } finally {
    s.dispose();
    delete window.__regroup;
  }
});
t.check('REGROUP during play still sends both sprouts back to the lantern', stillWorks.state === 'play' && stillWorks.mine && stillWorks.told, stillWorks);

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
// a finishing time garbled on the way would show as "NaN:NaN" on that card
await page.evaluate(() => { const l = window.__fake('guest'); window.__fb.flow.adopt(l); l.onCtrl({ t: 'load', level: 0, n: 9, c: 1 }); });
await waitFor(async () => (await current()) === 'Session', 3000, 'guest session for the clear card');
await frames(page, 4);
await page.evaluate(() => window.__fbSession.onCtrl({ t: 'clear', n: 9, time: 'soon' }));
await waitFor(() => page.evaluate(() => !!document.querySelector('.overlay.clear')), 3000, 'clear card again');
const card = await page.evaluate(() => document.querySelector('.overlay.clear .ov-stats')?.textContent ?? '');
t.check('a garbled finishing time doesn’t show as “NaN” on the end-of-level card', !/NaN/.test(card) && /\d:\d\d/.test(card), card);
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

// ---- a partner on another wire version. The two builds can't play, so the one who typed the code has
// to be told why rather than left watching "looking for your partner…" — and the partner is still
// trying, so a hello of the wrong version keeps arriving the whole time it waits.
const skew = await page.evaluate(async () => {
  const { NetLink } = await import('/src/net/link.ts');
  const { PROTOCOL } = await import('/src/net/protocol.ts');
  const link = NetLink.bare('guest');
  try {
    let said = '';
    link.onStatus = (st, d) => { if (st === 'error') said = d; };
    // their build keeps saying hello, once a tick, for a good while longer than the grace
    const hello = { t: 'hello', v: PROTOCOL - 1, role: 'host', id: 'theirs' };
    const t0 = performance.now();
    let heard = 0;
    for (let k = 0; k < 40; k++) {
      link.acceptHello(hello, () => {}, undefined);
      if (k === 0) heard = Math.round(link.mismatchAt - t0);
      link.tick();
      if (said) return { said, ticks: k, heardAfter: heard, remembered: Math.round(link.mismatchAt - t0) };
      // (a tick is a second apart in the real thing; the grace is six)
      await new Promise((r) => setTimeout(r, 250));
    }
    return { said, ticks: 40, heardAfter: heard, remembered: Math.round(link.mismatchAt - t0) };
  } finally {
    link.close();
  }
});
t.check('a partner on another version of the game is said so, not left looking', /different version/i.test(skew.said), skew);

// ---- the juice, and the three things it must never do: twitch the view on an ordinary hop, pour
// leaves out of a sprout standing still in a pause, or draw one out of existence after one bad frame.
// Plus the plants: grown ones have to be standing when you come back, in whatever order they're listed.
const juice = await page.evaluate(async () => {
  const { Session } = await import('/src/game/session.ts');
  const { T } = await import('/src/game/tuning.ts');
  const { app, flow } = window.__fb;
  // a local pair: the second sprout is a seat nobody is holding, so it stands where it's put
  const make = (opts = {}) => new Session(app, flow, { level: 0, mode: 'local', me: 0, seats: ['keys', 'keysR'], profiles: flow.profiles(), ...opts });
  const on = (fn) => { const s = make(); try { return fn(s); } finally { s.dispose(); } };
  const out = {};
  // the camera, by how far the sprout actually fell. A sprout's own jump tops out at ~4.1 tiles, so a
  // kick keyed below that is a kick on every hop — which is what the view twitching across a level is.
  const kickFor = (tiles) => on((s) => {
    s.cam.shakeAmt = 0;
    s.onFx(s.birds[0], { k: 'land', v: 840, d: tiles * T }, 0, 1);
    return +s.cam.shakeAmt.toFixed(3);
  });
  out.anOrdinaryHopDoesntShakeTheView = kickFor(4.2) === 0;
  out.aProperFallDoes = kickFor(12) > 0;
  out.andTheBiggerFallKicksHarder = kickFor(12) > kickFor(7);
  // a plant your partner grew, thirty tiles off-screen, is their news — not a kick in your view
  out.aPartnersPlantDoesntShakeYourView = on((s) => {
    s.cam.shakeAmt = 0;
    s.growSoil(0, false);
    return s.cam.shakeAmt === 0;
  });
  out.yourOwnPlantStillDoes = on((s) => {
    s.cam.shakeAmt = 0;
    s.growSoil(0, true);
    return s.cam.shakeAmt > 0;
  });
  // the dash trail is spawned where the drawing happens, which keeps running in a pause — but the dash
  // itself only ticks down in the physics, which doesn't. Left alone it's a fountain out of a still sprout.
  out.aPausedDashStopsTrailing = on((s) => {
    s.spawnAmbient = () => {};   // (the drifting motes of the level would be counted too)
    const leaves = (dashT) => {
      s.paused = true;
      s.fx.clear();
      for (let k = 0; k < 30; k++) {
        s.birds[0].dashT = dashT;
        s.frame(1 / 60);
      }
      return s.fx.n;
    };
    return leaves(0.2) === 0 && leaves(0) === 0;
  });
  // one frame of non-finite velocity reaches the drawing before the physics catches it, and a lean that
  // eases toward NaN keeps it for good — which scales the sprout by NaN and draws nothing, all level
  out.aGarbledFrameDoesntEraseASprout = on((s) => {
    const b = s.birds[0];
    b.vy = NaN;
    b.animate(1 / 60, null);
    b.vy = 0;
    b.animate(1 / 60, null);
    return Number.isFinite(b.airLean);
  });
  // a resumed run names its plants; the list is a set of indices, so its order is nobody's promise
  out.aResumedRunGrowsEveryPlantItNames = on(() => {
    const s = make({ resume: { cp: -1, seeds: [], grown: [2, 0], feathers: 0, time: 0 } });
    try {
      return s.world.grown[0] === 1 && s.world.growT[0] >= 1;
    } finally { s.dispose(); }
  });
  return out;
});
for (const [k, v] of Object.entries(juice)) t.check(k, v === true, v);

const errs = [...page.errors];
await browser.close();
t.finish('units', errs);
