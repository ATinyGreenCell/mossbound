/**
 * The debug ground: a way to go and try a mechanic on its own, alone, offline, on whatever device
 * happens to be to hand.
 *
 * It is deliberately NOT one of the `testmode.ts` switches. Those are stripped from production, and
 * stripping is exactly wrong here: the build worth poking at is the one that is live, on a phone,
 * which is where this game is actually played and where a mechanic that only misbehaves on a touch
 * screen will misbehave. So this ships — reached by a link nobody arrives at by accident
 * (…/mossbound/#debug), remembered for the rest of the tab, and never shown to anyone else.
 *
 * Nothing here is allowed to touch the save. A debug session runs on the practice rules: a partner
 * the game walks, no fireflies banked, no run kept, nothing unlocked.
 */
const KEY = 'mossbound.debug';

const hashAsks = () => typeof location !== 'undefined' && /(?:^|[#&])debug\b/.test(location.hash);

function remembered() {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false; // private window, blocked storage: the hash alone still works
  }
}

function remember() {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // nothing to do: this tab keeps it in memory instead
  }
}

let on = hashAsks() || remembered();
if (on) remember();

/** Is the debug ground reachable in this tab? */
export const debugOn = () => on;

/** Turn it on from inside the game (the title screen's own way in), for the rest of the tab. */
export function enableDebug() {
  on = true;
  remember();
}

export function disableDebug() {
  on = false;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // as above
  }
}

export type Speed = 1 | 0.5 | 0.25;

/**
 * What the debug ground is currently doing. Kept outside any one session so that stepping into a
 * different level doesn't quietly put the invulnerability back on or lose the slow motion.
 */
export const dbg = {
  /** nothing can hurt you */
  invuln: false,
  /** walk through walls, float free of gravity */
  noclip: false,
  /** draw the boxes everything is really made of, and what the creatures are thinking */
  boxes: false,
  /** how fast the world runs */
  speed: 1 as Speed,
  /** paused on a single frame; `stepOne` lets exactly one through */
  frozen: false,
  stepOne: false,
  /** tap the world to put your sprout there */
  teleport: false,
};

/** Reset everything to off — what the panel's own "all off" does, and what leaving debug does. */
export function dbgReset() {
  dbg.invuln = false;
  dbg.noclip = false;
  dbg.boxes = false;
  dbg.speed = 1;
  dbg.frozen = false;
  dbg.stepOne = false;
  dbg.teleport = false;
}
