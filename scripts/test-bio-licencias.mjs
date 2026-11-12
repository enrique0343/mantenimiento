// Fase 59 · WP-D: licencias y permisos (src/lib/licencias.ts): validación, renovación,
// filtros por situación (ventanas acumuladas), búsqueda sin tildes, orden y CSV. Puro.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: ['src/lib/licencias.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
const L = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const hoy = '2026-11-12';

// ── validarLicencia ─────────────────────────────────────────────────────────
const base = {
  entidad: 'srs', tipo: 'funcionamiento', nombre: 'Licencia de funcionamiento de Rayos X', numero: 'SRS-2026-001',
  ambito: 'establecimiento', sucursalId: 1, fechaEmision: '2025-12-01', fechaVencimiento: '2026-12-01', estado: 'activa',
};
const crear = (cambios) => L.validarLicencia({ ...base, ...cambios }, { modo: 'crear' });
const error = (cambios, opciones = { modo: 'crear' }) => {
  const r = L.validarLicencia({ ...base, ...cambios }, opciones);
  return r.ok ? null : r.error;
};
es(crear({}), {
  ok: true,
  datos: {
    entidad: 'srs', entidadOtra: null, tipo: 'funcionamiento', nombre: 'Licencia de funcionamiento de Rayos X', numero: 'SRS-2026-001',
    ambito: 'establecimiento', sucursalId: 1, servicio: null, activoId: null, titular: null,
    fechaEmision: '2025-12-01', fechaVencimiento: '2026-12-01', responsableId: null, estado: 'activa', notas: null,
  },
}, 'licencia válida');
es(error({ entidad: '' }), 'Elige la entidad que la emite.', 'sin entidad');
es(error({ entidad: 'mh' }), 'Elige la entidad que la emite.', 'entidad desconocida');
es(error({ entidad: 'otra' }), 'Escribe el nombre de la entidad.', 'otra sin nombre');
es(crear({ entidad: 'otra', entidadOtra: '  Cuerpo de Bomberos ' }).datos.entidadOtra, 'Cuerpo de Bomberos', 'otra con nombre');
es(crear({ entidadOtra: 'No se guarda' }).datos.entidadOtra, null, 'entidad fija: sin «otra»');
es(error({ tipo: 'permiso' }), 'Elige el tipo de licencia.', 'tipo desconocido');
es(error({ nombre: 'ab' }), 'Escribe una descripción corta de la licencia.', 'nombre corto');
es(error({ nombre: 'x'.repeat(151) }), 'Escribe una descripción corta de la licencia.', 'nombre largo');
es(error({ estado: 'vencida' }), 'Estado no válido.', 'estado no válido');
es(error({ estado: 'reemplazada' }), 'Estado no válido.', 'reemplazada no se elige');
es(error({ estado: 'en_tramite' }, { modo: 'editar', estadoActual: 'activa' }), 'Una licencia activa no vuelve a «En trámite»: registra una renovación.', 'activa no vuelve a trámite');
es(L.validarLicencia({ ...base, estado: 'activa' }, { modo: 'editar', estadoActual: 'en_tramite' }).ok, true, 'en trámite pasa a activa');
es(error({ numero: 'x'.repeat(61) }), 'El número es muy largo (máx. 60 caracteres).', 'número largo');
es(error({ numero: '' }), 'Escribe el número de la licencia o márcala «En trámite».', 'activa sin número');
es(crear({ numero: '', estado: 'en_tramite', fechaVencimiento: '' }).ok, true, 'en trámite sin número ni vencimiento');
es(error({ ambito: '' }), 'Elige a qué aplica.', 'sin ámbito');
es(error({ sucursalId: null }), 'Elige la sede.', 'establecimiento sin sede');
es(error({ ambito: 'servicio', sucursalId: '' }), 'Elige la sede.', 'servicio sin sede');
es(error({ ambito: 'servicio' }), 'Escribe el servicio.', 'servicio sin nombre');
es(error({ ambito: 'equipo', activoId: null }), 'Elige el equipo de la lista.', 'equipo sin elegir');
es(error({ ambito: 'equipo', activoId: 'abc' }), 'Elige el equipo de la lista.', 'equipo con id no válido');
es(error({ ambito: 'persona' }), 'Escribe el nombre del titular.', 'persona sin titular');
es(error({ fechaEmision: '2026-02-30' }), 'La fecha de emisión no es válida.', 'emisión inválida');
es(error({ fechaVencimiento: '31/02/2027' }), 'La fecha de vencimiento no es válida.', 'vencimiento inválido');
es(error({ fechaVencimiento: '2025-12-01' }), 'El vencimiento debe ser posterior a la emisión.', 'vence el día de la emisión');
es(error({ fechaVencimiento: '' }), 'Escribe la fecha de vencimiento o marca «No vence».', 'activa sin vencimiento');
es(crear({ fechaVencimiento: '', noVence: true }).datos.fechaVencimiento, null, '«No vence»');
es(crear({ fechaVencimiento: '2030-01-01', noVence: 'on' }).datos.fechaVencimiento, null, '«No vence» manda sobre la fecha');
es(error({ notas: 'x'.repeat(1001) }), 'Las notas son muy largas (máx. 1000 caracteres).', 'notas largas');
es(crear({ fechaEmision: '01/12/2025', fechaVencimiento: '1/12/2026' }).datos.fechaVencimiento, '2026-12-01', 'fechas DD/MM/AAAA');
// Limpieza por ámbito.
const limpio = (cambios) => { const d = crear(cambios).datos; return [d.sucursalId, d.servicio, d.activoId, d.titular]; };
es(limpio({ ambito: 'equipo', activoId: '12', servicio: 'UCI', titular: 'Ana' }), [null, null, 12, null], 'equipo: solo el equipo (la sede la pone el servidor)');
es(limpio({ ambito: 'establecimiento', activoId: 12, servicio: 'UCI', titular: 'Ana' }), [1, null, null, null], 'establecimiento: solo la sede');
es(limpio({ ambito: 'servicio', servicio: ' Radiología ', activoId: 12, titular: 'Ana' }), [1, 'Radiología', null, null], 'servicio: sede y servicio');
es(limpio({ ambito: 'persona', titular: 'Dra. Ana López', activoId: 12, servicio: 'UCI' }), [1, null, null, 'Dra. Ana López'], 'persona: titular y sede opcional');
es(crear({ responsableId: '3' }).datos.responsableId, 3, 'responsable');

// ── licenciaParaRenovar ─────────────────────────────────────────────────────
es(L.licenciaParaRenovar({ id: 5, entidad: 'cssp', entidadOtra: null, tipo: 'radiacion_equipo', nombre: 'Licencia del tomógrafo', ambito: 'equipo', sucursalId: 1, servicio: null, activoId: 9, titular: null, responsableId: 2, numero: 'X-1', notas: 'n', fechaVencimiento: '2026-11-01' }), {
  entidad: 'cssp', entidadOtra: null, tipo: 'radiacion_equipo', nombre: 'Licencia del tomógrafo', ambito: 'equipo', sucursalId: 1, servicio: null,
  activoId: 9, titular: null, responsableId: 2, numero: null, fechaEmision: null, fechaVencimiento: null, notas: null, estado: 'en_tramite', reemplazaAId: 5,
}, 'renovación: mismos datos, sin número, fechas ni notas');
es(L.codigoLicencia(7), 'LIC-0007', 'código');
es([L.etiquetaEntidad('otra', 'Bomberos'), L.etiquetaEntidad('minsal'), L.etiquetaEntidad('otra', '')], ['Bomberos', 'MINSAL', 'Otra'], 'etiqueta de la entidad');

// ── Lista: 9 licencias con hoy = 2026-11-12 ─────────────────────────────────
const lic = (id, estado, fechaVencimiento, extra = {}) => ({
  id, entidad: 'srs', entidadOtra: null, tipo: 'funcionamiento', nombre: `Licencia ${id}`, numero: `N-${id}`, ambito: 'establecimiento',
  sucursalId: 1, sede: 'Central', servicio: null, activoId: null, equipoCodigo: null, equipoNombre: null, titular: null,
  fechaEmision: '2025-01-01', fechaVencimiento, responsableId: null, responsable: null, estado, reemplazaAId: null, notas: null,
  archivos: 1, renovacionEnTramite: false, createdAt: '2026-01-01 10:00:00', ...extra,
});
const todas = [
  lic(1, 'activa', '2027-06-30', { nombre: 'Licencia de Radiología', servicio: 'Radiología', ambito: 'servicio' }),
  lic(2, 'activa', '2026-12-01', { archivos: 0 }),
  lic(3, 'activa', '2027-01-05', { entidad: 'cssp' }),
  lic(4, 'activa', '2027-02-01', { ambito: 'equipo', activoId: 9, equipoCodigo: 'BIO-009', equipoNombre: 'Tomógrafo' }),
  lic(5, 'activa', '2026-11-01', { renovacionEnTramite: true }),
  lic(6, 'activa', null, { tipo: 'inscripcion' }),
  lic(7, 'en_tramite', null, { reemplazaAId: 5, numero: null }),
  lic(8, 'reemplazada', '2025-06-01'),
  lic(9, 'anulada', '2027-01-01', { ambito: 'persona', titular: 'Dra. Ana López' }),
];
const f = (q) => L.leerFiltrosLicencia(new URLSearchParams(q));
const ids = (q) => L.filtrarLicencias(todas, f(q), hoy).map((l) => l.id);
es(f(''), { situacion: 'actuales', entidad: null, tipo: null, ambito: null, sede: null, activo: null, q: '' }, 'filtros por defecto');
es(f('situacion=raro&entidad=mh&tipo=x&ambito=y&sede=-1&activo=0').situacion, 'actuales', 'valores desconocidos se ignoran');
es(ids(''), [5, 2, 3, 4, 1, 6, 7], 'actuales: lo más urgente primero');
es(ids('situacion=vigentes'), [2, 3, 4, 1, 6], 'vigentes incluye las por vencer y las que no vencen');
es(ids('situacion=vence_90'), [2, 3, 4], 'vencen en ≤ 90');
es(ids('situacion=vence_60'), [2, 3], 'vencen en ≤ 60');
es(ids('situacion=vence_30'), [2], 'vencen en ≤ 30');
const set = (q) => new Set(ids(q));
es([...set('situacion=vence_30')].every((x) => set('situacion=vence_60').has(x)) && [...set('situacion=vence_60')].every((x) => set('situacion=vence_90').has(x)), true, 'ventanas acumuladas: 90 ⊇ 60 ⊇ 30');
es(ids('situacion=vencidas'), [5], 'vencidas');
es(ids('situacion=en_tramite'), [7], 'en trámite');
es(ids('situacion=historial'), [8, 9], 'reemplazadas y anuladas');
es(ids('situacion=todas').length, 9, 'todas');
es(ids('situacion=todas&q=radiologia'), [1], 'busca sin tildes');
es(ids('situacion=todas&q=LIC-0004'), [4], 'busca por código');
es(ids('situacion=todas&q=tomografo'), [4], 'busca por el equipo');
es(ids('situacion=todas&q=lopez'), [9], 'busca por el titular');
es(ids('entidad=cssp'), [3], 'por entidad');
es(ids('tipo=inscripcion'), [6], 'por tipo');
es(ids('ambito=equipo'), [4], 'por ámbito');
es(ids('activo=9&situacion=todas'), [4], 'por equipo');
es(L.contarLicencias(todas, hoy), { vigentes: 5, vence90: 3, vence60: 2, vence30: 1, vencidas: 1, enTramite: 1, historial: 2, total: 9 }, 'tarjetas');
// Las tarjetas y «Además hay N vencidas» abren con los demás filtros: cuentan con ellos (antes contaban todas).
es(L.contarLicenciasFiltradas(todas, f(''), hoy), L.contarLicencias(todas, hoy), 'tarjetas sin filtros: las mismas');
es(L.contarLicenciasFiltradas(todas, f('situacion=vence_90&entidad=cssp'), hoy).vencidas, ids('situacion=vencidas&entidad=cssp').length,
  'con entidad CSSP: «Además hay N vencidas» cuenta lo que abre su enlace (0, no 1)');
es(L.contarLicenciasFiltradas(todas, f('situacion=vencidas&activo=9'), hoy), { vigentes: 1, vence90: 1, vence60: 0, vence30: 0, vencidas: 0, enTramite: 0, historial: 0, total: 1 },
  'tarjetas del equipo que viene de la ficha');
es(L.paramsDeFiltrosLicencia(f('situacion=vence_90&entidad=srs&q=rx')).toString(), 'situacion=vence_90&entidad=srs&q=rx', 'parámetros para el CSV');
es([L.aplicaA(todas[0]), L.aplicaA(todas[3]), L.aplicaA(todas[8]), L.aplicaA(todas[1])], ['Radiología · Central', 'BIO-009 — Tomógrafo', 'Dra. Ana López · Central', 'Establecimiento · Central'], 'aplica a');

// ── CSV ─────────────────────────────────────────────────────────────────────
es(L.filaCsvLicencia(todas[1], hoy), {
  codigo: 'LIC-0002', entidad: 'SRS', tipo: 'Permiso o licencia de funcionamiento', licencia: 'Licencia 2', numero: 'N-2',
  ambito: 'Establecimiento', sede: 'Central', servicio: '', equipoCodigo: '', equipo: '', titular: '', emision: '2025-01-01',
  vence: '2026-12-01', situacion: 'Vence en ≤ 30 días', dias: 19, estado: 'Activa', responsable: '', archivo: 'No', notas: '',
}, 'fila del CSV: fechas AAAA-MM-DD, días y Sí/No');
es([L.filaCsvLicencia(todas[4], hoy).situacion, L.filaCsvLicencia(todas[4], hoy).dias], ['Vencida · renovación en trámite', -11], 'vencida con renovación');
es([L.filaCsvLicencia(todas[5], hoy).situacion, L.filaCsvLicencia(todas[5], hoy).vence, L.filaCsvLicencia(todas[5], hoy).dias], ['No vence', '', ''], 'no vence');
es([L.filaCsvLicencia(todas[7], hoy).situacion, L.filaCsvLicencia(todas[7], hoy).dias, L.filaCsvLicencia(todas[7], hoy).estado], ['Reemplazada', '', 'Reemplazada'], 'reemplazada: sin días');
es(L.COLUMNAS_CSV_LICENCIAS.length, 19, '19 columnas');

// ── Ronda 2: la licencia de un equipo dado de baja no se renueva ─────────────
const deEquipo = { ambito: 'equipo', activoId: 7, equipoEstado: 'baja' };
es(L.esDeEquipoDeBaja(deEquipo), true, 'equipo de baja');
es([L.esDeEquipoDeBaja({ ...deEquipo, equipoEstado: 'operativo' }), L.esDeEquipoDeBaja({ ...deEquipo, equipoEstado: undefined }), L.esDeEquipoDeBaja({ ...deEquipo, activoId: null })],
  [false, false, false], 'equipo en servicio, sin el dato o sin equipo');
es(L.esDeEquipoDeBaja({ ...deEquipo, ambito: 'servicio' }), false, 'otro ámbito no depende del equipo');

console.log(`PASS test-bio-licencias: ${n} casos; validación, renovación, filtros acumulados, búsqueda, orden, CSV y licencias de equipos de baja.`);
