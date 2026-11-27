/**
 * The worlds of the overworld map: the journey upstream along the creek, after the jay who stole the
 * seed. Each world is ONE entry in WORLDS below — its stops in order, its boss, its storybook card —
 * and the map lays itself out from that alone (see overworld/layout.ts and docs/MAKING-WORLDS.md).
 *
 * A stop is a level id from levels.ts. An id with no level behind it yet is a PLANNED level: the map
 * shows it as a faint "coming soon" stone, and the trail runs on past it (so the levels that do exist
 * stay playable in order). Give the level a LevelDef with that id and it becomes playable, in place.
 *
 * Append only: a new world goes at the END of the list, and nothing already on the map moves.
 */
import type { LevelDef } from './level';
import { COURSE, LEVELS, PRACTICE } from './levels';

/** A boss portrait painted on the map (overworld/bosses.ts). */
export type BossArt = 'snip' | 'rummage' | 'jangle';

/** One stop on a world's trail. A bare string in `levels` is shorthand for `{ id }`. */
export interface Spot {
  /** a level id from levels.ts — or a new id for a level that isn't built yet (shown "coming soon") */
  id: string;
  /** name and subtitle for a planned level (a built one shows its LevelDef's) */
  name?: string;
  subtitle?: string;
  /** a side spot hanging off another stop of this world (its id, or 'gate'): a bonus level, a branch */
  from?: string;
  /** open from the start, never locks anything (the practice ground, the test course) */
  free?: boolean;
  /** a landmark painted beside this stop: pond, reeds, rapids, ferns, hollowtree, barn, den, cliff, crags, nest */
  mark?: string;
  /** hand placement: where this stop sits, relative to its world's gate, in map units (x east, y south) */
  at?: [number, number];
}

export interface Boss {
  /** the boss's name and a line about them, for the map's card */
  name: string;
  line: string;
  art: BossArt;
}

export interface WorldDef {
  /** unique, never renamed (saves and the map's layout seed hang off it) */
  id: string;
  name: string;
  /** a map theme from overworld/themes.ts ('meadow', 'millnight', 'falls'), or any level theme id */
  mapTheme: string;
  /** the trail, in order. The last stop on the main trail is the boss's when `boss` is set */
  levels: (string | Spot)[];
  boss?: Boss;
  /**
   * The storybook card at the world's gate: it opens by itself the first time the pair gets there, and
   * on Ⓐ at the book after that. One string per page; {1} and {2} are the two players' names.
   */
  story?: string[];
  /** the picture on the storybook card: a boss, or a landmark ('nest') — default: the world's boss */
  storyArt?: string;
  /** the gate the world opens with: its name, its landmark (home, bridge, millrace, fallsfoot), placement */
  gate?: { name?: string; landmark?: string; at?: [number, number] };
  /** how far the trail climbs north at each stop, in map units (cliffs and falls); 0 = level ground */
  rise?: number;
}

export const WORLDS: WorldDef[] = [
  {
    id: 'creek',
    name: 'The Creek',
    mapTheme: 'meadow',
    gate: { name: 'Home', landmark: 'home' },
    story: [
      '{1} and {2} had saved one seed, the very best one, to plant together. One misty morning a jay swooped down, snatched it, and flew off upstream toward the Great Falls.',
    ],
    storyArt: 'jangle',
    levels: [
      { id: 'practice', from: 'gate', free: true },
      { id: 'course', from: 'gate', free: true },
      'garden',
      { id: 'woods', mark: 'ferns' },
      { id: 'shallows', mark: 'reeds' },
      { id: 'lilypond', mark: 'pond' },
      { id: 'reedrun', mark: 'reeds' },
      { id: 'rapids', name: "Snip's Rapids", mark: 'rapids' },
    ],
    boss: { name: 'Old Snip', line: 'keeps the creek · snips anything green', art: 'snip' },
  },
  {
    id: 'mill',
    name: 'The Mill by Night',
    mapTheme: 'millnight',
    gate: { name: 'The Mill Race', landmark: 'millrace' },
    story: [
      "By the time they reached the old mill the sun was going down — and there wasn't a firefly left in the whole wood. Someone had been very busy with a jar.",
    ],
    levels: [
      'mill',
      { id: 'millpond', name: 'The Millpond', mark: 'pond' },
      { id: 'lightsout', name: 'Lights Out' },
      { id: 'hollow', name: 'The Hollow', mark: 'hollowtree' },
      { id: 'yard', name: 'Moonlit Yard', mark: 'barn' },
      { id: 'den', name: "Rummage's Den", mark: 'den' },
    ],
    boss: { name: 'Rummage', line: 'bottles the fireflies · then comes for you', art: 'rummage' },
  },
  {
    id: 'falls',
    name: 'The Great Falls',
    mapTheme: 'falls',
    gate: { name: 'Foot of the Falls', landmark: 'fallsfoot' },
    rise: 70,
    story: ['With the fireflies lighting the way, they climbed toward the roar of the Great Falls. Something glinted at the very top.'],
    storyArt: 'nest',
    levels: [
      { id: 'paris', mark: 'cliff' },
      { id: 'tower', mark: 'cliff' },
      { id: 'spray', name: 'Spray Bridges', mark: 'cliff' },
      { id: 'crags', name: 'The Crags', mark: 'crags' },
      { id: 'above', name: 'Above the Falls' },
      { id: 'hoard', name: "Jangle's Hoard", mark: 'nest' },
    ],
    boss: { name: 'Jangle', line: 'stole their seed · hoards it atop the falls', art: 'jangle' },
  },
];

const BUILT = new Map<string, LevelDef>([...LEVELS, PRACTICE, COURSE].map((d) => [d.id, d]));

/** The level behind a stop, or undefined while it's only planned. */
export const levelDef = (id: string): LevelDef | undefined => BUILT.get(id);

/** A `levels` entry as a Spot. */
export const spotOf = (s: string | Spot): Spot => (typeof s === 'string' ? { id: s } : s);
