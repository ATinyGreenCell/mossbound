/**
 * Dev-only switches for the end-to-end tests, read from the URL. Each is guarded by
 * import.meta.env.DEV, so production builds fold them to constants and drop the code entirely —
 * players can't toggle them.
 *
 *   ?fast      non-gameplay waits (banners, level intros, result screens) run 5× quicker
 *   ?noaudio   skip synthesizing the sound library (for tests that don't listen)
 *   ?grace=N   online reconnect grace period in seconds (default 30)
 *   ?relay     online play skips WebRTC and goes through the WebSocket relay only
 *   ?p2p       online play never uses the WebSocket relay (WebRTC only)
 *   ?brokers=a,b   relay broker URLs to use instead of the defaults (tests point one at a dead host)
 *   ?norender  skip drawing (network tests: two software-rendered browsers on one machine crawl)
 */
const query = () => (typeof location !== 'undefined' ? location.search : '');

export const FAST = import.meta.env.DEV && /[?&]fast\b/.test(query());
export const NO_AUDIO = import.meta.env.DEV && /[?&]noaudio\b/.test(query());
export const GRACE_S = import.meta.env.DEV ? Number(/[?&]grace=(\d+)/.exec(query())?.[1] ?? 0) : 0;
export const RELAY_ONLY = import.meta.env.DEV && /[?&]relay\b/.test(query());
export const P2P_ONLY = import.meta.env.DEV && /[?&]p2p\b/.test(query());
export const NO_RENDER = import.meta.env.DEV && /[?&]norender\b/.test(query());
export const BROKERS_OVERRIDE: string[] | null = import.meta.env.DEV
  ? (/[?&]brokers=([^&]+)/.exec(query())?.[1]?.split(',').map(decodeURIComponent) ?? null)
  : null;

/** Step for a ceremony timer (anything the player waits through rather than plays). */
export const ceremony = (dt: number) => (FAST ? dt * 5 : dt);
