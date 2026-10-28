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
  return out;
});
await browser.close();
const t = reporter();
for (const [k, v] of Object.entries(r)) t.check(k, v === true, v);
t.finish('save', page.errors);
