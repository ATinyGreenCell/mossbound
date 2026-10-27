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
  jumps off them), and has a burst of speed through the air once per jump. Its tug barely budges the
  tall one, so when the tall one is the one stuck below, the small one holds on while it climbs up.

Both run at the same speed. Whoever made the room (or holds the first controller) starts as the tall
one; either of you can **swap** at the level select. *Settings → sprouts → alike* gives both of you
the same body with every move, if you'd rather not have different powers. Online, the host's choice
holds for both.

## Playing together

- **On one device** — *Play on one screen*: split one keyboard, use two controllers, or mix them. If a
  controller drops out (or dozes off), reconnect it and press Ⓐ to take your sprout back.
- **Far apart** — *Play online*: one of you makes a room and reads out the four-letter code; the other
  joins with it (or opens the invite link, `…/mossbound/#join=CODE`). Phones play in landscape.
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
| dash (small sprout) | R · V · ;  | RB                  | DASH         |
| ♥          | Q · H               | Ⓨ                   | ♥            |
| menu       | Esc                 | ☰ · ⧉               | ❚❚           |

Two on one keyboard: the left player uses WASD, Space, Shift, E, R, Q; the right player uses the
arrows, `/` jump, `.` hold, `,` tug, `;` dash, `M` ♥. The backquote key toggles a frame-rate meter.
Climbing walls (small sprout): push into a wall in the air to cling to it, up / down to climb, jump
to leap off it.

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
GPU resets, the quality governor), saves, and quitting and coming back. It runs with
`node tests/e2e/run.mjs [--only online,physics] [-j 6]`. Chrome comes from `/usr/bin/google-chrome`,
or set `CHROME_PATH`.

Development-only URL switches (stripped from production builds): `?fast`, `?noaudio`, `?grace=N`,
`?relay`, `?p2p`, `?brokers=url,url`, `?norender`.

## Deploy

Every push to `main` builds and publishes to GitHub Pages
(`.github/workflows/deploy.yml`; repository *Settings → Pages → Source: GitHub Actions*).

## Credits

Art, music and sound are generated in code; there are no image or audio files. Font:
[Fredoka](https://fonts.google.com/specimen/Fredoka) (SIL Open Font License).
