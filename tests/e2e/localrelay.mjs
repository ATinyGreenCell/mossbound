// Online play over a relay the test runs itself: a tiny MQTT-over-WebSocket broker on this machine
// (?relay&brokers=…), so every network fault is exact and every run the same — no public broker in the way.
//   · a partner whose page reloaded goes back into the room by itself (a guest rejoins, a host reopens it),
//     the pair carries on in the level they were in — tied, if they were — and both sides know each
//     other's name, colour and hat again; but not after LEAVE ROOM, nor from a note that's too old, nor
//     round and round;
//   · during a Wi-Fi blip a stale tab with the room's code can't take the partner's seat, while the
//     partner's own tab, reloaded during the blip, gets it back;
//   · a broker that asks every client to log in (as the one on port 443 does) is logged in to;
//   · a relay socket that goes silent without closing (Wi-Fi with no way out, a NAT that forgot us) is
//     noticed and replaced in seconds, not after the 25 s keepalive watchdog;
//   · with two brokers, one going silent for a player moves the bird stream to the other at once.
// (ws comes with puppeteer-core, which every browser test here already needs.)
import { WebSocketServer } from 'ws';
import { launch, open, reporter, sleep, waitFor } from './harness.mjs';

const t = reporter();
const errors = [];

/** The smallest MQTT 3.1.1 broker the relay needs: CONNECT, SUBSCRIBE, PUBLISH (QoS 0), PINGREQ. */
class Broker {
  socks = new Set();
  /** `{ user, pass }`: a client that doesn't log in with exactly these is refused (CONNACK 5, not authorised) */
  login = null;
  async start() {
    this.wss = new WebSocketServer({ port: 0, host: '127.0.0.1', handleProtocols: () => 'mqtt' });
    await new Promise((r) => this.wss.on('listening', r));
    this.port = this.wss.address().port;
    this.wss.on('connection', (ws) => {
      const s = { ws, subs: new Set(), at: Date.now(), dead: false };
      this.socks.add(s);
      ws.on('message', (data) => {
        // a socket gone silent: nothing it sends goes anywhere, nothing comes back, and it stays open
        if (s.dead) return;
        const b = Buffer.from(data);
        const type = b[0] >> 4;
        let i = 1;
        let len = 0;
        let mul = 1;
        let byte;
        do {
          byte = b[i++];
          len += (byte & 127) * mul;
          mul *= 128;
        } while (byte & 128);
        const body = b.subarray(i, i + len);
        const str = (o) => body.subarray(o + 2, o + 2 + ((body[o] << 8) | body[o + 1])).toString();
        if (type === 1) {
          // CONNECT: protocol name, level, flags, keepalive, client id, then the user name and password if flagged
          let o = 0;
          const field = () => { const v = str(o); o += 2 + Buffer.byteLength(v); return v; };
          field();
          const flags = body[o + 1];
          o += 4;
          field();
          const user = flags & 0x80 ? field() : null;
          const pass = flags & 0x40 ? field() : null;
          const ok = !this.login || (user === this.login.user && pass === this.login.pass);
          ws.send(Buffer.from([0x20, 2, 0, ok ? 0 : 5]));
          if (!ok) ws.close();
        }
        else if (type === 8) {
          s.subs.add(str(2));
          ws.send(Buffer.from([0x90, 3, body[0], body[1], 0]));
        } else if (type === 3) {
          const topic = str(0);
          for (const o of this.socks) if (o !== s && !o.dead && o.subs.has(topic) && o.ws.readyState === 1) o.ws.send(b);
        } else if (type === 12) ws.send(Buffer.from([0xd0, 0]));
      });
      ws.on('close', () => this.socks.delete(s));
    });
    return this;
  }
  get url() {
    return `ws://127.0.0.1:${this.port}`;
  }
  /** the sockets opened since `t` (ms) */
  since(t) {
    return [...this.socks].filter((s) => s.at >= t);
  }
  close() {
    for (const s of this.socks) s.ws.terminate();
    this.wss.close();
  }
}

const browsers = [];
const relayQuery = (brokers) => ({ extra: `norender&relay&brokers=${brokers.map((x) => encodeURIComponent(x.url)).join(',')}` });
async function player(brokers, settings) {
  const b = await launch();
  browsers.push(b);
  const page = await open(b, { query: relayQuery(brokers), storage: { 'mossbound.settings.v1': settings } });
  page.browser_ = b;
  return page;
}
/** Reload a page and wait for the game to be up again. */
const reload = async (p) => {
  await p.reload({ waitUntil: 'networkidle0' });
  await waitFor(() => p.evaluate(() => !!window.__fb?.app?.current), 20000, 'boot after the reload');
};
/** Both in the same level session (one the host started after `notNonce`), playing, with the link up. */
const together = (host, guest, notNonce, ms = 30000) => waitFor(() => Promise.all([host, guest].map((p) => p.evaluate(() => {
  const s = window.__fbSession;
  return { n: s?.opts.nonce, level: s?.L.index, cp: s?.checkpoint, tied: !!s?.tether.tied, on: window.__fb.app.current === s && s?.state === 'play', link: window.__fb.flow.link?.status };
}))).then(([h, g]) => (h.on && g.on && h.n === g.n && h.n !== notNonce && h.link === 'connected' && g.link === 'connected' ? { h, g } : null)), ms, 'both back in the level').catch(() => null);
const PIP = { name: 'Pip', color: 2, hat: 'crown' };
const BO = { name: 'Bo', color: 3, hat: 'none' };
const linked = (...ps) => waitFor(() => Promise.all(ps.map((p) => p.evaluate(() => window.__fb.flow.link?.status === 'connected'))).then((v) => v.every(Boolean)), 30000, 'pairing over the local relay');
const playing = (p) => waitFor(() => p.evaluate(() => window.__fb.app.current === window.__fbSession && window.__fbSession?.state === 'play'), 30000, 'in the level');
const hearing = (host, guest) => waitFor(() => Promise.all([[host, 1], [guest, 0]].map(([p, i]) => p.evaluate((i) => window.__fbSession?.everHeard && window.__fbSession.birds[i].present && !window.__fbSession.frozen, i))).then((v) => v.every(Boolean)), 20000, 'both hear each other');
const partner = (p) => p.evaluate(() => { const q = window.__fb.flow.partner; return `${q.name || '?'}/${q.color}/${q.hat}`; });

/** A host and a guest in the first level, over these brokers. Returns their pages and the room code. */
async function pair(brokers) {
  const host = await player(brokers, { ...PIP, lastRoom: '', lastRole: 'host' });
  const guest = await player(brokers, BO);
  await host.evaluate(() => window.__fb.flow.online());
  await waitFor(() => host.evaluate(() => window.__fb.app.current?.constructor.name === 'OnlineScreen'), 5000, 'online screen');
  await host.evaluate(() => window.__fb.app.current.act('host'));
  const code = await waitFor(() => host.evaluate(() => window.__fb.flow.link?.code), 5000, 'code');
  await sleep(300);
  const tJoin = Date.now();
  await guest.evaluate((c) => window.__fb.flow.online({ joinCode: c }), code);
  await linked(host, guest);
  await waitFor(() => host.evaluate(() => window.__fb.app.current?.constructor.name === 'LevelSelect'), 15000, 'levels');
  await host.evaluate(() => window.__fb.flow.playLevel(0));
  await Promise.all([playing(host), playing(guest)]);
  await hearing(host, guest);
  return { host, guest, code, tJoin };
}

/** Every frame, on each screen: is the level frozen, and what does the link say? */
const record = (p) => p.evaluate(() => {
  const s = window.__fbSession;
  const tr = (window.__tr = []);
  const t0 = performance.now();
  const step = () => {
    tr.push([Math.round(performance.now() - t0), s.frozen ? 1 : 0, window.__fb.flow.link.status]);
    if (!window.__stopTr) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});
/** ms frozen in all, and when the level was last frozen, since recording began */
const frozenStats = (p) => p.evaluate(() => {
  window.__stopTr = 1;
  const tr = window.__tr;
  let frozen = 0;
  let last = 0;
  for (let i = 1; i < tr.length; i++) if (tr[i][1]) { frozen += tr[i][0] - tr[i - 1][0]; last = tr[i][0]; }
  return { frozen, last, statuses: [...new Set(tr.map((r) => r[2]))] };
});

// ---- a page reload, either side: nothing to press — the reloaded page goes back into the room by itself
// (a guest rejoins, the host reopens it), the pair is back in the level they were in, still tied, and
// both know who they're playing with again
{
  const broker = await new Broker().start();
  const { host, guest, code } = await pair([broker]);
  // tied together, at the first lantern
  await host.evaluate(() => { const s = window.__fbSession; s.tieVine(s.birds[0]); s.light(0, true); });
  await waitFor(() => guest.evaluate(() => window.__fbSession?.tether.tied && window.__fbSession.checkpoint === 0), 10000, 'tied on both, at the lantern');
  await sleep(1800);
  const n0 = await host.evaluate(() => window.__fbSession.opts.nonce);
  await reload(guest);
  const g = await together(host, guest, n0);
  await sleep(2500);
  const knowG = [await partner(host), await partner(guest)];
  t.check(`a guest whose page reloaded is back in the level by itself, at the lantern and still tied (${JSON.stringify(g)})`, !!g && g.h.level === 0 && g.g.cp === 0 && g.h.tied && g.g.tied, g);
  t.check(`…and both know each other again (host knows ${knowG[0]}, guest knows ${knowG[1]})`, knowG[0] === 'Bo/3/none' && knowG[1] === 'Pip/2/crown', knowG);
  const n1 = g?.h.n;
  await reload(host);
  const reopened = await waitFor(() => host.evaluate(() => { const l = window.__fb.flow.link; return l?.role === 'host' ? l.code : null; }), 10000, 'the room reopened').catch(() => null);
  const h = await together(host, guest, n1);
  await sleep(2500);
  const knowH = [await partner(host), await partner(guest)];
  t.check(`a host whose page reloaded reopens room ${reopened} by itself, and the pair is back in the level, still tied (${JSON.stringify(h)})`, reopened === code && !!h && h.h.level === 0 && h.h.cp === 0 && h.h.tied && h.g.tied, { reopened, h });
  t.check(`…and both know each other again (host knows ${knowH[0]}, guest knows ${knowH[1]})`, knowH[0] === 'Bo/3/none' && knowH[1] === 'Pip/2/crown', knowH);
  errors.push(...host.errors, ...guest.errors);
  for (const p of [host, guest]) await p.browser_.close();
  broker.close();
}

// ---- …but not after LEAVE ROOM, nor from a note too old to be this visit's, nor round and round (a
// page that went back into its room three times and never found the partner stays at the title)
{
  const broker = await new Broker().start();
  const p = await player([broker], BO);
  const at = () => p.evaluate(() => ({ screen: window.__fb.app.current?.constructor.name, room: window.__fb.flow.link?.code ?? null }));
  await p.evaluate(() => window.__fb.flow.online({ joinCode: 'K7QX' }));
  await waitFor(() => p.evaluate(() => window.__fb.flow.link?.code === 'K7QX'), 5000, 'in the room');
  await p.evaluate(() => window.__fb.flow.leaveOnline());
  await reload(p);
  const left = await at();
  const note = (more) => p.evaluate((more) => sessionStorage.setItem('mossbound.room', JSON.stringify({ code: 'K7QX', role: 'guest', at: Date.now(), tries: 0, ...more })), more);
  await note({ at: Date.now() - 11 * 60_000 });
  await reload(p);
  const old = await at();
  // a fresh note goes back — and every reload that goes back and never finds the partner is counted
  await note({});
  const runs = [];
  for (let i = 0; i < 4; i++) {
    await reload(p);
    runs.push({ ...(await at()), tries: await p.evaluate(() => JSON.parse(sessionStorage.getItem('mossbound.room') ?? 'null')?.tries ?? null) });
  }
  t.check(`no going back after LEAVE ROOM (${left.screen}) or from an 11-minute-old note (${old.screen}); a fresh one goes back three reloads running and no more (${runs.map((r) => r.room ?? r.screen).join(', ')})`, [left, old].every((x) => x.screen === 'TitleScreen' && !x.room) && runs.slice(0, 3).every((r, i) => r.room === 'K7QX' && r.screen === 'OnlineScreen' && r.tries === i + 1) && runs[3].screen === 'TitleScreen' && !runs[3].room, { left, old, runs });
  errors.push(...p.errors);
  await p.browser_.close();
  broker.close();
}

// ---- a Wi-Fi blip, and meanwhile a stale tab on the guest's device says hello with the room's code: the
// seat stays the guest's for their whole grace (the stale tab hears the room is full); the guest's own
// tab, reloaded during a blip (no goodbye gets out), still gets it back
{
  const broker = await new Broker().start();
  const { host, guest, code } = await pair([broker]);
  await guest.evaluate(() => { window.__fb.flow.link.muted = true; });
  await waitFor(() => host.evaluate(() => window.__fb.flow.link.status === 'reconnecting'), 10000, 'the host sees the blip');
  const stale = await open(guest.browser_, { query: relayQuery([broker]), storage: { 'mossbound.settings.v1': BO } });
  await stale.evaluate((c) => window.__fb.flow.online({ joinCode: c }), code);
  await sleep(7500);
  const seat = { host: await host.evaluate(() => window.__fb.flow.link.status), stale: await stale.evaluate(() => ({ status: window.__fb.flow.link?.status, detail: window.__fb.flow.link?.detail })) };
  t.check(`during the guest’s blip a stale tab can’t take their seat (host ${seat.host}; the stale tab: ${seat.stale.status}, “${seat.stale.detail}”)`, seat.host === 'reconnecting' && seat.stale.status === 'error' && /two sprouts/.test(seat.stale.detail ?? ''), seat);
  await stale.close();
  await guest.bringToFront();
  await guest.evaluate(() => { window.__fb.flow.link.muted = false; });
  const resumed = await linked(host, guest).then(() => true, () => false);
  // a blip again, and this time the guest's own tab reloads in the middle of it (a seat already lost to
  // the stale tab never sees that blip: the check below fails, and the scenarios after it still run)
  await guest.evaluate(() => { window.__fb.flow.link.muted = true; });
  const blip = await waitFor(() => host.evaluate(() => window.__fb.flow.link.status === 'reconnecting'), 10000, 'the host sees the second blip').then(() => true, () => false);
  const n0 = await host.evaluate(() => window.__fbSession?.opts.nonce);
  if (blip) await reload(guest);
  const back = blip ? await together(host, guest, n0) : null;
  t.check(`…the guest carries on after it (${resumed}), and their own tab, reloaded during a blip, gets the seat back (${!!back})`, resumed && !!back, back);
  errors.push(...host.errors, ...guest.errors, ...stale.errors);
  for (const p of [host, guest]) await p.browser_.close();
  broker.close();
}

// ---- a broker that asks every client to log in (as the public one on port 443 does) is logged in to, and
// the list the relay uses has a broker on 443 at all — the port strict networks leave open
{
  const broker = await new Broker().start();
  broker.login = { user: 'public', pass: 'public' };
  const b = await launch();
  browsers.push(b);
  const page = await open(b, { query: { extra: 'norender' } });
  const r = await page.evaluate(async (url) => {
    const { MqttClient } = await import('/src/net/mqtt.ts');
    const { BROKERS } = await import('/src/net/relay.ts');
    const up = async (login) => {
      const c = new MqttClient(url, undefined, login);
      c.connect();
      for (let i = 0; i < 40 && !c.connected; i++) await new Promise((res) => setTimeout(res, 50));
      const ok = c.connected;
      c.close();
      return ok;
    };
    const on443 = (BROKERS ?? []).filter((x) => { const u = new URL(x.url); return u.protocol === 'wss:' && (u.port === '' || u.port === '443'); });
    return { withLogin: await up({ user: 'public', pass: 'public' }), without: await up(undefined), on443: on443.map((x) => `${x.url} ${x.hz} Hz${x.login ? ' (login)' : ''}`) };
  }, broker.url);
  t.check(`a broker that wants a login is logged in to (${r.withLogin}; refused without: ${!r.without}), and the relay has one on port 443 (${r.on443.join(', ') || 'none'})`, r.withLogin && !r.without && r.on443.length >= 1, r);
  errors.push(...page.errors.filter((e) => !/WebSocket/.test(e)));
  await b.close();
  broker.close();
}

// ---- the relay socket goes silent for one player (and stays open): noticed and replaced in seconds
{
  const broker = await new Broker().start();
  const { host, guest, tJoin } = await pair([broker]);
  await Promise.all([record(host), record(guest)]);
  for (const s of broker.since(tJoin)) s.dead = true;
  // (the levels hold still 1.6 s into the silence; what counts is how soon they move again)
  await sleep(16000);
  const h = await frozenStats(host);
  const g = await frozenStats(guest);
  const replaced = broker.since(tJoin).filter((s) => !s.dead).length;
  t.check(`a relay socket that goes silent is replaced: moving again ${(Math.max(h.last, g.last) / 1000).toFixed(1)} s in (under 8), ${replaced} new socket(s)`, h.last < 8000 && g.last < 8000 && replaced >= 1, { h, g, replaced });
  errors.push(...host.errors, ...guest.errors);
  for (const p of [host, guest]) await p.browser_.close();
  broker.close();
}

// ---- two brokers, and the first goes silent for the guest: the bird stream moves to the other one, so
// neither level holds still for long, and the first one is back in use once it has been replaced
{
  const b1 = await new Broker().start();
  const b2 = await new Broker().start();
  const { host, guest, tJoin } = await pair([b1, b2]);
  await Promise.all([record(host), record(guest)]);
  for (const s of b1.since(tJoin)) s.dead = true;
  await sleep(12000);
  const h = await frozenStats(host);
  const g = await frozenStats(guest);
  t.check(`one of two brokers going silent: the levels hold still ${(h.frozen / 1000).toFixed(1)} s / ${(g.frozen / 1000).toFixed(1)} s in 12 s (under 2.5 each)`, h.frozen < 2500 && g.frozen < 2500, { h, g });
  errors.push(...host.errors, ...guest.errors);
  for (const p of [host, guest]) await p.browser_.close();
  b1.close();
  b2.close();
}

for (const b of browsers) await b.close().catch(() => undefined);
t.finish('local-relay', errors);
