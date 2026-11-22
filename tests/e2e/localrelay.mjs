// Online play over a relay the test runs itself: a tiny MQTT-over-WebSocket broker on this machine
// (?relay&brokers=…), so every network fault is exact and every run the same — no public broker in the way.
//   · a partner whose page reloaded comes back (REJOIN / REOPEN ROOM) and both sides know each other's
//     name, colour and hat again;
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
        if (type === 1) ws.send(Buffer.from([0x20, 2, 0, 0]));
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
async function player(brokers, settings) {
  const b = await launch();
  browsers.push(b);
  const page = await open(b, { query: { extra: `norender&relay&brokers=${brokers.map((x) => encodeURIComponent(x.url)).join(',')}` }, storage: { 'mossbound.settings.v1': settings } });
  page.browser_ = b;
  return page;
}
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

// ---- a page reload and a rejoin, either side: both end up knowing who they're playing with again
{
  const broker = await new Broker().start();
  const { host, guest, code } = await pair([broker]);
  const first = [await partner(host), await partner(guest)];
  // the guest's page goes away and comes back (REJOIN ROOM)
  await guest.close();
  const guest2 = await player([broker], BO);
  await guest2.evaluate((c) => window.__fb.flow.online({ joinCode: c }), code);
  await playing(guest2);
  await sleep(2500);
  const afterGuest = [await partner(host), await partner(guest2)];
  t.check(`a guest whose page reloaded rejoins knowing the host again (host knows ${afterGuest[0]}, guest knows ${afterGuest[1]})`, afterGuest[0] === 'Bo/3/none' && afterGuest[1] === 'Pip/2/crown', { first, afterGuest });
  // the host's page goes away and comes back (REOPEN ROOM)
  await host.close();
  const host2 = await player([broker], { ...PIP, lastRoom: code, lastRole: 'host' });
  await host2.evaluate(() => window.__fb.flow.online());
  await waitFor(() => host2.evaluate(() => window.__fb.app.current?.constructor.name === 'OnlineScreen'), 5000, 'online screen');
  await host2.evaluate(() => window.__fb.app.current.act('rehost'));
  await linked(host2, guest2);
  await sleep(2500);
  const afterHost = [await partner(host2), await partner(guest2)];
  t.check(`a host whose page reloaded reopens the room knowing the guest again (host knows ${afterHost[0]}, guest knows ${afterHost[1]})`, afterHost[0] === 'Bo/3/none' && afterHost[1] === 'Pip/2/crown', afterHost);
  errors.push(...host.errors, ...guest.errors, ...guest2.errors, ...host2.errors);
  for (const p of [guest2, host2]) await p.browser_.close();
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
