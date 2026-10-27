export type PerfMode = 'auto' | 'high' | 'low';

export interface TurnServer {
  urls: string;
  username: string;
  credential: string;
}

export interface Settings {
  /** shown above your bird on your partner's screen */
  name: string;
  /** index into BIRD_COLORS */
  color: number;
  hat: string;
  perf: PerfMode;
  music: number;
  sfx: number;
  shake: boolean;
  /** last room code used online (offered as "back to our room") */
  lastRoom: string;
  /** whether we made that room or joined it (a guest rejoins; only the host reopens) */
  lastRole: 'host' | 'guest';
  /** both sprouts alike (one body, every ability) rather than tall and small — see traits.ts */
  even: boolean;
  /** player 1 is the small sprout and player 2 the tall one */
  swap: boolean;
  /** optional TURN relay for networks that block direct connections */
  turn: TurnServer;
}

const KEY = 'mossbound.settings.v1';

const defaults: Settings = {
  name: '',
  color: 0,
  hat: 'none',
  perf: 'auto',
  music: 0.7,
  sfx: 0.9,
  shake: true,
  lastRoom: '',
  lastRole: 'host',
  even: false,
  swap: false,
  turn: { urls: '', username: '', credential: '' },
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);

function load(): Settings {
  const s: Settings = { ...defaults, turn: { ...defaults.turn } };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return s;
    const v = JSON.parse(raw) as Partial<Settings>;
    s.name = str(v.name, 12) ?? s.name;
    if (typeof v.color === 'number' && v.color >= 0 && v.color < 16) s.color = Math.floor(v.color);
    s.hat = str(v.hat, 16) ?? s.hat;
    if (v.perf === 'auto' || v.perf === 'high' || v.perf === 'low') s.perf = v.perf;
    if (typeof v.music === 'number') s.music = Math.min(1, Math.max(0, v.music));
    if (typeof v.sfx === 'number') s.sfx = Math.min(1, Math.max(0, v.sfx));
    if (typeof v.shake === 'boolean') s.shake = v.shake;
    s.lastRoom = str(v.lastRoom, 8) ?? s.lastRoom;
    if (v.lastRole === 'host' || v.lastRole === 'guest') s.lastRole = v.lastRole;
    if (typeof v.even === 'boolean') s.even = v.even;
    if (typeof v.swap === 'boolean') s.swap = v.swap;
    if (v.turn && typeof v.turn === 'object') {
      s.turn.urls = str(v.turn.urls, 300) ?? '';
      s.turn.username = str(v.turn.username, 200) ?? '';
      s.turn.credential = str(v.turn.credential, 200) ?? '';
    }
  } catch {
    // storage unavailable (private mode etc.) — defaults are fine
  }
  return s;
}

export const settings: Settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

/** Users who ask the OS for reduced motion get no screen shake and gentler effects. */
export const reducedMotion = (() => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
})();
