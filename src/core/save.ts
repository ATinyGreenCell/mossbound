/**
 * The shared save ("the nest book"). Both players keep a full copy; whenever they're connected the
 * copies are swapped and merged, so either device can pick the game back up — and nothing either of
 * you has ever earned can be lost by a merge:
 *   unlocked levels: max · feathers: OR · best seeds: max · best time: min · clears: max
 *   the run in progress (level, lantern, seeds, feathers): the most recently touched copy wins
 * A save code (copy / paste) moves it to a new device.
 */
import { LEVELS } from '../game/levels';

export type LevelRecord = {
  /** best seed count */
  seeds: number;
  /** golden feathers ever found, bitmask of 3 */
  feathers: number;
  /** best time in seconds (0 = never finished) */
  time: number;
  /** times finished */
  clears: number;
};

/** A level in progress, to continue from its last lantern. */
export type Run = {
  level: number;
  /** checkpoint index (-1 = the start) */
  cp: number;
  /** seed indices collected */
  seeds: number[];
  /** feathers collected this run (bitmask) */
  feathers: number;
  /** seconds played */
  time: number;
  /** who you were playing with (for the CONTINUE card) */
  with: string;
};

export type Save = {
  unlocked: number;
  levels: Record<string, LevelRecord>;
  finished: boolean;
  run: Run | null;
  /** when `run` last changed (ms since epoch) — the newer run wins a merge */
  runAt: number;
};

const KEY = 'mossbound.save.v2';
const OLD_KEY = 'mossbound.progress.v1';
/** records are kept for real levels only: a garbled (or hostile) copy can't crowd them out */
const LEVEL_IDS = new Set(LEVELS.map((L) => L.id));
const MAX_SEEDS = 2000;

const num = (v: unknown, lo: number, hi: number, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const int = (v: unknown, lo: number, hi: number, d = 0) => Math.floor(num(v, lo, hi, d));

function cleanRun(r: unknown): Run | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Partial<Run>;
  const level = int(o.level, -1, LEVELS.length - 1, -1);
  if (level < 0) return null;
  const seeds = Array.isArray(o.seeds) ? [...new Set(o.seeds.filter((s) => Number.isInteger(s) && s >= 0 && s < MAX_SEEDS))].slice(0, MAX_SEEDS) : [];
  return {
    level,
    cp: int(o.cp, -1, 64, -1),
    seeds,
    feathers: int(o.feathers, 0, 7) & 7,
    time: num(o.time, 0, 360000),
    with: typeof o.with === 'string' ? o.with.slice(0, 12) : '',
  };
}

/** A save from storage, a save code or the partner, or null if it isn't one. Never trusts its input. */
export function cleanSave(raw: unknown): Save | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<Save>;
  // it has to look like a save, not just any object
  if (typeof v.unlocked !== 'number' || !Number.isFinite(v.unlocked) || !v.levels || typeof v.levels !== 'object' || Array.isArray(v.levels)) return null;
  const s: Save = { unlocked: int(v.unlocked, 0, LEVELS.length), levels: {}, finished: v.finished === true, run: cleanRun(v.run), runAt: num(v.runAt, 0, 1e14) };
  if (v.levels && typeof v.levels === 'object') {
    for (const id of LEVEL_IDS) {
      const r = Object.prototype.hasOwnProperty.call(v.levels, id) ? (v.levels as Record<string, unknown>)[id] : null;
      if (!r || typeof r !== 'object') continue;
      const rec = r as Partial<LevelRecord>;
      s.levels[id] = { seeds: int(rec.seeds, 0, MAX_SEEDS), feathers: int(rec.feathers, 0, 7) & 7, time: num(rec.time, 0, 360000), clears: int(rec.clears, 0, 1e6) };
    }
  }
  return s;
}

function load(): Save {
  const empty: Save = { unlocked: 0, levels: {}, finished: false, run: null, runAt: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return cleanSave(JSON.parse(raw)) ?? empty;
    // an earlier version kept just progress
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const s = cleanSave(JSON.parse(old));
      if (s) {
        for (const r of Object.values(s.levels)) if (r.time > 0) r.clears = Math.max(1, r.clears);
        return s;
      }
    }
  } catch {
    // storage unavailable or corrupt: start fresh
  }
  return empty;
}

export const save: Save = load();

let persistTimer = 0;

/** Write to storage (now, or coalesced a moment later for frequent small changes). */
export function persist(soon = false) {
  const write = () => {
    persistTimer = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(save));
    } catch {
      // full or blocked: the partner still has a copy
    }
  };
  if (!soon) {
    window.clearTimeout(persistTimer);
    write();
  } else if (!persistTimer) persistTimer = window.setTimeout(write, 800);
}

export function levelRecord(id: string): LevelRecord {
  return save.levels[id] ?? { seeds: 0, feathers: 0, time: 0, clears: 0 };
}

/** A level was finished: keep the best of everything, unlock the next one, and close the run. */
export function recordClear(id: string, index: number, seeds: number, feathers: number, time: number) {
  const r = levelRecord(id);
  r.seeds = Math.max(r.seeds, seeds);
  r.feathers |= feathers & 7;
  r.time = r.time ? Math.min(r.time, time) : time;
  r.clears++;
  save.levels[id] = r;
  save.unlocked = Math.max(save.unlocked, index + 1);
  if (save.run && save.run.level === index) {
    save.run = null;
    save.runAt = Date.now();
  }
  persist();
}

/** The level being played changed (a lantern lit, a seed or feather picked up). */
export function setRun(run: Run) {
  save.run = run;
  save.runAt = Date.now();
  // feathers count for the hats right away, even before the level is finished
  persist(true);
}

/**
 * Merge another copy in. Returns true when ours changed. Both sides doing this with each other's
 * copy ends with the same save on both devices.
 */
export function mergeSave(raw: unknown): boolean {
  const o = cleanSave(raw);
  if (!o) return false;
  const before = JSON.stringify(save);
  save.unlocked = Math.max(save.unlocked, o.unlocked);
  save.finished ||= o.finished;
  for (const [id, r] of Object.entries(o.levels)) {
    const m = levelRecord(id);
    m.seeds = Math.max(m.seeds, r.seeds);
    m.feathers |= r.feathers;
    m.time = m.time && r.time ? Math.min(m.time, r.time) : m.time || r.time;
    m.clears = Math.max(m.clears, r.clears);
    save.levels[id] = m;
  }
  // the newer run wins; a dead heat is settled the same way on both devices, so the copies agree
  if (o.runAt > save.runAt || (o.runAt === save.runAt && JSON.stringify(o.run) > JSON.stringify(save.run))) {
    save.run = o.run;
    save.runAt = o.runAt;
  }
  const changed = JSON.stringify(save) !== before;
  if (changed) persist();
  return changed;
}

/** Are these two saves the same (so a merge round can stop)? */
export const sameSave = (a: unknown, b: unknown) => JSON.stringify(cleanSave(a)) === JSON.stringify(cleanSave(b));

/** Golden feathers found across all levels. */
export function featherCount() {
  let n = 0;
  for (const r of Object.values(save.levels)) for (let b = 0; b < 3; b++) if (r.feathers & (1 << b)) n++;
  return n;
}

// ------------------------------------------------------------------ save codes (moving to a new device)

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export function exportCode() {
  return `MB1-${b64(JSON.stringify(save))}`;
}

/** Merge a pasted save code in. Returns false if it isn't one. */
export function importCode(code: string) {
  const m = /MB1-([A-Za-z0-9_-]+)/.exec(code.trim());
  if (!m) return false;
  try {
    const s = cleanSave(JSON.parse(unb64(m[1])));
    if (!s) return false;
    mergeSave(s);
    persist();
    return true;
  } catch {
    return false;
  }
}
