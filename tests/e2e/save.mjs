// The shared save: merges never lose anything either player earned, the newest run wins, hostile or
// corrupt input is rejected, save codes round-trip, and an old (v1) save migrates.
import { launch, open, reporter } from './harness.mjs';

const browser = await launch();
const page = await open(browser, { storage: { 'mossbound.progress.v1': { unlocked: 2, levels: { garden: { seeds: 30, feathers: 5, time: 200 } }, finished: false } } });
const r = await page.evaluate(async () => {
  const S = await import('/src/core/save.ts');
  const out = {};
  const snapshot = () => JSON.parse(JSON.stringify(S.save));
  // v1 migration happened on load
  out.migrated = S.save.unlocked === 2 && S.save.levels.garden?.seeds === 30 && S.save.levels.garden?.feathers === 5 && S.save.levels.garden?.clears >= 1;
  // merge: union of everything
  const theirs = { unlocked: 3, levels: { garden: { seeds: 25, feathers: 2, time: 150, clears: 4 }, woods: { seeds: 10, feathers: 1, time: 0, clears: 0 } }, finished: false, run: { level: 1, cp: 1, seeds: [1, 2, 3], feathers: 1, time: 50, with: 'Pip' }, runAt: Date.now() + 1000 };
  out.changed = S.mergeSave(theirs);
  const m = snapshot();
  out.merged = m.unlocked === 3 && m.levels.garden.seeds === 30 && m.levels.garden.feathers === 7 && m.levels.garden.time === 150 && m.levels.garden.clears === 4 && m.levels.woods.feathers === 1 && m.run?.level === 1 && m.run.cp === 1;
  // an older run doesn't replace a newer one; a newer "no run" (level finished) does
  S.mergeSave({ ...theirs, run: { level: 0, cp: 0, seeds: [], feathers: 0, time: 1, with: '' }, runAt: 1 });
  out.olderRunIgnored = S.save.run?.level === 1;
  S.mergeSave({ unlocked: 0, levels: {}, finished: false, run: null, runAt: Date.now() + 5000 });
  out.newerClearWins = S.save.run === null;
  // merging is idempotent and never goes backwards
  const before = JSON.stringify(S.save);
  out.idempotent = S.mergeSave(JSON.parse(before)) === false && JSON.stringify(S.save) === before;
  S.mergeSave({ unlocked: 0, levels: { garden: { seeds: 0, feathers: 0, time: 999, clears: 0 } }, finished: false, run: null, runAt: 0 });
  out.neverBackwards = S.save.unlocked === 3 && S.save.levels.garden.seeds === 30 && S.save.levels.garden.time === 150;
  // hostile / corrupt input
  let threw = false;
  try {
    for (const junk of [null, 42, 'x', [], { unlocked: 'lots' }, { levels: { '../../evil': { seeds: 1e9 } } }, { levels: { garden: { seeds: -5, feathers: 255, time: NaN } } }, { run: { level: 1e9, seeds: ['a', -1, 1e9] } }, { unlocked: 1e12 }]) S.mergeSave(junk);
  } catch {
    threw = true;
  }
  const after = snapshot();
  out.hostile = !threw && after.unlocked <= 64 && !after.levels['../../evil'] && after.levels.garden.feathers <= 7 && after.levels.garden.seeds === 30 && Number.isFinite(after.levels.garden.time);
  // a finished level closes the run and unlocks the next
  S.setRun({ level: 3, cp: 2, seeds: [4, 5], feathers: 2, time: 100, with: 'Bo' });
  S.recordClear('paris', 3, 40, 3, 300);
  out.clearClosesRun = S.save.run === null && S.save.unlocked >= 4 && S.save.levels.paris.clears === 1 && S.save.levels.paris.feathers === 3;
  // save codes
  const code = S.exportCode();
  localStorage.clear();
  const S2 = { ...S };
  S.save.unlocked = 0;
  S.save.levels = {};
  out.importOk = S2.importCode(`  ${code}  `) && S.save.unlocked >= 4 && S.save.levels.paris?.feathers === 3;
  out.importJunk = !S.importCode('MB1-!!!!') && !S.importCode('hello') && !S.importCode('MB1-' + btoa('{"unlocked":"x"}'));
  // persisted
  S.persist();
  out.persisted = JSON.parse(localStorage.getItem('mossbound.save.v2')).unlocked >= 4;
  return out;
});
await browser.close();
const t = reporter();
for (const [k, v] of Object.entries(r)) t.check(k, v === true, v);
t.finish('save', page.errors);
