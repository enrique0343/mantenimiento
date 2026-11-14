// Fase 59 · WP-D: metadatos de los documentos del equipo, vencimientos que mandan y
// filtros y CSV del listado de expedientes técnicos (src/lib/inventario-jci.ts). Puro.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({
  stdin: { contents: "export * from './src/lib/inventario-jci';\nexport { completitudExpediente } from './src/lib/biomedico';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent',
});
const J = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const ok = (datos) => ({ ok: true, datos });
const mal = (error) => ({ ok: false, error });
const alta = (e) => J.leerMetadatosDocumento(e, { parcial: false });
const parcial = (e, actual) => J.leerMetadatosDocumento(e, { parcial: true, actual });

// ── leerMetadatosDocumento ──────────────────────────────────────────────────
es(alta({ categoria: 'manual_operacion' }), ok({ categoria: 'manual_operacion', version: null, fechaVersion: null, fechaVencimiento: null, nota: null }), 'alta mínima');
es(alta({ categoria: 'garantia', version: '2', fechaDocumento: '2026-05-10', fechaVencimiento: '2028-05-10', nota: 'Cubre la batería' }),
  ok({ categoria: 'garantia', version: '2', fechaVersion: '2026-05-10', fechaVencimiento: '2028-05-10', nota: 'Cubre la batería' }), 'alta completa');
es(alta({}), mal('Elige la categoría del documento.'), 'sin categoría');
es(alta({ categoria: '   ' }), mal('Elige la categoría del documento.'), 'categoría en blanco');
es(alta({ categoria: 'planos' }), mal('Categoría no válida.'), 'categoría desconocida');
es(alta({ categoria: 'manual' }).ok, true, '«manual» (heredada) se acepta');
es(alta({ categoria: 'acta_baja' }).ok, true, 'acta de baja firmada');
es(alta({ categoria: 'otro', fechaDocumento: '2026-02-30' }), mal('La fecha del documento no es válida.'), '30 de febrero');
es(alta({ categoria: 'otro', fechaDocumento: '10/05/2026' }), mal('La fecha del documento no es válida.'), 'la fecha va como AAAA-MM-DD');
es(alta({ categoria: 'otro', fechaVencimiento: '2026-13-01' }), mal('La fecha de vencimiento no es válida.'), 'mes 13');
es(alta({ categoria: 'registro_sanitario', fechaDocumento: '2026-05-10', fechaVencimiento: '2026-05-09' }),
  mal('El vencimiento no puede ser anterior a la fecha del documento.'), 'vence antes del documento');
es(alta({ categoria: 'registro_sanitario', fechaDocumento: '2026-05-10', fechaVencimiento: '2026-05-10' }).ok, true, 'vence el mismo día: vale');
es(parcial({ fechaVencimiento: '2026-01-01' }, { categoria: 'garantia', fechaVersion: '2026-02-01', fechaVencimiento: null }),
  mal('El vencimiento no puede ser anterior a la fecha del documento.'), 'parcial: compara con la fecha guardada');
es(parcial({ fechaDocumento: '2027-01-01' }, { categoria: 'garantia', fechaVersion: null, fechaVencimiento: '2026-12-31' }),
  mal('El vencimiento no puede ser anterior a la fecha del documento.'), 'parcial: compara con el vencimiento guardado');
es(parcial({ nota: 'ok' }, { categoria: 'garantia', fechaVersion: '2026-02-01', fechaVencimiento: '2026-01-01' }), ok({ nota: 'ok' }), 'parcial sin fechas no revisa las guardadas');
es(parcial({ fechaVencimiento: null }, { categoria: 'garantia', fechaVersion: '2026-02-01', fechaVencimiento: '2026-01-01' }), ok({ fechaVencimiento: null }), 'parcial: quitar el vencimiento');
es(alta({ categoria: 'otro', version: 'x'.repeat(41) }), mal('La versión es muy larga (máx. 40 caracteres).'), 'versión de 41');
es(alta({ categoria: 'otro', version: 'x'.repeat(40) }).ok, true, 'versión de 40');
es(alta({ categoria: 'otro', nota: 'x'.repeat(301) }), mal('La nota es muy larga (máx. 300 caracteres).'), 'nota de 301');
es(alta({ categoria: 'otro', nota: 'x'.repeat(300) }).ok, true, 'nota de 300');
es(parcial({}), ok({}), 'parcial vacío');
es(parcial({ categoria: '' }), mal('Elige la categoría del documento.'), 'parcial: la categoría no se vacía');
es(parcial({ categoria: 'manual_servicio', unaClaveQueNoEs: 1 }), ok({ categoria: 'manual_servicio' }), 'reclasificar un manual');
es(alta({ categoria: 'garantia', version: '', nota: '   ', fechaDocumento: '' }),
  ok({ categoria: 'garantia', version: null, fechaVersion: null, fechaVencimiento: null, nota: null }), '"" → null');
es(alta({ categoria: '  ficha_tecnica  ', version: ' 3.2 ', nota: '  Rev. B ' }),
  ok({ categoria: 'ficha_tecnica', version: '3.2', fechaVersion: null, fechaVencimiento: null, nota: 'Rev. B' }), 'recorta espacios');

// ── Etiquetas ───────────────────────────────────────────────────────────────
es(J.CATEGORIA_DOC_LABEL.instalacion, 'Acta de instalación o aceptación', 'acta de instalación');
es(J.CATEGORIA_DOC_LABEL.manual, 'Manual (sin clasificar)', 'manual heredado');
es(J.CATEGORIA_DOC_LABEL.acta_baja, 'Acta de baja firmada', 'acta de baja');
es(J.CATEGORIA_DOC_LABEL.limpieza_desinfeccion, 'Protocolo de limpieza y desinfección del fabricante', 'protocolo de limpieza');
es(Object.keys(J.CATEGORIA_DOC_LABEL).length, 15, 'las 15 categorías (con la heredada)');

// ── Vida útil (sin new Date sobre fechas sin hora) ──────────────────────────
es([J.finVidaUtil('2020-05-10', 10), J.finVidaUtil('2020-02-29', 1), J.finVidaUtil('2020-05-10 08:00:00', 5), J.finVidaUtil(null, 5), J.finVidaUtil('2020-05-10', null), J.finVidaUtil('x', 5)],
  ['2030-05-10', '2021-02-28', '2025-05-10', null, null, null], 'finVidaUtil');
es([J.vidaUtilVencida('2000-01-01', 5), J.vidaUtilVencida('2099-01-01', 5), J.vidaUtilRemanente(null, 5)], [true, false, null], 'vida útil vencida y remanente');

// ── Vencimientos que mandan ─────────────────────────────────────────────────
const doc = (id, categoria, fechaVencimiento = null) => ({ id, categoria, fechaVencimiento });
const ids = (lista) => lista.map((v) => v.documento.id);
es(ids(J.vencimientosVigentes([doc(1, 'registro_sanitario', '2025-01-01'), doc(2, 'registro_sanitario', '2027-01-01')])), [2], 'el registro nuevo reemplaza al vencido');
es(ids(J.vencimientosVigentes([doc(1, 'registro_sanitario', '2025-01-01'), doc(2, 'registro_sanitario')])), [], 'uno sin vencimiento: la categoría no vence');
es(ids(J.vencimientosVigentes([doc(1, 'otro', '2027-01-01'), doc(2, 'otro', '2026-12-01'), doc(3, 'licencia', '2026-11-20')])), [3, 2, 1], 'en «otro» y «licencia» cuenta cada uno, por fecha');
es(ids(J.vencimientosVigentes([doc(1, 'garantia', '2026-12-01'), doc(2, 'manual_operacion'), doc(3, 'seguridad_electrica', '2027-03-01'), doc(4, 'seguridad_electrica', '2026-03-01')])), [1, 3], 'garantía y último informe eléctrico');
es(J.vencimientosVigentes([doc(1, 'garantia', '2026-02-30')]), [], 'fecha inválida: no vence');
es(J.vencimientosVigentes([doc(1, null, '2026-12-01')]).map((v) => v.categoria), ['otro'], 'sin categoría cuenta como «otro»');

// ── Filtros del listado de expedientes ──────────────────────────────────────
const hoy = '2026-11-12';
const fila = (activoId, extra, documentos = [], noAplica = [], aceptacionFecha = null) => {
  const completitud = J.completitudExpediente({ documentos, noAplica, aceptacionFecha, hoy });
  return {
    activoId, codigo: `BIO-${String(activoId).padStart(3, '0')}`, nombre: 'Monitor', marca: 'Mindray', modelo: 'uMEC12', serial: `S${activoId}`,
    estado: 'operativo', subcategoria: 'diagnostico', criticidad: 'media', sucursalId: 1, sede: 'Central', ubicacion: 'UCI',
    aceptacionFecha, documentos: documentos.length, completitud, proximoVencimiento: null, porVencer90: 0, ...extra,
  };
};
const completos = [doc(1, 'manual_operacion'), doc(2, 'manual_servicio'), doc(3, 'especificaciones'), doc(4, 'registro_sanitario', '2027-06-01'), doc(5, 'instalacion'), doc(6, 'limpieza_desinfeccion')];
const filas = [
  fila(1, {}, completos),
  fila(2, { nombre: 'Ventilador pulmonar', marca: 'Dräger', subcategoria: 'soporte_vida', criticidad: 'alta', sucursalId: 2, porVencer90: 1 }, [doc(7, 'manual_operacion'), doc(8, 'registro_sanitario', '2026-12-01')]),
  fila(3, { estado: 'baja', subcategoria: null, criticidad: null }, []),
  fila(4, { modelo: 'Lumina', serial: 'XYZ-9' }, [doc(9, 'ficha_tecnica')], [{ requisito: 'registro_sanitario', motivo: 'No lo exige la norma' }], '2025-03-01'),
];
const f = (q) => J.leerFiltrosExpediente(new URLSearchParams(q), ['soporte_vida', 'diagnostico']);
const codigos = (q) => J.filtrarExpedientes(filas, f(q)).map((r) => r.activoId);
es(f(''), { sede: null, subcategoria: null, criticidad: null, estado: 'todos', falta: null, q: '', bajas: false, vence: false }, 'filtros por defecto');
es(f('sede=x&subcategoria=otra&criticidad=urgente&estado=raro&falta=planos').estado, 'todos', 'valores desconocidos se ignoran');
es(codigos(''), [1, 2, 4], 'sin bajas por defecto');
es(codigos('bajas=1'), [1, 2, 3, 4], 'con bajas');
es(codigos('estado=completos'), [1], 'completos');
es(codigos('estado=incompletos'), [2, 4], 'incompletos');
es(codigos('falta=registro_sanitario'), [], 'registro: 1 vigente, 2 vigente, 4 no aplica');
es(codigos('falta=aceptacion'), [2], 'acta: el 4 tiene inspección registrada');
es(codigos('falta=limpieza_desinfeccion'), [2, 4], 'falta el protocolo de limpieza');
// Las tarjetas abren con los demás filtros: cuentan con ellos (antes contaban todos los biomédicos).
es(J.resumenExpedientes(filas, f('')), { total: 3, completos: 1, incompletos: 2, porcentaje: 33, porVencer: 1 }, 'tarjetas sin filtros (sin bajas)');
es(J.resumenExpedientes(filas, f('sede=2&estado=completos&vence=90')), { total: 1, completos: 0, incompletos: 1, porcentaje: 0, porVencer: 1 },
  'tarjetas con sede: cuentan lo que abre cada una («Expediente» y «vence» no las cambian)');
es(J.resumenExpedientes(filas, f('sede=1&estado=incompletos')).incompletos, codigos('sede=1&estado=incompletos').length, '«Incompletos» = lo que muestra al abrirla');
es([J.hayFiltrosDeLista(f('estado=incompletos&vence=90&bajas=1')), J.hayFiltrosDeLista(f('falta=garantia'))], [false, true], 'filtros de la lista');
es(codigos('falta=garantia'), [1, 2, 4], 'falta la garantía');
es(codigos('sede=2'), [2], 'por sede');
es(codigos('subcategoria=soporte_vida'), [2], 'por subcategoría');
es(codigos('subcategoria=sin&bajas=1'), [3], 'sin subcategoría');
es(codigos('criticidad=alta'), [2], 'por criticidad');
es(codigos('vence=90'), [2], 'con documentos que vencen en ≤ 90 días');
es(codigos('q=drager'), [2], 'busca sin tildes en la marca');
es(codigos('q=xyz-9'), [4], 'busca en la serie');
es(J.paramsDeFiltrosExpediente(f('estado=incompletos&falta=garantia&q=uci&bajas=1&vence=90')).toString(), 'estado=incompletos&falta=garantia&q=uci&bajas=1&vence=90', 'parámetros para el CSV');
es(J.faltaEnExpediente(filas[1].completitud, 'manual_mantenimiento'), true, 'faltaEnExpediente');

// ── CSV ─────────────────────────────────────────────────────────────────────
const etq = { estado: (e) => e, subcategoria: (s) => s ?? 'Sin segmentar', criticidad: (c) => c ?? 'Sin definir' };
const csv4 = J.filaCsvExpediente(filas[3], etq);
es([csv4.avance, csv4.completo, csv4.req_registro_sanitario, csv4.req_aceptacion, csv4.req_manual_operacion, csv4.limpieza],
  ['3/5', 'No', 'No aplica: No lo exige la norma', 'Inspección de aceptación 2025-03-01', 'Falta', 'No'], 'fila del CSV de expedientes');
es(J.filaCsvExpediente(filas[0], etq).falta, '', 'completo: sin faltantes');
es(J.COLUMNAS_CSV_EXPEDIENTES.map((c) => c.key).filter((k) => k.startsWith('req_')).length, 5, 'una columna por requisito');
es(J.filaCsvDocumento({ codigo: 'BIO-001', equipo: 'Monitor', categoria: 'registro_sanitario', nombre: 'RS.pdf', version: null, fechaVersion: '2025-12-01', fechaVencimiento: '2026-12-01', nota: null, subidoPor: 'Ana', subidoEl: '2026-11-10' }, hoy),
  { codigo: 'BIO-001', equipo: 'Monitor', categoria: 'Registro sanitario o inscripción', archivo: 'RS.pdf', version: '', fecha: '2025-12-01', vence: '2026-12-01', diasVence: 19, nota: '', subidoPor: 'Ana', subidoEl: '2026-11-10' },
  'fila del CSV de documentos: fechas AAAA-MM-DD');
// «Subido el» es una marca (created_at de SQLite, en UTC): en el CSV va 'AAAA-MM-DD HH:MM' de El Salvador (§f.5).
es(J.filaCsvDocumento({ codigo: 'BIO-001', equipo: 'Monitor', categoria: 'otro', nombre: 'a.pdf', version: null, fechaVersion: null, fechaVencimiento: null, nota: null, subidoPor: null, subidoEl: '2026-11-11 02:30:00' }, hoy).subidoEl,
  '2026-11-10 20:30', 'subido de noche en El Salvador: el día de SV y su hora, no el día UTC');
es([J.marcaCsvSV('2026-11-12 15:30:00'), J.marcaCsvSV('2026-11-12T06:00:00.000Z'), J.marcaCsvSV('2026-11-12'), J.marcaCsvSV(null), J.marcaCsvSV('ayer')],
  ['2026-11-12 09:30', '2026-11-12 00:00', '2026-11-12', '', ''], 'marcaCsvSV');

// ── Ronda 2: el inventario marca «No requiere registro sanitario» ───────────
const sinRegistro = { ...fila(5, {}, [doc(10, 'manual_operacion')]), completitud: J.completitudExpediente({ documentos: [doc(10, 'manual_operacion')], registroSanitarioNoRequiere: true, hoy }) };
const csv5 = J.filaCsvExpediente(sinRegistro, etq);
es([csv5.avance, csv5.req_registro_sanitario, csv5.falta.includes('Registro sanitario')],
  ['2/5', 'No aplica: El inventario marca que el equipo no requiere registro sanitario.', false], 'CSV: «No aplica» con el motivo del inventario y sin «Registro sanitario» en «Falta»');
es(J.filtrarExpedientes([...filas, sinRegistro], f('falta=registro_sanitario')).map((r) => r.activoId), [], '«Falta: Registro sanitario» no lo lista');

console.log(`PASS test-bio-documentos: ${n} casos; metadatos del documento, vencimientos que mandan, filtros y CSV de expedientes (también sin registro sanitario).`);
