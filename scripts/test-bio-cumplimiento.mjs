// Fase 59 · WP-E: indicadores del panel de cumplimiento y vencimientos del resumen
// diario (src/lib/cumplimiento-reglas.ts). Reglas de cada dueño en biomedico.ts.
// Sin red ni base.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const cargar = async (entrada) => {
  const out = await build({ entryPoints: [entrada], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};
const C = await cargar('src/lib/cumplimiento-reglas.ts');
const B = await cargar('src/lib/biomedico.ts');

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };

const hoy = '2026-11-12';
let id = 0;
const equipo = (extra = {}) => ({
  id: ++id, codigo: `BIO-${String(id).padStart(3, '0')}`, nombre: `Equipo ${id}`, rubro: 'biomedico', tipo: 'biomedico', estado: 'operativo',
  marca: 'Marca', modelo: 'Modelo', serial: `S${id}`, ubicacionId: 1, ubicacion: 'UCI', sede: 'Central', sedeId: 1,
  subcategoria: 'diagnostico', criticidadOperacional: 'media', claseRiesgo: 'IIa', centroCostoId: 1,
  registroSanitario: 'RS-1', registroSanitarioNoRequiere: false, registroSanitarioVencimiento: '2030-01-01',
  requiereCalibracion: false, esPatron: false, calibracionNoAplica: false, aceptacionFecha: '2026-01-01', ...extra,
});
const datos = (extra = {}) => ({
  hoy, equipos: [], calibraciones: [], documentos: [], expedienteNa: [], planes: [], laboratorios: [], licencias: [],
  pruebas: [], capacitaciones: [], alertas: [], bajas: [], ...extra,
});
const ind = (r, clave) => r.indicadores.find((i) => i.clave === clave);
const hall = (r, clave) => r.hallazgos.filter((h) => h.indicador === clave);
const cal = (activoId, fecha, proxima, extra = {}) => ({ id: ++id, activoId, fechaCalibracion: fecha, proximaCalibracion: proxima, resultado: 'conforme', certificadoR2Key: 'k', ...extra });

// ── Universo vacío y bajas ──────────────────────────────────────────────────
let r = C.armarCumplimiento(datos());
es(r.indicadores.length, 14, 'catorce indicadores');
es(r.indicadores.every((i) => i.pct === null && i.fallas === 0), true, 'universo vacío: pct null');
es(r.indicadores.map((i) => i.clave), C.INDICADORES.map((i) => i.clave), 'en el orden del panel');
const deBaja = equipo({ estado: 'baja', claseRiesgo: null, marca: null });
r = C.armarCumplimiento(datos({ equipos: [deBaja] }));
es([ind(r, 'sin_plan').universo, ind(r, 'inventario').universo, ind(r, 'clase_riesgo').fallas], [0, 0, 0], 'las bajas no cuentan en el universo');
es(ind(r, 'baja_sin_acta').universo, 1, 'pero sí en «bajas sin acta»');

// ── Plan, inventario, clase y registro sanitario ────────────────────────────
const e1 = equipo({ criticidadOperacional: 'alta' });
const e2 = equipo({ marca: ' ', centroCostoId: null, claseRiesgo: null });
const e3 = equipo({ registroSanitario: null });
const e4 = equipo({ registroSanitarioVencimiento: '2026-11-11' });
const e5 = equipo({ registroSanitarioVencimiento: '2027-02-10' });
const e6 = equipo({ registroSanitario: null, registroSanitarioNoRequiere: true });
r = C.armarCumplimiento(datos({
  equipos: [e1, e2, e3, e4, e5, e6],
  planes: [{ activoId: e2.id, proximaFecha: '2026-11-12' }, { activoId: e2.id, proximaFecha: '2027-01-01' }, { activoId: e3.id, proximaFecha: '2026-12-01' }, { activoId: e4.id, proximaFecha: '2026-12-01' }, { activoId: e5.id, proximaFecha: '2026-12-01' }, { activoId: e6.id, proximaFecha: '2026-12-01' }],
}));
es(hall(r, 'sin_plan').map((h) => [h.codigo, h.detalle]), [[e1.codigo, 'Sin rutina activa · criticidad alta']], 'sin rutina activa');
es([ind(r, 'preventivo_vencido').universo, hall(r, 'preventivo_vencido').map((h) => h.detalle)], [5, ['Rutina vencida desde 12/11/2026']], 'una próxima fecha de hoy ya es vencida');
es(hall(r, 'inventario').map((h) => [h.codigo, h.detalle]), [
  [e2.codigo, 'Falta: marca, centro de costo, clase de riesgo'], [e3.codigo, 'Falta: registro sanitario'],
], 'inventario incompleto (WP-A); «no requiere registro» no falta');
es(hall(r, 'clase_riesgo').map((h) => h.codigo), [e2.codigo], 'sin clase de riesgo');
es(hall(r, 'registro_sanitario').map((h) => [h.nivel, h.detalle]), [
  ['falla', 'Venció el 11/11/2026'], ['falla', 'Sin número de registro sanitario'], ['aviso', 'Vence el 10/02/2027 (en 90 días)'],
], 'registro: sin número y vencido fallan; a 90 días avisa; «no requiere» no cuenta');
es([ind(r, 'registro_sanitario').fallas, ind(r, 'registro_sanitario').avisos, ind(r, 'registro_sanitario').pct], [2, 1, 67], 'pct = (universo − fallas) / universo');

// ── Expediente (regla de WP-D) ──────────────────────────────────────────────
const ex1 = equipo({ aceptacionFecha: null });
const ex2 = equipo();
const docs = ['manual_operacion', 'manual_servicio', 'ficha_tecnica', 'registro_sanitario'].map((categoria) => ({ activoId: ex2.id, categoria, fechaVencimiento: null }));
r = C.armarCumplimiento(datos({ equipos: [ex1, ex2], documentos: docs, expedienteNa: [{ activoId: ex1.id, requisito: 'registro_sanitario', motivo: 'No aplica' }] }));
es(hall(r, 'expediente').map((h) => [h.codigo, h.detalle]), [[ex1.codigo, 'Falta: Manual de operación, Manual de mantenimiento o servicio, Ficha técnica o especificaciones, Acta de instalación o aceptación']], 'expediente incompleto con «No aplica»');
es(ind(r, 'expediente').pct, 50, 'pct de completos');

// ── Calibración = regla de WP-B (incluye no biomédicos con casilla y patrones) ─
const c1 = equipo();                                                        // sin calibración
const c2 = equipo({ rubro: 'equipo_general', tipo: 'general', requiereCalibracion: true }); // balanza al día
const c3 = equipo({ rubro: 'equipo_general', tipo: 'general' });            // no requiere
const c4 = equipo({ esPatron: true, rubro: 'equipo_general', tipo: 'general' }); // patrón vencido
const c5 = equipo({ calibracionNoAplica: true });                           // «no requiere»
const c6 = equipo();                                                        // por vencer
const c7 = equipo();                                                        // sin certificado
const c8 = equipo({ estado: 'baja' });                                      // baja: fuera
const calibs = [
  cal(c2.id, '2026-06-01', '2027-06-01'),
  cal(c4.id, '2025-10-01', '2026-10-01'),
  cal(c6.id, '2025-12-01', '2026-12-01'),
  cal(c7.id, '2026-05-01', '2027-05-01', { certificadoR2Key: null }),
  cal(c8.id, '2020-01-01', '2021-01-01'),
];
const equiposCal = [c1, c2, c3, c4, c5, c6, c7, c8];
r = C.armarCumplimiento(datos({ equipos: equiposCal, calibraciones: calibs }));
const esperado = equiposCal
  .map((e) => ({ e, estado: B.estadoCalibracion(e, calibs.filter((x) => x.activoId === e.id), hoy) }))
  .filter((x) => x.estado !== 'no_aplica');
es(ind(r, 'calibracion').universo, esperado.length, 'mismo universo que estadoCalibracion (aplicaCalibracion)');
es(ind(r, 'calibracion').fallas, esperado.filter((x) => !B.estaAlDia(x.estado)).length, 'fallas = no al día');
es(ind(r, 'calibracion').avisos, esperado.filter((x) => x.estado === 'por_vencer').length, 'avisos = por vencer');
es(hall(r, 'calibracion').map((h) => [h.codigo, h.nivel, h.detalle]), [
  [c4.codigo, 'falla', 'Vencida · venció el 01/10/2026'],
  [c7.codigo, 'falla', 'Sin certificado · calibrada el 01/05/2026'],
  [c1.codigo, 'falla', 'Sin calibración registrada'],
  [c6.codigo, 'aviso', 'Por vencer · vence el 01/12/2026 (en 19 días)'],
], 'detalle con la etiqueta de WP-B y la fecha');
es(hall(r, 'patron').map((h) => h.codigo), [c4.codigo], 'el patrón vencido también sale en «patrón»');
const patronNoRequiere = equipo({ esPatron: true, calibracionNoAplica: true });
es(ind(C.armarCumplimiento(datos({ equipos: [c4, patronNoRequiere], calibraciones: calibs })), 'patron').universo, 1, 'un patrón «no requiere calibración» no entra en el universo');
es([ind(r, 'patron').universo, ind(r, 'calibracion').pct], [1, 40], 'universo de patrones y pct de calibración');
es(hall(r, 'calibracion')[0].enlace, `/activos/${c4.id}#calibraciones`, 'enlace a la ficha, sección calibraciones');

// ── Laboratorios ────────────────────────────────────────────────────────────
const lab = (extra) => ({ id: ++id, nombre: `Lab ${id}`, esLaboratorioAcreditado: true, acreditacionOrgano: 'OSA', acreditacionNumero: `LC-${id}`, acreditacionVigencia: null, ...extra });
r = C.armarCumplimiento(datos({ laboratorios: [lab({}), lab({ acreditacionVigencia: '2026-12-27' }), lab({ acreditacionVigencia: '2026-11-01' }), lab({ acreditacionVigencia: '2028-01-01' })] }));
es(hall(r, 'laboratorio').map((h) => [h.nivel, h.detalle]), [
  ['falla', 'Acreditación venció el 01/11/2026'], ['falla', 'Acreditación sin vigencia registrada'], ['aviso', 'Acreditación vence el 27/12/2026 (en 45 días)'],
], 'sin vigencia = falla, a 45 días = aviso');
es(ind(r, 'laboratorio').universo, 4, 'universo de laboratorios');

// ── Licencias ───────────────────────────────────────────────────────────────
const lic = (extra) => ({ id: ++id, nombre: `Licencia ${id}`, numero: `L-${id}`, entidad: 'srs', estado: 'activa', fechaVencimiento: '2030-01-01', reemplazaAId: null, sede: 'Central', equipoCodigo: null, ...extra });
const vencida = lic({ fechaVencimiento: '2026-11-01' });
r = C.armarCumplimiento(datos({ licencias: [
  vencida, lic({ estado: 'en_tramite', fechaVencimiento: null, reemplazaAId: vencida.id }),
  lic({ fechaVencimiento: '2027-02-09', equipoCodigo: 'RX-01' }), lic({ estado: 'reemplazada', fechaVencimiento: '2020-01-01' }), lic({ fechaVencimiento: null }),
] }));
es(hall(r, 'licencia').map((h) => [h.nivel, h.detalle]), [
  ['falla', 'Venció el 01/11/2026 · renovación en trámite'], ['aviso', 'Vence el 09/02/2027 (en 89 días)'],
], 'vencida con renovación en trámite; aviso a 90 días; reemplazada y «no vence» no cuentan');
es(ind(r, 'licencia').universo, 3, 'universo: licencias activas');
es(hall(r, 'licencia')[1].nombre.endsWith('(RX-01)'), true, 'licencia de un equipo');

// ── Seguridad eléctrica (Clase III, regla de WP-F) ──────────────────────────
const s1 = equipo({ claseRiesgo: 'III' });
const s2 = equipo({ claseRiesgo: 'III' });
const s3 = equipo({ claseRiesgo: 'III' });
const s4 = equipo({ claseRiesgo: 'IIb' });
r = C.armarCumplimiento(datos({
  equipos: [s1, s2, s3, s4],
  pruebas: [
    { id: 1, activoId: s2.id, fecha: '2025-11-01', resultado: 'pasa', proximaFecha: '2026-11-30' },
    { id: 2, activoId: s3.id, fecha: '2026-01-10', resultado: 'pasa', proximaFecha: '2027-01-10' },
    { id: 3, activoId: s3.id, fecha: '2026-03-10', resultado: 'no_pasa', proximaFecha: '2027-03-10' },
  ],
}));
es(hall(r, 'seguridad_electrica').map((h) => [h.codigo, h.nivel, h.detalle]), [
  [s3.codigo, 'falla', 'No pasó · prueba del 10/03/2026'], [s1.codigo, 'falla', 'Sin prueba registrada'], [s2.codigo, 'aviso', 'Por vencer · vence el 30/11/2026 (en 18 días)'],
], 'Clase III sin prueba = falla; vale la última prueba; los de otra clase no cuentan');
es(ind(r, 'seguridad_electrica').universo, 3, 'universo Clase III');

// ── Capacitación de equipos críticos ────────────────────────────────────────
const k1 = equipo({ subcategoria: 'soporte_vida' });
const k2 = equipo({ criticidadOperacional: 'alta' });
const k3 = equipo({ claseRiesgo: 'III' });
const k4 = equipo();
r = C.armarCumplimiento(datos({
  equipos: [k1, k2, k3, k4],
  capacitaciones: [{ activoId: k1.id, fecha: '2024-10-12' }, { activoId: k2.id, fecha: '2025-01-15' }, { activoId: k4.id, fecha: '2020-01-01' }],
}));
es(hall(r, 'capacitacion').map((h) => [h.codigo, h.detalle]), [[k1.codigo, 'Última: 12/10/2024'], [k3.codigo, 'Sin capacitación registrada']], 'crítico con capacitación de hace 25 meses = falla');
es([ind(r, 'capacitacion').universo, ind(r, 'capacitacion').pct], [3, 33], 'universo esCritico (soporte de vida, criticidad alta o clase III)');

// ── Alertas ─────────────────────────────────────────────────────────────────
const alerta = (extra) => ({ id: ++id, titulo: `Alerta ${id}`, tipo: 'alerta', estado: 'cerrada', aplicabilidad: 'aplica', fechaAlerta: '2026-11-02', referencia: null, ...extra });
const a1 = alerta({ estado: 'abierta', aplicabilidad: 'pendiente', referencia: 'FSN-1' });
r = C.armarCumplimiento(datos({ alertas: [a1, alerta({ estado: 'en_proceso', fechaAlerta: '2026-11-11' }), alerta({}), alerta({ aplicabilidad: 'pendiente' })] }));
es(hall(r, 'alerta').map((h) => h.detalle), ['Abierta hace 10 días · Sin análisis', 'Cerrada · Sin análisis', 'En proceso hace 1 día'], 'abierta y pendiente = una sola fila (por fecha y folio)');
es([ind(r, 'alerta').universo, ind(r, 'alerta').fallas], [4, 3], 'universo: todas las alertas');
es(hall(r, 'alerta').find((h) => h.enlace === `/alertas/${a1.id}`)?.nombre, 'Alerta ' + a1.id + ' (FSN-1)', 'enlace a la hoja de la alerta');

// ── Bajas sin acta ──────────────────────────────────────────────────────────
const b1 = equipo({ estado: 'baja' });
const b2 = equipo({ estado: 'baja' });
const b3 = equipo({ estado: 'baja' });
const b4 = equipo({ estado: 'baja', rubro: 'aires', tipo: 'general' });
r = C.armarCumplimiento(datos({
  equipos: [b1, b2, b3, b4],
  bajas: [{ id: 1, activoId: b2.id, fechaBaja: '2026-10-01' }, { id: 2, activoId: b3.id, fechaBaja: '2026-10-02' }],
  documentos: [{ activoId: b3.id, categoria: 'acta_baja', fechaVencimiento: null }, { activoId: b1.id, categoria: 'acta_baja', fechaVencimiento: null }],
}));
es(hall(r, 'baja_sin_acta').map((h) => [h.codigo, h.detalle]), [[b2.codigo, 'Falta acta firmada'], [b1.codigo, 'Falta registro de baja']], 'baja sin registro o sin acta = falla; otras áreas no cuentan');
es(ind(r, 'baja_sin_acta').universo, 3, 'universo: biomédicos de baja');

// ── Sin datos ───────────────────────────────────────────────────────────────
r = C.armarCumplimiento(datos({ equipos: [equipo({ claseRiesgo: 'III' })], sinDatos: ['seguridad_electrica'] }));
es([ind(r, 'seguridad_electrica').sinDatos, ind(r, 'seguridad_electrica').universo, hall(r, 'seguridad_electrica').length], [true, null, 0], 'fuente que falló: «sin datos», sin hallazgos');

// ── Vencimientos del resumen diario ─────────────────────────────────────────
const v1 = equipo({ registroSanitarioVencimiento: '2027-02-10' });           // 90 días
const v2 = equipo({ registroSanitarioVencimiento: '2027-02-11' });           // 91 días: fuera
const v3 = equipo({ registroSanitarioVencimiento: '2026-11-01' });           // vencido
const v4 = equipo({ claseRiesgo: 'IIb' });
const v5 = equipo();
const v = C.vencimientosProximos(datos({
  equipos: [v1, v2, v3, v4, v5],
  calibraciones: [cal(v4.id, '2025-11-20', '2026-11-20'), cal(v5.id, '2025-12-13', '2026-12-13'), cal(v1.id, '2025-01-01', '2026-01-01')],
  pruebas: [{ id: 9, activoId: v4.id, fecha: '2025-11-12', resultado: 'pasa', proximaFecha: '2026-11-12' }, { id: 10, activoId: v5.id, fecha: '2025-10-01', resultado: 'pasa', proximaFecha: '2026-10-01' }],
  licencias: [lic({ fechaVencimiento: '2027-01-20' }), lic({ fechaVencimiento: '2026-10-20' }), lic({ estado: 'reemplazada', fechaVencimiento: '2026-11-20' })],
  laboratorios: [lab({ acreditacionVigencia: '2027-01-11' }), lab({ acreditacionVigencia: '2027-01-12' })],
}));
es(v.items.map((x) => [x.tipo, x.dias]), [
  ['seguridad_electrica', 0], ['calibracion', 8], ['licencia', 69], ['acreditacion', 60], ['registro_sanitario', 90],
].sort((a, b) => a[1] - b[1]), 'ordena por días y respeta 30 / 60 / 90');
es(v.vencidos, { calibracion: 1, seguridad_electrica: 1, licencia: 1, registro_sanitario: 1, acreditacion: 0 }, 'vencidos por tipo');
es(v.items.find((x) => x.tipo === 'calibracion').codigo, v4.codigo, 'la calibración a 31 días no entra');
es(C.TIPOS_VENCIMIENTO.map((t) => t.titulo), [
  'Calibraciones (próximos 30 días)', 'Seguridad eléctrica (30 días)', 'Licencias y permisos (90 días)',
  'Registros sanitarios (90 días)', 'Acreditación de laboratorios (60 días)',
], 'títulos con las ventanas de DIAS_AVISO');

console.log(`PASS test-bio-cumplimiento: ${n} casos; catorce indicadores con las reglas de cada dueño y vencimientos del resumen diario.`);
