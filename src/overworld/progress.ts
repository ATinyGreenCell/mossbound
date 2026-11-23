/**
 * The journal (core/save.ts), as the map reads it: by level id.
 *
 * The journal keeps everything by id already — best seeds, fireflies, best time, clears, each level's
 * run — except how far a player has unlocked, which before the map was a count along the five levels
 * there were (`unlocked`, see LEGACY_LEVELS). That count still counts: every level before it opens the
 * way on, as if it were cleared (`passed`), so nobody loses a level that was open to them. The journal
 * keeps writing the count too (recordClear), for the builds before the map, which read nothing else.
 */
import { LEGACY_LEVELS, save } from '../core/save';
import { LEVELS } from '../game/levels';
import type { MapProgress } from './layout';

export function mapProgress(): MapProgress {
  const cleared = new Set<string>();
  const passed = new Set<string>();
  const fireflies: Record<string, number> = {};
  const best: Record<string, number> = {};
  const lantern: Record<string, number> = {};
  const withWhom: Record<string, string> = {};
  LEGACY_LEVELS.forEach((id, i) => {
    if (i < save.unlocked) passed.add(id);
  });
  LEVELS.forEach((L) => {
    const r = save.levels[L.id];
    if (r?.clears) cleared.add(L.id);
    if (r?.feathers) fireflies[L.id] = r.feathers;
    if (r?.time) best[L.id] = r.time;
    const run = save.runs[L.id]?.run;
    if (run) lantern[L.id] = run.cp;
    if (run?.with) withWhom[L.id] = run.with;
  });
  return { cleared, passed, fireflies, best, lantern, with: withWhom };
}

/** Every level open (the debug ground's map: it plays any level, and records nothing). */
export function allOpen(): MapProgress {
  const p = mapProgress();
  return { ...p, passed: new Set(LEVELS.map((L) => L.id)) };
}

/**
 * The level played last — its run touched most recently, still going or finished (the journal's shared
 * clock, so it's the same on both devices after a merge). The map opens on it: CONTINUE.
 */
export function lastPlayed(): string | null {
  let id: string | null = null;
  let at = -1;
  for (const L of LEVELS) {
    const s = save.runs[L.id];
    if (s && s.at > at) {
      at = s.at;
      id = L.id;
    }
  }
  return id;
}
