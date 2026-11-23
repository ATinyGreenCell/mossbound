/**
 * What this tab remembers across a reload of itself, and only itself: sessionStorage, which a reload
 * keeps and another tab never sees. Where a browser refuses the site sessionStorage, the tab's own name
 * stands in for it — it too outlives a reload and needs no storage — so a note (an update's way back,
 * the room to rejoin) and a guard (the update's count of tries) still survive the one reload they are
 * for. A guard that is forgotten at each reload guards nothing.
 */

const NAME_PREFIX = 'mossbound:';

function nameStore(): Record<string, unknown> {
  try {
    return window.name.startsWith(NAME_PREFIX) ? (JSON.parse(window.name.slice(NAME_PREFIX.length)) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** What this tab noted under `k` (null: nothing, or nothing readable). */
export function tabRead(k: string): unknown {
  try {
    const s = sessionStorage.getItem(k);
    return s ? JSON.parse(s) : null;
  } catch {
    return nameStore()[k] ?? null;
  }
}

/** Note `v` (null forgets it) for this tab, across a reload. False if there's nowhere to keep it. */
export function tabWrite(k: string, v: unknown): boolean {
  try {
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    try {
      const all = nameStore();
      if (v === null) delete all[k];
      else all[k] = v;
      window.name = Object.keys(all).length ? NAME_PREFIX + JSON.stringify(all) : '';
      return true;
    } catch {
      return false;
    }
  }
}

const TAB_KEY = 'mossbound.tab';
let tab = '';

/**
 * This tab's own id: the same after a reload of this tab, different in every other tab (a device id
 * kept in localStorage would be the same in all of them, and two tabs on one device are exactly what
 * it has to tell apart). Online, it's how a partner coming back from a reload proves they're the one
 * who had the seat (see NetLink.acceptHello). Where nothing at all can be kept, a new id each load:
 * such a tab never proves anything, which only costs it the head start a reload would have had.
 */
export function tabId(): string {
  if (tab) return tab;
  const kept = tabRead(TAB_KEY);
  if (typeof kept === 'string' && /^[0-9a-f]{16}$/.test(kept)) tab = kept;
  else {
    const b = new Uint8Array(8);
    crypto.getRandomValues(b);
    tab = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    tabWrite(TAB_KEY, tab);
  }
  return tab;
}
