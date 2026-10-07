/**
 * Regression coverage for creating a template with the real 21-point catalog.
 * All requests and identities are synthetic; this never accesses D1, R2 or users.
 * Requires the optional jsdom setup documented in scripts/test-rondas-ui.mjs.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const specified = process.env.RONDAS_JSDOM_PATH;
let module;
try { module = await import(specified ? isAbsolute(specified) ? pathToFileURL(specified).href : specified : 'jsdom'); }
catch { console.error('Template UI tests need jsdom. Use the setup documented in scripts/test-rondas-ui.mjs.'); process.exit(1); }
const { JSDOM, VirtualConsole } = module;
const { outputFiles } = await build({ entryPoints: [resolve(root, 'scripts/fixtures/rondas-template-validation-ui.tsx')], absWorkingDir: root, bundle: true, format: 'iife', write: false, jsx: 'automatic' });
for (const mode of ['validation', 'errors', 'version']) {
  const virtualConsole = new VirtualConsole();
  let domError = false;
  virtualConsole.on('jsdomError', error => { domError = true; console.error('DOM error:', error.message); });
  virtualConsole.on('error', (...args) => console.error(...args));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `http://localhost/?run=1&mode=${mode}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(window) { window.Response = Response; window.HTMLElement.prototype.scrollIntoView = () => {}; },
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
  if (!result.startsWith('PASS') || domError) process.exitCode = 1;
}
