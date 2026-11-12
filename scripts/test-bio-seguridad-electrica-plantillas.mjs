// Fase 59 · seguridad eléctrica: la API de plantillas de checklist ya no pierde
// plantillas ni lecturas. Borrar desactiva; reemplazar pasos conserva lectura,
// unidad y rango; los pasos ligados no se reemplazan; los errores salen en texto.
// Reglas puras de src/lib/plantillas-checklist.ts y rutas reales sobre las
// migraciones reales (incluida la 0059).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const out = await build({ entryPoints: ['src/lib/plantillas-checklist.ts'], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const P = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const si = (r, nota) => { n++; assert.equal(r, true, nota); };

// ── Reglas puras ────────────────────────────────────────────────────────────
es(P.itemPlantillaSchema.parse('  Revisar cable  '), { texto: 'Revisar cable' }, 'un paso escrito como texto');
es(P.itemPlantillaSchema.parse({ texto: 'Medir', requiereValor: true, unidad: ' µA ', valorEsperadoMin: null, valorEsperadoMax: 50 }),
  { texto: 'Medir', requiereValor: true, unidad: 'µA', valorEsperadoMin: null, valorEsperadoMax: 50 }, 'un paso con lectura, unidad y rango');
const rango = P.itemPlantillaSchema.safeParse({ texto: 'Medir', valorEsperadoMin: 5, valorEsperadoMax: 1 });
es([rango.success, rango.error?.issues[0].message], [false, 'El mínimo no puede ser mayor que el máximo'], 'mínimo mayor que el máximo');
es(P.itemPlantillaSchema.safeParse({ texto: 'Medir', unidad: 'microamperios' }).error?.issues[0].message, 'La unidad tiene como máximo 12 letras.', 'unidad larga');
const crear = (body) => P.mensajeErrorPlantilla(P.crearPlantillaSchema.safeParse(body).error);
es(crear({ nombre: 'X', items: ['Uno', { texto: 'Dos', valorEsperadoMin: 2, valorEsperadoMax: 1 }] }), 'Paso 2: El mínimo no puede ser mayor que el máximo.', 'el error dice qué paso');
es(crear({ nombre: '  ', items: [] }), 'Escribe el nombre de la plantilla.', 'sin nombre');
es(crear({ nombre: 'X', items: ['Uno', ''] }), 'Paso 2: Escribe el texto de cada paso.', 'paso vacío');
es(crear({ nombre: 'X', items: [{ texto: 'Uno', bloqueante: 'sí' }] }), 'Paso 1: Revisa los datos de la plantilla.', 'un tipo raro no sale en inglés');
es(crear(null), 'Revisa los datos de la plantilla.', 'sin cuerpo');
es(crear({ nombre: 'X', items: Array.from({ length: 201 }, (_, i) => `Paso ${i}`) }), 'Una plantilla tiene como máximo 200 pasos.', 'demasiados pasos');

const vacio = { criterioAceptacion: null, bloqueante: false, minutosEstimados: null, materiales: null, requiereValor: false, unidad: null, valorEsperadoMin: null, valorEsperadoMax: null };
es(P.normalizarItemPlantilla('Paso', 1, 9), { plantillaId: 9, texto: 'Paso', ...vacio, orden: 1 }, 'sin paso anterior: sin lectura ni rango');
const tierra = { texto: 'Medir tierra', criterioAceptacion: '≤ 0.3 Ω', bloqueante: false, minutosEstimados: 10, materiales: null, requiereValor: true, unidad: 'Ω', valorEsperadoMin: null, valorEsperadoMax: 0.3 };
es(P.normalizarItemPlantilla('Medir tierra', 3, 9, tierra), { plantillaId: 9, ...tierra, orden: 3 }, 'el paso que llega como texto conserva lectura, unidad y rango');
es(P.normalizarItemPlantilla({ texto: 'Medir tierra', requiereValor: false, unidad: null, valorEsperadoMax: null }, 3, 9, tierra),
  { plantillaId: 9, ...tierra, requiereValor: false, unidad: null, valorEsperadoMax: null, orden: 3 }, 'lo que llega explícito manda');
es(P.normalizarItemPlantilla({ texto: 'X', unidad: '  ', criterioAceptacion: '' }, 1, 9).unidad, null, 'unidad en blanco = sin unidad');

const actuales = [
  { ...tierra, texto: 'A' },
  { ...vacio, texto: 'A', bloqueante: true },
  { ...vacio, texto: 'B' },
];
const filas = P.filasDeReemplazo(['A', { texto: 'B', requiereValor: true, unidad: 'V' }, ' A ', 'C'], actuales, 5);
es(filas.map((f) => [f.orden, f.texto, f.requiereValor, f.unidad, f.bloqueante]), [
  [1, 'A', true, 'Ω', false], [2, 'B', true, 'V', false], [3, 'A', false, null, true], [4, 'C', false, null, false],
], 'cada paso toma el primer paso guardado con su texto; orden desde 1');

es([P.tieneVinculos([]), P.tieneVinculos([{ variableId: 3 }]), P.tieneVinculos([{ accionSiNoCumple: '  ' }]), P.tieneVinculos([{ accionSiNoCumple: 'Avisar' }]), P.tieneVinculos([{ aopProcedimientoId: null, activoId: 7 }])],
  [false, true, false, true, true], 'pasos ligados');
// El rango final (lo que llega + lo guardado) también se revisa.
const tierraMin = P.filasDeReemplazo(['Uno', { texto: 'Medir tierra', valorEsperadoMin: 1 }], [tierra], 9);
es([tierraMin[1].valorEsperadoMin, tierraMin[1].valorEsperadoMax], [1, 0.3], 'el mínimo que llega se combina con el máximo guardado');
es(P.errorRangoDePasos(tierraMin), 'Paso 2: El mínimo no puede ser mayor que el máximo.', 'ese rango al revés se detecta, con su paso');
es([P.errorRangoDePasos([]), P.errorRangoDePasos([{ valorEsperadoMin: 0.3, valorEsperadoMax: 0.3 }, { valorEsperadoMin: null, valorEsperadoMax: 5 }])], [null, null], 'rangos válidos o abiertos');
const veinte = Array.from({ length: 20 }, (_, i) => P.normalizarItemPlantilla(`Paso ${i + 1}`, i + 1, 1));
es(P.tandasDeFilas(veinte).map((t) => t.length), [8, 8, 4], 'tandas de 8 pasos (11 parámetros cada uno ≤ 90)');
es(P.tandasDeFilas([]), [], 'sin filas no hay tandas');

// ── Rutas reales ────────────────────────────────────────────────────────────
const h = await setupConjuntos({ modules: { lista: 'pages/api/checklist-plantillas/index', una: 'pages/api/checklist-plantillas/[id]' } });
try {
  const db = h.sqlite;
  const filasDe = (id) => db.prepare('SELECT texto, orden, bloqueante, criterio_aceptacion, requiere_valor, unidad, valor_esperado_min, valor_esperado_max FROM checklist_plantilla_items WHERE plantilla_id = ? ORDER BY orden, id').all(id).map((f) => ({ ...f }));
  const iec = db.prepare("SELECT id FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353'").get().id;
  const pasosIec = filasDe(iec);
  es(pasosIec.length, 8, 'la plantilla IEC 62353 de la base de prueba');

  // Crear
  es(await h.call(h.app.lista.POST, '/api/checklist-plantillas', { method: 'POST', rol: 'tecnico', data: { nombre: 'X' } }), { status: 403, body: { error: 'No tienes permiso para esto.' } }, 'el técnico no crea plantillas (error en texto)');
  es(await h.call(h.app.lista.POST, '/api/checklist-plantillas', { method: 'POST', rol: 'jefe', data: { nombre: '', items: [] } }), { status: 400, body: { error: 'Escribe el nombre de la plantilla.' } }, 'error en texto, no el objeto de zod');
  const antesQ = h.queries.length;
  const items = Array.from({ length: 20 }, (_, i) => (i === 4 ? { texto: 'Medir voltaje', requiereValor: true, unidad: 'V', valorEsperadoMin: 110, valorEsperadoMax: 130, bloqueante: true } : `Paso ${i + 1}`));
  const creada = await h.call(h.app.lista.POST, '/api/checklist-plantillas', { method: 'POST', rol: 'jefe', data: { nombre: 'Prueba de 20 pasos', descripcion: 'Para la prueba', items } });
  es(creada.status, 201, 'crear con 20 pasos');
  const idNueva = creada.body.plantilla.id;
  const pasosNueva = filasDe(idNueva);
  es([pasosNueva.length, pasosNueva[0].orden, pasosNueva[19].orden], [20, 1, 20], 'los 20 pasos, en orden desde 1');
  es([pasosNueva[4].requiere_valor, pasosNueva[4].unidad, pasosNueva[4].valor_esperado_min, pasosNueva[4].valor_esperado_max, pasosNueva[4].bloqueante], [1, 'V', 110, 130, 1], 'el paso con lectura guarda unidad y rango');
  const inserts = h.queries.slice(antesQ).filter((q) => /insert into "checklist_plantilla_items"/i.test(q.sql));
  es(inserts.length, 3, 'tres INSERT de pasos');
  si(inserts.every((q) => (q.sql.match(/\?/g) ?? []).length <= 100), 'ningún INSERT pasa de 100 parámetros (límite de D1)');

  // Reemplazar pasos: conservan lectura, unidad y rango
  es(await h.call(h.app.una.PATCH, '/api/checklist-plantillas/99999', { method: 'PATCH', id: 99999, rol: 'admin', data: { activa: false } }), { status: 404, body: { error: 'Plantilla no encontrada' } }, 'plantilla que no existe');
  const reemplazo = await h.call(h.app.una.PATCH, `/api/checklist-plantillas/${iec}`, { method: 'PATCH', id: iec, rol: 'jefe', data: { items: pasosIec.map((p) => p.texto) } });
  es(reemplazo.status, 200, 'reemplazar los pasos con solo sus textos');
  es(filasDe(iec), pasosIec.map((p, i) => ({ ...p, orden: i + 1 })), 'conservan críticos, criterio, lectura, unidad y rango');
  const sinLectura = pasosIec.map((p) => (p.texto === 'Medir resistencia de aislamiento' ? { texto: p.texto, requiereValor: false, unidad: null } : p.texto));
  await h.call(h.app.una.PATCH, `/api/checklist-plantillas/${iec}`, { method: 'PATCH', id: iec, rol: 'admin', data: { items: sinLectura } });
  es(filasDe(iec).filter((p) => p.texto === 'Medir resistencia de aislamiento').map((p) => [p.requiere_valor, p.unidad]), [[0, null]], 'quitar la lectura de un paso a propósito');
  es((await h.call(h.app.una.PATCH, `/api/checklist-plantillas/${iec}`, { method: 'PATCH', id: iec, rol: 'tecnico', data: { activa: false } })).status, 403, 'el técnico no edita plantillas');
  es((await h.call(h.app.una.PATCH, `/api/checklist-plantillas/${iec}`, { method: 'PATCH', id: iec, rol: 'jefe', data: { items: [{ texto: 'X', valorEsperadoMin: 3, valorEsperadoMax: 1 }] } })).body,
    { error: 'Paso 1: El mínimo no puede ser mayor que el máximo.' }, 'rango al revés');
  // Solo un mínimo de 1 Ω en el paso 3, que guarda máximo 0.3: el par queda al revés y no se guarda.
  const antesMin = filasDe(iec);
  const conMin = antesMin.map((p) => (p.texto === 'Medir resistencia de tierra de protección' ? { texto: p.texto, valorEsperadoMin: 1 } : p.texto));
  es(await h.call(h.app.una.PATCH, `/api/checklist-plantillas/${iec}`, { method: 'PATCH', id: iec, rol: 'jefe', data: { items: conMin } }),
    { status: 400, body: { error: 'Paso 3: El mínimo no puede ser mayor que el máximo.' } }, 'mínimo que llega sobre el máximo guardado');
  es(filasDe(iec), antesMin, 'la plantilla queda como estaba');

  // Si la base falla: error en texto y nada a medias.
  h.faults.beforeBatch = async () => { throw new Error('D1 sin servicio'); };
  es(await h.call(h.app.una.PATCH, `/api/checklist-plantillas/${iec}`, { method: 'PATCH', id: iec, rol: 'jefe', data: { nombre: 'Otro', items: ['Solo uno'] } }),
    { status: 500, body: { error: 'No se pudo guardar la plantilla. Intenta de nuevo.' } }, 'reemplazo con la base caída: error en texto');
  es([filasDe(iec), db.prepare('SELECT nombre FROM checklist_plantillas WHERE id = ?').get(iec).nombre], [antesMin, 'Seguridad eléctrica IEC 62353'], 'ni el nombre ni los pasos cambian');
  const plantillasAntes = db.prepare('SELECT COUNT(*) AS c FROM checklist_plantillas').get().c;
  h.faults.beforeBatch = async () => { throw new Error('D1 sin servicio'); };
  es(await h.call(h.app.lista.POST, '/api/checklist-plantillas', { method: 'POST', rol: 'jefe', data: { nombre: 'Se cae', items: ['Uno', 'Dos'] } }),
    { status: 500, body: { error: 'No se pudo guardar la plantilla. Intenta de nuevo.' } }, 'crear con la base caída: error en texto');
  es(db.prepare('SELECT COUNT(*) AS c FROM checklist_plantillas').get().c, plantillasAntes, 'no queda una plantilla sin pasos');

  // Pasos ligados: 409 y nada cambia
  db.prepare("UPDATE checklist_plantilla_items SET accion_si_no_cumple = 'Avisar a la jefatura' WHERE plantilla_id = ? AND orden = 5").run(idNueva);
  const antesLigada = filasDe(idNueva);
  const ligada = await h.call(h.app.una.PATCH, `/api/checklist-plantillas/${idNueva}`, { method: 'PATCH', id: idNueva, rol: 'admin', data: { nombre: 'Otro nombre', items: ['Solo uno'] } });
  es(ligada.status, 409, 'pasos con acción si no cumple: no se reemplazan');
  si(typeof ligada.body.error === 'string' && ligada.body.error.includes('vínculos'), 'explica por qué');
  es(filasDe(idNueva), antesLigada, 'los pasos quedan como estaban');
  es(db.prepare('SELECT nombre FROM checklist_plantillas WHERE id = ?').get(idNueva).nombre, 'Prueba de 20 pasos', 'el nombre tampoco cambia');
  es((await h.call(h.app.una.PATCH, `/api/checklist-plantillas/${idNueva}`, { method: 'PATCH', id: idNueva, rol: 'admin', data: { nombre: 'Prueba renombrada' } })).body.plantilla.nombre, 'Prueba renombrada', 'sin pasos sí se puede renombrar');

  // Borrar desactiva
  es(await h.call(h.app.una.DELETE, `/api/checklist-plantillas/${iec}`, { method: 'DELETE', id: iec, rol: 'jefe' }), { status: 200, body: { ok: true, desactivada: true } }, 'borrar responde desactivada');
  es(db.prepare('SELECT activa FROM checklist_plantillas WHERE id = ?').get(iec).activa, 0, 'la plantilla sigue, inactiva');
  es(filasDe(iec).length, 8, 'con sus 8 pasos');
  const activas = await h.call(h.app.lista.GET, '/api/checklist-plantillas?activas=1', { rol: 'tecnico' });
  si(!activas.body.plantillas.some((p) => p.id === iec), 'ya no se ofrece al crear rutinas');
  const todas = await h.call(h.app.lista.GET, '/api/checklist-plantillas', { rol: 'admin' });
  es(todas.body.plantillas.find((p) => p.id === iec)?.items.length, 8, 'el listado completo la muestra con sus pasos');
  es((await h.call(h.app.una.DELETE, '/api/checklist-plantillas/99999', { method: 'DELETE', id: 99999, rol: 'admin' })).status, 404, 'borrar una que no existe');
  es((await h.call(h.app.una.DELETE, `/api/checklist-plantillas/${iec}`, { method: 'DELETE', id: iec, rol: 'tecnico' })).status, 403, 'el técnico no desactiva');
  await h.call(h.app.una.PATCH, `/api/checklist-plantillas/${iec}`, { method: 'PATCH', id: iec, rol: 'admin', data: { activa: true } });
  es(db.prepare('SELECT activa FROM checklist_plantillas WHERE id = ?').get(iec).activa, 1, 'se vuelve a activar');
  const detalle = await h.call(h.app.una.GET, `/api/checklist-plantillas/${iec}`, { id: iec, rol: 'tecnico' });
  es([detalle.status, detalle.body.plantilla.items.length, detalle.body.plantilla.items[2].unidad], [200, 8, 'Ω'], 'el detalle trae los pasos con su unidad');
} finally {
  await h.close();
}

console.log(`PASS test-bio-seguridad-electrica-plantillas: ${n} casos; borrar desactiva y reemplazar pasos no pierde lecturas.`);
