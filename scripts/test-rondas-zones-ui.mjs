/**
 * Synthetic DOM coverage for zones and per-location round controls.
 * No real API, D1, R2, users or operational records are accessed.
 * Uses the same optional jsdom setup as test-rondas-ui.mjs.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const specified = process.env.RONDAS_JSDOM_PATH;
let module;
try { module = await import(specified ? isAbsolute(specified) ? pathToFileURL(specified).href : specified : 'jsdom'); }
catch { console.error('Zone UI DOM tests need jsdom. Use the setup documented in scripts/test-rondas-ui.mjs.'); process.exit(1); }
const { JSDOM, VirtualConsole } = module;
const { outputFiles } = await build({ entryPoints: [resolve(root, 'scripts/fixtures/rondas-zonas-ui.tsx')], absWorkingDir: root, bundle: true, format: 'iife', write: false, jsx: 'automatic' });
for (const mode of ['zones', 'template', 'rounds']) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => console.error('DOM error:', error.message));
  virtualConsole.on('error', (...args) => console.error(...args));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `http://localhost/?run=1&mode=${mode}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(window) { window.Response = Response; },
  });
  dom.window.eval(outputFiles[0].text);
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
