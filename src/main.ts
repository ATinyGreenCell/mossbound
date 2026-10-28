import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import './style.css';
import { App } from './app';
import { audio } from './audio/audio';
import { IS_XBOX } from './core/platform';
import { settings } from './core/settings';
import { TouchControls } from './core/touch';
import { Flow } from './flow';
import { preloadNet } from './net/link';

// an invite link means online play is coming: fetch the networking code while the rest boots
const invite = /(?:^|[#&])join=([A-Za-z0-9]{4})/.exec(location.hash);
if (invite) void preloadNet().catch(() => undefined);

// iOS/Safari only let an AudioContext start or resume inside the gesture handler itself, and may
// suspend it again after the app is backgrounded — so keep these installed (unlock() is idempotent).
const unlockAudio = () => {
  audio.unlock();
  audio.setVolumes({ music: settings.music, sfx: settings.sfx });
};
for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
  window.addEventListener(type, unlockAudio, { capture: true, passive: true });
}

// Edge on Xbox, in its default "browsing controls" mode, takes B to mean "back a page". A phone has
// a system back gesture from the screen edge (Android's gesture navigation; an iOS left-edge swipe in
// a tab with history) that starts right where the left thumb rests on the stick, and a page can't
// refuse either. Keep one history entry of our own on top so a stray back is a no-op. It's pushed on
// the first real input because browsers skip entries a page added without one — on a phone that means
// the first touch, so a desktop played with a mouse keeps its Back button.
{
  const guard = () => history.pushState({ fb: 1 }, '');
  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    guard();
  };
  window.addEventListener('pointerdown', (e) => { if (IS_XBOX || e.pointerType !== 'mouse') arm(); }, { capture: true, passive: true });
  if (IS_XBOX) window.addEventListener('keydown', arm, { capture: true, passive: true });
  window.addEventListener('popstate', () => {
    if (armed) guard();
  });
}

async function loadFonts() {
  if (!document.fonts) return;
  const fonts = Promise.all([document.fonts.load('600 32px "Fredoka"'), document.fonts.load('400 16px "Fredoka"')]);
  // canvas name tags need the font ready; never block boot for long
  await Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined);
}

async function boot() {
  const root = document.getElementById('app')!;
  await loadFonts();
  let app: App;
  try {
    app = new App(root);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="fatal"><b>mossbound</b><p>This browser can't draw the game. Try a recent Chrome, Safari, Edge or Firefox.</p></div>`;
    return;
  }
  app.touch = new TouchControls(root, app.input);
  // a controller is all some players touch (an Xbox in game-controls mode)
  app.onPadPress = unlockAudio;
  const flow = new Flow(app);
  // invite links look like …/#join=K7QX — drop straight into that room
  if (invite) {
    history.replaceState(null, '', location.pathname + location.search);
    flow.online({ joinCode: invite[1].toUpperCase() });
  } else {
    flow.title();
  }
  app.start();
  if (import.meta.env.DEV) Object.assign(window, { __fb: { app, flow, audio, save: await import('./core/save') } });
}

void boot();
