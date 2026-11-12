// Fase 59 (§f.5): en los CSV, una marca ya en hora de El Salvador ('AAAA-MM-DD HH:MM')
// conserva su espacio; las marcas de SQLite con segundos siguen pasando a ISO como antes.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: ['src/lib/csv.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false });
const { toCsv } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let n = 0;
const es = (r, esperado, nota) => { n++; assert.equal(r, esperado, nota); };
const celda = (v) => toCsv([{ v }], [{ key: 'v', label: 'V' }]).split('\r\n')[1];

es(celda('2026-11-12 10:10'), '2026-11-12 10:10', 'marca de SV sin segundos: queda con espacio');
es(celda('2026-11-12 23:59'), '2026-11-12 23:59', 'otra marca de SV');
es(celda('2026-11-12 10:10:05'), '2026-11-12T10:10:05', 'marca de SQLite con segundos: pasa a ISO como antes');
es(celda('2026-11-12T10:10:05.000Z'), '2026-11-12T10:10:05.000Z', 'ISO con Z: sin cambios');
es(celda('2026-11-12'), '2026-11-12', 'fecha sola: sin cambios');
es(celda('Sí'), 'Sí', 'texto');
es(celda(null), '', 'vacío');
es(celda('a, b'), '"a, b"', 'coma entre comillas');
es(toCsv([], [{ key: 'v', label: 'V' }]).charCodeAt(0), 0xfeff, 'BOM para Excel');

console.log(`PASS test-bio-csv: ${n} casos; marcas de SV con espacio y de SQLite en ISO.`);
