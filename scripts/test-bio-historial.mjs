// Fase 59 · WP-C: historial del equipo (requisito 9). La lista de eventos que comparten
// la línea de tiempo, el CSV y la hoja de vida (src/lib/historial-equipo.ts), y el
// cargador y el CSV contra las migraciones reales (src/lib/historial-equipo-db.ts y
// GET /api/activos/{id}/historial). También los ayudantes de la ficha y la hoja de vida, y los
// scripts de la ficha (src/pages/activos/[id].astro) corridos en jsdom tal como están en la
// página, y las tres páginas (ficha, historial y hoja de vida) pintadas de verdad por rol. Sin red
// ni base real.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { transform } from '@astrojs/compiler';
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
  si(H.construirEventos(historial, H.OPCIONES_CSV).find((e) => e.tipo === 'seguridad_electrica').detalle.includes('Próxima: 2027-01-15'), 'CSV AAAA-MM-DD');
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
  es(H.lineasExpediente(c), { faltan: ['Acta de instalación o aceptación'], vencidos: ['Manual de mantenimiento o servicio'], noAplica: [] },
    'el registro renovado no sale; el manual, que solo tiene una versión vencida, sí');
  es(H.lineasExpediente({ requisitos: [] }), { faltan: [], vencidos: [], noAplica: [] }, 'sin requisitos');
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
  si(hoja.includes('seccionesHojaVida('), 'la hoja de vida numera con seccionesHojaVida');
}

// ── Ronda 2 ───────────────────────────────────────────────────────────────────
// Lo que encontró la prueba de punta a punta: fechas AAAA-MM-DD a la vista en la bitácora (C1),
// «Imprimir viñeta» en un equipo sin viñeta (C2), «Falta» en el registro sanitario de un equipo que
// no lo requiere (C3); y que siguen corregidas las dos cosas de la revisión anterior (C4).
// Es la misma expresión con que la prueba de punta a punta busca una fecha AAAA-MM-DD a la vista.
const FECHA_ISO_A_LA_VISTA = /(?<![\w./-])(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?![\w-])/;

// C1a. Valores de la bitácora: en texto tal como se guardaron (CSV) y a la vista (pantalla).
es([null, undefined, '', true, false, 5, 2.5, '2.1', { a: 1 }].map(H.textoValorBitacora),
  ['(vacío)', '(vacío)', '(vacío)', 'Sí', 'No', '5', '2.5', '2.1', '{"a":1}'], 'valor en texto: vacío, sí/no, número, texto y objeto');
es(H.valorBitacoraVista('2027-11-12'), '12/11/2027', 'fecha sola: DD/MM/AAAA');
es(H.valorBitacoraVista('2026-01-01'), '01/01/2026', 'el 1 de enero no se corre al 31 de diciembre');
es(H.valorBitacoraVista('2028-02-29'), '29/02/2028', 'año bisiesto');
es(H.valorBitacoraVista('2026-11-12 15:30:00'), '12/11/2026 09:30', 'marca de SQLite (UTC) en hora de El Salvador');
es(H.valorBitacoraVista('2026-11-12 15:30'), '12/11/2026 09:30', 'marca sin segundos');
es(H.valorBitacoraVista('2026-11-13 05:59:59'), '12/11/2026 23:59', 'las 23:59 de SV siguen en su día');
es(H.valorBitacoraVista('2026-11-13T06:00:00.000Z'), '13/11/2026 00:00', 'ISO con Z');
es(H.valorBitacoraVista('2026-11-12T09:30:00-06:00'), '12/11/2026 09:30', 'ISO con desfase');
for (const igual of ['(vacío)', '2.1', 'Sí', 'CC-01 · UCI', '2026-02-30', '12/11/2026', 'LOTE-2026-11-12', '2026-11-12 a las 3', '2026', '']) {
  es(H.valorBitacoraVista(igual), igual, `no es fecha: «${igual}» no cambia`);
}
es(H.leerCambiosBitacora('{"version":{"antes":"2.1","despues":"2.2"},"fechaVencimiento":{"antes":null,"despues":"2027-11-12"},"esPatron":{"antes":false,"despues":true}}', (c) => `<${c}>`),
  [
    { campo: 'version', etiqueta: '<version>', antes: '2.1', despues: '2.2' },
    { campo: 'fechaVencimiento', etiqueta: '<fechaVencimiento>', antes: '(vacío)', despues: '2027-11-12' },
    { campo: 'esPatron', etiqueta: '<esPatron>', antes: 'No', despues: 'Sí' },
  ], 'cambios leídos tal como se guardaron, con la etiqueta de cada campo');
es([H.leerCambiosBitacora(null, String), H.leerCambiosBitacora('{malo', String), H.leerCambiosBitacora('[1,2]', String), H.leerCambiosBitacora('null', String)], [[], [], [], []], 'JSON vacío o ilegible: sin cambios');

// C1b. Línea de tiempo (/activos/{id}/historial) y su CSV: el mismo evento de bitácora, con las
// fechas DD/MM/AAAA en pantalla y AAAA-MM-DD en el CSV (como antes).
{
  const conFechas = {
    ...historial,
    bitacora: [
      { id: 2, createdAt: '2026-11-12 17:52:00', accion: 'update', resumen: 'Documento modificado: manual.pdf — Modificó Versión, Vence', usuario: 'Tomás',
        cambios: [{ campo: 'version', etiqueta: 'Versión', antes: '2.1', despues: '2.2' }, { campo: 'fechaVencimiento', etiqueta: 'Vence', antes: '(vacío)', despues: '2027-11-12' }] },
      { id: 3, createdAt: '2026-11-12 18:00:00', accion: 'update', resumen: 'Modificó Vencimiento del registro sanitario', usuario: 'Julio',
        cambios: [{ campo: 'registroSanitarioVencimiento', etiqueta: 'Vencimiento del registro sanitario', antes: '2028-10-12', despues: '2026-12-02' },
          { campo: 'anuladaEn', etiqueta: 'Anulada el', antes: '(vacío)', despues: '2026-11-13 01:15:00' }] },
    ],
  };
  const vista = H.construirEventos(conFechas, { hoy: '2026-11-12' }).filter((e) => e.tipo === 'bitacora');
  es(vista.map((e) => e.detalle), [
    'Versión: 2.1 → 2.2; Vence: (vacío) → 12/11/2027',
    'Vencimiento del registro sanitario: 12/10/2028 → 02/12/2026; Anulada el: (vacío) → 12/11/2026 19:15',
  ], 'pantalla: fechas DD/MM/AAAA y la marca en hora de El Salvador');
  no(H.construirEventos(conFechas, { hoy: '2026-11-12' }).some((e) => FECHA_ISO_A_LA_VISTA.test(`${e.titulo} ${e.detalle}`)), 'ningún texto de la línea de tiempo lleva una fecha AAAA-MM-DD');
  const csv = H.construirEventos(conFechas, { ...H.OPCIONES_CSV, hoy: '2026-11-12' }).filter((e) => e.tipo === 'bitacora');
  es(csv.map((e) => H.filaCsv(e, 'BIO-001').detalle), [
    'Versión: 2.1 → 2.2; Vence: (vacío) → 2027-11-12',
    'Vencimiento del registro sanitario: 2028-10-12 → 2026-12-02; Anulada el: (vacío) → 2026-11-13 01:15:00',
  ], 'CSV: los valores como se guardaron (AAAA-MM-DD), sin cambios');
  es(H.construirEventos(conFechas, { valor: (t) => `[${t}]` }).find((e) => e.tipo === 'bitacora').detalle, 'Versión: [2.1] → [2.2]; Vence: [(vacío)] → [2027-11-12]', 'la opción «valor» decide cómo se escribe cada valor');
}

// C1c. Tarjeta «Historial de cambios» de la ficha: los mismos valores a la vista.
const filasBitacora = [
  { accion: 'update', resumen: 'Documento modificado: manual.pdf — Modificó Versión, Vence', createdAt: '2026-11-12 17:52:00', usuario: 'Tomás Técnico',
    cambios: '{"version":{"antes":"2.1","despues":"2.2"},"fechaVencimiento":{"antes":null,"despues":"2027-11-12"}}' },
  { accion: 'update', resumen: null, createdAt: '2026-11-12T18:00:00Z', usuario: null,
    cambios: '{"registroSanitarioVencimiento":{"antes":"2028-10-12","despues":"2026-12-02"},"registroSanitarioNoRequiere":{"antes":false,"despues":true}}' },
  { accion: 'create', resumen: '  ', createdAt: '2026-01-01 05:00:00', usuario: 'Julio Jefe', cambios: null },
  { accion: 'delete', resumen: 'Calibración del 10/05/2026 eliminada — equipo equivocado', createdAt: '2026-05-11 01:30:00', usuario: 'Julio Jefe',
    cambios: '{"numeroCertificado":{"antes":"C-1","despues":null}}' },
];
const etiquetaPrueba = (c) => ({ version: 'Versión', fechaVencimiento: 'Vence', registroSanitarioVencimiento: 'Vencimiento del registro sanitario',
  registroSanitarioNoRequiere: 'No requiere registro sanitario', numeroCertificado: 'N.º de certificado' })[c] ?? c;
{
  const t = H.tarjetaHistorialCambios('tecnico', filasBitacora, etiquetaPrueba);
  es(t[0], {
    accion: 'update', accionLabel: 'Modificó', accionColor: 'bg-blue-50 text-blue-700', usuario: 'Tomás Técnico',
    resumen: 'Documento modificado: manual.pdf — Modificó Versión, Vence', cuando: '12/11/2026 11:52',
    cambios: [{ etiqueta: 'Versión', antes: '2.1', despues: '2.2' }, { etiqueta: 'Vence', antes: '(vacío)', despues: '12/11/2027' }],
  }, 'documento: versión y vencimiento a la vista; la hora en El Salvador');
  es(t[1].cambios, [
    { etiqueta: 'Vencimiento del registro sanitario', antes: '12/10/2028', despues: '02/12/2026' },
    { etiqueta: 'No requiere registro sanitario', antes: 'No', despues: 'Sí' },
  ], 'registro sanitario: fechas DD/MM/AAAA y «Sí/No» (antes salían «true/false»)');
  es([t[1].usuario, t[1].resumen, t[1].cuando], ['Sistema', null, '12/11/2026 12:00'], 'sin usuario: «Sistema»; marca ISO en hora de El Salvador');
  es([t[2].accionLabel, t[2].resumen, t[2].cuando, t[2].cambios], ['Creó', null, '31/12/2025 23:00', []], 'alta sin cambios: el día de El Salvador');
  es([t[3].accionLabel, t[3].accionColor, t[3].cambios[0].despues], ['Eliminó', 'bg-red-50 text-red-700', '(vacío)'], 'borrado');
  no(FECHA_ISO_A_LA_VISTA.test(JSON.stringify(t)), 'la tarjeta no lleva ninguna fecha AAAA-MM-DD');
  es(H.tarjetaHistorialCambios('admin', [], etiquetaPrueba), [], 'sin bitácora: lista vacía («Sin cambios registrados todavía.»)');
}
{
  // La ficha arma la tarjeta con tarjetaHistorialCambios y pinta los valores ya convertidos.
  const limpio = fuenteFicha.replace(/\s+/g, ' ');
  si(limpio.includes('const historialCambios = tarjetaHistorialCambios(user.rol, auditRows, labelCampo);'), 'la ficha arma la tarjeta con tarjetaHistorialCambios');
  si(limpio.includes('<td class="pr-2 text-red-600 line-through">{c.antes}</td> <td class="pr-2">→</td> <td class="text-emerald-700">{c.despues}</td>'), 'la tabla pinta los valores ya convertidos');
  no(/parsearCambios|String\(c\.antes\)|r\.a\.cambios/.test(fuenteFicha), 'ya no queda el lector anterior (valores crudos, «true/false»)');
  const pantalla = await fs.readFile('src/pages/activos/[id]/historial.astro', 'utf8');
  si(pantalla.replace(/\s+/g, ' ').includes('construirEventos(historial, { hoy })'), 'la línea de tiempo usa el formato de pantalla');
  const api = await fs.readFile('src/pages/api/activos/[id]/historial.ts', 'utf8');
  si(api.includes('construirEventos(historial, { ...OPCIONES_CSV, hoy })'), 'el CSV usa OPCIONES_CSV (AAAA-MM-DD)');
}

// C2. «Imprimir viñeta» (pedido de WP-B): solo si al equipo le aplica la calibración y tiene alguna.
{
  const bio = { tipo: 'biomedico', rubro: 'biomedico', estado: 'operativo', requiereCalibracion: false, esPatron: false, calibracionNoAplica: false };
  const bio104 = { ...bio, calibracionNoAplica: true };
  es(['admin', 'jefe', 'tecnico'].map((r) => H.puedeImprimirVineta(r, bio104, 1)), [false, false, false], 'BIO-104: «No requiere calibración» con una calibración antigua: sin botón');
  es(['admin', 'jefe', 'tecnico', 'visualizador', 'proveedor', 'solicitante', 'motorista', null].map((r) => H.puedeImprimirVineta(r, bio, 1)),
    [true, true, true, false, false, false, false, false], 'biomédico con calibración: quien registra');
  no(H.puedeImprimirVineta('tecnico', bio, 0), 'sin calibraciones no hay viñeta');
  no(H.puedeImprimirVineta('tecnico', { ...bio, estado: 'baja' }, 3), 'equipo de baja: sin botón');
  no(H.puedeImprimirVineta('jefe', { ...bio, tipo: 'general', rubro: 'equipo_general' }, 2), 'equipo general sin «Requiere calibración» y con calibraciones viejas: sin botón');
  si(H.puedeImprimirVineta('jefe', { ...bio, tipo: 'general', rubro: 'equipo_general', requiereCalibracion: true }, 2), 'equipo general con «Requiere calibración»');
  si(H.puedeImprimirVineta('tecnico', { ...bio, tipo: 'general', rubro: 'equipo_general', esPatron: true }, 1), 'patrón de otra área');
  no(H.puedeImprimirVineta('tecnico', { ...bio, esPatron: true, calibracionNoAplica: true }, 1), 'patrón marcado «No requiere»: tampoco');
  // Misma regla que /calibraciones/vinetas (WP-B): entra el equipo de la población de calibración
  // (aplicaCalibracion sin mirar «No requiere») cuyo estado no es «Sin calibración» ni «No requiere».
  const cal = (id, fecha, proxima) => ({ id, fechaCalibracion: fecha, proximaCalibracion: proxima, resultado: 'conforme', certificadoR2Key: 'k' });
  const reglaPaginaVinetas = (e, calibs) => B.aplicaCalibracion({ ...e, calibracionNoAplica: false })
    && !['sin_calibracion', 'no_aplica'].includes(B.estadoCalibracion(e, calibs, '2026-11-12'));
  const equipos = [bio, bio104, { ...bio, estado: 'baja' }, { ...bio, estado: 'averiado' }, { ...bio, tipo: 'general', rubro: 'equipo_general' },
    { ...bio, tipo: 'general', rubro: 'equipo_general', requiereCalibracion: true }, { ...bio, tipo: 'general', rubro: 'aires', esPatron: true }];
  for (const e of equipos) for (const calibs of [[], [cal(1, '2020-01-01', '2021-01-01')], [cal(1, '2026-01-01', '2027-01-01'), cal(2, '2025-01-01', '2026-01-01')]]) {
    es(H.puedeImprimirVineta('tecnico', e, calibs.length), reglaPaginaVinetas(e, calibs), `misma regla que la página de viñetas (${e.rubro}, ${e.estado}, no requiere ${e.calibracionNoAplica}, ${calibs.length} calibraciones)`);
  }
  // Los dos botones de la ficha (encabezado y sección de calibraciones) usan la misma condición.
  const limpio = fuenteFicha.replace(/\s+/g, ' ');
  si(limpio.includes('const vinetaVisible = puedeImprimirVineta(user.rol, equipoCal, calibracionesRows.length);'), 'la ficha decide con puedeImprimirVineta');
  es((fuenteFicha.match(/calibraciones\/vinetas\?activos=/g) ?? []).length, 2, 'dos enlaces a la viñeta en la ficha');
  es((limpio.match(/\{vinetaVisible && <a href=\{`\/calibraciones\/vinetas\?activos=\$\{a\.id\}`\}/g) ?? []).length, 2, 'y los dos dependen de vinetaVisible');
}

// C3. «No requiere registro sanitario» en el inventario: el registro sanitario no aplica en el
// expediente (MOTIVO_SIN_REGISTRO de biomedico.ts) y la tarjeta de la ficha no dice «Falta».
{
  const docs = [{ categoria: 'manual_operacion' }, { categoria: 'manual_servicio' }, { categoria: 'ficha_tecnica' }, { categoria: 'instalacion' }];
  const sinFlag = B.completitudExpediente({ documentos: docs, hoy: '2026-11-12' });
  es([sinFlag.completo, H.lineasExpediente(sinFlag)], [false, { faltan: ['Registro sanitario'], vencidos: [], noAplica: [] }], 'sin la marca del inventario: «Falta: Registro sanitario»');
  const conFlag = B.completitudExpediente({ documentos: docs, hoy: '2026-11-12', registroSanitarioNoRequiere: 1 });
  es([conFlag.completo, conFlag.cumplidos, H.lineasExpediente(conFlag)], [true, 5, { faltan: [], vencidos: [], noAplica: ['Registro sanitario'] }],
    'con «No requiere registro sanitario»: completo, 5 de 5 y «No aplica: Registro sanitario»');
  es(conFlag.requisitos.find((r) => r.clave === 'registro_sanitario').motivoNoAplica, B.MOTIVO_SIN_REGISTRO, 'con el motivo del inventario');
  const vencido = B.completitudExpediente({ documentos: [...docs, { categoria: 'registro_sanitario', fechaVencimiento: '2025-01-01' }], hoy: '2026-11-12', registroSanitarioNoRequiere: true });
  es(H.lineasExpediente(vencido), { faltan: [], vencidos: [], noAplica: ['Registro sanitario'] }, 'un registro vencido de un equipo que ya no lo requiere no se anuncia como vencido');
  const limpio = fuenteFicha.replace(/\s+/g, ' ');
  si(/completitudExpediente\(\{ documentos: docsExpediente, aceptacionFecha: a\.aceptacionFecha, noAplica: naExpediente, registroSanitarioNoRequiere: a\.registroSanitarioNoRequiere, hoy, \}\)/.test(limpio),
    'la ficha le pasa a completitudExpediente la marca del inventario');
  si(limpio.includes('{lineasExp && lineasExp.noAplica.length > 0 && <p class="text-xs text-slate-500">No aplica: {lineasExp.noAplica.join(", ")}.</p>}'), 'la tarjeta dice qué no aplica');
  es((fuenteFicha.match(/completitudExpediente\(/g) ?? []).length, 1, 'la ficha calcula el expediente en un solo lugar');
  for (const f of ['src/pages/activos/[id]/hoja-vida.astro', 'src/pages/activos/[id]/historial.astro', 'src/lib/historial-equipo.ts', 'src/lib/historial-equipo-db.ts']) {
    no((await fs.readFile(f, 'utf8')).includes('completitudExpediente('), `${f} no calcula el expediente por su cuenta (lo pinta el componente de WP-D)`);
  }
}

// C4. Siguen corregidas las dos cosas de la revisión anterior.
// a) Proveedor, solicitante y motorista no ven la tarjeta «Historial de cambios» (h.19): la bitácora
//    lleva calibraciones, documentos, bajas y pruebas eléctricas, con la copia de lo borrado.
{
  for (const rol of ['proveedor', 'solicitante', 'motorista', null, undefined, 'otro']) {
    es(H.tarjetaHistorialCambios(rol, filasBitacora, etiquetaPrueba), null, `${rol}: sin tarjeta «Historial de cambios»`);
  }
  for (const rol of ['admin', 'jefe', 'tecnico', 'visualizador']) {
    es(H.tarjetaHistorialCambios(rol, filasBitacora, etiquetaPrueba)?.length, filasBitacora.length, `${rol}: con tarjeta`);
  }
  const limpio = fuenteFicha.replace(/\s+/g, ' ');
  si(/const verBio = puedeVerBio\(user\.rol\);/.test(limpio) && /const auditRows = verBio \? await db/.test(limpio), 'para los demás roles la bitácora ni se consulta');
  const i = limpio.indexOf('<h2 class="font-semibold">Historial de cambios</h2>');
  si(i > 0 && limpio.lastIndexOf('{historialCambios && ( <div class="card mt-6 p-5"> <div class="flex flex-wrap items-center justify-between gap-2"> ', i) === i - '{historialCambios && ( <div class="card mt-6 p-5"> <div class="flex flex-wrap items-center justify-between gap-2"> '.length,
    'la tarjeta se pinta solo si historialCambios no es null');
  es((fuenteFicha.match(/Historial de cambios<\/h2>/g) ?? []).length, 1, 'una sola tarjeta «Historial de cambios»');
  es((fuenteFicha.match(/auditRows/g) ?? []).length, 2, 'auditRows solo se consulta y se pasa a tarjetaHistorialCambios (no se pinta directo)');
}
// b) El técnico no recibe el enlace a /incidentes (K-G2: lo abren admin, jefe y visualizador).
{
  es(['admin', 'jefe', 'visualizador', 'tecnico', 'proveedor', 'solicitante', 'motorista', null].map((r) => H.enlaceIncidentes(7, r)),
    ['/incidentes?activo=7', '/incidentes?activo=7', '/incidentes?activo=7', null, null, null, null, null], 'enlace a Incidentes del equipo por rol');
  const eventosTecnico = H.construirEventos(historial).map((e) => H.enlaceEvento(e.link, 'tecnico'));
  no(eventosTecnico.some((l) => l?.startsWith('/incidentes')), 'ningún evento le da al técnico un enlace a Incidentes');
  si(H.construirEventos(historial).map((e) => H.enlaceEvento(e.link, 'visualizador')).includes('/incidentes?activo=7'), 'el visualizador sí lo recibe');
  for (const f of ['src/pages/activos/[id]/hoja-vida.astro', 'src/pages/activos/[id]/historial.astro', 'src/pages/activos/[id].astro']) {
    no((await fs.readFile(f, 'utf8')).includes('/incidentes'), `${f}: ningún enlace a /incidentes escrito a mano (pasan por enlaceIncidentes o enlaceEvento)`);
  }
  for (const f of ['src/pages/activos/[id]/hoja-vida.astro', 'src/pages/activos/[id]/historial.astro']) {
    const s = (await fs.readFile(f, 'utf8')).replace(/\s+/g, ' ');
    si(s.includes('const hrefIncidentes = enlaceIncidentes(a.id, user.rol);') && /\(hrefIncidentes \? <a href=\{hrefIncidentes\}/.test(s), `${f}: el enlace sale de enlaceIncidentes y sin él queda el texto`);
  }
  si((await fs.readFile('src/pages/activos/[id]/historial.astro', 'utf8')).includes('enlaceEvento(e.link, user.rol)'), 'los enlaces de los eventos pasan por enlaceEvento');
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
    INSERT INTO audit_log(entidad,entidad_id,accion,usuario_id,cambios,resumen,created_at) VALUES('activo',1,'update',3,
      '{"version":{"antes":"2.1","despues":"2.2"},"fechaVencimiento":{"antes":null,"despues":"2027-11-12"}}','Documento modificado: manual.pdf — Modificó Versión, Vence','2026-11-12 17:52:00');
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
  es(carga.bitacora.map((b) => b.cambios), [
    [{ campo: 'version', etiqueta: 'version', antes: '2.1', despues: '2.2' }, { campo: 'fechaVencimiento', etiqueta: 'fechaVencimiento', antes: '(vacío)', despues: '2027-11-12' }],
    [{ campo: 'claseRiesgo', etiqueta: 'claseRiesgo', antes: '(vacío)', despues: 'IIb' }],
  ], 'solo la bitácora de este equipo, con los valores como se guardaron');
  es(H.construirEventos(carga, { hoy: '2026-11-12' }).filter((e) => e.tipo === 'bitacora').map((e) => e.detalle),
    ['version: 2.1 → 2.2; fechaVencimiento: (vacío) → 12/11/2027', 'claseRiesgo: (vacío) → IIb'], 'línea de tiempo: el vencimiento en DD/MM/AAAA');
  // La tarjeta de la ficha con la misma consulta que la ficha (columnas elegidas, nombre de quien lo hizo).
  const filasFicha = db.prepare(`SELECT a.accion, a.resumen, a.cambios, a.created_at AS createdAt, u.nombre AS usuario FROM audit_log a
    LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE a.entidad = 'activo' AND a.entidad_id = 1 ORDER BY a.id DESC LIMIT 50`).all().map((r) => ({ ...r }));
  const tarjeta = H.tarjetaHistorialCambios('visualizador', filasFicha, (c) => c);
  es([tarjeta[0].usuario, tarjeta[0].cuando, tarjeta[0].cambios], ['Prueba tecnico', '12/11/2026 11:52',
    [{ etiqueta: 'version', antes: '2.1', despues: '2.2' }, { etiqueta: 'fechaVencimiento', antes: '(vacío)', despues: '12/11/2027' }]], 'ficha: valores a la vista con la base real');
  es(H.tarjetaHistorialCambios('solicitante', filasFicha, (c) => c), null, 'ficha: el solicitante no recibe la tarjeta');
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
  // Ronda 2 (C1): la pantalla pasa los valores a DD/MM/AAAA; el CSV no cambia, sigue en AAAA-MM-DD.
  si(lineas.some((l) => l.startsWith('2026-11-12,11:52,Cambio en el registro,,') && l.includes(',version: 2.1 → 2.2; fechaVencimiento: (vacío) → 2027-11-12,Prueba tecnico,')),
    'CSV: el valor de la bitácora sigue en AAAA-MM-DD');
  no(csv.body.includes('12/11/2027'), 'CSV: ninguna fecha DD/MM/AAAA');
  es(lineas.length - 1, 17, 'diecisiete eventos');
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

// 18. Ronda 2 · las tres páginas pintadas de verdad, por rol: compiladas con @astrojs/compiler,
// empaquetadas con esbuild y pintadas con AstroContainer sobre las migraciones reales (como
// test-bio-componentes). Es lo que vio la prueba de punta a punta, sin navegador.
{
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const astroDir = path.dirname(require.resolve('astro/package.json'));
  const { experimental_AstroContainer } = await import(pathToFileURL(path.join(astroDir, 'dist/container/index.js')).href);
  const paginasAstro = { name: 'paginas-astro', setup(b) {
    b.onResolve({ filter: /^astro\/compiler-runtime$/ }, () => ({ path: path.join(astroDir, 'dist/runtime/compiler/index.js'), external: true }));
    b.onResolve({ filter: /^astro\/runtime\// }, (a) => ({ path: path.join(astroDir, 'dist/runtime', a.path.slice('astro/runtime/'.length)), external: true }));
    // Estilos y módulos del runtime de Cloudflare (correo): no hacen falta para pintar el HTML.
    b.onResolve({ filter: /\.css$|^cloudflare:/ }, (a) => ({ path: a.path, namespace: 'vacio' }));
    b.onLoad({ filter: /.*/, namespace: 'vacio' }, () => ({ contents: 'export default {}; export const env = {};', loader: 'js' }));
    b.onLoad({ filter: /\.astro$/ }, async (a) => {
      const r = await transform(await fs.readFile(a.path, 'utf8'), {
        filename: a.path, internalURL: 'astro/compiler-runtime', renderScript: true, resultScopedSlot: true, resolvePath: async (s) => s,
      });
      assert.equal(r.diagnostics.filter((d) => d.severity === 1).length, 0, JSON.stringify(r.diagnostics));
      return { contents: r.code, loader: 'ts', resolveDir: path.dirname(a.path) };
    });
  } };
  const temporal = await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-bio-historial-'));
  const p = await setupConjuntos({});
  try {
    const salida = path.join(temporal, 'paginas.mjs');
    await build({
      stdin: { contents: [
        "export { default as Ficha } from './src/pages/activos/[id].astro';",
        "export { default as Historial } from './src/pages/activos/[id]/historial.astro';",
        "export { default as Hoja } from './src/pages/activos/[id]/hoja-vida.astro';",
      ].join('\n'), resolveDir: raiz, loader: 'ts' },
      outfile: salida, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [paginasAstro],
    });
    const P = await import(pathToFileURL(salida).href);
    p.faults.enforceColumnLimit = true;
    p.sqlite.exec(`
      INSERT INTO sucursales(id,nombre) VALUES(1,'Sede Uno');
      INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo) VALUES(1,1,'UCI','area');
      INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,registro_sanitario,registro_sanitario_vencimiento) VALUES(1,'BIO-001','Monitor','biomedico','biomedico',1,'RS-1','2028-10-12');
      INSERT INTO activos(id,codigo,nombre,tipo,rubro,serial,es_patron,requiere_calibracion) VALUES(2,'PAT-001','Simulador','biomedico','biomedico','SP-9',1,1);
      INSERT INTO calibraciones(id,activo_id,fecha_calibracion,proxima_calibracion,certificado_r2_key,resultado,usuario_id) VALUES(20,2,'2025-12-01','2026-12-01','k/p.pdf','conforme',1);
      INSERT INTO calibraciones(id,activo_id,fecha_calibracion,proxima_calibracion,numero_certificado,patron_activo_id,resultado,usuario_id) VALUES(21,1,'2026-05-10','2027-05-10','C-77',2,'conforme',1);
      INSERT INTO ordenes(id,titulo,tipo,estado,activo_id,creado_por,created_at) VALUES(10,'No enciende','correctivo','cerrada',1,2,'2026-05-11 01:30:00');
      INSERT INTO orden_incidentes(orden_id,numero_reporte,fecha_notificacion,marcado_por) VALUES(10,NULL,'2026-05-12',1);
      INSERT INTO audit_log(entidad,entidad_id,accion,usuario_id,cambios,resumen,created_at) VALUES
        ('activo',1,'update',3,'{"version":{"antes":"2.1","despues":"2.2"},"fechaVencimiento":{"antes":null,"despues":"2027-11-12"}}','Documento modificado: manual.pdf — Modificó Versión, Vence','2026-11-12 17:52:00'),
        ('activo',1,'update',2,'{"registroSanitarioVencimiento":{"antes":"2028-10-12","despues":"2026-12-02"},"registroSanitarioNoRequiere":{"antes":false,"despues":true}}',NULL,'2026-11-12 18:00:00');
      INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,calibracion_no_aplica,calibracion_no_aplica_motivo) VALUES(104,'BIO-104','Termómetro','biomedico','biomedico',1,1,'Se verifica contra un patrón interno');
      INSERT INTO calibraciones(id,activo_id,fecha_calibracion,proxima_calibracion,certificado_r2_key,resultado,usuario_id) VALUES(104,104,'2024-01-10','2025-01-10','k/104.pdf','conforme',1);
      INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,registro_sanitario_no_requiere) VALUES(106,'BIO-106','Lámpara de examen','biomedico','biomedico',1,1),(107,'BIO-107','Lámpara con registro','biomedico','biomedico',1,0);
      INSERT INTO activo_documentos(activo_id,nombre,content_type,tamano,r2_key,categoria,usuario_id) VALUES
        (106,'mo.pdf','application/pdf',10,'k/106a','manual_operacion',1),(106,'ms.pdf','application/pdf',10,'k/106b','manual_servicio',1),
        (106,'ft.pdf','application/pdf',10,'k/106c','ficha_tecnica',1),(106,'in.pdf','application/pdf',10,'k/106d','instalacion',1),
        (107,'mo.pdf','application/pdf',10,'k/107a','manual_operacion',1),(107,'ms.pdf','application/pdf',10,'k/107b','manual_servicio',1),
        (107,'ft.pdf','application/pdf',10,'k/107c','ficha_tecnica',1),(107,'in.pdf','application/pdf',10,'k/107d','instalacion',1);
    `);
    const contenedor = await experimental_AstroContainer.create();
    const IDS = { admin: 1, jefe: 2, tecnico: 3, visualizador: 4, solicitante: 5, motorista: 6, proveedor: 7 };
    const pintar = async (Pagina, ruta, id, rol) => {
      const res = await contenedor.renderToResponse(Pagina, {
        partial: false, request: new Request(`https://local.test${ruta}`), params: { id: String(id) },
        locals: { user: { id: IDS[rol], nombre: `Prueba ${rol}`, rol }, runtime: { env: { DB: p.DB } } },
      });
      const doc = new JSDOM(res.status === 200 ? await res.text() : '').window.document;
      doc.querySelectorAll('script, style, template').forEach((e) => e.remove());
      return { status: res.status, location: res.headers.get('location'), doc, texto: (doc.body?.textContent ?? '').replace(/\s+/g, ' ') };
    };
    const tarjetaCambios = (doc) => [...doc.querySelectorAll('h2')].find((x) => /Historial de cambios/.test(x.textContent))?.closest('.card') ?? null;
    const enlaces = (doc, prefijo) => doc.querySelectorAll(`a[href^="${prefijo}"]`).length;
    const fechasCrudas = (texto) => [...texto.matchAll(new RegExp(FECHA_ISO_A_LA_VISTA.source, 'g'))].map((m) => texto.slice(Math.max(0, m.index - 40), m.index + 12));

    for (const rol of ['admin', 'jefe', 'tecnico', 'visualizador']) {
      // C1 y C4: la tarjeta con los valores a la vista; ninguna fecha AAAA-MM-DD en la ficha, el historial ni la hoja.
      const ficha = await pintar(P.Ficha, '/activos/1?area=biomedico', 1, rol);
      const t = tarjetaCambios(ficha.doc)?.textContent.replace(/\s+/g, ' ') ?? '';
      si(ficha.status === 200 && t.includes('Vence: (vacío) → 12/11/2027') && t.includes('Vencimiento del registro sanitario: 12/10/2028 → 02/12/2026'), `${rol}: «Historial de cambios» con las fechas en DD/MM/AAAA`);
      si(t.includes('No requiere registro sanitario: No → Sí') && t.includes('12/11/2026 11:52'), `${rol}: «Sí/No» y la hora de El Salvador`);
      es(fechasCrudas(ficha.texto), [], `${rol}: ninguna fecha AAAA-MM-DD a la vista en la ficha`);
      const hist = await pintar(P.Historial, '/activos/1/historial?area=biomedico', 1, rol);
      si(hist.status === 200 && hist.texto.includes('Vence: (vacío) → 12/11/2027'), `${rol}: la línea de tiempo con el vencimiento en DD/MM/AAAA`);
      es(fechasCrudas(hist.texto), [], `${rol}: ninguna fecha AAAA-MM-DD a la vista en el historial`);
      const hoja = await pintar(P.Hoja, '/activos/1/hoja-vida?area=biomedico', 1, rol);
      es([hoja.status, fechasCrudas(hoja.texto)], [200, []], `${rol}: ninguna fecha AAAA-MM-DD a la vista en la hoja de vida`);
      // C4: Incidentes solo para admin, jefe y visualizador; el técnico ve el texto sin enlace.
      const conEnlace = rol !== 'tecnico';
      es([enlaces(hist.doc, '/incidentes') > 0, enlaces(hoja.doc, '/incidentes') > 0], [conEnlace, conEnlace], `${rol}: enlace a /incidentes en el historial y la hoja de vida: ${conEnlace ? 'sí' : 'no'}`);
      si(hist.texto.includes('Incidente · reporte de Calidad pendiente · aviso 12/05/2026') && hoja.texto.includes('Incidente · reporte de Calidad pendiente · aviso 12/05/2026'), `${rol}: el incidente se lee igual, con o sin enlace`);
      // C2: la viñeta solo para quien registra y en un equipo al que le aplica la calibración.
      es(enlaces(ficha.doc, '/calibraciones/vinetas'), rol === 'visualizador' ? 0 : 2, `${rol}: «Imprimir viñeta» del monitor (encabezado y calibraciones)`);
      const b104 = await pintar(P.Ficha, '/activos/104?area=biomedico', 104, rol);
      es([b104.status, enlaces(b104.doc, '/calibraciones/vinetas')], [200, 0], `${rol}: BIO-104 («No requiere calibración» con una calibración antigua) sin «Imprimir viñeta»`);
    }
    // C4: proveedor, solicitante y motorista no ven la tarjeta; el historial y la hoja de vida los devuelven al inicio.
    for (const rol of ['proveedor', 'solicitante', 'motorista']) {
      const ficha = await pintar(P.Ficha, '/activos/1?area=biomedico', 1, rol);
      es([ficha.status, tarjetaCambios(ficha.doc), ficha.texto.includes('Documento modificado')], [200, null, false], `${rol}: la ficha abre sin «Historial de cambios» ni la bitácora`);
      es(enlaces(ficha.doc, '/calibraciones/vinetas') + enlaces(ficha.doc, '/incidentes'), 0, `${rol}: sin viñeta ni Incidentes`);
      for (const [Pagina, ruta] of [[P.Historial, '/activos/1/historial?area=biomedico'], [P.Hoja, '/activos/1/hoja-vida?area=biomedico']]) {
        const r = await pintar(Pagina, ruta, 1, rol);
        es([r.status, r.location], [302, '/'], `${rol}: ${ruta.split('?')[0]} lo devuelve al inicio`);
      }
    }
    // C3: «No requiere registro sanitario» en el inventario: la tarjeta del expediente no dice «Falta».
    const resumen = async (id, codigo) => (await pintar(P.Ficha, `/activos/${id}?area=biomedico`, id, 'visualizador')).doc.querySelector('#resumen-jci')?.textContent.replace(/\s+/g, ' ') ?? `sin resumen en ${codigo}`;
    const r106 = await resumen(106, 'BIO-106');
    si(r106.includes('Expediente técnico Completo 5 de 5 requisitos No aplica: Registro sanitario.') && !r106.includes('Falta'), 'BIO-106 (no requiere registro): «Completo · 5 de 5 · No aplica: Registro sanitario»');
    const r107 = await resumen(107, 'BIO-107');
    si(r107.includes('Expediente técnico Incompleto 4 de 5 requisitos Falta: Registro sanitario.'), 'BIO-107 (sí lo requiere): «Falta: Registro sanitario»');
    si(Math.max(...p.queries.map((q) => q.columns.length)) <= 100, 'las páginas no piden más de 100 columnas (D1)');
  } finally {
    await p.close();
    await fs.rm(temporal, { recursive: true, force: true });
  }
}

console.log(`PASS test-bio-historial: ${n} casos`);
