// A bad network: the guest's snapshots lose 30% of packets and arrive up to 90 ms late (so out of
// order too), then a 400 ms blackout. On the host's screen the guest's bird must still glide: it
// follows the guest's real path closely (a little behind), never teleports or steps backwards while
// running one way, ends up exactly where it really stopped, and events still get through.
import { launch, open, reporter, sleep, waitFor } from './harness.mjs';

const browsers = [];
const t = reporter();
const mk = async (name, color) => {
  const b = await launch();
  browsers.push(b);
  return open(b, { query: { extra: 'norender' }, storage: { 'mossbound.settings.v1': { name, color } } });
};
const host = await mk('Pip', 0);
const guest = await mk('Bo', 1);

await host.evaluate(() => window.__fb.flow.online());
await waitFor(() => host.evaluate(() => window.__fb.app.current?.constructor.name === 'OnlineScreen'), 5000, 'online screen');
await host.evaluate(() => window.__fb.app.current.act('host'));
const code = await waitFor(() => host.evaluate(() => window.__fb.flow.link?.code), 5000, 'code');
await guest.evaluate((c) => window.__fb.flow.online({ joinCode: c }), code);
await waitFor(() => Promise.all([host, guest].map((p) => p.evaluate(() => window.__fb.flow.link?.status === 'connected'))).then((v) => v.every(Boolean)), 60000, 'pairing');
// the direct path (this test is about the unreliable real-time channel)
await waitFor(() => Promise.all([host, guest].map((p) => p.evaluate(() => window.__fb.flow.link?.via === 'direct'))).then((v) => v.every(Boolean)), 30000, 'direct path');
await waitFor(() => host.evaluate(() => window.__fb.app.current?.constructor.name === 'LevelSelect'), 15000, 'levels');
await host.evaluate(() => window.__fb.flow.playLevel(0));
await waitFor(() => Promise.all([host, guest].map((p) => p.evaluate(() => window.__fb.app.current === window.__fbSession && window.__fbSession?.state === 'play'))).then((v) => v.every(Boolean)), 10000, 'both playing');
await waitFor(() => Promise.all([[host, 1], [guest, 0]].map(([p, i]) => p.evaluate((i) => window.__fbSession.everHeard && window.__fbSession.birds[i].present, i))).then((v) => v.every(Boolean)), 10000, 'both hear each other');

// room to run: the host stands mid-field, the guest at the left (the string stays slack throughout)
const y0 = await host.evaluate(() => window.__fbSession.birds[0].y);
await host.evaluate((y) => window.__fbSession.devTeleport(7 * 32 + 16, y), y0);
await guest.evaluate((y) => window.__fbSession.devTeleport(1 * 32 + 16, y), y0);

// the guest's uplink goes bad: 30% of snapshots vanish, the rest arrive 0–90 ms late (reordered).
// (a seeded generator: the same pattern of loss every run; NETLOSS_SEED=n tries another)
const SEED = Number(process.env.NETLOSS_SEED ?? 7);
await guest.evaluate((seed) => {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const l = window.__fb.flow.link;
  const send = l.sendSnap.bind(l);
  window.__net = { sent: 0, lost: 0, blackout: false };
  l.sendSnap = (m) => {
    window.__net.sent++;
    const lose = rnd() < 0.3;
    const late = rnd() * 90;
    if (window.__net.blackout || lose) {
      window.__net.lost++;
      return true;
    }
    setTimeout(() => send(m), late);
    return true;
  };
}, SEED);
// (a while on the bad network first, as in a real session: the jitter buffer adapts to it)
await sleep(2500);
// both sides record the guest's bird every frame (at the frame's timestamp, which is the time the
// game draws it for) on the shared wall clock
// (the host also notes how far its playback had run past the newest snapshot: > 0 means guessing)
const record = (p, i) => p.evaluate((i) => {
  const s = window.__fbSession;
  const b = s.birds[i];
  const tr = (window.__trace = []);
  const tick = (ts) => {
    const f = s.me === i ? null : s.feed;
    tr.push([performance.timeOrigin + ts, b.x, b.y, f ? Math.round(f.play - f.buf[f.buf.length - 1].t) : 0]);
    if (!window.__stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, i);
await Promise.all([record(host, 1), record(guest, 1)]);
const clock = () => guest.evaluate(() => performance.timeOrigin + performance.now());

// phase 1: run right with two hops, then stop
await sleep(400);
const run1 = await clock();
await guest.keyboard.down('ArrowRight');
await sleep(450);
await guest.keyboard.press('Space', { delay: 120 });
await sleep(550);
await guest.keyboard.press('Space', { delay: 60 });
await sleep(500);
await guest.keyboard.up('ArrowRight');
const stop1 = await clock();
await sleep(1500);
// phase 2: run back left; 400 ms in, nothing gets through for 400 ms
const run2 = await clock();
await guest.keyboard.down('ArrowLeft');
await sleep(400);
await guest.evaluate(() => { window.__net.blackout = true; });
await sleep(400);
await guest.evaluate(() => { window.__net.blackout = false; });
await sleep(700);
await guest.keyboard.up('ArrowLeft');
const stop2 = await clock();
await sleep(1500);
await Promise.all([host, guest].map((p) => p.evaluate(() => { window.__stop = true; })));
const H = await host.evaluate(() => window.__trace);
const G = await guest.evaluate(() => window.__trace);
const net = await guest.evaluate(() => window.__net);

// ---- analysis
// the guest's true position at wall time `at` (linear between its frames)
const truth = (at) => {
  let lo = 0;
  let hi = G.length - 1;
  if (at <= G[0][0]) return G[0];
  if (at >= G[hi][0]) return G[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (G[mid][0] <= at) lo = mid;
    else hi = mid;
  }
  const a = G[lo];
  const b = G[hi];
  const u = (at - a[0]) / (b[0] - a[0] || 1);
  return [at, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
};
const within = (from, to) => H.filter((h) => h[0] >= from && h[0] <= to);
// fidelity: the host draws the guest's recent past. For each drawn frame: how far it is from the
// guest's real path over the last 600 ms (on the path = 0), and how far behind that point was.
const fit = (from, to) => {
  const hs = within(from, to);
  let s = 0;
  let max = 0;
  let lagSum = 0;
  let lagMax = 0;
  let guess = 0;
  for (const h of hs) {
    let best = Infinity;
    let lag = 0;
    for (let i = 1; i < G.length; i++) {
      const a = G[i - 1];
      const b = G[i];
      if (b[0] < h[0] - 600 || a[0] > h[0]) continue;
      const ex = b[1] - a[1];
      const ey = b[2] - a[2];
      const u = Math.max(0, Math.min(1, ((h[1] - a[1]) * ex + (h[2] - a[2]) * ey) / (ex * ex + ey * ey || 1)));
      const d = Math.hypot(h[1] - a[1] - ex * u, h[2] - a[2] - ey * u);
      if (d < best) {
        best = d;
        lag = h[0] - (a[0] + (b[0] - a[0]) * u);
      }
    }
    s += best * best;
    if (best > max) guess = h[3];
    max = Math.max(max, best);
    lagSum += lag;
    lagMax = Math.max(lagMax, lag);
  }
  // guessing: how far past its newest snapshot the playback was at the worst frame (ms)
  return { rms: +Math.sqrt(s / hs.length).toFixed(2), max: +max.toFixed(1), lag: Math.round(lagSum / hs.length), lagMax: Math.round(lagMax), guessing: guess };
};
// smoothness while running one way: no backwards steps, no jumps bigger than the real motion explains
const smooth = (from, to, dir) => {
  const hs = within(from, to);
  let back = 0;
  let worst = 0;
  let spikes = 0;
  let holds = 0;
  let maxTrue = 0;
  for (let i = 1; i < G.length; i++) if (G[i][0] >= from - 400 && G[i][0] <= to) maxTrue = Math.max(maxTrue, Math.hypot(G[i][1] - G[i - 1][1], G[i][2] - G[i - 1][2]) / ((G[i][0] - G[i - 1][0]) / 1000 || 1e-3));
  for (let i = 1; i < hs.length; i++) {
    const dt = (hs[i][0] - hs[i - 1][0]) / 1000;
    const dx = hs[i][1] - hs[i - 1][1];
    const step = Math.hypot(dx, hs[i][2] - hs[i - 1][2]);
    if (dx * dir < -1) back++;
    if (step === 0) holds++;
    const allowed = maxTrue * dt * 1.6 + 2;
    if (step > allowed) spikes++;
    worst = Math.max(worst, step - allowed);
  }
  return { frames: hs.length, back, spikes, holds, worst: +worst.toFixed(1), maxTrue: Math.round(maxTrue) };
};
// steady running only: from 250 ms after the key went down (and the playback delay) to the release
const fit1 = fit(run1 + 300, stop1 + 400);
const sm1 = smooth(run1 + 250 + fit1.lag, stop1 + fit1.lag - 50, 1);
const fit2 = fit(run2 + 300, stop2 + 400);
const sm2 = smooth(run2 + 250 + fit2.lag, stop2 + fit2.lag - 50, -1);
const end1 = Math.abs(within(stop1 + 1200, stop1 + 1400).at(-1)[1] - truth(stop1 + 1400)[1]);
const end2 = Math.abs(H.at(-1)[1] - G.at(-1)[1]);
console.log(JSON.stringify({ net, fit1, sm1, fit2, sm2, end1, end2 }));
t.check(`with 30% loss + jitter the host draws the guest on its real path (rms ${fit1.rms} px, ${fit1.lag} ms behind)`, fit1.rms < 1 && fit1.max < 5 && fit1.lag < 250, fit1);
t.check('...and it glides: no backwards steps, no jumps, no stalls', sm1.back === 0 && sm1.spikes === 0 && sm1.holds <= 2, sm1);
t.check(`through a 400 ms blackout it stays on the path (max ${fit2.max} px off)`, fit2.max < 8 && fit2.lagMax < 600, fit2);
t.check('...hesitating rather than freezing and leaping: no jumps, no backwards steps', sm2.back === 0 && sm2.spikes === 0, sm2);
t.check('the bird ends up exactly where it stopped', end1 < 1 && end2 < 1, { end1, end2 });

// events are on the reliable channel: they arrive whatever the snapshot loss
await guest.keyboard.press('KeyQ');
const heart = await waitFor(() => host.evaluate(() => window.__fbSession.birds[1].emote === 'heart'), 4000, 'heart').catch(() => false);
t.check('events still get through', heart);
const errs = [...host.errors, ...guest.errors];
for (const b of browsers) await b.close();
t.finish('net-loss', errs);
