/**
 * Deterministic DOM interaction tests for the rounds UI, not visual/mobile-device QA.
 * The app uses synthetic in-memory endpoints; this script never touches D1 or R2.
 *
 * Requires jsdom (optional, not added to the production project):
 *   npm install --prefix /tmp/rondas-ui-deps --no-save jsdom
 *   RONDAS_JSDOM_PATH=/tmp/rondas-ui-deps/node_modules/jsdom/lib/api.js node scripts/test-rondas-ui.mjs
 * If jsdom is already a dev dependency, `node scripts/test-rondas-ui.mjs` suffices.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const specified = process.env.RONDAS_JSDOM_PATH;
let module;
try { module = await import(specified ? isAbsolute(specified) ? pathToFileURL(specified).href : specified : 'jsdom'); }
catch { console.error('UI DOM tests need jsdom. See the setup commands at the top of scripts/test-rondas-ui.mjs.'); process.exit(1); }
const { JSDOM, VirtualConsole } = module;
const { outputFiles } = await build({ entryPoints: [resolve(root, 'scripts/fixtures/rondas-ui.tsx')], absWorkingDir: root, bundle: true, format: 'iife', write: false, jsx: 'automatic' });
const source = outputFiles[0].text;
for (const mode of ['owner', 'chief', 'pressure']) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => console.error('DOM error:', error.message));
  virtualConsole.on('error', (...args) => console.error(...args));
  const query = mode === 'chief' ? '&chief=1' : mode === 'pressure' ? '&pressure=1' : '';
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `http://localhost/?run=1${query}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(window) { window.Response = Response; window.fetch = fetch; },
  });
  dom.window.eval(source);
  let result = '';
  for (let i = 0; i < 200; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    result = dom.window.document.querySelector('#qa-result')?.textContent || '';
    if (result) break;
  }
  console.log(`${mode}: ${result || 'TIMED OUT'}`);
  dom.window.close();
  if (!result.startsWith('PASS')) process.exitCode = 1;
}
