import { BROKERS_OVERRIDE } from '../core/testmode';
import { MqttClient } from './mqtt';

/**
 * Public MQTT brokers, best first. HiveMQ's carries a 30 Hz stream both ways without a hiccup; EMQX's
 * throttles above ~8 messages a second, so it's the backup path at a lower rate. Both listen on ports
 * that strict networks (hotel and office Wi-Fi) often block, which leaves those players no path at all:
 * shiftr.io's public broker is on 443, the port such networks leave open for the web itself. Measured
 * from one client it carries 30 a second without loss; in the game's shape (two players, one topic,
 * 30 a second each) about one in six is dropped, when the two players' sends land at the same moment —
 * a usable stream all the same, and far more than EMQX's, so it comes second. It asks every client to
 * log in, with a public name and password (`login`).
 */
export const BROKERS: { url: string; hz: number; login?: { user: string; pass: string } }[] = [
  { url: 'wss://broker.hivemq.com:8884/mqtt', hz: 30 },
  { url: 'wss://public.cloud.shiftr.io', hz: 30, login: { user: 'public', pass: 'public' } },
  { url: 'wss://broker.emqx.io:8084/mqtt', hz: 6 },
];

export type RelayKind = 'c' | 's' | 'p';

/** A broker the partner has been heard through within this long (ms) is a live path for the bird stream. */
const LIVE_MS = 1500;
/** Even the live broker quiet this long (ms): the stream goes through the one heard from last as well. */
const SHAKY_MS = 400;
/** A connected broker that has brought nothing from anyone for this long (ms) while paired is asked if it's still there. */
const PROBE_AFTER_MS = 2000;
/** …but not more often than this (ms). */
const PROBE_EVERY_MS = 3000;

type Client = { mqtt: MqttClient; hz: number; lastSnap: number; heard: number; probed: number };

const enc = new TextEncoder();
const dec = new TextDecoder();

async function sha256Hex(s: string) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A fallback path between the two players through public MQTT brokers, for networks where a direct
 * WebRTC link can't be made (hotel Wi-Fi, some cellular carriers). Payloads are AES-GCM encrypted
 * with a key derived from the room code, so the broker only ever sees noise on an opaque topic.
 * Control messages go to every connected broker (the receiver drops duplicates); the snapshot
 * stream goes through the best broker the partner is being heard through, at that broker's rate.
 * A broker that stops bringing anything is asked whether it's still there (see check) rather than
 * trusted for the 25 s its keepalive would take to notice.
 */
export class Relay {
  onMessage: ((kind: RelayKind, data: unknown, from: string) => void) | null = null;
  onState: (() => void) | null = null;
  private clients: Client[] = [];
  private topic = '';
  private key: CryptoKey | null = null;
  private closed = false;
  private seq = 0;
  private seen = new Set<string>();
  private seenOrder: string[] = [];

  constructor(
    private readonly code: string,
    private readonly myId: string,
  ) {}

  async start() {
    try {
      this.topic = `mb1/${(await sha256Hex(`mossbound/${this.code}`)).slice(0, 24)}`;
      const base = await crypto.subtle.importKey('raw', enc.encode(`mossbound:${this.code}`), 'PBKDF2', false, ['deriveKey']);
      this.key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('mossbound-relay-v1'), iterations: 2000 },
        base,
        { name: 'AES-GCM', length: 128 },
        false,
        ['encrypt', 'decrypt'],
      );
    } catch {
      return; // no WebCrypto (insecure context): no relay
    }
    if (this.closed) return;
    const list: typeof BROKERS = BROKERS_OVERRIDE ? BROKERS_OVERRIDE.map((url, i) => ({ url, hz: i === 0 ? 30 : 6 })) : BROKERS;
    for (const b of list) {
      const mqtt = new MqttClient(b.url, undefined, b.login);
      const client: Client = { mqtt, hz: b.hz, lastSnap: 0, heard: 0, probed: 0 };
      mqtt.onMessage = (_t, payload) => void this.recv(payload, client);
      mqtt.onState = () => this.onState?.();
      mqtt.subscribe(this.topic);
      mqtt.connect();
      this.clients.push(client);
    }
  }

  /** Some broker is connected. */
  get up() {
    return this.clients.some((c) => c.mqtt.connected);
  }

  /** Snapshot rate the best connected broker allows (0 = none up). */
  get hz() {
    return this.clients.find((c) => c.mqtt.connected)?.hz ?? 0;
  }

  private async recv(payload: Uint8Array, client: Client) {
    if (!this.key || payload.length < 13) return;
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.slice(0, 12) }, this.key, payload.slice(12));
      const m = JSON.parse(dec.decode(plain)) as { f: string; k: RelayKind; q: number; d: unknown };
      if (!m || typeof m.f !== 'string' || m.f === this.myId) return;
      // (someone else heard through this broker — a copy that turns out to be a duplicate too: it's alive)
      client.heard = performance.now();
      // the same control message can arrive through two brokers
      const id = `${m.f}:${m.q}`;
      if (this.seen.has(id)) return;
      this.seen.add(id);
      this.seenOrder.push(id);
      if (this.seenOrder.length > 512) this.seen.delete(this.seenOrder.shift()!);
      this.onMessage?.(m.k, m.d, m.f);
    } catch {
      // someone else's traffic on a colliding topic, or a mangled packet: ignore
    }
  }

  private async seal(kind: RelayKind, data: unknown) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = enc.encode(JSON.stringify({ f: this.myId, k: kind, q: ++this.seq, d: data }));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key!, plain));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  }

  /** Control / ping messages: every connected broker. */
  async send(kind: 'c' | 'p', data: unknown) {
    if (!this.key || !this.up) return false;
    const p = await this.seal(kind, data);
    let ok = false;
    for (const c of this.clients) if (c.mqtt.connected && c.mqtt.publish(this.topic, p)) ok = true;
    return ok;
  }

  /**
   * A snapshot through the best broker the partner is being heard through (the list is best first) — and,
   * while even that one has gone quiet for a moment, through the one they were heard through last as well
   * (the receiver drops whichever copy comes second) — if their rates allow one now.
   */
  async sendSnap(data: unknown) {
    if (!this.key) return false;
    const live = this.clients.filter((x) => x.mqtt.connected);
    if (!live.length) return false;
    const now = performance.now();
    const last = live.reduce((a, c) => (c.heard > a.heard ? c : a));
    const best = live.find((c) => now - c.heard < LIVE_MS) ?? last;
    const to = (now - best.heard > SHAKY_MS && last !== best ? [best, last] : [best]).filter((c) => now - c.lastSnap >= 1000 / c.hz - 2);
    if (!to.length) return false;
    for (const c of to) c.lastSnap = now;
    const p = await this.seal('s', data);
    let ok = false;
    for (const c of to) if (c.mqtt.publish(this.topic, p, true)) ok = true;
    return ok;
  }

  /**
   * Paired, once a second: a connected broker that has brought nothing from anyone for a couple of seconds
   * — the partner pings through every broker every second — is asked whether it's still there (a socket
   * can die without closing: a phone changing networks, a NAT that forgot us). See MqttClient.probe.
   */
  check() {
    const now = performance.now();
    for (const c of this.clients) {
      if (!c.mqtt.connected || now - c.heard < PROBE_AFTER_MS || now - c.probed < PROBE_EVERY_MS) continue;
      c.probed = now;
      c.mqtt.probe();
    }
  }

  /** The network may have changed (back online, the page shown again, the partner gone quiet): check every broker now. */
  wake() {
    const now = performance.now();
    for (const c of this.clients) {
      c.probed = now;
      c.mqtt.probe();
    }
  }

  close() {
    this.closed = true;
    for (const c of this.clients) c.mqtt.close();
    this.clients.length = 0;
  }
}
