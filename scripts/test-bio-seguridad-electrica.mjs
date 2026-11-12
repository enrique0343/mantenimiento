// Fase 59 · seguridad eléctrica IEC 62353: registro de pruebas con analizador patrón
// vigente, resultado calculado y confirmado, informe, anulación, tablero Clase III,
// CSV y periodicidad. Rutas reales sobre las migraciones reales (incluida la 0059);
// R2 en memoria. Los ejemplos de biomedico.ts ya los prueba test-bio-base.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const h = await setupConjuntos({ modules: {
  se: 'pages/api/activos/[id]/seguridad-electrica',
  anular: 'pages/api/seguridad-electrica/[id]/anular',
  informe: 'pages/api/seguridad-electrica/[id]/informe',
  csv: 'pages/api/seguridad-electrica/csv',
  config: 'pages/api/seguridad-electrica/config',
  lib: 'lib/seguridad-electrica',
  bio: 'lib/biomedico',
  database: 'lib/db',
} });

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const si = (r, nota) => { n++; assert.equal(r, true, nota); };

// R2 en memoria
const r2 = new Map();
const R2 = {
  async put(key, value, opts) { r2.set(key, { bytes: new Uint8Array(value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer()), contentType: opts?.httpMetadata?.contentType }); },
  async get(key) { const o = r2.get(key); return o ? { async arrayBuffer() { return o.bytes.slice().buffer; } } : null; },
  async delete(key) { r2.delete(key); },
};

/** Llama a una ruta como el navegador: con la cookie del rol, multipart o JSON. */
async function llamar(ruta, url, { method = 'GET', rol = 'admin', id, form, json } = {}) {
  const c = h.ctx(url, { method, id, rol });
  const headers = new Headers();
  const cookie = c.request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  let body;
  if (form) {
    body = new FormData();
    for (const [k, v] of Object.entries(form)) if (v !== undefined && v !== null) body.append(k, v);
  } else if (json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(json);
  }
  c.request = new Request(`https://test.invalid${url}`, { method, headers, body });
  c.locals.runtime.env.R2 = R2;
  const res = await ruta(c);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let cuerpo = text;
  try { cuerpo = JSON.parse(text); } catch { /* CSV o archivo */ }
  return { status: res.status, headers: res.headers, body: cuerpo, text, bytes };
}

const B = h.app.bio;
const L = h.app.lib;
const db = h.app.database.getDb(h.ctx('/prueba'));
const sql = h.sqlite;
const fila = (q, ...a) => { const r = sql.prepare(q).get(...a); return r ? { ...r } : r; };
const hoy = B.hoySV();
const dias = (d) => B.sumarDias(hoy, d);

// ── Datos de prueba ─────────────────────────────────────────────────────────
sql.exec(`
  INSERT INTO sucursales (id, nombre) VALUES (101, 'Sede Central'), (102, 'Sede Norte');
  INSERT INTO ubicaciones (id, sucursal_id, nombre) VALUES (201, 101, 'UCI Adultos'), (202, 102, 'Emergencia');
  INSERT INTO activos (id, codigo, nombre, tipo, rubro, clase_riesgo, ubicacion_id, marca, modelo, serial, estado, es_patron) VALUES
    (1001, 'BIO-1001', 'MONITOR DE SIGNOS VITALES', 'biomedico', 'biomedico', 'III', 201, 'Mindray', 'uMEC10', 'M-1', 'operativo', 0),
    (1002, 'BIO-1002', 'VENTILADOR', 'biomedico', 'biomedico', 'III', 202, 'Dräger', 'V300', 'V-1', 'operativo', 0),
    (1003, 'BIO-1003', 'BOMBA DE INFUSIÓN', 'biomedico', 'biomedico', 'IIb', 201, 'BBraun', 'Infusomat', 'B-1', 'operativo', 0),
    (1004, 'BIO-1004', 'DESFIBRILADOR', 'biomedico', 'biomedico', 'III', 201, 'Zoll', 'R', 'D-1', 'baja', 0),
    (1005, 'GEN-1005', 'COMPRESOR', 'general', 'equipo_general', NULL, 201, 'X', 'Y', 'C-1', 'operativo', 0),
    (1006, 'PAT-1', 'ANALIZADOR DE SEGURIDAD ELÉCTRICA', 'biomedico', 'biomedico', 'III', 201, 'Fluke', 'ESA615', 'SN-PAT-1', 'operativo', 1),
    (1007, 'PAT-2', 'ANALIZADOR VIEJO', 'biomedico', 'biomedico', NULL, 201, 'Fluke', 'ESA612', 'SN-PAT-2', 'operativo', 1),
    (1008, 'PAT-3', 'ANALIZADOR SIN SERIE', 'biomedico', 'biomedico', NULL, 201, 'Rigel', '288', NULL, 'operativo', 1),
    (1009, 'BIO-1009', 'ELECTROCARDIÓGRAFO', 'biomedico', 'biomedico', 'IIa', 201, 'GE', 'MAC', 'E-1', 'operativo', 0),
    (1010, 'PAT-4', 'ANALIZADOR SIN CERTIFICADO', 'biomedico', 'biomedico', NULL, 201, 'Fluke', 'ESA620', 'SN-PAT-4', 'operativo', 1);
`);
const cal = sql.prepare('INSERT INTO calibraciones (activo_id, fecha_calibracion, proxima_calibracion, resultado, certificado_r2_key, usuario_id) VALUES (?, ?, ?, ?, ?, 1)');
cal.run(1006, dias(-300), dias(65), 'conforme', 'cert/1006');
cal.run(1007, dias(-400), dias(-35), 'conforme', 'cert/1007');
cal.run(1008, dias(-30), dias(335), 'conforme', 'cert/1008');
cal.run(1010, dias(-30), dias(335), 'conforme', null);
const checklist = JSON.stringify([
  { texto: 'Inspección visual: carcasa, cable de alimentación, conectores y accesorios sin daños', estado: 'ok' },
  { texto: 'Medir resistencia de tierra de protección', estado: 'ok', valorMedido: '0,12' },
  { texto: 'Medir corriente de fuga del equipo', estado: 'ok', valorMedido: 120 },
  { texto: 'Prueba funcional del equipo posterior a las mediciones', estado: 'ok' },
]);
sql.prepare("INSERT INTO ordenes (id, titulo, tipo, estado, activo_id, rubro, creado_por, asignado_a, checklist_ejecucion) VALUES (3001, 'Reparación de fuente', 'correctivo', 'completada', 1001, 'biomedico', 1, 3, ?)").run(checklist);
sql.exec("INSERT INTO ordenes (id, titulo, tipo, estado, activo_id, rubro, creado_por) VALUES (3002, 'Preventivo', 'preventivo', 'abierta', 1002, 'biomedico', 1)");

const PDF = new TextEncoder().encode('%PDF-1.4\n% informe del analizador\n');
const pdf = (nombre = 'informe ESA615.pdf') => new File([PDF], nombre, { type: 'application/pdf' });

/** Un formulario válido: Clase I con parte BF, valores dentro de límite, analizador patrón vigente. */
const base = (o = {}) => ({
  confirmado: '1', fecha: dias(-1), tipo: 'periodica', claseProteccion: 'I', parteAplicada: 'BF', metodoFuga: 'directo',
  inspeccionVisual: 'conforme', pruebaFuncional: 'conforme', tierraOhm: '0,12', aislamientoMohm: '', fugaEquipoUa: '120', fugaParteUa: '15',
  resultado: 'pasa', analizadorActivoId: '1006', realizadoPorId: '3', ...o,
});
const registrar = (activoId, o, rol = 'tecnico') => llamar(h.app.se.POST, `/api/activos/${activoId}/seguridad-electrica`, { method: 'POST', id: activoId, rol, form: base(o) });
const error = async (activoId, o, rol) => { const r = await registrar(activoId, o, rol); return [r.status, r.body.error]; };

// ── Reglas puras de la biblioteca ───────────────────────────────────────────
es([L.leerMedida('0,12', 'Tierra'), L.leerMedida('', 'Tierra'), L.leerMedida('  ', 'Tierra')], [{ valor: 0.12 }, { valor: null }, { valor: null }], 'lectura escrita');
es(L.leerMedida('abc', 'Resistencia de tierra (Ω)'), { error: 'Resistencia de tierra (Ω): escribe solo el número, por ejemplo 0.12' }, 'texto');
es(L.leerMedida('1,200', 'Fuga del equipo (µA)'), { error: 'Fuga del equipo (µA): ¿1200 o 1,2? Escribe el número sin separador de miles.' }, 'ambiguo');
es(L.leerMedida('-1', 'X'), { error: 'Los valores no pueden ser negativos.' }, 'negativo');
es(['12', 12, '1', '60', '0', '61', '6.5', 'doce', '', null].map(L.mesesValidos), [12, 12, 1, 60, null, null, null, null, null, null], 'meses de 1 a 60');
es([L.descripcionAnalizador({ nombre: 'ANALIZADOR', marca: 'Fluke', modelo: 'ESA615' }), L.descripcionAnalizador({ nombre: 'ANALIZADOR', marca: ' ', modelo: null })], ['Fluke ESA615', 'ANALIZADOR'], 'descripción del analizador');
const c = (fechaCalibracion, proximaCalibracion, resultado = 'conforme', certificadoR2Key = 'k', id = 1) => ({ id, fechaCalibracion, proximaCalibracion, resultado, certificadoR2Key });
es(L.revisarCalibracionAnalizador([c('2026-01-10', '2027-01-10')], '2026-11-12'), { ok: true, hasta: '2027-01-10' }, 'analizador vigente');
es(L.revisarCalibracionAnalizador([c('2026-01-10', '2026-11-12')], '2026-11-12'), { ok: true, hasta: '2026-11-12' }, 'el día del vencimiento todavía vale');
es(L.revisarCalibracionAnalizador([c('2025-01-10', '2026-01-10')], '2026-11-12'), { ok: false, error: 'El analizador tenía la calibración vencida el día de la prueba (venció el 10/01/2026). Usa uno con calibración vigente.' }, 'vencido');
es(L.revisarCalibracionAnalizador([c('2026-12-01', '2027-12-01')], '2026-11-12').error, 'El analizador elegido no tiene calibración registrada.', 'calibrado después de la prueba');
si(L.revisarCalibracionAnalizador([c('2026-01-10', '2027-01-10', 'conforme', null)], '2026-11-12').error.includes('certificado'), 'sin certificado');
si(L.revisarCalibracionAnalizador([c('2026-01-10', '2027-01-10', 'no_conforme')], '2026-11-12').error.includes('no conforme'), 'no conforme');
// El veredicto es siempre el de patronVigenteEn (la regla de Calibraciones); la biblioteca solo explica el porqué.
for (const calibs of [[], [c('2026-01-10', '2027-01-10')], [c('2026-01-10', '2026-11-11')], [c('2026-01-10', '2027-01-10', 'conforme', null)],
  [c('2026-01-10', '2027-01-10', 'no_conforme')], [c('2026-01-10', '2027-01-10', 'conforme_con_ajuste')], [c('2026-01-10', null)],
  [c('2025-01-10', '2026-01-10', 'conforme', 'k', 1), c('2026-06-01', '2027-06-01', 'conforme', 'k', 2)], [c('2026-06-01', '2027-06-01', 'conforme', 'k', 2), c('2026-06-01', '2026-07-01', 'conforme', 'k', 3)],
  [c('2026-12-01', '2027-12-01')]]) {
  es(L.revisarCalibracionAnalizador(calibs, '2026-11-12').ok, B.patronVigenteEn(calibs, '2026-11-12').vigente, `mismo veredicto que patronVigenteEn: ${JSON.stringify(calibs)}`);
}
es([L.idPositivo('7'), L.idPositivo(' 7 '), L.idPositivo('0'), L.idPositivo('x'), L.idPositivo('1.5'), L.idPositivo(null)], [7, 7, null, null, null, null], 'ids');
es([L.leerAlcance('biomedicos'), L.leerAlcance('clase3'), L.leerAlcance(null), L.leerAlcance('otra')], ['biomedicos', 'clase3', 'clase3', 'clase3'], 'alcance');
es([L.porcentajeAlDia({ total: 3, cumplen: 2 }), L.porcentajeAlDia({ total: 0, cumplen: 0 })], [67, null], 'al día en %');

try {
  // ── Permisos y equipo ─────────────────────────────────────────────────────
  es(await error(1001, {}, 'visualizador'), [403, 'No tienes permiso para esto.'], 'el visualizador no registra');
  es((await llamar(h.app.se.GET, '/api/activos/1001/seguridad-electrica', { id: 1001, rol: 'solicitante' })).status, 403, 'el solicitante no ve');
  es((await llamar(h.app.se.GET, '/api/activos/1001/seguridad-electrica', { id: 1001, rol: 'motorista' })).status, 403, 'el motorista no ve');
  es(await error(99999, {}), [404, 'Equipo no encontrado'], 'equipo que no existe');
  es(await error(1005, {}), [400, 'Solo los equipos biomédicos llevan esta prueba.'], 'no biomédico');
  es(await error(1004, {}), [409, 'El equipo está dado de baja.'], 'dado de baja');

  // ── Validación, en orden ──────────────────────────────────────────────────
  es(await error(1001, { confirmado: undefined }), [400, 'Marca la casilla de confirmación.'], 'sin confirmación');
  es(await error(1001, { fecha: '12/11/2026' }), [400, 'Revisa la fecha de la prueba.'], 'fecha en otro formato');
  es(await error(1001, { fecha: dias(1) }), [400, 'La fecha no puede ser futura.'], 'fecha futura');
  es(await error(1001, { tipo: 'anual' }), [400, 'Elige el tipo de prueba.'], 'tipo');
  es(await error(1001, { claseProteccion: 'III' }), [400, 'Elige la clase de protección.'], 'clase de protección');
  es(await error(1001, { parteAplicada: 'X' }), [400, 'Elige el tipo de parte aplicada.'], 'parte aplicada');
  es(await error(1001, { inspeccionVisual: undefined }), [400, 'Indica el resultado de la inspección visual.'], 'inspección');
  es(await error(1001, { ordenId: '3002' }), [400, 'La orden elegida no es de este equipo.'], 'orden de otro equipo');
  es(await error(1001, { tierraOhm: 'abc' }), [400, 'Resistencia de tierra (Ω): escribe solo el número, por ejemplo 0.12'], 'tierra con texto');
  es(await error(1001, { fugaEquipoUa: '1,200' }), [400, 'Fuga del equipo (µA): ¿1200 o 1,2? Escribe el número sin separador de miles.'], 'fuga ambigua');
  es(await error(1001, { fugaParteUa: '-2' }), [400, 'Los valores no pueden ser negativos.'], 'negativo');
  es(await error(1001, { tierraOhm: '', parteAplicada: 'B' }), [400, 'Falta la lectura de: Resistencia de tierra (Ω).'], 'falta la tierra en Clase I');
  es(await error(1001, { parteAplicada: 'CF', fugaParteUa: '60' }), [400, 'Hay valores fuera de límite: la prueba no puede quedar como «Pasa».'], 'CF con 60 µA no puede pasar');
  es(await error(1001, { resultado: 'no_pasa', motivoResultado: 'corto' }), [400, 'Explica por qué no pasa (al menos 10 letras).'], 'no pasa sin motivo');
  es(await error(1001, { resultado: undefined }), [400, 'Elige el resultado que confirmas.'], 'sin resultado');

  // Analizador
  es(await error(1001, { analizadorActivoId: '1009' }), [400, 'El analizador elegido no está en la lista de equipos patrón.'], 'un equipo que no es patrón');
  es(await error(1006, { analizadorActivoId: '1006' }), [400, 'El analizador no puede ser el mismo equipo.'], 'el mismo equipo');
  es(await error(1001, { analizadorActivoId: '1008' }), [400, 'El analizador elegido no tiene número de serie en su ficha.'], 'patrón sin serie');
  es(await error(1001, { analizadorActivoId: '1007' }), [400, `El analizador tenía la calibración vencida el día de la prueba (venció el ${B.fechaCorta(dias(-35))}). Usa uno con calibración vigente.`], 'patrón vencido');
  si((await error(1001, { analizadorActivoId: '1010' }))[1].includes('certificado'), 'patrón sin certificado');
  es(await error(1001, { analizadorActivoId: '', analizadorDescripcion: 'Fluke ESA615' }), [400, 'Elige el analizador o escribe sus datos.'], 'a mano, incompleto');
  es(await error(1001, { analizadorActivoId: '', analizadorDescripcion: 'Fluke ESA615', analizadorSerie: 'X1', analizadorCalVence: dias(-2) }),
    [400, `El analizador tenía la calibración vencida el día de la prueba (venció el ${B.fechaCorta(dias(-2))}). Usa uno con calibración vigente.`], 'a mano, vencido');
  es(await error(1001, { analizadorActivoId: '', analizadorDescripcion: 'Fluke', analizadorSerie: 'X1', analizadorCalVence: '31/02/2027' }), [400, 'Revisa hasta cuándo está vigente la calibración del analizador.'], 'a mano, fecha imposible');

  // Quién realizó
  es(await error(1001, { realizadoPorId: '5' }), [400, 'Indica quién realizó la prueba.'], 'un solicitante no realiza pruebas');
  es(await error(1001, { realizadoPorId: '', realizadoPor: 'X' }), [400, 'Indica quién realizó la prueba.'], 'nombre de una letra');
  es(await error(1001, { tipo: 'aceptacion' }), [400, 'La prueba de aceptación necesita el informe adjunto (PDF o foto).'], 'aceptación sin informe');
  es(await error(1001, { tipo: 'aceptacion', informe: new File([new TextEncoder().encode('MZ\x90\x00 programa')], 'informe.pdf', { type: 'application/pdf' }) }), [415, 'Solo se aceptan archivos PDF o fotos (JPG, PNG o WEBP).'], 'un .exe con nombre .pdf');
  const grande = new Uint8Array(15 * 1024 * 1024 + 1); grande.set(PDF);
  es(await error(1001, { tipo: 'aceptacion', informe: new File([grande], 'grande.pdf', { type: 'application/pdf' }) }), [413, 'El archivo pesa más de 15 MB. Comprímelo o divídelo en partes.'], 'más de 15 MB');
  es(await error(1001, { notas: 'x'.repeat(2001) }), [400, 'Las notas tienen como máximo 2000 letras.'], 'notas largas');
  es(sql.prepare('SELECT COUNT(*) AS c FROM pruebas_seguridad_electrica').get().c, 0, 'nada se guardó con errores');
  es(r2.size, 0, 'ningún archivo quedó en R2');

  // ── Registrar ─────────────────────────────────────────────────────────────
  const meses12 = B.sumarMeses(dias(-1), 12);
  const r1 = await registrar(1001, { ordenId: '3001', proximaFecha: dias(30) });
  es(r1.status, 201, 'el técnico registra');
  const id1 = r1.body.prueba.id;
  es(r1.body, { prueba: { id: id1, resultado: 'pasa', proximaFecha: meses12 }, url: `/seguridad-electrica/${id1}` }, 'respuesta; el técnico no cambia la próxima');
  const g1 = fila('SELECT * FROM pruebas_seguridad_electrica WHERE id = ?', id1);
  es([g1.limite_tierra_ohm, g1.limite_aislamiento_mohm, g1.limite_fuga_equipo_ua, g1.limite_fuga_parte_ua], [0.3, 2, 500, 5000], 'los límites de Clase I/BF quedan en la fila');
  es([g1.tierra_ohm, g1.aislamiento_mohm, g1.fuga_equipo_ua, g1.fuga_parte_ua], [0.12, null, 120, 15], 'lo medido; el aislamiento es opcional');
  es([g1.resultado_calculado, g1.resultado, g1.motivo_resultado, g1.estado, g1.orden_id], ['pasa', 'pasa', null, 'valida', 3001], 'resultado y orden');
  es([g1.analizador_activo_id, g1.analizador_descripcion, g1.analizador_serie, g1.analizador_cal_vence], [1006, 'Fluke ESA615', 'SN-PAT-1', dias(65)], 'copia del analizador patrón y su vencimiento');
  es([g1.realizado_por, g1.realizado_por_id, g1.empresa_externa, g1.registrado_por], ['Prueba tecnico', 3, null, 3], 'quién realizó y quién registró');

  // Jefe: próxima a mano; Clase II/B ignora la tierra; a mano con fecha DD/MM/AAAA y persona externa.
  es(await error(1001, { proximaFecha: B.sumarMeses(dias(-1), 61) }, 'jefe'), [400, 'La próxima prueba debe ser posterior a la fecha de la prueba y dentro de 5 años.'], 'próxima a más de 5 años');
  es(await error(1001, { proximaFecha: dias(-1) }, 'jefe'), [400, 'La próxima prueba debe ser posterior a la fecha de la prueba y dentro de 5 años.'], 'próxima el mismo día');
  const r2b = await registrar(1001, {
    fecha: dias(-40), claseProteccion: 'II', parteAplicada: 'B', tierraOhm: '5', fugaEquipoUa: '40', fugaParteUa: '999',
    analizadorActivoId: '', analizadorDescripcion: 'Rigel 288+', analizadorSerie: 'RG-77', analizadorCalVence: B.fechaCorta(dias(100)),
    realizadoPorId: '', realizadoPor: 'Ing. Pérez', empresaExterna: 'Servicios Biomédicos S.A.', proximaFecha: dias(20), notas: 'Prueba de campo',
  }, 'jefe');
  es(r2b.status, 201, 'el jefe registra con analizador escrito a mano');
  const g2 = fila('SELECT * FROM pruebas_seguridad_electrica WHERE id = ?', r2b.body.prueba.id);
  es([g2.tierra_ohm, g2.limite_tierra_ohm, g2.fuga_parte_ua, g2.limite_fuga_parte_ua, g2.limite_aislamiento_mohm, g2.limite_fuga_equipo_ua], [null, null, null, null, 7, 100], 'lo que no aplica queda vacío');
  es([g2.analizador_activo_id, g2.analizador_cal_vence, g2.realizado_por, g2.realizado_por_id, g2.empresa_externa, g2.proxima_fecha, g2.notas],
    [null, dias(100), 'Ing. Pérez', null, 'Servicios Biomédicos S.A.', dias(20), 'Prueba de campo'], 'a mano, externo y próxima del jefe');

  // No pasa: calculado y confirmado; y «No pasa» sobre «Pasa» con motivo.
  const r3 = await registrar(1002, { parteAplicada: 'CF', fugaParteUa: '60', resultado: 'no_pasa' });
  es([r3.status, r3.body.prueba.resultado], [201, 'no_pasa'], 'CF con 60 µA: no pasa');
  es(fila('SELECT resultado_calculado, limite_fuga_parte_ua FROM pruebas_seguridad_electrica WHERE id = ?', r3.body.prueba.id), { resultado_calculado: 'no_pasa', limite_fuga_parte_ua: 50 }, 'límite CF');
  const r4 = await registrar(1009, { resultado: 'no_pasa', motivoResultado: 'Cable de alimentación con el aislamiento dañado' }, 'admin');
  es(fila('SELECT resultado_calculado, resultado, motivo_resultado FROM pruebas_seguridad_electrica WHERE id = ?', r4.body.prueba.id),
    { resultado_calculado: 'pasa', resultado: 'no_pasa', motivo_resultado: 'Cable de alimentación con el aislamiento dañado' }, 'no pasa por criterio, con motivo');

  // Aceptación con informe
  const r5 = await registrar(1001, { tipo: 'aceptacion', fecha: dias(-60), informe: pdf() });
  es(r5.status, 201, 'aceptación con informe');
  const g5 = fila('SELECT informe_r2_key, informe_nombre, informe_tipo, informe_tamano FROM pruebas_seguridad_electrica WHERE id = ?', r5.body.prueba.id);
  si(g5.informe_r2_key.startsWith('seguridad-electrica/1001/') && g5.informe_r2_key.endsWith('-informe_ESA615.pdf'), 'llave de R2 con el equipo y el nombre seguro');
  es([g5.informe_nombre, g5.informe_tipo, g5.informe_tamano, r2.get(g5.informe_r2_key)?.contentType], ['informe ESA615.pdf', 'application/pdf', PDF.length, 'application/pdf'], 'informe guardado con el tipo detectado');

  // Fallas: R2 caído al subir; la base falla después de subir (el archivo no queda huérfano).
  const filasAntes = fila('SELECT COUNT(*) AS c FROM pruebas_seguridad_electrica').c, objetosAntes = r2.size;
  const putReal = R2.put;
  R2.put = async () => { throw new Error('R2 sin servicio'); };
  es(await error(1001, { tipo: 'aceptacion', informe: pdf() }), [500, 'No se pudo subir el informe. Intenta de nuevo.'], 'R2 caído: error en texto');
  R2.put = putReal;
  h.faults.beforeStatement = { matches: (q) => /insert into "pruebas_seguridad_electrica"/i.test(q), run: async () => { throw new Error('D1 sin servicio'); } };
  es(await error(1001, { tipo: 'aceptacion', informe: pdf() }), [500, 'No se pudo guardar la prueba. Intenta de nuevo.'], 'la base falla: error en texto');
  es([fila('SELECT COUNT(*) AS c FROM pruebas_seguridad_electrica').c, r2.size], [filasAntes, objetosAntes], 'sin fila y sin archivo huérfano en R2');

  // Periodicidad
  es((await llamar(h.app.config.GET, '/api/seguridad-electrica/config', { rol: 'visualizador' })).body, { meses: 12 }, 'periodicidad de la siembra');
  es((await llamar(h.app.config.POST, '/api/seguridad-electrica/config', { method: 'POST', rol: 'tecnico', json: { meses: 6 } })).status, 403, 'el técnico no cambia la periodicidad');
  es((await llamar(h.app.config.POST, '/api/seguridad-electrica/config', { method: 'POST', rol: 'jefe', json: { meses: 0 } })).body, { error: 'Escribe un número de meses entre 1 y 60.' }, 'meses fuera de rango');
  es((await llamar(h.app.config.POST, '/api/seguridad-electrica/config', { method: 'POST', rol: 'jefe', json: { meses: 6 } })).body, { ok: true, meses: 6 }, 'el jefe la cambia');
  es(await L.periodicidadSeguridadElectrica(db), 6, 'queda en app_config');
  const r6 = await registrar(1003, { fecha: dias(-200), claseProteccion: 'II', parteAplicada: 'ninguna', tierraOhm: '', fugaEquipoUa: '40', fugaParteUa: '' });
  es(r6.body.prueba.proximaFecha, B.sumarMeses(dias(-200), 6), 'la prueba nueva usa 6 meses');
  sql.prepare("UPDATE app_config SET valor = 'doce' WHERE clave = 'bio.seguridad_electrica.meses'").run();
  es(await L.periodicidadSeguridadElectrica(db), 12, 'un valor ilegible vuelve a 12');

  // ── Lecturas: última, resumen, pruebas del equipo ────────────────────────
  const ultimas = await L.ultimasPruebasElectricas(db);
  es([ultimas.get(1001)?.id, ultimas.get(1002)?.id, ultimas.get(1003)?.id, ultimas.has(1005)], [id1, r3.body.prueba.id, r6.body.prueba.id, false], 'última válida por equipo (la de fecha mayor, no la última registrada)');
  const res1 = await L.resumenSeguridadElectrica(db, 1001, hoy);
  es([res1.estado, res1.ultima.id, res1.ultima.tieneInforme, res1.aceptacion, res1.total], ['vigente', id1, false, { id: r5.body.prueba.id, fecha: dias(-60), resultado: 'pasa' }, 3], 'resumen del equipo');
  es((await L.resumenSeguridadElectrica(db, 1002, hoy)).estado, 'no_pasa', 'no pasó');
  es((await L.resumenSeguridadElectrica(db, 1003, hoy)).estado, 'vencida', 'vencida (6 meses desde hace 200 días)');
  es((await L.resumenSeguridadElectrica(db, 1004, hoy)), { estado: 'sin_prueba', ultima: null, aceptacion: null, total: 0 }, 'sin pruebas');
  const get = await llamar(h.app.se.GET, '/api/activos/1001/seguridad-electrica', { id: 1001, rol: 'visualizador' });
  es([get.status, get.body.pruebas.length, get.body.resumen.estado], [200, 3, 'vigente'], 'el visualizador ve las pruebas');
  si(get.body.pruebas.every((p) => !('informeR2Key' in p) && typeof p.tieneInforme === 'boolean'), 'la llave de R2 no sale del servidor');
  es(get.body.pruebas.map((p) => p.fecha), [dias(-1), dias(-40), dias(-60)], 'las más nuevas primero');
  es(get.body.pruebas[0].ordenEtiqueta, fila('SELECT codigo FROM ordenes WHERE id = 3001').codigo ?? 'OT #3001', 'etiqueta de la orden');

  // ── Anular ────────────────────────────────────────────────────────────────
  const anular = (id, motivo, rol = 'jefe') => llamar(h.app.anular.POST, `/api/seguridad-electrica/${id}/anular`, { method: 'POST', id, rol, json: { motivo } });
  es((await anular(id1, 'Se registró en el equipo equivocado', 'tecnico')).status, 403, 'el técnico no anula');
  es((await anular(id1, 'corto')).body, { error: 'Escribe el motivo (al menos 10 letras).' }, 'motivo corto');
  es((await anular(99999, 'Se registró en el equipo equivocado')).status, 404, 'prueba que no existe');
  es((await anular(id1, 'Se registró en el equipo equivocado')).body, { ok: true }, 'el jefe anula');
  const anulada = fila('SELECT estado, anulada_por, anulada_en, motivo_anulacion, informe_r2_key FROM pruebas_seguridad_electrica WHERE id = ?', id1);
  es([anulada.estado, anulada.anulada_por, anulada.motivo_anulacion], ['anulada', 2, 'Se registró en el equipo equivocado'], 'queda anulada con quién y por qué');
  si(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(anulada.anulada_en), 'anulada_en en ISO con Z');
  es((await anular(id1, 'Se registró en el equipo equivocado')).status, 409, 'no se anula dos veces');
  const res1b = await L.resumenSeguridadElectrica(db, 1001, hoy);
  es([res1b.ultima.id, res1b.ultima.fecha, res1b.estado, res1b.total], [r2b.body.prueba.id, dias(-40), 'por_vencer', 2], 'la anulada sale de «última»: queda la del jefe (próxima en 20 días)');
  const deActivo = await L.pruebasDeActivo(db, 1001);
  es(deActivo.map((p) => [p.id, p.estado]), [[id1, 'anulada'], [r2b.body.prueba.id, 'valida'], [r5.body.prueba.id, 'valida']], 'la anulada sigue en el equipo');
  es([deActivo[0].anuladaPorNombre, deActivo[0].registradoPorNombre], ['Prueba jefe', 'Prueba tecnico'], 'con los nombres');

  // ── Informe: descargar y adjuntar el que falta ────────────────────────────
  const idInforme = r5.body.prueba.id;
  const descarga = await llamar(h.app.informe.GET, `/api/seguridad-electrica/${idInforme}/informe`, { id: idInforme, rol: 'visualizador' });
  es([descarga.status, descarga.headers.get('content-type'), descarga.headers.get('x-content-type-options'), descarga.headers.get('cache-control')], [200, 'application/pdf', 'nosniff', 'private, max-age=60'], 'cabeceras de la descarga');
  si(descarga.headers.get('content-disposition').startsWith('inline; filename="informe ESA615.pdf"'), 'con su nombre');
  es([...descarga.bytes], [...PDF], 'el mismo archivo');
  es((await llamar(h.app.informe.GET, `/api/seguridad-electrica/${idInforme}/informe`, { id: idInforme, rol: 'solicitante' })).status, 403, 'el solicitante no descarga');
  es((await llamar(h.app.informe.GET, `/api/seguridad-electrica/${r3.body.prueba.id}/informe`, { id: r3.body.prueba.id, rol: 'admin' })).body, { error: 'Sin informe' }, 'prueba sin informe');
  const adjuntar = (id, archivo, rol = 'tecnico') => llamar(h.app.informe.POST, `/api/seguridad-electrica/${id}/informe`, { method: 'POST', id, rol, form: { informe: archivo } });
  es((await adjuntar(r3.body.prueba.id, pdf(), 'visualizador')).status, 403, 'el visualizador no adjunta');
  es((await adjuntar(r3.body.prueba.id, new File([new Uint8Array([1, 2, 3])], 'x.pdf'))).status, 415, 'tipo no permitido');
  es((await adjuntar(r3.body.prueba.id, pdf('reporte.pdf'))).body, { ok: true }, 'el técnico adjunta el que falta');
  es(fila('SELECT informe_nombre, informe_tipo FROM pruebas_seguridad_electrica WHERE id = ?', r3.body.prueba.id), { informe_nombre: 'reporte.pdf', informe_tipo: 'application/pdf' }, 'informe adjuntado');
  const enR2 = r2.size;
  es((await adjuntar(r3.body.prueba.id, pdf('otro.pdf'))).body, { error: 'Esta prueba ya tiene informe.' }, 'no se reemplaza');
  es((await adjuntar(id1, pdf())).body, { error: 'La prueba está anulada.' }, 'no se adjunta a una anulada');
  es(r2.size, enR2, 'los rechazos no dejan archivos en R2');

  // ── Tablero ───────────────────────────────────────────────────────────────
  sql.prepare(`INSERT INTO pruebas_seguridad_electrica (activo_id, fecha, tipo, clase_proteccion, parte_aplicada, metodo_fuga, inspeccion_visual, prueba_funcional,
    resultado_calculado, resultado, analizador_descripcion, analizador_serie, analizador_cal_vence, realizado_por, proxima_fecha, registrado_por)
    VALUES (1009, ?, 'periodica', 'interna', 'ninguna', 'directo', 'conforme', 'conforme', 'pasa', 'pasa', 'Fluke', 'S', ?, 'X', ?, 1)`).run(dias(-1), dias(10), dias(10));
  const t3 = await L.tableroSeguridadElectrica(db, { alcance: 'clase3', hoy });
  es(t3.filas.map((f) => [f.codigo, f.estado]), [['BIO-1002', 'no_pasa'], ['BIO-1001', 'por_vencer']], 'Clase III: sin bajas ni patrones, lo más grave primero');
  es([t3.total, t3.cumplen, t3.conteo.no_pasa, t3.conteo.por_vencer, t3.conteo.vencida, t3.periodicidadMeses], [2, 1, 1, 1, 0, 12], 'conteos Clase III');
  const tb = await L.tableroSeguridadElectrica(db, { alcance: 'biomedicos', hoy });
  es(tb.filas.map((f) => [f.codigo, f.estado]), [['BIO-1002', 'no_pasa'], ['BIO-1003', 'vencida'], ['BIO-1009', 'por_vencer'], ['BIO-1001', 'por_vencer']], 'todos los biomédicos (sin bajas ni patrones); a igual estado, la próxima más cercana primero');
  es([tb.cumplen, L.porcentajeAlDia(tb)], [2, 50], 'al día');
  const tsede = await L.tableroSeguridadElectrica(db, { alcance: 'biomedicos', sucursalId: 101, hoy });
  es(tsede.filas.map((f) => f.codigo), ['BIO-1003', 'BIO-1009', 'BIO-1001'], 'por sede');
  const monitor = tsede.filas.find((f) => f.codigo === 'BIO-1001');
  es([monitor.sucursal, monitor.ubicacion, monitor.claseRiesgo, monitor.ultima.analizadorCalVence], ['Sede Central', 'UCI Adultos', 'III', dias(100)], 'sede, ubicación, clase y vencimiento del analizador');

  // ── CSV ───────────────────────────────────────────────────────────────────
  const sello = hoy.replace(/-/g, '');
  const csvT = await llamar(h.app.csv.GET, '/api/seguridad-electrica/csv?alcance=biomedicos&estado=vencida', { rol: 'visualizador' });
  es([csvT.status, csvT.headers.get('content-type'), csvT.headers.get('content-disposition')], [200, 'text/csv; charset=utf-8', `attachment; filename="seguridad-electrica-biomedicos_${sello}.csv"`], 'CSV del tablero');
  const lineasT = csvT.text.replace(/^﻿/, '').split('\r\n');
  es(lineasT[0], 'Código,Equipo,Marca,Modelo,Serie,Nº de activo,Sede,Ubicación,Clase de riesgo,Estado del equipo,Clase de protección,Parte aplicada,Última prueba,Tipo de prueba,Resultado,Analizador,Serie del analizador,Calibración del analizador vence,Realizó,Próxima prueba,Estado de la prueba,Informe adjunto', 'columnas del tablero');
  es(lineasT.length, 2, 'solo las vencidas');
  es(lineasT[1], `BIO-1003,BOMBA DE INFUSIÓN,BBraun,Infusomat,B-1,,Sede Central,UCI Adultos,Clase IIb (riesgo moderado-alto),Operativo,Clase II (doble aislamiento),Sin parte aplicada,${dias(-200)},Periódica,Pasa,Fluke ESA615,SN-PAT-1,${dias(65)},Prueba tecnico,${B.sumarMeses(dias(-200), 6)},Vencida,No`, 'fila con etiquetas, fechas AAAA-MM-DD y Sí/No');
  const csvE = await llamar(h.app.csv.GET, '/api/seguridad-electrica/csv?activoId=1001', { rol: 'tecnico' });
  es(csvE.headers.get('content-disposition'), `attachment; filename="seguridad-electrica-BIO-1001_${sello}.csv"`, 'CSV del equipo');
  const lineasE = csvE.text.replace(/^﻿/, '').split('\r\n');
  es(lineasE.length, 4, 'las tres pruebas del equipo');
  si(lineasE[0].startsWith('Fecha,Tipo,Orden,Clase de protección,Parte aplicada,Método,Inspección visual,Tierra (Ω),Límite tierra,') && lineasE[0].includes(',Registrado el,Hora de registro,Próxima,Informe,Registro (Válida/Anulada),Anulada el,Motivo de anulación,Notas'), 'columnas del equipo');
  si(lineasE[1].startsWith(`${dias(-1)},Periódica,`) && lineasE[1].includes(',0.12,0.3,,2,120,500,15,5000,') && lineasE[1].includes(',Anulada,'), 'la anulada, con valores y límites');
  si(!/\d{4}-\d{2}-\d{2}T\d{2}:/.test(csvE.text), 'sin marcas ISO con «T» en el CSV');
  es((await llamar(h.app.csv.GET, '/api/seguridad-electrica/csv?activoId=99999', { rol: 'admin' })).status, 404, 'CSV de un equipo que no existe');
  es((await llamar(h.app.csv.GET, '/api/seguridad-electrica/csv', { rol: 'solicitante' })).status, 403, 'el solicitante no descarga el CSV');

  // ── Registro imprimible ───────────────────────────────────────────────────
  const reg = await L.cargarPrueba(db, r3.body.prueba.id);
  es([reg.equipo.codigo, reg.sucursal, reg.ubicacion, reg.registradoPorNombre, reg.orden], ['BIO-1002', 'Sede Norte', 'Emergencia', 'Prueba tecnico', null], 'datos del registro');
  es(await L.cargarPrueba(db, 99999), null, 'registro que no existe');
  es((await L.ordenesDelEquipo(db, 1001)).map((o) => o.id), [3001], 'órdenes del equipo para el formulario');
  es((await L.personasQueRealizan(db)).map((p) => p.rol).sort(), ['admin', 'jefe', 'tecnico'], 'quién puede figurar como «realizó»');
} finally {
  await h.close();
}

console.log(`PASS test-bio-seguridad-electrica: ${n} casos; pruebas IEC 62353 con analizador vigente, anulación, informe, tablero Clase III y CSV.`);
