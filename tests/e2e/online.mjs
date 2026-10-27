// Two players on two "devices" (isolated browser contexts) pairing over the real public relays:
// the shared save merges, each sees the other's bird move, a tug yanks the partner on THEIR screen,
// hearts / seeds / lanterns sync, the level clears for both and the next one loads for both, a third
// player is told the room is full, and leaving is noticed. `node online.mjs relay` runs the same game
// through the WebSocket relay only; `node online.mjs p2p` over WebRTC only (the brokers unreachable).
import { launch, open, reporter, sleep, waitFor } from './harness.mjs';

const MODE = process.argv[2] ?? 'both';
const RELAY = MODE === 'relay';
const extra = RELAY ? 'relay&norender' : MODE === 'p2p' ? 'p2p&norender' : 'norender';
// two browsers: two devices, each with its own foreground page (a background tab gets no frames)
const browser = await launch();
const browser2 = await launch();
const t = reporter();
const save = (o) => ({ v: 3, unlocked: 0, levels: {}, finished: false, runs: {}, clock: 0, ...o });
const host = await open(browser, {
  query: { extra },
  storage: { 'mossbound.settings.v1': { name: 'Pip', color: 0 }, 'mossbound.save.v3': save({ unlocked: 2, levels: { garden: { seeds: 20, feathers: 1, time: 300, clears: 1 } } }) },
});
const guest = await open(browser2, {
  query: { extra },
  storage: { 'mossbound.settings.v1': { name: 'Bo', color: 1 }, 'mossbound.save.v3': save({ unlocked: 1, levels: { woods: { seeds: 5, feathers: 2, time: 0, clears: 0 } } }) },
});
const errors = () => [...host.errors, ...guest.errors];

// host makes a room, guest joins with the code
await host.evaluate(() => window.__fb.flow.online());
await waitFor(() => host.evaluate(() => window.__fb.app.current?.constructor.name === 'OnlineScreen'), 5000, 'host online screen');
await host.evaluate(() => window.__fb.app.current.act('host'));
const code = await waitFor(() => host.evaluate(() => window.__fb.flow.link?.code), 5000, 'room code');
const t0 = Date.now();
await guest.evaluate((code) => window.__fb.flow.online({ joinCode: code }), code);
const linked = await waitFor(async () => (await host.evaluate(() => window.__fb.flow.link?.status)) === 'connected' && (await guest.evaluate(() => window.__fb.flow.link?.status)) === 'connected', 60000, 'pairing');
const via = await host.evaluate(() => window.__fb.flow.link.via);
t.check(`paired in ${((Date.now() - t0) / 1000).toFixed(1)} s`, linked, { code, via });
if (RELAY) t.check('relay-only mode really goes through the relay', via === 'relay', via);
else if (MODE === 'p2p') t.check('WebRTC-only mode goes direct', via === 'direct', via);
else {
  // the relay often finds the partner first; the direct WebRTC path then takes over
  const direct = await waitFor(() => Promise.all([host, guest].map((p) => p.evaluate(() => window.__fb.flow.link?.via))).then((v) => v.every((x) => x === 'direct')), 30000, 'direct path').catch(() => false);
  t.check('the direct (WebRTC) path takes over from the relay', direct, await host.evaluate(() => window.__fb.flow.link?.via));
}
// both reach the level select; names and saves are swapped
await waitFor(() => Promise.all([host, guest].map((p) => p.evaluate(() => window.__fb.app.current?.constructor.name === 'LevelSelect'))).then((v) => v.every(Boolean)), 15000, 'level select on both');
await sleep(1500);
const names = { host: await host.evaluate(() => window.__fb.flow.partner.name), guest: await guest.evaluate(() => window.__fb.flow.partner.name) };
t.check('each sees the other’s name', names.host === 'Bo' && names.guest === 'Pip', names);
const saves = await Promise.all([host, guest].map((p) => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('mossbound.save.v3')); return { unlocked: s.unlocked, garden: s.levels.garden?.feathers, woods: s.levels.woods?.feathers }; })));
t.check('the shared save merged on both devices', saves.every((s) => s.unlocked === 2 && s.garden === 1 && s.woods === 2), saves);
// a third player with the same code is told the room is full (not, half a minute later, that nobody's there)
if (MODE === 'both') {
  const browser3 = await launch();
  const third = await open(browser3, { query: { extra }, storage: { 'mossbound.settings.v1': { name: 'Kit', color: 2 } } });
  await third.evaluate((code) => window.__fb.flow.online({ joinCode: code }), code);
  const full = await waitFor(() => third.evaluate(() => window.__fb.app.current?.state === 'error' && document.querySelector('.online-screen .note')?.textContent), 25000, 'room full').catch(() => '');
  const pair = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__fb.flow.link?.status)));
  t.check('a third player is told the room is full, and the pair plays on', /two birds/.test(full) && pair.every((s) => s === 'connected'), { full, pair });
  await browser3.close();
}

// into level 1 together
await host.evaluate(() => window.__fb.flow.playLevel(0));
await waitFor(() => Promise.all([host, guest].map((p) => p.evaluate(() => window.__fbSession?.L?.index === 0 && window.__fbSession.state === 'play'))).then((v) => v.every(Boolean)), 10000, 'both in level 1');
const nonces = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__fbSession.opts.nonce)));
t.check('both load the same level session', nonces[0] === nonces[1], nonces);
// messages take two paths and can arrive out of order: an older host command (the 'lobby' sent
// before this level, arriving late over the relay) must not undo the newer one
await guest.evaluate(() => { window.__fb.flow.link.onCtrl({ t: 'lobby', c: 1 }); window.__fb.flow.link.onCtrl({ t: 'load', level: 3, n: 4242, c: 1 }); });
await sleep(500);
const stayed = await guest.evaluate((n) => window.__fb.app.next === window.__fbSession && window.__fbSession.L.index === 0 && window.__fbSession.opts.nonce === n, nonces[0]);
t.check('a stale host command arriving late is ignored', stayed);
await waitFor(() => host.evaluate(() => window.__fbSession.birds[1].present), 10000, 'host hears the guest');
await waitFor(() => guest.evaluate(() => window.__fbSession.birds[0].present), 10000, 'guest hears the host');
// host walks right: the guest sees it
// (headless pages run at a few fps here, so walk until it has moved rather than for a fixed time)
const hx0 = await host.evaluate(() => window.__fbSession.birds[0].x);
await host.keyboard.down('ArrowRight');
await waitFor(() => host.evaluate((x0) => window.__fbSession.birds[0].x > x0 + 80, hx0), 8000, 'host walks');
await host.keyboard.up('ArrowRight');
const hostSees = await host.evaluate(() => window.__fbSession.birds[0].x);
const guestSees = await waitFor(async () => { const g = await guest.evaluate(() => window.__fbSession.birds[0].x); const h = await host.evaluate(() => window.__fbSession.birds[0].x); return Math.abs(g - h) < 12 ? g : null; }, 6000, 'guest view settles').catch(() => null);
t.check('the guest sees the host’s bird where it is', hostSees > hx0 + 60 && guestSees !== null, { hx0, hostSees, guestSees });
// guest walks left a bit, host sees it
const gx0 = await guest.evaluate(() => window.__fbSession.birds[1].x);
await guest.keyboard.down('ArrowLeft');
await waitFor(() => guest.evaluate((x0) => window.__fbSession.birds[1].x < x0 - 24, gx0), 8000, 'guest walks');
await guest.keyboard.up('ArrowLeft');
const g1 = await guest.evaluate(() => window.__fbSession.birds[1].x);
const g1h = await waitFor(async () => { const h = await host.evaluate(() => window.__fbSession.birds[1].x); const g = await guest.evaluate(() => window.__fbSession.birds[1].x); return Math.abs(g - h) < 12 ? h : null; }, 6000, 'host view settles').catch(() => null);
t.check('the host sees the guest’s bird where it is', g1h !== null, { guest: g1, host: g1h });
// stretch the string, then the guest tugs: the host's bird is yanked on the host's own screen
await host.keyboard.down('ArrowRight');
await waitFor(() => host.evaluate(() => window.__fbSession.tether.length > 200), 10000, 'string stretched');
await host.keyboard.up('ArrowRight');
await sleep(600);
const before = await host.evaluate(() => ({ x: window.__fbSession.birds[0].x, len: window.__fbSession.tether.length }));
await guest.keyboard.press('KeyE');
const yanked = await waitFor(async () => { const x = await host.evaluate(() => window.__fbSession.birds[0].x); return x < before.x - 40 ? x : null; }, 4000, 'yank');
t.check('a tug from the guest yanks the host’s bird', !!yanked, { before, after: yanked });
await sleep(800);
// hearts
await guest.keyboard.press('KeyQ');
const heart = await waitFor(() => host.evaluate(() => window.__fbSession.birds[1].emote === 'heart'), 4000, 'heart');
t.check('a heart from the guest shows on the host', heart);
// a seed picked up by the host disappears for the guest
// (the nearest seed: teleporting far would just get reeled back in by the string)
const seedIdx = await host.evaluate(() => { const s = window.__fbSession; const b = s.birds[0]; let i = -1, best = Infinity; s.L.seeds.forEach((p, k) => { const d = Math.hypot(p.x - b.x, p.y - b.y); if (!s.seedTaken[k] && d < best) { best = d; i = k; } }); const p = s.L.seeds[i]; b.place({ x: p.x, y: p.y }); return i; });
const seedSynced = await waitFor(() => guest.evaluate((i) => window.__fbSession.seedTaken[i] === 1, seedIdx), 5000, 'seed sync');
t.check('seeds are shared', seedSynced, seedIdx);
// a lantern lit by the guest is lit for the host, and saved as the run on both
// the guest lights the first lantern (through the session's own pickup → event path)
await guest.evaluate(() => { const s = window.__fbSession; s.light(0, true); s.send({ k: 'cp', i: 0 }); });
const cp = await waitFor(() => host.evaluate(() => window.__fbSession.checkpoint === 0), 5000, 'lantern sync');
await sleep(2500);
const runs = await Promise.all([host, guest].map((p) => p.evaluate(() => JSON.parse(localStorage.getItem('mossbound.save.v3')).runs)));
t.check('lanterns are shared, and the run is saved on both devices', cp && runs.every((r) => r?.garden?.run?.cp === 0 && r.garden.run.with === 'Pip & Bo'), runs);
// latency shows in the HUD
const hud = await host.evaluate(() => document.querySelector('.hud-partner')?.textContent ?? '');
t.check('the HUD shows the partner and the latency', /Bo/.test(hud) && /ms/.test(hud), hud);
// both into the nest: cleared on both; NEXT LEVEL takes both along
for (const [p, i] of [[host, 0], [guest, 1]]) await p.evaluate((i) => { const s = window.__fbSession; const n = s.L.nest; s.devTeleport(n.x + (i ? 12 : -12), n.y - 4); }, i);
const cleared = await waitFor(() => Promise.all([host, guest].map((p) => p.evaluate(() => window.__fbSession?.state === 'clear'))).then((v) => v.every(Boolean)), 10000, 'cleared on both');
t.check('the level clears for both', cleared);
await sleep(600);
await host.evaluate(() => window.__fb.flow.playLevel(1));
const next = await waitFor(() => Promise.all([host, guest].map((p) => p.evaluate(() => window.__fbSession?.L?.index === 1))).then((v) => v.every(Boolean)), 10000, 'level 2 on both');
const unlocked = await Promise.all([host, guest].map((p) => p.evaluate(() => JSON.parse(localStorage.getItem('mossbound.save.v3')).unlocked)));
t.check('the next level loads for both; the clear is in both saves', next && unlocked.every((u) => u >= 2), unlocked);
// the guest leaves: the host is told
await guest.close();
const left = await waitFor(() => host.evaluate(() => window.__fb.flow.link?.status === 'lost'), 15000, 'partner left');
t.check('leaving is noticed', left);
// …and while the host waits for them, nothing more is aimed at their old connection (40 sends a second)
await sleep(4000);
const stale = host.errors.filter((e) => /no peer with id/.test(e));
t.check(`nothing is sent down a connection the partner has left (${stale.length} tries)`, stale.length === 0, stale.slice(0, 2));
await browser.close();
await browser2.close();
t.finish('online', errors());
