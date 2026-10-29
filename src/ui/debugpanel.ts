import { dbg, dbgReset, type Speed } from '../core/debug';

/**
 * The debug ground's panel: a column of toggles over the level, and a readout of what the game
 * thinks is happening. Built for a thumb — every control is a proper tap target, and the whole
 * thing folds away to one button so it never covers the mechanic being looked at.
 *
 * The readout is written once a frame from plain strings; it never touches the DOM unless the text
 * has actually changed, for the same reason the HUD doesn't.
 */
export class DebugPanel {
  readonly el: HTMLDivElement;
  private body: HTMLElement;
  private readout: HTMLElement;
  private last = '';
  private open = true;
  /** the panel's own buttons, so a toggle shows its state without a full rebuild */
  private toggles = new Map<string, HTMLElement>();
  onLevel: ((i: number) => void) | null = null;
  onCheckpoint: ((dir: -1 | 1) => void) | null = null;
  onSwap: (() => void) | null = null;
  onRespawn: (() => void) | null = null;
  onLeave: (() => void) | null = null;
  /** a tap on the world while TAP TO GO is on, in CSS pixels */
  onTapWorld: ((clientX: number, clientY: number) => void) | null = null;
  private catcher: HTMLDivElement;

  constructor(parent: HTMLElement, levels: string[], levelIndex: number) {
    this.el = document.createElement('div');
    this.el.className = 'dbg';
    const opts = levels.map((n, i) => `<option value="${i}"${i === levelIndex ? ' selected' : ''}>${i + 1}. ${n}</option>`).join('');
    this.el.innerHTML = `
      <div class="dbg-bar">
        <b>DEBUG</b>
        <div class="dbg-fold" data-act="fold" role="button" aria-label="Fold the debug panel">▾</div>
      </div>
      <div class="dbg-body">
        <select class="dbg-level" aria-label="Level">${opts}</select>
        <div class="dbg-row">
          <div class="dbg-btn" data-act="cp-back" role="button">◀ LANTERN</div>
          <div class="dbg-btn" data-act="cp-fwd" role="button">LANTERN ▶</div>
        </div>
        <div class="dbg-row">
          <div class="dbg-btn" data-tog="invuln" role="button">UNHURTABLE</div>
          <div class="dbg-btn" data-tog="noclip" role="button">NOCLIP</div>
        </div>
        <div class="dbg-row">
          <div class="dbg-btn" data-tog="boxes" role="button">BOXES</div>
          <div class="dbg-btn" data-tog="teleport" role="button">TAP TO GO</div>
        </div>
        <div class="dbg-row">
          <div class="dbg-btn" data-speed="1" role="button">1×</div>
          <div class="dbg-btn" data-speed="0.5" role="button">½×</div>
          <div class="dbg-btn" data-speed="0.25" role="button">¼×</div>
        </div>
        <div class="dbg-row">
          <div class="dbg-btn" data-tog="frozen" role="button">FREEZE</div>
          <div class="dbg-btn" data-act="step" role="button">STEP ▸</div>
        </div>
        <div class="dbg-row">
          <div class="dbg-btn" data-act="swap" role="button">OTHER SPROUT</div>
          <div class="dbg-btn" data-act="respawn" role="button">RESPAWN</div>
        </div>
        <div class="dbg-row">
          <div class="dbg-btn" data-act="alloff" role="button">ALL OFF</div>
          <div class="dbg-btn" data-act="leave" role="button">LEAVE</div>
        </div>
        <pre class="dbg-out"></pre>
      </div>`;
    parent.appendChild(this.el);
    // TAP TO GO puts a sheet over the whole level: the touch stick's own zone covers most of a
    // phone screen, so a tap on the canvas would otherwise just be a thumb on the stick. The sheet
    // sits under the panel, so the panel's own buttons still work while it is up.
    this.catcher = document.createElement('div');
    this.catcher.className = 'dbg-catch hidden';
    parent.appendChild(this.catcher);
    this.catcher.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onTapWorld?.(e.clientX, e.clientY);
    });
    this.body = this.el.querySelector('.dbg-body')!;
    this.readout = this.el.querySelector('.dbg-out')!;
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-tog]')) this.toggles.set(b.dataset.tog!, b);

    this.el.querySelector<HTMLSelectElement>('.dbg-level')!.addEventListener('change', (e) => {
      this.onLevel?.(Number((e.target as HTMLSelectElement).value));
    });
    // pointerdown, not click: a tap that drifts a pixel still counts, and the level keeps the gesture
    this.el.addEventListener('pointerdown', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-tog],[data-speed]');
      if (!t) return;
      e.stopPropagation();
      e.preventDefault();
      if (t.dataset.tog) {
        const k = t.dataset.tog as 'invuln' | 'noclip' | 'boxes' | 'teleport' | 'frozen';
        dbg[k] = !dbg[k];
      } else if (t.dataset.speed) {
        dbg.speed = Number(t.dataset.speed) as Speed;
      } else
        switch (t.dataset.act) {
          case 'fold':
            this.open = !this.open;
            break;
          case 'step':
            // one frame, whether or not it is frozen — and freezing it is what you want after
            dbg.frozen = true;
            dbg.stepOne = true;
            break;
          case 'cp-back':
            this.onCheckpoint?.(-1);
            break;
          case 'cp-fwd':
            this.onCheckpoint?.(1);
            break;
          case 'swap':
            this.onSwap?.();
            break;
          case 'respawn':
            this.onRespawn?.();
            break;
          case 'alloff':
            dbgReset();
            break;
          case 'leave':
            this.onLeave?.();
            break;
        }
      this.sync();
    });
    this.sync();
  }

  /** Show which toggles are on, and whether the panel is folded. */
  private sync() {
    this.body.classList.toggle('hidden', !this.open);
    this.catcher.classList.toggle('hidden', !dbg.teleport);
    this.el.querySelector('.dbg-fold')!.textContent = this.open ? '▾' : '▸';
    for (const [k, b] of this.toggles) b.classList.toggle('on', dbg[k as 'invuln']);
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-speed]')) b.classList.toggle('on', Number(b.dataset.speed) === dbg.speed);
  }

  /** The readout, written only when it says something new. */
  setText(s: string) {
    if (s === this.last) return;
    this.last = s;
    this.readout.textContent = s;
  }

  setLevel(i: number) {
    const sel = this.el.querySelector<HTMLSelectElement>('.dbg-level');
    if (sel) sel.value = String(i);
  }

  /** Keep the sheet in step with the toggle, which "ALL OFF" and a reload can both change. */
  tick() {
    this.catcher.classList.toggle('hidden', !dbg.teleport);
  }

  destroy() {
    this.el.remove();
    this.catcher.remove();
  }
}
