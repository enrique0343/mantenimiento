// Tablero biomédico y empresa externa (14/11/2026): el tablero se separa por espacio
// (General sin nada biomédico, Biomédico solo lo biomédico), «Lo realiza» y su
// filtro, las calibraciones que vencen, los equipos pendientes de ubicación y su
// asignación con registro, la empresa que da mantenimiento en la API de equipos, y
// los roles. Rutas reales, migraciones reales, sin red. Personas @prueba.local.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';

fijarReloj();

const fixture = await setupConjuntos({ modules: {
  tablero: 'pages/api/preventivos/index', asignar: 'pages/api/preventivos/asignar', historial: 'pages/api/preventivos/[id]/historial',
  ubicar: 'pages/api/activos/asignar-ubicacion', bio: 'lib/tablero-bio', prev: 'lib/preventivos', db: 'lib/db',
} });
const { app, sqlite, faults, queries, call, close } = fixture;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
const all = (q, ...a) => sqlite.prepare(q).all(...a);
const run = (q, ...a) => sqlite.prepare(q).run(...a);
let n = 0;
const igual = (...a) => { assert.equal(...a); n++; };
const ok = (...a) => { assert.ok(...a); n++; };
const iguales = (...a) => { assert.deepEqual(...a); n++; };

const HOY = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const dia = (k) => new Date(Date.parse(`${HOY}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
const ddmm = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const JEFE = 2;

run(`INSERT INTO usuarios(id,nombre,email,password_hash,rol,activo,especialidad) VALUES
  (20,'Técnico General','tecnico.general@prueba.local','x','tecnico',1,'general'),
  (21,'Técnico Bio','tecnico.bio@prueba.local','x','tecnico',1,'biomedico'),
  (22,'Técnico Ambos','tecnico.ambos@prueba.local','x','tecnico',1,'ambos')`);
run("INSERT INTO sucursales(id,nombre) VALUES(7,'Hospital de prueba'),(8,'Clínica de prueba')");
run(`INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,padre_id,activa) VALUES
  (70,7,'Nivel 2','piso',NULL,1),(71,7,'Bloque quirúrgico','area',70,1),(72,7,'Sunshine','sala',71,1),
  (73,7,'Sala cerrada','sala',71,0),(80,8,'Consulta','area',NULL,1)`);
run("INSERT INTO proveedores(id,nombre,activo) VALUES(1,'Empresa Uno',1),(2,'Empresa Dos',1),(3,'Empresa Inactiva',0)");

let k = 0;
const equipo = ({ codigo = `BIO-${String(++k).padStart(3, '0')}`, rubro = 'biomedico', ubicacionId = 72, ubicacion = null, proveedorId = null, estado = 'operativo' } = {}) =>
  Number(run('INSERT INTO activos(codigo,nombre,rubro,tipo,ubicacion_id,ubicacion,proveedor_id,estado) VALUES(?,?,?,?,?,?,?,?)',
    codigo, `Equipo ${codigo}`, rubro, rubro === 'biomedico' ? 'biomedico' : 'general', ubicacionId, ubicacion, proveedorId, estado).lastInsertRowid);
const plan = (activoId, fecha, extra = {}) => Number(run(
  'INSERT INTO planes_mantenimiento(activo_id,titulo,frecuencia,proxima_fecha,asignado_a,proveedor_id,modalidad) VALUES(?,?,?,?,?,?,?)',
  activoId, extra.titulo ?? 'Preventivo semestral', 'semestral', fecha, extra.asignadoA ?? null, extra.proveedorId ?? null, extra.proveedorId ? 'contratado' : 'interno',
).lastInsertRowid);
const calibracion = (activoId, fecha, proxima, extra = {}) => run(
  "INSERT INTO calibraciones(activo_id,fecha_calibracion,proxima_calibracion,resultado,certificado_r2_key,usuario_id) VALUES(?,?,?,?,?,1)",
  activoId, fecha, proxima, extra.resultado ?? 'conforme', extra.sinCertificado ? null : 'cert/x.pdf');
const tablero = (query = '', rol = 'admin') => call(app.tablero.GET, `/api/preventivos${query}`, { rol });
const bio = (query = '', rol = 'admin') => tablero(`?espacio=biomedico${query ? `&${query}` : ''}`, rol);
const asignar = (planIds, tecnicoId, rol = 'admin') => call(app.asignar.POST, '/api/preventivos/asignar', { method: 'POST', data: { planIds, tecnicoId }, rol });
const ubicar = (activoIds, ubicacionId, rol = 'admin') => call(app.ubicar.POST, '/api/activos/asignar-ubicacion', { method: 'POST', data: { activoIds, ubicacionId }, rol });
const patchActivo = (id, data, rol = 'admin') => call(app.assets.PATCH, `/api/activos/${id}`, { method: 'PATCH', id, data, rol });
const especialidad = (id, e) => run('UPDATE usuarios SET especialidad=? WHERE id=?', e, id);
const filas = (t) => [...t.programados, ...t.atrasados.sinAsignar, ...t.atrasados.asignados];

try {
  // Equipos: biomédicos con y sin empresa, uno general, uno pendiente de ubicación.
  const bPropio = equipo();                                   // personal propio
  const bEquipo = equipo({ proveedorId: 1 });                 // la empresa del equipo
  const bPlan = equipo({ proveedorId: 1 });                   // el plan trae otra empresa
  const gAire = equipo({ codigo: 'AA-001', rubro: 'aires' });  // general
  const bPend = equipo({ ubicacionId: null, ubicacion: 'Quirófano Azul C. M.' });
  const pPropio = plan(bPropio, dia(3)), pEquipo = plan(bEquipo, dia(4)), pPlan = plan(bPlan, dia(5), { proveedorId: 2 });
  const pAire = plan(gAire, dia(2)), pPend = plan(bPend, dia(-2));

  // ── Separación por espacio ───────────────────────────────────────────────────
  let t = (await tablero()).body;
  igual(t.espacio, 'general');
  iguales(filas(t).map((f) => f.planId), [pAire], 'General: nada biomédico');
  igual(t.biomedico, null, 'General no trae lo del tablero biomédico');
  ok(t.programados.every((f) => f.equipo.area !== 'biomedico'));
  t = (await bio()).body;
  igual(t.espacio, 'biomedico');
  iguales(t.programados.map((f) => f.planId), [pPropio, pEquipo, pPlan], 'Biomédico: solo lo biomédico');
  iguales(t.atrasados.sinAsignar.map((f) => f.planId), [pPend]);
  ok(!filas(t).some((f) => f.planId === pAire), 'Sin el aire');
  // Técnicos del espacio: el de general no sale en Biomédico ni el de biomédico en General.
  const delEspacio = (l) => l.map((x) => x.id).filter((id) => id >= 20).sort((a, b) => a - b);
  iguales(delEspacio(t.tecnicos), [21, 22], 'Técnicos de biomédico y de ambos');
  iguales(delEspacio((await tablero()).body.tecnicos), [20, 22], 'Técnicos de general y de ambos');

  // Un jefe de biomédico solo ve Biomédico, aunque pida General.
  especialidad(JEFE, 'biomedico');
  t = (await tablero('?espacio=general', 'jefe')).body;
  igual(t.espacio, 'biomedico', 'Bloqueado a su espacio');
  ok(!filas(t).some((f) => f.planId === pAire));
  let r = await asignar([pAire], 20, 'jefe');
  igual(r.status, 403, 'Un plan del otro espacio'); igual(r.body.error, 'Este registro es del espacio General.');
  r = await asignar([pPropio, pAire], 21, 'jefe');
  igual(r.status, 403, 'Lote mezclado: todo o nada');
  igual(one('SELECT asignado_a a FROM planes_mantenimiento WHERE id=?', pPropio).a, null, 'No cambió ninguno');
  igual(all("SELECT 1 FROM audit_log WHERE entidad='plan' AND entidad_id IN (?,?)", pPropio, pAire).length, 0, 'Ni dejó registro');
  r = await call(app.historial.GET, `/api/preventivos/${pAire}/historial`, { id: pAire, rol: 'jefe' });
  igual(r.status, 403, 'Historial del otro espacio'); ok(typeof r.body.error === 'string');
  igual((await call(app.historial.GET, `/api/preventivos/${pPropio}/historial`, { id: pPropio, rol: 'jefe' })).status, 200);
  r = await asignar([pPropio], 21, 'jefe');
  igual(r.status, 200, JSON.stringify(r.body)); igual(r.body.planes, 1);
  // Un jefe de general, al revés.
  especialidad(JEFE, 'general');
  t = (await tablero('?espacio=biomedico', 'jefe')).body;
  igual(t.espacio, 'general'); igual(t.biomedico, null);
  igual((await asignar([pPropio], 22, 'jefe')).status, 403);
  especialidad(JEFE, null);
  igual((await tablero('?espacio=biomedico', 'jefe')).body.espacio, 'biomedico', 'Sin especialidad, los dos (con interruptor)');

  // El técnico tiene que ser del espacio del preventivo.
  r = await asignar([pEquipo], 20);
  igual(r.status, 400); ok(/general/i.test(r.body.error) && /no ve los preventivos biomédicos/.test(r.body.error), r.body.error);
  r = await asignar([pAire], 21);
  igual(r.status, 400, 'Uno de biomédico no recibe un aire');
  igual((await asignar([pAire], 22)).status, 200, '«Ambos» sirve para los dos');

  // ── Lo realiza y su filtro ─────────────────────────────────────────────────
  t = (await bio()).body;
  const fila = (id) => filas(t).find((f) => f.planId === id);
  igual(fila(pPropio).empresa, null, 'Personal propio');
  iguales(fila(pEquipo).empresa, { id: 1, nombre: 'Empresa Uno' }, 'La empresa del equipo');
  iguales(fila(pPlan).empresa, { id: 2, nombre: 'Empresa Dos' }, 'La del plan gana a la del equipo');
  iguales(t.biomedico.empresas.map((e) => e.nombre), ['Empresa Dos', 'Empresa Uno'], 'Empresas para el filtro');
  iguales((await bio('empresa=1')).body.programados.map((f) => f.planId), [pEquipo], 'Filtro por empresa');
  iguales((await bio('empresa=2')).body.programados.map((f) => f.planId), [pPlan]);
  iguales((await bio('empresa=propio')).body.programados.map((f) => f.planId), [pPropio]);
  iguales((await bio('empresa=externa')).body.programados.map((f) => f.planId), [pEquipo, pPlan]);
  igual((await bio('empresa=x')).body.programados.length, 3, 'Un valor raro no filtra');
  igual((await tablero('?empresa=1')).body.filtros.empresa, null, 'En General no hay filtro de empresa');
  igual(t.biomedico.conEmpresa, 2, 'Con empresa externa: dos equipos');
  // Una empresa solo en un preventivo activo también cuenta.
  const bSoloPlan = equipo(); plan(bSoloPlan, dia(60), { proveedorId: 2 });
  igual((await bio()).body.biomedico.conEmpresa, 3);
  igual((await bio('sede=8')).body.biomedico.conEmpresa, 0, 'Por sede');
  // La empresa que realiza una OT: la del plan, si no la del equipo.
  const db = app.db.getDb(fixture.ctx('/x'));
  iguales(await app.bio.empresaQueRealiza(db, { planId: pPlan, activoId: bPlan }), { id: 2, nombre: 'Empresa Dos' });
  iguales(await app.bio.empresaQueRealiza(db, { planId: pEquipo, activoId: bEquipo }), { id: 1, nombre: 'Empresa Uno' });
  iguales(await app.bio.empresaQueRealiza(db, { planId: null, activoId: bEquipo }), { id: 1, nombre: 'Empresa Uno' }, 'Un correctivo');
  igual(await app.bio.empresaQueRealiza(db, { planId: pPropio, activoId: bPropio }), null);
  igual(app.bio.textoLoRealiza(null), 'Personal propio');
  iguales([app.bio.leerFiltroEmpresa('propio'), app.bio.leerFiltroEmpresa('externa'), app.bio.leerFiltroEmpresa('7'), app.bio.leerFiltroEmpresa('-1'), app.bio.leerFiltroEmpresa('')], ['propio', 'externa', 7, null, null]);

  // ── Calibraciones vencidas y por vencer en 30 días ────────────────────────
  const cVencida = equipo(), cPorVencer = equipo(), cSinCert = equipo(), cVigente = equipo(), cBaja = equipo({ estado: 'baja' });
  const cGeneral = equipo({ codigo: 'BAL-001', rubro: 'equipo_general' });
  run('UPDATE activos SET requiere_calibracion=1 WHERE id=?', cGeneral);
  calibracion(cVencida, dia(-400), dia(-5));
  calibracion(cPorVencer, dia(-340), dia(25));
  calibracion(cSinCert, dia(-340), dia(10), { sinCertificado: true });
  calibracion(cVigente, dia(-300), dia(65));
  calibracion(cBaja, dia(-400), dia(-5));
  calibracion(cGeneral, dia(-400), dia(-5));
  t = (await bio()).body;
  const cal = t.biomedico.calibraciones;
  ok(cal.vencidas.some((c) => c.activoId === cVencida), 'La vencida');
  const v = cal.vencidas.find((c) => c.activoId === cVencida);
  igual(v.proximaTexto, ddmm(dia(-5)), 'DD/MM/AAAA'); igual(v.vence, 'venció hace 5 días'); igual(v.estadoTexto, 'Vencida');
  iguales(cal.porVencer.map((c) => c.activoId).sort((a, b) => a - b), [cPorVencer, cSinCert], 'Por vencer en 30 días');
  ok(cal.porVencer.some((c) => c.activoId === cPorVencer && c.dias === 25), 'En 25 días');
  ok(cal.porVencer.some((c) => c.activoId === cSinCert), 'Aunque le falte el certificado');
  ok(![...cal.vencidas, ...cal.porVencer].some((c) => [cVigente, cBaja, cGeneral].includes(c.activoId)), 'Ni la vigente, ni la de baja, ni la general');
  ok(!cal.vencidas.some((c) => c.activoId === bPropio), 'Un biomédico sin ninguna calibración no es «vencida»: sale en Calibraciones como «Sin calibración»');

  // ── Pendientes de ubicación ────────────────────────────────────────────────
  const gPend = equipo({ codigo: 'AA-002', rubro: 'aires', ubicacionId: null, ubicacion: 'Azotea' });
  const bPend2 = equipo({ ubicacionId: null, ubicacion: 'Hospitalización segundo nivel', proveedorId: 1 });
  const bPend3 = equipo({ ubicacionId: null });
  t = (await bio()).body;
  const pend = t.biomedico.pendientes;
  iguales(pend.map((p) => p.activoId).sort((a, b) => a - b), [bPend, bPend2, bPend3].sort((a, b) => a - b), 'Solo biomédicos sin ubicación');
  const p1 = pend.find((p) => p.activoId === bPend);
  igual(p1.texto, 'Pendiente de asignar · según inventario: Quirófano Azul C. M.');
  igual(pend.find((p) => p.activoId === bPend3).texto, 'Pendiente de asignar');
  igual(pend.find((p) => p.activoId === bPend2).empresa, 'Empresa Uno');
  const fPend = t.atrasados.sinAsignar.find((f) => f.planId === pPend);
  ok(fPend.ubicacionPendiente && fPend.ubicacionInventario === 'Quirófano Azul C. M.', 'La fila del preventivo dice que falta la ubicación');
  ok(!t.biomedico.pendientes.some((p) => p.activoId === gPend), 'El aire pendiente no sale en Biomédico');

  // Árbol sede → ubicación con su ruta; sin lo desactivado.
  const arbol = await app.bio.arbolUbicaciones(db);
  ok(arbol.ubicaciones.some((u) => u.id === 72 && u.ruta === 'Nivel 2 · Bloque quirúrgico · Sunshine' && u.sedeId === 7), 'La ruta');
  ok(!arbol.ubicaciones.some((u) => u.id === 73), 'Sin las desactivadas');
  iguales(arbol.sedes.map((s) => s.id).sort(), [7, 8]);

  // Asignar: roles, validación, todo o nada y registro.
  for (const rol of ['tecnico', 'visualizador', 'solicitante']) igual((await ubicar([bPend], 72, rol)).status, 403, `${rol} no asigna`);
  igual((await ubicar([bPend], 73)).status, 400, 'Ubicación desactivada');
  igual((await ubicar([bPend], 9999)).status, 404, 'Ubicación que no existe');
  igual((await ubicar([bPend, 99999], 72)).status, 404, 'Equipo que no existe');
  igual((await ubicar([], 72)).status, 400);
  igual((await ubicar([bPend], null)).status, 400, 'Sin ubicación');
  r = await ubicar([bPend, bPropio], 72);
  igual(r.status, 409, 'Uno ya tiene ubicación'); ok(r.body.error.includes(one('SELECT codigo c FROM activos WHERE id=?', bPropio).c));
  igual(one('SELECT ubicacion_id u FROM activos WHERE id=?', bPend).u, null, 'Todo o nada');
  especialidad(JEFE, 'general');
  igual((await ubicar([bPend], 72, 'jefe')).status, 403, 'Un jefe de general no ubica un biomédico');
  especialidad(JEFE, null);
  // Centro de costo de otra sede.
  run("INSERT INTO centros_costo(id,codigo,nombre,sucursal_id,activo) VALUES(5,'CC-CLI','CONSULTA',8,1)");
  run('UPDATE activos SET centro_costo_id=5 WHERE id=?', bPend3);
  r = await ubicar([bPend3], 72);
  igual(r.status, 409, 'Centro de costo de otra sede'); ok(/CC-CLI/.test(r.body.error));
  igual((await ubicar([bPend3], 80)).status, 200, 'En su sede, sí');

  r = await ubicar([bPend, bPend2], 72, 'jefe');
  igual(r.status, 200, JSON.stringify(r.body)); igual(r.body.n, 2);
  igual(r.body.ruta, 'Hospital de prueba · Nivel 2 · Bloque quirúrgico · Sunshine');
  iguales(all(`SELECT ubicacion_id u, ubicacion t FROM activos WHERE id IN (${bPend},${bPend2}) ORDER BY id`).map((x) => ({ ...x })),
    [{ u: 72, t: 'Quirófano Azul C. M.' }, { u: 72, t: 'Hospitalización segundo nivel' }], 'Asignada; el texto del inventario se conserva');
  const reg = one("SELECT * FROM audit_log WHERE entidad='activo' AND entidad_id=? AND accion='ubicacion'", bPend);
  ok(reg, 'Queda registro'); igual(reg.usuario_id, JEFE, 'Quién'); ok(reg.created_at, 'Cuándo');
  iguales(JSON.parse(reg.cambios), { ubicacion: { antes: 'Pendiente de asignar · según inventario: Quirófano Azul C. M.', despues: 'Hospital de prueba · Nivel 2 · Bloque quirúrgico · Sunshine' } }, 'Antes → después');
  ok(reg.resumen.startsWith('Asignó la ubicación'), reg.resumen);
  igual(all("SELECT 1 FROM audit_log WHERE entidad='activo' AND accion='ubicacion' AND entidad_id=?", bPend2).length, 1, 'Uno por equipo');
  t = (await bio()).body;
  ok(!t.biomedico.pendientes.some((p) => [bPend, bPend2].includes(p.activoId)), 'Ya no están pendientes');
  igual(t.atrasados.sinAsignar.find((f) => f.planId === pPend).ubicacion, 'Nivel 2 · Bloque quirúrgico · Sunshine');
  igual((await ubicar([bPend], 80)).status, 409, 'Una vez asignada no se pisa desde aquí');
  // La ubicación de un aire pendiente la asigna también la jefatura de general (la ficha sirve para todos los espacios).
  especialidad(JEFE, 'general');
  igual((await ubicar([gPend], 80, 'jefe')).status, 200);
  especialidad(JEFE, null);

  // ── Visualizador: ve el tablero biomédico, no cambia nada ──────────────────
  r = await bio('', 'visualizador');
  igual(r.status, 200); ok(r.body.biomedico && Array.isArray(r.body.biomedico.pendientes));
  igual((await bio('', 'tecnico')).status, 403, 'El técnico no ve el tablero');

  // ── Empresa que da mantenimiento en la API de equipos ──────────────────────
  r = await patchActivo(bPropio, { proveedorId: 1 }, 'tecnico');
  igual(r.status, 403, 'El técnico no cambia la empresa'); ok(/jefatura/.test(r.body.error));
  r = await patchActivo(bEquipo, { proveedorId: 1, nombre: 'Monitor de signos' }, 'tecnico');
  igual(r.status, 200, `Mandar la misma empresa no es un cambio: ${JSON.stringify(r.body)}`);
  igual((await patchActivo(bPropio, { proveedorId: 3 }, 'jefe')).status, 400, 'Empresa desactivada');
  igual((await patchActivo(bPropio, { proveedorId: 999 }, 'jefe')).status, 400, 'Empresa que no existe');
  r = await patchActivo(bPropio, { proveedorId: 2 }, 'jefe');
  igual(r.status, 200, JSON.stringify(r.body)); igual(one('SELECT proveedor_id p FROM activos WHERE id=?', bPropio).p, 2);
  r = await patchActivo(bPropio, { proveedorId: null }, 'admin');
  igual(r.status, 200); igual(one('SELECT proveedor_id p FROM activos WHERE id=?', bPropio).p, null, 'Vacío = personal propio');
  // Un equipo de cualquier espacio puede tener empresa.
  igual((await patchActivo(gAire, { proveedorId: 1 }, 'jefe')).status, 200);
  // Con la empresa desactivada después, guardar otra cosa no la borra.
  run('UPDATE proveedores SET activo=0 WHERE id=1');
  igual((await patchActivo(gAire, { proveedorId: 1, nombre: 'Aire del quirófano' }, 'jefe')).status, 200);
  run('UPDATE proveedores SET activo=1 WHERE id=1');
  r = await call(app.assetCreate.POST, '/api/activos', { method: 'POST', data: { nombre: 'Bomba de infusión', rubro: 'biomedico', claseRiesgo: 'IIb', proveedorId: 1 }, rol: 'tecnico' });
  igual(r.status, 403, 'El técnico registra el equipo, la empresa la pone la jefatura');
  r = await call(app.assetCreate.POST, '/api/activos', { method: 'POST', data: { nombre: 'Bomba de infusión', rubro: 'biomedico', claseRiesgo: 'IIb', proveedorId: 1 }, rol: 'jefe' });
  ok(r.status === 200 || r.status === 201, JSON.stringify(r.body)); igual(r.body.activo.proveedorId, 1);
  r = await call(app.assetCreate.POST, '/api/activos', { method: 'POST', data: { nombre: 'Bomba de jeringa', rubro: 'biomedico', claseRiesgo: 'IIb', proveedorId: null }, rol: 'tecnico' });
  ok(r.status === 200 || r.status === 201, 'Sin empresa, el técnico sí');

  // ── 150 equipos biomédicos sin pasar de 100 parámetros ─────────────────────
  run("INSERT INTO sucursales(id,nombre) VALUES(9,'Sede grande')");
  run("INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,padre_id,activa) VALUES(90,9,'Bodega biomédica','area',NULL,1)");
  const muchos = [], planesMuchos = [];
  for (let i = 0; i < 150; i++) {
    const e = equipo({ codigo: `GR-${String(i).padStart(3, '0')}`, ubicacionId: null, ubicacion: `Sala ${i}`, proveedorId: i % 3 ? 1 : null });
    muchos.push(e);
    planesMuchos.push(plan(e, i % 2 ? dia(1 + (i % 10)) : dia(-1 - (i % 5))));
    if (i % 4 === 0) calibracion(e, dia(-360), dia(i % 8 ? 10 : -3));
  }
  faults.enforceParameterLimit = true;
  faults.enforceColumnLimit = true;
  const desde = queries.length;
  t = (await bio()).body;
  ok(t.biomedico.pendientes.length >= 150, 'Los 150 pendientes');
  ok(filas(t).filter((f) => muchos.includes(f.equipo.id)).length === 150, 'Y sus 150 preventivos');
  igual((await bio('empresa=1')).status, 200);
  r = await asignar(planesMuchos, 21);
  igual(r.status, 200, JSON.stringify(r.body)); igual(r.body.planes, 150);
  r = await ubicar(muchos, 90);
  igual(r.status, 200, JSON.stringify(r.body)); igual(r.body.n, 150, 'En lote');
  igual(one("SELECT count(*) n FROM audit_log WHERE entidad='activo' AND accion='ubicacion' AND cambios LIKE '%Bodega biomédica%'").n, 150, 'Con su registro cada uno');
  const maximo = Math.max(...queries.slice(desde).map((q) => q.parameters));
  ok(maximo <= 100, `Máximo de parámetros: ${maximo}`);
  ok(maximo < 20, `Las listas viajan en un solo parámetro (máximo ${maximo})`);
  faults.enforceParameterLimit = false;
  faults.enforceColumnLimit = false;

  console.log(`tablero biomédico: ${n} verificaciones correctas`);
} finally {
  await close();
}
