// The service worker and the self-updater across a deploy, on production builds: build A (this source) and
// build B (A with every script renamed and its version bumped — what a deploy looks like from outside),
// served the way GitHub Pages serves them (a sub-path, ETags, a max-age: 1 s unless a check says otherwise,
// standing for a game installed days ago whose browser cache has long gone stale) by a server that can
// switch from A to B, drop chosen files, hold a request back, or refuse everything (offline).
//   · the worker's runtime caching works: a file missing from the cache is fetched and kept, and the
//     worker doesn't throw on every fetch;
//   · an update whose install couldn't fetch everything doesn't take over: offline, the game still opens;
//   · a slow network doesn't hold up a game that is already cached (the page waits ~3 s at most);
//   · a page left open across a deploy can still load its own lazy files (networking code, synth worker)
//     after the new worker takes over — and other projects' caches on the shared origin are left alone;
//   · a launch soon after a deploy gets the new page, not one the browser cached up to 10 minutes ago;
//   · the worker downloads nothing twice: not on a first visit (what the page just fetched), not on an
//     update (what didn't change), and never the .woff fonts no browser that runs this asks for;
//   · an update on a slow network still lands (its reload waits for the new page however long it takes).
// ONLY=a,b runs just those checks (their names are in the `run` calls).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { launch, OUT, reporter, SLOW, sleep, waitFor } from './harness.mjs';

const t = reporter();
const errors = [];
const only = process.env.ONLY?.split(',');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DIR = path.join(OUT, 'sw');

// ---- the two builds
const build = (outDir) =>
  new Promise((done, fail) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (code) => (code === 0 ? done() : fail(new Error(`vite build exited ${code}`))));
  });
const A = path.join(DIR, 'A');
const B = path.join(DIR, 'B');
fs.rmSync(DIR, { recursive: true, force: true });
await build(A);
const VA = JSON.parse(fs.readFileSync(path.join(A, 'version.json'), 'utf8')).version;
const VB = '9.9.1';
// B: A with every script renamed (new content, new name) and the version stamped 9.9.1 throughout
fs.cpSync(A, B, { recursive: true });
const scripts = fs.readdirSync(path.join(B, 'assets')).filter((f) => f.endsWith('.js'));
const renamed = Object.fromEntries(scripts.map((f) => [f, f.replace(/\.js$/, 'b.js')]));
for (const [from, to] of Object.entries(renamed)) fs.renameSync(path.join(B, 'assets', from), path.join(B, 'assets', to));
for (const f of ['index.html', 'sw.js', 'version.json', ...Object.values(renamed).map((f) => `assets/${f}`)]) {
  let s = fs.readFileSync(path.join(B, f), 'utf8');
  for (const [from, to] of Object.entries(renamed)) s = s.split(from).join(to);
  for (const q of ['"', "'", '`']) s = s.split(`${q}${VA}${q}`).join(`${q}${VB}${q}`);
  s = s.split(`mossbound-${VA}`).join(`mossbound-${VB}`).split(`Mossbound ${VA}`).join(`Mossbound ${VB}`);
  fs.writeFileSync(path.join(B, f), s);
}
const entryOf = (dir) => /assets\/(index-[\w-]+\.js)/.exec(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'))[1];
const netOf = (dir) => fs.readdirSync(path.join(dir, 'assets')).find((f) => /^dist-.*\.js$/.test(f));
const workerOf = (dir) => fs.readdirSync(path.join(dir, 'assets')).find((f) => /^synth\.worker-.*\.js$/.test(f));

// ---- GitHub Pages, more or less
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const srv = {};
const reset = () => Object.assign(srv, { root: A, offline: false, drop: new Set(), hold: new Map(), maxAge: 1, log: [] });
reset();
const server = http.createServer((req, res) => {
  if (srv.offline) return req.socket.destroy();
  const u = new URL(req.url, 'http://x');
  if (!u.pathname.startsWith('/mossbound/')) {
    res.writeHead(404);
    return res.end();
  }
  const p = u.pathname.slice('/mossbound/'.length) || 'index.html';
  const name = path.basename(p);
  const entry = { at: Date.now(), p, root: path.basename(srv.root), sw: !!req.headers['service-worker'], status: 0 };
  srv.log.push(entry);
  if (srv.drop.has(name)) return req.socket.destroy();
  const go = () => {
    if (srv.offline) return req.socket.destroy();
    const f = path.join(srv.root, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      entry.status = 404;
      res.writeHead(404, { 'cache-control': `max-age=${srv.maxAge}` });
      return res.end('404');
    }
    const st = fs.statSync(f);
    const etag = `"${path.basename(srv.root)}-${st.size}-${Math.floor(st.mtimeMs)}"`;
    if (req.headers['if-none-match'] === etag) {
      entry.status = 304;
      res.writeHead(304, { etag, 'cache-control': `max-age=${srv.maxAge}` });
      return res.end();
    }
    entry.status = 200;
    res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream', 'cache-control': `max-age=${srv.maxAge}`, etag });
    res.end(fs.readFileSync(f));
  };
  const ms = srv.hold.get(name);
  if (ms) setTimeout(go, ms);
  else go();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}/mossbound/`;

// ---- pages
const browsers = [];
/** A new device's first visit to build A, left with A's worker in charge. */
async function fresh(opts = {}) {
  reset();
  Object.assign(srv, opts);
  const b = await launch();
  browsers.push(b);
  const page = (await b.pages())[0] ?? (await b.newPage());
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`[pageerror] ${e.message}`));
  await page.goto(SITE, { waitUntil: 'load' });
  await waitFor(() => page.evaluate(() => !!navigator.serviceWorker?.controller).catch(() => false), 15000, 'the worker in charge');
  await installed(page, VA);
  await sleep(300);
  return { b, page };
}
/** Build `v`'s worker has finished installing (its cache holds the page, which goes in last). */
function installed(page, v) {
  return waitFor(() => page.evaluate((v) => caches.open(`mossbound-${v}`).then((c) => c.match('./index.html')).then((r) => !!r), v).catch(() => false), 15000, `build ${v} installed`);
}
const booted = (page) => page.evaluate(() => !window.__old && document.querySelector('#app')?.children.length > 0).catch(() => false);
const badge = (page) => page.evaluate(() => document.querySelector('.version-badge')?.textContent ?? '').catch(() => '');
const script = (page) => page.evaluate(() => document.querySelector('script[type=module]')?.getAttribute('src') ?? null).catch(() => null);
/** The worker's own exceptions (it throws in its fetch handler where the page never sees it). */
async function watchWorker(b) {
  const target = await b.waitForTarget((x) => x.type() === 'service_worker', { timeout: 10000 });
  const cdp = await target.createCDPSession();
  const seen = [];
  cdp.on('Runtime.exceptionThrown', (e) => seen.push(e.exceptionDetails.exception?.description?.split('\n')[0] ?? e.exceptionDetails.text));
  await cdp.send('Runtime.enable');
  return seen;
}
async function run(name, fn) {
  if (only && !only.includes(name)) return;
  try {
    await fn();
  } catch (e) {
    t.check(`${name}: ran to the end`, false, String(e?.stack ?? e));
    console.log(srv.log.map((x) => `${x.at % 100000} ${x.sw ? 'sw ' : ''}${x.p} ${x.root} ${x.status}`).join('\n'));
  }
}

await run('runtime', async () => {
  const { b, page } = await fresh();
  const thrown = await watchWorker(b);
  const r = await page.evaluate(async (v, net) => {
    const c = await caches.open(`mossbound-${v}`);
    const url = new URL(`assets/${net}`, document.baseURI).href;
    await c.delete(url);
    const res = await fetch(url);
    await res.text();
    await new Promise((r) => setTimeout(r, 500));
    for (let i = 0; i < 3; i++) await (await fetch(new URL('version.json', document.baseURI).href, { cache: 'no-store' })).text();
    return { status: res.status, keptAgain: !!(await c.match(url)) };
  }, VA, netOf(A));
  await page.reload({ waitUntil: 'load' });
  await sleep(800);
  t.check(`a file missing from the cache is fetched (${r.status}) and kept again (${r.keptAgain})`, r.status === 200 && r.keptAgain, r);
  t.check(`…and the worker throws nothing on its fetches (${thrown.length} exceptions)`, thrown.length === 0, thrown.slice(0, 3));
  errors.push(...page.errors);
  await b.close();
});

await run('hole', async () => {
  // the network fails during the update: B's page arrives, B's main script never does
  const { b, page } = await fresh();
  srv.root = B;
  srv.drop.add(entryOf(B));
  await page.reload({ waitUntil: 'load' }).catch(() => undefined);
  await sleep(3000);
  srv.offline = true;
  await page.reload({ waitUntil: 'load' }).catch(() => undefined);
  await waitFor(() => booted(page), 10000, 'boot offline').catch(() => undefined);
  const r = { booted: await booted(page), script: await script(page), caches: await page.evaluate(() => caches.keys()).catch(() => null) };
  t.check(`an update that couldn't fetch its main script doesn't take over: offline the game still opens (${r.script})`, r.booted === true, r);
  errors.push(...page.errors.filter((e) => !/Failed to fetch|ERR_|Load failed/.test(e)));
  await b.close();
});

await run('slow', async () => {
  const { b, page } = await fresh();
  // (past the max-age of everything the first visit fetched: what's cached from here on is the worker's)
  await sleep(1500);
  // (the page request takes 9 s — longer on a slow machine, which also boots slowly)
  const HOLD = 9000 * SLOW;
  srv.hold.set('index.html', HOLD);
  await page.evaluate(() => { window.__old = 1; });
  const t0 = Date.now();
  page.goto(SITE, { waitUntil: 'load' }).catch(() => undefined);
  const ms = await waitFor(() => booted(page), HOLD / 1000 + 20000, 'boot').then(() => Date.now() - t0).catch(() => null);
  t.check(`a cached game on a network taking ${HOLD / 1000} s for the page opens in ${ms ? (ms / 1000).toFixed(1) : '—'} s (under ${HOLD / 2000})`, ms !== null && ms < HOLD / 2, ms);
  errors.push(...page.errors);
  await b.close();
});

await run('lazy', async () => {
  const { b, page } = await fresh();
  await page.evaluate(async () => { const c = await caches.open('another-app-v3'); await c.put(new URL('elsewhere.txt', document.baseURI).href, new Response('theirs')); });
  srv.root = B;
  // another tab brings B's worker in
  const p2 = await b.newPage();
  await p2.goto(SITE, { waitUntil: 'load' });
  await installed(page, VB).catch(() => undefined);
  await sleep(1500);
  // (left in the background: brought to the front, its own updater would see B and reload it at the title)
  const r = await page.evaluate(async (net, worker) => {
    const out = { caches: await caches.keys() };
    try {
      await import(`./assets/${net}`);
      out.net = 'ok';
    } catch (e) {
      out.net = String(e.message);
    }
    out.worker = await new Promise((done) => {
      try {
        const w = new Worker(`./assets/${worker}`, { type: 'module' });
        w.onerror = () => done('failed');
        setTimeout(() => done('ok'), 2500);
      } catch (e) {
        done(String(e.message));
      }
    });
    out.theirs = !!(await caches.has('another-app-v3'));
    return out;
  }, netOf(A), workerOf(A));
  t.check(`a page open across a deploy still loads its networking code (${r.net}) and synth worker (${r.worker})`, r.net === 'ok' && r.worker === 'ok', r);
  t.check(`another project's cache on the same origin survives the update (${r.caches.join(', ')})`, r.theirs, r);
  errors.push(...page.errors);
  await b.close();
});

await run('fresh-html', async () => {
  // GitHub Pages' max-age=600: the browser may keep the page for 10 minutes without asking
  const { b, page } = await fresh({ maxAge: 600 });
  srv.root = B;
  const p2 = await b.newPage();
  await p2.goto(SITE, { waitUntil: 'load' });
  const got = await script(p2);
  t.check(`a launch soon after a deploy gets the new page (${got})`, got === `./assets/${entryOf(B)}`, got);
  errors.push(...page.errors);
  await b.close();
});

await run('bytes', async () => {
  const { b, page } = await fresh();
  await sleep(1500);
  const sent = (since, pred = () => true) => {
    const n = {};
    for (const x of srv.log) if (x.at >= since && x.status === 200 && pred(x)) n[x.p] = (n[x.p] ?? 0) + 1;
    return n;
  };
  const first = sent(0);
  const twice = Object.entries(first).filter(([, k]) => k > 1);
  const woff = Object.keys(first).filter((p) => p.endsWith('.woff'));
  t.check(`a first visit downloads nothing twice (${twice.map(([p, k]) => `${p} ×${k}`).join(', ') || 'none'})`, twice.length === 0, first);
  t.check(`…and never the .woff fonts (${woff.length})`, woff.length === 0, woff);
  // an update: the scripts changed, the styles and fonts didn't
  const t0 = Date.now();
  srv.root = B;
  await page.reload({ waitUntil: 'load' });
  await installed(page, VB);
  await sleep(1500);
  const again = Object.keys(sent(t0, (x) => /\.(css|woff2?)$/.test(x.p)));
  t.check(`an update downloads only what changed (${again.length} unchanged style/font files fetched again)`, again.length === 0, again);
  errors.push(...page.errors);
  await b.close();
});

await run('update-slow', async () => {
  const { b, page } = await fresh();
  // a fresh boot on A, whose first look at the site (3 s in) finds B — and B's page takes 5 s to arrive
  await page.reload({ waitUntil: 'load' });
  srv.root = B;
  srv.hold.set('index.html', 5000);
  const landed = await waitFor(async () => (await badge(page)).startsWith(`v${VB}`), 30000, 'build B').then(() => true).catch(() => false);
  const at = { badge: await badge(page), url: await page.evaluate(() => location.href).catch(() => null) };
  t.check(`an update on a slow network lands on the new build (${at.badge})`, landed, at);
  t.check('…and its address is the plain one again', !!at.url && !/[?&]u=/.test(at.url), at);
  if (!landed) console.log(srv.log.map((x) => `${x.at % 100000} ${x.sw ? 'sw ' : ''}${x.p} ${x.root} ${x.status}`).join('\n'));
  errors.push(...page.errors);
  await b.close();
});

for (const b of browsers) await b.close().catch(() => undefined);
server.close();
t.finish('sw', errors);
