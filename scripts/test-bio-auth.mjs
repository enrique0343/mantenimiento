// Fase 59 (§c): requireUser responde el 401 y el 403 en JSON { error }, como el middleware,
// para que las pantallas muestren j.error. Rutas reales, sesión firmada y migraciones reales.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const h = await setupConjuntos();
let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
try {
  const alta = h.app.assetCreate.POST;
  const sinSesion = await h.call(alta, '/api/activos', { method: 'POST', data: {}, rol: null });
  es([sinSesion.status, sinSesion.body], [401, { error: 'No autenticado' }], 'sin sesión: 401 en JSON');
  const sinPermiso = await h.call(alta, '/api/activos', { method: 'POST', data: {}, rol: 'solicitante' });
  es([sinPermiso.status, sinPermiso.body], [403, { error: 'Sin permisos' }], 'sin permiso: 403 en JSON');
  const r = await alta(h.ctx('/api/activos', { method: 'POST', data: {}, rol: 'visualizador' }));
  es([r.status, /application\/json/.test(r.headers.get('content-type') ?? '')], [403, true], 'content-type JSON');
  const lista = await h.call(h.app.assetCreate.GET, '/api/activos', { rol: 'visualizador' });
  es(lista.status, 200, 'con permiso sigue entrando');
} finally {
  await h.close();
}
console.log(`PASS test-bio-auth: ${n} casos; 401 y 403 de requireUser en JSON { error }.`);
