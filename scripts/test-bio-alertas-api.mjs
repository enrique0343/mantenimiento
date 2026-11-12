// Fase 59 · WP-E: API de alertas, aprobaciones del plan, rutinas (K-E1) y CSV sobre una
// base con todas las migraciones reales (incluida la 0059) y un R2 de memoria. Roles
// con sesión real. Sin red: la bitácora y las notificaciones las simula el arnés.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const si = (r, nota) => { n++; assert.ok(r, nota); };

const h = await setupConjuntos({ modules: {
  alertas: 'pages/api/alertas/index.ts',
  alerta: 'pages/api/alertas/[id].ts',
  adjuntos: 'pages/api/alertas/[id]/adjuntos.ts',
  adjunto: 'pages/api/alertas/adjunto/[id].ts',
  alertasCsv: 'pages/api/alertas/exportar.ts',
  aprobaciones: 'pages/api/planes/aprobaciones/index.ts',
  aprobacion: 'pages/api/planes/aprobaciones/[id].ts',
  aprobacionArchivo: 'pages/api/planes/aprobaciones/[id]/archivo.ts',
  rutinas: 'pages/api/activos/[id]/planes.ts',
  rutina: 'pages/api/planes/[id].ts',
  rutinasLote: 'pages/api/planes/bulk.ts',
  planCsv: 'pages/api/planes/exportar.ts',
  cumplimientoCsv: 'pages/api/cumplimiento/exportar.ts',
  biomedico: 'lib/biomedico.ts',
  frecuencias: 'lib/frecuencias.ts',
} });
const { app, sqlite } = h;

// R2 de memoria (el del arnés no deja borrar). `conR2Caido` simula R2 caído al subir
// (y calla el console.error que la API deja en el registro).
const r2 = new Map();
let r2Falla = false;
const conR2Caido = async (accion) => {
  const errorOriginal = console.error;
  r2Falla = true; console.error = () => {};
  try { return await accion(); } finally { r2Falla = false; console.error = errorOriginal; }
};
const R2 = {
  async put(clave, valor, opciones) {
    if (r2Falla) throw new Error('R2 no disponible');
    r2.set(clave, { bytes: new Uint8Array(valor), tipo: opciones?.httpMetadata?.contentType });
  },
  async get(clave) { const o = r2.get(clave); return o ? { arrayBuffer: async () => o.bytes.slice().buffer } : null; },
  async delete(clave) { r2.delete(clave); },
};
const ctx = (url, opciones = {}) => {
  const c = h.ctx(url, opciones);
  c.locals.runtime.env.R2 = R2;
  return c;
};
const leer = async (respuesta) => {
  // text() quita el BOM del CSV; se decodifica conservándolo para poder revisarlo.
  const texto = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await respuesta.arrayBuffer());
  let body; try { body = JSON.parse(texto); } catch { body = texto; }
  return { status: respuesta.status, body, headers: respuesta.headers };
};
const llamar = async (ruta, url, opciones) => leer(await ruta(ctx(url, opciones)));
/** POST multipart con la cookie del rol. */
const multipart = async (ruta, url, { id, rol, campos }) => {
  const c = ctx(url, { method: 'POST', id, rol });
  const datos = new FormData();
  for (const [k, v] of Object.entries(campos)) datos.set(k, v);
  c.request = new Request(c.request.url, { method: 'POST', headers: { cookie: c.request.headers.get('cookie') }, body: datos });
  return leer(await ruta(c));
};
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const HTML = new TextEncoder().encode('<html><body>no soy un pdf</body></html>');
const cuenta = (sql) => sqlite.prepare(sql).get().n;

try {
  h.faults.enforceColumnLimit = true;
  const hoy = app.biomedico.hoySV();
  const en = (d) => app.biomedico.sumarDias(hoy, d);
  sqlite.exec("INSERT INTO sucursales (id, nombre) VALUES (1, 'Sede Central'); INSERT INTO ubicaciones (id, sucursal_id, nombre, tipo) VALUES (1, 1, 'UCI', 'area');");
  const equipos = sqlite.prepare("INSERT INTO activos (id, codigo, nombre, rubro, tipo, estado, ubicacion_id) VALUES (?, ?, ?, 'biomedico', 'biomedico', ?, 1)");
  for (let i = 1; i <= 60; i++) equipos.run(i, `BIO-${String(i).padStart(3, '0')}`, `Equipo ${i}`, i === 60 ? 'baja' : 'operativo');
  const ids = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

  // ── Registrar ──────────────────────────────────────────────────────────────
  const nueva = { tipo: 'retiro', fuente: 'fabricante', titulo: 'Retiro de bombas lote 12', fechaAlerta: en(-5), referencia: 'FSN-12', activoIds: [...ids(1, 50), 3] };
  let r = await llamar(app.alertas.POST, '/api/alertas', { method: 'POST', rol: 'tecnico', data: nueva });
  es(r.status, 403, 'el técnico no registra alertas');
  r = await llamar(app.alertas.POST, '/api/alertas', { method: 'POST', rol: 'jefe', data: { ...nueva, titulo: 'ab' } });
  es([r.status, r.body.error], [400, 'Escribe un título (mínimo 3 caracteres).'], 'título corto: texto, no el objeto de zod');
  r = await llamar(app.alertas.POST, '/api/alertas', { method: 'POST', rol: 'jefe', data: { ...nueva, fechaAlerta: en(1) } });
  es([r.status, r.body.error], [400, 'La fecha de emisión no puede ser futura.'], 'emisión futura');
  r = await llamar(app.alertas.POST, '/api/alertas', { method: 'POST', rol: 'jefe', data: { ...nueva, activoIds: [1, 999] } });
  es([r.status, r.body.error], [400, 'Uno de los equipos no existe.'], 'equipo inexistente');
  r = await llamar(app.alertas.POST, '/api/alertas', { method: 'POST', rol: 'jefe', data: nueva });
  es(r.status, 201, 'el jefe registra');
  const id = r.body.alerta.id;
  es([r.body.alerta.aplicabilidad, cuenta(`SELECT count(*) AS n FROM alertas_equipo_activos WHERE alerta_id = ${id}`)], ['pendiente', 50], '50 equipos sin repetir, en tandas');

  r = await llamar(app.alertas.GET, '/api/alertas?activoId=3', { rol: 'visualizador' });
  es(Object.keys(r.body.alertas[0]).sort(), ['aplicabilidad', 'estado', 'fechaAlerta', 'fechaCierre', 'fuente', 'id', 'referencia', 'tipo', 'titulo'], 'K-E2: campos para la ficha');
  r = await llamar(app.alertas.GET, '/api/alertas?activoId=55', { rol: 'tecnico' });
  es(r.body.alertas, [], 'un equipo sin alertas');
  r = await llamar(app.alertas.GET, '/api/alertas?activoId=x', { rol: 'jefe' });
  es(r.status, 400, 'equipo no válido');
  r = await llamar(app.alertas.GET, '/api/alertas', { rol: 'solicitante' });
  es(r.status, 403, 'el solicitante no ve alertas');

  // ── Análisis, cierre y reapertura ─────────────────────────────────────────
  const patch = (data, rol = 'jefe') => llamar(app.alerta.PATCH, `/api/alertas/${id}`, { method: 'PATCH', id, rol, data });
  r = await patch({ aplicabilidad: 'aplica', aplicabilidadAnalisis: 'Lote 12 presente en UCI', activoIds: [] });
  es([r.status, r.body.error], [400, 'Si la alerta aplica, marca al menos un equipo afectado.'], 'aplica sin equipos');
  r = await patch({ aplicabilidad: 'aplica', aplicabilidadAnalisis: 'Lote 12 presente en UCI', aplicabilidadFecha: en(-1), activoIds: ids(1, 47) });
  es([r.status, r.body.alerta.aplicabilidadPor, cuenta(`SELECT count(*) AS n FROM alertas_equipo_activos WHERE alerta_id = ${id}`)], [200, 2, 47], 'análisis y equipos en el mismo lote');
  r = await patch({ estado: 'cerrada', accionTomada: 'Se retiraron las bombas del lote' }, 'tecnico');
  es(r.status, 403, 'el técnico no cierra');
  r = await patch({ estado: 'cerrada', accionTomada: 'Se retiraron las bombas del lote' });
  es([r.status, r.body.alerta.estado, r.body.alerta.fechaCierre, r.body.alerta.cerradaPor], [200, 'cerrada', hoy, 2], 'cierre con la fecha de hoy');
  r = await patch({ estado: 'cerrada', accionTomada: 'Se retiraron las bombas del lote' });
  es([r.status, r.body.error], [409, 'La alerta está cerrada. Para corregirla, reábrela y deja el motivo.'], 'volver a guardar una cerrada');
  r = await multipart(app.adjuntos.POST, `/api/alertas/${id}/adjuntos`, { id, rol: 'tecnico', campos: { categoria: 'evidencia', archivo: new File([PDF], 'evidencia.pdf', { type: 'application/pdf' }) } });
  es([r.status, r.body.error], [409, 'La alerta está cerrada: reábrela para agregar archivos.'], 'sin archivos nuevos en una cerrada');
  r = await llamar(app.alerta.DELETE, `/api/alertas/${id}`, { method: 'DELETE', id, rol: 'admin' });
  es([r.status, r.body.error], [409, 'Una alerta cerrada no se borra: es evidencia.'], 'una cerrada no se borra');
  r = await patch({ estado: 'en_proceso', motivoReapertura: 'El fabricante amplió el lote afectado' });
  es([r.status, r.body.alerta.estado, r.body.alerta.fechaCierre, r.body.alerta.cerradaEn, r.body.alerta.vecesReabierta, r.body.alerta.reabiertaPor], [200, 'en_proceso', null, null, 1, 2], 'reabrir limpia el cierre y deja la constancia');

  // ── Archivos ──────────────────────────────────────────────────────────────
  const subir = (rol, campos) => multipart(app.adjuntos.POST, `/api/alertas/${id}/adjuntos`, { id, rol, campos });
  r = await subir('tecnico', { categoria: 'boletin', archivo: new File([PDF], 'Boletín FSN 12.pdf', { type: 'text/html' }) });
  es([r.status, r.body.adjunto?.contentType], [201, 'application/pdf'], 'el técnico sube; el tipo sale de los bytes');
  const adjuntoId = r.body.adjunto.id;
  const clave = r.body.adjunto.r2Key;
  si(clave.startsWith(`alertas/${id}/`) && clave.endsWith('-Boletin_FSN_12.pdf') && r2.get(clave)?.tipo === 'application/pdf', 'clave de R2 con nombre seguro y tipo detectado');
  r = await subir('tecnico', { categoria: 'boletin', archivo: new File([HTML], 'boletin.pdf', { type: 'application/pdf' }) });
  es(r.status, 415, 'un HTML con nombre .pdf');
  const grande = new Uint8Array(15 * 1024 * 1024 + 1); grande.set(PDF);
  r = await subir('jefe', { categoria: 'boletin', archivo: new File([grande], 'grande.pdf') });
  es(r.status, 413, 'más de 15 MB');
  r = await subir('jefe', { categoria: 'rara', archivo: new File([PDF], 'b.pdf') });
  es([r.status, r.body.error], [400, 'Categoría no válida.'], 'categoría fuera de la lista');
  r = await subir('visualizador', { categoria: 'boletin', archivo: new File([PDF], 'b.pdf') });
  es(r.status, 403, 'el visualizador no sube');
  r = await subir('jefe', { categoria: 'evaluacion', archivo: new File([PNG], 'foto.png') });
  es([r.status, r.body.adjunto?.contentType], [201, 'image/png'], 'una foto también vale');
  // R2 caído: la API responde { error } en texto (antes la excepción salía sin JSON) y no queda fila.
  const adjuntosAntes = cuenta(`SELECT count(*) AS n FROM alerta_adjuntos WHERE alerta_id = ${id}`);
  r = await conR2Caido(() => subir('jefe', { categoria: 'evidencia', archivo: new File([PDF], 'evidencia.pdf') }));
  es([r.status, r.body.error, cuenta(`SELECT count(*) AS n FROM alerta_adjuntos WHERE alerta_id = ${id}`)], [500, 'No se pudo guardar el archivo. Intenta de nuevo.', adjuntosAntes], 'R2 caído al subir un archivo de la alerta');

  r = await llamar(app.adjunto.GET, `/api/alertas/adjunto/${adjuntoId}`, { id: adjuntoId, rol: 'visualizador' });
  es([r.status, r.headers.get('content-type'), r.headers.get('x-content-type-options'), r.headers.get('cache-control')], [200, 'application/pdf', 'nosniff', 'private, max-age=60'], 'descarga del visualizador');
  si(r.headers.get('content-disposition').startsWith('inline; filename="Bolet_n FSN 12.pdf"'), 'nombre de la descarga');
  r = await llamar(app.adjunto.GET, `/api/alertas/adjunto/${adjuntoId}`, { id: adjuntoId, rol: 'motorista' });
  es(r.status, 403, 'el motorista no descarga');
  r = await llamar(app.adjuntos.DELETE, `/api/alertas/${id}/adjuntos?adjuntoId=${adjuntoId}`, { method: 'DELETE', id, rol: 'tecnico' });
  es(r.status, 403, 'el técnico no quita archivos');
  r = await llamar(app.adjuntos.DELETE, `/api/alertas/${id}/adjuntos?adjuntoId=${adjuntoId}`, { method: 'DELETE', id, rol: 'jefe' });
  es([r.status, r2.has(clave), cuenta(`SELECT count(*) AS n FROM alerta_adjuntos WHERE id = ${adjuntoId}`)], [200, false, 0], 'quitar borra la fila y el objeto');

  // ── CSV ───────────────────────────────────────────────────────────────────
  r = await llamar(app.alertasCsv.GET, '/api/alertas/exportar?estado=abiertas', { rol: 'visualizador' });
  const lineas = r.body.split('\r\n');
  si(lineas[0].startsWith('﻿N.º,Tipo,Fuente,Título,Referencia,Fecha de emisión'), 'CSV con BOM y columnas');
  si(!lineas[0].includes('Órdenes'), 'sin columna de órdenes (decisión g.10)');
  si(lineas[1].startsWith(`ALE-${String(id).padStart(4, '0')},Retiro (recall),Fabricante,Retiro de bombas lote 12,FSN-12,${en(-5)},Prueba jefe,`), 'fila con fechas AAAA-MM-DD y quién registró');
  si(r.headers.get('content-disposition').includes(`alertas_${hoy.replace(/-/g, '')}.csv`), 'nombre del archivo con la fecha');
  r = await llamar(app.alertasCsv.GET, '/api/alertas/exportar?estado=cerradas', { rol: 'jefe' });
  es(r.body.split('\r\n').length, 1, 'mismos filtros que la lista');

  // ── Borrar una alerta abierta con archivos ────────────────────────────────
  r = await llamar(app.alerta.DELETE, `/api/alertas/${id}`, { method: 'DELETE', id, rol: 'jefe' });
  es(r.status, 403, 'solo el administrador borra');
  r = await llamar(app.alerta.DELETE, `/api/alertas/${id}`, { method: 'DELETE', id, rol: 'admin' });
  es([r.status, r2.size, cuenta(`SELECT count(*) AS n FROM alertas_equipo_activos WHERE alerta_id = ${id}`), cuenta(`SELECT count(*) AS n FROM alerta_adjuntos WHERE alerta_id = ${id}`)], [200, 0, 0, 0], 'borra filas, equipos y archivos');

  // ── Aprobación del plan ───────────────────────────────────────────────────
  const aprobar = (rol, campos) => multipart(app.aprobaciones.POST, '/api/planes/aprobaciones', { rol, campos });
  const base = { anio: hoy.slice(0, 4), area: 'biomedico', version: '02', aprobadoPor: 'Dra. Ruiz, Directora Médica', fechaAprobacion: en(-2), archivo: new File([PDF], 'plan firmado.pdf') };
  r = await aprobar('tecnico', base);
  es(r.status, 403, 'el técnico no registra aprobaciones');
  r = await aprobar('jefe', base);
  es([r.status, r.body.aprobacion?.contentType, r.body.aprobacion?.area], [201, 'application/pdf', 'biomedico'], 'aprobación con el plan firmado');
  const aprobacionId = r.body.aprobacion.id;
  si(r.body.aprobacion.r2Key.startsWith(`planes/aprobaciones/${hoy.slice(0, 4)}/biomedico/`), 'clave de R2 por año y área');
  r = await aprobar('jefe', base);
  es([r.status, r.body.error], [409, `Ya hay una aprobación vigente de la versión 02 para ${hoy.slice(0, 4)}. Anúlala o registra otra versión.`], 'versión repetida');
  r = await aprobar('jefe', { ...base, version: '03', fechaAprobacion: en(1) });
  es([r.status, r.body.error], [400, 'La fecha de aprobación no puede ser futura.'], 'fecha futura');
  r = await aprobar('jefe', { ...base, version: '03', archivo: new File([HTML], 'plan.pdf') });
  es(r.status, 415, 'el plan firmado tiene que ser PDF o foto');
  r = await conR2Caido(() => aprobar('jefe', { ...base, version: '04' }));
  es([r.status, r.body.error, cuenta("SELECT count(*) AS n FROM plan_aprobaciones WHERE version = '04'")], [500, 'No se pudo guardar el archivo. Intenta de nuevo.', 0], 'R2 caído al subir el plan firmado: { error } y sin registro');
  r = await aprobar('admin', { ...base, area: 'general', version: '01', archivo: new File([PNG], 'plan.png') });
  es([r.status, r.body.aprobacion?.area], [201, 'general'], 'el plan general');
  r = await llamar(app.aprobaciones.GET, `/api/planes/aprobaciones?anio=${hoy.slice(0, 4)}`, { rol: 'visualizador' });
  es(r.body.aprobaciones.map((a) => [a.area, a.registradoPor]), [['general', 'Prueba admin']], 'sin área en la URL = plan general');
  r = await llamar(app.aprobacion.PATCH, `/api/planes/aprobaciones/${aprobacionId}`, { method: 'PATCH', id: aprobacionId, rol: 'jefe', data: { motivo: 'corto' } });
  es(r.status, 400, 'motivo corto');
  r = await llamar(app.aprobacion.PATCH, `/api/planes/aprobaciones/${aprobacionId}`, { method: 'PATCH', id: aprobacionId, rol: 'jefe', data: { motivo: 'Se subió el archivo de otra versión' } });
  es([r.status, r.body.aprobacion.anuladaPor, r.body.aprobacion.motivoAnulacion], [200, 2, 'Se subió el archivo de otra versión'], 'anular con motivo');
  r = await llamar(app.aprobacion.PATCH, `/api/planes/aprobaciones/${aprobacionId}`, { method: 'PATCH', id: aprobacionId, rol: 'jefe', data: { motivo: 'Se subió el archivo de otra versión' } });
  es([r.status, r.body.error], [409, 'Esta aprobación ya está anulada.'], 'no se anula dos veces');
  r = await aprobar('jefe', base);
  es(r.status, 201, 'anulada la anterior, la misma versión se vuelve a registrar');
  r = await llamar(app.aprobacionArchivo.GET, `/api/planes/aprobaciones/${aprobacionId}/archivo`, { id: aprobacionId, rol: 'tecnico' });
  es([r.status, r.headers.get('x-content-type-options')], [200, 'nosniff'], 'el archivo anulado se conserva y se puede ver');
  r = await llamar(app.aprobacionArchivo.GET, `/api/planes/aprobaciones/${aprobacionId}/archivo`, { id: aprobacionId, rol: 'solicitante' });
  es(r.status, 403, 'el solicitante no lo ve');

  // ── Rutinas (K-E1) y bajas ────────────────────────────────────────────────
  const rutina = { titulo: 'Preventivo', frecuencia: 'cuatrimestral', proximaFecha: en(10) };
  r = await llamar(app.rutinas.POST, '/api/activos/1/planes', { method: 'POST', id: 1, rol: 'tecnico', data: { ...rutina, frecuencia: 'turno' } });
  es([r.status, r.body.error], [400, app.frecuencias.MENSAJE_FRECUENCIA_TURNO], '«turno» con su mensaje');
  r = await llamar(app.rutinas.POST, '/api/activos/1/planes', { method: 'POST', id: 1, rol: 'tecnico', data: { ...rutina, frecuencia: 'quinquenal' } });
  es([r.status, r.body.error], [400, 'Elige una frecuencia de la lista.'], 'otra frecuencia');
  r = await llamar(app.rutinas.POST, '/api/activos/1/planes', { method: 'POST', id: 1, rol: 'tecnico', data: rutina });
  es([r.status, r.body.plan?.frecuencia], [201, 'cuatrimestral'], 'cuatrimestral se guarda');
  const planId = r.body.plan.id;
  r = await llamar(app.rutinas.POST, '/api/activos/60/planes', { method: 'POST', id: 60, rol: 'jefe', data: rutina });
  es([r.status, r.body.error], [409, 'El equipo está dado de baja: no se le programan rutinas.'], 'equipo de baja');
  sqlite.exec(`INSERT INTO planes_mantenimiento (id, activo_id, titulo, frecuencia, proxima_fecha, activo) VALUES (900, 60, 'Vieja', 'mensual', '${en(-3)}', 0)`);
  r = await llamar(app.rutina.PATCH, '/api/planes/900', { method: 'PATCH', id: 900, rol: 'jefe', data: { activo: true } });
  es([r.status, r.body.error], [409, 'El equipo está dado de baja: la rutina no se puede activar.'], 'no se activa');
  r = await llamar(app.rutina.PATCH, `/api/planes/${planId}`, { method: 'PATCH', id: planId, rol: 'tecnico', data: { proveedorId: null } });
  es([r.status, r.body.error], [403, 'Solo la jefatura define modalidad, contrato y proveedor.'], 'proveedor solo jefatura');
  r = await llamar(app.rutina.PATCH, '/api/planes/900', { method: 'PATCH', id: 900, rol: 'jefe', data: { titulo: 'Otra' } });
  es(r.status, 409, 'las rutinas de un equipo de baja no se cambian');
  r = await llamar(app.rutina.PATCH, '/api/planes/900', { method: 'PATCH', id: 900, rol: 'jefe', data: { activo: false } });
  es(r.status, 200, 'pero sí se desactivan');

  // Activar en lote: más de 90 rutinas (tandas) y 409 si hay una de un equipo de baja.
  const rutinaLote = sqlite.prepare("INSERT INTO planes_mantenimiento (id, activo_id, titulo, frecuencia, proxima_fecha, activo) VALUES (?, ?, 'Lote', 'mensual', ?, 0)");
  for (let i = 0; i < 95; i++) rutinaLote.run(1000 + i, 1 + (i % 59), en(30));
  const lote = ids(1000, 1094);
  r = await llamar(app.rutinasLote.POST, '/api/planes/bulk', { method: 'POST', rol: 'jefe', data: { accion: 'activar', ids: [...lote, 900] } });
  es([r.status, r.body.error], [409, '1 rutina(s) de la selección son de equipos dados de baja y no se pueden activar. Quítalas de la selección.'], 'activar con una de baja → 409');
  es(cuenta('SELECT count(*) AS n FROM planes_mantenimiento WHERE id >= 1000 AND activo = 1'), 0, 'y no activa ninguna');
  r = await llamar(app.rutinasLote.POST, '/api/planes/bulk', { method: 'POST', rol: 'jefe', data: { accion: 'activar', ids: lote } });
  es([r.status, r.body.afectados, cuenta('SELECT count(*) AS n FROM planes_mantenimiento WHERE id >= 1000 AND activo = 1')], [200, 95, 95], '95 rutinas en tandas de 90');
  r = await llamar(app.rutinasLote.POST, '/api/planes/bulk', { method: 'POST', rol: 'jefe', data: { accion: 'activar', ids: [] } });
  es([r.status, r.body.error], [400, 'Elige al menos una rutina.'], 'selección vacía');

  // ── CSV del plan y de cumplimiento ────────────────────────────────────────
  r = await llamar(app.planCsv.GET, `/api/planes/exportar?anio=${hoy.slice(0, 4)}&area=biomedico`, { rol: 'visualizador' });
  si(r.status === 200 && r.body.startsWith('﻿Tipo,Área,Sede') && r.body.includes(`Veces ${hoy.slice(0, 4)}`), 'CSV del plan');
  si(r.headers.get('content-disposition').includes(`plan_biomedico_${hoy.slice(0, 4)}.csv`), 'nombre del CSV del plan');
  si(!r.body.includes('Vieja'), 'sin rutinas de equipos dados de baja');
  r = await llamar(app.planCsv.GET, '/api/planes/exportar?anio=1999', { rol: 'jefe' });
  es([r.status, r.body.error], [400, 'Año no válido.'], 'año fuera de rango');
  r = await llamar(app.cumplimientoCsv.GET, '/api/cumplimiento/exportar', { rol: 'visualizador' });
  si(r.status === 200 && r.body.startsWith('﻿Indicador,Situación,Código,Equipo / registro,Sede,Ubicación,Detalle,Fecha'), 'CSV de cumplimiento');
  r = await llamar(app.cumplimientoCsv.GET, '/api/cumplimiento/exportar', { rol: 'tecnico' });
  es(r.status, 403, 'cumplimiento: admin, jefe y visualizador');

  es(h.queries.filter((q) => q.columns.length > 100).length, 0, 'ninguna consulta pasa de 100 columnas');
} finally {
  await h.close();
}

console.log(`PASS test-bio-alertas-api: ${n} casos; alertas, archivos en R2, aprobaciones del plan, rutinas y CSV con la migración real.`);
