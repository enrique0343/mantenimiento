// Fase 59 · WP-E: frecuencias de las rutinas, proyección del calendario anual y CSV
// del plan (src/lib/frecuencias.ts y src/lib/plan-anual.ts). Sin red ni base.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const cargar = async (entrada) => {
  const out = await build({ entryPoints: [entrada], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};
const F = await cargar('src/lib/frecuencias.ts');
const P = await cargar('src/lib/plan-anual.ts');
const B = await cargar('src/lib/biomedico.ts');
// La validación de la API de rutinas (K-E1) lleva zod: se empaqueta para node.
const salidaV = await build({ stdin: { contents: "export * from './src/lib/validacion-api'; export { z } from 'zod';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const V = await import(`data:text/javascript;base64,${Buffer.from(salidaV.outputFiles[0].text).toString('base64')}`);

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };

// ── Frecuencias ─────────────────────────────────────────────────────────────
es(F.FRECUENCIAS.some((f) => f.value === 'turno'), true, 'FRECUENCIAS conserva «turno» (registros viejos; el formulario filtra)');
es(B.FRECUENCIAS_RUTINA_EQUIPO.includes('turno'), false, 'las rutinas de equipo no ofrecen «Por turno»');
es(B.FRECUENCIAS_RUTINA_EQUIPO.includes('cuatrimestral'), true, 'las rutinas de equipo ofrecen «Cuatrimestral»');
es(B.etiquetaFrecuencia('turno'), 'Por turno', 'etiqueta de turno');
es(B.etiquetaFrecuencia('cuatrimestral'), 'Cuatrimestral', 'etiqueta de cuatrimestral');
es(F.abrevFrecuencia('cuatrimestral'), '4M', 'abreviatura cuatrimestral');
es(F.abrevFrecuencia('semestral'), '6M', 'abreviatura semestral');
es(F.abrevFrecuencia('turno'), 'T', 'abreviatura turno');
es(F.abrevFrecuencia('otra'), '?', 'desconocida');
es(F.abrevFrecuencia(null), '?', 'null');
es(F.MENSAJE_FRECUENCIA_TURNO, '«Por turno» no se usa en rutinas de equipo. Elige «Diaria» o registra la revisión en la ronda de turno.', 'mensaje de turno en tú');
es(F.siguienteFecha('2026-01-31', 'cuatrimestral'), '2026-05-31', 'siguienteFecha no cambia (la usa el cierre de órdenes)');

// ── K-E1: mensajes de la API de rutinas (texto en español, nunca el objeto de zod) ──
const esquema = V.z.object({
  frecuencia: V.frecuenciaRutinaSchema,
  proximaFecha: V.fechaIsoSchema('Fecha no válida.').optional(),
  horas: V.z.number().positive().optional(),
});
const mensaje = (body) => { const r = esquema.safeParse(body, { errorMap: V.errorMapEs }); return r.success ? 'ok' : r.error.issues[0].message; };
es(mensaje({ frecuencia: 'turno' }), F.MENSAJE_FRECUENCIA_TURNO, '«turno» → su mensaje propio (el del campo manda sobre el general)');
es(mensaje({ frecuencia: 'quinquenal' }), 'Elige una frecuencia de la lista.', 'otro valor → elegir de la lista');
es(mensaje({}), 'Elige una frecuencia de la lista.', 'sin frecuencia');
es(mensaje({ frecuencia: 'cuatrimestral' }), 'ok', 'cuatrimestral se acepta');
es(mensaje({ frecuencia: 'mensual', proximaFecha: '2026-02-30' }), 'Fecha no válida.', 'fecha imposible');
es(mensaje({ frecuencia: 'mensual', horas: 'dos' }), 'Revisa «horas»: el valor no es válido.', 'campo sin mensaje propio: genérico en español');
es(mensaje(null), 'Revisa los datos enviados: el valor no es válido.', 'cuerpo vacío');
es(V.enTandas([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]], 'tandas para el límite de parámetros de D1');

// ── Proyección del año ──────────────────────────────────────────────────────
const anio = (ancla, frecuencia, a) => P.calendarioAnual(ancla, frecuencia, a);
let c = anio('2026-03-15', 'mensual', 2026);
es(c.veces, 10, 'mensual desde 15/03/2026: 10 fechas');
es(c.fechas[0], '2026-03-15', 'empieza en la próxima fecha');
es(c.fechas.at(-1), '2026-12-15', 'termina en diciembre');
es(c.porMes, [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 'los meses antes de la próxima fecha quedan vacíos');
es(anio('2026-01-20', 'cuatrimestral', 2026).fechas, ['2026-01-20', '2026-05-20', '2026-09-20'], 'cuatrimestral: 3 veces en el año');
es(anio('2025-06-01', 'anual', 2026).fechas, ['2026-06-01'], 'anual desde 2025 cae en 2026');
c = anio('2026-01-31', 'mensual', 2026);
es(c.veces, 12, 'mensual desde 31/01: 12 fechas');
es(c.fechas.slice(0, 4), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'], 'fin de mes ajustado sin correr el día');
es(c.fechas.at(-1), '2026-12-31', '31/12');
es(anio('2024-02-29', 'anual', 2025).fechas, ['2025-02-28'], 'anual desde 29/02/2024: 28/02/2025');
es(anio('2024-02-29', 'anual', 2028).fechas, ['2028-02-29'], 'y vuelve al 29/02 en 2028');
es(anio('2026-12-28', 'semanal', 2026).veces, 1, 'semanal desde 28/12/2026: 1 en 2026');
c = anio('2026-12-28', 'semanal', 2027);
es([c.veces, c.fechas[0]], [52, '2027-01-04'], 'y 52 en 2027 desde el 04/01');
es(anio('2026-01-01', 'quincenal', 2026).veces, 25, 'quincenal desde 01/01/2026: 25');
es(anio('2024-01-01', 'diaria', 2026).veces, 365, 'diaria desde 2024: 365 en 2026');
es(anio('2024-01-01', 'diaria', 2028).veces, 366, 'diaria en año bisiesto: 366');
es(anio('2027-03-01', 'mensual', 2026).fechas, [], 'ancla posterior al año: nada');
es(anio('2026-02-30', 'mensual', 2026).fechas, [], 'ancla no válida: nada');
es(anio('15/03/2026', 'mensual', 2026).fechas, [], 'ancla en otro formato: nada');
es(anio('2026-03-15', 'quinquenal', 2026).fechas, [], 'frecuencia desconocida: nada');
es(anio('2026-01-05', 'bimestral', 2026).fechas, ['2026-01-05', '2026-03-05', '2026-05-05', '2026-07-05', '2026-09-05', '2026-11-05'], 'bimestral');
es(anio('2000-01-01', 'diaria', 2026).veces, 365, 'una ancla de hace años no agota las vueltas');
es(F.proyectarFechas('2026-01-01', 'diaria', '2026-01-01', '2027-01-01', 10).length, 10, 'tope de fechas');
es(F.proyectarFechas('2026-11-12', 'semanal', '2026-11-01', '2026-12-01'), ['2026-11-12', '2026-11-19', '2026-11-26'], 'rango libre [desde, hasta)');

// ── Celdas, horas y modalidad ───────────────────────────────────────────────
es(P.celdaMes([]), '', 'sin fechas en el mes');
es(P.celdaMes(['2026-03-05']), '5', 'una fecha: el día');
es(P.celdaMes(['2026-03-05', '2026-03-19']), '5 · 19', 'dos fechas');
es(P.celdaMes(['2026-03-05', '2026-03-12', '2026-03-19']), '3×', 'más de dos: veces');
es(P.fechasDelMes(['2026-03-05', '2026-04-02', '2026-03-19'], 3), ['2026-03-05', '2026-03-19'], 'fechas de un mes');
es(P.horasEnAnio(1.5, 4), 6, 'horas del año');
es(P.horasEnAnio(0.35, 3), 1.1, 'un decimal');
es(P.horasEnAnio(null, 4), null, 'sin horas estimadas');
es(P.modalidadTexto('interno', 'Proveedor X', null), { texto: 'Personal propio', faltaProveedor: false }, 'interno');
es(P.modalidadTexto('contratado', 'Biomédica SA', 'CT-001'), { texto: 'Empresa externa: Biomédica SA (CT-001)', faltaProveedor: false }, 'contratado con contrato');
es(P.modalidadTexto('mixto', 'Biomédica SA', null), { texto: 'Mixto: Biomédica SA', faltaProveedor: false }, 'mixto');
es(P.modalidadTexto('contratado', null, null), { texto: 'Empresa externa (falta proveedor)', faltaProveedor: true }, 'externo sin proveedor');
es(P.modalidadTexto('mixto', '  ', 'CT-002'), { texto: 'Mixto (falta proveedor)', faltaProveedor: true }, 'mixto sin proveedor');

// ── Aprobación vigente ──────────────────────────────────────────────────────
const ap = (id, fecha, extra = {}) => ({ id, anio: 2026, area: 'biomedico', fechaAprobacion: fecha, anuladaEn: null, ...extra });
const filas = [
  ap(1, '2026-01-10'),
  ap(2, '2026-02-01', { anuladaEn: '2026-02-05T15:00:00Z' }),
  ap(3, '2026-01-20'),
  ap(4, '2026-01-20'),
  ap(5, '2026-03-01', { area: 'general' }),
  ap(6, '2026-04-01', { anio: 2025 }),
];
es(P.aprobacionVigente(filas, 2026, 'biomedico')?.id, 4, 'ignora la anulada y desempata por id');
es(P.aprobacionVigente(filas, 2026, 'general')?.id, 5, 'por área');
es(P.aprobacionVigente(filas, 2027, 'biomedico'), null, 'sin aprobación del año');
es(P.aprobacionVigente([ap(1, '2026-01-10', { anuladaEn: '2026-01-11' })], 2026, 'biomedico'), null, 'solo anuladas: ninguna');

// ── CSV ─────────────────────────────────────────────────────────────────────
const rutina = (extra) => ({
  tipo: 'equipo', id: 1, activoId: 9, area: 'biomedico', grupo: 'Soporte de vida', codigo: 'BIO-001', nombre: 'Ventilador',
  sede: 'Sede central', sedeId: 1, ubicacion: 'UCI', rutina: 'Preventivo', frecuencia: 'mensual', proximaFecha: '2026-03-15',
  horasEstimadas: 1.5, prioridad: 'alta', modalidad: 'contratado', proveedor: 'Biomédica SA', contrato: 'CT-001',
  contratoVigencia: null, responsable: 'Ana', critico: true, ...extra,
});
const columnas = P.columnasCsvPlan(2026);
es(columnas.length, 30, '18 columnas de datos + 12 meses');
es(columnas.filter((col) => P.MESES_CORTOS.includes(col.label)).length, 12, '12 columnas de mes');
es(columnas.find((col) => col.key === 'veces').label, 'Veces 2026', 'veces del año');
let [fila] = P.filasCsvPlan([rutina({})], 2026);
es([fila.frecuencia, fila.modalidad, fila.prioridad, fila.proxima], ['Mensual', 'Empresa externa', 'Alta', '2026-03-15'], 'etiquetas y fecha AAAA-MM-DD');
es([fila.veces, fila.horasAnio, fila.m1, fila.m3, fila.m12], [10, 15, 0, 1, 1], 'veces, horas y meses');
es(fila.fechas.split('; ')[0], '2026-03-15', 'fechas proyectadas en AAAA-MM-DD');
[fila] = P.filasCsvPlan([rutina({ frecuencia: 'semanal', proximaFecha: '2026-01-05' })], 2026);
es([fila.veces, fila.fechas], [52, 'Ver columnas por mes'], 'más de 24 fechas: remite a las columnas por mes');
[fila] = P.filasCsvPlan([rutina({ tipo: 'actividad', modalidad: 'interno', horasEstimadas: null, area: 'infraestructura' })], 2026);
es([fila.tipo, fila.area, fila.modalidad, fila.horasAnio], ['Actividad', 'Infraestructura', 'Personal propio', null], 'actividad sin horas');

console.log(`PASS test-bio-plan-anual: ${n} casos; frecuencias, calendario anual sin deriva de fin de mes, modalidad, aprobación vigente y CSV.`);
