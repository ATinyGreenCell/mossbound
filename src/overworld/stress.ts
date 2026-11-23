/**
 * A long map for testing: the real worlds, then made-up ones repeating their themes, landmarks and
 * bosses (every third with a bonus level off the trail), to `n` worlds. The preview's ?worlds=50 and
 * the test use it; nothing in the game does.
 */
import { WORLDS, spotOf, type Spot, type WorldDef } from '../game/worlds';

export function stressWorlds(n: number, base: readonly WorldDef[] = WORLDS): WorldDef[] {
  const out = base.slice(0, Math.min(n, base.length));
  const gates = ['bridge', 'millrace', 'fallsfoot'];
  for (let w = out.length; w < n; w++) {
    const like = base[w % base.length];
    const count = 5 + (w % 3);
    const marks = like.levels.map(spotOf).filter((s) => !s.from).map((s) => s.mark ?? '');
    const levels: Spot[] = [];
    for (let i = 0; i < count; i++) levels.push({ id: `w${w + 1}-${i + 1}`, name: `Stop ${w + 1}-${i + 1}`, mark: marks[i % marks.length] || undefined });
    if (w % 3 === 1) levels.push({ id: `w${w + 1}-bonus`, name: `Bonus ${w + 1}`, from: `w${w + 1}-2` });
    out.push({
      id: `w${w + 1}`,
      name: `World ${w + 1}`,
      mapTheme: like.mapTheme,
      levels,
      boss: like.boss,
      story: [`World ${w + 1}, a long way up the creek.`],
      gate: { name: `Gate ${w + 1}`, landmark: gates[w % 3] },
      rise: like.rise,
    });
  }
  return out;
}
