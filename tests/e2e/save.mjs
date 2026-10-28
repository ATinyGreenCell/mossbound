// The shared save: merges never lose anything either player earned, every level keeps its own run
// (a later fresh start or more recorded progress wins — never a device's clock), hostile or corrupt
// input is rejected, save codes round-trip, and 1.0.0's save (one run for the whole game) migrates.
import { launch, open, reporter } from './harness.mjs';

const browser = await launch();
const v2 = { unlocked: 2, levels: { garden: { seeds: 30, feathers: 5, time: 200, clears: 1 } }, finished: false, run: { level: 1, cp: 1, seeds: [3, 4], feathers: 2, time: 77, with: 'Pip & Bo' }, runAt: 1 };
const page = await open(browser, { storage: { 'mossbound.save.v2': v2 } });
const r = await page.evaluate(async () => {
  const S = window.__fb.save;
  const out = {};
  const snapshot = () => JSON.parse(JSON.stringify(S.save));
  // 1.0.0's save came across, its one run now the woods' run
  const w = S.save.runs.woods;
  out.migrated = S.save.unlocked === 2 && S.save.levels.garden?.seeds === 30 && S.save.levels.garden?.feathers === 5 && w?.run?.cp === 1 && w.run.seeds.join() === '3,4' && w.run.with === 'Pip & Bo';
  // merge: union of everything
  const run = (cp, time, more = {}) => ({ cp, seeds: [1, 2, 3], feathers: 1, time, with: 'Pip', sig: '', ...more });
  const theirs = { v: 3, unlocked: 3, levels: { garden: { seeds: 25, feathers: 2, time: 150, clears: 4 }, woods: { seeds: 10, feathers: 1, time: 0, clears: 0 } }, finished: false, runs: { mill: { gen: 1, at: 40, run: run(2, 50) } }, clock: 40 };
  out.changed = S.mergeSave(theirs);
  const m = snapshot();
  out.merged = m.unlocked === 3 && m.levels.garden.seeds === 30 && m.levels.garden.feathers === 7 && m.levels.garden.time === 150 && m.levels.garden.clears === 4 && m.levels.woods.feathers === 1 && m.runs.mill?.run?.cp === 2 && m.runs.woods?.run?.cp === 1 && m.clock >= 40;
  // one level's run: more recorded progress wins, an older copy doesn't, a later fresh start does
  S.mergeSave({ ...theirs, runs: { mill: { gen: 1, at: 39, run: run(3, 60) } } });
  out.fewerChangesIgnored = S.save.runs.mill.run.cp === 2;
  S.mergeSave({ ...theirs, runs: { mill: { gen: 1, at: 41, run: run(3, 60) } } });
  out.moreChangesWin = S.save.runs.mill.run.cp === 3;
  S.mergeSave({ ...theirs, runs: { mill: { gen: 2, at: 2, run: run(-1, 5) } } });
  out.freshStartWins = S.save.runs.mill.run.cp === -1 && S.save.runs.mill.gen === 2;
  // a finished level's marker beats an older copy of its run
  S.mergeSave({ ...theirs, runs: { mill: { gen: 2, at: 99, run: null } } });
  S.mergeSave({ ...theirs, runs: { mill: { gen: 2, at: 50, run: run(4, 80) } } });
  out.finishedStaysFinished = S.save.runs.mill.run === null;
  // merging is idempotent and never goes backwards
  const before = JSON.stringify(S.save);
  out.idempotent = S.mergeSave(JSON.parse(before)) === false && JSON.stringify(S.save) === before;
  S.mergeSave({ unlocked: 0, levels: { garden: { seeds: 0, feathers: 0, time: 999, clears: 0 } }, finished: false, runs: {} });
  out.neverBackwards = S.save.unlocked === 3 && S.save.levels.garden.seeds === 30 && S.save.levels.garden.time === 150 && S.save.runs.woods?.run?.cp === 1;
  // hostile / corrupt input
  let threw = false;
  try {
    for (const junk of [null, 42, 'x', [], { unlocked: 'lots' }, { levels: { '../../evil': { seeds: 1e9 } } }, { levels: { garden: { seeds: -5, feathers: 255, time: NaN } } }, { runs: { garden: { gen: 'x', at: -4, run: { cp: 1e9, seeds: ['a', -1, 1e9] } } } }, JSON.parse('{"runs":{"__proto__":{"gen":9,"at":9,"run":{"cp":1}}},"levels":{"__proto__":{"seeds":9}}}'), { unlocked: 1e12 }]) S.mergeSave(junk);
  } catch {
    threw = true;
  }
  const after = snapshot();
  out.hostile = !threw && after.unlocked <= 64 && !after.levels['../../evil'] && after.levels.garden.feathers <= 7 && after.levels.garden.seeds === 30 && Number.isFinite(after.levels.garden.time) && !Object.prototype.gen && (after.runs.garden?.run?.cp ?? 0) <= 64;
  // a finished level closes its own run (and only its own) and unlocks the next
  S.setRun('paris', 1, run(2, 100, { with: 'Bo' }), true);
  S.recordClear('paris', 3, 40, 3, 300, 1);
  out.clearClosesRun = S.save.runs.paris.run === null && S.save.unlocked >= 4 && S.save.levels.paris.clears === 1 && S.save.levels.paris.feathers === 3 && S.save.runs.woods?.run?.cp === 1;
  // a run is never written over by an older start of the same level
  out.olderStartRefused = S.setRun('mill', 1, run(5, 1)) === false && S.save.runs.mill.gen === 2;
  // grown plants ride along in a run (1.3.0), and a garbled list of them is cleaned, not believed
  S.setRun('woods', 9, run(1, 50, { grown: [2, 0] }));
  // (in soil order, whichever order they were grown in: a merge pools two copies of the one list, so
  // every copy of a run has to print its plants the same way round — see makeRun)
  out.grownKept = S.save.runs.woods.run.grown.join() === '0,2';
  S.mergeSave({ ...theirs, runs: { woods: { gen: 9, at: S.save.runs.woods.at + 1, run: run(1, 60, { grown: ['x', -1, 1e9, 3.5, 3, 3, null] }) } } });
  out.grownCleaned = S.save.runs.woods.run.grown.join() === '3' && S.save.runs.woods.run.time === 60;
  // a run saved before 1.3.0 (no `grown` at all) still loads, with no plants grown
  out.grownOptional = Array.isArray(S.cleanSave({ unlocked: 1, runs: { mill: { gen: 1, at: 1, run: { cp: 0, seeds: [1], feathers: 0, time: 30, with: '', sig: '' } } } })?.runs.mill.run.grown);
  // save codes
  const code = S.exportCode();
  localStorage.clear();
  S.save.unlocked = 0;
  S.save.levels = {};
  S.save.runs = {};
  // (as pasted from a chat: wrapped, with a stray zero-width space)
  const pasted = `here: ${code.slice(0, 30)}\n ${code.slice(30, 60)}​${code.slice(60)}  `;
  out.importOk = S.importCode(pasted) && S.save.unlocked >= 4 && S.save.levels.paris?.feathers === 3 && S.save.runs.woods?.run?.cp === 1;
  out.importJunk = !S.importCode('MB1-!!!!') && !S.importCode('hello') && !S.importCode('MB1-' + btoa('[1,2]'));
  out.grownThroughCode = S.save.runs.woods?.run?.grown?.join() === '3';
  // a copy whose shared count is wildly ahead was never counted: believing it would pin our own count
  // for good, and from then on every save would be stamped the same — a stale copy of a run could
  // then overwrite real progress (a corrupted save code, or a partner on a damaged build)
  const wild = (more = {}) => ({ v: 3, unlocked: 0, levels: {}, finished: false, runs: {}, clock: 1e15, ...more });
  const step = (time) => ({ cp: 3, seeds: [], feathers: 0, time, with: '', sig: '' });
  S.save.clock = 10;
  S.mergeSave(wild());
  out.wildCountRefused = S.save.clock === 10;
  S.setRun('garden', 9, step(5));
  const at1 = S.save.runs.garden.at;
  S.setRun('garden', 9, step(40));
  out.countStillAdvances = S.save.runs.garden.at === at1 + 1;
  // the partner's stale copy of that same run, stamped with the made-up count
  S.mergeSave(wild({ runs: { garden: { gen: 9, at: 1e15, run: step(5) } } }));
  out.wildRunRefused = S.save.runs.garden.run.time === 40;
  // a count that's merely ahead (the partner has played more) is still believed
  S.mergeSave({ v: 3, unlocked: 0, levels: {}, finished: false, runs: { garden: { gen: 9, at: 5000, run: step(70) } }, clock: 5000 });
  out.realCountBelieved = S.save.clock === 5000 && S.save.runs.garden.run.time === 70;
  // a copy an older build already pinned at its ceiling starts counting again rather than staying stuck
  S.save.clock = 1e12;
  S.setRun('woods', 9, step(10));
  const stuck = S.save.runs.woods.at;
  S.setRun('woods', 9, step(20));
  out.pinnedCountRecovers = S.save.runs.woods.at === stuck + 1 && S.save.runs.woods.run.time === 20;
  // persisted
  S.persist();
  out.persisted = JSON.parse(localStorage.getItem('mossbound.save.v3')).unlocked >= 4;
  // a dead heat whose only difference is a plant (one of us grew it, or one of us is on a build with
  // no `grown` at all). The tie-break can't read that field — it has to mean the same thing on every
  // version — so without the plants being pooled the two devices would keep different saves for good.
  const heat = (plant) => ({ v: 3, unlocked: 1, levels: {}, finished: false, clock: 3,
    runs: { paris: { gen: 4, at: 3, run: plant ? run(2, 88, { grown: [1, 0] }) : run(2, 88) } } });
  const settle = (mine, theirs) => {
    for (const k of Object.keys(S.save)) delete S.save[k];
    Object.assign(S.save, S.cleanSave(mine));
    S.mergeSave(JSON.parse(JSON.stringify(theirs)));
    return JSON.stringify(S.cleanSave(JSON.parse(JSON.stringify(S.save))));
  };
  const grewIt = settle(heat(true), heat(false));
  const didnt = settle(heat(false), heat(true));
  out.deadHeatAgreesOnPlants = grewIt === didnt && JSON.parse(didnt).runs.paris.run.grown.join() === '0,1';
  // CONTINUE has to bring the plants back too: it's the one path every local resume goes through, and
  // a plant is often the step up to the seeds above it. Like the seeds, they only come back when the
  // map still matches — a level edit moves the patches of soil, so the indices would mean someone else.
  const first = { ...run(1, 44, { grown: [0] }), sig: S.levelSig(0) };
  S.setRun('garden', 3, first);
  const carried = S.resumeOf(0);
  S.setRun('garden', 4, { ...first, sig: 'notthemap' });
  const stale = S.resumeOf(0);
  out.continueBringsThePlantsBack = carried?.grown?.join() === '0' && stale?.grown?.length === 0;
  // and the same thing as a property, over saves neither of us would ever write on purpose: whatever
  // two devices hold, they have to come away agreeing, and a copy they've already taken in must change
  // nothing a second time. (This is the guard on the next field someone adds to a run.)
  let seed = 99991;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const NASTY = [null, undefined, 'seven', {}, [], [0.5], [-1], [1e9], [NaN], [1, 1, 1], [3, 3, 2],
    Array.from({ length: 300 }, (_, i) => i), [0, 'x', 2], [[1]], { 0: 1 }];
  const anyRun = () => {
    const o = run(Math.floor(rnd() * 8) - 1, +(rnd() * 400).toFixed(2), { feathers: Math.floor(rnd() * 8), with: pick(['', 'Pip', 'Fern']), sig: pick(['', 'aaaa', 'bbbb']) });
    const k = rnd();
    if (k < 0.45) o.grown = Array.from({ length: Math.floor(rnd() * 4) }, () => Math.floor(rnd() * 6));
    else if (k < 0.75) o.grown = pick(NASTY);      // a damaged copy, or a build that never had the field
    return o;
  };
  const anySave = () => {
    const runs = {};
    for (const id of ['garden', 'woods', 'mill', 'paris', 'tower']) if (rnd() < 0.7) runs[id] = { gen: Math.floor(rnd() * 3), at: Math.floor(rnd() * 5), run: rnd() < 0.15 ? null : anyRun() };
    return { v: 3, unlocked: Math.floor(rnd() * 5), finished: rnd() < 0.3, clock: Math.floor(rnd() * 5), levels: {}, runs };
  };
  const bad = [];
  for (let n = 0; n < 150 && bad.length < 3; n++) {
    const A = anySave(), B = anySave();
    const ab = settle(A, B);
    if (ab !== settle(B, A)) { bad.push({ why: 'order matters', n }); continue; }
    if (settle(JSON.parse(ab), B) !== ab) bad.push({ why: 'taking it again changed it', n });
    for (const slot of Object.values(JSON.parse(ab).runs)) {
      const g = slot.run?.grown;
      if (!slot.run) continue;
      if (!Array.isArray(g) || g.length > 64 || new Set(g).size !== g.length) bad.push({ why: 'plants not a clean list', n, g });
      else if (g.some((i) => !Number.isInteger(i) || i < 0 || i >= 64) || g.some((i, k) => k && i < g[k - 1])) bad.push({ why: 'plants out of range or order', n, g });
    }
  }
  out.anyTwoDevicesAgree = bad.length === 0 || bad;
  return out;
});
await browser.close();
const t = reporter();
for (const [k, v] of Object.entries(r)) t.check(k, v === true, v);
t.finish('save', page.errors);
