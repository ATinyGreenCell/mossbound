/**
 * A new build, picked up by itself — with nothing lost on the way.
 *
 * Asked for on 2026-11-21: "any updates you push automatically apply to the current game instance
 * seamlessly and don't lose progress or kill the save file". The page asks the site's version.json
 * now and then, and whenever it comes back into view. When the site is serving another build, this
 * waits for a moment that costs nothing, stops the game where it is (`App.halt`), writes everything
 * down (flushSave), notes where the players were, and reloads. The reload asks for `?u=<version>`,
 * which tells the service worker to wait for the network however long it takes (see vite.config.ts),
 * so the reload IS the new build, and the new page puts the players back.
 *
 * A moment that costs nothing:
 *   - the title, the level select or the ending, on one screen — nothing in hand to lose;
 *   - the first moments of a level begun after the update was found, before anything is found in it:
 *     NEXT LEVEL or PLAY AGAIN off a clear card lands here, and so the update goes when the players
 *     leave their clear card — which they get to read first, however long they like;
 *   - in a level on one screen, the moment a lantern is lit: that IS where the level carries on
 *     from, so coming back to it gives up no ground at all. Not on an Xbox, though: Edge may hand the
 *     controllers back to its cursor on a reload ("Use game controls" again), and the middle of a
 *     level is the wrong place to find that out — there it waits for the start of the next level, or
 *     the level select.
 * Never:
 *   - in an online room, which a reload would drop the partner out of: it waits until the room is left
 *     (the badge says so), or the partner is gone for good — then the room's note opens the same code
 *     again on the new page, for whenever they're back (see roomMoment, Flow.noteRoom);
 *   - for an older build than this one: a site serving one (a release taken back, an edge running
 *     behind) isn't an update (see newerThan);
 *   - on the practice ground or the debug ground, in a lobby still taking seats, or in Settings;
 *   - when this browser keeps nothing for the site (storage blocked or full): the journal then lives
 *     only in the page, and a reload would take everything played with it. The badge says so.
 *
 * The level comes back from the journal (resumeOf), which the old page wrote last, as it went away —
 * not from the note, which only says which screen and which seats. So whatever reached the journal
 * comes back, and a level whose map the update changed gets its lantern back but not the old map's
 * seeds (see resumeOf). The test course keeps no run: it comes back from the note.
 */
import type { App } from './app';
import { canSave, flushSave, resumeOf } from './core/save';
import type { DeviceId } from './core/input';
import { IS_XBOX } from './core/platform';
import { tabRead, tabWrite } from './core/tab';
import { cleanResume, type Flow } from './flow';
import { COURSE_INDEX, LEVELS } from './game/levels';
import { Session } from './game/session';
import type { Resume } from './net/protocol';
import { EndingScreen, TitleScreen } from './ui/screens';
import { LevelSelect } from './ui/levelmap';

declare const __APP_VERSION__: string;
/** This build's version (package.json, stamped in by vite.config.ts). */
export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** sessionStorage: where to come back to, for the one reload that follows */
const BACK_KEY = 'mossbound.update.back';
/** sessionStorage: the build last reloaded for, how many times, and when (a stale cache can't loop us) */
const TRIED_KEY = 'mossbound.update.tried';
const POLL_MS = 90_000;
/** a version check that hasn't answered in this long has failed (a stalled connection never answers) */
const CHECK_TIMEOUT_MS = 10_000;
/** a note older than this is from some other visit (a tab restored a day later), not from this reload */
const BACK_FRESH_MS = 120_000;
/** a level played for less than this (and nothing found in it yet) has nothing in hand to lose */
const JUST_STARTED_S = 3;
/** the address parameter that marks the reload as an update's (see vite.config.ts: it waits for the network) */
const UPDATE_PARAM = 'u';

type Seats = [DeviceId, DeviceId];
type Back =
  | { to: 'title' }
  | { to: 'levels'; seats: Seats }
  /** `resume`: where it stood (the course's only record; older builds read it too); `fresh`: a new start of the level */
  | { to: 'level'; level: number; id: string; resume: Resume; seats: Seats; fresh?: boolean }
  /** an online room the partner had left for good: the room's own note (see Flow.noteRoom) opens it again */
  | { to: 'room' };

// (the note and the reload guard are this tab's alone, and outlive the reload they're for — in the
// tab's own name when the browser refuses the site sessionStorage: see core/tab.ts)
const read = tabRead;
const write = tabWrite;

/**
 * Is `v` a later build than `than`? Only ever forward: a site serving an older build (a release taken
 * back, a CDN edge running behind) is never reason to reload into it. Versions are x.y.z, compared
 * part by part as numbers (1.10.0 is after 1.9.1); a build that isn't one (an unstamped dev build) is
 * behind any that is.
 */
export function newerThan(v: string, than: string) {
  const a = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!a) return false;
  const b = /^(\d+)\.(\d+)\.(\d+)$/.exec(than);
  if (!b) return true;
  for (let i = 1; i <= 3; i++) if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  return false;
}

const isSeat = (s: unknown): s is DeviceId => typeof s === 'string' && /^(keys|keysL|keysR|pad\d)$/.test(s);
const seatsOf = (v: unknown): Seats | null => (Array.isArray(v) && v.length === 2 && isSeat(v[0]) && isSeat(v[1]) ? [v[0], v[1]] : null);

/** A level that has only just begun, with nothing found in it yet: NEXT LEVEL / PLAY AGAIN just landed here. */
function justStarted(s: Session) {
  const r = s.opts.resume;
  if (s.time - (r?.time ?? 0) > JUST_STARTED_S || s.checkpoint !== (r?.cp ?? -1)) return false;
  let seeds = 0;
  for (const v of s.seedTaken) seeds += v;
  let grown = 0;
  for (const v of s.world.grown) grown += v;
  return seeds === (r?.seeds.length ?? 0) && grown === (r?.grown?.length ?? 0) && s.feathers === (r?.feathers ?? 0);
}

/** What the update watches: the screen it was found on, and the level (and its lantern) it then sat in. */
type Watch = { on: unknown; s: Session | null; cp: number };

/**
 * Is now a moment the update costs nothing — and if so, where do the players come back to?
 * `lit` remembers the level being watched and the lantern it was at when the update was found.
 */
function moment(app: App, flow: Flow, lit: Watch): Back | null {
  if (flow.link) return roomMoment(app, flow);
  // nothing is kept for this site: a reload would take everything played this session with it
  if (!canSave()) return null;
  const cur = app.next;
  if (cur instanceof TitleScreen || cur instanceof EndingScreen) return { to: 'title' };
  const seats: Seats = [flow.seats[0], flow.seats[1]];
  if (cur instanceof LevelSelect) return { to: 'levels', seats };
  if (!(cur instanceof Session) || cur.online || cur.solo) return null;
  // the clear card is theirs to read: the update goes when they leave it (the level select, or the start
  // of whatever they pick next — both of which are moments of their own)
  if (cur.state === 'clear') return null;
  const here = () => ({ to: 'level' as const, level: cur.L.index, id: cur.L.def.id, resume: cur.resumeState(), seats });
  // a level begun since the update was found (NEXT LEVEL off a clear card), with nothing in it yet
  if (cur !== lit.on && cur.state === 'play' && justStarted(cur)) return { ...here(), fresh: !cur.opts.resume };
  if (IS_XBOX) return null;
  if (lit.s !== cur) {
    lit.s = cur;
    lit.cp = cur.checkpoint;
    return null;
  }
  if (cur.checkpoint === lit.cp || cur.checkpoint < 0) return null;
  return here();
}

/**
 * In an online room: never while the partner is in it, or may yet be back from a blip — the reload
 * would drop them out of it. Once they have gone for good (they left, or their grace ran out) the room
 * is only waiting, and the reload costs nothing: the room's note (Flow.noteRoom) opens the same code
 * again on the new page, as host or guest, for whenever they come back. Not over their clear card,
 * nor mid-level on an Xbox (see moment) — the level select comes soon enough — and never unless the
 * note was kept, or the reload would close the room for good.
 */
function roomMoment(app: App, flow: Flow): Back | null {
  if (flow.link?.status !== 'lost' || !canSave()) return null;
  const cur = app.next;
  const quiet = cur instanceof LevelSelect || cur instanceof EndingScreen || (cur instanceof Session && cur.online && cur.state !== 'clear' && !IS_XBOX);
  if (!quiet || !flow.noteRoom()) return null;
  return { to: 'room' };
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
function badge(app: App, flow: Flow) {
  const show = !(app.next instanceof Session) || !!app.ui.querySelector('.overlay');
  let el = app.ui.querySelector<HTMLDivElement>('.version-badge');
  if (!show) {
    el?.remove();
    return;
  }
  let text = `v${VERSION}`;
  if (import.meta.env.DEV && !seen.site && !seen.want) text += ' · dev';
  // (nothing is kept for this site, so it won't reload by itself: say what reloading would cost)
  else if (seen.want && !canSave()) text += ` · v${seen.want} is out — reloading would lose this session`;
  // (an online room waits for the room to end — or for the partner to be gone for good: see roomMoment)
  else if (seen.want && flow.link && flow.link.status !== 'lost') text += ` · v${seen.want} is out — it updates when the room ends`;
  else if (seen.want) text += ` · v${seen.want} is out — loading it`;
  // (a site behind this build — a release taken back, an edge running late — has nothing newer to offer)
  else if (seen.site && !newerThan(seen.site, VERSION)) text += ' · latest ✓';
  else if (seen.site) text += ` · v${seen.site} is out — reload to get it`;
  else if (seen.failed) text += " · offline — can't check";
  else text += ' · checking…';
  if (!el) {
    el = document.createElement('div');
    el.className = 'version-badge';
    app.ui.appendChild(el);
  }
  el.classList.toggle('stale', !!seen.site && newerThan(seen.site, VERSION));
  if (el.textContent !== text) el.textContent = text;
}

async function siteVersion(): Promise<string | null> {
  try {
    const res = await fetch(new URL('version.json', document.baseURI).href, { cache: 'no-store', signal: timeout(CHECK_TIMEOUT_MS) });
    if (!res.ok) return null;
    const v = ((await res.json()) as { version?: unknown })?.version;
    return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function timeout(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) return AbortSignal.timeout(ms);
  if (typeof AbortController === 'undefined') return undefined;
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** This page's address, asking for build `v` (the service worker waits for the network for it). */
function updateUrl(v: string) {
  const u = new URL(location.href);
  u.searchParams.set(UPDATE_PARAM, v);
  return u.href;
}

/** Keep an eye on the site for a newer build, and take it at the first moment that costs nothing. */
export function watchUpdates(app: App, flow: Flow) {
  let want: string | null = null;
  let timer = 0;
  const lit: Watch = { on: null, s: null, cp: -1 };
  /** how long the new page may take before this try is given up (tests shorten it) */
  let giveUpMs = 20_000;
  const tryNow = () => {
    if (!want) return;
    const back = moment(app, flow, lit);
    if (!back) {
      const inLevel = app.next instanceof Session && !(app.next as Session).online && !(app.next as Session).solo && canSave();
      pill(app, inLevel ? `<b>✦ a new version is ready</b><span>${IS_XBOX ? 'it loads when this level is done' : 'it loads at the next lantern'}</span>` : null);
      return;
    }
    // the guard against reloading for ever has to survive the reload, or it guards nothing
    const t = read(TRIED_KEY) as { v?: string; n?: number } | null;
    if (!write(TRIED_KEY, { v: want, n: t?.v === want ? (t.n ?? 0) + 1 : 1, at: Date.now() })) return;
    window.clearInterval(timer);
    // From here on nothing moves: the next page can take seconds to arrive on a slow network, and
    // anything done meanwhile would be done on a page that's about to go.
    app.halt();
    pill(app, null);
    pill(app, '<b>✦ loading the new version…</b>');
    // everything in hand goes into the journal first (a level hands over its run: see onFlush)
    flushSave();
    write(BACK_KEY, { from: VERSION, at: Date.now(), back });
    location.replace(updateUrl(want));
    // …and if the new page never comes (a network that takes the request and never answers), the game
    // can't stay frozen on "loading" for ever: give up on this try, cancel the navigation, carry on where
    // we were, and let a later look find the update again (the tries are counted: see tooSoon)
    window.setTimeout(() => {
      try {
        window.stop();
      } catch {
        // nothing to stop
      }
      write(BACK_KEY, null);
      pill(app, null);
      want = seen.want = null;
      app.resume();
      badge(app, flow);
    }, giveUpMs);
  };
  const found = (v: string) => {
    // (forward only: see newerThan)
    if (!newerThan(v, VERSION) || v === want || tooSoon(v)) return;
    want = seen.want = v;
    lit.on = app.next;
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
    badge(app, flow);
  };
  // the badge follows the screen (menus and cards show it, a level being played doesn't)
  window.setInterval(() => badge(app, flow), 500);
  badge(app, flow);
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
        giveUpAfter: (ms: number) => {
          giveUpMs = ms;
        },
        /** what a check of the site would have said (a version, or null for a failed check) */
        checked: (v: string | null) => {
          seen.failed = !v;
          if (v) {
            seen.site = v;
            found(v);
          }
          badge(app, flow);
        },
      },
    });
}

/** The update's mark on the address (`?u=`) has done its job by the time the page runs: take it off. */
function plainAddress() {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has(UPDATE_PARAM)) return;
    u.searchParams.delete(UPDATE_PARAM);
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  } catch {
    // an address that can't be rewritten keeps its mark: harmless
  }
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
  plainAddress();
  const note = read(BACK_KEY) as { from?: unknown; at?: unknown; back?: { to?: unknown; level?: unknown; id?: unknown; resume?: unknown; seats?: unknown; fresh?: unknown } } | null;
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
    if (b.to === 'level' && level === COURSE_INDEX) {
      // the test course keeps no run: the note is all there is of where it stood
      flow.playLevel(COURSE_INDEX, b.fresh === true ? undefined : cleanResume(b.resume));
      went = true;
    } else if (b.to === 'level' && Number.isInteger(level)) {
      // by its name rather than its place in the list, which an update may change (notes from 1.9.1 and
      // before carry only the place)
      const byId = typeof b.id === 'string' ? LEVELS.findIndex((L) => L.id === b.id) : -1;
      const i = byId >= 0 ? byId : typeof b.id === 'string' ? -1 : (level as number);
      if (i >= 0 && i < LEVELS.length) {
        // a fresh start (NEXT LEVEL / PLAY AGAIN had just landed there) starts fresh again; a run carries
        // on from the journal — the last thing the old page wrote — and if there's no run left to carry on
        // (it was finished), the level select it is
        if (b.fresh === true) flow.playLevel(i);
        else if (resumeOf(i)) flow.enterLevel(i);
        else flow.levels();
      } else flow.levels();
      went = true;
    } else if (b.to === 'levels') {
      flow.levels();
      went = true;
    }
  }
  // (an online room — `to: 'room'` — comes back through the room's own note, Flow.rejoinRoom, which
  // boot asks next: this only says the update has landed)
  const from = typeof note.from === 'string' ? note.from : '';
  const el = pill(app, `<b>✓ updated to ${VERSION}</b>${from ? `<span>from ${from.replace(/[^0-9.]/g, '')} · your progress is all here</span>` : ''}${IS_XBOX ? '<span>controllers not answering? hold ☰ → Use game controls</span>' : ''}`, 'update-toast');
  window.setTimeout(() => el?.remove(), IS_XBOX ? 9000 : 5000);
  return went;
}
