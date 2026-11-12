// Fase 59 · WP-G: marca de incidente en la orden, borrado de órdenes marcadas,
// bitácora del borrado en lote y equipo en el formulario público de soporte.
// Reglas puras de src/lib/incidentes.ts y rutas reales sobre SQLite con todas las
// migraciones (sin red, sin D1 ni R2 reales; los correos y la bitácora se capturan).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({ entryPoints: ['src/lib/incidentes.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
const I = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const ok = (valor) => ({ ok: true, valor });
const mal = (error) => ({ ok: false, error });
const HOY = '2026-11-12';

// ── validarMarcaIncidente ───────────────────────────────────────────────────
es(I.validarMarcaIncidente({ fechaNotificacion: '2026-11-10', numeroReporte: '  RC-2026-0148 ', nota: '  Equipo retirado  ' }, HOY),
  ok({ numeroReporte: 'RC-2026-0148', fechaNotificacion: '2026-11-10', nota: 'Equipo retirado' }), 'recorta número y nota');
es(I.validarMarcaIncidente({ fechaNotificacion: '' }, HOY), mal('Escribe la fecha en que se avisó a Calidad.'), 'fecha vacía');
es(I.validarMarcaIncidente(null, HOY), mal('Escribe la fecha en que se avisó a Calidad.'), 'cuerpo null');
es(I.validarMarcaIncidente('texto', HOY), mal('Escribe la fecha en que se avisó a Calidad.'), 'cuerpo que no es objeto');
es(I.validarMarcaIncidente({ fechaNotificacion: '2026-02-30' }, HOY), mal('La fecha de aviso a Calidad no es válida.'), '30 de febrero');
es(I.validarMarcaIncidente({ fechaNotificacion: '10/11/2026' }, HOY), mal('La fecha de aviso a Calidad no es válida.'), 'otro formato');
es(I.validarMarcaIncidente({ fechaNotificacion: '2026-11-13' }, HOY), mal('La fecha de aviso a Calidad no puede ser posterior a hoy.'), 'mañana');
es(I.validarMarcaIncidente({ fechaNotificacion: ' 2026-11-12 ' }, HOY), ok({ numeroReporte: null, fechaNotificacion: '2026-11-12', nota: null }), 'hoy vale');
es(I.validarMarcaIncidente({ fechaNotificacion: HOY, numeroReporte: '' }, HOY).valor.numeroReporte, null, 'número vacío → null');
es(I.validarMarcaIncidente({ fechaNotificacion: HOY, numeroReporte: 148 }, HOY).valor.numeroReporte, '148', 'número como número');
es(I.validarMarcaIncidente({ fechaNotificacion: HOY, numeroReporte: 'RC  2026' }, HOY).valor.numeroReporte, 'RC 2026', 'junta espacios');
es(I.validarMarcaIncidente({ fechaNotificacion: HOY, numeroReporte: 'X'.repeat(61) }, HOY), mal('El número de reporte admite hasta 60 caracteres.'), '61 caracteres');
es(I.validarMarcaIncidente({ fechaNotificacion: HOY, numeroReporte: 'X'.repeat(60) }, HOY).ok, true, '60 caracteres');
es(I.validarMarcaIncidente({ fechaNotificacion: HOY, numeroReporte: {} }, HOY), mal('El número de reporte no es válido.'), 'objeto como número');
es(I.validarMarcaIncidente({ fechaNotificacion: HOY, numeroReporte: true }, HOY), mal('El número de reporte no es válido.'), 'booleano como número');
es(I.validarMarcaIncidente({ fechaNotificacion: HOY, nota: 'n'.repeat(1001) }, HOY), mal('La nota admite hasta 1000 caracteres.'), 'nota de 1001');
es(I.validarMarcaIncidente({ fechaNotificacion: HOY, nota: '   ' }, HOY).valor.nota, null, 'nota en blanco → null');
es(I.validarMarcaIncidente({ fechaNotificacion: HOY, nota: 5 }, HOY), mal('La nota no es válida.'), 'nota que no es texto');
es(I.validarMarcaIncidente({ fechaNotificacion: HOY, nota: 'Línea 1\nLínea 2' }, HOY).valor.nota, 'Línea 1\nLínea 2', 'conserva saltos de línea');

// ── validarMotivoQuitar ─────────────────────────────────────────────────────
es(I.validarMotivoQuitar({ motivo: 'corto' }), mal('Escribe por qué se quita la marca (mínimo 10 letras).'), 'motivo corto');
es(I.validarMotivoQuitar({}), mal('Escribe por qué se quita la marca (mínimo 10 letras).'), 'sin motivo');
es(I.validarMotivoQuitar(null), mal('Escribe por qué se quita la marca (mínimo 10 letras).'), 'cuerpo null');
es(I.validarMotivoQuitar({ motivo: '  Se marcó en la orden equivocada ' }), ok('Se marcó en la orden equivocada'), 'recorta el motivo');
es(I.validarMotivoQuitar({ motivo: 'm'.repeat(501) }), mal('El motivo admite hasta 500 caracteres.'), '501 caracteres');

// ── cambiosMarca y resumenMarca ─────────────────────────────────────────────
const M = { numeroReporte: null, fechaNotificacion: '2026-11-10', nota: 'Equipo en cuarentena' };
es(I.cambiosMarca(null, M), { 'Aviso a Calidad': { antes: null, despues: '2026-11-10' }, Nota: { antes: null, despues: 'Equipo en cuarentena' } }, 'alta: solo lo que no es null');
es(I.cambiosMarca(M, M), {}, 'sin cambios');
es(I.cambiosMarca(M, null), { 'Aviso a Calidad': { antes: '2026-11-10', despues: null }, Nota: { antes: 'Equipo en cuarentena', despues: null } }, 'baja: lo anterior');
es(I.cambiosMarca(M, { ...M, numeroReporte: 'RC-1' }), { 'Reporte de Calidad': { antes: null, despues: 'RC-1' } }, 'edición del número');
es(I.resumenMarca('marcar', M), 'Marcó la orden como incidente · reporte de Calidad pendiente · aviso a Calidad 10/11/2026', 'marcar sin número');
es(I.resumenMarca('marcar', { ...M, numeroReporte: 'RC-2026-0148' }), 'Marcó la orden como incidente · reporte de Calidad RC-2026-0148 · aviso a Calidad 10/11/2026', 'marcar con número');
es(I.resumenMarca('editar', M, { campos: ['Reporte de Calidad', 'Nota'] }), 'Editó la marca de incidente: Reporte de Calidad, Nota', 'editar con campos');
es(I.resumenMarca('editar', M), 'Editó la marca de incidente', 'editar sin campos');
es(I.resumenMarca('quitar', M, { motivo: 'Se marcó por error' }), 'Quitó la marca de incidente (reporte sin número, aviso 10/11/2026). Motivo: Se marcó por error', 'quitar sin número');
es(I.resumenMarca('quitar', { ...M, numeroReporte: 'RC-9' }, { motivo: 'Duplicada en otra orden' }), 'Quitó la marca de incidente (reporte RC-9, aviso 10/11/2026). Motivo: Duplicada en otra orden', 'quitar con número');

// ── Borrado en lote ─────────────────────────────────────────────────────────
es(I.mensajeOrdenesMarcadas(['OT-MB0003']), 'La selección contiene una orden marcada como incidente (OT-MB0003). Quita la marca en su ficha antes de borrarla.', 'una');
es(I.mensajeOrdenesMarcadas(['OT-MB0003', 'OT-MB0007', 'OT-MG0002']), 'La selección contiene 3 órdenes marcadas como incidente (OT-MB0003, OT-MB0007, OT-MG0002). Quita la marca en la ficha de cada una antes de borrarlas.', 'tres');
es(I.mensajeOrdenesMarcadas(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']), 'La selección contiene 7 órdenes marcadas como incidente (A1, A2, A3, A4, A5, …). Quita la marca en la ficha de cada una antes de borrarlas.', 'siete: cinco y «…»');
const lineas = I.lineasBorradoLote([{ id: 5, codigo: null, titulo: 'Cambio', estado: 'abierta', tipo: 'correctivo', activoId: null }]);
es(lineas[0].resumen, 'OT eliminada en borrado por lote (1): OT #5 "Cambio"', 'sin código usa el id');
es(lineas[0], { entidad: 'orden', entidadId: 5, accion: 'delete', resumen: 'OT eliminada en borrado por lote (1): OT #5 "Cambio"',
  cambios: { estado: { antes: 'abierta', despues: null }, tipo: { antes: 'correctivo', despues: null }, activoId: { antes: null, despues: null } } }, 'línea completa');
es(I.lineasBorradoLote([{ id: 8, codigo: 'OT-MB0008', titulo: 'A', estado: 'cerrada', tipo: 'preventivo', activoId: 3 }, { id: 9, codigo: 'OT-MG0001', titulo: 'B', estado: 'abierta', tipo: 'correctivo', activoId: null }]).map((l) => l.resumen),
  ['OT eliminada en borrado por lote (2): OT-MB0008 "A"', 'OT eliminada en borrado por lote (2): OT-MG0001 "B"'], 'una línea por orden con el total');
es(I.lineasBorradoLote([]), [], 'lote vacío');

// ── Filtros del listado ─────────────────────────────────────────────────────
const filtros = (qs) => I.leerFiltrosIncidentes(new URLSearchParams(qs));
es(filtros(''), { ok: true, error: null, filtros: { desde: null, hasta: null, activoId: null } }, 'sin filtros');
es(filtros('desde=2026-13-01'), { ok: false, error: 'La fecha «desde» no es válida.', filtros: { desde: null, hasta: null, activoId: null } }, 'desde inválida');
es(filtros('hasta=2026-02-30').error, 'La fecha «hasta» no es válida.', 'hasta inválida');
es(filtros('desde=2026-07-01&hasta=2026-06-30'), { ok: false, error: 'La fecha «desde» es posterior a «hasta».', filtros: { desde: '2026-07-01', hasta: '2026-06-30', activoId: null } }, 'desde > hasta');
es(filtros('desde=01/07/2026&hasta=2026-12-31').filtros.desde, '2026-07-01', 'acepta DD/MM/AAAA escrito a mano');
for (const malo of ['abc', '0', '-3', '1.5', '12abc']) es(filtros(`activo=${malo}`).filtros.activoId, null, `activo=${malo} → null`);
es(filtros('activo=12'), { ok: true, error: null, filtros: { desde: null, hasta: null, activoId: 12 } }, 'activo=12');
es(I.textoFiltros({ desde: '2026-01-01', hasta: '2026-06-30', activoId: null }), 'Del 01/01/2026 al 30/06/2026 · todos los equipos', 'periodo completo');
es(I.textoFiltros({ desde: '2026-01-01', hasta: null, activoId: 4 }, 'EQ-04 · Monitor'), 'Desde el 01/01/2026 · Equipo EQ-04 · Monitor', 'desde y equipo');
es(I.textoFiltros({ desde: null, hasta: '2026-06-30', activoId: null }), 'Hasta el 30/06/2026 · todos los equipos', 'hasta');
es(I.textoFiltros({ desde: null, hasta: null, activoId: 4 }), 'Todas las fechas · Equipo #4', 'equipo sin nombre');
es(I.textoFiltros({ desde: null, hasta: null, activoId: null }), 'Todas las fechas · todos los equipos', 'sin filtros');

// ── CSV ─────────────────────────────────────────────────────────────────────
const fila = {
  ordenId: 7, orden: 'OT-MB0007', ordenTitulo: 'Monitor sin imagen', tipoOrden: 'Correctivo', estadoOrden: 'Cerrada',
  numeroReporte: null, fechaNotificacion: '2026-11-10', nota: null, marcadoPor: 'Prueba jefe', marcadoEn: '2026-11-12 15:30:00',
  equipoCodigo: 'EQ-07', equipoNombre: 'Monitor', equipoSerie: null, ubicacion: 'UCI', causaRaiz: 'Cable dañado',
};
const csv = I.filaCsvIncidente(fila, 'https://mantenimiento.example/');
es(csv.numeroReporte, 'pendiente', 'número null → pendiente');
es(csv.fechaNotificacion, '2026-11-10', 'aviso AAAA-MM-DD');
es(csv.marcadoEn, '2026-11-12 09:30', 'marca AAAA-MM-DD HH:MM en hora de SV');
es(csv.reporte, 'https://mantenimiento.example/ordenes/7/reporte', 'enlace al reporte de la orden');
es([csv.nota, csv.equipoSerie], ['', ''], 'null → vacío');
es(Object.keys(csv).sort(), I.COLUMNAS_CSV_INCIDENTES.map((c) => c.key).sort(), 'claves = columnas');
es(I.COLUMNAS_CSV_INCIDENTES.map((c) => c.label), ['Aviso a Calidad', 'Reporte de Calidad', 'Orden', 'Título de la orden', 'Tipo de orden', 'Estado de la orden', 'Código del equipo', 'Equipo', 'Serie', 'Ubicación', 'Causa raíz', 'Nota', 'Marcó', 'Marcado el', 'Reporte de la orden'], 'títulos en orden');
es(I.filaCsvIncidente({ ...fila, marcadoEn: '2026-11-13T05:10:00.000Z' }, 'https://x').marcadoEn, '2026-11-12 23:10', 'ISO con Z: día anterior en SV');
es(I.contarIncidentes([{ numeroReporte: null }, { numeroReporte: 'X' }]), { total: 2, sinNumero: 1 }, 'conteo');
es(I.nombreCsvIncidentes('2026-11-12'), 'incidentes_20261112.csv', 'nombre del CSV');

// ═══ Rutas reales (SQLite con todas las migraciones) ═════════════════════════
// Las rutas se empaquetan con capturas propias: correo, bitácora y jefes a notificar.
async function empaquetar(entradas) {
  const carpeta = await fs.mkdtemp(path.join(os.tmpdir(), 'bio-incidentes-'));
  const salida = path.join(carpeta, 'rutas.mjs');
  await build({
    stdin: { contents: Object.entries(entradas).map(([nombre, archivo]) => `export * as ${nombre} from ${JSON.stringify(`./src/${archivo}`)};`).join('\n'), resolveDir: raiz, loader: 'ts' },
    outfile: salida, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'capturas', setup(b) {
      b.onResolve({ filter: /^@\/lib\/(email|smtp-worker|telegram|notificaciones|notif-app|audit|especialidad)$/ }, (a) => ({ path: a.path.split('/').at(-1), namespace: 'capturas' }));
      b.onLoad({ filter: /.*/, namespace: 'capturas' }, () => ({ contents: `
        const c = () => globalThis.__capturasWpG;
        export const sendMail = async (_ctx, m) => { c().correos.push(m); };
        export const emailLayout = (_titulo, cuerpo) => cuerpo;
        export const sendTelegram = async () => {}; export const crearNotificacion = async () => {};
        export const logAudit = async (_ctx, e) => { c().bitacora.push(e); };
        export const logAuditLote = async (_ctx, es) => { c().lotes.push(es); };
        export const calcularDiff = (_a, b) => b; export const labelCampo = (x) => x; export const resumenCambios = () => '';
        export const jefesNotificar = async () => [{ email: 'jefe@example.invalid' }];
        export const disparadorOT = async () => {}; export const disparadorProyecto = async () => {};
      `, loader: 'js' }));
    } }],
  });
  try { return await import(pathToFileURL(salida).href); } finally { await fs.rm(carpeta, { recursive: true, force: true }); }
}

const cap = { correos: [], bitacora: [], lotes: [] };
globalThis.__capturasWpG = cap;
const R = await empaquetar({
  incidente: 'pages/api/ordenes/[id]/incidente',
  orden: 'pages/api/ordenes/[id]/index',
  lote: 'pages/api/ordenes/bulk-delete',
  equipos: 'pages/api/tickets/publico/equipos',
  publico: 'pages/api/tickets/publico.ts',
});
const h = await setupConjuntos();
const { sqlite } = h;
const uno = (q, ...a) => sqlite.prepare(q).get(...a);
const llamar = async (ruta, url, opciones = {}) => {
  const r = await ruta(h.ctx(url, opciones));
  const texto = await r.text();
  let cuerpo; try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
  return { status: r.status, body: cuerpo, headers: r.headers };
};
const st = async (promesa, status, nota) => { const r = await promesa; n++; assert.equal(r.status, status, `${nota}: ${JSON.stringify(r.body)}`); return r; };

try {
  sqlite.exec(`
    INSERT INTO sucursales(id, nombre) VALUES (901, 'Sede de prueba');
    INSERT INTO ubicaciones(id, sucursal_id, nombre, activa) VALUES (901, 901, 'UCI de prueba', 1), (902, 901, 'Bodega cerrada', 0);
    INSERT INTO activos(id, codigo, nombre, tipo, rubro, ubicacion_id, estado, serial) VALUES
      (901, 'BIO-901', 'Monitor de signos', 'biomedico', 'biomedico', 901, 'operativo', 'SN-SECRETA'),
      (902, 'BIO-902', 'Bomba de infusión vieja', 'biomedico', 'biomedico', 901, 'baja', NULL),
      (903, 'GEN-903', 'Refrigerador de medicamentos', 'general', 'equipo_general', 901, 'operativo', NULL),
      (904, 'BIO-904', 'Ventilador en bodega', 'biomedico', 'biomedico', 902, 'operativo', NULL);
    INSERT INTO ordenes(id, titulo, rubro, tipo, estado, activo_id, creado_por, causa_raiz, checklist_ejecucion) VALUES
      (901, 'Monitor sin imagen', 'biomedico', 'correctivo', 'en_proceso', 901, 1, 'Cable dañado', '[{"texto":"Revisar cable","estado":"ok"}]'),
      (902, 'Revisión general', 'biomedico', 'preventivo', 'abierta', NULL, 1, NULL, NULL),
      (903, 'Refrigerador ruidoso', 'equipo_general', 'correctivo', 'abierta', 903, 1, NULL, NULL);
  `);
  const codigo901 = uno('SELECT codigo FROM ordenes WHERE id = 901').codigo;
  es(/^OT-MB\d{4}$/.test(codigo901), true, 'la orden recibe su código');
  const ordenAntes = JSON.stringify(uno('SELECT * FROM ordenes WHERE id = 901'));
  const url901 = '/api/ordenes/901/incidente';
  const marca = (data, rol = 'jefe', id = 901, url = url901) => llamar(R.incidente.PUT, url, { method: 'PUT', id, data, rol });
  const quitar = (data, rol = 'jefe', id = 901) => llamar(R.incidente.DELETE, `/api/ordenes/${id}/incidente`, { method: 'DELETE', id, data, rol });

  // Roles: solo admin y jefe marcan.
  await st(marca({ fechaNotificacion: '2026-11-01' }, null), 401, 'sin sesión');
  for (const rol of ['tecnico', 'visualizador', 'solicitante', 'motorista']) await st(marca({ fechaNotificacion: '2026-11-01' }, rol), 403, `${rol} no marca`);
  es((await st(marca({ fechaNotificacion: '2026-11-01' }, 'jefe', 'abc', '/api/ordenes/abc/incidente'), 400, 'id inválido')).body, { error: 'Orden inválida' }, 'texto de id inválido');
  es((await st(marca({}), 400, 'sin fecha')).body.error, 'Escribe la fecha en que se avisó a Calidad.', 'sin fecha');
  es((await st(marca({ fechaNotificacion: '2999-01-01' }), 400, 'fecha futura')).body.error, 'La fecha de aviso a Calidad no puede ser posterior a hoy.', 'fecha futura');
  es((await st(marca({ fechaNotificacion: '2026-11-01' }, 'jefe', 99999, '/api/ordenes/99999/incidente'), 404, 'orden inexistente')).body.error, 'La orden no existe', 'orden inexistente');
  await st(marca({ fechaNotificacion: '2026-11-01' }, 'jefe', 901, `${url901}?area=aires`), 400, 'área de otra orden');
  es(uno('SELECT count(*) AS n FROM orden_incidentes').n, 0, 'nada se guardó con errores');

  // Marcar sin número (lo asigna Calidad después).
  es((await st(marca({ fechaNotificacion: '2026-11-01', nota: ' Retirado de uso ' }), 201, 'jefe marca')).body, { ok: true, creada: true }, 'respuesta del alta');
  const fila901 = uno('SELECT * FROM orden_incidentes WHERE orden_id = 901');
  es([fila901.numero_reporte, fila901.fecha_notificacion, fila901.nota, fila901.marcado_por], [null, '2026-11-01', 'Retirado de uso', 2], 'fila guardada');
  es(cap.bitacora.at(-1), { entidad: 'orden', entidadId: 901, accion: 'update',
    cambios: { 'Aviso a Calidad': { antes: null, despues: '2026-11-01' }, Nota: { antes: null, despues: 'Retirado de uso' } },
    resumen: 'Marcó la orden como incidente · reporte de Calidad pendiente · aviso a Calidad 01/11/2026' }, 'bitácora del alta');
  es(JSON.stringify(uno('SELECT * FROM ordenes WHERE id = 901')), ordenAntes, 'la orden (estado, checklist, causa raíz) no cambia');
  es((await st(marca({ fechaNotificacion: '2026-11-01', nota: 'Retirado de uso' }), 200, 'mismos datos')).body, { ok: true, sinCambios: true }, 'sin cambios');
  es((await st(marca({ fechaNotificacion: '2026-11-01', nota: 'Retirado de uso', numeroReporte: 'RC-2026-0148' }, 'admin'), 200, 'admin edita')).body, { ok: true }, 'edición');
  es([uno('SELECT numero_reporte FROM orden_incidentes WHERE orden_id = 901').numero_reporte, uno('SELECT marcado_por FROM orden_incidentes WHERE orden_id = 901').marcado_por], ['RC-2026-0148', 2], 'edita el número; quién marcó no cambia');
  es(cap.bitacora.at(-1).resumen, 'Editó la marca de incidente: Reporte de Calidad', 'bitácora de la edición');
  es(JSON.stringify(uno('SELECT * FROM ordenes WHERE id = 901')), ordenAntes, 'editar tampoco toca la orden');

  // Una orden marcada no se borra (una sola o en lote).
  const borrarUna = await st(llamar(R.orden.DELETE, '/api/ordenes/901', { method: 'DELETE', id: 901, rol: 'admin' }), 409, 'borrar una orden marcada');
  es(borrarUna.body.error, 'La orden está marcada como incidente. Quita la marca en su ficha antes de borrarla.', 'texto del 409');
  const lote409 = await st(llamar(R.lote.POST, '/api/ordenes/bulk-delete', { method: 'POST', data: { ids: [902, 901, 903] }, rol: 'admin' }), 409, 'lote con una marcada');
  es(lote409.body.error, `La selección contiene una orden marcada como incidente (${codigo901}). Quita la marca en su ficha antes de borrarla.`, 'el 409 nombra la orden');
  es(uno('SELECT count(*) AS n FROM ordenes WHERE id IN (901, 902, 903)').n, 3, 'nada se borró');
  es(cap.lotes.length, 0, 'sin bitácora de borrado');
  // 500 ids (el máximo del lote) en un solo parámetro JSON: D1 acepta 100 por consulta.
  const muchos = Array.from({ length: 499 }, (_, i) => 100000 + i).concat(901);
  await st(llamar(R.lote.POST, '/api/ordenes/bulk-delete', { method: 'POST', data: { ids: muchos }, rol: 'admin' }), 409, 'lote grande con la marcada');
  const consultaMarcadas = h.queries.filter((q) => /json_each/.test(q.sql)).at(-1);
  es(!!consultaMarcadas && (consultaMarcadas.sql.match(/\?/g) ?? []).length, 1, 'un solo parámetro para la lista de ids');

  // Quitar la marca: motivo obligatorio.
  es((await st(quitar({}), 400, 'sin motivo')).body.error, 'Escribe por qué se quita la marca (mínimo 10 letras).', 'sin motivo');
  await st(quitar({ motivo: 'corto' }), 400, 'motivo corto');
  await st(quitar({ motivo: 'Se marcó en la orden equivocada' }, 'tecnico'), 403, 'técnico no quita');
  es((await st(quitar({ motivo: 'Se marcó en la orden equivocada' }, 'jefe', 902), 404, 'orden sin marca')).body.error, 'Esta orden no está marcada como incidente.', 'sin marca');
  await st(quitar({ motivo: 'Se marcó en la orden equivocada' }, 'jefe', 99999), 404, 'orden inexistente');
  es((await st(quitar({ motivo: '  Se marcó en la orden equivocada ' }), 200, 'jefe quita')).body, { ok: true }, 'quitar');
  es(uno('SELECT count(*) AS n FROM orden_incidentes WHERE orden_id = 901').n, 0, 'la fila se borra');
  es(cap.bitacora.at(-1).resumen, 'Quitó la marca de incidente (reporte RC-2026-0148, aviso 01/11/2026). Motivo: Se marcó en la orden equivocada', 'bitácora al quitar');
  es(cap.bitacora.at(-1).accion, 'update', 'quitar la marca no se registra como borrado de la orden');
  es(JSON.stringify(uno('SELECT * FROM ordenes WHERE id = 901')), ordenAntes, 'quitar no toca la orden');

  // Sin marca, el lote borra y deja una línea por orden con logAuditLote.
  const lote = await st(llamar(R.lote.POST, '/api/ordenes/bulk-delete', { method: 'POST', data: { ids: [901, 902] }, rol: 'admin' }), 200, 'lote sin marcadas');
  es(lote.body, { ok: true, borradas: 2 }, 'respuesta del lote sin cambios');
  es(cap.lotes.length, 1, 'una sola llamada a logAuditLote');
  es(cap.lotes[0].map((l) => [l.entidad, l.entidadId, l.accion]).sort((a, b) => a[1] - b[1]), [['orden', 901, 'delete'], ['orden', 902, 'delete']], 'una línea por orden');
  es(cap.lotes[0].find((l) => l.entidadId === 901).resumen, `OT eliminada en borrado por lote (2): ${codigo901} "Monitor sin imagen"`, 'resumen con código y título');
  es(cap.lotes[0].every((l) => /^OT eliminada en borrado por lote \(2\): OT-MB\d{4} "/.test(l.resumen)), true, 'las dos con su código');
  es(uno('SELECT count(*) AS n FROM ordenes WHERE id IN (901, 902)').n, 0, 'borradas');

  // ── Formulario público: equipos de una ubicación ──────────────────────────
  const equipos = (qs) => llamar(R.equipos.GET, `/api/tickets/publico/equipos${qs}`, { rol: null });
  for (const qs of ['', '?ubicacionId=abc', '?ubicacionId=0', '?ubicacionId=-1', '?ubicacionId=1.5']) {
    es((await st(equipos(qs), 400, `ubicación ${qs || 'vacía'}`)).body, { error: 'Ubicación inválida' }, `texto ${qs || 'vacía'}`);
  }
  es((await st(equipos('?ubicacionId=901&area=otras'), 400, 'área inválida')).body, { error: 'Área de mantenimiento inválida' }, 'texto del área');
  es((await st(equipos('?ubicacionId=902'), 404, 'ubicación inactiva')).body, { error: 'Ubicación no encontrada' }, 'inactiva');
  await st(equipos('?ubicacionId=99999'), 404, 'ubicación inexistente');
  const lista = await st(equipos('?ubicacionId=901'), 200, 'lista sin sesión');
  es(lista.body, { equipos: [
    { id: 901, codigo: 'BIO-901', nombre: 'Monitor de signos', area: 'biomedico' },
    { id: 903, codigo: 'GEN-903', nombre: 'Refrigerador de medicamentos', area: 'equipo_general' },
  ] }, 'sin dados de baja, por código, sin serie');
  es(lista.headers.get('cache-control'), 'private, max-age=120', 'caché corta y privada');
  es((await st(equipos('?ubicacionId=901&area=biomedico'), 200, 'solo biomédicos')).body.equipos.map((e) => e.id), [901], '?area=biomedico');
  es((await st(equipos('?ubicacionId=901&area='), 200, 'área vacía = todas')).body.equipos.length, 2, 'área vacía');

  // ── Ticket público con equipo ─────────────────────────────────────────────
  const ticket = (data) => llamar(R.publico.POST, '/api/tickets/publico', { method: 'POST', data, rol: null });
  const base = { solicitanteNombre: 'Ana <i>Pérez</i>', solicitanteEmail: 'ana@example.invalid', asunto: 'Monitor <b>sin</b> imagen', descripcion: 'La pantalla quedó en negro <script>x</script>', prioridad: 'alta', rubro: 'biomedico', sucursalId: 901, ubicacionId: 901 };
  es((await st(ticket({ ...base, activoId: 902 }), 400, 'equipo dado de baja')).body.error, 'Ese equipo está dado de baja. Quita la selección y descríbelo en la descripción.', 'texto de baja');
  const creado = await st(ticket({ ...base, activoId: 901 }), 201, 'ticket con equipo');
  es(uno('SELECT activo_id FROM tickets WHERE id = ?', creado.body.ticket.id).activo_id, 901, 'el ticket guarda el equipo');
  const aJefes = cap.correos.find((c) => Array.isArray(c.to) && c.to.includes('jefe@example.invalid'));
  es(!!aJefes, true, 'correo a jefes');
  es(aJefes.html.includes('<td style="padding:4px 0;color:#6B7280">Equipo:</td><td>BIO-901 · Monitor de signos</td>'), true, 'el correo nombra el equipo');
  es(aJefes.html.includes('La pantalla quedó en negro &lt;script&gt;x&lt;/script&gt;'), true, 'descripción escapada');
  es(aJefes.html.includes('Monitor &lt;b&gt;sin&lt;/b&gt; imagen'), true, 'asunto escapado en el cuerpo');
  es(aJefes.html.includes('<script>') || aJefes.html.includes('<b>sin'), false, 'nada del público entra como HTML');
  es(aJefes.subject.endsWith('Monitor <b>sin</b> imagen'), true, 'el asunto del correo no cambia');
  const alSolicitante = cap.correos.find((c) => c.to === 'ana@example.invalid');
  es(alSolicitante.html.includes('Ana &lt;i&gt;Pérez&lt;/i&gt;'), true, 'nombre escapado en la confirmación');
  cap.correos.length = 0;
  await st(ticket({ ...base, descripcion: 'Falla general del área sin equipo', activoId: null }), 201, 'ticket sin equipo');
  es(cap.correos.find((c) => Array.isArray(c.to)).html.includes('>Equipo:<'), false, 'sin equipo no hay fila de equipo');
  await st(ticket({ ...base, activoId: 903 }), 400, 'equipo de otra área con área fija');
} finally {
  await h.close();
}

console.log(`PASS test-bio-incidentes: ${n} casos`);
