/**
 * A new build, picked up by itself — with nothing lost on the way.
 *
 * Asked for on 2026-11-21: "any updates you push automatically apply to the current game instance
 * seamlessly and don't lose progress or kill the save file". The page asks the site's version.json
 * now and then, and whenever it comes back into view. When the site is serving another build, this
 * waits for a moment that costs nothing, writes everything down (flushSave), notes where the players
 * were, and reloads. The service worker fetches index.html fresh whenever there is a network (see
 * vite.config.ts), so the reload IS the new build, and the new page puts the players back.
 *
 * A moment that costs nothing:
 *   - the title, the level select or the ending, on one screen — nothing in hand to lose;
 *   - a level's clear card: the clear is recorded, and it comes back to the level select;
 *   - in a level on one screen, the moment a lantern is lit: that IS where the level carries on
 *     from, so coming back to it gives up no ground at all. Not on an Xbox, though: Edge may hand the
 *     controllers back to its cursor on a reload ("Use game controls" again), and the middle of a
 *     level is the wrong place to find that out — there it waits for the clear card instead.
 * Never:
 *   - in an online room, which a reload would drop the partner out of: it waits until it is left;
 *   - on the practice ground or the debug ground, in a lobby still taking seats, or in Settings.
 *
 * The save is never what's at stake: it is the same localStorage before and after, written out just
 * before the reload and merged as always after it. An update changes the code, not the journal.
 */
import type { App } from './app';
import { flushSave } from './core/save';
import type { DeviceId } from './core/input';
import { IS_XBOX } from './core/platform';
import { cleanResume, type Flow } from './flow';
import { COURSE_INDEX, LEVELS } from './game/levels';
import { Session } from './game/session';
import type { Resume } from './net/protocol';
import { EndingScreen, LevelSelect, TitleScreen } from './ui/screens';

declare const __APP_VERSION__: string;
/** This build's version (package.json, stamped in by vite.config.ts). */
export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** sessionStorage: where to come back to, for the one reload that follows */
const BACK_KEY = 'mossbound.update.back';
/** sessionStorage: the build last reloaded for, how many times, and when (a stale cache can't loop us) */
const TRIED_KEY = 'mossbound.update.tried';
const POLL_MS = 90_000;
/** a note older than this is from some other visit (a tab restored a day later), not from this reload */
const BACK_FRESH_MS = 120_000;

type Seats = [DeviceId, DeviceId];
type Back = { to: 'title' } | { to: 'levels'; seats: Seats } | { to: 'level'; level: number; resume: Resume; seats: Seats };

const read = (k: string): unknown => {
  try {
    const s = sessionStorage.getItem(k);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, JSON.stringify(v));
  } catch {
    // private window or blocked storage: the update still happens, it just comes back to the title
  }
};

const isSeat = (s: unknown): s is DeviceId => typeof s === 'string' && /^(keys|keysL|keysR|pad\d)$/.test(s);
const seatsOf = (v: unknown): Seats | null => (Array.isArray(v) && v.length === 2 && isSeat(v[0]) && isSeat(v[1]) ? [v[0], v[1]] : null);

/**
 * Is now a moment the update costs nothing — and if so, where do the players come back to?
 * `lit` remembers the level being watched and the lantern it was at when the update was found.
 */
function moment(app: App, flow: Flow, lit: { s: Session | null; cp: number }): Back | null {
  // an online room, even one the partner has left for now: they would lose it
  if (flow.link) return null;
  const cur = app.next;
  if (cur instanceof TitleScreen || cur instanceof EndingScreen) return { to: 'title' };
  if (cur instanceof LevelSelect) return { to: 'levels', seats: [flow.seats[0], flow.seats[1]] };
  if (!(cur instanceof Session) || cur.online || cur.solo) return null;
  if (cur.state === 'clear') return { to: 'levels', seats: [flow.seats[0], flow.seats[1]] };
  if (IS_XBOX) return null;
  if (lit.s !== cur) {
    lit.s = cur;
    lit.cp = cur.checkpoint;
    return null;
  }
  if (cur.checkpoint === lit.cp || cur.checkpoint < 0) return null;
  return { to: 'level', level: cur.L.index, resume: cur.resumeState(), seats: [flow.seats[0], flow.seats[1]] };
}

/** Reloading for `v` again would be a loop: the site says it's there, but the reload keeps landing on this one. */
function tooSoon(v: string) {
  const t = read(TRIED_KEY) as { v?: string; n?: number; at?: number } | null;
  return !!t && t.v === v && (t.n ?? 0) >= 2 && Date.now() - (t.at ?? 0) < 15 * 60_000;
}

/** The little pill while an update waits in a level, and the note once it has landed. */
function pill(app: App, text: string | null, cls = 'update-pill') {
  let el = app.ui.querySelector<HTMLDivElement>(`.${cls}`);
  if (!text) {
    el?.remove();
    return null;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = cls;
    app.ui.appendChild(el);
  }
  if (el.innerHTML !== text) el.innerHTML = text;
  return el;
}

/** What the site last said, for the version badge: the stale guard the players can see. */
const seen = { site: null as string | null, failed: false, want: null as string | null };

/**
 * The corner of every menu (and the pause and clear cards, not the level itself): which build this
 * is, and whether it's the newest the site has — so whoever is holding the controller can tell at a
 * glance that the update they were told about has actually arrived.
 */
function badge(app: App) {
  const show = !(app.next instanceof Session) || !!app.ui.querySelector('.overlay');
  let el = app.ui.querySelector<HTMLDivElement>('.version-badge');
  if (!show) {
    el?.remove();
    return;
  }
  let text = `v${VERSION}`;
  if (import.meta.env.DEV && !seen.site && !seen.want) text += ' · dev';
  else if (seen.want) text += ` · v${seen.want} is out — loading it`;
  else if (seen.site === VERSION) text += ' · latest ✓';
  else if (seen.site) text += ` · v${seen.site} is out — reload to get it`;
  else if (seen.failed) text += " · offline — can't check";
  else text += ' · checking…';
  if (!el) {
    el = document.createElement('div');
    el.className = 'version-badge';
    app.ui.appendChild(el);
  }
  el.classList.toggle('stale', !!seen.site && seen.site !== VERSION);
  if (el.textContent !== text) el.textContent = text;
}

async function siteVersion(): Promise<string | null> {
  try {
    const res = await fetch(new URL('version.json', document.baseURI).href, { cache: 'no-store' });
    if (!res.ok) return null;
    const v = ((await res.json()) as { version?: unknown })?.version;
    return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Keep an eye on the site for a newer build, and take it at the first moment that costs nothing. */
export function watchUpdates(app: App, flow: Flow) {
  let want: string | null = null;
  let timer = 0;
  const lit = { s: null as Session | null, cp: -1 };
  const tryNow = () => {
    if (!want) return;
    const back = moment(app, flow, lit);
    if (!back) {
      const inLevel = app.next instanceof Session && !(app.next as Session).online && !(app.next as Session).solo;
      pill(app, inLevel ? `<b>✦ a new version is ready</b><span>${IS_XBOX ? 'it loads when this level is done' : 'it loads at the next lantern'}</span>` : null);
      return;
    }
    window.clearInterval(timer);
    pill(app, null);
    // everything in hand goes into the journal first (a level hands over its run: see onFlush)
    flushSave();
    write(BACK_KEY, { from: VERSION, at: Date.now(), back });
    const t = read(TRIED_KEY) as { v?: string; n?: number } | null;
    write(TRIED_KEY, { v: want, n: t?.v === want ? (t.n ?? 0) + 1 : 1, at: Date.now() });
    location.reload();
  };
  const found = (v: string) => {
    if (v === VERSION || v === want || tooSoon(v)) return;
    want = seen.want = v;
    lit.s = null;
    window.clearInterval(timer);
    timer = window.setInterval(tryNow, 400);
    tryNow();
  };
  const poll = async () => {
    if (document.visibilityState === 'hidden') return;
    const v = await siteVersion();
    seen.failed = !v;
    if (v) {
      seen.site = v;
      found(v);
    }
    badge(app);
  };
  // the badge follows the screen (menus and cards show it, a level being played doesn't)
  window.setInterval(() => badge(app), 500);
  badge(app);
  if (import.meta.env.PROD) {
    // a first look soon after boot, so the badge can say "latest" while the title is still up
    window.setTimeout(() => void poll(), 3_000);
    window.setInterval(() => void poll(), POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void poll();
    });
    window.addEventListener('online', () => void poll());
  }
  // (tests hand it a version, since the dev server has no version.json to find one in)
  if (import.meta.env.DEV)
    Object.assign(window, {
      __fbUpdate: {
        found,
        version: VERSION,
        /** what a check of the site would have said (a version, or null for a failed check) */
        checked: (v: string | null) => {
          seen.failed = !v;
          if (v) {
            seen.site = v;
            found(v);
          }
          badge(app);
        },
      },
    });
}

/**
 * The page has just reloaded for an update: put the players back where they were — the level from
 * its lantern, or the level select — rather than at the title. True if it did.
 *
 * The controllers come back too. A browser shows no gamepad to a freshly loaded page until a button
 * is pressed on it, and connecting is what moves a pad slot to its next generation — so each pad seat
 * is held for the generation its pad will arrive as, and the press that wakes a controller is already
 * its player's, with no "controller disconnected" to answer first.
 */
export function comeBack(app: App, flow: Flow): boolean {
  const note = read(BACK_KEY) as { from?: unknown; at?: unknown; back?: { to?: unknown; level?: unknown; resume?: unknown; seats?: unknown } } | null;
  write(BACK_KEY, null);
  if (VERSION === (read(TRIED_KEY) as { v?: string } | null)?.v) write(TRIED_KEY, null);
  if (!note || typeof note.at !== 'number' || Math.abs(Date.now() - note.at) > BACK_FRESH_MS || !note.back) return false;
  const b = note.back;
  const seats = seatsOf(b.seats);
  let went = false;
  if ((b.to === 'levels' || b.to === 'level') && seats) {
    flow.mode = 'local';
    flow.seats = seats;
    // (connecting is what moves a pad slot to its next generation, and at boot the slots haven't even
    // been polled into existence yet — so a pad that isn't here will turn up as the generation after
    // whatever its slot has now, which on a fresh page is none: generation 1)
    flow.seatGen = [0, 1].map((i) => {
      const d = app.input.device(seats[i]);
      if (!seats[i].startsWith('pad')) return d?.generation ?? 0;
      return d?.connected ? d.generation : (d?.generation ?? 0) + 1;
    }) as [number, number];
    const level = b.level;
    if (b.to === 'level' && Number.isInteger(level) && (level === COURSE_INDEX || ((level as number) >= 0 && (level as number) < LEVELS.length))) {
      flow.playLevel(level as number, cleanResume(b.resume));
      went = true;
    } else if (b.to === 'levels') {
      flow.levels();
      went = true;
    }
  }
  const from = typeof note.from === 'string' ? note.from : '';
  const el = pill(app, `<b>✓ updated to ${VERSION}</b>${from ? `<span>from ${from.replace(/[^0-9.]/g, '')} · your progress is all here</span>` : ''}${IS_XBOX ? '<span>controllers not answering? hold ☰ → Use game controls</span>' : ''}`, 'update-toast');
  window.setTimeout(() => el?.remove(), IS_XBOX ? 9000 : 5000);
  return went;
}
