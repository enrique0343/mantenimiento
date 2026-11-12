// Fase 59 · WP-D: APIs de documentos, «No aplica», licencias y capacitaciones contra las
// migraciones reales (la 0059 incluida), con sesiones por rol y un R2 en memoria.
// Sin red ni base real.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const h = await setupConjuntos({
  modules: {
    docs: 'pages/api/activos/[id]/documentos',
    doc: 'pages/api/activos/documento/[id]',
    exp: 'pages/api/activos/[id]/expediente',
    licencias: 'pages/api/licencias/index',
    licencia: 'pages/api/licencias/[id]/index',
    licArchivos: 'pages/api/licencias/[id]/archivos',
    licArchivo: 'pages/api/licencias/archivo/[id]',
    licCsv: 'pages/api/licencias/exportar',
    caps: 'pages/api/capacitaciones/index',
    cap: 'pages/api/capacitaciones/[id]/index',
    capArchivos: 'pages/api/capacitaciones/[id]/archivos',
    capArchivo: 'pages/api/capacitaciones/archivo/[id]',
    capCsv: 'pages/api/capacitaciones/exportar',
    expCsv: 'pages/api/expedientes/exportar',
    consultas: 'lib/bio-consultas',
    dbmod: 'lib/db',
    bio: 'lib/biomedico',
  },
});

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const A = h.app;
const sq = h.sqlite;

// R2 en memoria: guarda los bytes y el tipo con que se subió.
const objetos = new Map();
const R2 = {
  async put(key, value, opciones) {
    const bytes = new Uint8Array(value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer());
    objetos.set(key, { bytes, contentType: opciones?.httpMetadata?.contentType ?? null });
    return { key };
  },
  async get(key) {
    const o = objetos.get(key);
    return o ? { async arrayBuffer() { return o.bytes.slice().buffer; } } : null;
  },
  async delete(key) { objetos.delete(key); },
};

/** Llama a una ruta con la sesión de `rol`; `form` (FormData) o `json` como cuerpo. */
async function llamar(ruta, url, { method = 'GET', id, rol = 'admin', json, form } = {}) {
  const ctx = h.ctx(url, { method, id, rol, data: json });
  if (form) {
    const cookie = ctx.request.headers.get('cookie');
    ctx.request = new Request(ctx.url, { method, headers: cookie ? { cookie } : {}, body: form });
  }
  ctx.locals.runtime.env.R2 = R2;
  return ruta(ctx);
}
const cuerpo = async (res) => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };
const status = async (p) => (await p).status;

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const HTML = new TextEncoder().encode('<html><body><script>alert(1)</script></body></html>');
const formArchivo = (bytes, nombre, tipo, campos = {}) => {
  const f = new FormData();
  f.append('file', new File([bytes], nombre, { type: tipo }));
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
};

h.faults.enforceColumnLimit = true;
try {
  // ── Datos: una sede, una ubicación, dos biomédicos, uno general y 60 biomédicos más ──
  sq.exec("INSERT INTO sucursales (id, nombre) VALUES (1, 'Central')");
  sq.exec("INSERT INTO ubicaciones (id, sucursal_id, nombre, tipo) VALUES (10, 1, 'UCI adultos', 'area')");
  sq.exec("INSERT INTO activos (id, codigo, nombre, tipo, rubro, ubicacion_id, aceptacion_fecha) VALUES (100, 'BIO-100', 'MONITOR DE SIGNOS', 'biomedico', 'biomedico', 10, NULL)");
  sq.exec("INSERT INTO activos (id, codigo, nombre, tipo, rubro) VALUES (101, 'BIO-101', 'VENTILADOR', 'biomedico', 'biomedico')");
  sq.exec("INSERT INTO activos (id, codigo, nombre, tipo, rubro) VALUES (200, 'EQ-200', 'BOMBA DE AGUA', 'general', 'equipo_general')");
  for (let i = 0; i < 60; i++) sq.prepare("INSERT INTO activos (id, codigo, nombre, tipo, rubro, marca, modelo) VALUES (?, ?, 'BOMBA DE INFUSION', 'biomedico', 'biomedico', 'B. Braun', 'Infusomat')").run(300 + i, `BIO-${300 + i}`);

  // ── Documentos ────────────────────────────────────────────────────────────
  let res = await llamar(A.docs.POST, '/api/activos/100/documentos', { method: 'POST', id: 100, rol: 'tecnico', form: formArchivo(PDF, 'Manual de operación (v2).pdf', 'text/html', { categoria: 'manual_operacion', version: '2', fechaDocumento: '2025-01-10' }) });
  es(res.status, 201, 'el técnico sube un PDF aunque el navegador diga text/html');
  const subido = (await cuerpo(res)).documento;
  const filaDoc = sq.prepare('SELECT content_type, categoria, version, fecha_version, r2_key, nombre FROM activo_documentos WHERE id = ?').get(subido.id);
  es([filaDoc.content_type, filaDoc.categoria, filaDoc.version, filaDoc.fecha_version, filaDoc.nombre], ['application/pdf', 'manual_operacion', '2', '2025-01-10', 'Manual de operación (v2).pdf'], 'se guarda el tipo detectado y los datos');
  es(objetos.get(filaDoc.r2_key)?.contentType, 'application/pdf', 'R2 recibe el tipo detectado');
  es(/^activos\/100\/docs\/\d+-[0-9a-f-]{36}-Manual_de_operacion_v2_\.pdf$/.test(filaDoc.r2_key), true, 'clave de R2 con nombre seguro');

  res = await llamar(A.docs.POST, '/api/activos/100/documentos', { method: 'POST', id: 100, rol: 'tecnico', form: formArchivo(HTML, 'manual.pdf', 'application/pdf', { categoria: 'manual_operacion' }) });
  es([res.status, (await cuerpo(res)).error], [415, 'Solo se aceptan archivos PDF o fotos (JPG, PNG o WEBP).'], 'un HTML con nombre .pdf no entra');
  const grande = new Uint8Array(15 * 1024 * 1024 + 1); grande.set(PDF);
  res = await llamar(A.docs.POST, '/api/activos/100/documentos', { method: 'POST', id: 100, rol: 'jefe', form: formArchivo(grande, 'grande.pdf', 'application/pdf', { categoria: 'otro' }) });
  es([res.status, (await cuerpo(res)).error], [413, 'El archivo pesa más de 15 MB. Comprímelo o divídelo en partes.'], '15 MB + 1 byte');
  es(await status(llamar(A.docs.POST, '/api/activos/100/documentos', { method: 'POST', id: 100, rol: 'visualizador', form: formArchivo(PDF, 'a.pdf', 'application/pdf', { categoria: 'otro' }) })), 403, 'el visualizador no sube');
  res = await llamar(A.docs.POST, '/api/activos/100/documentos', { method: 'POST', id: 100, rol: 'tecnico', form: formArchivo(PDF, 'a.pdf', 'application/pdf', { categoria: 'planos' }) });
  es([res.status, (await cuerpo(res)).error], [400, 'Categoría no válida.'], 'categoría desconocida');
  res = await llamar(A.docs.POST, '/api/activos/100/documentos', { method: 'POST', id: 100, rol: 'tecnico', form: formArchivo(PDF, 'a.pdf', 'application/pdf', {}) });
  es([res.status, (await cuerpo(res)).error], [400, 'Elige la categoría del documento.'], 'sin categoría');
  es(await status(llamar(A.docs.POST, '/api/activos/999/documentos', { method: 'POST', id: 999, rol: 'tecnico', form: formArchivo(PDF, 'a.pdf', 'application/pdf', { categoria: 'otro' }) })), 404, 'equipo inexistente');
  es(sq.prepare('SELECT COUNT(*) AS n FROM activo_documentos').get().n, 1, 'solo quedó el PDF bueno');
  es(objetos.size, 1, 'y un solo objeto en R2');

  // Descarga: motorista no; visualizador sí, en línea y con nosniff.
  es(await status(llamar(A.doc.GET, `/api/activos/documento/${subido.id}`, { id: subido.id, rol: 'motorista' })), 403, 'el motorista no descarga');
  es(await status(llamar(A.doc.GET, `/api/activos/documento/${subido.id}`, { id: subido.id, rol: 'solicitante' })), 403, 'el solicitante no descarga');
  res = await llamar(A.doc.GET, `/api/activos/documento/${subido.id}`, { id: subido.id, rol: 'visualizador' });
  es([res.status, res.headers.get('content-type'), res.headers.get('x-content-type-options'), res.headers.get('content-disposition').startsWith('inline;')],
    [200, 'application/pdf', 'nosniff', true], 'el visualizador descarga en línea con nosniff');
  es(new Uint8Array(await res.arrayBuffer()), PDF, 'los mismos bytes');
  // Un documento viejo guardado como HTML sale como descarga.
  objetos.set('activos/100/docs/viejo.html', { bytes: HTML, contentType: 'text/html' });
  const viejo = sq.prepare("INSERT INTO activo_documentos (activo_id, nombre, content_type, tamano, r2_key, categoria, usuario_id) VALUES (100, 'viejo.html', 'text/html', 10, 'activos/100/docs/viejo.html', 'manual', 1) RETURNING id").get().id;
  res = await llamar(A.doc.GET, `/api/activos/documento/${viejo}`, { id: viejo, rol: 'tecnico' });
  es([res.headers.get('content-type'), res.headers.get('content-disposition').startsWith('attachment;'), res.headers.get('x-content-type-options')],
    ['application/octet-stream', true, 'nosniff'], 'tipo viejo no permitido: descarga, nunca en línea');

  // Corregir datos.
  res = await llamar(A.doc.PATCH, `/api/activos/documento/${viejo}`, { method: 'PATCH', id: viejo, rol: 'tecnico', json: { categoria: 'planos' } });
  es([res.status, (await cuerpo(res)).error], [400, 'Categoría no válida.'], 'PATCH a una categoría no válida');
  res = await llamar(A.doc.PATCH, `/api/activos/documento/${viejo}`, { method: 'PATCH', id: viejo, rol: 'tecnico', json: { categoria: 'manual_servicio', fechaVencimiento: '2030-01-01' } });
  es([res.status, { ...sq.prepare('SELECT categoria, fecha_vencimiento FROM activo_documentos WHERE id = ?').get(viejo) }], [200, { categoria: 'manual_servicio', fecha_vencimiento: '2030-01-01' }], 'reclasificar un manual');
  es(await status(llamar(A.doc.PATCH, `/api/activos/documento/${viejo}`, { method: 'PATCH', id: viejo, rol: 'visualizador', json: { nota: 'x' } })), 403, 'el visualizador no corrige');
  es(await status(llamar(A.doc.PATCH, '/api/activos/documento/9999', { method: 'PATCH', id: 9999, rol: 'jefe', json: { nota: 'x' } })), 404, 'documento inexistente');

  // Borrar: solo de su equipo y solo admin o jefe.
  es(await status(llamar(A.docs.DELETE, `/api/activos/101/documentos?documentoId=${subido.id}`, { method: 'DELETE', id: 101, rol: 'jefe' })), 404, 'DELETE con otro equipo');
  es(await status(llamar(A.docs.DELETE, `/api/activos/100/documentos?documentoId=${subido.id}`, { method: 'DELETE', id: 100, rol: 'tecnico' })), 403, 'el técnico no borra');
  es(await status(llamar(A.docs.DELETE, `/api/activos/100/documentos?documentoId=${viejo}`, { method: 'DELETE', id: 100, rol: 'jefe' })), 200, 'el jefe borra');
  es([sq.prepare('SELECT COUNT(*) AS n FROM activo_documentos WHERE id = ?').get(viejo).n, objetos.has('activos/100/docs/viejo.html')], [0, false], 'se va la fila y el objeto de R2');

  // ── «No aplica» del expediente ────────────────────────────────────────────
  const naUrl = '/api/activos/100/expediente';
  es(await status(llamar(A.exp.POST, naUrl, { method: 'POST', id: 100, rol: 'tecnico', json: { requisito: 'registro_sanitario', motivo: 'No lo exige la norma' } })), 403, 'el técnico no marca «No aplica»');
  res = await llamar(A.exp.POST, naUrl, { method: 'POST', id: 100, rol: 'jefe', json: { requisito: 'registro_sanitario', motivo: 'corto' } });
  es(res.status, 201, 'el jefe marca «No aplica»');
  res = await llamar(A.exp.POST, naUrl, { method: 'POST', id: 100, rol: 'jefe', json: { requisito: 'registro_sanitario', motivo: 'Equipo de uso no clínico' } });
  es(res.status, 201, 'marcar otra vez reemplaza el motivo');
  es(await cuerpo(await llamar(A.exp.POST, naUrl, { method: 'POST', id: 100, rol: 'jefe', json: { requisito: 'registro_sanitario', motivo: 'abc' } })), { error: 'Escribe el motivo (al menos 5 letras).' }, 'motivo corto');
  es(await cuerpo(await llamar(A.exp.POST, naUrl, { method: 'POST', id: 100, rol: 'jefe', json: { requisito: 'planos', motivo: 'No aplica aquí' } })), { error: 'Requisito no válido.' }, 'requisito desconocido');
  es(await cuerpo(await llamar(A.exp.POST, '/api/activos/200/expediente', { method: 'POST', id: 200, rol: 'jefe', json: { requisito: 'registro_sanitario', motivo: 'No aplica aquí' } })), { error: 'Solo aplica a equipos biomédicos.' }, 'equipo no biomédico');
  const db = A.dbmod.getDb(h.ctx('/x'));
  const hoy = A.bio.hoySV();
  let expediente = await A.consultas.expedienteDeActivo(db, 100, hoy);
  const reqRegistro = expediente.completitud.requisitos.find((r) => r.clave === 'registro_sanitario');
  es([reqRegistro.estado, reqRegistro.motivoNoAplica, expediente.completitud.cumplidos], ['no_aplica', 'Equipo de uso no clínico', 2], 'expedienteDeActivo refleja el «No aplica» (y el manual de operación)');
  es(expediente.noAplica.map((x) => [x.requisito, x.usuario]), [['registro_sanitario', 'Prueba jefe']], 'quién lo marcó');
  es(await status(llamar(A.exp.DELETE, `${naUrl}?requisito=registro_sanitario`, { method: 'DELETE', id: 100, rol: 'jefe' })), 200, 'quitar «No aplica»');
  es(await status(llamar(A.exp.DELETE, `${naUrl}?requisito=registro_sanitario`, { method: 'DELETE', id: 100, rol: 'jefe' })), 404, 'quitarlo otra vez');
  expediente = await A.consultas.expedienteDeActivo(db, 100, hoy);
  es(expediente.completitud.requisitos.find((r) => r.clave === 'registro_sanitario').estado, 'falta', 'vuelve a faltar');
  es(await A.consultas.expedienteDeActivo(db, 9999, hoy), null, 'equipo inexistente');
  const filasExp = await A.consultas.expedientesBiomedicos(db, { hoy });
  es([filasExp.length, filasExp.find((f) => f.activoId === 100).documentos], [62, 1], 'expedientesBiomedicos: 62 biomédicos, el 100 con un documento');

  // ── Licencias ─────────────────────────────────────────────────────────────
  const licencia = (extra) => ({
    entidad: 'srs', tipo: 'funcionamiento', nombre: 'Licencia de funcionamiento', numero: 'SRS-1', ambito: 'establecimiento',
    sucursalId: 1, fechaEmision: '2025-01-01', fechaVencimiento: '2027-01-01', estado: 'activa', ...extra,
  });
  es(await status(llamar(A.licencias.POST, '/api/licencias', { method: 'POST', rol: 'tecnico', json: licencia() })), 403, 'el técnico no registra licencias');
  res = await llamar(A.licencias.POST, '/api/licencias', { method: 'POST', rol: 'jefe', json: licencia({ numero: '' }) });
  es([res.status, (await cuerpo(res)).error], [400, 'Escribe el número de la licencia o márcala «En trámite».'], 'activa sin número');
  res = await llamar(A.licencias.POST, '/api/licencias', { method: 'POST', rol: 'jefe', json: licencia({ ambito: 'equipo', activoId: 100, sucursalId: null, nombre: 'Licencia del monitor' }) });
  const l1 = (await cuerpo(res)).licencia;
  es([res.status, l1.activoId, l1.sucursalId], [201, 100, 1], 'ámbito equipo: la sede sale de la ubicación del equipo');
  // Renovación que nace activa: la anterior queda reemplazada.
  res = await llamar(A.licencias.POST, '/api/licencias', { method: 'POST', rol: 'jefe', json: licencia({ ambito: 'equipo', activoId: 100, numero: 'SRS-2', fechaEmision: '2026-11-01', fechaVencimiento: '2028-11-01', reemplazaAId: l1.id }) });
  const r1 = (await cuerpo(res)).licencia;
  es([res.status, r1.reemplazaAId, sq.prepare('SELECT estado FROM licencias WHERE id = ?').get(l1.id).estado], [201, l1.id, 'reemplazada'], 'renovación activa: la anterior queda reemplazada');
  res = await llamar(A.licencias.POST, '/api/licencias', { method: 'POST', rol: 'jefe', json: licencia({ reemplazaAId: l1.id, estado: 'en_tramite', numero: '' }) });
  es([res.status, (await cuerpo(res)).error], [409, 'Esa licencia ya fue reemplazada o anulada.'], 'una segunda renovación: 409');
  es(await status(llamar(A.licencias.POST, '/api/licencias', { method: 'POST', rol: 'jefe', json: licencia({ reemplazaAId: 9999 }) })), 404, 'renovar una que no existe');
  // Renovación en trámite que después pasa a activa.
  const l2 = (await cuerpo(await llamar(A.licencias.POST, '/api/licencias', { method: 'POST', rol: 'admin', json: licencia({ numero: 'L2' }) }))).licencia;
  res = await llamar(A.licencias.POST, '/api/licencias', { method: 'POST', rol: 'jefe', json: licencia({ reemplazaAId: l2.id, estado: 'en_tramite', numero: '', fechaVencimiento: '' }) });
  const r2 = (await cuerpo(res)).licencia;
  es([res.status, r2.estado, sq.prepare('SELECT estado FROM licencias WHERE id = ?').get(l2.id).estado], [201, 'en_tramite', 'activa'], 'renovación en trámite: la anterior sigue activa');
  res = await llamar(A.licencias.POST, '/api/licencias', { method: 'POST', rol: 'jefe', json: licencia({ reemplazaAId: l2.id, estado: 'en_tramite', numero: '' }) });
  es([res.status, (await cuerpo(res)).error], [409, 'Ya hay una renovación en trámite: ábrela y complétala.'], 'otra renovación mientras hay una en trámite');
  res = await llamar(A.licencia.PATCH, `/api/licencias/${r2.id}`, { method: 'PATCH', id: r2.id, rol: 'jefe', json: licencia({ numero: 'L2-B', fechaEmision: '2026-11-10', fechaVencimiento: '2028-11-10' }) });
  es([res.status, (await cuerpo(res)).licencia.estado, sq.prepare('SELECT estado FROM licencias WHERE id = ?').get(l2.id).estado], [200, 'activa', 'reemplazada'], 'la renovación pasa a activa y reemplaza a la anterior');
  res = await llamar(A.licencia.PATCH, `/api/licencias/${r2.id}`, { method: 'PATCH', id: r2.id, rol: 'jefe', json: licencia({ estado: 'en_tramite' }) });
  es([res.status, (await cuerpo(res)).error], [400, 'Una licencia activa no vuelve a «En trámite»: registra una renovación.'], 'activa no vuelve a trámite');
  res = await llamar(A.licencia.PATCH, `/api/licencias/${r2.id}`, { method: 'PATCH', id: r2.id, rol: 'jefe', json: { accion: 'anular', motivo: 'Revocada por la entidad' } });
  es([res.status, (await cuerpo(res)).licencia.estado], [200, 'anulada'], 'anular con motivo');
  res = await llamar(A.licencia.PATCH, `/api/licencias/${r2.id}`, { method: 'PATCH', id: r2.id, rol: 'jefe', json: licencia() });
  es([res.status, (await cuerpo(res)).error], [409, 'Esta licencia ya no se puede editar.'], 'una anulada no se edita');
  // Archivos de licencia.
  res = await llamar(A.licArchivos.POST, `/api/licencias/${r1.id}/archivos`, { method: 'POST', id: r1.id, rol: 'jefe', form: formArchivo(PDF, 'licencia.pdf', 'application/pdf', { categoria: 'licencia' }) });
  const archivoLic = (await cuerpo(res)).archivo;
  es([res.status, archivoLic.contentType], [201, 'application/pdf'], 'archivo de licencia');
  es(await status(llamar(A.licArchivos.POST, `/api/licencias/${r1.id}/archivos`, { method: 'POST', id: r1.id, rol: 'tecnico', form: formArchivo(PDF, 'l.pdf', 'application/pdf') })), 403, 'el técnico no sube archivos de licencia');
  es(await status(llamar(A.licArchivo.GET, `/api/licencias/archivo/${archivoLic.id}`, { id: archivoLic.id, rol: 'tecnico' })), 200, 'el técnico descarga');
  es(await status(llamar(A.licArchivo.GET, `/api/licencias/archivo/${archivoLic.id}`, { id: archivoLic.id, rol: 'motorista' })), 403, 'el motorista no');
  // Eliminar: solo admin; la anterior vuelve a activa.
  es(await status(llamar(A.licencia.DELETE, `/api/licencias/${r1.id}`, { method: 'DELETE', id: r1.id, rol: 'jefe' })), 403, 'el jefe no elimina licencias');
  const claveLic = sq.prepare('SELECT r2_key FROM licencia_archivos WHERE id = ?').get(archivoLic.id).r2_key;
  es(await status(llamar(A.licencia.DELETE, `/api/licencias/${r1.id}`, { method: 'DELETE', id: r1.id, rol: 'admin' })), 200, 'el admin elimina');
  es([sq.prepare('SELECT estado FROM licencias WHERE id = ?').get(l1.id).estado, objetos.has(claveLic), sq.prepare('SELECT COUNT(*) AS n FROM licencia_archivos').get().n],
    ['activa', false, 0], 'la renovada vuelve a activa; se van sus archivos');
  const listaLic = await A.consultas.listarLicencias(db);
  es(listaLic.map((l) => [l.id, l.estado, l.archivos, l.equipoCodigo ?? null]).sort((a, b) => a[0] - b[0]),
    [[l1.id, 'activa', 0, 'BIO-100'], [l2.id, 'reemplazada', 0, null], [r2.id, 'anulada', 0, null]], 'listarLicencias');

  // ── Capacitaciones: 40 asistentes y 60 equipos en tandas ──────────────────
  const asistentes = (k) => Array.from({ length: k }, (_, i) => `Persona ${i + 1}; Enfermera; UCI`).join('\n');
  const capacitacion = (extra) => ({
    fecha: '2026-11-10', tema: 'Uso seguro de bombas de infusión', tipo: 'uso_seguro', instructorTipo: 'interno', instructorNombre: 'Ing. Carlos Ruiz',
    equipoIds: Array.from({ length: 60 }, (_, i) => 300 + i), asistentesTexto: asistentes(40), ...extra,
  });
  es(await status(llamar(A.caps.POST, '/api/capacitaciones', { method: 'POST', rol: 'visualizador', json: capacitacion() })), 403, 'el visualizador no registra');
  res = await llamar(A.caps.POST, '/api/capacitaciones', { method: 'POST', rol: 'tecnico', json: capacitacion({ equipoIds: [300, 200] }) });
  es([res.status, (await cuerpo(res)).error], [400, 'Uno de los equipos ya no existe. Recarga la página.'], 'un equipo no biomédico');
  res = await llamar(A.caps.POST, '/api/capacitaciones', { method: 'POST', rol: 'tecnico', json: capacitacion({ asistentesTexto: 'Ana Pérez\nAl' }) });
  es([res.status, await cuerpo(res)], [400, { error: 'Revisa la lista de asistentes.', errores: ['Línea 2: falta el nombre.'] }], 'asistentes con errores');
  const antes = h.queries.length;
  res = await llamar(A.caps.POST, '/api/capacitaciones', { method: 'POST', rol: 'tecnico', json: capacitacion() });
  const capId = (await cuerpo(res)).capacitacion.id;
  const insertsAsis = h.queries.slice(antes).filter((q) => /insert into "capacitacion_asistentes"/i.test(q.sql));
  const insertsEq = h.queries.slice(antes).filter((q) => /insert into "capacitacion_equipos"/i.test(q.sql));
  es([res.status, insertsAsis.length, insertsEq.length], [201, 3, 2], 'el técnico registra: asistentes en 3 tandas y equipos en 2');
  es(Math.max(...h.queries.slice(antes).map((q) => (q.sql.match(/\?/g) ?? []).length)) <= 100, true, 'ninguna sentencia pasa de 100 parámetros');
  es([sq.prepare('SELECT COUNT(*) AS n FROM capacitacion_asistentes WHERE capacitacion_id = ?').get(capId).n, sq.prepare('SELECT COUNT(*) AS n FROM capacitacion_equipos WHERE capacitacion_id = ?').get(capId).n],
    [40, 60], 'filas completas');
  es({ ...sq.prepare('SELECT orden, nombre, cargo, servicio FROM capacitacion_asistentes WHERE capacitacion_id = ? ORDER BY orden DESC LIMIT 1').get(capId) },
    { orden: 40, nombre: 'Persona 40', cargo: 'Enfermera', servicio: 'UCI' }, 'el orden se conserva');
  res = await llamar(A.cap.PATCH, `/api/capacitaciones/${capId}`, { method: 'PATCH', id: capId, rol: 'tecnico', json: capacitacion({ asistentesTexto: asistentes(25), equipoIds: [300, 301, 100] }) });
  es([res.status, sq.prepare('SELECT COUNT(*) AS n FROM capacitacion_asistentes WHERE capacitacion_id = ?').get(capId).n, sq.prepare('SELECT COUNT(*) AS n FROM capacitacion_equipos WHERE capacitacion_id = ?').get(capId).n],
    [200, 25, 3], 'PATCH reemplaza asistentes y equipos');
  const resumen = await A.consultas.capacitacionesDeActivo(db, 100, hoy);
  es([resumen.total, resumen.ultima, resumen.asistentes, resumen.filas[0].asistentes, resumen.filas[0].listasFirmadas], [1, '2026-11-10', 25, 25, 0], 'capacitacionesDeActivo');
  res = await llamar(A.capArchivos.POST, `/api/capacitaciones/${capId}/archivos`, { method: 'POST', id: capId, rol: 'tecnico', form: formArchivo(PDF, 'lista.pdf', 'application/pdf') });
  const archivoCap = (await cuerpo(res)).archivo;
  es([res.status, archivoCap.categoria], [201, 'lista_firmada'], 'el técnico sube la lista firmada');
  es((await A.consultas.capacitacionesDeActivo(db, 100, hoy)).filas[0].listasFirmadas, 1, 'cuenta la lista firmada');
  es(await status(llamar(A.capArchivo.GET, `/api/capacitaciones/archivo/${archivoCap.id}`, { id: archivoCap.id, rol: 'visualizador' })), 200, 'el visualizador descarga la lista');
  es(await status(llamar(A.capArchivos.DELETE, `/api/capacitaciones/${capId}/archivos?archivoId=${archivoCap.id}`, { method: 'DELETE', id: capId, rol: 'tecnico' })), 403, 'el técnico no borra archivos');
  const detalle = await A.consultas.capacitacionConDetalle(db, capId);
  es([detalle.equipos.length, detalle.asistentes.length, detalle.archivos.length, detalle.capacitacion.registradoPor], [3, 25, 1, 'Prueba tecnico'], 'capacitacionConDetalle');
  const listaCap = await A.consultas.listarCapacitaciones(db, { desde: '2026-01-01', hasta: null, activo: 300 });
  es([listaCap.length, listaCap[0].asistentes.length, listaCap[0].equipos.length, listaCap[0].listasFirmadas], [1, 25, 3, 1], 'listarCapacitaciones por equipo');
  es((await A.consultas.listarCapacitaciones(db, { desde: '2026-01-01', hasta: null, activo: 359 })).length, 0, 'el equipo que salió ya no la ve');

  // ── CSV con BOM ───────────────────────────────────────────────────────────
  const csv = async (ruta, url) => {
    const r = await llamar(ruta, url, { rol: 'visualizador' });
    // text() quitaría el BOM: se leen los bytes y se decodifica sin quitarlo.
    const texto = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer());
    return { status: r.status, disp: r.headers.get('content-disposition'), texto };
  };
  const sufijo = hoy.replaceAll('-', '');
  for (const [ruta, url, archivo, encabezado] of [
    [A.expCsv.GET, '/api/expedientes/exportar', `expedientes_${sufijo}.csv`, 'Código,Equipo,Marca'],
    [A.expCsv.GET, '/api/expedientes/exportar?detalle=documentos', `expedientes_documentos_${sufijo}.csv`, 'Código,Equipo,Categoría,Archivo'],
    [A.licCsv.GET, '/api/licencias/exportar?situacion=todas', `licencias_${sufijo}.csv`, 'Código,Entidad,Tipo,Licencia'],
    [A.capCsv.GET, '/api/capacitaciones/exportar?desde=2026-01-01', `capacitaciones_${sufijo}.csv`, 'Código,Fecha,Tema'],
    [A.capCsv.GET, '/api/capacitaciones/exportar?desde=2026-01-01&detalle=asistentes', `capacitaciones_asistentes_${sufijo}.csv`, 'Código,Fecha,Tema,Equipos,Nombre'],
  ]) {
    const r = await csv(ruta, url);
    es([r.status, r.texto.startsWith('\uFEFF' + encabezado), r.disp], [200, true, `attachment; filename="${archivo}"`], `CSV ${archivo}`);
  }
  const csvCap = await csv(A.capCsv.GET, '/api/capacitaciones/exportar?desde=2026-01-01&detalle=asistentes');
  es(csvCap.texto.split('\r\n').length, 26, 'una fila por asistente');
  es((await csv(A.licCsv.GET, '/api/licencias/exportar?situacion=todas')).texto.includes(',2027-01-01,'), true, 'fechas AAAA-MM-DD en el CSV');
  es(await status(llamar(A.licCsv.GET, '/api/licencias/exportar', { rol: 'motorista' })), 403, 'el motorista no descarga el CSV');

  // Eliminar la capacitación: los hijos caen en cascada y el archivo sale de R2.
  const claveCap = sq.prepare('SELECT r2_key FROM capacitacion_archivos WHERE id = ?').get(archivoCap.id).r2_key;
  es(await status(llamar(A.cap.DELETE, `/api/capacitaciones/${capId}`, { method: 'DELETE', id: capId, rol: 'tecnico' })), 403, 'el técnico no elimina capacitaciones');
  es(await status(llamar(A.cap.DELETE, `/api/capacitaciones/${capId}`, { method: 'DELETE', id: capId, rol: 'jefe' })), 200, 'el jefe elimina');
  es([sq.prepare('SELECT COUNT(*) AS n FROM capacitacion_asistentes').get().n, sq.prepare('SELECT COUNT(*) AS n FROM capacitacion_equipos').get().n, objetos.has(claveCap)],
    [0, 0, false], 'sin hijos ni archivo');
} finally {
  await h.close();
}

console.log(`PASS test-bio-documentos-api: ${n} casos; tipo por contenido, roles, «No aplica», renovaciones, tandas de capacitación y CSV con BOM.`);
