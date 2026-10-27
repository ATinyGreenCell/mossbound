/**
 * Edge on Xbox starts every page in "browsing controls": the stick drives a cursor and B goes back a
 * page. Holding the Menu button and picking "Use game controls" hands the controllers to the game.
 */
export const IS_XBOX = typeof navigator !== 'undefined' && /\bXbox\b/i.test(navigator.userAgent);

export const XBOX_HINT =
  'XBOX: hold <b>☰ MENU</b> and choose <b>Use game controls</b> so the game gets the controllers · hold <b>⧉ VIEW</b> for full screen';

/** Edge on Xbox can lose focus (e.g. after the View button), and an unfocused page gets no controller input. */
export const XBOX_REFOCUS = 'controller not responding? press the Xbox button twice to give the game focus again';

/** iPhone/iPad Safari: no element fullscreen on iPhone, so we suggest Add to Home Screen instead. */
export const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Running as an installed home-screen app (no browser chrome). */
export const IS_STANDALONE =
  typeof window !== 'undefined' &&
  ((typeof matchMedia === 'function' && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true);
