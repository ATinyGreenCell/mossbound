/**
 * The game's name, wherever a player reads it: the title screen's logo, the browser tab, the name
 * under the home-screen icon, the install sheet, the invite a player sends. To rename the game,
 * change it here. index.html and the manifest take it from this file when the page is served and
 * built (vite.config.ts). docs/RENAMING.md lists what else to change: the README, the repo, the
 * web address and `mb`.
 *
 * The ids don't change with the name. These stay `mossbound` for good:
 * - the `mossbound.*` storage keys and the `mossbound` database (save.ts, settings.ts, ...);
 * - `MB1-` save codes;
 * - the `mossbound-*` caches (vite.config.ts) and the manifest's `id`;
 * - the ids online rooms meet on (protocol.ts, relay.ts).
 * Players never see them. Changing one would lose every save, leave the installed app orphaned,
 * or stop old and new builds from finding each other online.
 */
export const BRAND = {
  /** The name, as written in a title or a sentence. */
  name: 'Mossbound',
  /**
   * The title screen's logo, split for its two colours: the first part in cream, the second in
   * gold. Lower case, like the rest of the menus.
   */
  logo: ['moss', 'bound'] as readonly [string, string],
  /** The line under the logo. */
  tagline: 'two little sprouts · one vine · any distance',
  /** One sentence for search results and the install sheet. */
  blurb: 'Two little sprouts, one vine. A co-op platformer for two.',
} as const;
