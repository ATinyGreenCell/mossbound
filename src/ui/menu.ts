import { audio } from '../audio/audio';
import type { MenuInput } from '../core/input';
import { ceremony } from '../core/testmode';

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
 * A column (or row) of DOM buttons that keyboard, controller and touch can all drive: arrows / d-pad /
 * stick move the highlight, A / Enter / Space presses it, B / Esc backs out, and a tap or click
 * presses the button under it. Elements with `data-act` are the buttons; `.off` ones are skipped.
 * `sel` -1 highlights nothing (see disarm).
 */
export class ButtonList {
  sel = 0;
  private born = performance.now();
  /** confirm / back (and taps) are ignored this long after `born` — see arm() */
  private armMs = 0;
  private readonly onClick: (e: Event) => void;
  private readonly onMove: (e: PointerEvent) => void;

  constructor(
    private readonly root: HTMLElement,
    private readonly act: (action: string, el: HTMLElement) => void,
    private readonly back: (() => void) | null = null,
    private readonly axis: 'v' | 'h' | 'both' = 'v',
  ) {
    this.onClick = (e: Event) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || !root.contains(el) || el.classList.contains('off')) return;
      if (this.guarded()) return;
      const i = this.items().indexOf(el);
      if (i >= 0) this.sel = i;
      this.highlight();
      this.press(el);
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
    this.highlight();
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
    if (rearm) this.born = performance.now();
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
    return this;
  }

  highlight() {
    const items = this.items();
    if (this.sel >= items.length) this.sel = Math.max(0, items.length - 1);
    this.root.querySelectorAll('.sel').forEach((el) => el.classList.remove('sel'));
    const on = items[this.sel];
    on?.classList.add('sel');
    // a card taller than the screen scrolls inside itself (a phone held sideways, a short window), and
    // a highlight below the fold would have you pressing a row you can't see
    on?.scrollIntoView?.({ block: 'nearest' });
  }

  private press(el: HTMLElement) {
    audio.play('uiSelect');
    this.act(el.dataset.act!, el);
  }

  update(m: MenuInput) {
    const items = this.items();
    // a menu nobody asked for ignores the press already under way (arm); moving the highlight is fine
    const armed = performance.now() - this.born >= this.armMs;
    if (!items.length) {
      if (armed && m.back && this.back) this.back();
      return;
    }
    const prev = this.axis === 'h' ? m.left : this.axis === 'v' ? m.up : m.left || m.up;
    const next = this.axis === 'h' ? m.right : this.axis === 'v' ? m.down : m.right || m.down;
    if (prev || next) {
      this.sel = this.sel < 0 ? (next ? 0 : items.length - 1) : (this.sel + (next ? 1 : -1) + items.length) % items.length;
      audio.play('uiMove');
      this.highlight();
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
  }
}
