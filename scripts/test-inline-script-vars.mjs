// Local HTML-parser/JavaScript regression. No API, D1, R2, or external messages.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { parse as parseHtml } from 'parse5';
import { parse as parseAstro } from '@astrojs/compiler';
import ts from 'typescript';
import { defineScriptVars } from '../node_modules/astro/dist/runtime/server/render/util.js';
import { encodeInlineScriptVars } from '../src/lib/inline-script-vars.ts';

function scriptNodes(html) {
  const scripts = [];
  function walk(node) {
    if (node.tagName === 'script') scripts.push(node.childNodes.map(n => n.value ?? '').join(''));
    for (const child of node.childNodes ?? []) walk(child);
  }
  walk(parseHtml(html));
  return scripts;
}

const payloads = [
  '</ScRiPt><script>globalThis.__injected = true</ScRiPt>',
  '</script ><script>globalThis.__injected = true</ScRiPt>',
  '</script/><script>globalThis.__injected = true</ScRiPt>',
  '</script\t><script>globalThis.__injected = true</ScRiPt>',
  '</SCRIPT\n><script>globalThis.__injected = true</ScRiPt>',
];

// Reproduce the installed renderer's bug when present; allow a future native fix.
const unsafe = `<script>${defineScriptVars({ value: payloads[0] })}</script>`;
const unsafeScripts = scriptNodes(unsafe);
if (unsafeScripts.length > 1) {
  const baseline = createContext({});
  runInContext(unsafeScripts[1], baseline);
  assert.equal(baseline.__injected, true, 'The vulnerable baseline must execute the injected script locally');
}

for (const payload of payloads) {
  const vars = {
    value: payload,
    nested: { title: 'Presión < 3 bar · Ñandú 🩺', entries: [payload, null, true, 12.5] },
    jsonText: JSON.stringify([{ descripcion: payload, nombre: 'A&B " / %' }]),
    absent: undefined,
    empty: '',
    nil: null,
    negativeZero: -0,
    notANumber: NaN,
    infinite: Infinity,
    date: new Date('2026-10-05T12:00:00Z'),
    separators: '\u2028\u2029',
    loneSurrogate: '\ud800',
  };
  const encoded = encodeInlineScriptVars(vars);
  const rendered = defineScriptVars({ __encodedScriptVars: encoded });
  assert(!rendered.includes('<'), 'No HTML-closing syntax may reach the script body');
  const keys = Object.keys(vars).join(', ');
  const html = `<script>(function(){${rendered}\nconst { ${keys} } = JSON.parse(decodeURIComponent(__encodedScriptVars));\nglobalThis.recovered = { ${keys} };})();</script>`;
  const scripts = scriptNodes(html);
  assert.equal(scripts.length, 1, 'Encoded input must remain inside the original script');
  const context = createContext({});
  for (const script of scripts) runInContext(script, context);
  assert.equal(context.__injected, undefined, 'Attacker-provided JavaScript must never execute');
  // Compare each value with Astro's previous per-variable JSON serialization.
  for (const [key, value] of Object.entries(vars)) {
    const serialized = JSON.stringify(value);
    assert.equal(JSON.stringify(context.recovered[key]), serialized, `${key} must preserve JSON semantics`);
    if (serialized === undefined) assert.equal(context.recovered[key], undefined);
  }
  assert.equal(context.recovered.value, payload);
  assert.equal(context.recovered.jsonText, vars.jsonText);
  assert.equal(context.recovered.loneSurrogate, vars.loneSurrogate);
}

// Keep future DB/request-derived define:vars sites behind the same boundary.
const root = fileURLToPath(new URL('../src', import.meta.url));
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.astro') ? [join(dir, e.name)] : []))).flat();
}
let protectedScripts = 0;
for (const file of await files(root)) {
  const source = await readFile(file, 'utf8');
  const { ast } = await parseAstro(source);
  function walk(node) {
    if (node.name === 'script') {
      const vars = node.attributes?.find(a => a.name === 'define:vars');
      if (vars) {
        const parsed = ts.createSourceFile('vars.ts', `const vars = (${vars.value});`, ts.ScriptTarget.Latest, true);
        assert.equal(parsed.parseDiagnostics.length, 0, `Invalid define:vars in ${file}`);
        const outer = parsed.statements[0]?.declarationList?.declarations[0]?.initializer?.expression;
        assert(outer && ts.isObjectLiteralExpression(outer) && outer.properties.length === 1, `Raw additional define:vars in ${file}`);
        const property = outer.properties[0];
        assert(ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === '__encodedScriptVars', `Unsafe define:vars key in ${file}`);
        const call = property.initializer;
        assert(ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === 'encodeInlineScriptVars' && call.arguments.length === 1, `Unsafe define:vars encoding in ${file}`);
        assert(source.includes('import { encodeInlineScriptVars }'), `Missing encoding helper in ${file}`);
        assert(node.children?.some(c => c.value?.includes('JSON.parse(decodeURIComponent(__encodedScriptVars))')), `Missing decoding in ${file}`);
        protectedScripts++;
      }
    }
    for (const child of node.children ?? []) walk(child);
  }
  walk(ast);
}
assert(protectedScripts > 0, 'The source coverage guard must find real scripts');
console.log(`PASS inline script vars: ${payloads.length} HTML-parser/VM attacks blocked, JSON values preserved, ${protectedScripts} scripts protected; vulnerable baseline reproduced=${unsafeScripts.length > 1}`);
