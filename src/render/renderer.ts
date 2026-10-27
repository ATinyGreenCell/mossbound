/**
 * Bumps when the GPU let go of every canvas's pixels (a lost context, then restored): anything that
 * keeps pre-painted canvases (tiles, backdrops, glows, labels) compares it with its own and repaints.
 */
export let canvasEpoch = 0;

/**
 * The game canvas. Owns sizing: the backing store follows the CSS size × device pixel ratio (capped at
 * 2) × the performance governor's scale, and every resize source a phone, laptop or Xbox can produce
 * — window resize, rotation, the mobile address bar sliding, container changes — lands in resize().
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** backing store size in device pixels */
  width = 1;
  height = 1;
  /** CSS size of the canvas */
  cssW = 1;
  cssH = 1;
  /** backing pixels per CSS pixel */
  pixelRatio = 1;
  /** 0.5..1 resolution multiplier driven by the performance governor */
  scale = 1;
  /** bumps on every real size change: caches keyed by it rebuild themselves */
  generation = 0;
  lost = false;
  private listeners: Array<() => void> = [];
  /** a resize is waiting for the next frame (see flush) */
  private dirty = false;
  /** the device pixel ratio the canvas was sized for */
  private dpr = 0;
  private readonly lostEl: HTMLDivElement;

  constructor(private readonly container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'view';
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.lostEl = document.createElement('div');
    this.lostEl.className = 'context-lost hidden';
    this.lostEl.innerHTML = '<b>GRAPHICS RESET</b><span>Waiting for the screen to come back… tap to reload if this sticks.</span>';
    this.lostEl.addEventListener('click', () => location.reload());
    container.appendChild(this.lostEl);
    // a 2D canvas can lose its backing store too (GPU reset, memory pressure on phones)
    this.canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.lostEl.classList.remove('hidden');
    });
    this.canvas.addEventListener('contextrestored', () => {
      this.lost = false;
      this.lostEl.classList.add('hidden');
      canvasEpoch++;
      this.resize(true);
    });

    const soon = () => this.schedule();
    window.addEventListener('resize', soon);
    // iOS reports the old size during the rotation animation: measure again once it settles
    window.addEventListener('orientationchange', () => {
      soon();
      setTimeout(soon, 250);
      setTimeout(soon, 700);
    });
    window.visualViewport?.addEventListener('resize', soon);
    if (typeof ResizeObserver === 'function') new ResizeObserver(soon).observe(container);
    document.addEventListener('fullscreenchange', soon);
    this.resize(true);
  }

  /** Bursts of resize events become one measurement, made by the next frame (see flush). */
  private schedule() {
    this.dirty = true;
  }

  /**
   * Apply a waiting resize. The app calls this at the top of each frame, just before drawing: resizing
   * clears the canvas, and a clear nobody draws over before the screen updates flashes black.
   */
  flush() {
    // a window dragged onto a screen with another pixel density keeps its size and layout, and no event
    // need tell us: the density itself is checked every frame (one property read)
    if (window.devicePixelRatio !== this.dpr) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.resize();
  }

  setScale(s: number) {
    const v = Math.min(1, Math.max(0.5, s));
    if (Math.abs(v - this.scale) < 0.01) return;
    this.scale = v;
    this.resize(true);
  }

  onResize(fn: () => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  resize(force = false) {
    const r = this.container.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(r.width || window.innerWidth));
    const cssH = Math.max(1, Math.round(r.height || window.innerHeight));
    this.dpr = window.devicePixelRatio;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // never more than ~1600 device rows: a 4K laptop panel doesn't need 4K of grass
    const k = Math.min(dpr, 1600 / cssH) * this.scale;
    const w = Math.max(160, Math.round(cssW * k));
    const h = Math.max(90, Math.round(cssH * k));
    if (!force && w === this.width && h === this.height && cssW === this.cssW && cssH === this.cssH) return;
    this.cssW = cssW;
    this.cssH = cssH;
    this.width = w;
    this.height = h;
    this.pixelRatio = w / cssW;
    this.canvas.width = w;
    this.canvas.height = h;
    this.generation++;
    for (const fn of this.listeners) fn();
  }
}
