import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/**
 * The built site says which version it is, at a fixed path. `mb status` reads it to tell whether the
 * live site has caught up with the repo — without it there is no way to know from outside whether a
 * push actually published, only that a workflow said it did.
 */
function versionFile() {
  return {
    name: 'mossbound-version',
    generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) + '\n' });
    },
  };
}

// Relative base so the build works from any GitHub Pages sub-path (user.github.io/<repo>/).
export default defineConfig({
  base: './',
  plugins: [versionFile()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
