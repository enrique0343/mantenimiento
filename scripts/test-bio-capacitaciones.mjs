// Fase 59 · WP-D: capacitaciones (src/lib/capacitaciones.ts): lector de asistentes y su
// ida y vuelta, duración, evidencia, validación, filtros, clave de modelo y CSV. Puro.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: ['src/lib/capacitaciones.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
const C = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const hoy = '2026-11-12';
const a = (nombre, cargo = null, servicio = null) => ({ nombre, cargo, servicio });

// ── leerAsistentes ──────────────────────────────────────────────────────────
es(C.leerAsistentes('Ana Pérez\tEnfermera\tUCI'), { asistentes: [a('Ana Pérez', 'Enfermera', 'UCI')], errores: [] }, 'tabulador (pegado de Excel)');
es(C.leerAsistentes('Luis Gómez; Médico residente; Emergencia'), { asistentes: [a('Luis Gómez', 'Médico residente', 'Emergencia')], errores: [] }, 'punto y coma');
es(C.leerAsistentes('Rosa Díaz | Técnica | Imagenología'), { asistentes: [a('Rosa Díaz', 'Técnica', 'Imagenología')], errores: [] }, 'barra');
es(C.leerAsistentes('Pérez, Ana; Enfermera').asistentes, [a('Pérez, Ana', 'Enfermera')], 'la coma no separa');
es(C.leerAsistentes('Pérez, Ana, Enfermera').asistentes, [a('Pérez, Ana, Enfermera')], 'solo comas: todo es el nombre');
es(C.leerAsistentes('Nombre\tCargo\tServicio\nAna Pérez\tEnfermera\tUCI').asistentes, [a('Ana Pérez', 'Enfermera', 'UCI')], 'encabezado de Excel');
es(C.leerAsistentes('NOMBRE COMPLETO;CARGO\nAna Pérez;Enfermera').asistentes, [a('Ana Pérez', 'Enfermera')], 'encabezado en mayúsculas');
es(C.leerAsistentes('\n\nAna Pérez\n\n   \nLuis Gómez\n').asistentes, [a('Ana Pérez'), a('Luis Gómez')], 'líneas vacías');
es(C.leerAsistentes('Ana Pérez;;\nLuis Gómez\t\t').asistentes, [a('Ana Pérez'), a('Luis Gómez')], 'columnas vacías al final');
es(C.leerAsistentes('Ana Pérez;;UCI').asistentes, [a('Ana Pérez', null, 'UCI')], 'cargo vacío en medio');
es(C.leerAsistentes('Ana   Pérez ;  Enfermera  jefa ').asistentes, [a('Ana Pérez', 'Enfermera jefa')], 'espacios colapsados');
es(C.leerAsistentes('Ana Pérez\tEnfermera; UCI\tTurno A').asistentes, [a('Ana Pérez', 'Enfermera UCI', 'Turno A')], 'un «;» dentro de una columna de Excel pasa a espacio');
es(C.leerAsistentes('Ana Pérez;Enfermera;UCI;Turno A').errores, ['Línea 1: usa Nombre; Cargo; Servicio.'], 'cuatro datos');
es(C.leerAsistentes('Ana Pérez\nAl\n123; Enfermera').errores, ['Línea 2: falta el nombre.', 'Línea 3: falta el nombre.'], 'nombre corto o sin letras');
es(C.leerAsistentes(';Enfermera;UCI').errores, ['Línea 1: falta el nombre.'], 'sin nombre');
es(C.leerAsistentes(`${'x'.repeat(121)}\nAna Pérez;${'c'.repeat(81)}`).errores, ['Línea 1: el dato es muy largo.', 'Línea 2: el dato es muy largo.'], 'datos largos');
es(C.leerAsistentes('Ana Pérez\nLuis Gómez\nANA PEREZ').errores, ['Línea 3: «ANA PEREZ» ya está en la lista.'], 'repetido con tildes y mayúsculas');
const trescientos = Array.from({ length: 301 }, (_, i) => `Persona número ${i + 1}`).join('\n');
es(C.leerAsistentes(trescientos).errores, ['Máximo 300 asistentes por capacitación.'], '301 personas');
es(C.leerAsistentes(trescientos.split('\n').slice(0, 300).join('\n')).errores, [], '300 personas');
es(C.leerAsistentes(''), { asistentes: [], errores: [] }, 'vacío');
es(C.leerAsistentes(null), { asistentes: [], errores: [] }, 'null');

// Ida y vuelta: leerAsistentes(textoDeAsistentes(x)) devuelve x.
const listas = [
  [a('Ana Pérez', 'Enfermera', 'UCI'), a('Luis Gómez', 'Médico', 'Emergencia')],
  [a('Pérez, Ana', 'Enfermera, jefa', 'UCI, adultos')],
  [a('Ana Pérez'), a('Luis Gómez')],
  [a('Ana Pérez', null, 'UCI'), a('Rosa Díaz', null, 'Imagenología')],
  [a('Ana Pérez', 'Enfermera'), a('Luis Gómez', null, null), a('María José Núñez', 'Técnica en radiología', null)],
  [a('José Ñández-Pérez', 'Médico (residente)', 'Sala de partos #2')],
];
for (const [i, x] of listas.entries()) es(C.leerAsistentes(C.textoDeAsistentes(x)), { asistentes: x, errores: [] }, `ida y vuelta ${i + 1}`);
es(C.textoDeAsistentes([a('Ana Pérez', null, 'UCI'), a('Luis Gómez', 'Médico')]), 'Ana Pérez; ; UCI\nLuis Gómez; Médico', 'sin «;» de sobra al final');

// ── Duración, evidencia y código ────────────────────────────────────────────
es([null, 45, 60, 90, 120, 0].map(C.textoDuracion), ['—', '45 min', '1 h', '1 h 30 min', '2 h', '—'], 'textoDuracion');
es(C.evidenciaCapacitacion({ fecha: '2026-11-13', asistentes: 0, listasFirmadas: 0 }, hoy), 'programada', 'fecha futura: programada');
es(C.evidenciaCapacitacion({ fecha: '2026-11-12', asistentes: 12, listasFirmadas: 1 }, hoy), 'completa', 'hoy, con asistentes y lista');
es(C.evidenciaCapacitacion({ fecha: '2026-10-01', asistentes: 12, listasFirmadas: 0 }, hoy), 'falta_lista', 'falta la lista firmada');
es(C.evidenciaCapacitacion({ fecha: '2026-10-01', asistentes: 0, listasFirmadas: 2 }, hoy), 'faltan_asistentes', 'faltan los asistentes');
es(C.evidenciaCapacitacion({ fecha: '2026-10-01', asistentes: 0, listasFirmadas: 0 }, hoy), 'sin_evidencia', 'sin nada');
es(Object.values(C.EVIDENCIA_CAPACITACION).map((e) => e.etiqueta), ['Programada', 'Completa', 'Falta lista firmada', 'Faltan los asistentes', 'Sin asistentes ni lista'], 'etiquetas de evidencia');
es(C.codigoCapacitacion(12), 'CAP-0012', 'código');

// ── validarCapacitacion ─────────────────────────────────────────────────────
const base = {
  fecha: '2026-11-10', tema: 'Uso seguro del monitor', tipo: 'uso_seguro', instructorTipo: 'interno', instructorNombre: 'Ing. Carlos Ruiz',
  equipoIds: [3, 4], asistentesTexto: 'Ana Pérez; Enfermera; UCI',
};
const v = (cambios) => C.validarCapacitacion({ ...base, ...cambios });
const err = (cambios) => { const r = v(cambios); return r.ok ? null : r.error; };
es(v({}), {
  ok: true,
  datos: {
    fecha: '2026-11-10', tema: 'Uso seguro del monitor', tipo: 'uso_seguro', instructorTipo: 'interno', instructorNombre: 'Ing. Carlos Ruiz',
    proveedorId: null, instructorEntidad: null, modeloCubierto: null, duracionMinutos: null, sucursalId: null, lugar: null, servicio: null, notas: null,
  },
  asistentes: [a('Ana Pérez', 'Enfermera', 'UCI')],
  equipoIds: [3, 4],
}, 'capacitación válida');
es(err({ fecha: '' }), 'Escribe una fecha válida.', 'sin fecha');
es(err({ fecha: '2026-02-30' }), 'Escribe una fecha válida.', 'fecha imposible');
es(v({ fecha: '10/11/2026' }).datos.fecha, '2026-11-10', 'fecha DD/MM/AAAA');
es(err({ tema: 'ab' }), 'Escribe el tema.', 'tema corto');
es(err({ tipo: 'charla' }), 'Elige el tipo de capacitación.', 'tipo desconocido');
es(err({ instructorTipo: 'mixto' }), 'Elige si el instructor es interno o externo.', 'instructor ni interno ni externo');
es(err({ instructorNombre: 'Al' }), 'Escribe el nombre del instructor.', 'instructor sin nombre');
es(err({ equipoIds: [], modeloCubierto: '' }), 'Elige al menos un equipo o escribe el modelo.', 'sin equipos ni modelo');
es(v({ equipoIds: [], modeloCubierto: 'Mindray uMEC12' }).ok, true, 'solo el modelo');
es(err({ equipoIds: Array.from({ length: 501 }, (_, i) => i + 1) }), 'Máximo 500 equipos por capacitación.', '501 equipos');
es(err({ equipoIds: [1, 'x'] }), 'Uno de los equipos no es válido. Recarga la página.', 'id de equipo no válido');
es(v({ equipoIds: [4, '4', 3, 4] }).equipoIds, [4, 3], 'quita equipos repetidos');
es([err({ duracionMinutos: 4 }), err({ duracionMinutos: '1441' }), err({ duracionMinutos: 12.5 }), err({ duracionMinutos: 'una hora' })],
  Array(4).fill('La duración va en minutos, entre 5 y 1440.'), 'duración fuera de rango');
es(v({ duracionMinutos: '90' }).datos.duracionMinutos, 90, 'duración como texto');
es(v({ duracionMinutos: '' }).datos.duracionMinutos, null, 'sin duración');
es(err({ lugar: 'x'.repeat(121) }), 'El lugar es muy largo (máx. 120 caracteres).', 'lugar largo');
es(err({ servicio: 'x'.repeat(81) }), 'El servicio es muy largo (máx. 80 caracteres).', 'servicio largo');
es(err({ notas: 'x'.repeat(1001) }), 'Las notas son muy largas (máx. 1000 caracteres).', 'notas largas');
es(v({ asistentesTexto: 'Ana Pérez\nAl' }), { ok: false, error: 'Revisa la lista de asistentes.', errores: ['Línea 2: falta el nombre.'] }, 'asistentes con errores');
es(v({ asistentesTexto: '' }).asistentes, [], 'sin asistentes (se firma a mano)');
const interno = v({ proveedorId: 4, instructorEntidad: 'Mindray' }).datos;
es([interno.proveedorId, interno.instructorEntidad], [null, null], 'interno: sin proveedor ni empresa');
const externo = v({ instructorTipo: 'externo', proveedorId: '4', instructorEntidad: ' Mindray El Salvador ' }).datos;
es([externo.proveedorId, externo.instructorEntidad], [4, 'Mindray El Salvador'], 'externo: proveedor y empresa');

// ── Filtros ─────────────────────────────────────────────────────────────────
const f = (q) => C.leerFiltrosCapacitacion(new URLSearchParams(q), hoy);
es(f(''), { desde: '2025-11-12', hasta: null, activo: null, equipo: '', servicio: '', tipo: null, sede: null }, 'desde por defecto: hace un año');
es(f('desde=2026-02-30&hasta=x&tipo=charla&activo=abc&sede=0'), { desde: '2025-11-12', hasta: null, activo: null, equipo: '', servicio: '', tipo: null, sede: null }, 'valores que no se leen se ignoran');
es(f('desde=01/01/2026&hasta=2026-06-30&activo=5&tipo=induccion&sede=2&equipo=monitor&servicio=uci'),
  { desde: '2026-01-01', hasta: '2026-06-30', activo: 5, equipo: 'monitor', servicio: 'uci', tipo: 'induccion', sede: 2 }, 'filtros completos');
es(C.paramsDeFiltrosCapacitacion(f('activo=5&desde=2000-01-01')).toString(), 'desde=2000-01-01&activo=5', 'parámetros para el CSV');
const eq = (id, codigo, nombre, marca = null, modelo = null) => ({ id, codigo, nombre, marca, modelo });
const cap = (id, fecha, extra = {}) => ({
  id, fecha, tema: `Tema ${id}`, tipo: 'uso_seguro', instructorTipo: 'interno', instructorNombre: 'Ing. Ruiz', proveedorId: null, proveedor: null,
  instructorEntidad: null, modeloCubierto: null, duracionMinutos: 60, sucursalId: 1, sede: 'Central', lugar: null, servicio: null, notas: null,
  equipos: [], asistentes: [], listasFirmadas: 0, archivos: 0, ...extra,
});
const filas = [
  cap(1, '2026-10-01', { equipos: [eq(3, 'BIO-003', 'Monitor de signos', 'Mindray', 'uMEC12')], servicio: 'UCI adultos', asistentes: [a('Ana Pérez', 'Enfermera', 'UCI')], listasFirmadas: 1 }),
  cap(2, '2026-06-01', { modeloCubierto: 'Ventilador Dräger V300', tipo: 'limpieza_desinfeccion', sucursalId: 2, asistentes: [a('Luis Gómez', null, 'Emergencia')] }),
  cap(3, '2025-12-01', { equipos: [eq(4, 'BIO-004', 'Bomba de infusión')], tipo: 'induccion' }),
  cap(4, '2025-01-01', { equipos: [eq(3, 'BIO-003', 'Monitor de signos', 'Mindray', 'uMEC12')] }),
];
const ids = (q) => C.filtrarCapacitaciones(filas, f(q)).map((c) => c.id);
es(ids(''), [1, 2, 3], 'último año');
es(ids('desde=2000-01-01'), [1, 2, 3, 4], 'desde 2000');
es(ids('desde=2026-01-01&hasta=2026-06-30'), [2], 'entre fechas (el borde cuenta)');
es(ids('activo=3&desde=2000-01-01'), [1, 4], 'por equipo enlazado');
es(ids('equipo=bio-004'), [3], 'equipo por código');
es(ids('equipo=bomba'), [3], 'equipo por nombre');
es(ids('equipo=umec'), [1], 'equipo por modelo');
es(ids('equipo=drager'), [2], 'modelo cubierto, sin tildes');
es(ids('servicio=uci'), [1], 'servicio de la sesión');
es(ids('servicio=emergencia'), [2], 'servicio de un asistente');
es(ids('tipo=limpieza_desinfeccion'), [2], 'por tipo (requisito 18)');
es(ids('sede=2'), [2], 'por sede');

// ── Clave de modelo y CSV ───────────────────────────────────────────────────
es([C.claveModelo('Mindray', 'uMEC 12'), C.claveModelo(null, 'X-1'), C.claveModelo('Dräger', ''), C.claveModelo(' DRÄGER ', ' v300 ')],
  ['mindray|umec 12', '|x-1', null, 'drager|v300'], 'claveModelo');
es(C.filaCsvCapacitacion(filas[0], hoy), {
  codigo: 'CAP-0001', fecha: '2026-10-01', tema: 'Tema 1', tipo: 'Uso seguro del equipo', instructor: 'Ing. Ruiz', instructorTipo: 'Interno',
  empresa: '', equipos: 'BIO-003', modelo: '', duracion: 60, sede: 'Central', lugar: '', servicio: 'UCI adultos', asistentes: 1,
  listaFirmada: 'Sí', evidencia: 'Completa',
}, 'fila del CSV por sesión: fecha AAAA-MM-DD y Sí/No');
es(C.filaCsvCapacitacion(filas[1], hoy).listaFirmada, 'No', 'sin lista firmada');
es(C.filasCsvAsistentes(filas[1]), [{ codigo: 'CAP-0002', fecha: '2026-06-01', tema: 'Tema 2', equipos: 'Ventilador Dräger V300', nombre: 'Luis Gómez', cargo: '', servicio: 'Emergencia' }], 'CSV por asistente');
es(C.filasCsvAsistentes(filas[2]), [], 'sin asistentes, sin filas');

console.log(`PASS test-bio-capacitaciones: ${n} casos; asistentes, evidencia, validación, filtros y CSV.`);
