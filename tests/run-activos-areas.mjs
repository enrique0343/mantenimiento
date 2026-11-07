import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const outfile = path.join(root, '.astro/tests/activos-areas.mjs');
await build({ entryPoints: ['tests/activos-areas.test.mjs'], bundle: true, platform: 'node', format: 'esm', outfile, tsconfig: 'tsconfig.json' });
await import(pathToFileURL(outfile).href);
