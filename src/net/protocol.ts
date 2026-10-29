import type { Save } from '../core/save';

/**
 * Bump whenever messages change shape — and whenever the shared world changes, which is the same
 * contract by another route. Each screen builds the level from its own copy of the level data and
 * keeps it in step with the other by the clock alone; nothing about the world travels on the wire.
 * So two builds with different levels would pair happily and then disagree about everything in
 * them: a creature biting one player and not the other, a platform in two places at once. Peers
 * with different versions refuse to play, which is the only thing standing between a player whose
 * page is still open on the old build and a level that no longer exists.
 *
 * 5: creatures (beetles and snaptraps), and the five levels rebuilt around them.
 * 6: the vine is tied between the sprouts rather than always there, and the small one is taller.
 */
export const PROTOCOL = 6;
export const APP_ID = 'mossbound/coop/v1';

export type Role = 'host' | 'guest';

/** Where a continued level picks up (mirrors save.ts Run). */
/** Where a continued run picks up — and which fresh start of the level it belongs to (see save.ts). */
export type Resume = { cp: number; seeds: number[]; feathers: number; time: number; gen?: number; grown?: number[] };

export type Profile = {
  name: string;
  color: number;
  hat: string;
};

/** Messages on the reliable path (lobby, one-shot gameplay events, world sync). */
export type CtrlMsg =
  /** `ack` marks a reply, which is never answered (so two hellos can't ping-pong) */
  /** `with`: the partner the sender is already paired with (a hello naming someone else isn't an offer) */
  | { t: 'hello'; v: number; role: Role; id: string; with?: string; ack?: 1 }
  | { t: 'full' }
  | { t: 'bye' }
  | { t: 'profile'; p: Profile }
  /** the whole shared save, merged on arrival (see core/save.ts) */
  | { t: 'save'; s: Save }
  /**
   * Host commands carry `c`, a number that only grows: messages can take different paths (direct /
   * relay) and arrive out of order, and a stale command must never undo a newer one.
   */
  /** host: everyone into this level (`n` = level session nonce), optionally continuing a run; `kinds`: which sprout each bird is */
  | { t: 'load'; level: number; n: number; c: number; resume?: Resume; gen?: number; kinds?: string[] }
  /** host: which sprout each bird is now (bird 0 = host), shown in the lobby */
  | { t: 'kinds'; k: string[]; c: number }
  | { t: 'loaded'; n: number }
  /** host: back to the lobby / level select */
  | { t: 'lobby'; c: number }
  /** host picked this level in the lobby (guest mirrors the cursor) */
  | { t: 'pick'; level: number; c: number }
  /** host: the last level is done — everyone to the ending */
  | { t: 'end'; c: number }
  /** gameplay events for level session `n` */
  | { t: 'ev'; n: number; e: GameEvent }
  /** the collectables, checkpoint and grown plants as this side knows them (merged by union / max) */
  | { t: 'world'; n: number; seeds: number[]; feathers: number; cp: number; grown?: number[] }
  /** host: level cleared */
  | { t: 'clear'; n: number; time: number }
  /** clock sync: ping with sender time, pong echoes it plus the replier's time */
  | { t: 'ping'; a: number }
  | { t: 'pong'; a: number; b: number };

export type GameEvent =
  /** yank the receiver toward the sender */
  | { k: 'tug' }
  | { k: 'emote'; e: 'heart' | 'hey' }
  | { k: 'seed'; i: number }
  | { k: 'feather'; i: number }
  | { k: 'cp'; i: number }
  /** the sender bounced off the receiver's head */
  | { k: 'bounce' }
  /** the sender shot its vine over ring `i` (a peg index), or let go of the one it held */
  | { k: 'hook'; i: number }
  | { k: 'unhook' }
  /** the sender tied the vine between the two sprouts, standing next to the receiver — or untied it */
  | { k: 'tie' }
  | { k: 'untie' }
  /** the sender grew the plant in patch of soil `i` */
  | { k: 'grow'; i: number }
  /** pause-menu "regroup": both birds back to the checkpoint */
  | { k: 'regroup' };

// ------------------------------------------------------------------ bird snapshots (real-time path)

export const F_GROUND = 1;
export const F_ANCHOR = 2;
export const F_HANG = 4;
export const F_GHOST = 8;
export const F_GOAL = 16;
export const F_LEFT = 32;
export const F_FLUTTER = 64;
export const F_CLIMB_UP = 128;
export const F_CLIMB_DOWN = 256;
export const F_MENU = 512;
export const F_VENT = 1024;
export const F_STRAIN = 2048;
export const F_INVULN = 4096;
/** clinging to a wall (on the side it faces) */
export const F_CLING = 8192;
/** an air dash under way */
export const F_DASH = 16384;

/**
 * [seq, senderMs, x*10, y*10, vx, vy, flags, mover, relX*10, relY*10, levelNonce]
 * (mover = -1 when not standing on a moving platform)
 */
export type SnapMsg = number[];

export interface Snap {
  seq: number;
  /** sender's performance.now() when it was taken, ms */
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  flags: number;
  mover: number;
  rx: number;
  ry: number;
  n: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/**
 * Snapshots are counted up from one, about thirty a second — years of playing without reaching this.
 * A counter past it is a damaged build's, and taking it would make every honest one after it look
 * ancient (see RemoteFeed.push), leaving the partner's sprout stuck.
 */
const MAX_SEQ = 2 ** 31;

export function packSnap(s: Snap): SnapMsg {
  return [s.seq, Math.round(s.t), Math.round(s.x * 10), Math.round(s.y * 10), Math.round(s.vx), Math.round(s.vy), s.flags, s.mover, Math.round(s.rx * 10), Math.round(s.ry * 10), s.n];
}

/** A snapshot from the wire, or null for anything malformed (treated as a lost packet). */
export function unpackSnap(m: unknown): Snap | null {
  if (!Array.isArray(m) || m.length < 11) return null;
  for (let i = 0; i < 11; i++) if (!finite(m[i])) return null;
  const x = m[2] / 10;
  const y = m[3] / 10;
  if (Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return null;
  if (!Number.isInteger(m[0]) || m[0] < 0 || m[0] > MAX_SEQ) return null;
  return {
    seq: m[0],
    t: m[1],
    x,
    y,
    vx: Math.max(-5000, Math.min(5000, m[4])),
    vy: Math.max(-5000, Math.min(5000, m[5])),
    flags: m[6] | 0,
    mover: m[7] | 0,
    rx: m[8] / 10,
    ry: m[9] / 10,
    n: m[10] | 0,
  };
}

// ------------------------------------------------------------------ room codes

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Short, unambiguous room code (no 0/O or 1/I). */
export function makeRoomCode() {
  let s = '';
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  for (const n of buf) s += CODE_ALPHABET[n % CODE_ALPHABET.length];
  return s;
}

export function normalizeCode(raw: string) {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
}

export const isValidCode = (c: string) => c.length === 4 && [...c].every((ch) => CODE_ALPHABET.includes(ch));

export const randomId = () => {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};
