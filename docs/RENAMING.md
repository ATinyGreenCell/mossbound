# Renaming the game

"Mossbound" is a working title, and another game already uses it. Renaming is designed to take a
few minutes and to cost players nothing: their saves, rooms and installed app carry on.

## 1. The name: one file

Edit `src/brand.ts`:

- `name` sets the browser tab, the label under the home-screen icon, the install sheet and the
  invite ("Come play … with me!").
- `logo` is the title screen's wordmark, split in two for its two colours, cream then gold.
  `['knot', 'apart']` draws "knot" in cream and "apart" in gold. Keep it lower case. A long name
  shrinks to stay on one line.
- `tagline` is the line under the logo, and `blurb` is the sentence for search results and the
  install sheet. Change them if they mention the name.

`index.html` and the install manifest take the name from that file (vite.config.ts writes it in).
The menus test checks that the title, tab, home-screen label and manifest agree with it.

## 2. A few words by hand

- `README.md`: the heading and the first paragraph.
- `mb`: `NAME=` is what its messages call the game.
- The repo's description on GitHub, if it names the game.

## 3. What keeps the old name, for good

Players never see these, and every one of them must stay `mossbound`:

| What | Where | Renaming it would |
|---|---|---|
| `mossbound.*` storage keys and the `mossbound` database | `core/save.ts`, `settings.ts`, `tab.ts`, `debug.ts`, `flow.ts`, `update.ts` | lose every save and setting |
| `MB1-` save codes | `core/save.ts` | stop older builds reading new codes, and the other way round |
| `mossbound-*` caches, the manifest's `id: mossbound-game` | `vite.config.ts` | orphan the installed app and its offline copy |
| room ids: `APP_ID`, the relay's topic and key | `net/protocol.ts`, `net/relay.ts` | stop old and new builds finding each other online |
| `mossbound-v*.tar.gz`, the `~/mossbound` clone | `mb` | lose a phone running an older `mb` |
| the package name, the `[mossbound]` log prefix | `package.json`, `app.ts` | (nothing; just leave them) |

A renamed build reads every save and plays online with builds from before the rename.

## 4. The web address (optional)

Staying at `atinygreencell.github.io/mossbound/` costs nothing. Players see it only in the
address bar and in invite links.

**Moving to `…/<newname>/`.** The new address is on the same site, `atinygreencell.github.io`.
Browsers keep saves per site, not per path, so progress, settings and the journal come along by
themselves. GitHub doesn't redirect a renamed repo's Pages address, so the old one has to be bridged:

1. Rename the repo in its Settings. Then update `SLUG` in `mb`, the README's **Play** link, the
   default address in `tests/e2e/live.mjs`, and each clone's remote:
   `git remote set-url origin https://github.com/ATinyGreenCell/<newname>.git`.
   Do this on **every clone first**: the laptop, and the phone's `~/mossbound` that `mb` uses. Once
   a new repo takes the old name (step 2), GitHub stops redirecting the old name to the renamed
   repo, and a clone still pointing there would fetch the redirect repo instead.
2. Make a new public repo called `mossbound`, turn Pages on, and put just these two files in it:

   `index.html` sends everyone on, invite links (`#join=CODE`) included:
   ```html
   <!doctype html>
   <meta charset="utf-8">
   <title>Moved</title>
   <script>
     // the old address's service worker goes. Its caches stay: the new address shares them.
     navigator.serviceWorker?.getRegistrations().then((rs) => rs.forEach((r) => r.scope.endsWith('/mossbound/') && r.unregister()));
     location.replace('../NEWNAME/' + location.search + location.hash);
   </script>
   ```
   `version.json` makes a game left open at the old address (the Xbox on its title screen) reload
   into the redirect, the way it takes an update:
   ```json
   {"version":"99.0.0"}
   ```
3. On each phone, add the new address to the home screen and remove the old icon. The old icon
   still works through the redirect, but it opens with the browser's bar showing.

**A custom domain** (`newname.com`) is a different site, so saves would *not* come along. Move each
device's progress first with Settings → save code, or stay on github.io.
