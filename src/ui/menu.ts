import { audio } from '../audio/audio';
import type { MenuInput } from '../core/input';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** clicks this soon after a menu appears are the tail of the tap that opened it: ignored */
const CLICK_GUARD_MS = 350;

/**
 * A column (or row) of DOM buttons that keyboard, controller and touch can all drive: arrows / d-pad /
 * stick move the highlight, A / Enter / Space presses it, B / Esc backs out, and a tap or click
 * presses the button under it. Elements with `data-act` are the buttons; `.off` ones are skipped.
 * `sel` -1 highlights nothing (see disarm).
 */
export class ButtonList {
  sel = 0;
  private born = performance.now();
  private readonly onClick: (e: Event) => void;

  constructor(
    private readonly root: HTMLElement,
    private readonly act: (action: string, el: HTMLElement) => void,
    private readonly back: (() => void) | null = null,
    private readonly axis: 'v' | 'h' | 'both' = 'v',
  ) {
    this.onClick = (e: Event) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || !root.contains(el) || el.classList.contains('off')) return;
      if (performance.now() - this.born < CLICK_GUARD_MS) return;
      const i = this.items().indexOf(el);
      if (i >= 0) this.sel = i;
      this.highlight();
      this.press(el);
    };
    root.addEventListener('click', this.onClick);
    this.highlight();
  }

  items() {
    return [...this.root.querySelectorAll<HTMLElement>('[data-act]')].filter((el) => !el.classList.contains('off') && el.offsetParent !== null);
  }

  /** Call after rebuilding the buttons. */
  refresh(keepSel = true) {
    if (!keepSel) this.sel = 0;
    this.born = performance.now();
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

  highlight() {
    const items = this.items();
    if (this.sel >= items.length) this.sel = Math.max(0, items.length - 1);
    this.root.querySelectorAll('.sel').forEach((el) => el.classList.remove('sel'));
    items[this.sel]?.classList.add('sel');
  }

  private press(el: HTMLElement) {
    audio.play('uiSelect');
    this.act(el.dataset.act!, el);
  }

  update(m: MenuInput) {
    const items = this.items();
    if (!items.length) {
      if (m.back && this.back) this.back();
      return;
    }
    const prev = this.axis === 'h' ? m.left : this.axis === 'v' ? m.up : m.left || m.up;
    const next = this.axis === 'h' ? m.right : this.axis === 'v' ? m.down : m.right || m.down;
    if (prev || next) {
      this.sel = this.sel < 0 ? (next ? 0 : items.length - 1) : (this.sel + (next ? 1 : -1) + items.length) % items.length;
      audio.play('uiMove');
      this.highlight();
    }
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
  }
}
