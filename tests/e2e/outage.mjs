// When the network misbehaves: the partner goes silent (the level holds still and says so, then
// carries on when they're back), the partner's page reloads (they rejoin with the code and both
// continue from the lantern), silence beyond the grace period is a lost partner — who's welcomed back
// on both sides if they turn up after all — and the host's page reloading (they reopen the room).
import { launch, open, reporter, sleep, waitFor } from './harness.mjs';

// separate browsers: two devices, each with a foreground page (a background tab gets no frames)
const browsers = [];
const t = reporter();
const mk = async (name, color, more = {}) => { const b = await launch(); browsers.push(b); return open(b, { query: { extra: 'grace=10&norender' }, storage: { 'mossbound.settings.v1': { name, color, ...more } } }); };
let host = await mk('Pip', 0);
let guest = await mk('Bo', 1);
const errs = [];
// what each side sees (printed when a step times out)
const state = (p) => p.evaluate(() => {
  const s = window.__fbSession;
  const l = window.__fb.flow.link;
  return { screen: window.__fb.app.current?.constructor.name, isSession: window.__fb.app.current === s, state: s?.state, frozen: s?.frozen, heard: s?.everHeard, silence: s?.feed ? Math.round(s.feed.silence()) : null, cp: s?.checkpoint, nonce: s?.opts?.nonce, link: l?.status, via: l?.via, notice: document.querySelector('.hud-notice')?.textContent };
}).catch((e) => String(e));
const step = async (label, fn) => {
  try {
    return await fn();
  } catch (e) {
    console.log(`[${label}] host`, JSON.stringify(await state(host)), '\nguest', JSON.stringify(await state(guest)));
    throw e;
  }
};

await host.evaluate(() => window.__fb.flow.online());
await waitFor(() => host.evaluate(() => window.__fb.app.current?.constructor.name === 'OnlineScreen'), 5000, 'online screen');
await host.evaluate(() => window.__fb.app.current.act('host'));
const code = await waitFor(() => host.evaluate(() => window.__fb.flow.link?.code), 5000, 'code');
await guest.evaluate((c) => window.__fb.flow.online({ joinCode: c }), code);
await waitFor(() => Promise.all([host, guest].map((p) => p.evaluate(() => window.__fb.flow.link?.status === 'connected'))).then((v) => v.every(Boolean)), 60000, 'pairing');
await waitFor(() => host.evaluate(() => window.__fb.app.current?.constructor.name === 'LevelSelect'), 15000, 'levels');
await host.evaluate(() => window.__fb.flow.playLevel(0));
await step('both playing', () => waitFor(() => Promise.all([host, guest].map((p) => p.evaluate(() => window.__fb.app.current === window.__fbSession && window.__fbSession?.state === 'play'))).then((v) => v.every(Boolean)), 10000, 'both playing'));
await step('hearing', () => waitFor(() => Promise.all([[host, 1], [guest, 0]].map(([p, i]) => p.evaluate((i) => window.__fbSession.everHeard && window.__fbSession.birds[i].present, i))).then((v) => v.every(Boolean)), 10000, 'both hear each other'));
// the guest lights the first lantern, so there's somewhere to continue from
await guest.evaluate(() => { const s = window.__fbSession; s.light(0, true); s.send({ k: 'cp', i: 0 }); });
await step('lantern', () => waitFor(() => host.evaluate(() => window.__fbSession.checkpoint === 0), 5000, 'lantern'));

// 1 · the guest goes silent: the host's level holds still and says why
await guest.evaluate(() => { window.__fb.flow.link.muted = true; });
const t1 = Date.now();
const frozen = await step('freeze', () => waitFor(() => host.evaluate(() => window.__fbSession.frozen && /waiting for Bo/.test(document.querySelector('.hud-notice')?.textContent ?? '')), 8000, 'freeze'));
const freezeS = (Date.now() - t1) / 1000;
const hx = await host.evaluate(() => window.__fbSession.birds[0].x);
await host.keyboard.down('ArrowRight');
await sleep(600);
await host.keyboard.up('ArrowRight');
const still = Math.abs((await host.evaluate(() => window.__fbSession.birds[0].x)) - hx) < 1;
t.check(`a silent partner freezes the level (in ${freezeS.toFixed(1)} s) and the notice says why`, frozen && still && freezeS < 4, { freezeS, still });
// ...and it carries on when they're back
await guest.evaluate(() => { window.__fb.flow.link.muted = false; });
const back = await step('resume', () => waitFor(() => host.evaluate(() => !window.__fbSession.frozen && window.__fb.flow.link.status === 'connected'), 15000, 'resume'));
t.check('the level carries on when the partner is back', back);

// 2 · the guest's page reloads (a phone killing the tab): they rejoin with the code, and both continue
//     from the lantern in a fresh level session
const nonceBefore = await host.evaluate(() => window.__fbSession.opts.nonce);
await guest.close();
guest = await mk('Bo', 1);
await sleep(500);
await guest.evaluate((c) => window.__fb.flow.online({ joinCode: c }), code);
const rejoined = await step('rejoin', () => waitFor(async () => {
  const h = await host.evaluate(() => ({ n: window.__fbSession?.opts?.nonce, cp: window.__fbSession?.checkpoint, play: window.__fbSession?.state === 'play' }));
  const g = await guest.evaluate(() => ({ n: window.__fbSession?.opts?.nonce, cp: window.__fbSession?.checkpoint }));
  return h.play && h.n !== nonceBefore && h.n === g.n && h.cp === 0 && g.cp === 0 ? { h, g } : null;
}, 60000, 'rejoin'));
t.check('a reloaded partner rejoins and both continue from the lantern', !!rejoined, rejoined);
await step('playing again', () => waitFor(() => host.evaluate(() => window.__fbSession.birds[1].present && !window.__fbSession.frozen), 15000, 'playing again'));

// 3 · silent past the grace period (10 s here): the partner is lost, the notice says so
await guest.evaluate(() => { window.__fb.flow.link.muted = true; });
const lost = await step('lost', () => waitFor(() => host.evaluate(() => window.__fb.flow.link.status === 'lost' && /left the room/.test(document.querySelector('.hud-notice')?.textContent ?? '')), 30000, 'lost'));
t.check('silence beyond the grace period means the partner is gone', lost);
// 4 · ...but if they turn up after all (a phone call ran long), both carry on — neither side is left
//     thinking the other has gone
await guest.evaluate(() => { window.__fb.flow.link.muted = false; });
const again = await step('back from lost', () => waitFor(() => Promise.all([
  host.evaluate(() => window.__fb.flow.link.status === 'connected' && !window.__fbSession.frozen && window.__fbSession.birds[1].present),
  guest.evaluate(() => window.__fb.flow.link.status === 'connected' && window.__fbSession.birds[0].present),
]).then((v) => v.every(Boolean)), 20000, 'back from lost').catch(() => false));
t.check('a partner back after the grace period is welcomed back on both sides', again);

// 5 · the host's page reloads (their phone killed the tab): they reopen the room, and the guest — still
//     in the level — comes back to the lobby with them, the run there to continue
await host.close();
host = await mk('Pip', 0, { lastRoom: code });
await host.evaluate(() => window.__fb.flow.online());
await waitFor(() => host.evaluate(() => window.__fb.app.current?.constructor.name === 'OnlineScreen'), 5000, 'online screen again');
await host.evaluate(() => window.__fb.app.current.act('rehost'));
const lobby = await step('host back', () => waitFor(() => Promise.all([host, guest].map((p) => p.evaluate(() => window.__fb.flow.link?.status === 'connected' && window.__fb.app.current?.constructor.name === 'LevelSelect' && !!document.querySelector('[data-act="continue"], .card.continue')))).then((v) => v.every(Boolean)), 40000, 'both in the lobby').catch(() => false));
t.check('a host whose page reloaded reopens the room: both back in the lobby, the run there to continue', lobby);
errs.push(...host.errors, ...guest.errors);
for (const b of browsers) await b.close().catch(() => undefined);
t.finish('outage', errs);
