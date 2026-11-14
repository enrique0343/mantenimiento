// Fase 59 · ronda 2 (WP-F): todas las rutas de WP-F responden el 401 (sin sesión) y el 403
// (fuera de rol) en JSON { error } con texto en español, nunca en texto plano, como pide §c
// y como hace requireUser desde 7008559. Con permiso no dan 401 ni 403. Rutas reales sobre
// las migraciones reales (setupConjuntos); ids que no existen para no cambiar nada.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const h = await setupConjuntos({ modules: {
  plantillas: 'pages/api/checklist-plantillas/index',
  plantilla: 'pages/api/checklist-plantillas/[id]',
  pruebasEquipo: 'pages/api/activos/[id]/seguridad-electrica',
  anular: 'pages/api/seguridad-electrica/[id]/anular',
  informe: 'pages/api/seguridad-electrica/[id]/informe',
  periodicidad: 'pages/api/seguridad-electrica/config',
  csv: 'pages/api/seguridad-electrica/csv',
} });

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };

const A = h.app;
// [ruta, handler, url, método, id, quiénes no entran]
const VER = ['solicitante', 'motorista'];
const REGISTRAR = ['visualizador', 'solicitante', 'motorista'];
const GESTIONAR = ['tecnico', 'visualizador', 'solicitante', 'motorista'];
const RUTAS = [
  ['GET /api/checklist-plantillas', A.plantillas.GET, '/api/checklist-plantillas', 'GET', null, []],
  ['POST /api/checklist-plantillas', A.plantillas.POST, '/api/checklist-plantillas', 'POST', null, GESTIONAR],
  ['GET /api/checklist-plantillas/{id}', A.plantilla.GET, '/api/checklist-plantillas/99999', 'GET', 99999, []],
  ['PATCH /api/checklist-plantillas/{id}', A.plantilla.PATCH, '/api/checklist-plantillas/99999', 'PATCH', 99999, GESTIONAR],
  ['DELETE /api/checklist-plantillas/{id}', A.plantilla.DELETE, '/api/checklist-plantillas/99999', 'DELETE', 99999, GESTIONAR],
  ['GET /api/activos/{id}/seguridad-electrica', A.pruebasEquipo.GET, '/api/activos/99999/seguridad-electrica', 'GET', 99999, VER],
  ['POST /api/activos/{id}/seguridad-electrica', A.pruebasEquipo.POST, '/api/activos/99999/seguridad-electrica', 'POST', 99999, REGISTRAR],
  ['POST /api/seguridad-electrica/{id}/anular', A.anular.POST, '/api/seguridad-electrica/99999/anular', 'POST', 99999, GESTIONAR],
  ['GET /api/seguridad-electrica/{id}/informe', A.informe.GET, '/api/seguridad-electrica/99999/informe', 'GET', 99999, VER],
  ['POST /api/seguridad-electrica/{id}/informe', A.informe.POST, '/api/seguridad-electrica/99999/informe', 'POST', 99999, REGISTRAR],
  ['GET /api/seguridad-electrica/config', A.periodicidad.GET, '/api/seguridad-electrica/config', 'GET', null, VER],
  ['POST /api/seguridad-electrica/config', A.periodicidad.POST, '/api/seguridad-electrica/config', 'POST', null, GESTIONAR],
  ['GET /api/seguridad-electrica/csv', A.csv.GET, '/api/seguridad-electrica/csv?alcance=clase3', 'GET', null, VER],
];

async function llamar(handler, url, metodo, id, rol) {
  const data = metodo === 'GET' || metodo === 'DELETE' ? undefined : {};
  const res = await handler(h.ctx(url, { method: metodo, id, rol, data }));
  const tipo = res.headers.get('content-type') ?? '';
  const texto = await res.text();
  let cuerpo = null;
  try { cuerpo = JSON.parse(texto); } catch { /* texto plano */ }
  return { status: res.status, json: /application\/json/.test(tipo), error: cuerpo && typeof cuerpo.error === 'string' && cuerpo.error.trim() ? cuerpo.error : null };
}
const espanol = (s) => /^[A-ZÁÉÍÓÚÑ¿]/.test(s ?? '') && !/^(Unauthorized|Forbidden)/i.test(s);

try {
  for (const [nombre, handler, url, metodo, id, fuera] of RUTAS) {
    const sin = await llamar(handler, url, metodo, id, null);
    es([sin.status, sin.json, espanol(sin.error)], [401, true, true], `${nombre} sin sesión: 401 en JSON { error } («${sin.error}»)`);
    for (const rol of fuera) {
      const r = await llamar(handler, url, metodo, id, rol);
      es([r.status, r.json, espanol(r.error)], [403, true, true], `${nombre} como ${rol}: 403 en JSON { error } («${r.error}»)`);
    }
    const admin = await llamar(handler, url, metodo, id, 'admin');
    es([admin.status !== 401 && admin.status !== 403, admin.json || admin.status === 200], [true, true], `${nombre} como admin: entra (${admin.status})`);
  }
  // Las plantillas se leen con cualquier sesión (el formulario de rutinas las necesita).
  es((await llamar(A.plantillas.GET, '/api/checklist-plantillas', 'GET', null, 'solicitante')).status, 200, 'leer plantillas: cualquier sesión');
  es((await llamar(A.plantillas.POST, '/api/checklist-plantillas', 'POST', null, 'jefe')).status, 400, 'el jefe crea plantillas (aquí falta el nombre: 400, no 403)');
} finally {
  await h.close();
}

console.log(`PASS test-bio-seguridad-electrica-permisos: ${n} casos; las rutas de WP-F responden 401 y 403 en JSON { error } en español.`);
