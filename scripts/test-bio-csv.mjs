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

// Fórmulas de Excel: el texto que empieza con =, +, -, @, tabulador o retorno queda como texto.
es(celda('=1+1'), "'=1+1", 'igual');
es(celda('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`, 'fórmula con comillas y coma');
es(celda('@SUMA(A1)'), "'@SUMA(A1)", 'arroba');
es(celda('+503 2537 6161'), "'+503 2537 6161", 'teléfono con +: sin #NULL! en Excel');
es(celda('-2+3+cmd|x'), "'-2+3+cmd|x", 'menos seguido de fórmula');
es(celda('\t=1'), "'\t=1", 'tabulador delante');
es(celda('-2.5'), '-2.5', 'negativo escrito como texto');
es(celda('-1,5'), '"-1,5"', 'negativo con coma decimal');
es(celda('+5'), '+5', 'positivo con signo');
es(celda('-'), '-', 'guion solo');
es(celda(-3), '-3', 'número');
es(celda("'=ya protegido"), "'=ya protegido", 'no se protege dos veces');
es(celda('Laboratorio = Metrología'), 'Laboratorio = Metrología', 'igual en medio');

console.log(`PASS test-bio-csv: ${n} casos; marcas de SV con espacio, de SQLite en ISO y fórmulas de Excel como texto.`);
