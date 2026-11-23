import { audio } from '../audio/audio';
import type { MenuInput } from '../core/input';
import { ceremony } from '../core/testmode';
import { warmGlyphs } from './glyphs';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** clicks this soon after a menu appears are the tail of the tap that opened it: ignored */
const CLICK_GUARD_MS = 350;

/**
 * How long a menu that appeared *without being asked for* ignores confirm and back (see `arm`). The
 * sprouts stop answering when a level clears, so players keep tapping Ⓐ — and an online guest tugs
 * with Ⓑ until the screen changes under them. Long enough that the press already under way doesn't
 * land on the new menu, short enough not to feel stuck.
 */
const UNASKED_ARM_MS = 900;

/**
 * How many polls an unasked menu ignores confirm for, whatever the clock says.
 *
 * `confirm` is an edge, produced by the poll that follows the button going down, so when a press
 * reaches a menu says little about when it was made: on a machine drawing one frame a second it is
 * reported up to a second late, and no window shorter than a frame can tell a tap already under way
 * from a considered answer. Polls can, because they are the same unit the press arrives in. Three of
 * them: the frame the menu was built in, in which nothing was drawn yet; the frame it first appears
 * in; and the frame the player has to react during. A press reported before the third cannot be an
 * answer to this menu — it had not been seen, or there had been no frame in which to respond.
 *
 * Where frames are short this is fifty milliseconds and UNASKED_ARM_MS is what the player feels.
 * Where they are long it is the only one of the two that still means anything.
 */
const UNASKED_ARM_POLLS = 3;

/**
 * A button marked `data-confirm` asks before it acts: its first press only says so, and a second press
 * of it within this long acts. Then it goes back to what it was — and so it does if the highlight moves
 * off it first. It is for LEAVE ROOM, which ends the game for both of you, and which a stray Ⓑ or Ⓐ
 * mustn't: every LEAVE ROOM carries it (the level select's, the guest's pause menu and clear card).
 */
const CONFIRM_MS = 3000;
/** what a `data-confirm` button says while it asks, unless the attribute says otherwise */
const CONFIRM_ASK = 'LEAVE? PRESS AGAIN';

interface Box {
  cx: number;
  cy: number;
  h: number;
}

const boxOf = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, h: r.height };
};

/**
 * A column (or row) of DOM buttons that keyboard, controller and touch can all drive: arrows / d-pad /
 * stick move the highlight, A / Enter / Space presses it, B / Esc backs out, and a tap or click
 * presses the button under it. Elements with `data-act` are the buttons; `.off` ones are skipped.
 * `sel` -1 highlights nothing (see disarm). Axis 'grid' is for cards laid out in rows (see gridStep).
 */
export class ButtonList {
  sel = 0;
  private born = performance.now();
  /** confirm / back (and taps) are ignored this long after `born` — see arm() */
  private armMs = 0;
  /** polls left before confirm counts, counted down in update() — see UNASKED_ARM_POLLS */
  private armPolls = 0;
  /** the button a pointer went down on (see onUp) */
  private down: HTMLElement | null = null;
  /** a press rescued on pointerup, whose own click may yet arrive: that click is the same press */
  private rescued: { act: string; at: number } | null = null;
  /** the button asking to be pressed again (see CONFIRM_MS), and until when */
  private asking: { act: string; until: number } | null = null;
  /**
   * 'grid': the column ↑/↓ are keeping to (where the run of ↑/↓ began), and the stop they left the
   * highlight on — so ↓ then ↑ comes back to the same card, rows of different lengths or not
   */
  private column: { x: number; sel: number } | null = null;
  private readonly onClick: (e: Event) => void;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onDown: (e: PointerEvent) => void;
  private readonly onUp: (e: PointerEvent) => void;

  constructor(
    private readonly root: HTMLElement,
    private readonly act: (action: string, el: HTMLElement) => void,
    private readonly back: (() => void) | null = null,
    private readonly axis: 'v' | 'h' | 'grid' = 'v',
  ) {
    const pressed = (el: HTMLElement) => {
      const i = this.items().indexOf(el);
      if (i >= 0) this.sel = i;
      this.highlight();
      this.press(el);
    };
    this.onClick = (e: Event) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || !root.contains(el) || el.classList.contains('off')) return;
      const r = this.rescued;
      this.rescued = null;
      if (r && r.act === el.dataset.act && performance.now() - r.at < 1000) return;
      if (this.guarded()) return;
      pressed(el);
    };
    // A screen rebuilt by news (the partner's save, their profile) between a button going down and
    // coming up replaces the button under the pointer, and a mouse's click needs both ends on the same
    // element: it was lost. The new button that the pointer comes up on, doing the same thing as the one
    // it went down on, is that press. (A touch's click still comes, from where the finger lifted: it is
    // the same press, and counts once.)
    this.onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      this.down = el && root.contains(el) ? el : null;
    };
    this.onUp = (e: PointerEvent) => {
      const was = this.down;
      this.down = null;
      if (!was || was.isConnected) return; // (the click comes as usual)
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || el.dataset.act !== was.dataset.act || !root.contains(el) || el.classList.contains('off') || this.guarded()) return;
      this.rescued = { act: el.dataset.act!, at: performance.now() };
      pressed(el);
    };
    // There is one highlight, and a mouse (or the Xbox browsing cursor) moves it like the arrows do:
    // otherwise a button under a resting pointer looks just as chosen as the highlighted one, and
    // ENTER / Ⓐ presses the other.
    this.onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || !root.contains(el) || el.classList.contains('off')) return;
      const i = this.items().indexOf(el);
      if (i < 0 || i === this.sel) return;
      this.sel = i;
      this.highlight();
    };
    root.addEventListener('click', this.onClick);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointerup', this.onUp);
    this.highlight();
    // (the first menu of the session: get the symbols the next ones show ready while nothing's happening)
    warmGlyphs();
  }

  items() {
    return [...this.root.querySelectorAll<HTMLElement>('[data-act]')].filter((el) => !el.classList.contains('off') && el.offsetParent !== null);
  }

  /** Still inside the guard on clicks — for a screen with click handlers of its own to honour too. */
  guarded() {
    return performance.now() - this.born < Math.max(CLICK_GUARD_MS, this.armMs);
  }

  /**
   * Call after rebuilding the buttons. A rebuild driven by news — the partner's save, their profile,
   * a connection blip — is not a new screen: it must not re-arm the guards, or a tap that lands just
   * after one is dropped, over and over.
   */
  refresh(keepSel = true, rearm = !keepSel) {
    if (!keepSel) this.sel = 0;
    if (rearm) { this.born = performance.now(); this.armPolls = this.armMs ? UNASKED_ARM_POLLS : 0; }
    this.highlight();
  }

  /**
   * Highlight nothing until a direction is pressed, so a stray Ⓐ / ENTER / SPACE does nothing: for
   * lists whose only button walks away (LEAVE ROOM, CANCEL) on a screen where players press Ⓐ by habit.
   */
  disarm() {
    this.sel = -1;
    this.highlight();
  }

  /**
   * Ignore confirm and back (and taps) for a moment — for a menu that appeared on its own rather than
   * because someone asked for it. Player-opened menus stay snappy and never call this.
   */
  arm(ms = UNASKED_ARM_MS) {
    this.armMs = ms / ceremony(1);
    this.born = performance.now();
    this.armPolls = UNASKED_ARM_POLLS;
    return this;
  }

  highlight() {
    const items = this.items();
    if (this.sel >= items.length) this.sel = Math.max(0, items.length - 1);
    this.root.querySelectorAll('.sel').forEach((el) => el.classList.remove('sel'));
    const on = items[this.sel];
    on?.classList.add('sel');
    // a button that was asking to be pressed again stops asking once the highlight moves off it (and
    // one built again by news keeps asking)
    if (this.asking && on?.dataset.act !== this.asking.act) this.asking = null;
    this.showAsking();
    // a card taller than the screen scrolls inside itself (a phone held sideways, a short window), and
    // a highlight below the fold would have you pressing a row you can't see
    on?.scrollIntoView?.({ block: 'nearest' });
  }

  /** Press the button that does `act` as if it were highlighted and Ⓐ pressed (for a Ⓑ that means it). */
  pressAct(act: string) {
    const items = this.items();
    const i = items.findIndex((el) => el.dataset.act === act);
    if (i < 0) return;
    this.sel = i;
    this.highlight();
    this.press(items[i]);
  }

  private press(el: HTMLElement) {
    const act = el.dataset.act!;
    if (el.dataset.confirm !== undefined && this.asking?.act !== act) {
      audio.play('uiMove');
      this.asking = { act, until: performance.now() + CONFIRM_MS };
      this.showAsking();
      return;
    }
    if (this.asking) {
      this.asking = null;
      this.showAsking();
    }
    audio.play('uiSelect');
    this.act(act, el);
  }

  /** The asking button says so (its label kept to go back to); every other one says what it does. */
  private showAsking() {
    this.root.querySelectorAll<HTMLElement>('[data-confirm]').forEach((el) => {
      const ask = !!this.asking && el.dataset.act === this.asking.act;
      if (ask === el.classList.contains('asking')) return;
      if (ask) {
        el.dataset.label = el.textContent ?? '';
        el.textContent = el.dataset.confirm || CONFIRM_ASK;
      } else el.textContent = el.dataset.label ?? el.textContent;
      el.classList.toggle('asking', ask);
    });
  }

  /**
   * ↑/↓ go to the row above or below — to the stop there nearest the column they started from — and ←/→
   * along the row. Rows are read off the page, so they follow the layout at any width. Both ends wrap,
   * as every list does.
   */
  private gridStep(items: HTMLElement[], m: MenuInput) {
    const next = m.down || m.right;
    if (this.sel < 0) {
      this.sel = next ? 0 : items.length - 1;
      return;
    }
    const boxes = items.map(boxOf);
    const cur = boxes[this.sel];
    const inRow = (b: Box, cy: number, h: number) => Math.abs(b.cy - cy) < Math.min(b.h, h) / 2;
    const all = boxes.map((b, i) => ({ b, i }));
    if (m.left || m.right) {
      this.column = null;
      const row = all.filter(({ b }) => inRow(b, cur.cy, cur.h)).sort((p, q) => p.b.cx - q.b.cx);
      const k = row.findIndex(({ i }) => i === this.sel);
      if (row.length > 1 && k >= 0) this.sel = row[(k + (m.right ? 1 : -1) + row.length) % row.length].i;
      return;
    }
    // (a highlight moved some other way since — the pointer, a press — starts a new column)
    const x = this.column && this.column.sel === this.sel ? this.column.x : cur.cx;
    const others = all.filter(({ b }) => !inRow(b, cur.cy, cur.h));
    if (!others.length) return;
    const ahead = others.filter(({ b }) => (m.down ? b.cy > cur.cy : b.cy < cur.cy));
    // the nearest row that way — or, past the last, the first row from the other end
    const pool = ahead.length ? ahead : others;
    const cys = pool.map(({ b }) => b.cy);
    const rowCy = m.down ? Math.min(...cys) : Math.max(...cys);
    const rowH = pool.find(({ b }) => b.cy === rowCy)!.b.h;
    let best = -1;
    let dist = Infinity;
    for (const { b, i } of pool) {
      if (!inRow(b, rowCy, rowH)) continue;
      const d = Math.abs(b.cx - x);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    if (best < 0) return;
    this.sel = best;
    this.column = { x, sel: best };
  }

  update(m: MenuInput) {
    const items = this.items();
    // A menu nobody asked for ignores the press already under way (arm); moving the highlight is fine.
    // Two guards, because each is blind where the other sees: the clock is the ceremony a player
    // feels, and the poll count is the one that survives a frame longer than that clock (see
    // UNASKED_ARM_POLLS). A menu the player opened themselves arms neither — the press that opened it
    // was spent on the screen they left, so there is nothing of it left to arrive here.
    if (this.armPolls > 0) this.armPolls--;
    const armed = !this.armPolls && performance.now() - this.born >= this.armMs;
    if (this.asking && performance.now() >= this.asking.until) {
      this.asking = null;
      this.showAsking();
    }
    if (!items.length) {
      if (armed && m.back && this.back) this.back();
      return;
    }
    if (this.axis === 'grid') {
      if (m.up || m.down || m.left || m.right) {
        const was = this.sel;
        this.gridStep(items, m);
        if (this.sel !== was) {
          audio.play('uiMove');
          this.highlight();
        }
      }
    } else {
      const prev = this.axis === 'h' ? m.left : m.up;
      const next = this.axis === 'h' ? m.right : m.down;
      if (prev || next) {
        this.sel = this.sel < 0 ? (next ? 0 : items.length - 1) : (this.sel + (next ? 1 : -1) + items.length) % items.length;
        audio.play('uiMove');
        this.highlight();
      }
    }
    if (!armed) return;
    if (m.confirm) {
      const el = items[this.sel];
      if (el) this.press(el);
    } else if (m.back && this.back) {
      audio.play('uiBack');
      this.back();
    }
  }

  dispose() {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('pointermove', this.onMove);
    this.root.removeEventListener('pointerdown', this.onDown);
    this.root.removeEventListener('pointerup', this.onUp);
  }
}
