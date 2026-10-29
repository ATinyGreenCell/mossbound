// Playing across two versions. Every push deploys the site, but a partner whose page is already open
// (or cached) keeps the previous build, so the two have to get along in both directions: pair, pick a
// level, see each other move, and stay tied by the vine. Any change to the wire — the protocol number,
// a message's shape, what a receiver rejects — shows up here.
//
// It needs both builds served at once, so it isn't part of `run.mjs`. To check a release:
//   git worktree add /tmp/mb-prev <previous tag or commit>   (symlink node_modules into it)
//   node node_modules/vite/bin/vite.js --port 5215 --strictPort --host 127.0.0.1   # in that worktree
//   node node_modules/vite/bin/vite.js --port 5216 --strictPort --host 127.0.0.1   # in this one
//   node tests/e2e/interop.mjs http://127.0.0.1:5215/ http://127.0.0.1:5216/
import { launch, open, reporter, screenName, sleep, waitFor } from './harness.mjs';

const PREV = process.argv[2] ?? 'http://127.0.0.1:5215/';
const THIS = process.argv[3] ?? 'http://127.0.0.1:5216/';
const t = reporter();

/** The wire version a build is on, read from the build itself. */
const protocolOf = async (page) => page.evaluate(async () => (await import('/src/net/protocol.ts')).PROTOCOL);

/** One pairing: `hostBase` makes the room, `guestBase` joins it. */
async function round(hostBase, guestBase, label) {
  const b1 = await launch();
  const b2 = await launch();
  const host = await open(b1, { query: { base: hostBase, extra: 'norender' }, storage: { 'mossbound.settings.v1': { name: 'Pip', color: 0 } } });
  const guest = await open(b2, { query: { base: guestBase, extra: 'norender' }, storage: { 'mossbound.settings.v1': { name: 'Bo', color: 1 } } });
  const done = async (ok) => {
    t.check(`${label}: no errors on either device`, !host.errors.length && !guest.errors.length, [...host.errors, ...guest.errors].slice(0, 3));
    await b1.close();
    await b2.close();
    return ok;
  };
  await host.evaluate(() => window.__fb.flow.online());
  await waitFor(async () => (await screenName(host)) === 'OnlineScreen', 8000, 'host online screen');
  await host.evaluate(() => window.__fb.app.current.act('host'));
  const code = await waitFor(() => host.evaluate(() => window.__fb.flow.link?.code), 5000, 'room code');
  await guest.evaluate((c) => window.__fb.flow.online({ joinCode: c }), code);
  // Two builds on different wire versions must not play: a message's shape, or what a receiver throws
  // out, has changed under them. What they must do instead is say so — and the one who tried to join
  // is the one told, since the other is still waiting for a partner of its own version to turn up.
  const [vh, vg] = [await protocolOf(host), await protocolOf(guest)];
  if (vh !== vg) {
    // (this build says so after the six-second grace; a build from before that fix waits out its
    // 35-second search for a partner first, and then says the same thing)
    const t0 = Date.now();
    const told = await waitFor(async () => /different version/i.test(await guest.evaluate(() => document.body.innerText ?? '')), 50000, 'the version notice').catch(() => false);
    const toldAfter = Math.round((Date.now() - t0) / 1000);
    const connected = await host.evaluate(() => window.__fb.flow.link?.status) === 'connected';
    t.check(`${label}: across a wire version (${vh} vs ${vg}) they don't pair`, !connected, { vh, vg });
    t.check(`${label}: …and whoever tried to join is told to reload (after ${toldAfter}s)`, !!told, await guest.evaluate(() => (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160)));
    return done(true);
  }
  const paired = await waitFor(async () => (await host.evaluate(() => window.__fb.flow.link?.status)) === 'connected' && (await guest.evaluate(() => window.__fb.flow.link?.status)) === 'connected', 60000, 'pairing').catch(() => false);
  t.check(`${label}: paired`, !!paired, { code, via: await host.evaluate(() => window.__fb.flow.link?.via) });
  if (!paired) return done(false);
  // the profile message follows the handshake, so wait for it rather than reading mid-exchange
  const named = await waitFor(async () => (await host.evaluate(() => window.__fb.flow.partner?.name)) === 'Bo' && (await guest.evaluate(() => window.__fb.flow.partner?.name)) === 'Pip', 15000, 'names').catch(() => false);
  t.check(`${label}: each sees the other's name`, !!named);
  await waitFor(async () => (await screenName(host)) === 'LevelSelect' && (await screenName(guest)) === 'LevelSelect', 20000, 'level select');
  await host.evaluate(() => window.__fb.app.current.act('lvl:0'));
  const inLevel = await waitFor(async () => (await screenName(host)) === 'Session' && (await screenName(guest)) === 'Session', 25000, 'both in the level').catch(() => false);
  t.check(`${label}: the host's pick starts the level on both`, !!inLevel);
  if (!inLevel) return done(false);
  await sleep(1200);
  // there is no vine until a sprout asks for one; this check is about what the vine does, so tie it
  // on both screens (online.mjs is where the asking itself is tested)
  for (const pg of [host, guest]) await pg.evaluate(() => { const s = window.__fbSession; s.tether.tie(s.birds[0], s.birds[1]); });
  // the host walks right: on the guest's screen that sprout must walk, and the vine must take up and
  // drag the guest's own sprout along once it is at full stretch
  const read = () => guest.evaluate(() => { const s = window.__fbSession; return { x: s.birds.map((b) => Math.round(b.x)), mirror: s.auth.findIndex((a) => !a), vine: Math.round(s.tether.length) }; });
  const before = await read();
  await host.evaluate(() => { const s = window.__fbSession; const i = s.auth.findIndex(Boolean); const base = s.controlsFor.bind(s); s.controlsFor = (k) => (k === i ? { ...base(k), moveX: 1 } : base(k)); });
  await sleep(4000);
  const after = await read();
  const walked = Math.abs(after.x[before.mirror] - before.x[before.mirror]);
  const dragged = Math.abs(after.x[1 - before.mirror] - before.x[1 - before.mirror]);
  t.check(`${label}: the guest sees the host's sprout walk`, walked > 20, { before: before.x, after: after.x });
  t.check(`${label}: the vine goes taut and drags the guest's own sprout`, after.vine >= 250 && dragged > 8, { dragged, vine: after.vine });
  return done(true);
}

await round(PREV, THIS, 'the old build hosts, this one joins');
await round(THIS, PREV, 'this build hosts, the old one joins');
t.finish('interop', []);
