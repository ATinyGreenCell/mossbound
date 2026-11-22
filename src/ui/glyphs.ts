/**
 * The symbols the menus, cards and hints use that the game's font doesn't have. The first time one is
 * laid out, the browser looks through the system's fonts for it (and loads the colour-emoji font, for
 * 🔒) — inside the layout of whichever screen shows it first, which is the frame of the press that
 * asked for that screen. The level select paid 24–33 ms the first time on a desktop and 3 ms after;
 * HOW TO PLAY 28 ms, then 2. Measured with the CPU slowed to a phone's, several times that.
 *
 * So they are laid out once, offscreen, as soon as the page has a moment with nothing else to do:
 * after the fonts are in, in an idle callback. No press ever pays for it.
 *
 * (Everything in src/ that the game's font lacks, by its code point: arrows and ≤ for the signs and
 * the controls card, the stopwatch, the circled controller letters, the triangles, ☰ ⧉ ♥ ✓ ✦ and the
 * padlock. Add to it when a new symbol turns up in the interface.)
 */
const SYMBOLS = '← ↑ → ↓ − ≤ ⏱ Ⓐ Ⓑ Ⓧ Ⓨ ▶ ▸ ▾ ◀ ☰ ♥ ✓ ✦ ⧉ 🔒';

let asked = false;

/** Lay the symbols out once, ahead of need, in idle time. Safe to call as often as you like. */
export function warmGlyphs() {
  if (asked || typeof document === 'undefined') return;
  asked = true;
  const run = () => {
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;white-space:nowrap';
    // the weights the interface sets them in, and the debug panel's monospace
    box.innerHTML =
      ['400', '600', '700'].map((w) => `<span style="font-weight:${w}">${SYMBOLS}</span>`).join('') +
      `<span style="font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace">${SYMBOLS}</span>`;
    document.body.appendChild(box);
    void box.offsetWidth; // the layout that looks the fallback fonts up
    box.remove();
    if (import.meta.env.DEV) Object.assign(window, { __fbGlyphsWarm: true });
  };
  const idle = () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 300);
  };
  // (with the game's own font in first: the symbols are looked up as the screens will look them up)
  const ready = document.fonts?.ready;
  if (ready) void ready.then(idle, idle);
  else idle();
}
