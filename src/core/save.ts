/**
 * The shared save ("the garden journal"). Both players keep a full copy; whenever they're connected the
 * copies are swapped and merged, so either device can pick the game back up — and nothing either of
 * you has ever earned can be lost by a merge:
 *   unlocked levels: max · feathers: OR (banked the moment they're found) · best seeds: max ·
 *   best time: min · clears: max
 *   runs in progress: every level keeps its own (lantern, seeds, feathers, time), so replaying one
 *   level never touches another's. Of two copies of one level's run, a later fresh start (`gen`) wins,
 *   then the copy with more changes recorded — counted on a clock the two devices share by merging
 *   (`clock`), never on their wall clocks, which can be hours apart.
 * Every write first merges whatever is already stored (another tab, an older build), so a stale copy
 * never overwrites newer progress; a stored copy this build can't read is set aside, never destroyed.
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
  /** the level's layout it was saved on (an update that changes the map moves the seeds) */
  sig: string;
};

/** One level's run. `run` is null once the level is finished: a marker, so an older copy can't bring it back. */
export type RunSlot = {
  /** fresh starts of this level so far: a newer start beats any copy of an older one */
  gen: number;
  /** `clock` when it last changed */
  at: number;
  run: Run | null;
};

export type Save = {
  v: 3;
  unlocked: number;
  levels: Record<string, LevelRecord>;
  finished: boolean;
  /** by level id */
  runs: Record<string, RunSlot>;
  /** one tick per change to a run; the larger of both copies after a merge */
  clock: number;
};

const KEY = 'mossbound.save.v3';
/** 1.0.0 kept a single run for the whole game */
const V2_KEY = 'mossbound.save.v2';
/** the last copy that loaded cleanly */
const BACKUP_KEY = 'mossbound.save.v3.backup';
/** a stored copy this build couldn't read: set aside, not overwritten */
const STASH_KEY = 'mossbound.save.v3.unreadable';
const PROBE_KEY = 'mossbound.probe';
const MAX_SEEDS = 2000;
/** the shared count: one tick per recorded change, and an exact integer all the way to the ceiling */
const MAX_CLOCK = Number.MAX_SAFE_INTEGER;
/** fresh starts of one level: beyond any amount of playing, and nowhere near the ceiling */
const MAX_GEN = 1e12;
/**
 * How far ahead of our own shared count another device's copy may be and still be believed. A lifetime
 * of playing is a few hundred thousand ticks; a copy a billion ahead was never counted — it's damaged
 * or made up, and taking it on would pin our count at its ceiling, losing the order of everything
 * after it (see `newer`).
 */
const CLOCK_LEAD = 1e9;

/** a number, from a number or a numeric string; out of range is clamped, anything else is `d` */
const num = (v: unknown, lo: number, hi: number, d = 0) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const int = (v: unknown, lo: number, hi: number, d = 0) => Math.floor(num(v, lo, hi, d));
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const record = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
/** at most `n` characters — never half an emoji */
const clip = (s: unknown, n: number) => {
  if (typeof s !== 'string') return '';
  const parts = graphemes ? Array.from(graphemes.segment(s), (g) => g.segment) : Array.from(s);
  return parts.slice(0, n).join('');
};

/** A short fingerprint of a level's map: an update that edits the map changes it. */
export function levelSig(index: number): string {
  const s = LEVELS[index]?.map.join('\n') ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** (every run is built here, so two equal runs always print the same — the merge's tie-break) */
function makeRun(r: Run): Run {
  return { cp: r.cp, seeds: [...r.seeds], feathers: r.feathers, time: r.time, with: r.with, sig: r.sig };
}

function cleanRun(raw: unknown): Run | null {
  const o = record(raw);
  if (!o) return null;
  const seeds = Array.isArray(o.seeds) ? [...new Set(o.seeds.filter((s): s is number => Number.isInteger(s) && s >= 0 && s < MAX_SEEDS))] : [];
  return makeRun({
    cp: int(o.cp, -1, 64, -1),
    seeds,
    feathers: int(o.feathers, 0, 7) & 7,
    time: num(o.time, 0, 360000),
    with: clip(o.with, 40),
    sig: typeof o.sig === 'string' ? o.sig.slice(0, 16) : '',
  });
}

function cleanSlot(raw: unknown): RunSlot | null {
  const o = record(raw);
  if (!o) return null;
  return { gen: int(o.gen, 0, MAX_GEN), at: int(o.at, 0, MAX_CLOCK), run: o.run === null ? null : cleanRun(o.run) };
}

/**
 * A save from storage, a save code or the partner — this version's or 1.0.0's — or null if it isn't
 * one. Never trusts its input, and keeps whatever part of a damaged copy still makes sense.
 */
export function cleanSave(raw: unknown): Save | null {
  const v = record(raw);
  if (!v) return null;
  const levels = record(v.levels);
  const runs = record(v.runs);
  // it has to look like a save, not just any object
  if (!levels && !runs && !own(v, 'unlocked')) return null;
  const s: Save = { v: 3, unlocked: int(v.unlocked, 0, LEVELS.length), levels: {}, finished: v.finished === true, runs: {}, clock: int(v.clock, 0, MAX_CLOCK) };
  LEVELS.forEach((L, i) => {
    const rec = levels && own(levels, L.id) ? record(levels[L.id]) : null;
    if (rec) {
      const r = { seeds: int(rec.seeds, 0, MAX_SEEDS), feathers: int(rec.feathers, 0, 7) & 7, time: num(rec.time, 0, 360000), clears: int(rec.clears, 0, 1e6) };
      s.levels[L.id] = r;
      // a finished level opens the next one, whatever the count says
      if (r.clears > 0) s.unlocked = Math.max(s.unlocked, Math.min(LEVELS.length, i + 1));
    }
    const slot = runs && own(runs, L.id) ? cleanSlot(runs[L.id]) : null;
    if (slot) s.runs[L.id] = slot;
  });
  // 1.0.0's one run, by level number: it becomes that level's (first) run
  if (!runs && record(v.run)) {
    const i = int((v.run as Record<string, unknown>).level, -1, LEVELS.length - 1, -1);
    const run = cleanRun(v.run);
    if (i >= 0 && run) s.runs[LEVELS[i].id] = { gen: 1, at: 1, run };
  }
  for (const slot of Object.values(s.runs)) s.clock = Math.max(s.clock, slot.at);
  return s;
}

/** Of two copies of one level's run, is `a` the one to keep? (The same answer on both devices.) */
function newer(a: RunSlot, b: RunSlot) {
  if (a.gen !== b.gen) return a.gen > b.gen;
  if (a.at !== b.at) return a.at > b.at;
  return JSON.stringify(a.run) > JSON.stringify(b.run);
}

/**
 * Merge `o` into `s`; true if `s` changed. `foreign`: it came from the partner or a pasted save code,
 * so its shared count has to look like one that was really counted (this device's own copies — storage,
 * the backup, another tab — are trusted).
 */
function mergeInto(s: Save, o: Save, foreign = false): boolean {
  const before = JSON.stringify(s);
  s.unlocked = Math.max(s.unlocked, o.unlocked);
  s.finished ||= o.finished;
  for (const [id, r] of Object.entries(o.levels)) {
    const m = s.levels[id] ?? { seeds: 0, feathers: 0, time: 0, clears: 0 };
    m.seeds = Math.max(m.seeds, r.seeds);
    m.feathers |= r.feathers;
    m.time = m.time && r.time ? Math.min(m.time, r.time) : m.time || r.time;
    m.clears = Math.max(m.clears, r.clears);
    s.levels[id] = m;
  }
  // Everything above can only add, so it's taken in whatever the copy says. What follows is ordered by
  // the shared count, and a count that was never counted is set aside rather than taken on: it would
  // otherwise decide every run from here on (and, pinned at the ceiling, decide them by nothing at all).
  const lead = foreign ? s.clock + CLOCK_LEAD : Infinity;
  for (const [id, slot] of Object.entries(o.runs)) {
    if (slot.at > lead) continue;
    const mine = s.runs[id];
    if (!mine || newer(slot, mine)) s.runs[id] = { gen: slot.gen, at: slot.at, run: slot.run && makeRun(slot.run) };
  }
  if (o.clock <= lead) s.clock = Math.max(s.clock, o.clock);
  return JSON.stringify(s) !== before;
}

// ------------------------------------------------------------------ storage

const empty = (): Save => ({ v: 3, unlocked: 0, levels: {}, finished: false, runs: {}, clock: 0 });

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse(raw: string | null): Save | null {
  if (!raw) return null;
  try {
    return cleanSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Keep a copy we couldn't read (the first one only): a later build may read it, nothing is lost. */
function stash(raw: string) {
  try {
    if (!localStorage.getItem(STASH_KEY)) localStorage.setItem(STASH_KEY, raw);
  } catch {
    // no room for it: it'll be overwritten, but the backup and the partner's copy remain
  }
}

let storageOk = true;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

function load(): Save {
  const s = empty();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    localStorage.setItem(PROBE_KEY, '1');
    localStorage.removeItem(PROBE_KEY);
  } catch {
    storageOk = false;
  }
  const cur = parse(raw);
  if (raw && !cur) stash(raw);
  // the backup and (the first time) 1.0.0's save can only add to it
  for (const o of [cur, parse(read(BACKUP_KEY)), cur ? null : parse(read(V2_KEY))]) if (o) mergeInto(s, o);
  if (storageOk && (cur || s.unlocked || Object.keys(s.levels).length || Object.keys(s.runs).length)) {
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(s));
    } catch {
      // full: the backup waits
    }
  }
  return s;
}

export const save: Save = load();

/** Can this browser keep the save? (False: blocked or full storage — progress lives only in this tab.) */
export const canSave = () => storageOk;

/** What we last wrote (a stored copy that differs came from someone else). */
let written = read(KEY) ?? '';
let pending = 0;

function write() {
  window.clearTimeout(pending);
  pending = 0;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && stored !== written) {
      // another tab (or an older build) wrote meanwhile: take in what it has before writing over it
      const theirs = parse(stored);
      if (!theirs) stash(stored);
      else if (mergeInto(save, theirs)) changed();
    }
    const json = JSON.stringify(save);
    if (json !== stored) localStorage.setItem(KEY, json);
    written = json;
    if (!storageOk) {
      storageOk = true;
      changed();
    }
  } catch {
    if (storageOk) {
      storageOk = false;
      changed();
    }
  }
}

/** Write to storage: now, or (`soon`) coalesced with other small changes a moment later. */
export function persist(soon = false) {
  if (!soon) write();
  else if (!pending) pending = window.setTimeout(write, 400);
}

const flushers = new Set<() => void>();

/** Something with unsaved progress (a level being played) to be asked first whenever the save is flushed. */
export function onFlush(f: () => void) {
  flushers.add(f);
  return () => flushers.delete(f);
}

/** Save everything now — the page is being hidden, closed or frozen (it may never run again). */
export function flushSave() {
  for (const f of flushers) {
    try {
      f();
    } catch {
      // the rest still saves
    }
  }
  if (pending) write();
}

/** The save changed under us (another tab wrote, or storage stopped working): `f` redraws what shows it. */
export function onSaveChange(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    const theirs = parse(e.newValue);
    if (theirs && mergeInto(save, theirs)) changed();
  });
  // (a phone may discard a hidden page without another word: everything goes to storage as it hides)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('freeze', flushSave);
}

let askedToKeep = false;

/** Ask the browser to spare our storage when it cleans up (once; the browser decides quietly, or asks). */
export function keepStorage() {
  if (askedToKeep) return;
  askedToKeep = true;
  try {
    const st = navigator.storage;
    if (st?.persist) void st.persisted().then((yes) => yes || st.persist()).catch(() => undefined);
  } catch {
    // not offered here
  }
}

// ------------------------------------------------------------------ progress

export function levelRecord(id: string): LevelRecord {
  return save.levels[id] ?? { seeds: 0, feathers: 0, time: 0, clears: 0 };
}

const tick = () => (save.clock = Math.min(MAX_CLOCK, save.clock + 1));

/** The run generation a fresh start of level `id` gets. */
export const freshGen = (id: string) => (save.runs[id]?.gen ?? 0) + 1;

/** Level `id`'s run in progress, if it has one. */
export function runSlot(id: string): RunSlot | null {
  const s = save.runs[id];
  return s?.run ? s : null;
}

/** The run touched last (for CONTINUE). */
export function latestRun(): { index: number; slot: RunSlot & { run: Run } } | null {
  let best: { index: number; slot: RunSlot & { run: Run } } | null = null;
  LEVELS.forEach((L, index) => {
    const slot = save.runs[L.id];
    if (slot?.run && (!best || slot.at > best.slot.at || (slot.at === best.slot.at && index > best.index))) best = { index, slot: slot as RunSlot & { run: Run } };
  });
  return best;
}

/** What continuing level `index` needs, or null when it has no run. (After an update that changed the map, the seeds start over.) */
export function resumeOf(index: number): { cp: number; seeds: number[]; feathers: number; time: number; gen: number } | null {
  const slot = runSlot(LEVELS[index]?.id ?? '');
  if (!slot?.run) return null;
  const r = slot.run;
  const same = !r.sig || r.sig === levelSig(index);
  return { cp: r.cp, seeds: same ? [...r.seeds] : [], feathers: same ? r.feathers : 0, time: r.time, gen: slot.gen };
}

/**
 * Where level `id`'s run (start number `gen`) has got to. `now`: write it at once (a lantern, a
 * feather) rather than with the next batch. A newer start of the same level (from the partner, or
 * another tab) is never overwritten by an older one.
 */
export function setRun(id: string, gen: number, run: Run, now = false) {
  const slot = save.runs[id];
  if (slot && slot.gen > gen) return false;
  save.runs[id] = { gen, at: tick(), run: makeRun({ ...run, with: clip(run.with, 40) }) };
  persist(!now);
  return true;
}

/** Feathers count the moment they're found — hats too — whether or not the level gets finished. */
export function bankFeathers(id: string, mask: number) {
  const r = levelRecord(id);
  if ((r.feathers | (mask & 7)) === r.feathers) return;
  r.feathers |= mask & 7;
  save.levels[id] = r;
  persist();
}

/** A level was finished: keep the best of everything, unlock the next one, and close its run. */
export function recordClear(id: string, index: number, seeds: number, feathers: number, time: number, gen = 0) {
  const r = levelRecord(id);
  r.seeds = Math.max(r.seeds, int(seeds, 0, MAX_SEEDS));
  r.feathers |= feathers & 7;
  // (a time that isn't one, garbled on the way, never replaces a real best)
  if (typeof time === 'number' && Number.isFinite(time) && time > 0) r.time = Math.min(r.time || Infinity, time, 360000);
  r.clears++;
  save.levels[id] = r;
  save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, index + 1));
  const slot = save.runs[id];
  // the run is over: a marker stays, so an older copy of it can't come back in a merge
  save.runs[id] = { gen: Math.max(gen, slot?.gen ?? 0), at: tick(), run: null };
  persist();
}

/**
 * Merge another copy in (the partner's, or a save code). Returns true when ours changed. Both sides
 * doing this with each other's copy ends with the same save on both devices.
 */
export function mergeSave(raw: unknown): boolean {
  const o = cleanSave(raw);
  if (!o) return false;
  const did = mergeInto(save, o, true);
  if (did) persist();
  return did;
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

/** Merge a pasted save code in (spaces and line breaks picked up on the way don't matter). Returns false if it isn't one. */
export function importCode(code: string) {
  const m = /MB1-([A-Za-z0-9_-]+)/.exec(code.replace(/[\s​-‍⁠﻿]+/g, ''));
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
