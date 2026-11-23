import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { BRAND } from './src/brand';

const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/**
 * The built site says which version it is, at a fixed path. `mb status` reads it to tell whether the
 * live site has caught up with the repo — without it there is no way to know from outside whether a
 * push actually published, only that a workflow said it did.
 */
function versionFile() {
  return {
    name: 'mossbound-version',
    generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) + '\n' });
    },
  };
}

/**
 * The game's name (src/brand.ts) in the page's title and in the install manifest, so a rename is
 * that one file. The manifest is made here, not kept in public/: the dev server serves this one and
 * the build emits it. Only the words come from the brand. The `id` is the installed app's identity
 * and never changes, or every phone that installed the game would see a different app.
 */
function brand() {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const manifest = () =>
    JSON.stringify(
      {
        name: BRAND.name,
        id: 'mossbound-game',
        short_name: BRAND.name,
        description: BRAND.blurb,
        start_url: './',
        scope: './',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#1d2b4a',
        theme_color: '#1d2b4a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      null,
      2,
    ) + '\n';
  return {
    name: 'mossbound-brand',
    transformIndexHtml: (html: string) => html.replaceAll('__GAME_NAME__', esc(BRAND.name)),
    configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (s: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? '').split('?')[0].endsWith('/manifest.webmanifest')) return next();
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(manifest());
      });
    },
    generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest() });
    },
  };
}

/**
 * A service worker, written against the files this build actually produced.
 *
 * Chrome will not offer to install a page — will not even fire the event that lets the page offer it
 * — unless a service worker with a `fetch` handler is in charge of it. Without one, "add to home
 * screen" makes a bookmark with an icon: it opens in a browser tab, the browser remembers having
 * made it, and then says the app is already installed. That is the whole of why installing was
 * broken, and it is why this file exists at all. Playing offline comes free with it.
 *
 * What it caches, and how:
 *
 *   the hashed files (assets/index-A1b2C3.js and friends) are immutable by construction — a changed
 *   file gets a different name — so they are served from the cache and never checked again. A file
 *   that isn't cached (yet) is fetched and kept.
 *
 *   index.html is NOT, and this is the part worth getting right. A phone that cached it would keep
 *   loading the build it first saw, for ever. So the page is asked of the server every time — past
 *   the browser's own cache too, which GitHub Pages lets keep it for ten minutes (max-age=600): a
 *   launch soon after a deploy would otherwise boot the build before and reload a few seconds later.
 *   But the network gets three seconds: past that, on hotel Wi-Fi or a stalled connection, the copy
 *   this worker installed opens the game (the updater brings the new build in once it can). The
 *   update's own reload (?u=, see update.ts) waits for the network however long it takes: that
 *   reload is the new build. version.json is never touched here: a cached answer to "which build is
 *   live" would only ever be a stale one.
 *
 * Installing is all or nothing. The page (which must be this build's own: it names this build's
 * script), its scripts, styles and fonts are all in the cache before this worker takes over, or it
 * doesn't take over — the one before stays in charge with everything it needs, and the browser tries
 * the update again later. (A worker that took over with a file missing threw away the old build's
 * complete cache for a new one with a hole in it, and the installed game no longer opened offline.)
 * Nothing is downloaded twice: a file the build before had (the same name is the same file) is taken
 * from its cache, and the rest is fetched through the browser's cache, which on a first visit already
 * holds what the page just loaded. The .woff fonts — the fallback for browsers too old to run this
 * game — are never fetched at all.
 *
 * Activating keeps the build before's cache for one more round, and drops anything older. A page
 * still open on that build (an online room waits for its players to leave before it updates) can
 * still load its own lazy files — the networking code, the synth worker — after this worker has
 * taken the pages over. Only caches named for Mossbound are ever touched: the github.io origin is
 * shared with every other project on it. `skipWaiting` and `claim` hand the new worker the open
 * pages at once rather than waiting for every tab to close, which on a phone is never.
 */
function serviceWorker() {
  return {
    name: 'mossbound-sw',
    generateBundle(
      this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void },
      _opts: unknown,
      bundle: Record<string, { type?: string; isEntry?: boolean; fileName?: string }>,
    ) {
      const built = Object.keys(bundle).filter((f) => f !== 'sw.js' && f !== 'version.json' && f !== 'index.html');
      // what the game can't run without: every script (the lazy ones too), style and font it loads
      const core = built.filter((f) => /\.(js|css|woff2)$/.test(f)).map((f) => `./${f}`);
      // nice to have: the install's icons and manifest (an older browser's .woff fonts: never)
      const extra = ['./manifest.webmanifest', './favicon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];
      const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry)?.fileName;
      if (!entry) throw new Error('mossbound-sw: no entry chunk in the bundle');
      const src = `// Generated by vite.config.ts for Mossbound ${version}. Do not edit.
const PREFIX = 'mossbound-';
const CACHE = PREFIX + '${version}';
const CORE = ${JSON.stringify(core)};
const EXTRA = ${JSON.stringify(extra)};
// this build's page names this script: a page that doesn't is another build's
const ENTRY = ${JSON.stringify(entry)};
// the network's turn for the page, before the copy installed here opens the game instead
const PAGE_WAIT_MS = 3000;

const versionOf = (k) => (/^mossbound-(\\d+)\\.(\\d+)\\.(\\d+)$/.exec(k) || []).slice(1).map(Number);
const newer = (a, b) => {
  const x = versionOf(a);
  const y = versionOf(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // the page, asked of the server itself — and it has to be this build's. (As ./, the address it is
      // opened at, so a first visit's copy is only checked, not fetched again; kept as ./index.html)
      const page = await fetch(new Request('./', { cache: 'no-cache' }));
      if (!page.ok) throw new Error('index.html: ' + page.status);
      if (!(await page.clone().text()).includes(ENTRY)) throw new Error('index.html is another build\\'s');
      // the rest: from the build before when it had it, else through the browser's cache
      const keep = async (u, fresh) => {
        const had = await caches.match(u);
        if (had && u.indexOf('./assets/') === 0) return cache.put(u, had);
        const res = await fetch(new Request(u, { cache: fresh ? 'no-cache' : 'default' }));
        if (!res.ok) throw new Error(u + ': ' + res.status);
        return cache.put(u, res);
      };
      await Promise.all(CORE.map((u) => keep(u, false)));
      await cache.put('./index.html', page);
      await Promise.allSettled(EXTRA.map((u) => keep(u, true)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // only Mossbound's own caches (the origin is shared); the newest of the older builds stays a round
      const ours = (await caches.keys()).filter((k) => k.indexOf(PREFIX) === 0 && k !== CACHE);
      const before = ours.reduce((a, k) => (a === null || newer(k, a) ? k : a), null);
      await Promise.all(ours.filter((k) => k !== before).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

/** this build's own page, as installed */
const installed = () => caches.open(CACHE).then((c) => c.match('./index.html'));

async function page(req, url) {
  let net;
  try {
    // (past the browser's cache: it may keep the page ten minutes, and that may be the build before)
    net = fetch(new Request(req, { cache: 'no-cache' }));
  } catch (err) {
    net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'manual' });
  }
  const usable = (res) => res && (res.ok || res.type === 'opaqueredirect');
  // the update's own reload waits for the network however long it takes: that reload is the new build
  if (url.searchParams.has('u')) return net.catch(() => installed().then((hit) => hit || Response.error()));
  const res = await Promise.race([net.catch(() => null), new Promise((r) => setTimeout(r, PAGE_WAIT_MS, null))]);
  if (usable(res)) return res;
  const hit = await installed();
  if (hit) return hit;
  return res || net;
}

async function asset(req) {
  // this build's cache, or the build before's (a page still open on it loading its own lazy files)
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') {
    // (copied before the page reads it: once its body has been read, it can't be)
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // which build is live: only the network can say
  if (/\\/version\\.json$/.test(url.pathname)) return;
  if (req.mode === 'navigate' || /\\/(index\\.html)?$/.test(url.pathname)) e.respondWith(page(req, url));
  else e.respondWith(asset(req));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

// Relative base so the build works from any GitHub Pages sub-path (user.github.io/<repo>/).
export default defineConfig({
  base: './',
  // the running build's own version, which update.ts compares with the site's version.json
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [brand(), versionFile(), serviceWorker()],
  // the agents' worktrees live under this checkout's .claude/: an edit there (an index.html above all)
  // must not reload the pages of a test run served from here. Only this checkout's own .claude/, by its
  // full path: '**/.claude/**' also matched every file of a server run from inside a worktree, which then
  // never saw its own edits and served stale code.
  server: { watch: { ignored: [fileURLToPath(new URL('./.claude/', import.meta.url)) + '**'] } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
