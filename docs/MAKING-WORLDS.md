# Making levels and worlds

The map is the game's level select: the two sprouts walk a trail up the creek, stop by stop, and Ⓐ
goes into the level they stand on. It is drawn from one list: `WORLDS` in
[`src/game/worlds.ts`](../src/game/worlds.ts). Each world is one entry. The map works out the
rest from that entry: the trail, the creek, the trees, where the stops go, and the boss's place.
You only change data.

A **stop** is a level id. If no level has that id yet, the stop is **planned**: the map shows a
faint stone with a seed on it, says "coming soon", and lets the sprouts walk past it. When you
build the level, the stop becomes playable where it already is.

## Add a level

1. Build it in [`src/game/levels.ts`](../src/game/levels.ts). A level is a function that sculpts
   a map with the `Map` builder at the top of that file (ground, pits, ledges; the map legend is in
   [`src/game/level.ts`](../src/game/level.ts)) and returns a `LevelDef`. Copy `garden()` to start.
   Give it an `id`, and add it **at the end** of `LEVELS`. (Where a level sits on the map is up to
   `WORLDS`. The order of `LEVELS` is what the two players' devices name levels by when one starts
   a level for both, and an older build on the other device goes by it too, so never reorder it.)
2. Put the id on the map:
   - If the id is already a planned stop (for example `shallows`), you're done. Drop the
     `name:` from that stop if you like: the level's own name and subtitle are used now.
   - If not, add the id to a world's `levels` list in `worlds.ts`, where it goes on the trail.
3. Check it (see the end of this guide).

Saves keep everything by level id, so a level added anywhere on the map keeps its fireflies, best
time and run. An older journal's "levels unlocked" count still opens what it opened; it counts the
five levels from before the map only (`LEGACY_LEVELS` in `src/core/save.ts`: never add to it).

## Add a world

Add **one entry at the end** of `WORLDS`:

```ts
{
  id: 'meadows',                // unique; never rename it (the layout is seeded from it)
  name: 'The High Meadows',
  mapTheme: 'meadow',           // see "Map themes" below
  gate: { name: 'The Stile', landmark: 'bridge' },
  story: ['First page of the storybook.', 'Second page.'],
  levels: [
    { id: 'buttercups', name: 'Buttercup Hill' },   // planned: just a name for now
    { id: 'beehive', name: 'The Beehive', mark: 'barn' },
    { id: 'honey', name: 'Honey Pot', from: 'beehive' },   // a bonus level, off the trail
    { id: 'windmill', name: 'Windy Top' },
    { id: 'queen', name: "The Queen's Lawn" },              // the last stop is the boss's
  ],
  boss: { name: 'Old Snip', line: 'back for more', art: 'snip' },
},
```

That's all. The new world joins the trail after the last one. **Nothing already on the map
moves**: each world is laid out from its own id and from where the world before it ended. (The
test checks this.)

Rules:

- **Append only.** New worlds go at the end. Never put one between two others.
- **Ids are unique** across the whole map (a level id appears once).
- Adding a stop to an *existing* world is fine: that world gets longer and the worlds after it
  shift east. Nothing else changes.

### What each field does

| field | |
|---|---|
| `id` | Never change it. |
| `name` | Shown on the card ("World 4 · The High Meadows"). |
| `mapTheme` | How it looks: `'meadow'`, `'millnight'`, `'falls'`, or the id of any level theme in [`src/render/theme.ts`](../src/render/theme.ts) (the meadow, leaning toward that level's colours and its time of day). A name it doesn't know gets the meadow. |
| `levels` | The stops in order. A string is a level id. An object adds options (below). |
| `boss` | Name and line for the card. `art` is the portrait: `'snip'`, `'rummage'` or `'jangle'`. |
| `story` | The storybook at the gate: one string per page. `{1}` and `{2}` are the two players' names (Pip and Bo if they haven't set one). It opens by itself the first time a device sees the pair at the gate, then on Ⓐ at the book. |
| `storyArt` | The storybook's picture: `'snip'`, `'rummage'`, `'jangle'`, or a landmark (`'nest'`). Default: the world's boss. |
| `gate` | The gate's name and landmark: `'bridge'` (default), `'millrace'`, `'fallsfoot'`, `'home'`. |
| `rise` | How far the trail climbs north at each stop (World 3 uses 70). Leave it out for flat ground. |

Stop options:

| option | |
|---|---|
| `name`, `subtitle` | For a planned level (a built level uses its own). |
| `from: 'stopid'` | A side spot off that stop (a bonus level, a branch). `from: 'gate'` hangs it off the gate. |
| `free: true` | Always open, unlocks nothing (the practice ground, the test course). |
| `mark` | A landmark by the stop: `pond`, `reeds`, `rapids`, `ferns`, `crags`, `cliff`, `hollowtree`, `barn`, `den`, `nest`. |
| `at: [x, y]` | Place it by hand (below). |

### Placing a stop by hand

The layout places everything itself. To move one stop, give it `at: [x, y]`: where it goes in map
units from its world's gate (x to the east, y to the south; a hop between stops is about 216).
Open the preview with `&coords` and the card shows every stop's current `at:` to start from.
Only that stop moves. Stops on the trail must stay east of the one before (by about 100 at least).

### Unlocking

A stop opens when the stop before it on the trail is cleared. Planned stops and gates don't hold
anything back. A world's gate opens when the last world's boss stop is cleared (or is still
planned). A side spot opens once the stop it hangs off is cleared (a `free` one at once).

## Map themes

A theme is a palette plus what grows there. The three built ones are in
[`src/overworld/themes.ts`](../src/overworld/themes.ts) (`MAP_THEMES`). A world whose `mapTheme` is
a *level* theme gets one made automatically: the meadow's colours leaning toward that level's
ground, stone and water, in that level's light (a level with a moon makes the map night). So a new
world never needs its own theme.

To make a custom one, copy an entry in `MAP_THEMES`, give it a new key, and change the colours.
`grade` is the time of day from the world's start to its end (colours the map is multiplied by;
white is plain daylight). `night` says how dark each of those is (0 to 1): from about 0.2 the
windows light up and fireflies come out. `decor` is what grows, with relative weights.

A new boss portrait is a drawing function in
[`src/overworld/bosses.ts`](../src/overworld/bosses.ts), plus its `BOSS_BOX` and `BOSS_SCALE`
entries and a name in `BossArt` (in `worlds.ts`).

## Check it

- `npm run dev`, then play: the map is the level select (PLAY ON ONE SCREEN, or PLAY ONLINE).
- Or open `/overworld.html?cleared=all&at=<stop id>` (dev only, not in the game's build). Arrows or WASD walk, Enter is Ⓐ, a tap walks to a stop. Useful switches:
  `cleared=garden,woods`, `ff=garden:2` (fireflies found), `best=garden:83`, `run=woods:1`,
  `coords`, `stats`, `worlds=50`, `extra=<theme>` (a made-up world in that theme).
  In the preview, **C** clears the stop you're on (watch the paths grow) and **R** starts over.
- `node tests/e2e/overworld.mjs` checks the layout: no overlapping stops, every stop reachable, the
  creek clear of the stops, and that adding a world moves nothing. It needs no browser and takes
  a few seconds. `tests/e2e/map.mjs` plays the map in a browser (walking, going in, coming back
  after a clear, CONTINUE, the storybook, a phone, a pad, and online).

Online needs nothing extra: whoever made the room walks the pair, the other screen follows by stop id,
and going into a level is the same message as ever. A build from before the map can still play with
one that has it (it shows its own level select).
