import type { Room } from 'trystero';
import { settings } from '../core/settings';
import { GRACE_S, P2P_ONLY, RELAY_ONLY } from '../core/testmode';
import { APP_ID, PROTOCOL, randomId, type CtrlMsg, type Role, type SnapMsg } from './protocol';
import { Relay } from './relay';

export type LinkStatus = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'lost' | 'error';

/** How long a guest waits for the host to show up before giving up. */
const FIND_TIMEOUT_MS = 35_000;
/**
 * How long a guest keeps a hello of another version to itself before reporting it. Long enough for a
 * partner of its own version to turn up and pair (a stale tab of the players' own is the likeliest
 * stranger at a version bump), short enough that a pair who really are on different versions find
 * out. A host never reports it: their room stays open for whoever types the code.
 */
const MISMATCH_GRACE_MS = 6000;
const VERSION_MESSAGE = 'Your partner is running a different version of the game — reload both pages.';
/** How long a partner who went quiet (Wi-Fi blip, phone locked) has to come back. */
export const RECONNECT_GRACE_MS = GRACE_S ? GRACE_S * 1000 : 45_000;
/** Silence on every path for this long and the partner counts as away. */
const AWAY_MS = 2500;
/** 'room full' for this long while looking for a host: it really is full (see deliver) */
const FULL_MS = 5000;
/** A path we haven't heard from for this long isn't trusted for sending. */
const PATH_STALE_MS = 2500;
/**
 * Each side's clock counts from its own page load, so the two can sit any sensible distance apart —
 * but not years apart. A reply time implying that isn't a clock reading, and the shared clock it would
 * set moves the platforms both players are standing on.
 */
const MAX_SKEW_MS = 1e11;
/** Two samples this close agree: a step in the clocks that's really there is still there next ping. */
const STEP_AGREE_MS = 2000;
/** Snapshots dropped (not queued) once this many reliable sends are still in flight. */
const MAX_INFLIGHT = 4;
/** Stream id of the real-time channel both peers open on Trystero's connection (its own channel is auto-numbered from 0). */
const RT_ID = 77;
/** Never queue real-time packets behind a congested link: the next one supersedes them anyway. */
const RT_MAX_BUFFERED = 32 * 1024;

type Wire = CtrlMsg & { mid?: string };

let trystero: Promise<typeof import('trystero')> | null = null;

/** Start fetching the networking code before it's needed (online menu, invite link). */
export function preloadNet() {
  if (!trystero) {
    trystero = import('trystero');
    trystero.catch(() => (trystero = null));
  }
  return trystero;
}

/**
 * A two-player link, over two paths at once:
 *  - direct: peers find each other through public Nostr relays (Trystero), then talk over WebRTC —
 *    reliable messages on Trystero's channel, the 30 Hz bird stream on an unordered, no-retransmit
 *    channel so a lost packet never stalls the ones behind it;
 *  - relay: encrypted messages through public MQTT brokers over a WebSocket, for networks that block
 *    direct connections (it also finds the partner on its own).
 * Messages take the best healthy path; when the direct one falls silent the relay takes over without
 * either player noticing. A partner who drops gets a grace period to come back.
 */
export class NetLink {
  status: LinkStatus = 'connecting';
  detail = '';
  /** round trip to the partner over the path in use, ms (smoothed) */
  rtt = 0;
  /** the partner's link id once paired */
  peerId: string | null = null;
  onStatus: ((s: LinkStatus, detail: string) => void) | null = null;
  onCtrl: ((m: CtrlMsg) => void) | null = null;
  onSnap: ((m: SnapMsg) => void) | null = null;
  reconnectDeadline = 0;
  /** bumps when a different partner (e.g. the same person after a page reload) takes the seat */
  peerGen = 0;
  /** (tests) nothing leaves this side: simulates our network dying without touching the transports */
  muted = false;
  readonly myId = randomId();

  private room: Room | null = null;
  /** Trystero's id for the partner's peer connection */
  private tpeer: string | null = null;
  private cAct: ((m: Wire, target: string) => Promise<unknown>) | null = null;
  private sAct: ((m: SnapMsg, target: string) => Promise<unknown>) | null = null;
  private relay: Relay | null = null;
  private inflight = 0;
  private findTimer = 0;
  /** when a hello of another version was last heard (see the version notice in tick) */
  private mismatchAt = 0;
  private pingTimer = 0;
  private graceTimer = 0;
  private closed = false;
  private rt: RTCDataChannel | null = null;
  private rtPc: RTCPeerConnection | null = null;
  private rtReady = false;
  private rtProbe = 0;
  private lastDirect = 0;
  private lastRelay = 0;
  private midSeq = 0;
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  /** clock sync samples: [rtt, offset] (partner clock − ours) */
  private clock: [number, number][] = [];
  private offset = 0;
  private offsetTarget = 0;
  private offsetSet = false;
  /** a step in the clocks seen once and waiting to be confirmed by the next sample (NaN: none) */
  private stepSeen = NaN;
  private rttDirect = 0;
  private rttRelay = 0;
  /** the partner said goodbye (as opposed to going quiet): their traffic no longer brings them back */
  private gone = false;
  /** 'room full' replies while we look for a host: since when, and the latest */
  private fullSince = 0;
  private fullLast = 0;

  private constructor(
    readonly role: Role,
    readonly code: string,
  ) {}

  static open(role: Role, code: string) {
    const link = new NetLink(role, code);
    void link.start();
    return link;
  }

  /** (tests) A link that joins nothing — no room, no relay, no timers — for the parts that need no partner. */
  static bare(role: Role) {
    return new NetLink(role, 'TEST');
  }

  get connected() {
    return this.status === 'connected';
  }

  /** Which path carries traffic right now. */
  get via(): 'direct' | 'relay' | null {
    const now = performance.now();
    if (this.directHealthy(now)) return 'direct';
    if (this.relayHealthy(now)) return 'relay';
    return null;
  }

  /** Milliseconds on the host's clock (moving platforms and the shared level timer run on it). */
  sharedNow() {
    const now = performance.now();
    if (this.role === 'host') return now;
    // ease toward the latest estimate so platforms never jump
    if (this.offset !== this.offsetTarget) {
      const d = this.offsetTarget - this.offset;
      this.offset = Math.abs(d) > 250 ? this.offsetTarget : this.offset + Math.sign(d) * Math.min(Math.abs(d), 1);
    }
    return now + this.offset;
  }

  private setStatus(s: LinkStatus, detail = '') {
    if (this.closed && s !== 'lost') return;
    if (s === this.status && detail === this.detail) return;
    this.status = s;
    this.detail = detail;
    this.onStatus?.(s, detail);
  }

  private fail(detail: string) {
    this.setStatus('error', detail);
    this.close();
  }

  private async start() {
    this.setStatus('connecting');
    if (!P2P_ONLY) {
      this.relay = new Relay(this.code, this.myId);
      this.relay.onMessage = (kind, data, from) => this.recvRelay(kind, data, from);
      this.relay.onState = () => {
        if (this.relay?.up) this.sendHelloRelay();
      };
      void this.relay.start();
    }
    if (!RELAY_ONLY) await this.startDirect();
    if (this.closed) return;
    if (this.status === 'connecting') this.setStatus('waiting');
    if (this.role === 'guest') {
      this.findTimer = window.setTimeout(() => {
        if (!this.peerId) this.fail(this.mismatchAt ? VERSION_MESSAGE : `Nobody is hosting room ${this.code}. Check the code — it's on your partner's screen.`);
      }, FIND_TIMEOUT_MS);
    }
    this.pingTimer = window.setInterval(() => this.tick(), 1000);
    window.addEventListener('pagehide', this.onPageHide);
  }

  private async startDirect() {
    let joinRoom: typeof import('trystero').joinRoom;
    try {
      ({ joinRoom } = await preloadNet());
    } catch {
      this.detail = 'direct link unavailable';
      return;
    }
    if (this.closed) return;
    try {
      const turn = settings.turn.urls.trim();
      const turnConfig = turn
        ? [{ urls: turn.split(/[\s,]+/).filter(Boolean), username: settings.turn.username || undefined, credential: settings.turn.credential || undefined }]
        : undefined;
      const room = joinRoom({ appId: APP_ID, relayConfig: { warnOnRelayFailure: false }, ...(turnConfig ? { turnConfig } : {}) }, `room-${this.code}`, {
        onJoinError: () => {
          // WebRTC couldn't connect (strict NAT): the relay path carries the game instead
        },
      });
      this.room = room;
      const c = room.makeAction<Wire>('c');
      const s = room.makeAction<SnapMsg>('s');
      c.onMessage = (data, ctx) => this.recvDirect(data, ctx.peerId);
      s.onMessage = (data, ctx) => {
        if (ctx.peerId === this.tpeer) {
          this.lastDirect = performance.now();
          this.heard();
          this.onSnap?.(data);
        }
      };
      this.cAct = (m, target) => c.send(m, { target });
      this.sAct = (m, target) => s.send(m, { target });
      room.onPeerJoin = (id) => {
        if (!this.muted) void this.cAct?.(this.hello(), id).catch(() => undefined);
      };
      room.onPeerLeave = (id) => {
        if (id === this.tpeer) {
          // nothing more goes down a connection that's gone (until they're back, the relay carries it all)
          this.tpeer = null;
          this.closeRt();
          this.lastDirect = 0;
          this.checkAway();
        }
      };
    } catch (err) {
      console.error('[mossbound] direct link', err);
    }
  }

  private hello(ack = false): Wire {
    // (naming our partner while we're with them: a newcomer is told the room's taken. Once they've
    // dropped out the seat is open again — to them reloading, or to whoever takes it)
    const taken = this.peerId && this.status === 'connected' ? { with: this.peerId } : {};
    return { t: 'hello', v: PROTOCOL, role: this.role, id: this.myId, ...taken, ...(ack ? { ack: 1 as const } : {}) };
  }

  private sendHelloRelay() {
    if (this.muted) return;
    if (!this.peerId || this.status === 'reconnecting') void this.relay?.send('c', this.hello());
  }

  // ------------------------------------------------------------------ receiving

  private recvDirect(m: Wire, tpeer: string) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      this.acceptHello(m, (r) => void this.cAct?.(r, tpeer).catch(() => undefined), tpeer);
      return;
    }
    if (m.t === 'full' && !this.peerId) {
      this.deliver(m);
      return;
    }
    if (tpeer !== this.tpeer) return;
    this.lastDirect = performance.now();
    this.deliver(m);
  }

  private recvRelay(kind: string, data: unknown, from: string) {
    if (kind === 'c') {
      const m = data as Wire;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') {
        if (this.acceptHello(m, (r) => void this.relay?.send('c', r))) this.lastRelay = performance.now();
        return;
      }
      if (m.t === 'full' && !this.peerId) {
        this.deliver(m);
        return;
      }
      if (from !== this.peerId) return;
      this.lastRelay = performance.now();
      this.deliver(m);
    } else if (from === this.peerId) {
      this.lastRelay = performance.now();
      this.heard();
      if (kind === 's') this.onSnap?.(data as SnapMsg);
      else if (kind === 'p') this.recvPing(data, 'relay');
    }
  }

  /**
   * A hello from either path (`tpeer`: the direct connection it came over). Returns true when it's
   * from our partner.
   */
  private acceptHello(m: Wire & { t: 'hello' }, reply: (r: Wire) => void, tpeer?: string) {
    if (typeof m.id !== 'string' || m.id === this.myId) return false;
    // they're paired with someone else: the host of a full room greeting every newcomer, say. That's
    // no offer — it's the room telling us it's full (an old partner of ours reloading looks the same
    // for a moment, until the host lets the old connection go)
    if (typeof m.with === 'string' && m.with !== this.myId && m.id !== this.peerId) {
      if (!this.peerId) this.deliver({ t: 'full' });
      return false;
    }
    const answer = reply;
    reply = (r) => {
      if (!this.muted) answer(r);
    };
    if (this.peerId && this.peerId !== m.id) {
      // our partner reloaded the page (a new id) and the old one has gone quiet: welcome them back
      const quiet = performance.now() - Math.max(this.lastDirect, this.lastRelay);
      if (m.v === PROTOCOL && m.role !== this.role && (this.status === 'reconnecting' || this.status === 'lost' || quiet > AWAY_MS)) {
        this.replacePeer(m.id, tpeer);
      } else {
        reply({ t: 'full' });
        return false;
      }
    }
    if (m.v !== PROTOCOL) {
      // Not a reason to end a pairing that's working or still on its way: at a version bump the
      // likeliest stranger on the code is one of the players' own stale tabs, and ending the room on
      // its hello would be the new version refusing to let anyone play. Remember it instead — if no
      // partner of our own version turns up, tick() says what the trouble was.
      this.mismatchAt = performance.now();
      return false;
    }
    if (m.role === this.role) {
      // two hosts on one code (or two guests): not a valid pairing
      if (this.role === 'host' && !this.peerId && m.id < this.myId) this.fail('Someone else is hosting this room code. Make a new room and try again.');
      return false;
    }
    if (!m.ack) reply(this.hello(true));
    // (the direct path is known before anyone hears we're connected: what they send goes both ways)
    if (tpeer) this.useDirect(tpeer);
    if (!this.peerId) {
      this.peerId = m.id;
      window.clearTimeout(this.findTimer);
      this.setStatus('connected');
      this.tick();
    } else this.heard();
    return true;
  }

  /** The partner's direct connection (Trystero's peer id for it). */
  private useDirect(tpeer: string) {
    if (this.tpeer !== tpeer || !this.rt) {
      this.tpeer = tpeer;
      this.openRt();
    }
    this.lastDirect = performance.now();
  }

  /** A new partner takes the seat: forget everything about the old connection. */
  private replacePeer(id: string, tpeer?: string) {
    this.peerId = id;
    this.peerGen++;
    this.tpeer = null;
    this.closeRt();
    this.lastDirect = this.lastRelay = 0;
    this.clock.length = 0;
    this.offsetSet = false;
    this.rttDirect = this.rttRelay = 0;
    this.gone = false;
    window.clearTimeout(this.graceTimer);
    if (tpeer) this.useDirect(tpeer);
    this.status = 'connected';
    this.detail = '';
    this.onStatus?.('connected', '');
  }

  private deliver(m: Wire) {
    if (m.mid) {
      if (this.seen.has(m.mid)) return;
      this.seen.add(m.mid);
      this.seenOrder.push(m.mid);
      if (this.seenOrder.length > 512) this.seen.delete(this.seenOrder.shift()!);
    }
    if (m.t === 'full') {
      // a partner who just reloaded hears this too, until the host lets their old connection go
      // (a couple of seconds): only a room that stays full is really full
      if (this.peerId) return;
      const now = performance.now();
      if (!this.fullSince || now - this.fullLast > 3000) this.fullSince = now;
      this.fullLast = now;
      if (now - this.fullSince > FULL_MS) this.fail('That room already has two sprouts in it.');
      return;
    }
    if (m.t === 'bye') {
      this.gone = true;
      this.setStatus('lost', 'Your partner left.');
      return;
    }
    if (m.t === 'ping' || m.t === 'pong') {
      this.recvPing(m, 'direct');
      return;
    }
    this.heard();
    this.onCtrl?.(m);
  }

  // ------------------------------------------------------------------ pings, clock, health

  private tick() {
    if (this.closed || this.muted) return;
    const now = performance.now();
    if (!this.peerId) {
      // A guest typed a code and is owed an answer, so after the grace it hears what the trouble
      // was. A host may be waiting minutes for a partner to type that code: a stranger's version is
      // never a reason to close their room.
      if (this.role === 'guest' && this.mismatchAt && now - this.mismatchAt > MISMATCH_GRACE_MS) this.fail(VERSION_MESSAGE);
      else this.sendHelloRelay();
      return;
    }
    const ping = { t: 'ping' as const, a: now };
    // ping both paths: keeps the relay warm for a hand-over and measures each one
    const fast = this.fast();
    if (fast) {
      try {
        fast.send('C' + JSON.stringify(ping));
      } catch {
        // fine
      }
    } else if (this.tpeer) void this.cAct?.(ping, this.tpeer).catch(() => undefined);
    void this.relay?.send('p', ping);
    this.healRt();
    this.checkAway();
  }

  private recvPing(m: unknown, path: 'direct' | 'relay') {
    const p = m as { t: string; a: number; b?: number };
    if (!p || !Number.isFinite(p.a)) return;
    if (p.t === 'ping') {
      if (this.muted) return;
      const pong = { t: 'pong' as const, a: p.a, b: performance.now() };
      if (path === 'relay') void this.relay?.send('p', pong);
      else {
        const fast = this.fast();
        if (fast) {
          try {
            fast.send('C' + JSON.stringify(pong));
          } catch {
            // fine
          }
        } else if (this.tpeer) void this.cAct?.(pong, this.tpeer).catch(() => undefined);
      }
      return;
    }
    if (p.t !== 'pong' || !Number.isFinite(p.b)) return;
    const now = performance.now();
    const rtt = now - p.a;
    if (rtt < 0 || rtt > 10000) return;
    const off = (p.b as number) + rtt / 2 - now;
    // a reply time no clock could hold: not a sample, however healthy its round trip looks
    if (Math.abs(off) > MAX_SKEW_MS) return;
    if (path === 'direct') this.rttDirect = this.rttDirect ? this.rttDirect * 0.7 + rtt * 0.3 : rtt;
    else this.rttRelay = this.rttRelay ? this.rttRelay * 0.7 + rtt * 0.3 : rtt;
    this.rtt = this.via === 'relay' ? this.rttRelay : this.rttDirect || this.rttRelay;
    // a step in the clocks (a device slept with its clock stopped): the old samples are now wrong.
    // (an honest sample is off by at most half its round trip)
    if (this.clock.length && Math.abs(off - this.offsetTarget) > Math.max(250, rtt)) {
      // one sample is not enough to move everyone's platforms, though: a step that's really there is
      // still there on the next ping (a second later), where a single wild reading never comes back
      if (!(Math.abs(off - this.stepSeen) < Math.max(STEP_AGREE_MS, rtt))) {
        this.stepSeen = off;
        return;
      }
      this.clock.length = 0;
    }
    this.stepSeen = NaN;
    // NTP-style: the sample with the shortest round trip is the most accurate
    this.clock.push([rtt, off]);
    if (this.clock.length > 24) this.clock.shift();
    let best = this.clock[0];
    for (const c of this.clock) if (c[0] < best[0]) best = c;
    this.offsetTarget = best[1];
    if (!this.offsetSet) {
      this.offset = this.offsetTarget;
      this.offsetSet = true;
    }
  }

  private directHealthy(now: number) {
    return !!this.tpeer && now - this.lastDirect < PATH_STALE_MS;
  }

  private relayHealthy(now: number) {
    return !!this.relay?.up && now - this.lastRelay < PATH_STALE_MS + 1500;
  }

  private checkAway() {
    if (!this.peerId || this.closed || this.status === 'lost' || this.status === 'error') return;
    const now = performance.now();
    const quiet = now - Math.max(this.lastDirect, this.lastRelay);
    if (quiet > AWAY_MS && this.status === 'connected') {
      this.reconnectDeadline = now + RECONNECT_GRACE_MS;
      window.clearTimeout(this.graceTimer);
      this.graceTimer = window.setTimeout(() => {
        if (this.status === 'reconnecting') this.setStatus('lost', 'Your partner disconnected.');
      }, RECONNECT_GRACE_MS);
      this.setStatus('reconnecting');
      this.sendHelloRelay();
    }
  }

  /** Partner traffic: if we'd given up on them (silence — not a goodbye), they're back. */
  private heard() {
    if (this.status === 'reconnecting' || (this.status === 'lost' && !this.gone)) this.back();
  }

  private back() {
    window.clearTimeout(this.graceTimer);
    // their clock may have stepped while they were away (a sleeping phone): sync afresh
    this.clock.length = 0;
    this.setStatus('connected');
  }

  // ------------------------------------------------------------------ real-time channel

  /** Open the unordered, no-retransmit channel on the partner's connection (both sides do; it's pre-negotiated). */
  private openRt() {
    this.closeRt();
    const pc = this.tpeer ? this.room?.getPeers()[this.tpeer] : undefined;
    if (!pc?.createDataChannel) return;
    let ch: RTCDataChannel;
    try {
      ch = pc.createDataChannel('fb-rt', { negotiated: true, id: RT_ID, ordered: false, maxRetransmits: 0 });
    } catch {
      return; // stay on the reliable channel
    }
    this.rt = ch;
    this.rtPc = pc;
    ch.onmessage = (e) => this.recvRt(e.data);
    ch.onclose = () => {
      if (this.rt === ch) this.closeRt();
    };
    // knock until the partner's end answers; until then everything rides the reliable channel
    const knock = () => {
      if (this.rtReady || this.rt !== ch) window.clearInterval(this.rtProbe);
      else if (ch.readyState === 'open' && !this.muted) {
        try {
          ch.send('P');
        } catch {
          // the connection went away between the check and the send
        }
      }
    };
    ch.onopen = knock;
    this.rtProbe = window.setInterval(knock, 200);
  }

  /** Reopen the fast channel if it's gone or sits on a connection Trystero has since replaced. */
  private healRt() {
    if (!this.tpeer) return;
    const pc = this.room?.getPeers()[this.tpeer];
    if (pc && (!this.rt || this.rtPc !== pc)) this.openRt();
  }

  private closeRt() {
    window.clearInterval(this.rtProbe);
    const ch = this.rt;
    this.rt = null;
    this.rtPc = null;
    this.rtReady = false;
    if (ch) {
      ch.onmessage = ch.onclose = ch.onopen = null;
      try {
        ch.close();
      } catch {
        // already closed
      }
    }
  }

  private recvRt(data: unknown) {
    if (typeof data !== 'string' || !data) return;
    this.rtReady = true;
    this.lastDirect = performance.now();
    this.heard();
    const kind = data[0];
    if (kind === 'P') return;
    try {
      const m: unknown = JSON.parse(data.slice(1));
      if (kind === 'S') this.onSnap?.(m as SnapMsg);
      else if (kind === 'C') this.recvPing(m, 'direct');
    } catch {
      // a mangled packet is just a lost packet
    }
  }

  /** The real-time channel, when both ends are up and it isn't backed up. */
  private fast() {
    const ch = this.rt;
    return ch && this.rtReady && ch.readyState === 'open' && ch.bufferedAmount <= RT_MAX_BUFFERED ? ch : null;
  }

  // ------------------------------------------------------------------ sending

  /** A reliable message (lobby, gameplay events): over both paths, so either can carry it. */
  send(m: CtrlMsg) {
    if (!this.peerId || this.closed || this.muted) return;
    const w: Wire = { ...m, mid: `${this.myId.slice(0, 6)}${++this.midSeq}` };
    if (this.tpeer && this.cAct) void this.cAct(w, this.tpeer).catch(() => undefined);
    // and through the relay as well, always: a direct connection can die with messages in flight that
    // only the relay would still deliver (the receiver drops whichever copy comes second)
    void this.relay?.send('c', w);
  }

  /** One bird snapshot. Returns false when it was dropped (the next one supersedes it). */
  sendSnap(m: SnapMsg) {
    if (!this.peerId || this.closed || this.muted) return false;
    const now = performance.now();
    const fast = this.fast();
    if (fast && this.directHealthy(now)) {
      try {
        fast.send('S' + JSON.stringify(m));
        return true;
      } catch {
        // fall through
      }
    }
    if (this.relay?.up && (!this.directHealthy(now) || !fast)) {
      void this.relay.sendSnap(m);
      if (!this.tpeer) return true;
    }
    // direct link without the fast channel (yet): the reliable one, with a cap on what's in flight
    if (!this.tpeer || !this.sAct || this.inflight >= MAX_INFLIGHT) return false;
    this.inflight++;
    this.sAct(m, this.tpeer)
      .catch(() => undefined)
      .finally(() => this.inflight--);
    return true;
  }

  private readonly onPageHide = () => this.close();

  close() {
    if (this.closed) return;
    try {
      if (this.peerId && !this.muted) {
        const bye: Wire = { t: 'bye', mid: `${this.myId.slice(0, 6)}bye` };
        if (this.tpeer) void this.cAct?.(bye, this.tpeer).catch(() => undefined);
        void this.relay?.send('c', bye);
      }
    } catch {
      // ignore
    }
    this.closed = true;
    window.removeEventListener('pagehide', this.onPageHide);
    window.clearTimeout(this.findTimer);
    window.clearTimeout(this.graceTimer);
    window.clearInterval(this.pingTimer);
    this.closeRt();
    const room = this.room;
    const relay = this.relay;
    this.room = null;
    this.relay = null;
    setTimeout(() => {
      void room?.leave().catch(() => undefined);
      relay?.close();
    }, 200);
  }
}
