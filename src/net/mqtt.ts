const enc = new TextEncoder();

const str = (s: string) => {
  const b = enc.encode(s);
  const out = new Uint8Array(b.length + 2);
  out[0] = b.length >> 8;
  out[1] = b.length & 255;
  out.set(b, 2);
  return out;
};

const varint = (n: number) => {
  const out: number[] = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    out.push(d);
  } while (n > 0);
  return out;
};

function packet(type: number, ...parts: (Uint8Array | number[])[]) {
  let len = 0;
  for (const p of parts) len += p.length;
  const head = [type, ...varint(len)];
  const out = new Uint8Array(head.length + len);
  out.set(head, 0);
  let o = head.length;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Real-time publishes are dropped (not queued) once the socket has this much unsent. */
const MAX_BUFFERED = 48 * 1024;

export interface MqttTiming {
  /** keepalive announced to the broker (s); we ping every third of it */
  keepalive: number;
  /** nothing at all heard for this long (ms): the socket is dead, even if nobody closed it */
  deadAfter: number;
  /** no CONNACK this long after opening (ms): give up on this attempt */
  connectTimeout: number;
}
const TIMING: MqttTiming = { keepalive: 30, deadAfter: 25000, connectTimeout: 10000 };

/**
 * The smallest useful MQTT 3.1.1 client, over a WebSocket: connect, subscribe, publish at QoS 0,
 * keepalive pings, and reconnection with backoff. Used to reach public brokers when a direct WebRTC
 * link between the two players can't be made. A socket can die without closing (a phone switching
 * networks, a NAT forgetting us): a watchdog drops it when the broker stops answering.
 */
export class MqttClient {
  connected = false;
  onMessage: ((topic: string, payload: Uint8Array) => void) | null = null;
  onState: ((up: boolean) => void) | null = null;
  private ws: WebSocket | null = null;
  private buf = new Uint8Array(0);
  private subs = new Set<string>();
  private pingTimer = 0;
  private retryTimer = 0;
  private backoff = 1000;
  private closed = false;
  private packetId = 1;
  private watchTimer = 0;
  /** when this socket was opened, and when it last brought us anything */
  private openedAt = 0;
  private lastRx = 0;

  constructor(
    readonly url: string,
    private readonly timing: MqttTiming = TIMING,
  ) {}

  connect() {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url, ['mqtt']);
    } catch {
      this.retry();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.buf = new Uint8Array(0);
    this.openedAt = this.lastRx = performance.now();
    ws.onopen = () => {
      const id = 'fb' + Math.random().toString(36).slice(2, 14);
      // protocol "MQTT" v4, clean session, keepalive
      ws.send(packet(0x10, str('MQTT'), [4, 2, 0, this.timing.keepalive], str(id)));
    };
    ws.onmessage = (e) => {
      this.lastRx = performance.now();
      this.recv(new Uint8Array(e.data as ArrayBuffer));
    };
    ws.onerror = () => undefined;
    ws.onclose = () => {
      if (this.ws === ws) this.drop();
    };
    window.clearInterval(this.watchTimer);
    this.watchTimer = window.setInterval(() => this.watch(), 1000);
  }

  /** A socket that went quiet (or never finished connecting) is dead: drop it and try again. */
  private watch() {
    const ws = this.ws;
    if (!ws) return;
    const now = performance.now();
    if (this.connected ? now - this.lastRx > this.timing.deadAfter : now - this.openedAt > this.timing.connectTimeout) {
      this.drop();
      try {
        ws.close();
      } catch {
        // already gone
      }
    }
  }

  /** The current socket is gone: tell the relay, and reconnect after a pause. */
  private drop() {
    this.ws = null;
    window.clearInterval(this.pingTimer);
    window.clearInterval(this.watchTimer);
    if (this.connected) {
      this.connected = false;
      this.onState?.(false);
    }
    this.retry();
  }

  private retry() {
    if (this.closed) return;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(15000, this.backoff * 2);
  }

  private recv(chunk: Uint8Array) {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    for (;;) {
      if (this.buf.length < 2) return;
      let len = 0;
      let mul = 1;
      let i = 1;
      let byte: number;
      do {
        if (i >= this.buf.length) return;
        byte = this.buf[i++];
        len += (byte & 127) * mul;
        mul *= 128;
      } while (byte & 128);
      if (this.buf.length < i + len) return;
      const type = this.buf[0] >> 4;
      const body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      this.handle(type, body);
    }
  }

  private handle(type: number, body: Uint8Array) {
    if (type === 2) {
      // CONNACK
      if (body[1] !== 0) {
        this.ws?.close();
        return;
      }
      this.connected = true;
      this.backoff = 1000;
      for (const t of this.subs) this.sendSub(t);
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.raw(new Uint8Array([0xc0, 0])), (this.timing.keepalive * 1000) / 3);
      this.onState?.(true);
    } else if (type === 3) {
      // PUBLISH (QoS 0: topic, then payload)
      const tl = (body[0] << 8) | body[1];
      const topic = new TextDecoder().decode(body.subarray(2, 2 + tl));
      this.onMessage?.(topic, body.subarray(2 + tl));
    }
  }

  private raw(p: Uint8Array) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(p);
      return true;
    } catch {
      return false;
    }
  }

  private sendSub(topic: string) {
    const id = this.packetId++ & 0xffff || 1;
    this.raw(packet(0x82, [id >> 8, id & 255], str(topic), [0]));
  }

  subscribe(topic: string) {
    this.subs.add(topic);
    if (this.connected) this.sendSub(topic);
  }

  /** Publish at QoS 0. Real-time payloads are dropped when the socket is backed up. */
  publish(topic: string, payload: Uint8Array, realtime = false) {
    if (!this.connected || !this.ws) return false;
    if (realtime && this.ws.bufferedAmount > MAX_BUFFERED) return false;
    return this.raw(packet(0x30, str(topic), payload));
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    window.clearInterval(this.watchTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(new Uint8Array([0xe0, 0]));
        ws.close();
      } catch {
        // already gone
      }
    }
    this.connected = false;
  }
}
