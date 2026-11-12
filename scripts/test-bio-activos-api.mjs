// Fase 59 · WP-A: APIs del inventario con las migraciones reales (incluida la 0059),
// sesión real y SQLite local: alta y edición del equipo (código, clase, centro de
// costo, fechas de calibración intactas), eliminar solo sin historial, serie
// repetida, centros de costo, carga masiva por tandas con bitácora y CSV de equipos.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Sin red en las pruebas de inventario'); };
let fixture;
let n = 0;
try {
  fixture = await setupConjuntos({ modules: {
    serie: 'pages/api/activos/serie', centros: 'pages/api/centros-costo/index', centro: 'pages/api/centros-costo/[id]',
    reportes: 'pages/api/reportes/[tipo]', baja: 'pages/api/activos/[id]/baja', revertir: 'pages/api/activos/[id]/baja-revertir',
    sistema: 'pages/api/activos/[id]/sistema', bulkSistema: 'pages/api/activos/bulk-sistema',
  } });
  const { app, sqlite, call, ctx, faults } = fixture;
  const one = (q, ...a) => { const r = sqlite.prepare(q).get(...a); return r ? { ...r } : r; };
  const run = (q, ...a) => sqlite.prepare(q).run(...a);
  const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
  const status = (r, esperado, nota) => { n++; assert.equal(r.status, esperado, `${nota}: ${JSON.stringify(r.body)}`); return r.body; };
  const crear = (data, rol = 'admin') => call(app.assetCreate.POST, '/api/activos', { method: 'POST', data, rol });
  const editar = (id, data, rol = 'admin') => call(app.assets.PATCH, `/api/activos/${id}`, { method: 'PATCH', id, data, rol });
  const borrar = (id, rol = 'admin') => call(app.assets.DELETE, `/api/activos/${id}`, { method: 'DELETE', id, rol });

  sqlite.exec(`
    INSERT INTO sucursales(id,nombre,codigo) VALUES(1,'Sede Central','SC'),(2,'Sede Norte','SN');
    INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'UCI',1),(2,'Emergencia',2);
    INSERT INTO centros_costo(id,codigo,nombre,sucursal_id,activo) VALUES(1,'CC-01','UCI ADULTOS',1,1),(2,'CC-02','NORTE',2,1),(3,'CC-03','CERRADO',NULL,0);
  `);

  // ── Alta: el jefe registra; código escrito ──
  const delJefe = status(await crear({ rubro: 'biomedico', claseRiesgo: 'IIa' }, 'jefe'), 201, 'el jefe registra').activo;
  es(delJefe.claseRiesgo, 'IIa', 'alta del jefe con clase');
  const escrito = status(await crear({ rubro: 'biomedico', codigo: 'bio-001', nombre: 'monitor', claseRiesgo: 'III', ubicacionId: 1, centroCostoId: 1, serial: 'SN-123' }), 201, 'código escrito').activo;
  es([escrito.codigo, escrito.qrCode, escrito.centroCostoId], ['BIO-001', 'QR-BIO-001', 1], 'el código queda en mayúsculas');
  es(status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', codigo: 'Bio-001' }), 409, 'duplicado en minúsculas').error, 'El código «BIO-001» ya está en uso en otro equipo.', 'mensaje de duplicado');
  es(status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', codigo: 'BIO\t002' }), 400, 'tabulador').error, 'El código no puede tener tabuladores ni saltos de línea.', 'mensaje del tabulador');
  status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', estado: 'baja' }), 400, 'un equipo nuevo no nace de baja');
  es(status(await crear({ rubro: 'aires', claseRiesgo: 'I' }), 400, 'clase en aires').error, 'La clase de riesgo, la subcategoría y el registro sanitario solo aplican a equipos biomédicos.', 'solo biomédicos');
  es(status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', registroSanitarioEmision: '2026-05-10', registroSanitarioVencimiento: '2026-05-09' }), 400, 'vencimiento antes de la emisión').error,
    'El vencimiento del registro no puede ser anterior a su emisión.', 'mensaje del vencimiento');
  status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', registroSanitarioEmision: '31/02/2026' }), 400, 'fecha de emisión no válida');
  es(status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', centroCostoId: 2, ubicacionId: 1 }), 400, 'centro de otra sede').error,
    'El centro de costo «CC-02» es de la sede «Sede Norte» y el equipo está en «Sede Central».', 'mensaje de centro de otra sede');
  status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', centroCostoId: 3 }), 400, 'centro desactivado');
  const noRequiere = status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', registroSanitario: 'X-1', registroSanitarioNoRequiere: true }), 201, 'no requiere registro').activo;
  es([noRequiere.registroSanitario, noRequiere.registroSanitarioNoRequiere], [null, true], '«no requiere» limpia el número');
  const conFechas = status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', ultimaCalibracion: '2026-01-01', proximaCalibracion: '2027-01-01', esPatron: true }), 201, 'las fechas de calibración se ignoran').activo;
  es([conFechas.ultimaCalibracion, conFechas.proximaCalibracion, conFechas.esPatron], [null, null, false], 'POST no escribe calibración ni patrón');
  status(await crear({ rubro: 'biomedico', claseRiesgo: 'I' }, 'visualizador'), 403, 'el visualizador no registra');

  // Ronda 2 · A2 (requisito 16): la clase es obligatoria en biomédicos también por la API.
  // Antes solo la exigían el formulario y la carga masiva: la API creaba el biomédico sin clase.
  const CLASE = 'Elige la clase de riesgo (I, IIa, IIb o III).';
  const altasAntes = one('SELECT count(*) n FROM activos').n;
  for (const data of [{ rubro: 'biomedico' }, { tipo: 'biomedico' }, { rubro: 'biomedico', claseRiesgo: null }, { rubro: 'biomedico', claseRiesgo: 'IV' }, { rubro: 'biomedico', claseRiesgo: '2a' }]) {
    es(status(await crear(data, 'jefe'), 400, `biomédico sin clase válida: ${JSON.stringify(data)}`).error, CLASE, 'mensaje de clase obligatoria (POST)');
  }
  es(one('SELECT count(*) n FROM activos').n, altasAntes, 'ningún biomédico sin clase quedó registrado');
  status(await crear({ rubro: 'equipo_general', nombre: 'impresora' }), 201, 'un equipo general sigue sin clase');

  // Revisión: el plan automático del alta cuenta «desde hoy» en El Salvador. A las
  // 19:30 de SV ya es el día siguiente en UTC: con new Date() el plan arrancaba un día tarde.
  const RelojReal = Date;
  fijarReloj('2026-11-12T19:30:00-06:00');
  try {
    const conPlan = status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', mantenimientoFrecuencia: 'mensual' }), 201, 'alta con plan mensual de noche').activo;
    es(one('SELECT proxima_fecha f FROM planes_mantenimiento WHERE activo_id=?', conPlan.id).f, '2026-12-12', 'un mes desde hoy en SV, no desde la fecha UTC');
    const cuatri = status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', mantenimientoFrecuencia: 'cuatrimestral' }), 201, 'rutina cuatrimestral (§h.20)').activo;
    es(one('SELECT frecuencia, proxima_fecha f FROM planes_mantenimiento WHERE activo_id=?', cuatri.id), { frecuencia: 'cuatrimestral', f: '2027-03-12' }, 'cuatro meses');
  } finally {
    globalThis.Date = RelojReal;
  }
  es(status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', mantenimientoFrecuencia: 'mensual', mantenimientoProximaFecha: '31/12/2026' }), 400, 'fecha del plan mal escrita').error,
    'La fecha del primer mantenimiento no es válida.', 'la primera fecha del plan se valida');
  status(await crear({ rubro: 'biomedico', claseRiesgo: 'I', mantenimientoFrecuencia: 'turno' }), 400, '«Por turno» no es una rutina de equipo');

  // ── Cambio de código ──
  es(status(await editar(escrito.id, { codigo: 'BIO-777' }, 'tecnico'), 403, 'el técnico no cambia el código').error,
    'Solo la jefatura o el administrador pueden cambiar el código del equipo.', 'mensaje al técnico');
  const recodificado = status(await editar(escrito.id, { codigo: 'bio-777' }, 'jefe'), 200, 'el jefe corrige el código').activo;
  es([recodificado.codigo, one('SELECT qr_code FROM activos WHERE id=?', escrito.id).qr_code], ['BIO-777', 'QR-BIO-777'], 'código y QR nuevos');
  es(status(await editar(escrito.id, { codigo: '', nombre: 'monitor 2' }, 'tecnico'), 200, 'código vacío no cambia').activo.codigo, 'BIO-777', 'vacío conserva el código');
  status(await editar(escrito.id, { codigo: 'X'.repeat(61) }), 400, 'código largo');

  // ── El error que borraba las fechas de calibración (K-A4) ──
  run(`INSERT INTO activos(id,codigo,nombre,qr_code,rubro,tipo,requiere_calibracion,ultima_calibracion,proxima_calibracion,es_patron)
       VALUES(50,'BAL-1','BALANZA','QR-BAL-1','equipo_general','general',1,'2026-03-01','2027-03-01',1)`);
  status(await editar(50, { nombre: 'balanza analítica', rubro: 'equipo_general', tipo: 'general', estado: 'operativo', requiereCalibracion: true,
    claseRiesgo: null, subcategoria: null, registroSanitario: null, registroSanitarioEntidad: null, registroSanitarioEmision: null,
    registroSanitarioVencimiento: null, registroSanitarioNoRequiere: false, ultimaCalibracion: null, proximaCalibracion: null, esPatron: false }), 200, 'lo que manda Editar');
  es(one('SELECT ultima_calibracion u, proxima_calibracion p, es_patron e FROM activos WHERE id=50'), { u: '2026-03-01', p: '2027-03-01', e: 1 }, 'las fechas y el patrón siguen igual');

  // ── Estado, clase y centro al editar ──
  es(status(await editar(escrito.id, { estado: 'baja' }), 400, 'baja por PATCH').error, 'Para dar de baja usa «Dar de baja» en la ficha del equipo.', 'mensaje de baja');
  status(await editar(escrito.id, { estado: 'averiado' }, 'tecnico'), 200, 'el técnico marca averiado (K-A3)');
  es(status(await editar(escrito.id, { claseRiesgo: null }), 400, 'borrar la clase de un biomédico').error, CLASE, 'mensaje de clase obligatoria (PATCH)');
  es(status(await editar(escrito.id, { claseRiesgo: 'IV' }), 400, 'clase fuera de la escala').error, CLASE, 'una clase que no existe, el mismo texto');
  status(await editar(escrito.id, { centroCostoId: 2 }), 400, 'centro de otra sede al editar');
  status(await editar(escrito.id, { ubicacionId: 2 }), 400, 'mover el equipo a otra sede con su centro');
  status(await editar(escrito.id, { ubicacionId: 2, centroCostoId: 2 }), 200, 'mover con un centro de esa sede');
  run('UPDATE centros_costo SET activo=0 WHERE id=2');
  status(await editar(escrito.id, { centroCostoId: 2, nombre: 'monitor 3' }), 200, 'un centro inactivo que ya tenía puede quedarse');
  run('UPDATE centros_costo SET activo=1 WHERE id=2');
  status(await editar(delJefe.id, { rubro: 'aires' }), 200, 'Clasificar cambia el área solo con {rubro}');
  status(await editar(delJefe.id, { claseRiesgo: null }), 200, 'y después limpia la clase');
  status(await editar(delJefe.id, { claseRiesgo: 'I' }), 400, 'un aire no lleva clase');
  // Ronda 2 · A2: pasar a biomédico sin clase → 400 (Clasificar manda el área y la clase juntas).
  es(status(await editar(delJefe.id, { rubro: 'biomedico' }), 400, 'pasar a biomédico sin clase').error, CLASE, 'mensaje al pasar a biomédico');
  es(status(await editar(delJefe.id, { rubro: 'biomedico', tipo: 'biomedico', nombre: 'otra vez monitor' }, 'jefe'), 400, 'como lo mandaría Editar sin clase').error, CLASE, 'Editar sin clase');
  es(one('SELECT rubro, clase_riesgo c FROM activos WHERE id=?', delJefe.id), { rubro: 'aires', c: null }, 'el rechazo no cambia nada');
  es(status(await editar(delJefe.id, { rubro: 'biomedico', claseRiesgo: 'IIb' }), 200, 'área y clase juntas').activo.claseRiesgo, 'IIb', 'pasa a biomédico con su clase');
  // Un biomédico viejo sin clase (dato anterior a la fase) sigue pudiendo cambiar otros datos
  // (Marcar averiado, aceptación, jerarquía); lo que no puede es quedar sin clase al tocarla.
  run(`INSERT INTO activos(id,codigo,nombre,qr_code,rubro,tipo) VALUES(70,'BIO-VIEJO','MONITOR VIEJO','QR-BIO-VIEJO','biomedico','biomedico')`);
  status(await editar(70, { estado: 'averiado' }, 'tecnico'), 200, 'biomédico viejo sin clase: marcar averiado (WP-F)');
  status(await editar(70, { aceptacionFecha: '2026-11-10', aceptacionResultado: 'aprobado' }), 200, 'biomédico viejo sin clase: aceptación (ficha)');
  es(status(await editar(70, { claseRiesgo: null, nombre: 'monitor viejo' }), 400, 'tocar la clase y dejarla vacía').error, CLASE, 'no se guarda sin clase');
  es(status(await editar(70, { claseRiesgo: 'I' }), 200, 'completar la clase').activo.claseRiesgo, 'I', 'la clase se completa');

  // ── Serie repetida ──
  const serie = status(await call(app.serie.GET, '/api/activos/serie?valor=sn%20123', { rol: 'tecnico' }), 200, 'buscar serie').coincidencias;
  es(serie.map((s) => s.codigo), ['BIO-777'], '«sn 123» encuentra «SN-123»');
  es(status(await call(app.serie.GET, `/api/activos/serie?valor=SN123&excluir=${escrito.id}`, { rol: 'jefe' }), 200, 'excluir el propio').coincidencias, [], 'sin el propio equipo');
  es(status(await call(app.serie.GET, '/api/activos/serie?valor=S/N'), 200, 'sin serie').coincidencias, [], '«S/N» no se compara');
  status(await call(app.serie.GET, '/api/activos/serie?valor=SN123', { rol: 'visualizador' }), 403, 'el visualizador no consulta series');

  // ── Eliminar: solo sin historial (K-A3) ──
  run("INSERT INTO calibraciones(activo_id,fecha_calibracion,usuario_id) VALUES(?, '2026-01-10', 1)", escrito.id);
  const conHistorial = status(await borrar(escrito.id), 409, 'con una calibración no se elimina');
  n++; assert.match(conHistorial.error, /^No se puede eliminar: el equipo tiene calibraciones\. Para retirarlo del servicio usa «Dar de baja»\.$/);
  run("INSERT INTO calibraciones(activo_id,fecha_calibracion,usuario_id,patron_activo_id) VALUES(?, '2026-01-11', 1, ?)", noRequiere.id, conFechas.id);
  n++; assert.match(status(await borrar(conFechas.id), 409, 'un patrón usado').error, /calibraciones donde se usó como patrón/);
  status(await borrar(delJefe.id, 'jefe'), 403, 'solo el administrador elimina');
  status(await borrar(delJefe.id), 200, 'sin historial se elimina');
  es(one('SELECT count(*) n FROM activos WHERE id=?', delJefe.id).n, 0, 'eliminado');

  // Revisión: vínculos que la base protege y HISTORIAL_ACTIVO no nombra. Antes el
  // DELETE chocaba con la llave foránea y respondía 500 sin motivo (K-A3 pide 409).
  run(`INSERT INTO activos(id,codigo,nombre,qr_code,rubro,tipo) VALUES
    (60,'INF-PADRE','TABLERO GENERAL','QR-INF-PADRE','infraestructura','general'),
    (61,'INF-HIJO','INTERRUPTOR','QR-INF-HIJO','infraestructura','general'),
    (62,'EQ-PASO','BALANZA','QR-EQ-PASO','equipo_general','general')`);
  run('UPDATE activos SET padre_id=60 WHERE id=61');
  es(status(await borrar(60), 409, 'un equipo con equipos que dependen de él').error,
    'No se puede eliminar: el equipo tiene equipos que dependen de él. Para retirarlo del servicio usa «Dar de baja».', 'motivo: la jerarquía');
  es(one('SELECT count(*) n FROM activos WHERE id=60').n, 1, 'el equipo padre sigue');
  run("INSERT INTO checklist_plantillas(id,nombre) VALUES(900,'PLANTILLA DE PRUEBA')");
  run("INSERT INTO checklist_plantilla_items(plantilla_id,texto,activo_id) VALUES(900,'Pesar el patrón',62)");
  n++; assert.match(status(await borrar(62), 409, 'un equipo citado en un paso de plantilla').error, /pasos de plantillas de checklist/);
  status(await borrar(61), 200, 'el equipo hijo, sin historial, sí se elimina');

  // ── Centros de costo ──
  const nuevoCentro = status(await call(app.centros.POST, '/api/centros-costo', { method: 'POST', data: { codigo: ' cc-10 ', nombre: ' pediatría ', sucursalId: 1 }, rol: 'jefe' }), 201, 'crear centro').centro;
  es([nuevoCentro.codigo, nuevoCentro.nombre, nuevoCentro.sucursalId], ['CC-10', 'PEDIATRÍA', 1], 'centro en mayúsculas');
  status(await call(app.centros.POST, '/api/centros-costo', { method: 'POST', data: { codigo: 'CC-10', nombre: 'Otro' } }), 409, 'código duplicado');
  status(await call(app.centros.POST, '/api/centros-costo', { method: 'POST', data: { codigo: 'CC-11', nombre: 'X', sucursalId: 99 } }), 400, 'sede inexistente');
  status(await call(app.centros.POST, '/api/centros-costo', { method: 'POST', data: { codigo: 'CC-12', nombre: 'Uno' }, rol: 'tecnico' }), 403, 'el técnico no crea centros');
  const pegada = status(await call(app.centros.POST, '/api/centros-costo', { method: 'POST', data: { lista: 'Código\tNombre\tSede\nCC-20\tCirugía\tSede Norte\nCC-21\tLaboratorio\t\nCC-10\tRepetido\t\nCC-22\tImagen\tSede Sur' } }), 200, 'lista pegada');
  es(pegada.creados, 2, 'dos centros nuevos');
  es(pegada.resultados.map((r) => [r.linea, r.codigo, r.error ?? null]), [
    [2, 'CC-20', null], [3, 'CC-21', null], [4, 'CC-10', 'El código «CC-10» ya existe.'], [5, 'CC-22', 'La sede «Sede Sur» no existe.'],
  ], 'resultado por línea');
  es(one("SELECT sucursal_id s FROM centros_costo WHERE codigo='CC-20'").s, 2, 'sede por nombre');
  es(status(await call(app.centro.DELETE, '/api/centros-costo/2', { method: 'DELETE', id: 2 }), 409, 'borrar uno en uso').error, 'Tiene 1 equipo: desactívalo en lugar de borrarlo.', 'mensaje de uso');
  es(status(await call(app.centro.PATCH, '/api/centros-costo/2', { method: 'PATCH', id: 2, data: { sucursalId: 1 } }), 409, 'cambiar la sede con equipos en otra').error,
    'Hay 1 equipo de este centro en otras sedes; cámbialos primero.', 'mensaje de sede');
  es(status(await call(app.centro.PATCH, '/api/centros-costo/1', { method: 'PATCH', id: 1, data: { activo: false } }), 200, 'desactivar').centro.activo, false, 'desactivado');
  status(await call(app.centro.PATCH, '/api/centros-costo/1', { method: 'PATCH', id: 1, data: { codigo: 'CC-10' } }), 409, 'cambiar a un código usado');
  status(await call(app.centro.DELETE, `/api/centros-costo/${nuevoCentro.id}`, { method: 'DELETE', id: nuevoCentro.id }), 200, 'borrar uno sin equipos');

  // ── Carga masiva ──
  const importar = (data, rol = 'admin') => call(app.assetImport.POST, '/api/admin/import-equipos', { method: 'POST', data: { area: 'biomedico', ...data }, rol });
  const filas = Array.from({ length: 5 }, (_, i) => `CM-${i + 1},equipo ${i + 1},I,UCI,CC-01`).join('\n');
  run('UPDATE centros_costo SET activo=1 WHERE id=1');
  const csv = `codigo,nombre,clase_riesgo,ubicacion,centro_costo\n${filas}`;
  const simulacion = status(await importar({ csv, dryRun: true, archivo: 'inventario.csv' }, 'jefe'), 200, 'simulación');
  es([simulacion.filas, simulacion.aInsertar, simulacion.insertados, simulacion.errores.length], [5, 5, 0, 0], 'simular no escribe');
  es(one("SELECT count(*) n FROM activos WHERE codigo LIKE 'CM-%'").n, 0, 'nada grabado al simular');
  const tanda1 = status(await importar({ csv, desde: 0, hasta: 2, archivo: 'inventario.csv' }), 200, 'primera tanda');
  es([tanda1.insertados, tanda1.resultados.map((r) => r.codigo)], [2, ['CM-1', 'CM-2']], 'solo el rango pedido');
  const tanda2 = status(await importar({ csv, desde: 2, hasta: 5, archivo: 'inventario.csv' }), 200, 'segunda tanda');
  es(tanda2.insertados, 3, 'el resto');
  const repetida = status(await importar({ csv }), 200, 'repetir el archivo');
  es([repetida.insertados, repetida.errores.length], [0, 5], 'lo ya grabado no se repite');
  const altas = sqlite.prepare("SELECT a.codigo, l.accion, l.resumen, l.usuario_id FROM audit_log l JOIN activos a ON a.id = l.entidad_id WHERE l.entidad='activo' AND a.codigo LIKE 'CM-%' ORDER BY a.codigo").all();
  es(altas.map((l) => [l.codigo, l.accion, l.resumen, l.usuario_id]), Array.from({ length: 5 }, (_, i) => [`CM-${i + 1}`, 'create', 'Alta por carga masiva (archivo «inventario.csv»)', 1]), 'una línea de bitácora por alta');
  const cambio = status(await importar({ csv: 'codigo,clase_riesgo,serie\nCM-1,III,ABC-1\nCM-2,I,\nCM-404,I,', modo: 'actualizar' }), 200, 'actualizar');
  es([cambio.actualizados, cambio.sinCambios, cambio.errores.map((e) => e.error)], [1, 1, ['No existe un equipo con ese código.']], 'actualiza, sin cambios y error');
  es(one("SELECT clase_riesgo c, serial s FROM activos WHERE codigo='CM-1'"), { c: 'III', s: 'ABC-1' }, 'cambios grabados');
  const linea = one("SELECT l.accion, l.cambios, l.resumen FROM audit_log l JOIN activos a ON a.id=l.entidad_id WHERE a.codigo='CM-1' AND l.accion='update'");
  es([linea.resumen, JSON.parse(linea.cambios).claseRiesgo], ['Actualizado por carga masiva: Serie, Clase de riesgo', { antes: 'I', despues: 'III' }], 'bitácora del cambio');
  const grande = `codigo,nombre,clase_riesgo\n${Array.from({ length: 201 }, (_, i) => `GR-${i},X,I`).join('\n')}`;
  es(status(await importar({ csv: grande }), 400, '201 filas sin rango').error, 'Graba por partes de hasta 200 filas.', 'tandas de 200');
  status(await importar({ csv, dryRun: true }, 'tecnico'), 403, 'el técnico no hace cargas masivas');
  const plantilla = await app.assetImport.GET(ctx('/api/admin/import-equipos?plantilla=1&area=biomedico', { rol: 'jefe' }));
  n++; assert.equal(plantilla.status, 200);
  const bytesPlantilla = Buffer.from(await plantilla.arrayBuffer());
  es([...bytesPlantilla.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'la plantilla lleva BOM para Excel');
  n++; assert.match(bytesPlantilla.subarray(3).toString('utf8'), /^codigo,numero_activo,nombre,area,.*clase_riesgo/);

  // ── CSV de equipos (D14, K-A2) ──
  run("UPDATE activos SET estado='baja' WHERE codigo='CM-5'");
  run("UPDATE activos SET clase_riesgo='III' WHERE codigo='CM-4'");
  const descargar = async (q, rol) => {
    const c = Object.assign(ctx(`/api/reportes/equipos?${q}`, { rol }), { params: { tipo: 'equipos' } });
    const r = await app.reportes.GET(c);
    return { status: r.status, texto: await r.text(), nombre: r.headers.get('content-disposition') };
  };
  faults.enforceColumnLimit = true;
  const csvVis = await descargar('area=biomedico&estado=vigentes&clase=III', 'visualizador');
  faults.enforceColumnLimit = false;
  es(csvVis.status, 200, 'el visualizador descarga');
  const lineas = csvVis.texto.replace(/^\uFEFF/, '').split('\r\n');
  es(lineas[0].split(',').slice(0, 4), ['Código', 'Número de activo', 'Nombre', 'Área'], 'encabezados en orden');
  n++; assert.ok(lineas[0].includes('Registro sanitario') && lineas[0].includes('No requiere registro') && lineas[0].includes('Acta de baja') && !lineas[0].includes('DNM'), lineas[0]);
  es(lineas.slice(1).map((l) => l.split(',')[0]).sort(), ['BIO-777', 'CM-1', 'CM-4'], 'vigentes y clase III');
  n++; assert.match(csvVis.nombre, /equipos_biomedico_vigentes_\d{8}\.csv/);
  const csvBaja = await descargar('area=biomedico&estado=baja', 'tecnico');
  es(csvBaja.texto.replace(/^\uFEFF/, '').split('\r\n').slice(1).map((l) => l.split(',')[0]), ['CM-5'], 'solo las bajas');
  es((await descargar('area=biomedico', 'solicitante')).status, 403, 'el solicitante no descarga');
  es((await descargar('q=abc-1', 'admin')).texto.split('\r\n').length, 2, 'la búsqueda filtra la descarga');

  // ── Ronda 2 · A6: las APIs del inventario responden 401 y 403 en JSON { error } (§c),
  //    no en texto plano: las pantallas muestran j.error. ──
  const enJson = (nombre, r, esperado) => {
    n++; assert.equal(r.status, esperado, `${nombre}: ${JSON.stringify(r.body)}`);
    n++; assert.ok(r.body && typeof r.body === 'object' && typeof r.body.error === 'string' && r.body.error.trim(), `${nombre}: cuerpo ${JSON.stringify(r.body)}`);
  };
  const sin = { rol: null };
  for (const [nombre, ruta, url, opciones, esperado] of [
    ['alta sin sesión', app.assetCreate.POST, '/api/activos', { method: 'POST', data: {}, ...sin }, 401],
    ['lista sin sesión', app.assetCreate.GET, '/api/activos', sin, 401],
    ['alta del solicitante', app.assetCreate.POST, '/api/activos', { method: 'POST', data: {}, rol: 'solicitante' }, 403],
    ['ficha sin sesión', app.assets.GET, '/api/activos/50', { id: 50, ...sin }, 401],
    ['editar del visualizador', app.assets.PATCH, '/api/activos/50', { method: 'PATCH', id: 50, data: { nombre: 'x' }, rol: 'visualizador' }, 403],
    ['eliminar del jefe', app.assets.DELETE, '/api/activos/50', { method: 'DELETE', id: 50, rol: 'jefe' }, 403],
    ['serie del visualizador', app.serie.GET, '/api/activos/serie?valor=ABC123', { rol: 'visualizador' }, 403],
    ['centro del técnico', app.centros.POST, '/api/centros-costo', { method: 'POST', data: { codigo: 'CC-90', nombre: 'X' }, rol: 'tecnico' }, 403],
    ['editar centro del técnico', app.centro.PATCH, '/api/centros-costo/1', { method: 'PATCH', id: 1, data: { nombre: 'X' }, rol: 'tecnico' }, 403],
    ['borrar centro del técnico', app.centro.DELETE, '/api/centros-costo/1', { method: 'DELETE', id: 1, rol: 'tecnico' }, 403],
    ['carga masiva del técnico', app.assetImport.POST, '/api/admin/import-equipos', { method: 'POST', data: { csv: 'codigo\nX-1' }, rol: 'tecnico' }, 403],
    ['plantilla del técnico', app.assetImport.GET, '/api/admin/import-equipos?plantilla=1&area=biomedico', { rol: 'tecnico' }, 403],
    ['baja del técnico', app.baja.POST, '/api/activos/50/baja', { method: 'POST', id: 50, data: {}, rol: 'tecnico' }, 403],
    ['revertir del técnico', app.revertir.POST, '/api/activos/50/baja-revertir', { method: 'POST', id: 50, data: {}, rol: 'tecnico' }, 403],
    ['familia del solicitante', app.sistema.PATCH, '/api/activos/50/sistema', { method: 'PATCH', id: 50, data: { sistema: null }, rol: 'solicitante' }, 403],
    ['familias en lote sin sesión', app.bulkSistema.POST, '/api/activos/bulk-sistema', { method: 'POST', data: { ids: [50], sistema: 'electrico' }, ...sin }, 401],
  ]) enJson(nombre, await call(ruta, url, opciones), esperado);
  const csvSinPermiso = await app.reportes.GET(Object.assign(ctx('/api/reportes/equipos', { rol: 'solicitante' }), { params: { tipo: 'equipos' } }));
  enJson('CSV de equipos del solicitante', { status: csvSinPermiso.status, body: await csvSinPermiso.json().catch(() => null) }, 403);

  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  console.log(`PASS test-bio-activos-api: ${n} casos`);
} finally {
  await fixture?.close();
  globalThis.fetch = originalFetch;
}
