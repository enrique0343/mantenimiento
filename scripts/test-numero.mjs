// Cómo se lee un número escrito a mano: coma o punto decimal, y el separador de
// miles no se adivina. La misma regla la usan el celular, la ficha y el servidor.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: ['src/lib/numero.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false });
const { leerNumero, numeroAlInicio, valorDe } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const num = (valor) => ({ tipo: 'numero', valor });
const amb = (mensaje) => ({ tipo: 'ambiguo', mensaje });

// Campo de solo número (parada de ronda, paso del checklist).
es(leerNumero('14,5'), num(14.5), 'coma decimal');
es(leerNumero('14.5'), num(14.5), 'punto decimal');
es(leerNumero(' 9,8 '), num(9.8), 'con espacios alrededor');
es(leerNumero('12'), num(12), 'entero');
es(leerNumero('-3,25'), num(-3.25), 'negativo');
es(leerNumero('+5'), num(5), 'con signo');
es(leerNumero('0,500'), num(0.5), 'empieza en cero: no es de miles');
es(leerNumero('1,2005'), num(1.2005), 'cuatro decimales');
es(leerNumero('1000,500'), num(1000.5), 'cuatro cifras antes de la coma');
es(leerNumero('1,25'), num(1.25), 'dos decimales');
es(leerNumero(14.5), num(14.5), 'ya es número');
es(leerNumero(''), { tipo: 'vacio' }, 'vacío');
es(leerNumero(null), { tipo: 'vacio' }, 'null');
es(leerNumero('   '), { tipo: 'vacio' }, 'solo espacios');
es(leerNumero(Number.NaN), { tipo: 'texto' }, 'NaN no es número');
es(leerNumero('1,200'), amb('¿1200 o 1,2? Escribe el número sin separador de miles.'), '1,200 se puede leer de dos formas');
es(leerNumero('1.200'), amb('¿1200 o 1,2? Escribe el número sin separador de miles.'), '1.200 también');
es(leerNumero('360,000'), amb('¿360000 o 360? Escribe el número sin separador de miles.'), 'sin decimales que mostrar');
es(leerNumero('1,250'), amb('¿1250 o 1,25? Escribe el número sin separador de miles.'), 'quita los ceros del final');
es(leerNumero('-1,200'), amb('¿-1200 o -1,2? Escribe el número sin separador de miles.'), 'negativo ambiguo');
es(leerNumero('1 200'), amb('Escribe el número sin separador de miles: 1200.'), 'espacio de miles');
es(leerNumero('1 200'), amb('Escribe el número sin separador de miles: 1200.'), 'espacio duro de miles');
es(leerNumero('1,234,567'), amb('Escribe el número sin separador de miles: 1234567.'), 'varios grupos');
es(leerNumero('1.234.567'), amb('Escribe el número sin separador de miles: 1234567.'), 'varios grupos con punto');
es(leerNumero('1,234.5'), amb('Escribe el número sin separador de miles: 1234,5.'), 'miles y decimales');
es(leerNumero('1.234,5'), amb('Escribe el número sin separador de miles: 1234,5.'), 'miles y decimales al revés');
es(leerNumero('1,234,5'), { tipo: 'texto' }, 'no es un número');
es(leerNumero('14,5 A'), { tipo: 'texto' }, 'con unidad no es solo número');
es(leerNumero('bajo'), { tipo: 'texto' }, 'palabra');
es(leerNumero('5.'), { tipo: 'texto' }, 'punto suelto');

// Lectura de liberación: el número con que empieza, con la unidad al lado.
es(numeroAlInicio('14,5 A'), num(14.5), 'número con unidad');
es(numeroAlInicio('14,5A'), num(14.5), 'unidad pegada');
es(numeroAlInicio('10 A'), num(10), 'entero con unidad');
es(numeroAlInicio('12 5 A'), num(12), 'un espacio que no separa miles termina el número');
es(numeroAlInicio('1,200 ppm'), amb('¿1200 o 1,2? Escribe el número sin separador de miles.'), 'miles con unidad');
es(numeroAlInicio('1 200 ppm'), amb('Escribe el número sin separador de miles: 1200.'), 'espacio de miles con unidad');
es(numeroAlInicio('360,000 partículas'), amb('¿360000 o 360? Escribe el número sin separador de miles.'), 'partículas');
es(numeroAlInicio('1 234,5 rpm'), amb('Escribe el número sin separador de miles: 1234,5.'), 'espacio de miles y coma decimal');
es(numeroAlInicio('aprox 14 A'), { tipo: 'texto' }, 'empieza con palabra');
es(numeroAlInicio('≈ 14 A'), { tipo: 'texto' }, 'empieza con símbolo');
es(numeroAlInicio(''), { tipo: 'vacio' }, 'vacío');
es(numeroAlInicio(9.8), num(9.8), 'ya es número');
es(numeroAlInicio('5. A'), num(5), 'punto suelto antes de la unidad');
assert.equal(valorDe(num(3)), 3);
assert.equal(valorDe(amb('x')), null);
assert.equal(valorDe({ tipo: 'texto' }), null);

console.log(`PASS test-numero: ${n + 3} casos; coma o punto decimal, separador de miles que no se adivina.`);
