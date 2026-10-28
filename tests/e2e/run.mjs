// End-to-end suite: npm run test:e2e [-- -j 6] [-- --only online,physics]
// Starts a Vite dev server, runs the browser tests in parallel (longest first), then the timing-
// sensitive ones (`solo`) alone, checks each one's pass marker and prints a summary. Needs Chrome (CHROME_PATH overrides /usr/bin/google-chrome);
// the online tests also need internet access (they pair through public Nostr relays / MQTT brokers).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(DIR, '../..');
const argv = process.argv.slice(2);
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const jobs = Number(opt('-j')) || 6;
const only = opt('--only')?.split(',');
const PORT = 5199;

const passed = (label) => (o) => new RegExp(`^${label} OK$`, 'm').test(o) && /--- errors ---\s*\nnone/.test(o);
const TESTS = [
  { name: 'online', file: 'online.mjs', est: 90, pass: passed('online') },
  { name: 'relay', file: 'online.mjs', args: ['relay'], est: 80, pass: passed('online') },
  { name: 'p2p', file: 'online.mjs', args: ['p2p'], est: 80, pass: passed('online') },
  { name: 'outage', file: 'outage.mjs', est: 80, pass: passed('outage') },
  // measures motion smoothness to the pixel: run alone, not fighting ten other browsers for the CPU
  { name: 'net-loss', file: 'netloss.mjs', est: 60, solo: true, pass: passed('net-loss') },
  { name: 'levels', file: 'levels.mjs', est: 40, pass: passed('levels') },
  { name: 'physics', file: 'physics.mjs', est: 25, pass: passed('physics') },
  { name: 'soak', file: 'soak.mjs', est: 60, pass: passed('soak') },
  { name: 'local', file: 'local.mjs', est: 45, pass: passed('local') },
  { name: 'touch', file: 'touch.mjs', est: 35, pass: passed('touch') },
  { name: 'menus', file: 'menus.mjs', est: 35, pass: passed('menus') },
  { name: 'resize', file: 'resize.mjs', est: 25, pass: passed('resize') },
  { name: 'save', file: 'save.mjs', est: 15, pass: passed('save') },
  { name: 'continue', file: 'continue.mjs', est: 90, pass: passed('continue') },
  { name: 'sprouts', file: 'sprouts.mjs', est: 30, pass: passed('sprouts') },
  { name: 'xbox', file: 'xbox.mjs', est: 25, pass: passed('xbox') },
  { name: 'units', file: 'units.mjs', est: 20, pass: passed('units') },
  { name: 'render', file: 'render.mjs', est: 25, pass: passed('render') },
  { name: 'pads', file: 'pads.mjs', est: 45, pass: passed('pads') },
  { name: 'frames', file: 'frames.mjs', est: 25, pass: passed('frames') },
  // times the sound library's build: run alone so a busy machine can't look like a hitch
  { name: 'audio', file: 'audio.mjs', est: 30, solo: true, pass: passed('audio') },
].filter((t) => !only || only.includes(t.name));

async function startServer() {
  if (process.env.E2E_BASE) return { base: process.env.E2E_BASE, stop() {} };
  const vite = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${PORT}/`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) return { base, stop: () => vite.kill() };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  vite.kill();
  throw new Error('dev server did not start');
}

const server = await startServer();
/** each test runs in its own process group, so its browsers die with it even if the test crashes */
const groups = new Set();
const killGroup = (pid) => {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // already gone
  }
};
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    for (const pid of groups) killGroup(pid);
    server.stop();
    process.exit(130);
  });
fs.mkdirSync(path.join(DIR, '.out/logs'), { recursive: true });
const t0 = Date.now();
const results = [];
const queue = TESTS.filter((t) => !t.solo).sort((a, b) => b.est - a.est);

function run(t) {
  return new Promise((resolve) => {
    const start = Date.now();
    const p = spawn(process.execPath, [t.file, ...(t.args ?? [])], { cwd: DIR, env: { ...process.env, E2E_BASE: server.base }, detached: true });
    groups.add(p.pid);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    const killer = setTimeout(() => killGroup(p.pid), 300_000);
    p.on('close', () => {
      clearTimeout(killer);
      killGroup(p.pid);
      groups.delete(p.pid);
      const secs = (Date.now() - start) / 1000;
      fs.writeFileSync(path.join(DIR, '.out/logs', `${t.name}.log`), out);
      const ok = t.pass(out);
      results.push({ ok, secs });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${t.name.padEnd(10)} ${secs.toFixed(1).padStart(6)} s${ok ? '' : `   (tests/e2e/.out/logs/${t.name}.log)`}`);
      resolve();
    });
  });
}

await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) await run(queue.shift());
  }),
);
for (const t of TESTS.filter((x) => x.solo)) await run(t);
server.stop();
const wall = (Date.now() - t0) / 1000;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed · ${wall.toFixed(0)} s wall (${jobs} at a time)`);
process.exit(failed ? 1 : 0);
