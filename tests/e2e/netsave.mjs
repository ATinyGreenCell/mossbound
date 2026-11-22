// The shared journal and the messages between partners, driven directly (scripted partners on fake links,
// no network): a save written by a newer build keeps what this one doesn't know; two copies that can't
// fully agree don't answer each other for ever; a partner on a damaged build (or no partner of ours at
// all) can't clear the host's level or throw in its handlers; the vine is tied on both screens or on
// neither — however the presses cross, whatever a ghost was doing; and a direct path that falls quiet
// hands the bird stream to the relay before anyone's level freezes.
import { launch, open, reporter, sleep, waitFor } from './harness.mjs';

const t = reporter();
const errors = [];
const browsers = [];
const SAVE = 'mossbound.save.v3';
const ev = (p, fn, ...args) => p.evaluate(fn, ...args).catch(() => null);

/** A browser of its own (its own storage: a device), with the fake link factory installed. */
async function device(opts = {}) {
  const b = await launch();
  browsers.push(b);
  const page = await open(b, { query: { extra: 'norender' }, ...opts });
  await page.evaluate(() => {
    window.__fake = (role) => ({
      role, code: 'ABCD', status: 'connected', connected: true, peerGen: 0, rtt: 30, via: 'direct', sent: [],
      send(m) { this.sent.push(JSON.stringify(m)); }, sendSnap: () => true, close() { this.closed = true; }, sharedNow: () => performance.now(),
      onStatus: null, onCtrl: null, onSnap: null,
      set(s) { this.status = s; this.connected = s === 'connected'; this.onStatus?.(s, ''); },
    });
  });
  return page;
}
const inOnlineLevel = (p) => waitFor(() => ev(p, () => !!window.__fbSession?.online && window.__fb.app.current === window.__fbSession), 10000, 'an online level');

// ---- a save written by a newer build: a level this build doesn't have, fields it doesn't know. Anything
// this build writes (and it writes whenever something is found) carries them along: that copy in storage
// is the newer build's too — two tabs on two versions, or an installed copy opened offline
{
  const NEWER = {
    v: 3, unlocked: 2, clock: 9, finished: false, hatsV2: { owned: ['crown'] },
    levels: { garden: { seeds: 5, feathers: 1, time: 80, clears: 1, bestHat: 'crown' }, zz9: { seeds: 4, feathers: 3, time: 99, clears: 2 } },
    runs: {
      garden: { gen: 2, at: 9, run: { cp: 1, seeds: [3], grown: [], feathers: 1, time: 40, with: '', sig: '', hats: ['crown'] } },
      zz9: { gen: 1, at: 8, run: { cp: 2, seeds: [1], grown: [], feathers: 0, time: 20, with: '', sig: '' } },
    },
  };
  const page = await device({ storage: { [SAVE]: NEWER } });
  await page.evaluate(() => window.__fb.save.bankFeathers('woods', 2));
  const s = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), SAVE));
  const kept = { level: s.levels?.zz9?.clears === 2, run: s.runs?.zz9?.run?.cp === 2, field: s.hatsV2?.owned?.[0] === 'crown', inRecord: s.levels?.garden?.bestHat === 'crown', inRun: s.runs?.garden?.run?.hats?.[0] === 'crown', wrote: s.levels?.woods?.feathers === 2 };
  t.check('a save written by a newer build keeps its unknown levels, fields and run fields through this build’s writes', Object.values(kept).every(Boolean), kept);
  // …and a run of a level this build does know, replaced by a fresh start, doesn't inherit the old run's extras
  await page.evaluate(() => window.__fb.save.setRun('garden', 3, { cp: -1, seeds: [7], grown: [], feathers: 0, time: 25, with: '', sig: '' }, true));
  const s2 = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), SAVE));
  t.check('…but a fresh start of a run doesn’t inherit the old run’s unknown fields', s2.runs?.garden?.gen === 3 && s2.runs.garden.run?.hats === undefined && s2.levels?.garden?.bestHat === 'crown', s2.runs?.garden);
  errors.push(...page.errors);
}

// ---- two copies of the journal that can't fully agree (one holds a run counted absurdly far ahead, which
// the other refuses by design): they swap once each and stop, instead of answering each other for ever
{
  const base = (clock, runs = {}) => ({ v: 3, unlocked: 2, levels: { garden: { seeds: 3, feathers: 1, time: 100, clears: 1 } }, finished: false, runs, clock });
  const run = { cp: 1, seeds: [1, 2], grown: [], feathers: 0, time: 50, with: '', sig: '' };
  for (const [label, seedA, seedB] of [
    ['two ordinary copies', base(10, { garden: { gen: 1, at: 10, run } }), base(5, { woods: { gen: 1, at: 5, run } })],
    ['a copy with a run counted 2e9 ahead', base(2e9, { garden: { gen: 1, at: 2e9, run } }), base(5, { woods: { gen: 1, at: 5, run } })],
  ]) {
    const A = await device({ storage: { [SAVE]: seedA } });
    const B = await device({ storage: { [SAVE]: seedB } });
    await A.evaluate(() => { window.__l = window.__fake('host'); window.__l.status = 'waiting'; window.__fb.flow.adopt(window.__l); });
    await B.evaluate(() => { window.__l = window.__fake('guest'); window.__l.status = 'waiting'; window.__fb.flow.adopt(window.__l); });
    await A.evaluate(() => window.__l.set('connected'));
    await B.evaluate(() => window.__l.set('connected'));
    const n = { AtoB: 0, BtoA: 0 };
    const t0 = Date.now();
    while (Date.now() - t0 < 4000) {
      const fromA = await A.evaluate(() => window.__l.sent.splice(0));
      const fromB = await B.evaluate(() => window.__l.sent.splice(0));
      n.AtoB += fromA.filter((m) => JSON.parse(m).t === 'save').length;
      n.BtoA += fromB.filter((m) => JSON.parse(m).t === 'save').length;
      await B.evaluate((ms) => { for (const m of ms) window.__l.onCtrl?.(JSON.parse(m)); }, fromA);
      await A.evaluate((ms) => { for (const m of ms) window.__l.onCtrl?.(JSON.parse(m)); }, fromB);
      await sleep(20);
    }
    const runs = await Promise.all([A, B].map((p) => p.evaluate(() => Object.keys(window.__fb.save.save.runs).sort().join())));
    t.check(`${label}: the journals swap and stop (${n.AtoB} / ${n.BtoA} saves in 4 s), each with all it can take (${runs.join(' · ')})`, n.AtoB <= 2 && n.BtoA <= 2 && runs[1].includes('woods') && runs[0] === 'garden,woods', { n, runs });
    errors.push(...A.errors, ...B.errors);
    await A.close();
    await B.close();
  }
}

// ---- a partner who doesn't play by the rules (a damaged build, or not our partner at all)
{
  const page = await device();
  await page.evaluate(() => { const l = (window.__l = window.__fake('host')); window.__fb.flow.mode = 'local'; window.__fb.flow.adopt(l); window.__fb.flow.playLevel(0); });
  await inOnlineLevel(page);
  const r = await page.evaluate(() => {
    const s = window.__fbSession;
    const l = window.__l;
    const n = s.opts.nonce;
    const out = {};
    // calling the level cleared is the host's word, never the guest's
    l.onCtrl({ t: 'clear', n, time: 1 });
    out.state = s.state;
    out.record = JSON.parse(localStorage.getItem('mossbound.save.v3') ?? '{}').levels?.garden ?? null;
    // events with nothing in them
    try {
      l.onCtrl({ t: 'ev', n, e: null });
      l.onCtrl({ t: 'ev', n, e: 'tug' });
      l.onCtrl({ t: 'ev', n, e: { k: 7 } });
      out.evThrew = false;
    } catch (e) {
      out.evThrew = String(e.message);
    }
    // a flood of plants (there's one patch of soil here)
    const flood = Array.from({ length: 1e6 }, (_, i) => i % 3);
    const t0 = performance.now();
    l.onCtrl({ t: 'world', n, seeds: [], feathers: 0, cp: -1, grown: flood });
    out.floodMs = Math.round(performance.now() - t0);
    // saves that aren't saves: nothing to merge, nothing to answer
    l.sent.length = 0;
    l.onCtrl({ t: 'save', s: null });
    l.onCtrl({ t: 'save', s: 'junk' });
    l.onCtrl({ t: 'save', s: { v: 3 } });
    out.saveReplies = l.sent.filter((m) => JSON.parse(m).t === 'save').length;
    // a name cut through the middle of an emoji somewhere along the way
    l.onCtrl({ t: 'profile', p: { name: 'Bo\uD83D', color: 3, hat: 'none' } });
    out.name = JSON.stringify(window.__fb.flow.partner.name);
    return out;
  });
  t.check(`a ‘clear’ from the guest doesn’t clear the host’s level or touch its records (${r.state})`, r.state === 'play' && !r.record, r);
  t.check('events with nothing in them are ignored, not thrown on', r.evThrew === false, r);
  t.check(`a flood of plant indices can’t eat a frame (${r.floodMs} ms)`, r.floodMs < 20, r);
  t.check(`a save that isn’t one gets no answer (${r.saveReplies} sent)`, r.saveReplies === 0, r);
  t.check(`a name with half an emoji keeps only the whole characters (${r.name})`, r.name === '"Bo"', r);
  errors.push(...page.errors);
  await page.close();
}
{
  // the guest's level select mirrors the host's pick — of a level that exists
  const page = await device();
  await page.evaluate(() => { const l = (window.__l = window.__fake('guest')); window.__fb.flow.adopt(l); window.__fb.flow.mode = 'online'; window.__fb.flow.levels(); });
  await waitFor(() => ev(page, () => window.__fb.app.current?.constructor.name === 'LevelSelect'), 8000, 'the guest’s level select');
  const r = await page.evaluate(() => {
    const l = window.__l;
    const sc = window.__fb.app.current;
    const out = {};
    try {
      l.onCtrl({ t: 'pick', level: 1.5, c: 1 });
      l.onCtrl({ t: 'pick', level: '2', c: 2 });
      out.threw = false;
    } catch (e) {
      out.threw = String(e.message);
    }
    out.afterJunk = sc.sel;
    l.onCtrl({ t: 'pick', level: 2, c: 3 });
    out.afterReal = sc.sel;
    return out;
  });
  t.check(`a ‘pick’ of a level that isn’t one is ignored (sel ${r.afterJunk}), a real one followed (sel ${r.afterReal})`, r.threw === false && Number.isInteger(r.afterJunk) && r.afterReal === 2, r);
  errors.push(...page.errors);
  await page.close();
}

// ---- the vine, tied on both screens or neither
/** In the page: the partner's sprout streamed to this screen at 40 Hz, standing right beside ours (ghost while window.__ghost). */
const pumpBeside = (p) =>
  p.evaluate(async () => {
    const { packSnap, F_GHOST, F_GROUND } = await import('/src/net/protocol.ts');
    const s = window.__fbSession;
    const me = s.birds[s.me];
    const n = s.opts.nonce;
    let seq = 0;
    window.__ghost = false;
    clearInterval(window.__pump);
    window.__pump = setInterval(() => {
      if (window.__fb.app.current !== s) return clearInterval(window.__pump);
      // (the level is being left: the flow has already let go of the link)
      if (!window.__l?.onSnap) return;
      const x = me.x + (s.me === 0 ? 30 : -30);
      window.__l.onSnap(packSnap({ seq: ++seq, t: performance.now(), x, y: me.y, vx: 0, vy: 0, flags: (window.__ghost ? F_GHOST : 0) | F_GROUND, mover: -1, rx: 0, ry: 0, n }));
    }, 25);
  });
{
  // the partner comes back from a fall — their ghost re-forms beside us — and ties the vine at once: on our
  // screen they are still a ghost for a playback delay, and their 'tie' must not be lost to that
  const page = await device();
  const res = [];
  for (const gap of [10, 40, 80, 150]) {
    await page.evaluate(() => { const l = (window.__l = window.__fake('guest')); window.__fb.flow.adopt(l); l.onCtrl({ t: 'load', level: 0, n: 777, c: Date.now(), gen: 1 }); });
    await inOnlineLevel(page);
    await pumpBeside(page);
    await page.evaluate(() => { window.__ghost = true; });
    await sleep(1200);
    const r = await page.evaluate(async (gap) => {
      const s = window.__fbSession;
      window.__ghost = false;
      await new Promise((r) => setTimeout(r, gap));
      const ghostThen = s.birds[0].ghost;
      window.__l.onCtrl({ t: 'ev', n: 777, e: { k: 'tie' }, mid: `tie${gap}` });
      await new Promise((r) => setTimeout(r, 1200));
      return { gap, ghostThen, tied: s.tether.tied };
    }, gap);
    res.push(r);
    await page.evaluate(() => window.__fb.flow.title());
    await sleep(200);
  }
  t.check(`a tie from a partner who has just re-formed is kept, whatever their sprout still looks like here (${res.map((r) => `${r.gap} ms: ${r.tied ? 'tied' : 'LOST'}`).join(', ')})`, res.every((r) => r.tied), res);
  // …and so is a vine they shoot over a ring the moment they're back
  await page.evaluate(() => { const l = (window.__l = window.__fake('guest')); window.__fb.flow.adopt(l); l.onCtrl({ t: 'load', level: 0, n: 779, c: Date.now(), gen: 1 }); });
  await inOnlineLevel(page);
  await pumpBeside(page);
  await sleep(300);
  const hook = await page.evaluate(async () => {
    const s = window.__fbSession;
    const l = window.__l;
    l.onCtrl({ t: 'ev', n: 779, e: { k: 'tie' }, mid: 'h1' });
    window.__ghost = true;
    await new Promise((r) => setTimeout(r, 1200));
    window.__ghost = false;
    await new Promise((r) => setTimeout(r, 20));
    const ghostThen = s.birds[0].ghost;
    l.onCtrl({ t: 'ev', n: 779, e: { k: 'hook', i: 0 }, mid: 'h2' });
    // (the moment it takes: this partner stands nowhere near that ring, so the string lets go of it again)
    let onRing = false;
    const t0 = performance.now();
    while (!onRing && performance.now() - t0 < 1000) {
      await new Promise((r) => requestAnimationFrame(r));
      onRing = !!s.tether.hooked(0);
    }
    return { ghostThen, hooked: s.birds[0].hooked, onRing };
  });
  t.check(`…as is a vine they shoot over a ring the moment they're back (${hook.onRing ? 'over the ring' : 'LOST'})`, hook.ghostThen && hook.hooked && hook.onRing, hook);
  errors.push(...page.errors);
  await page.close();
}
{
  // two screens, presses crossing in flight: both sprouts tie at once, then the host lets go before either
  // tie has arrived. And then a tie whose message is lost outright: the world sync brings it over
  const H = await device();
  const G = await device();
  await H.evaluate(() => { const l = (window.__l = window.__fake('host')); window.__fb.flow.adopt(l); window.__fb.flow.playLevel(0); });
  await inOnlineLevel(H);
  const nonce = await H.evaluate(() => window.__fbSession.opts.nonce);
  await G.evaluate((n) => { const l = (window.__l = window.__fake('guest')); window.__fb.flow.adopt(l); l.onCtrl({ t: 'load', level: 0, n, c: 1, gen: 1 }); }, nonce);
  await inOnlineLevel(G);
  await Promise.all([H, G].map(pumpBeside));
  await waitFor(() => Promise.all([H, G].map((p) => p.evaluate(() => window.__fbSession.birds[1 - window.__fbSession.me].present))).then((v) => v.every(Boolean)), 5000, 'both partners present');
  const evs = (p) => p.evaluate(() => window.__l.sent.splice(0).filter((m) => JSON.parse(m).t === 'ev'));
  const deliver = (p, ms) => p.evaluate((ms) => { for (const m of ms) window.__l.onCtrl(JSON.parse(m)); }, ms);
  await Promise.all([H, G].map((p) => p.evaluate(() => { window.__l.sent.length = 0; })));
  await H.evaluate(() => { const s = window.__fbSession; s.tieVine(s.birds[0]); });
  await G.evaluate(() => { const s = window.__fbSession; s.tieVine(s.birds[1]); });
  await sleep(100);
  await H.evaluate(() => { const s = window.__fbSession; s.untieVine(s.birds[0]); });
  const [fromH, fromG] = [await evs(H), await evs(G)];
  await deliver(H, fromG);
  await deliver(G, fromH);
  await sleep(200);
  const crossed = await Promise.all([H, G].map((p) => p.evaluate(() => window.__fbSession.tether.tied)));
  t.check(`tie and untie crossing in flight leave both screens agreeing (host ${crossed[0] ? 'tied' : 'untied'}, guest ${crossed[1] ? 'tied' : 'untied'})`, crossed[0] === crossed[1], crossed);
  // a tie whose message never arrives
  await H.evaluate(() => { const s = window.__fbSession; if (s.tether.tied) s.untieVine(s.birds[0]); s.tieVine(s.birds[0]); });
  await evs(H); // (lost)
  const healed = await waitFor(async () => {
    const world = await H.evaluate(() => window.__l.sent.splice(0).filter((m) => JSON.parse(m).t === 'world'));
    await deliver(G, world);
    return G.evaluate(() => window.__fbSession.tether.tied);
  }, 6000, 'the world sync').catch(() => false);
  t.check('a tie whose message was lost reaches the partner’s screen with the next world sync', healed === true, healed);
  errors.push(...H.errors, ...G.errors);
  await H.close();
  await G.close();
}
{
  // a partner on an older build sends its ties with no count at all: they still tie and untie
  const page = await device();
  await page.evaluate(() => { const l = (window.__l = window.__fake('guest')); window.__fb.flow.adopt(l); l.onCtrl({ t: 'load', level: 0, n: 778, c: Date.now(), gen: 1 }); });
  await inOnlineLevel(page);
  await pumpBeside(page);
  await sleep(300);
  const r = await page.evaluate(async () => {
    const s = window.__fbSession;
    const l = window.__l;
    l.onCtrl({ t: 'ev', n: 778, e: { k: 'tie' }, mid: 'o1' });
    const a = s.tether.tied;
    l.onCtrl({ t: 'ev', n: 778, e: { k: 'untie' }, mid: 'o2' });
    const b = s.tether.tied;
    l.onCtrl({ t: 'ev', n: 778, e: { k: 'tie' }, mid: 'o3' });
    return { a, b, c: s.tether.tied };
  });
  t.check('ties from an older build (no count) still tie and untie', r.a && !r.b && r.c, r);
  errors.push(...page.errors);
  await page.close();
}

// ---- the direct path falls quiet: the bird stream goes over the relay as well within a few packets,
// long before the partner's level would freeze (it holds still after 1.6 s without a snapshot)
{
  const page = await device();
  const r = await page.evaluate(async () => {
    const { NetLink } = await import('/src/net/link.ts');
    const l = NetLink.bare('host');
    const sent = { fast: 0, relay: 0 };
    Object.assign(l, {
      peerId: 'partner',
      tpeer: 'tp',
      rt: { readyState: 'open', bufferedAmount: 0, send: () => sent.fast++ },
      rtReady: true,
      relay: { up: true, hz: 30, sendSnap: () => { sent.relay++; return Promise.resolve(true); }, send: () => Promise.resolve(true), close() {} },
    });
    const snap = [1, 0, 0, 0, 0, 0, 0, -1, 0, 0, 1];
    const out = {};
    l.lastDirect = performance.now();
    l.sendSnap(snap);
    out.healthy = { ...sent };
    sent.fast = sent.relay = 0;
    l.lastDirect = performance.now() - 400;
    l.sendSnap(snap);
    out.quiet400 = { ...sent };
    return out;
  });
  t.check(`while the direct path is heard, the stream rides it alone (${JSON.stringify(r.healthy)})`, r.healthy.fast === 1 && r.healthy.relay === 0, r);
  t.check(`direct quiet for 0.4 s: the stream goes over the relay too (${JSON.stringify(r.quiet400)})`, r.quiet400.relay === 1, r);
  errors.push(...page.errors);
  await page.close();
}

for (const b of browsers) await b.close();
t.finish('netsave', errors);
