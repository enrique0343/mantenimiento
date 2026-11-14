// Fase 59: corre, en orden de nombre, todas las pruebas scripts/test-bio-*.mjs de los
// paquetes de equipos biomédicos. Cada una en su propio proceso; al final dice cuáles
// fallaron y sale con error si alguna falló. Un paquete nuevo solo agrega su archivo.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pruebas = fs.readdirSync(path.join(raiz, 'scripts')).filter((n) => /^test-bio-.+\.mjs$/.test(n)).sort();
if (pruebas.length === 0) {
  console.error('FALLA test-biomedicos: no hay ningún scripts/test-bio-*.mjs.');
  process.exit(1);
}

const fallas = [];
for (const prueba of pruebas) {
  const r = spawnSync(process.execPath, [path.join('scripts', prueba)], { cwd: raiz, stdio: 'inherit' });
  if (r.status !== 0) fallas.push(`${prueba} (${r.status === null ? `señal ${r.signal}` : `salida ${r.status}`})`);
}
if (fallas.length) {
  console.error(`FALLA test-biomedicos: ${fallas.length} de ${pruebas.length} pruebas: ${fallas.join(', ')}`);
  process.exit(1);
}
console.log(`PASS test-biomedicos: ${pruebas.length} archivo(s): ${pruebas.join(', ')}.`);
