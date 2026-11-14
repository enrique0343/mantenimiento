// Fase 59 · WP-G: protocolos institucionales y PDF aprobado de la biblioteca.
// Reglas puras de src/lib/protocolos.ts y rutas reales (alta del protocolo, PATCH
// sin r2Key, subir, ver, reemplazar y quitar el PDF) sobre SQLite con todas las
// migraciones y un R2 en memoria. Sin red; la bitácora se captura.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({ entryPoints: ['src/lib/protocolos.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
const P = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const bytes = (...partes) => new Uint8Array(partes.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)));
const PDF = bytes('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

// ── Tipos de la biblioteca ──────────────────────────────────────────────────
es(P.infoTipoBiblioteca('sop').label, 'SOP', 'SOP conocido');
es(P.infoTipoBiblioteca('protocolo').nombre, 'Protocolo institucional', 'protocolo');
es(P.infoTipoBiblioteca('protocolo').color, 'bg-brand-50 text-brand-700', 'color del protocolo');
es(P.infoTipoBiblioteca('xyz').label, 'XYZ', 'desconocido: la sigla en mayúsculas');
es(P.infoTipoBiblioteca('xyz').nombre, 'Documento', 'desconocido: nombre genérico');
es(P.infoTipoBiblioteca(null).label, '—', 'null');
es(P.infoTipoBiblioteca('constructor').label, 'CONSTRUCTOR', 'no toma propiedades del prototipo');
es(P.esTipoBiblioteca('protocolo'), true, 'protocolo es de la biblioteca');
es(P.esTipoBiblioteca('pin'), false, 'pin no');
es([...P.TIPOS_BIBLIOTECA], ['scp', 'sop', 'mop', 'eop', 'aop', 'protocolo'], 'seis tipos');
es(P.sugerenciaProtocolo(' prt-lyd-01 ').areas.length, 4, 'PRT-LYD-01 con cuatro áreas');
es(P.sugerenciaProtocolo('PRT-INC-01').areas, ['Calidad', 'Mantenimiento Biomédico', 'Enfermería'], 'áreas de incidentes');
es(P.sugerenciaProtocolo('PRT-BAJ-01').titulo, 'Baja y disposición final de equipo médico', 'título de bajas');
es(P.sugerenciaProtocolo('SCP-ELE-01'), null, 'un código del volumen no es protocolo');
es(P.sugerenciaProtocolo(''), null, 'vacío');

// ── avisosPdf ───────────────────────────────────────────────────────────────
const doc = { tipo: 'protocolo', estado: 'vigente', activo: true, version: '1.0', r2Key: null, pdfVersion: null };
es(P.avisosPdf({ ...doc, estado: 'retirado' }), ['Documento retirado: no usar.'], 'retirado');
es(P.avisosPdf({ ...doc, activo: false, r2Key: 'k', pdfVersion: '1.0' }), ['Documento retirado: no usar.'], 'inactivo');
es(P.avisosPdf(doc), ['Este protocolo está vigente y todavía no tiene su PDF aprobado.'], 'protocolo vigente sin PDF');
es(P.avisosPdf({ ...doc, tipo: 'sop' }), [], 'SOP vigente sin PDF');
es(P.avisosPdf({ ...doc, estado: 'borrador' }), [], 'protocolo en borrador sin PDF');
es(P.avisosPdf({ ...doc, version: '1.1', r2Key: 'k', pdfVersion: '1.0' }),
  ['El PDF es de la versión 1.0 y el documento está en la versión 1.1. Sube el PDF de la versión actual.'], 'PDF de otra versión');
es(P.avisosPdf({ ...doc, estado: 'en_validacion', r2Key: 'k', pdfVersion: '1.0' }),
  ['El documento todavía no está vigente: este PDF no es una versión aprobada.'], 'PDF de un documento en validación');
es(P.avisosPdf({ ...doc, r2Key: 'k', pdfVersion: '1.0' }), [], 'vigente con su PDF');
es(P.avisosPdf({ ...doc, estado: 'en_revision', r2Key: 'k', pdfVersion: '1.0' }), [], 'en revisión sigue en vigor');
es(P.avisosPdf({ ...doc, estado: 'borrador', version: '0.2', r2Key: 'k', pdfVersion: '0.1' }).length, 2, 'otra versión y sin vigencia');
es(P.avisosPdf({ ...doc, r2Key: 'k', pdfVersion: null }),
  ['No consta de qué versión es el PDF y el documento está en la versión 1.0. Sube el PDF de la versión actual.'], 'PDF cargado sin datos');

// ── tamanoLegible, validarPdf y nombreDescargaPdf ───────────────────────────
es([0, 100, 512000, 1536000, 15728640].map(P.tamanoLegible), ['0 KB', '1 KB', '500 KB', '1,5 MB', '15,0 MB'], 'tamaños');
es([null, undefined, Number.NaN, -1].map(P.tamanoLegible), ['—', '—', '—', '—'], 'sin tamaño');
es(P.validarPdf(0, PDF), { ok: false, status: 400, error: 'El archivo está vacío.' }, 'vacío');
es(P.validarPdf(15728641, PDF), { ok: false, status: 413, error: 'El PDF pasa de 15 MB. Redúcelo e inténtalo de nuevo.' }, 'más de 15 MB');
es(P.validarPdf(15728640, PDF), { ok: true }, 'justo 15 MB');
es(P.validarPdf(1000, PNG), { ok: false, status: 415, error: 'El archivo no es un PDF.' }, 'PNG renombrado');
es(P.validarPdf(1000, bytes('%PD')), { ok: false, status: 415, error: 'El archivo no es un PDF.' }, 'firma incompleta');
es(P.validarPdf(1000, bytes('%PDF-1.4')), { ok: true }, 'PDF');
es(P.nombreDescargaPdf('PRT-LYD-01', '1.0'), 'PRT-LYD-01_v1.0.pdf', 'con versión');
es(P.nombreDescargaPdf('PRT-LYD-01', null), 'PRT-LYD-01.pdf', 'sin versión');
es(P.nombreDescargaPdf('PRT LYD/01', ' 2.0 '), 'PRT_LYD_01_v2.0.pdf', 'nombre seguro');

// ═══ Rutas reales ════════════════════════════════════════════════════════════
async function empaquetar(entradas) {
  const carpeta = await fs.mkdtemp(path.join(os.tmpdir(), 'bio-protocolos-'));
  const salida = path.join(carpeta, 'rutas.mjs');
  await build({
    stdin: { contents: Object.entries(entradas).map(([nombre, archivo]) => `export * as ${nombre} from ${JSON.stringify(`./src/${archivo}`)};`).join('\n'), resolveDir: raiz, loader: 'ts' },
    outfile: salida, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'capturas', setup(b) {
      b.onResolve({ filter: /^@\/lib\/(email|smtp-worker|telegram|notificaciones|notif-app|audit|especialidad)$/ }, (a) => ({ path: a.path.split('/').at(-1), namespace: 'capturas' }));
      b.onLoad({ filter: /.*/, namespace: 'capturas' }, () => ({ contents: `
        const c = () => globalThis.__capturasWpGProt;
        export const sendMail = async () => {}; export const emailLayout = () => '';
        export const sendTelegram = async () => {}; export const crearNotificacion = async () => {};
        export const logAudit = async (_ctx, e) => { c().bitacora.push(e); };
        export const logAuditLote = async (_ctx, es) => { for (const e of es) c().bitacora.push(e); };
        export const calcularDiff = (_a, b) => b; export const labelCampo = (x) => x; export const resumenCambios = () => '';
        export const jefesNotificar = async () => []; export const disparadorOT = async () => {}; export const disparadorProyecto = async () => {};
      `, loader: 'js' }));
    } }],
  });
  try { return await import(pathToFileURL(salida).href); } finally { await fs.rm(carpeta, { recursive: true, force: true }); }
}

const cap = { bitacora: [] };
globalThis.__capturasWpGProt = cap;
const R = await empaquetar({
  lista: 'pages/api/procedimientos/index',
  ficha: 'pages/api/procedimientos/[id]',
  pdf: 'pages/api/procedimientos/[id]/pdf',
  biblioteca: 'lib/biblioteca-db',
  db: 'lib/db',
});
const h = await setupConjuntos();
const { sqlite, faults } = h;
// node:sqlite devuelve filas sin prototipo: se copian para compararlas.
const uno = (q, ...a) => { const fila = sqlite.prepare(q).get(...a); return fila ? { ...fila } : fila; };
const todos = (q, ...a) => sqlite.prepare(q).all(...a).map((fila) => ({ ...fila }));

// R2 en memoria.
const almacen = new Map();
const R2 = {
  async put(key, valor, opciones) { almacen.set(key, { datos: new Uint8Array(valor), tipo: opciones?.httpMetadata?.contentType ?? null }); return { key }; },
  async get(key) {
    const o = almacen.get(key);
    return o ? { body: new Blob([o.datos]).stream(), async arrayBuffer() { return o.datos.slice().buffer; } } : null;
  },
  async delete(key) { almacen.delete(key); },
};
const contexto = (url, opciones = {}) => {
  const ctx = h.ctx(url, opciones);
  ctx.locals.runtime.env.R2 = R2;
  return ctx;
};
const responder = async (r) => {
  const tipo = r.headers.get('content-type') ?? '';
  if (tipo.includes('application/pdf')) return { status: r.status, headers: r.headers, datos: new Uint8Array(await r.arrayBuffer()) };
  const texto = await r.text();
  let cuerpo; try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
  return { status: r.status, body: cuerpo, headers: r.headers };
};
const llamar = async (ruta, url, opciones) => responder(await ruta(contexto(url, opciones)));
const subir = async (id, archivo, rol = 'admin') => {
  const ctx = contexto(`/api/procedimientos/${id}/pdf`, { method: 'POST', id, rol });
  const fd = new FormData();
  if (archivo) fd.append('file', archivo);
  ctx.request = new Request(ctx.request.url, { method: 'POST', body: fd, headers: rol ? { cookie: ctx.request.headers.get('cookie') } : {} });
  return responder(await R.pdf.POST(ctx));
};
const verPdf = (id, rol, qs = '') => llamar(R.pdf.GET, `/api/procedimientos/${id}/pdf${qs}`, { id, rol });
const quitarPdf = (id, rol = 'admin') => llamar(R.pdf.DELETE, `/api/procedimientos/${id}/pdf`, { method: 'DELETE', id, rol });
const st = async (promesa, status, nota) => { const r = await promesa; n++; assert.equal(r.status, status, `${nota}: ${JSON.stringify(r.body)}`); return r; };
const archivo = (contenido, nombre, tipo = 'application/pdf') => new File([contenido], nombre, { type: tipo });

try {
  // ── Alta de un protocolo: sistema «otro», sin riesgo ni semana ────────────
  const alta = {
    codigoCorto: 'prt-lyd-01', tipo: 'protocolo', sistema: 'hvac', titulo: 'Limpieza y desinfección de equipo médico',
    responsableId: 2, nivelRiesgo: 'alto', semanaValidacion: 2,
    validaciones: [{ area: 'Control de Infecciones', fechaProgramada: '2026-11-20' }, { area: 'Calidad', fechaProgramada: '2026-11-20' }],
  };
  await st(llamar(R.lista.POST, '/api/procedimientos', { method: 'POST', data: { ...alta, tipo: 'pin' } }), 400, 'tipo desconocido');
  await st(llamar(R.lista.POST, '/api/procedimientos', { method: 'POST', data: alta, rol: 'tecnico' }), 403, 'el técnico no crea');
  const creado = await st(llamar(R.lista.POST, '/api/procedimientos', { method: 'POST', data: alta }), 201, 'alta del protocolo');
  const id = creado.body.procedimiento.id;
  es(uno('SELECT codigo_corto, tipo, sistema, nivel_riesgo, semana_validacion, estado, r2_key FROM procedimientos WHERE id = ?', id),
    { codigo_corto: 'PRT-LYD-01', tipo: 'protocolo', sistema: 'otro', nivel_riesgo: null, semana_validacion: null, estado: 'borrador', r2_key: null }, 'protocolo institucional');
  const sop = await st(llamar(R.lista.POST, '/api/procedimientos', { method: 'POST', data: { ...alta, codigoCorto: 'SOP-PRU-01', tipo: 'sop', titulo: 'Rutina de prueba' } }), 201, 'alta de un SOP');
  es(uno('SELECT sistema, nivel_riesgo, semana_validacion FROM procedimientos WHERE id = ?', sop.body.procedimiento.id),
    { sistema: 'hvac', nivel_riesgo: 'alto', semana_validacion: 2 }, 'los demás tipos no cambian');
  const soloProtocolos = await st(llamar(R.lista.GET, '/api/procedimientos?tipo=protocolo', { rol: 'visualizador' }), 200, 'filtro por tipo');
  es(soloProtocolos.body.procedimientos.map((p) => p.codigoCorto), ['PRT-LYD-01'], 'solo protocolos');

  // ── El PATCH ya no escribe r2Key ──────────────────────────────────────────
  await st(llamar(R.ficha.PATCH, `/api/procedimientos/${id}`, { method: 'PATCH', id, data: { r2Key: 'cualquier/objeto.pdf', titulo: 'Limpieza y desinfección de equipo médico (rev.)' } }), 200, 'PATCH con r2Key');
  es(uno('SELECT r2_key, titulo FROM procedimientos WHERE id = ?', id), { r2_key: null, titulo: 'Limpieza y desinfección de equipo médico (rev.)' }, 'r2Key descartado; lo demás se guarda');

  // ── 401 y 403 en JSON { error }, como requireUser (ronda 2) ───────────────
  // Antes los cinco 403 de la lista y la ficha salían en texto plano y las pantallas
  // decían «No se pudo guardar» en vez de la razón.
  const fueraDeRol = [
    ['GET de la lista', R.lista.GET, '/api/procedimientos', { rol: 'solicitante' }],
    ['POST de la lista', R.lista.POST, '/api/procedimientos', { method: 'POST', data: alta, rol: 'tecnico' }],
    ['GET de la ficha', R.ficha.GET, `/api/procedimientos/${id}`, { id, rol: 'motorista' }],
    ['PATCH de la ficha', R.ficha.PATCH, `/api/procedimientos/${id}`, { method: 'PATCH', id, data: { titulo: 'Otro título' }, rol: 'visualizador' }],
    ['DELETE de la ficha', R.ficha.DELETE, `/api/procedimientos/${id}`, { method: 'DELETE', id, rol: 'tecnico' }],
  ];
  for (const [nota, ruta, url, opciones] of fueraDeRol) {
    const r = await st(llamar(ruta, url, opciones), 403, `${nota} fuera de rol`);
    es([r.body, r.headers.get('content-type')?.split(';')[0]], [{ error: 'Sin permisos' }, 'application/json'], `${nota}: 403 en JSON`);
    const sinSesion = await st(llamar(ruta, url, { ...opciones, rol: null }), 401, `${nota} sin sesión`);
    es(sinSesion.body, { error: 'No autenticado' }, `${nota}: 401 en JSON`);
  }
  es(uno('SELECT titulo, estado, activo FROM procedimientos WHERE id = ?', id), { titulo: 'Limpieza y desinfección de equipo médico (rev.)', estado: 'borrador', activo: 1 },
    'fuera de rol no cambia nada');

  // ── Subir el PDF: roles, archivo, tamaño y firma ──────────────────────────
  await st(subir(id, archivo(PDF, 'a.pdf'), 'tecnico'), 403, 'el técnico no sube');
  await st(subir(id, archivo(PDF, 'a.pdf'), 'visualizador'), 403, 'el visualizador no sube');
  await st(subir(id, archivo(PDF, 'a.pdf'), null), 401, 'sin sesión');
  es((await st(subir(id, null), 400, 'sin archivo')).body, { error: 'Elige el PDF.' }, 'sin archivo');
  es((await st(subir(id, archivo(PNG, 'foto.pdf')), 415, 'PNG renombrado')).body, { error: 'El archivo no es un PDF.' }, 'firma revisada');
  es((await st(subir(id, archivo(new Uint8Array(0), 'vacio.pdf')), 400, 'vacío')).body, { error: 'El archivo está vacío.' }, 'vacío');
  const grande = new Uint8Array(15 * 1024 * 1024 + 1); grande.set(PDF);
  es((await st(subir(id, archivo(grande, 'grande.pdf')), 413, 'más de 15 MB')).body, { error: 'El PDF pasa de 15 MB. Redúcelo e inténtalo de nuevo.' }, '413');
  await st(subir(99999, archivo(PDF, 'a.pdf')), 404, 'documento inexistente');
  await st(subir('x', archivo(PDF, 'a.pdf')), 400, 'id inválido');
  es(almacen.size, 0, 'nada llegó a R2 con errores');

  const primero = await st(subir(id, archivo(PDF, 'Protocolo de limpieza (v0.1).pdf'), 'jefe'), 201, 'el jefe sube el PDF');
  const filaPdf = uno('SELECT r2_key, pdf_nombre, pdf_tamano, pdf_version, pdf_subido_por, pdf_subido_en FROM procedimientos WHERE id = ?', id);
  es([filaPdf.pdf_nombre, filaPdf.pdf_tamano, filaPdf.pdf_version, filaPdf.pdf_subido_por], ['Protocolo de limpieza (v0.1).pdf', PDF.length, '0.1', 2], 'datos del PDF');
  es(filaPdf.r2_key.startsWith(`procedimientos/${id}/`) && filaPdf.r2_key.endsWith('-Protocolo_de_limpieza_v0.1_.pdf'), true, 'llave segura en R2');
  es(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(filaPdf.pdf_subido_en), true, 'marca ISO con Z');
  es(primero.body.pdf, { nombre: 'Protocolo de limpieza (v0.1).pdf', tamano: PDF.length, version: '0.1', subidoEn: filaPdf.pdf_subido_en }, 'respuesta');
  es(almacen.get(filaPdf.r2_key)?.tipo, 'application/pdf', 'R2 guarda el tipo detectado');
  es(todos('SELECT cambio FROM procedimiento_versiones WHERE procedimiento_id = ? ORDER BY id', id).at(-1).cambio, 'PDF aprobado cargado: Protocolo de limpieza (v0.1).pdf (versión 0.1)', 'historial de versiones');
  es(cap.bitacora.at(-1), { entidad: 'procedimiento', entidadId: id, accion: 'update', resumen: 'PDF aprobado cargado: Protocolo de limpieza (v0.1).pdf (versión 0.1)' }, 'bitácora');

  // ── Ver y descargar ───────────────────────────────────────────────────────
  for (const rol of ['admin', 'jefe', 'tecnico', 'visualizador']) await st(verPdf(id, rol), 200, `${rol} ve el PDF`);
  for (const rol of ['solicitante', 'motorista']) await st(verPdf(id, rol), 403, `${rol} no lo ve`);
  const visto = await verPdf(id, 'tecnico', '?v=123');
  es([visto.headers.get('content-type'), visto.headers.get('x-content-type-options'), visto.headers.get('cache-control')], ['application/pdf', 'nosniff', 'private, max-age=60'], 'cabeceras');
  es(visto.headers.get('content-disposition').startsWith('inline; filename="PRT-LYD-01_v0.1.pdf"'), true, 'en línea con nombre CODIGO_vX');
  es([...visto.datos], [...PDF], 'el mismo archivo');
  es((await verPdf(id, 'visualizador', '?descargar=1')).headers.get('content-disposition').startsWith('attachment;'), true, 'descargar');
  es((await st(verPdf(sop.body.procedimiento.id, 'tecnico'), 404, 'sin PDF')).body, { error: 'Este documento no tiene PDF cargado.' }, 'sin PDF');

  // ── Reemplazar: el anterior se borra de R2 ────────────────────────────────
  const llaveAnterior = filaPdf.r2_key;
  await st(subir(id, archivo(PDF, 'version-final.pdf')), 201, 'reemplazo');
  const reemplazo = uno('SELECT r2_key, pdf_nombre FROM procedimientos WHERE id = ?', id);
  es([almacen.has(llaveAnterior), almacen.has(reemplazo.r2_key), almacen.size], [false, true, 1], 'solo queda el PDF nuevo');
  es(todos('SELECT cambio FROM procedimiento_versiones WHERE procedimiento_id = ? ORDER BY id', id).at(-1).cambio,
    'PDF reemplazado: Protocolo de limpieza (v0.1).pdf → version-final.pdf (versión 0.1)', 'historial del reemplazo');

  // Otra persona cambia el PDF entre la lectura y el guardado: 409 y el archivo nuevo no queda huérfano.
  faults.beforeStatement = {
    matches: (sql) => /^update "procedimientos" set "r2_key"/i.test(sql),
    run: async () => { sqlite.prepare('UPDATE procedimientos SET r2_key = ? WHERE id = ?').run('otra/persona.pdf', id); },
  };
  es((await st(subir(id, archivo(PDF, 'carrera.pdf')), 409, 'carrera')).body.error, 'Otra persona acaba de cambiar el PDF de este documento. Recarga la página.', 'texto del 409');
  es([almacen.size, almacen.has(reemplazo.r2_key)], [1, true], 'el archivo de la carrera se borró');
  sqlite.prepare('UPDATE procedimientos SET r2_key = ? WHERE id = ?').run(reemplazo.r2_key, id);

  // ── Versión nueva: el aviso sale en la ficha; el PDF sigue siendo el de 0.1 ─
  await st(llamar(R.ficha.PATCH, `/api/procedimientos/${id}`, { method: 'PATCH', id, data: { version: '0.2' } }), 200, 'versión nueva');
  const tras = uno('SELECT tipo, estado, activo, version, r2_key AS r2Key, pdf_version AS pdfVersion FROM procedimientos WHERE id = ?', id);
  es(P.avisosPdf({ ...tras, activo: !!tras.activo }).at(0), 'El PDF es de la versión 0.1 y el documento está en la versión 0.2. Sube el PDF de la versión actual.', 'aviso de otra versión');

  // ── Retirado: el técnico ya no abre el PDF; no se le sube otro ────────────
  await st(llamar(R.ficha.DELETE, `/api/procedimientos/${id}`, { method: 'DELETE', id }), 200, 'retirar el documento');
  es((await st(verPdf(id, 'tecnico'), 403, 'técnico con retirado')).body, { error: 'Documento retirado: su PDF ya no se usa.' }, 'retirado');
  await st(verPdf(id, 'visualizador'), 403, 'visualizador con retirado');
  await st(verPdf(id, 'jefe'), 200, 'el jefe sí');
  es((await st(subir(id, archivo(PDF, 'otro.pdf')), 409, 'subir a un retirado')).body, { error: 'El documento está retirado: no se le sube PDF.' }, 'no se sube');

  // ── Quitar el PDF ─────────────────────────────────────────────────────────
  await st(quitarPdf(id, 'tecnico'), 403, 'el técnico no quita');
  es((await st(quitarPdf(id, 'jefe'), 200, 'el jefe quita')).body, { ok: true }, 'quitar');
  es(uno('SELECT r2_key, pdf_nombre, pdf_tamano, pdf_version, pdf_subido_por, pdf_subido_en FROM procedimientos WHERE id = ?', id),
    { r2_key: null, pdf_nombre: null, pdf_tamano: null, pdf_version: null, pdf_subido_por: null, pdf_subido_en: null }, 'columnas en null');
  es(almacen.size, 0, 'R2 vacío');
  es(todos('SELECT cambio FROM procedimiento_versiones WHERE procedimiento_id = ? ORDER BY id', id).at(-1).cambio, 'PDF quitado: version-final.pdf', 'historial al quitar');
  es(cap.bitacora.at(-1).resumen, 'PDF quitado: version-final.pdf', 'bitácora al quitar');
  es((await st(quitarPdf(id), 404, 'quitar otra vez')).body, { error: 'Este documento no tiene PDF cargado.' }, 'ya no hay PDF');
  await st(quitarPdf(99999), 404, 'documento inexistente');

  // ── La lista de la biblioteca con más de 100 documentos (revisión WP-G) ───
  // Antes pedía campos y validaciones con la lista de ids de todos los documentos
  // activos: con 101 o más, D1 rechaza la consulta (100 parámetros) y /procedimientos
  // no abre. Con la subconsulta, cada consulta lleva un solo parámetro.
  const insDoc = sqlite.prepare("INSERT INTO procedimientos(codigo_corto, tipo, sistema, titulo, responsable_id, activo) VALUES (?, 'sop', 'otro', ?, 2, ?)");
  const insCampo = sqlite.prepare("INSERT INTO procedimiento_campos(procedimiento_id, etiqueta) VALUES (?, 'Valor en azul')");
  const insVal = sqlite.prepare("INSERT INTO procedimiento_validaciones(procedimiento_id, area, fecha_programada) VALUES (?, 'Calidad', '2026-11-20')");
  for (let i = 0; i < 151; i++) {
    const doc = Number(insDoc.run(`LOTE-${String(i).padStart(3, '0')}`, `Documento ${i}`, i === 150 ? 0 : 1).lastInsertRowid);
    insCampo.run(doc); insVal.run(doc);
  }
  const activosDocs = todos('SELECT id FROM procedimientos WHERE activo = 1').map((f) => f.id);
  es(activosDocs.length > 100, true, `más de 100 documentos activos (${activosDocs.length})`);
  const desde = h.queries.length;
  const bib = await R.biblioteca.camposYValidacionesActivos(R.db.getDb(contexto('/procedimientos')));
  const enActivos = (q) => uno(`SELECT count(*) AS n FROM ${q} WHERE procedimiento_id IN (SELECT id FROM procedimientos WHERE activo = 1)`).n;
  es([bib.campos.length, bib.validaciones.length], [enActivos('procedimiento_campos'), enActivos('procedimiento_validaciones')], 'campos y validaciones de todos los activos');
  const inactivo = uno("SELECT id FROM procedimientos WHERE codigo_corto = 'LOTE-150'").id;
  es(bib.campos.some((c) => c.procedimientoId === inactivo), false, 'sin los del documento inactivo');
  const nuevas = h.queries.slice(desde);
  es(nuevas.length, 2, 'dos consultas');
  es(Math.max(...nuevas.map((q) => (q.sql.match(/\?/g) ?? []).length)), 1, 'un solo parámetro por consulta, cualquiera que sea el tamaño de la biblioteca');
  const paginaLista = await fs.readFile(path.join(raiz, 'src/pages/procedimientos.astro'), 'utf8');
  es([paginaLista.includes('await camposYValidacionesActivos(db)'), /inArray\(procedimiento(Campos|Validaciones)\./.test(paginaLista)], [true, false], '/procedimientos usa la subconsulta, no la lista de ids');
} finally {
  faults.beforeStatement = null;
  await h.close();
}

console.log(`PASS test-bio-protocolos: ${n} casos`);
