import { BROKERS_OVERRIDE } from '../core/testmode';
import { MqttClient } from './mqtt';

/**
 * Public MQTT brokers, best first. HiveMQ's carries a 30 Hz stream both ways without a hiccup; EMQX's
 * throttles above ~8 messages a second, so it's the backup path at a lower rate.
 */
const BROKERS: { url: string; hz: number }[] = [
  { url: 'wss://broker.hivemq.com:8884/mqtt', hz: 30 },
  { url: 'wss://broker.emqx.io:8084/mqtt', hz: 6 },
];

export type RelayKind = 'c' | 's' | 'p';

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
 * stream goes through the best broker only, at that broker's rate.
 */
export class Relay {
  onMessage: ((kind: RelayKind, data: unknown, from: string) => void) | null = null;
  onState: (() => void) | null = null;
  private clients: { mqtt: MqttClient; hz: number; lastSnap: number }[] = [];
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
    const list = BROKERS_OVERRIDE ? BROKERS_OVERRIDE.map((url, i) => ({ url, hz: i === 0 ? 30 : 6 })) : BROKERS;
    for (const b of list) {
      const mqtt = new MqttClient(b.url);
      mqtt.onMessage = (_t, payload) => void this.recv(payload);
      mqtt.onState = () => this.onState?.();
      mqtt.subscribe(this.topic);
      mqtt.connect();
      this.clients.push({ mqtt, hz: b.hz, lastSnap: 0 });
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

  private async recv(payload: Uint8Array) {
    if (!this.key || payload.length < 13) return;
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.slice(0, 12) }, this.key, payload.slice(12));
      const m = JSON.parse(dec.decode(plain)) as { f: string; k: RelayKind; q: number; d: unknown };
      if (!m || typeof m.f !== 'string' || m.f === this.myId) return;
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

  /** A snapshot through the best connected broker, if its rate allows one now. */
  async sendSnap(data: unknown) {
    if (!this.key) return false;
    const c = this.clients.find((x) => x.mqtt.connected);
    if (!c) return false;
    const now = performance.now();
    if (now - c.lastSnap < 1000 / c.hz - 2) return false;
    c.lastSnap = now;
    const p = await this.seal('s', data);
    return c.mqtt.publish(this.topic, p, true);
  }

  close() {
    this.closed = true;
    for (const c of this.clients) c.mqtt.close();
    this.clients.length = 0;
  }
}
