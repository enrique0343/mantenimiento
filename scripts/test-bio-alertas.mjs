// Fase 59 · WP-E: reglas de las alertas y retiros (src/lib/alertas.ts): análisis de
// aplicabilidad, cierre firme con fecha declarada, reapertura con motivo y filtros
// de la lista y del CSV. Sin red ni base.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: ['src/lib/alertas.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
const A = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const M = A.MENSAJE_ALERTA;

const hoy = '2026-11-12';
const ahoraISO = '2026-11-12T15:00:00.000Z';
const ctx = (extra = {}) => ({ hoy, ahoraISO, usuarioId: 7, equiposActuales: 2, ...extra });
const abierta = (extra = {}) => ({
  estado: 'abierta', aplicabilidad: 'pendiente', aplicabilidadAnalisis: null, aplicabilidadFecha: null,
  accionTomada: null, fechaAlerta: '2026-11-01', vecesReabierta: 0, ...extra,
});
const analizada = (extra = {}) => abierta({ aplicabilidad: 'aplica', aplicabilidadAnalisis: 'Lote 12 presente en UCI', aplicabilidadFecha: '2026-11-05', ...extra });
const cerrada = (extra = {}) => analizada({ estado: 'cerrada', accionTomada: 'Se retiraron las bombas del lote', vecesReabierta: 1, ...extra });
const plan = (actual, cambio, c = ctx()) => A.planearCambioAlerta(actual, cambio, c);
const falla = (r) => (r.ok ? 'ok' : [r.status, r.error]);

// ── R1-R3: una alerta cerrada solo se reabre, con motivo ────────────────────
es(falla(plan(cerrada(), { estado: 'cerrada', accionTomada: 'Se retiraron las bombas del lote' })), [409, M.cerrada], 'R3: volver a guardar una cerrada → 409');
es(falla(plan(cerrada(), {})), [409, M.cerrada], 'R3: guardar sin cambios → 409');
es(falla(plan(cerrada(), { titulo: 'Otro título' })), [409, M.cerrada], 'R3: editar una cerrada → 409');
es(falla(plan(cerrada(), { estado: 'abierta', motivoReapertura: 'Error de dato', titulo: 'Otro' })), [409, M.cerrada], 'R3: reabrir y editar a la vez → 409');
es(falla(plan(cerrada(), { estado: 'abierta' })), [400, M.reabrirSinMotivo], 'R2: reabrir sin motivo → 400');
es(falla(plan(cerrada(), { estado: 'en_proceso', motivoReapertura: '  corto  ' })), [400, M.reabrirSinMotivo], 'R2: motivo de menos de 10 caracteres');
let r = plan(cerrada(), { estado: 'en_proceso', motivoReapertura: '  El fabricante amplió el lote afectado ' });
es(r.ok && r.evento, 'reapertura', 'R1: reabre');
es(r.set, {
  estado: 'en_proceso', cerradaEn: null, cerradaPor: null, fechaCierre: null, reabiertaEn: ahoraISO, reabiertaPor: 7,
  motivoReapertura: 'El fabricante amplió el lote afectado', vecesReabierta: 2, updatedAt: ahoraISO,
}, 'R1: limpia el cierre, deja la constancia y suma 1');
es(r.equipos, null, 'R1: no toca los equipos');

// ── R4: fecha de emisión ───────────────────────────────────────────────────
es(falla(plan(abierta(), { fechaAlerta: '2026-11-13' })), [400, M.emisionFutura], 'R4: emisión futura');
es(falla(plan(abierta(), { fechaAlerta: '2026-02-30' })), [400, M.emisionInvalida], 'emisión no válida');
es(plan(abierta(), { fechaAlerta: hoy }).ok, true, 'emisión hoy vale');
es(falla(plan(abierta(), { titulo: 'ab' })), [400, M.titulo], 'título corto');

// ── R5-R7: análisis de aplicabilidad ───────────────────────────────────────
es(falla(plan(abierta(), { aplicabilidad: 'aplica', aplicabilidadAnalisis: 'corto' })), [400, M.analisis], 'R5: análisis de menos de 10');
es(falla(plan(abierta(), { aplicabilidad: 'no_aplica' })), [400, M.analisis], 'R5: «no aplica» también pide análisis');
es(falla(plan(abierta(), { aplicabilidad: 'aplica', aplicabilidadAnalisis: 'Lote 12 presente en UCI', aplicabilidadFecha: '2026-11-13' })), [400, M.fechaAnalisis], 'R6: análisis con fecha futura');
es(falla(plan(abierta(), { aplicabilidad: 'aplica', aplicabilidadAnalisis: 'Lote 12 presente en UCI', aplicabilidadFecha: '2026-10-31' })), [400, M.fechaAnalisis], 'R6: análisis antes de la emisión');
es(falla(plan(analizada(), { fechaAlerta: '2026-11-06' })), [400, M.fechaAnalisis], 'R6: mover la emisión después del análisis');
es(falla(plan(abierta(), { aplicabilidad: 'aplica', aplicabilidadAnalisis: 'Lote 12 presente en UCI' }, ctx({ equiposActuales: 0 }))), [400, M.aplicaSinEquipos], 'R7: «aplica» sin equipos');
es(falla(plan(analizada(), { activoIds: [] })), [400, M.aplicaSinEquipos], 'R7: quitar todos los equipos de una que aplica');
r = plan(abierta(), { aplicabilidad: 'no_aplica', aplicabilidadAnalisis: '  Ningún equipo del lote en el hospital  ', activoIds: [] }, ctx({ equiposActuales: 0 }));
es(r.ok, true, '«no aplica» sin equipos vale');
es([r.set.aplicabilidad, r.set.aplicabilidadAnalisis, r.set.aplicabilidadFecha, r.set.aplicabilidadPor], ['no_aplica', 'Ningún equipo del lote en el hospital', hoy, 7], 'R12: análisis con fecha de hoy y quién');
es(r.evento, 'edicion', 'es edición');
r = plan(abierta(), { aplicabilidad: 'aplica', aplicabilidadAnalisis: 'Lote 12 presente en UCI', aplicabilidadFecha: '2026-11-03', activoIds: [4, 4, 5] });
es([r.set.aplicabilidadFecha, r.equipos], ['2026-11-03', [4, 5]], 'fecha enviada y equipos sin repetir');
r = plan(analizada(), { aplicabilidad: 'pendiente' });
es([r.set.aplicabilidad, r.set.aplicabilidadAnalisis, r.set.aplicabilidadFecha, r.set.aplicabilidadPor], ['pendiente', null, null, null], 'volver a «pendiente» limpia el análisis');
r = plan(analizada(), { titulo: '  Retiro de bombas lote 12  ' });
es([r.set.titulo, 'aplicabilidad' in r.set, 'aplicabilidadPor' in r.set], ['Retiro de bombas lote 12', false, false], 'editar el título no toca el análisis');
r = plan(analizada(), { aplicabilidad: 'aplica', aplicabilidadAnalisis: 'Lote 12 presente en UCI', aplicabilidadFecha: '2026-11-05' });
es('aplicabilidadPor' in r.set, false, 'volver a enviar el mismo análisis no cambia quién lo hizo');

// ── R8-R10: cierre ──────────────────────────────────────────────────────────
es(falla(plan(abierta({ accionTomada: 'Se revisaron todos los equipos' }), { estado: 'cerrada' })), [400, M.cerrarSinAnalisis], 'R8: cerrar sin análisis');
es(falla(plan(analizada(), { estado: 'cerrada', accionTomada: 'Listo' })), [400, M.cerrarSinAccion], 'R9: acción de menos de 10');
es(falla(plan(analizada(), { estado: 'cerrada' })), [400, M.cerrarSinAccion], 'R9: sin acción');
es(falla(plan(analizada(), { estado: 'cerrada', accionTomada: 'Se retiraron las bombas', fechaCierre: '2026-11-13' })), [400, M.fechaCierre], 'R10: cierre futuro');
es(falla(plan(analizada(), { estado: 'cerrada', accionTomada: 'Se retiraron las bombas', fechaCierre: '2026-10-30' })), [400, M.fechaCierre], 'R10: cierre antes de la emisión');
es(falla(plan(analizada(), { estado: 'cerrada', accionTomada: 'Se retiraron las bombas', fechaCierre: '12/11/2026' })), [400, M.fechaCierreInvalida], 'cierre en otro formato');
r = plan(analizada(), { estado: 'cerrada', accionTomada: '  Se retiraron las bombas del lote  ' });
es(r.evento, 'cierre', 'cierra');
es([r.set.estado, r.set.accionTomada, r.set.fechaCierre, r.set.cerradaEn, r.set.cerradaPor, r.set.updatedAt],
  ['cerrada', 'Se retiraron las bombas del lote', hoy, ahoraISO, 7, ahoraISO], 'R12: cierre con la fecha de hoy y el sello del sistema');
r = plan(analizada({ accionTomada: 'Se retiraron las bombas del lote' }), { estado: 'cerrada', fechaCierre: '2026-11-08' });
es([r.ok, r.set.fechaCierre], [true, '2026-11-08'], 'fecha de cierre declarada y acción ya guardada');
r = plan(abierta(), {
  estado: 'cerrada', aplicabilidad: 'no_aplica', aplicabilidadAnalisis: 'Ningún equipo del lote en el hospital',
  accionTomada: 'No aplica: ningún equipo del hospital está afectado (ver análisis).', activoIds: [],
}, ctx({ equiposActuales: 0 }));
es([r.ok, r.evento, r.set.aplicabilidad], [true, 'cierre', 'no_aplica'], 'analizar y cerrar en el mismo paso');
r = plan(abierta(), { estado: 'en_proceso', motivoReapertura: 'no se usa aquí', fechaCierre: '2026-11-01' });
es([r.set.estado, 'motivoReapertura' in r.set, 'fechaCierre' in r.set], ['en_proceso', false, false], 'sin cerrar: ni fecha de cierre ni motivo');
es(plan(abierta(), {}).set, { updatedAt: ahoraISO }, 'sin cambios: solo la marca de actualización');

// ── Filtros de la lista y del CSV ───────────────────────────────────────────
const q = (s) => A.leerFiltrosAlertas(new URLSearchParams(s));
es(q(''), { estado: 'todas', analisis: 'todos', anio: null }, 'por defecto');
es(q('estado=abiertas&analisis=pendiente&anio=2026'), { estado: 'abiertas', analisis: 'pendiente', anio: 2026 }, 'leídos');
es(q('estado=otra&analisis=x&anio=99'), { estado: 'todas', analisis: 'todos', anio: null }, 'desconocidos → por defecto');
es(A.queryFiltrosAlertas(q('estado=cerradas&anio=2025')), '?estado=cerradas&anio=2025', 'query de ida y vuelta');
es(A.queryFiltrosAlertas(q('')), '', 'sin filtros: sin query');
const al = { estado: 'en_proceso', aplicabilidad: 'aplica', fechaAlerta: '2026-03-01' };
es(A.pasaFiltrosAlertas(al, q('estado=abiertas')), true, 'en proceso cuenta como abierta');
es(A.pasaFiltrosAlertas(al, q('estado=cerradas')), false, 'no es cerrada');
es(A.pasaFiltrosAlertas(al, q('analisis=no_aplica')), false, 'análisis distinto');
es(A.pasaFiltrosAlertas(al, q('anio=2025')), false, 'otro año');
es(A.pasaFiltrosAlertas(al, q('anio=2026&analisis=aplica')), true, 'año y análisis');

// ── Textos ──────────────────────────────────────────────────────────────────
es(A.folioAlerta(7), 'ALE-0007', 'folio');
es([A.textoReabierta(0), A.textoReabierta(1), A.textoReabierta(3)], ['', 'Reabierta 1 vez', 'Reabierta 3 veces'], 'veces reabierta');
es([A.diasDesdeEmision('2026-11-01', hoy), A.diasDesdeEmision('2026-11-12', hoy), A.diasDesdeEmision('x', hoy)], [11, 0, null], 'días desde la emisión');
es(A.CATEGORIA_ADJUNTO_ALERTA_LABEL.boletin, 'Boletín del fabricante', 'categoría de archivo');

console.log(`PASS test-bio-alertas: ${n} casos; cierre firme, reapertura con motivo, análisis de aplicabilidad y filtros.`);
