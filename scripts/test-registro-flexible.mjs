// Exercise public handlers with real migrations, real authentication and local
// SQLite. No production credentials, browser session or network are involved.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('Network forbidden in asset registration tests'); };
let fixture;
try {
  fixture = await setupConjuntos();
  const { app, sqlite, call, faults } = fixture;
  const one = (sql, ...args) => sqlite.prepare(sql).get(...args);
  const rows = (sql, ...args) => sqlite.prepare(sql).all(...args);
  const saved = (id) => one('SELECT * FROM activos WHERE id=?', id);
  const create = (data = {}, options = {}) => call(app.assetCreate.POST, '/api/activos', { method: 'POST', data, ...options });
  const edit = (id, data, options = {}) => call(app.assets.PATCH, `/api/activos/${id}`, { method: 'PATCH', id, data, ...options });
  const expect = (result, status) => {
    assert.equal(result.status, status, JSON.stringify(result));
    return result.body;
  };
  const created = async (data, options) => expect(await create(data, options), 201).activo;
  const changed = async (id, data, options) => expect(await edit(id, data, options), 200).activo;
  const uppercase = (value) => value.trim().toUpperCase();
  const prefix = { biomedico: 'BIO', equipo_general: 'EQ', aires: 'AC', infraestructura: 'INF' };
  function automatic(row, area) {
    assert.equal(row.rubro, area);
    assert.equal(row.tipo, area === 'biomedico' ? 'biomedico' : 'general');
    assert.match(row.codigo, new RegExp(`^${prefix[area]}-[A-Z0-9]+$`));
    assert.equal(row.codigo, uppercase(row.codigo));
    assert.equal(row.qrCode, `QR-${row.codigo}`);
    assert.equal(saved(row.id).codigo, row.codigo);
    assert.equal(saved(row.id).qr_code, row.qrCode);
  }
  function pending(row) {
    assert.match(row.nombre, /PENDIENTE DE IDENTIFICAR/);
    assert.equal(row.nombre, uppercase(row.nombre));
    assert.equal(saved(row.id).nombre, row.nombre);
  }

  sqlite.exec(`
    INSERT INTO activos(id,codigo,nombre,qr_code,rubro,tipo,marca)
      VALUES(100,'Legacy-Abc','Nombre anterior sin modificar','QR-Legacy-Abc','biomedico','biomedico','Marca anterior');
    INSERT INTO activos(id,codigo,nombre,qr_code,rubro,tipo)
      VALUES(101,'legado-ñ-01','Registro legado con código Unicode','QR-legado-ñ-01','biomedico','biomedico');
    INSERT INTO sucursales(id,nombre) VALUES(1,'Sede de prueba');
    INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'Quirófano de prueba',1);
  `);
  const usersBefore = JSON.stringify(rows('SELECT * FROM usuarios ORDER BY id'));
  const legacyBefore = JSON.stringify(saved(100));
  const unicodeLegacyBefore = JSON.stringify(saved(101));

  // The smallest valid request and a request containing only its area both
  // produce durable, identifiable records without inventing medical details.
  const minimal = await created({});
  automatic(minimal, 'equipo_general');
  pending(minimal);
  assert.equal(minimal.criticidadOperacional, 'media');
  assert.equal(minimal.estado, 'operativo');
  assert.equal(minimal.datosTecnicos, null);
  const biomedical = await created({ rubro: 'biomedico' });
  automatic(biomedical, 'biomedico');
  pending(biomedical);
  assert.equal(biomedical.marca, null);
  assert.equal(biomedical.serial, null);
  assert.equal(biomedical.registroSanitario, null);
  assert.equal(biomedical.claseRiesgo, null);
  assert.equal(one('SELECT count(*) AS n FROM planes_mantenimiento').n, 0, 'An incomplete record must not acquire an unsolicited preventive plan');

  for (const [area, criticality] of Object.entries({ aires: 'alta', infraestructura: 'media', equipo_general: 'baja', biomedico: 'alta' })) {
    const row = await created({ rubro: area, codigo: '', nombre: '', criticidadOperacional: criticality });
    automatic(row, area);
    pending(row);
    assert.equal(row.criticidadOperacional, criticality);
  }
  const blanks = await created({
    rubro: 'biomedico', codigo: '  \t ', nombre: ' \n ', descripcion: '', ubicacion: null,
    numeroActivo: '', marca: null, modelo: '', serial: '', anio: null,
    categoria: '', registroSanitario: '', claseRiesgo: null,
    fechaAdquisicion: null, vidaUtilAnios: null, valorAdquisicion: null,
    responsableId: null, proveedorId: null, ubicacionId: null,
    ultimaCalibracion: null, proximaCalibracion: null, datosTecnicos: { servicio: '' },
    mantenimientoFrecuencia: null, mantenimientoTitulo: '', mantenimientoProximaFecha: null,
  });
  automatic(blanks, 'biomedico');
  pending(blanks);
  const nullIdentity = await created({ rubro: 'biomedico', codigo: null, nombre: null });
  automatic(nullIdentity, 'biomedico');
  pending(nullIdentity);

  // Simultaneous submissions must each persist their own code/QR. This checks
  // the database result, not only the random-code helper's return value.
  const simultaneous = await Promise.all(Array.from({ length: 30 }, (_, index) => create({ rubro: 'biomedico', nombre: `cámara simultánea ${index}` })));
  const concurrentAssets = simultaneous.map((result) => expect(result, 201).activo);
  assert.equal(new Set(concurrentAssets.map((row) => row.codigo)).size, concurrentAssets.length);
  assert.equal(new Set(concurrentAssets.map((row) => row.qrCode)).size, concurrentAssets.length);
  for (const row of concurrentAssets) automatic(row, 'biomedico');
  assert.deepEqual(rows('SELECT codigo FROM activos GROUP BY codigo HAVING count(*) > 1'), []);
  assert.deepEqual(rows('SELECT qr_code FROM activos WHERE qr_code IS NOT NULL GROUP BY qr_code HAVING count(*) > 1'), []);

  // Simulate a second registration winning the same generated code immediately
  // before the insert. The unique constraint must trigger a safe retry.
  let contestedCode;
  faults.beforeStatement = {
    matches(sql, parameters) {
      if (!/insert\s+into\s+["`]?activos/i.test(sql)) return false;
      contestedCode = parameters.find((value) => typeof value === 'string' && /^BIO-/.test(value));
      assert(contestedCode);
      return true;
    },
    async run() {
      sqlite.prepare('INSERT INTO activos(codigo,nombre,qr_code,rubro,tipo) VALUES(?,?,?,?,?)').run(contestedCode, 'REGISTRO SIMULTÁNEO DE PRUEBA', `QR-${contestedCode}`, 'biomedico', 'biomedico');
    },
  };
  const retried = await created({ rubro: 'biomedico' });
  automatic(retried, 'biomedico');
  assert.notEqual(retried.codigo, contestedCode);
  assert.equal(one('SELECT count(*) AS n FROM activos WHERE codigo=?', contestedCode).n, 1);

  const entered = {
    codigo: ' bio-manual-á-001 ', nombre: ' módulo de cámara pediátrica ñ ',
    descripcion: ' inspección de válvula\ncon conexión óptica ', ubicacion: ' quirófano número 2 ',
    numeroActivo: ' af-ñ-02 ', categoria: ' cámara endoscópica ', marca: ' marca de ejemplo ',
    modelo: ' visión hd-á ', serial: ' serie-ñ-2026 ', registroSanitario: ' dnm-á-001 ',
  };
  const full = await created({ ...entered, rubro: 'biomedico', datosTecnicos: { servicio: ' cirugía pediátrica ' }, claseRiesgo: 'IIa', ubicacionId: 1,
    anio: 2026, vidaUtilAnios: 0, valorAdquisicion: 0, requiereCalibracion: true,
    mantenimientoFrecuencia: 'mensual', mantenimientoProximaFecha: '2030-10-01',
    mantenimientoTitulo: ' revisión de lámpara y conexión óptica ', mantenimientoPrioridad: 'alta',
  });
  for (const [field, value] of Object.entries(entered)) assert.equal(full[field], uppercase(value), `${field} must persist uppercase entered through the API`);
  assert.deepEqual(JSON.parse(full.datosTecnicos), { servicio: 'CIRUGÍA PEDIÁTRICA' });
  const fullRead = expect(await call(app.assets.GET, `/api/activos/${full.id}`, { id: full.id }), 200).activo;
  for (const [field, value] of Object.entries(entered)) assert.equal(fullRead[field], uppercase(value));
  assert.equal(full.qrCode, `QR-${full.codigo}`);
  assert.equal(full.claseRiesgo, 'IIa', 'Protocol enum values are not converted to display-case text');
  assert.equal(full.valorAdquisicion, 0);
  assert.equal(full.vidaUtilAnios, 0);
  const plan = one('SELECT * FROM planes_mantenimiento WHERE activo_id=?', full.id);
  assert.equal(plan.titulo, 'REVISIÓN DE LÁMPARA Y CONEXIÓN ÓPTICA');
  assert.equal(plan.frecuencia, 'mensual');
  assert.equal(plan.prioridad, 'alta');
  assert.equal(plan.proxima_fecha, '2030-10-01');
  expect(await create({ rubro: 'biomedico', codigo: entered.codigo.toLowerCase() }), 409);
  expect(await create({ rubro: 'biomedico', codigo: 'legacy-abc' }), 409);
  for (const codigo of ['legado-ñ-01', 'LEGADO-Ñ-01']) expect(await create({ rubro: 'biomedico', codigo }), 409);
  const imported = expect(await call(app.assetImport.POST, '/api/admin/import-equipos', { method: 'POST', data: {
    area: 'biomedico',
    csv: 'codigo,nombre,rubro,marca,modelo,serial,categoria,descripcion,servicio\nlegacy-abc,No duplicar,biomedico,,,,,,\nbio-csv-ñ-001,módulo de cámara,biomedico,marca ñ,visión hd,serie-á,cámara,inspección óptica,cirugía',
  } }), 200);
  assert.equal(imported.insertados, 1, 'CSV import rejects the lowercase spelling of an existing mixed-case code');
  assert.equal(imported.errores.length, 1);
  const csvAsset = one('SELECT * FROM activos WHERE codigo=?', 'BIO-CSV-Ñ-001');
  assert.equal(csvAsset.nombre, 'MÓDULO DE CÁMARA');
  assert.equal(csvAsset.marca, 'MARCA Ñ');
  assert.equal(csvAsset.modelo, 'VISIÓN HD');
  assert.equal(csvAsset.serial, 'SERIE-Á');
  assert.equal(csvAsset.categoria, 'CÁMARA');
  assert.equal(csvAsset.descripcion, 'INSPECCIÓN ÓPTICA');
  assert.deepEqual(JSON.parse(csvAsset.datos_tecnicos), { servicio: 'CIRUGÍA' });
  assert.equal(csvAsset.qr_code, `QR-${csvAsset.codigo}`);
  for (const [area, technical] of Object.entries({
    aires: { tipoUnidad: 'mini split', capacidadBtuH: 12000, refrigerante: 'r-410a' },
    infraestructura: { tipoInstalacion: 'protección de cubierta', sector: 'pabellón ñ' },
    equipo_general: { servicio: 'administración' },
  })) {
    const row = await created({ rubro: area, datosTecnicos: JSON.stringify(technical) });
    const expected = Object.fromEntries(Object.entries(technical).map(([key, value]) => [key, typeof value === 'string' ? uppercase(value) : value]));
    assert.deepEqual(JSON.parse(row.datosTecnicos), expected);
  }

  // Unicode uppercasing may expand a character. Validate the final stored
  // length so the reader can still parse every accepted technical value.
  const expandingBoundary = 'ß'.repeat(100);
  const storedBoundary = 'SS'.repeat(100);
  const boundaryAsset = await created({ rubro: 'biomedico', datosTecnicos: { servicio: expandingBoundary } });
  assert.deepEqual(JSON.parse(boundaryAsset.datosTecnicos), { servicio: storedBoundary });
  assert.deepEqual(app.assetArea.leerDatosTecnicos(saved(boundaryAsset.id).datos_tecnicos), { servicio: storedBoundary });
  const boundaryRead = expect(await call(app.assets.GET, `/api/activos/${boundaryAsset.id}`, { id: boundaryAsset.id }), 200).activo;
  assert.deepEqual(app.assetArea.leerDatosTecnicos(boundaryRead.datosTecnicos), { servicio: storedBoundary });
  const patchedBoundary = await changed(blanks.id, { datosTecnicos: JSON.stringify({ servicio: expandingBoundary }) });
  assert.deepEqual(app.assetArea.leerDatosTecnicos(patchedBoundary.datosTecnicos), { servicio: storedBoundary });
  assert.deepEqual(app.assetArea.leerDatosTecnicos(saved(blanks.id).datos_tecnicos), { servicio: storedBoundary });
  const beforeInvalidLength = JSON.stringify(rows('SELECT * FROM activos ORDER BY id'));
  expect(await create({ rubro: 'biomedico', datosTecnicos: { servicio: 'ß'.repeat(101) } }), 400);
  assert.equal(JSON.stringify(rows('SELECT * FROM activos ORDER BY id')), beforeInvalidLength);
  expect(await edit(blanks.id, { nombre: 'No guardar parcialmente', datosTecnicos: { servicio: 'ß'.repeat(101) } }), 400);
  assert.equal(JSON.stringify(rows('SELECT * FROM activos ORDER BY id')), beforeInvalidLength);
  assert.deepEqual(app.assetArea.leerDatosTecnicos(JSON.stringify({ servicio: 'ß'.repeat(101) })), { servicio: 'ß'.repeat(101) }, 'Reading historical text must not uppercase it or discard it because its uppercase form is longer');

  // Incomplete records can be completed later. Blank/omitted code must not
  // sever the barcode already attached to the physical equipment.
  const completed = await changed(biomedical.id, { nombre: ' insuflador de laparoscopía ', serial: ' nuevA-ñ-09 ', datosTecnicos: { servicio: 'quirófano' }, codigo: '' }, { rol: 'tecnico' });
  assert.equal(completed.nombre, 'INSUFLADOR DE LAPAROSCOPÍA');
  assert.equal(completed.serial, 'NUEVA-Ñ-09');
  assert.equal(completed.codigo, biomedical.codigo);
  assert.equal(completed.qrCode, biomedical.qrCode);
  for (const code of [undefined, null, '', ' \t ']) {
    const edited = await changed(biomedical.id, { ...(code === undefined ? {} : { codigo: code }), marca: ' marca edición á ' });
    assert.equal(edited.codigo, biomedical.codigo);
    assert.equal(edited.qrCode, biomedical.qrCode);
    assert.equal(edited.nombre, completed.nombre, 'Omitting the name preserves the completed name');
    assert.equal(edited.marca, 'MARCA EDICIÓN Á');
  }
  for (const nombre of ['', ' \n ', null]) pending(await changed(blanks.id, { nombre }));
  const customCode = await changed(full.id, { codigo: ' bio-manual-á-002 ' });
  assert.equal(customCode.codigo, 'BIO-MANUAL-Á-002');
  assert.equal(customCode.qrCode, `QR-${customCode.codigo}`);
  expect(await edit(full.id, { codigo: 'legacy-abc' }), 409);
  for (const codigo of ['legado-ñ-01', 'LEGADO-Ñ-01']) expect(await edit(full.id, { codigo }), 409);
  assert.equal(saved(full.id).codigo, customCode.codigo);
  assert.equal(saved(full.id).qr_code, customCode.qrCode);

  // Clearing optional form fields does not relax the area/type invariants or
  // permit arbitrary enum/numeric values from a hand-written API request.
  for (const data of [
    { rubro: 'vehiculos' }, { rubro: null }, { rubro: '' },
    { criticidadOperacional: 'urgente' }, { criticidadOperacional: null },
    { estado: 'nuevo' }, { estado: null }, { codigo: 123 }, { nombre: [] },
    { rubro: 'aires', tipo: 'biomedico' },
    { rubro: 'biomedico', datosTecnicos: { refrigerante: 'r32' } },
    { rubro: 'aires', datosTecnicos: { capacidadBtuH: -1 } },
    { datosTecnicos: '{broken' }, { vidaUtilAnios: -1 }, { valorAdquisicion: -1 },
  ]) expect(await create(data), 400);
  for (const data of [
    { rubro: 'vehiculos' }, { estado: null }, { criticidadOperacional: 'urgente' },
    { tipo: 'general' }, { datosTecnicos: { refrigerante: 'r32' } },
  ]) expect(await edit(biomedical.id, data), 400);
  for (const data of [null, [], '']) expect(await create(data), 400);

  expect(await create({}, { rol: null }), 401);
  for (const rol of ['jefe', 'visualizador', 'solicitante', 'motorista', 'bodega']) expect(await create({}, { rol }), 403);
  automatic(await created({ rubro: 'biomedico' }, { rol: 'tecnico' }), 'biomedico');
  expect(await edit(biomedical.id, { nombre: 'No permitido' }, { rol: null }), 401);
  for (const rol of ['visualizador', 'solicitante', 'motorista', 'bodega']) expect(await edit(biomedical.id, { nombre: 'No permitido' }, { rol }), 403);
  assert.equal((await changed(biomedical.id, { modelo: 'edición del jefe' }, { rol: 'jefe' })).modelo, 'EDICIÓN DEL JEFE');

  sqlite.prepare('INSERT INTO ordenes(titulo,activo_id,creado_por,rubro) VALUES(?,?,?,?)').run('Orden vinculada de prueba', biomedical.id, 1, 'biomedico');
  const beforeRejectedAreaChange = JSON.stringify(saved(biomedical.id));
  expect(await edit(biomedical.id, { rubro: 'aires', nombre: '' }), 409);
  assert.equal(JSON.stringify(saved(biomedical.id)), beforeRejectedAreaChange);
  assert.equal((await changed(biomedical.id, { descripcion: ' información completada sin perder la orden ' })).descripcion, 'INFORMACIÓN COMPLETADA SIN PERDER LA ORDEN');

  // A plan-writing failure must roll back its new asset too, avoiding an
  // ambiguous retry that would create a second automatically numbered asset.
  const beforeFailedPlan = JSON.stringify(rows('SELECT * FROM activos ORDER BY id'));
  const beforePlans = JSON.stringify(rows('SELECT * FROM planes_mantenimiento ORDER BY id'));
  faults.statement = (sql) => /insert\s+into\s+["`]?planes_mantenimiento/i.test(sql);
  let failedPlan = false;
  try { failedPlan = (await create({ rubro: 'biomedico', mantenimientoFrecuencia: 'mensual' })).status >= 500; }
  catch { failedPlan = true; }
  assert(failedPlan, 'Injected failure must not return a successful partial registration');
  assert.equal(JSON.stringify(rows('SELECT * FROM activos ORDER BY id')), beforeFailedPlan);
  assert.equal(JSON.stringify(rows('SELECT * FROM planes_mantenimiento ORDER BY id')), beforePlans);
  const defaultPlanAsset = await created({ rubro: 'biomedico', mantenimientoFrecuencia: 'mensual', mantenimientoTitulo: '  ' });
  const defaultPlan = one('SELECT titulo FROM planes_mantenimiento WHERE activo_id=?', defaultPlanAsset.id);
  assert(defaultPlan.titulo.trim().length > 0);
  assert.equal(defaultPlan.titulo, uppercase(defaultPlan.titulo));

  assert.equal(JSON.stringify(saved(100)), legacyBefore, 'Existing codes and descriptive data must not be rewritten in bulk');
  assert.equal(JSON.stringify(saved(101)), unicodeLegacyBefore, 'Unicode duplicate detection must not rewrite the original code or QR');
  assert.equal(JSON.stringify(rows('SELECT * FROM usuarios ORDER BY id')), usersBefore, 'Registration must not modify user accounts');
  assert.deepEqual(rows('PRAGMA foreign_key_check'), []);
  assert.equal(networkCalls, 0);
  console.log(`PASS: ${fixture.requests} solicitudes de registro flexible; códigos únicos concurrentes y QR, campos vacíos, mayúsculas con acentos, edición posterior, planes atómicos, permisos y datos previos intactos.`);
} finally {
  await fixture?.close();
  globalThis.fetch = originalFetch;
}
