# Mossbound

Two little sprouts, one vine. A cozy co-op platformer for two — on one keyboard, two controllers,
or two phones on opposite sides of the world.

**Play:** https://atinygreencell.github.io/mossbound/

The vine keeps you within eight tiles of each other. It catches you when you fall, swings you
across gaps, wraps around rings and corners, and lets you yank your partner over the edge. Neither
sprout gets anywhere alone.

## The two sprouts

- **The tall one** is sturdy. It's heavy on the vine: it holds the small one without budging, drags
  it along rather than being stopped by it, and its tug flings it far. But it jumps a little lower,
  and it can't fit through a one-tile gap.
- **The small one** is nimble. It jumps higher, fits through tight spaces, climbs walls like ivy (and
  jumps off them), has a burst of speed through the air once per jump, grows plants out of patches of
  soil, and shoots its vine nearly twice as far. Its tug barely budges the tall one, so when the tall
  one is the one stuck below, the small one holds on while it climbs up.

Both of them can **kick off a wall** they brush in mid-air. Take two parallel walls in turns and you
can climb the shaft between them; the same wall twice running won't have you.

## What lives there

- **Bristle beetles** pace a patch of ledge and nothing else — they never come after you. Walk
  round one, hop over it, or swing past on the vine. The bristles are the part that smarts.
- **Snaptraps** are rooted. Come close and one rears up, which is your warning and about as long as
  a breath; then it bites, and then it has to rest before it can do it again. One of you can lure
  it while the other crosses.

Neither can really hurt you. Whoever is caught drifts back to their partner as a seed, the same as
a fall, and the last lantern is where you both carry on from.

Both run at the same speed. Whoever made the room (or holds the first controller) starts as the tall
one; either of you can **swap** at the level select. *Settings → sprouts → alike* gives both of you
the same body with every move, if you'd rather not have different powers. Online, the host's choice
holds for both.

## Playing together

- **On one device** — *Play on one screen*: split one keyboard, use two controllers, or mix them. If a
  controller drops out (or dozes off), reconnect it and press Ⓐ to take your sprout back.
- **Far apart** — *Play online*: one of you makes a room and reads out the four-letter code; the other
  joins with it (or opens the invite link, `…/mossbound/#join=CODE`). Phones play in landscape.
- **On your own** — *Practice on your own*: one long practice ground with a signed station for every
  move, and a partner the game walks for you, so the swings and tugs still work single-handed. Nothing
  there can be failed and nothing is written to the journal. Its pause menu swaps which sprout you're
  practising as — half the moves belong to the small one.
- **Xbox** — open the game in Edge and hold **☰ Menu → Use game controls**. Until then Edge keeps the
  controllers for its cursor. Hold **⧉ View** for full screen. For two of you on one Xbox, pick *Play on
  one screen* and each press Ⓐ on your own controller. ☰ or ⧉ opens the menu, and the level also pauses
  whenever the Xbox guide opens. If the controllers stop responding (full screen can take the focus
  away), press the Xbox button twice.

Progress lives in a shared **garden journal**. Each device keeps a copy, and the copies merge whenever you
play together: cleared levels, fireflies and best times are never lost, whoever played. Every level
remembers where you got to, so **Continue** (or that level's own card) picks it back up from its last
lit lantern, and replaying another level for a missing firefly never costs you that. A level can be
started over on purpose from its menu. Lanterns and fireflies are saved the moment you reach them, and
everything else the moment the game is hidden or closed. To move progress to another device, copy the
save code from *Settings* and paste it on the other device.

## Controls

|            | keyboard            | controller          | phone        |
| ---------- | ------------------- | ------------------- | ------------ |
| walk       | A D · ← →           | stick · d-pad       | left thumb   |
| climb      | W S · ↑ ↓           | up / down           | up / down    |
| jump       | Space · Z · K       | Ⓐ                   | JUMP         |
| leaf glide | hold jump (falling) | hold Ⓐ              | hold JUMP    |
| hold on    | Shift · X · J       | Ⓧ · triggers        | HOLD         |
| tug        | E · C · L           | Ⓑ                   | TUG          |
| vine shot  | T · B · O           | RT                  | VINE         |
| dash (small sprout) | R · V · ;  | RB                  | DASH         |
| ♥          | Q · H               | Ⓨ                   | ♥            |
| menu       | Esc                 | ☰ · ⧉               | ❚❚           |

Two on one keyboard: the left player uses WASD, Space, Shift, E, R, Q; the right player uses the
arrows, `/` jump, `.` hold, `,` tug, `;` dash, `[` vine, `M` ♥. The backquote key toggles a frame-rate
meter. Climbing walls (small sprout): push into a wall in the air to cling to it, up / down to climb,
jump to leap off it. Kicking off a wall (either sprout): jump the moment you brush one in mid-air.
The vine shot reaches for a ring, a branch or a corner you can't jump to — and, for the small sprout,
a patch of soil, which grows a leaf you can both stand on.

## Levels

1. **The Garden** — morning · learn the ropes
2. **Woodland Rings** — golden hour · swings and stumps
3. **The Old Mill** — afternoon · plates and gates
4. **Rooftops of Paris** — sunset · chimneys and awnings
5. **The Iron Lady** — night · up, up, together

Each level hides three fireflies. Finding all three earns a hat (flower crown, acorn cap,
straw hat, beret, star).

## How online play stays smooth

- **No input lag.** Each player's sprout is simulated on their own device. The partner's sprout plays back
  from a stream of snapshots (40 a second) through an adaptive jitter buffer. That buffer follows
  smooth curves, slows down rather than freezing when packets go missing, and eases out corrections.
  It stays smooth even with 30% packet loss.
- **Two paths at once.** A direct WebRTC connection (found through public Nostr relays) carries the
  game over an unordered, no-retransmit channel, so one lost packet never holds up the next. If a
  direct link can't be made (strict hotel or mobile networks), everything rides an end-to-end
  encrypted relay over public MQTT brokers instead (AES-GCM, key derived from the room code). The
  game switches between them automatically.
- **Dropouts are survivable.** If a partner goes quiet, the level holds still and says so, then carries
  on when they're back — even after a long absence. If a page reloads, rejoin with the same code (the
  host reopens the room): both continue from the last lantern. Moving platforms run on a shared
  clock, so they match on both screens.
- If neither path works on some network, *Settings* takes the details of a TURN server.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run test:e2e   # end-to-end suite in headless Chrome (online tests need internet)
```

The e2e suite (`tests/e2e/`) drives the real game: physics and swing-energy checks, a scripted run
through every level, a fuzzed input soak, two-browser online play over both paths, outages and
reloads, packet loss and jitter, local multiplayer, two controllers on an (emulated) Xbox, touch, menus, resizing, rendering (tile cache,
GPU resets, the quality governor), saves, the debug ground, and quitting and coming back. Creature behaviour is checked separately in
`tests/e2e/creatures.mjs`, which is pure logic bundled through Vite and so needs no browser at all:
it asserts the two properties that keep two screens showing the same world — a beetle is a function
of the shared clock and never integrated, and a snaptrap's round always comes back to dormant — and
lints every creature placed in every level for footing, walls, a ledge to walk, and distance from
every spawn and lantern. It runs with
`node tests/e2e/run.mjs [--only online,physics] [-j 6]`. Chrome comes from `/usr/bin/google-chrome`,
or set `CHROME_PATH`.

Development-only URL switches (stripped from production builds): `?fast`, `?noaudio`, `?grace=N`,
`?relay`, `?p2p`, `?brokers=url,url`, `?norender`.

### The debug ground

`…/mossbound/#debug` puts a **DEBUG GROUND** button on the title screen, and `#debug=3` drops
straight into that level. Unlike the switches above it is **not** stripped from production, on
purpose: the build worth poking at is the one that is live, on a phone, which is where a mechanic
that only misbehaves on a touch screen will misbehave. It is remembered for the tab and invisible
to anyone who does not type it.

It plays on the practice rules — you alone, the game walking the other sprout so the vine still
works, nothing written to the journal — but on any level rather than the practice ground. The panel
gives: the level picker, lantern ◀▶, UNHURTABLE, NOCLIP, BOXES, TAP TO GO, 1× / ½× / ¼×, FREEZE and
STEP, swap sprout, respawn. BOXES draws the real collision boxes, a snaptrap's reach, a beetle's
whole measured ledge, and the vine bend by bend. The readout underneath carries fps, position,
velocity, state flags, vine length and tautness, the shared clock, and what the nearest creature is
doing with its timer.

## Deploy

Every push to `main` runs the e2e suite, then builds and publishes to GitHub Pages
(`.github/workflows/deploy.yml`; repository *Settings → Pages → Source: GitHub Actions*). **A failing
test stops the publish.** The suite runs there and nowhere else: it drives a real Chrome and its
online groups need live relays, which neither a phone nor a sandbox can provide. A failed group is
retried once — a public broker having a bad minute shouldn't block a release — and anything that
fails twice blocks it. The built site serves `version.json`, so what's live can always be checked.

## The `mb` command

`mb` is the dev loop from a phone: Termux, a clone of this repo, and a build archive dropped in
Downloads. It lives in the repo so it is never lost, and updates itself whenever you sync, pull or
get — so the copy on your PATH follows the one in the repo without being told to.

On a device that has never had it, `mb` comes out of a build archive and fetches the rest itself:

```sh
tar xzOf ~/storage/downloads/mossbound-v*.tar.gz mb > $PREFIX/bin/mb && chmod +x $PREFIX/bin/mb
mb get                    # clones the repository into ~/mossbound

mb status                 # repo / newest download / git, and what the live site serves
mb sync                   # newest build in Downloads -> merged into the repo
mb check                  # type-check and build
mb ship "what changed"    # commit and push
mb release 1.4.1 "what changed"
```

`mb sync` takes the newest *complete* build by the version inside it, never by filename, and brings
it in as a git commit on top of the commit it was made from. Git does the merge, so work done on the
phone survives, and a genuine clash stops the sync before a single file is touched. It refuses a
build older than the repo, one that is only half-downloaded, and one carrying paths this project
doesn't own. `MB_FORCE=1` overrides the first two deliberately.

`mb check` is a type-check and a build — the whole of what a phone can do. The tests are the CI gate
above, which is why `mb ship` says to watch `mb status` rather than claiming anything passed.

## Credits

Art, music and sound are generated in code; there are no image or audio files. Font:
[Fredoka](https://fonts.google.com/specimen/Fredoka) (SIL Open Font License).
