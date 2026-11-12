// Fase 59 · WP-A: carga masiva de equipos (src/lib/importar-equipos.ts), sin base de
// datos: lectura del CSV, encabezados (plantilla, CSV descargado y alias) y el plan
// fila por fila con un inventario en memoria.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: ['src/lib/importar-equipos.ts'], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const I = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const si = (r, nota) => { n++; assert.ok(r, nota); };

// ── parsearCsv ──────────────────────────────────────────────────────────────
es(I.parsearCsv('a,b\n1,2'), { separador: ',', registros: [['a', 'b'], ['1', '2']] }, 'coma');
es(I.parsearCsv('a;b\r\n1;2\r\n'), { separador: ';', registros: [['a', 'b'], ['1', '2']] }, 'punto y coma con CRLF');
es(I.parsearCsv('a\tb\n1\t2').separador, '\t', 'tabulador');
es(I.parsearCsv('\uFEFFcodigo,nombre\nX,Y').registros[0], ['codigo', 'nombre'], 'quita el BOM');
es(I.parsearCsv('a,b\n"1,5","dijo ""hola"""').registros[1], ['1,5', 'dijo "hola"'], 'comillas con coma y comillas dobles');
es(I.parsearCsv('a,b\n"línea 1\nlínea 2",x\n3,4').registros, [['a', 'b'], ['línea 1\nlínea 2', 'x'], ['3', '4']], 'salto de línea dentro de comillas');
es(I.parsearCsv('a;b\n"x;y";2').registros[1], ['x;y', '2'], 'separador dentro de comillas');
es(I.parsearCsv('a,b\n\n1,2\n').registros, [['a', 'b'], [''], ['1', '2']], 'una línea vacía se conserva para numerar');
es(I.parsearCsv('a,b\n12" pantalla,x').registros[1], ['12" pantalla', 'x'], 'comilla a mitad de campo es texto');
es(I.parsearCsv('codigo;nombre;marca\n"A,1";B;C').separador, ';', 'la coma entre comillas no cuenta para el separador');

// ── Encabezados ─────────────────────────────────────────────────────────────
es(I.normalizarEncabezado(' Vida útil (años) '), 'vida_util_anos', 'normaliza el encabezado');
es(I.normalizarEncabezado('N.º de serie'), 'n_de_serie', 'signos a guion bajo');
for (const c of I.columnasExportacion()) {
  const columna = I.columnaDeEncabezado(c.label);
  si(columna, `la etiqueta descargada «${c.label}» se reconoce`);
  es(columna.clave, c.key, `«${c.label}» vuelve a su columna`);
}
for (const [h, clave] of [['codigo_institucional', 'codigo'], ['Serie', 'serial'], ['serial', 'serial'], ['N° de serie', 'serial'], ['sede', 'sucursal'],
  ['ubicacion_nombre', 'ubicacion'], ['Área', 'rubro'], ['rubro', 'rubro'], ['clase', 'clase_riesgo'], ['CC', 'centro_costo'], ['Vida útil', 'vida_util_anios']]) {
  es(I.columnaDeEncabezado(h)?.clave, clave, `alias «${h}»`);
}
const plantillaBio = I.plantillaCsv('biomedico');
si(plantillaBio.startsWith('\uFEFFcodigo,numero_activo,nombre,area,'), 'la plantilla empieza con BOM y código');
si(plantillaBio.includes(',clase_riesgo,') && plantillaBio.includes(',registro_vencimiento,'), 'la plantilla biomédica trae clase y registro');
si(!plantillaBio.includes('refrigerante') && !plantillaBio.includes('ultima_calibracion'), 'sin columnas de aires ni de calibración');
si(I.plantillaCsv('aires').includes('refrigerante') && !I.plantillaCsv('aires').includes('clase_riesgo'), 'la plantilla de aires trae sus datos técnicos');
for (const h of I.plantillaCsv(null).replace('\uFEFF', '').trim().split(',')) es(I.columnaDeEncabezado(h)?.importable, true, `la plantilla se vuelve a leer: ${h}`);

// ── Contexto en memoria ─────────────────────────────────────────────────────
const vacio = { numeroActivo: null, serial: null, categoria: null, subcategoria: null, marca: null, modelo: null, descripcion: null, anio: null,
  criticidadOperacional: 'media', claseRiesgo: null, centroCostoId: null, ubicacionId: null, ubicacion: null, registroSanitario: null,
  registroSanitarioEntidad: null, registroSanitarioEmision: null, registroSanitarioVencimiento: null, registroSanitarioNoRequiere: false,
  fechaAdquisicion: null, vidaUtilAnios: null, valorAdquisicion: null, proveedorId: null, datosTecnicos: null, estado: 'operativo' };
const ctx = (modo = 'crear', area = 'biomedico') => ({
  modo, area, hoy: '2026-11-12',
  activos: [
    { ...vacio, id: 1, codigo: 'BIO-1', nombre: 'MONITOR', rubro: 'biomedico', tipo: 'biomedico', serial: 'SN-123', numeroActivo: 'AF-9',
      claseRiesgo: 'IIa', ubicacionId: 10, centroCostoId: 1, datosTecnicos: '{"servicio":"UCI"}' },
    { ...vacio, id: 2, codigo: 'Bio-Legado', nombre: 'BOMBA', rubro: 'biomedico', tipo: 'biomedico' },
    { ...vacio, id: 3, codigo: 'EQ-1', nombre: 'IMPRESORA', rubro: 'equipo_general', tipo: 'general' },
    { ...vacio, id: 4, codigo: 'BIO-BAJA', nombre: 'VIEJO', rubro: 'biomedico', tipo: 'biomedico', estado: 'baja', claseRiesgo: 'I' },
    { ...vacio, id: 5, codigo: 'AC-1', nombre: 'SPLIT', rubro: 'aires', tipo: 'general', datosTecnicos: '{"refrigerante":"R32","tipoUnidad":"MINI SPLIT"}' },
  ],
  sucursales: [{ id: 1, nombre: 'Sede Central', codigo: 'SC' }, { id: 2, nombre: 'Sede Norte', codigo: 'SN' }],
  ubicaciones: [
    { id: 10, nombre: 'UCI', sucursalId: 1, activa: true }, { id: 11, nombre: 'Emergencia', sucursalId: 1, activa: true },
    { id: 12, nombre: 'Emergencia', sucursalId: 2, activa: true }, { id: 13, nombre: 'Bodega', sucursalId: 2, activa: false },
  ],
  centros: [
    { id: 1, codigo: 'CC-01', nombre: 'UCI ADULTOS', sucursalId: 1, activo: true },
    { id: 2, codigo: 'CC-02', nombre: 'ARCHIVO', sucursalId: null, activo: false },
    { id: 3, codigo: 'CC-03', nombre: 'NORTE', sucursalId: 2, activo: true },
  ],
  proveedores: [{ id: 7, nombre: 'Biomédica S.A.', activo: true }],
});
const plan = (csv, modo, area) => I.planificarImportacion(csv, ctx(modo, area));
const fila = (csv, modo, area) => { const p = plan(csv, modo, area); assert.equal(p.error, undefined, p.error); return p.resultados[0]; };
const errores = (r) => r.accion === 'error' ? r.detalle : [];
const H = 'codigo,nombre,clase_riesgo';

// Errores del archivo
es(plan('').error, 'El archivo está vacío.', 'archivo vacío');
es(plan('nombre,marca\nX,Y').error, 'Falta la columna «codigo».', 'sin columna código');
es(plan('codigo,Serie,serial\nA,1,2').error, 'La columna «serial» aparece dos veces.', 'columna repetida');
es(plan('codigo,nombre').error, 'El archivo está vacío.', 'solo encabezado');
es(plan('codigo,nombre\n' + Array.from({ length: 3001 }, (_, i) => `C${i},X`).join('\n')).error,
  'El archivo tiene 3001 filas; el máximo es 3000. Divídelo en partes.', 'máximo de filas');
const conDesconocida = plan('codigo,nombre,clase_riesgo,color favorito\nBIO-9,X,I,azul');
es(conDesconocida.columnasIgnoradas, ['color favorito'], 'columna desconocida ignorada');
es(conDesconocida.resultados[0].accion, 'crear', 'la columna desconocida no impide crear');

// Numeración de filas: las vacías cuentan y no se procesan
const numeradas = plan(`${H}\nBIO-10,A,I\n\nBIO-11,B,III\n"BIO-12","C\nlarga",IIb`);
es(numeradas.filas, 3, 'tres filas con datos');
es(numeradas.resultados.map((r) => r.fila), [2, 4, 5], 'fila como en Excel');

// Código
es(errores(fila('codigo,nombre\n,X')), ['Falta el código.'], 'falta código');
es(errores(fila(`${H}\nBIO-1,X,I`)), ['El código ya existe (BIO-1 · MONITOR). Para cambiar sus datos usa «Actualizar equipos existentes».'], 'código existente al crear');
es(fila(`${H}\nbio-legado,X,I`).accion, 'error', 'código existente sin distinguir mayúsculas');
const repetido = plan(`${H}\nBIO-20,A,I\nbio-20,B,I`);
es(repetido.resultados.map((r) => r.accion), ['crear', 'error'], 'el primero se crea, el repetido no');
es(repetido.resultados[1].detalle, ['Código repetido en el archivo (también en la fila 2).'], 'código repetido en el archivo');
es(errores(fila(`${H}\n${'X'.repeat(61)},A,I`)), ['El código no puede tener más de 60 caracteres.'], 'código largo');
es(errores(fila(`${H}\nBIO-404,A,I`, 'actualizar')), ['No existe un equipo con ese código.'], 'actualizar código inexistente');

// Área
es(errores(fila('codigo,nombre,area\nEQ-9,X,infraestructura', 'crear', 'aires')), ['El área de la fila no corresponde a este inventario.'], 'otra área al crear');
es(errores(fila(`${H}\nEQ-1,X,`, 'actualizar', 'biomedico')), ['El equipo es de otra área (Equipos generales).'], 'otra área al actualizar');
es(fila('codigo,nombre,area\nAC-9,X,Aire acondicionado', 'crear', null).nuevo.rubro, 'aires', 'área por su nombre');

// Clase de riesgo
es(errores(fila(`${H}\nBIO-30,X,`)), ['Falta la clase de riesgo (I, IIa, IIb o III).'], 'biomédico sin clase al crear');
es(fila(`${H}\nBIO-31,X,2a`).nuevo.claseRiesgo, 'IIa', '«2a» → IIa');
es(errores(fila(`${H}\nBIO-32,X,IV`)), ['Clase de riesgo «IV» no válida. Usa I, IIa, IIb o III.'], 'clase inválida');
es(errores(fila(`${H}\nEQ-30,X,III`, 'crear', 'equipo_general')), ['La clase de riesgo, la subcategoría y el registro sanitario solo aplican a equipos biomédicos.'], 'clase en un equipo general');
es(fila(`${H}\nBIO-LEGADO,,`, 'actualizar').avisos, ['Sigue sin clase de riesgo.'], 'aviso al actualizar un biomédico sin clase');

// Estado
es(errores(fila('codigo,nombre,clase_riesgo,estado\nBIO-40,X,I,baja')), ['Para dar de baja un equipo usa «Dar de baja» en su ficha.'], '«baja» rechazada');
es(fila('codigo,nombre,clase_riesgo,estado\nBIO-41,X,I,En mantenimiento').nuevo.estado, 'mantenimiento', '«En mantenimiento» aceptado');
es(errores(fila('codigo,nombre,clase_riesgo,estado\nBIO-42,X,I,roto')), ['Estado «roto» no válido. Usa operativo, averiado o en mantenimiento.'], 'estado inválido');
es(errores(fila('codigo,estado\nBIO-BAJA,operativo', 'actualizar')), ['El equipo está dado de baja. Para devolverlo al servicio usa «Revertir baja» en su ficha.'], 'no se revierte una baja por carga');
es(fila('codigo,estado\nBIO-BAJA,Dado de baja', 'actualizar').accion, 'sin_cambios', 'una baja que sigue de baja no es error');

// Fechas
const conFechas = fila('codigo,nombre,clase_riesgo,registro_sanitario,registro_emision,registro_vencimiento,fecha_adquisicion\nBIO-50,X,I,DNM-1,10/05/2026,2031-05-10,1/3/2022');
es([conFechas.nuevo.registroSanitarioEmision, conFechas.nuevo.registroSanitarioVencimiento, conFechas.nuevo.fechaAdquisicion],
  ['2026-05-10', '2031-05-10', '2022-03-01'], '«10/05/2026» → 2026-05-10 y AAAA-MM-DD');
es(errores(fila('codigo,nombre,clase_riesgo,registro_emision\nBIO-51,X,I,31/02/2026')), ['Emisión del registro: Fecha «31/02/2026» no válida. Usa DD/MM/AAAA.'], '«31/02/2026» es error');
es(errores(fila('codigo,nombre,clase_riesgo,registro_emision,registro_vencimiento\nBIO-52,X,I,2026-05-10,2026-05-09')), ['El vencimiento del registro es anterior a su emisión.'], 'vencimiento antes de la emisión');
es(errores(fila('codigo,nombre,clase_riesgo,fecha_adquisicion\nBIO-53,X,I,13/11/2026')), ['La fecha de adquisición no puede ser futura.'], 'adquisición futura');
es(errores(fila('codigo,nombre,clase_riesgo,registro_sanitario,registro_no_requiere\nBIO-54,X,I,DNM-1,sí')), ['Marca «no requiere registro» o escribe el número, no ambos.'], '«sí» en no requiere junto con un número');
es(fila('codigo,nombre,clase_riesgo,registro_no_requiere\nBIO-55,X,I,Sí').nuevo.registroSanitarioNoRequiere, true, '«Sí» en no requiere');

// Sede, ubicación y centro de costo
es(errores(fila(`${H},ubicacion\nBIO-60,X,I,Emergencia`)), ['Hay 2 ubicaciones «Emergencia» en distintas sedes: agrega la columna sucursal.'], 'ubicación ambigua sin sucursal');
es(fila(`${H},sucursal,ubicacion\nBIO-61,X,I,sede norte,EMERGENCIA`).nuevo.ubicacionId, 12, 'la sucursal desempata (sin mayúsculas)');
es(errores(fila(`${H},sucursal,ubicacion\nBIO-62,X,I,Sede Norte,UCI`)), ['La ubicación «UCI» no existe en la sucursal «Sede Norte».'], 'ubicación en otra sede');
es(errores(fila(`${H},sucursal\nBIO-63,X,I,Sede Sur`)), ['La sucursal «Sede Sur» no existe.'], 'sucursal inexistente');
es(errores(fila(`${H},ubicacion\nBIO-64,X,I,Bodega`)), ['La ubicación «Bodega» está desactivada.'], 'ubicación desactivada');
es(errores(fila(`${H},centro_costo\nBIO-65,X,I,CC-02`)), ['El centro de costo «CC-02» está desactivado.'], 'centro inactivo');
es(errores(fila(`${H},centro_costo\nBIO-66,X,I,CC-99`)), ['El centro de costo «CC-99» no existe en el catálogo.'], 'centro inexistente');
es(errores(fila(`${H},ubicacion,centro_costo\nBIO-67,X,I,UCI,CC-03`)), ['El centro de costo «CC-03» es de la sede «Sede Norte» y el equipo está en «Sede Central».'], 'centro de otra sede');
es(fila(`${H},ubicacion,centro_costo\nBIO-68,X,I,UCI,uci adultos`).nuevo.centroCostoId, 1, 'centro por su nombre');
es(fila(`${H}\nBIO-69,X,I`).avisos, ['Sin ubicación: el equipo no quedará en ninguna sede.'], 'aviso sin ubicación');

// Avisos de serie, número de activo y proveedor
es(fila(`${H},serie\nBIO-70,X,I,sn 123`).avisos.includes('La serie ya está registrada en BIO-1 · MONITOR.'), true, 'serie repetida (aviso)');
const seriesArchivo = plan(`${H},serie\nBIO-71,X,I,ABC-999\nBIO-72,Y,I,abc999`);
es(seriesArchivo.resultados[1].avisos.includes('Serie repetida en el archivo (fila 2).'), true, 'serie repetida en el archivo');
es(seriesArchivo.resultados[1].accion, 'crear', 'una serie repetida no bloquea');
es(fila(`${H},serie\nBIO-73,X,I,S/N`).avisos.some((a) => a.includes('serie')), false, '«S/N» no cuenta como serie');
es(fila(`${H},numero_activo\nBIO-74,X,I,af-9`).avisos.includes('El número de activo ya está registrado en BIO-1.'), true, 'número de activo repetido');
const proveedor = fila(`${H},proveedor\nBIO-75,X,I,Otra Casa`);
es([proveedor.accion, proveedor.nuevo.proveedorId, proveedor.avisos.includes('Proveedor «Otra Casa» no registrado: se deja sin proveedor.')], ['crear', null, true], 'proveedor desconocido (aviso)');
es(fila(`${H},proveedor\nBIO-76,X,I,biomedica s.a.`).nuevo.proveedorId, 7, 'proveedor por nombre');

// Lo que se crea: mayúsculas, QR y sin fechas de calibración
const creado = fila('codigo,nombre,clase_riesgo,marca,servicio,criticidad,ultima_calibracion,proxima_calibracion\nbio-80,monitor ñandú,III,marca á,quirófano,Alta,2026-01-01,2027-01-01');
es([creado.nuevo.codigo, creado.nuevo.nombre, creado.nuevo.marca, creado.nuevo.qrCode, creado.nuevo.criticidadOperacional, creado.nuevo.datosTecnicos],
  ['BIO-80', 'MONITOR ÑANDÚ', 'MARCA Á', 'QR-BIO-80', 'alta', '{"servicio":"QUIRÓFANO"}'], 'datos del alta');
es(['ultimaCalibracion' in creado.nuevo, 'proximaCalibracion' in creado.nuevo, 'esPatron' in creado.nuevo], [false, false, false], 'la carga no escribe calibración ni patrón');
es(creado.detalle.includes(I.NOTA_CALIBRACION), true, 'nota: las fechas de calibración no se cargan');
es(plan('codigo,nombre,clase_riesgo,ultima_calibracion\nBIO-81,X,I,2026-01-01').notas, [I.NOTA_CALIBRACION], 'nota general de calibración');
es(fila('codigo,nombre\nEQ-80,impresora', 'crear', 'equipo_general').nuevo.criticidadOperacional, 'media', 'criticidad media por defecto');

// Actualizar: celda vacía no borra; sin diferencias → sin_cambios; servicio se mezcla
const sinCambios = fila('codigo,nombre,marca,clase_riesgo,serie\nBIO-1,,,IIa,SN-123', 'actualizar');
es(sinCambios.accion, 'sin_cambios', 'una fila sin diferencias');
const vacias = fila('codigo,nombre,marca,modelo,clase_riesgo,centro_costo\nBIO-1,,,,,', 'actualizar');
es(vacias.accion, 'sin_cambios', 'celdas vacías no borran');
const actualizado = fila('codigo,clase_riesgo,servicio,centro_costo\nBIO-1,III,neonatos,', 'actualizar');
es(actualizado.accion, 'actualizar', 'actualiza');
es(Object.keys(actualizado.cambios).sort(), ['claseRiesgo', 'datosTecnicos'], 'solo cambia lo que trae dato');
es(actualizado.cambios.claseRiesgo, { antes: 'IIa', despues: 'III' }, 'cambio de clase');
es(JSON.parse(actualizado.cambios.datosTecnicos.despues), { servicio: 'NEONATOS' }, 'servicio se mezcla con lo que había');
es(actualizado.cambiosLegibles, ['Clase de riesgo', 'Datos técnicos'], 'etiquetas legibles');
es(actualizado.activoId, 1, 'id del equipo');
const cambioCentro = fila('codigo,centro_costo\nBIO-LEGADO,CC-03', 'actualizar');
es(cambioCentro.cambios.centroCostoId, { antes: null, despues: 3 }, 'centro en los cambios (id)');
es(cambioCentro.cambiosBitacora.centroCostoId, { antes: 'Sin centro de costo', despues: 'CC-03 · NORTE' }, 'centro legible en la bitácora');
es(fila('codigo,registro_no_requiere\nBIO-1,sí', 'actualizar').cambios.registroSanitarioNoRequiere, { antes: false, despues: true }, 'marcar «no requiere»');
es(errores(fila('codigo,area\nBIO-1,equipo_general', 'actualizar', null)), ['El equipo es de otra área (Equipos biomédicos).'], 'no cambia el área');
es(fila('codigo,tipo_unidad,refrigerante\nAC-1,mini split,r32', 'actualizar', 'aires').accion, 'sin_cambios', 'datos técnicos iguales aunque el JSON tenga otro orden');
es(JSON.parse(fila('codigo,refrigerante\nAC-1,R-410A', 'actualizar', 'aires').cambios.datosTecnicos.despues), { tipoUnidad: 'MINI SPLIT', refrigerante: 'R-410A' }, 'cambia solo el refrigerante');

// El CSV descargado se vuelve a cargar sin cambios
const fila1 = I.filaExportacion({ codigo: 'BIO-1', numeroActivo: 'AF-9', nombre: 'MONITOR', rubro: 'biomedico', tipo: 'biomedico', categoria: null,
  subcategoria: 'diagnostico', marca: null, modelo: null, serial: 'SN-123', anio: null, centroCodigo: 'CC-01', centroNombre: 'UCI ADULTOS',
  sucursal: 'Sede Central', ubicacionNombre: 'UCI', ubicacionDetalle: null, datosTecnicos: '{"servicio":"UCI"}', claseRiesgo: 'IIa',
  criticidadOperacional: 'media', registroSanitario: null, registroSanitarioEntidad: null, registroSanitarioEmision: null,
  registroSanitarioVencimiento: null, registroSanitarioNoRequiere: false, estado: 'operativo', fechaAdquisicion: null, vidaUtilAnios: null,
  valorAdquisicion: 1.234, proveedor: null, ultimaCalibracion: '2026-01-10', proximaCalibracion: '2027-01-10', bajaId: null, bajaFecha: null,
  bajaMotivo: null, bajaDestino: null, slaUrgenteHoras: 4, slaAltaHoras: 24, slaMediaHoras: 72, slaBajaHoras: 168 }, '2026-11-12');
es([fila1.rubro, fila1.subcategoria, fila1.criticidad, fila1.estado, fila1.registro_no_requiere, fila1.registro_estado, fila1.valor_adquisicion],
  ['Equipos biomédicos', 'Diagnóstico', 'Media', 'Operativo', 'No', 'Sin registro', '1.2340'], 'etiquetas, Sí/No y número sin ambigüedad');
const exportado = I.columnasExportacion();
const csvExportado = [exportado.map((c) => `"${c.label}"`).join(','), exportado.map((c) => `"${fila1[c.key]}"`).join(',')].join('\r\n');
const reimportado = I.planificarImportacion(csvExportado, ctx('actualizar', 'biomedico'));
es(reimportado.error, undefined, 'el CSV descargado se lee');
es(reimportado.columnasIgnoradas, [], 'todas las columnas descargadas se reconocen');
es(reimportado.resultados[0].accion, 'actualizar', 'solo cambian subcategoría y valor');
es(Object.keys(reimportado.resultados[0].cambios).sort(), ['subcategoria', 'valorAdquisicion'], 'lo demás queda igual');
es(reimportado.notas, [I.NOTA_CALIBRACION], 'avisa que las fechas de calibración no se cargan');

es(I.resumenAltaCarga('inventario.csv'), 'Alta por carga masiva (archivo «inventario.csv»)', 'resumen de alta');
es(I.resumenActualizacionCarga(['Clase de riesgo', 'Serie']), 'Actualizado por carga masiva: Clase de riesgo, Serie', 'resumen de cambio');

console.log(`PASS test-bio-importar: ${n} casos`);
