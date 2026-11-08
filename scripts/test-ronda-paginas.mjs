// Las pantallas de jefatura de la ronda, construidas de verdad, contra migraciones reales. Correr después de npm run build.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { experimental_AstroContainer } from 'astro/container';
import { parse as parseHtml } from 'parse5';
import { createRequire } from 'node:module';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';

fijarReloj();
const beforeMigration = (db, n) => { if (n.startsWith('0049_fase49')) db.exec("INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin')"); };
const f = await setupConjuntos({ beforeMigration, modules: { hoy: 'pages/api/campo/hoy', sync: 'pages/api/campo/sync', puntos: 'pages/api/ronda-turno/puntos' } });
const { app, sqlite, call, DB } = f;
const raiz = process.cwd();
const cargar = async (rel) => (await import(pathToFileURL(path.join(raiz, 'dist/_worker.js/pages', rel)).href)).page().default;
let checks = 0; const ok = (c, m) => { assert.ok(c, m); checks++; };
const nodos = (n, pred, out = []) => { if (pred(n)) out.push(n); for (const c of n.childNodes ?? []) nodos(c, pred, out); return out; };
const attr = (n, a) => n?.attrs?.find((x) => x.name === a)?.value;
const texto = (n) => (n?.nodeName === '#text' ? n.value : (n?.childNodes ?? []).map(texto).join('')).replace(/\s+/g, ' ').trim();
const porId = (doc, id) => nodos(doc, (n) => attr(n, 'id') === id)[0];
try {
  sqlite.exec("INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede Uno',1),(2,'Sede Dos',1)");
  const r = (await call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' })).body.ronda;
  const clave = { sucursalId: 1, fecha: r.fecha, turno: r.turno };
  const pts = r.puntos; let n = 0;
  const op = (tipo, extra) => ({ opId: `pag-${++n}-${tipo}`, tipo, at: new Date(Date.now() - (60 - n) * 60000).toISOString(), ...clave, ...extra });
  let resto = pts.map((p) => op('ronda.lectura', { puntoId: p.id, resultado: /^Quirófanos · temperatura/.test(p.texto) ? 'fuera' : 'ok', ...(p.pideValor ? { valor: /^Quirófanos · temperatura/.test(p.texto) ? 25 : p.min ?? p.max ?? 1 } : {}) }));
  while (resto.length) { const x = await call(app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops: resto.slice(0, 20) }, rol: 'tecnico' }); resto = resto.slice(x.body.resultados.length); }
  await call(app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops: [op('ronda.cerrar', { firma: true, notas: 'Queda abierta la temperatura.' })] }, rol: 'tecnico' });
  await call(app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops: [op('ronda.lectura', { sucursalId: 2, fecha: '2020-01-01', turno: '06:00', puntoId: pts[0].id, resultado: 'ok' })] }, rol: 'tecnico' });
  const id = sqlite.prepare('SELECT id FROM ronda_ejecuciones WHERE sucursal_id=1').get().id;
  const container = await experimental_AstroContainer.create();
  const render = async (rel, url, rol, uid, params) => {
    const res = await container.renderToResponse(await cargar(rel), { partial: false, request: new Request(`https://local.test${url}`), params, locals: { user: { id: uid, nombre: `Cuenta ${rol}`, rol }, runtime: { env: { DB } } } });
    return { status: res.status, location: res.headers.get('location'), html: res.status === 200 ? await res.text() : '' };
  };
  for (const [rol, uid] of [['admin', 1], ['jefe', 2], ['visualizador', 4]]) {
    const t = await render('ronda.astro.mjs', '/ronda', rol, uid);
    ok(t.status === 200 && /Por sede/.test(t.html) && /Sede Uno/.test(t.html), `${rol} ve el tablero`);
    ok(/Completa con novedades/.test(t.html), `${rol}: la ronda con novedades no sale verde`);
    ok(/Sin iniciar/.test(t.html), `${rol}: la otra sede sale sin iniciar`);
    ok(/0 de 21 paradas/.test(t.html), `${rol}: la sede sin iniciar dice cuántas paradas le tocan`);
    ok(/sin aceptar/.test(t.html), `${rol}: ve los registros que el servidor no aceptó`);
    const d = await render('ronda/_id_.astro.mjs', `/ronda/${id}`, rol, uid, { id: String(id) });
    ok(d.status === 200 && /Firmada/.test(d.html) && /Queda abierta la temperatura/.test(d.html), `${rol} ve la ronda firmada y la entrega`);
    ok(/capturada sin señal/.test(d.html), `${rol} ve que se capturó sin señal`);
    ok(!/Guardar|Anotar|Firmar y cerrar|Cerrar la ronda/.test(d.html.split('<main')[1] ?? ''), `${rol}: el detalle es de solo lectura`);
    const antes = await render('ronda/semana.astro.mjs', '/ronda/semana', rol, uid);
    ok(antes.status === 200 && !/Firmar la revisión/.test(antes.html) && /nada que firmar/.test(antes.html), `${rol}: antes de exigir la ronda no hay semana que firmar`);
    sqlite.exec("UPDATE rondas SET vigente_desde='2020-01-01'");
    const s = await render('ronda/semana.astro.mjs', '/ronda/semana', rol, uid);
    ok(s.status === 200 && /Revisión de la semana/.test(s.html), `${rol} ve la semana`);
    ok(/Firmar la revisión/.test(s.html) === (rol !== 'visualizador'), `${rol}: firmar solo jefatura`);
    sqlite.exec("UPDATE rondas SET vigente_desde=date('now','-6 hours')");
  }
  for (const rel of ['ronda.astro.mjs', 'ronda/semana.astro.mjs']) {
    const t = await render(rel, '/ronda', 'tecnico', 3);
    ok(t.status === 302 && t.location === '/campo', 'El técnico vuelve a su pantalla');
  }
  const p = await render('ronda/puntos.astro.mjs', '/ronda/puntos', 'admin', 1);
  ok(p.status === 200 && /Crear recorrido propio/.test(p.html) && /provisional/.test(p.html), 'La jefatura ve paradas, sedes y provisionales');
  ok(!/sin AOP asignado/.test(p.html), 'Bitácora y cuartos técnicos no se reportan como falta de AOP');
  for (const [rol, uid] of [['visualizador', 4], ['tecnico', 3]]) {
    const v = await render('ronda/puntos.astro.mjs', '/ronda/puntos', rol, uid);
    ok(v.status === 302, `${rol}: no configura`);
  }

  // Siempre dice qué recorrido se edita
  const CAMBIO = 'Un cambio entra en la ronda del turno que todavía no empezó; la ronda que ya empezó conserva lo que decía al abrir.';
  let doc = parseHtml(p.html);
  ok(texto(porId(doc, 'recorrido-actual')) === 'Modelo: lo usan todas las sedes sin recorrido propio', 'El modelo dice que lo usan todas las sedes sin recorrido propio');
  ok(/Hoy lo usan: Sede Dos, Sede Uno\./.test(texto(porId(doc, 'recorrido-resumen'))), 'Y cuáles son hoy');
  ok(texto(porId(doc, 'parada-recorrido')) === 'Modelo · lo usan todas las sedes sin recorrido propio', 'La ventana de edición también dice qué recorrido se edita');
  ok(p.html.split(CAMBIO).length >= 3, 'El texto del cambio es el exacto, en la pantalla y en la ventana');
  ok(!/aplica desde el turno siguiente/i.test(p.html), 'Sin el texto viejo que no era exacto');
  ok(attr(porId(doc, 'r_turnos'), 'value') === '06:00, 14:00, 22:00', 'Los turnos del modelo se editan en la pantalla');

  // La ventana «Editar parada» con todos los campos; minutos para actuar y escalar en «Más opciones»
  const ventana = porId(doc, 'modal-parada');
  ok(ventana && /\bhidden\b/.test(attr(ventana, 'class')) && attr(porId(doc, 'form-parada'), 'role') === 'dialog', 'La ventana de edición está en la página, cerrada');
  ok(texto(porId(doc, 'parada-titulo')) === 'Editar parada', 'Se llama «Editar parada»');
  for (const id of ['p_etiqueta', 'p_instruccion', 'p_sistema', 'p_tipo_numero', 'p_tipo_conforme', 'p_unidad', 'p_min', 'p_max', 'p_texto', 'p_aop', 'p_critico', 'p_activo', 'p_fuente', 'p_linea']) {
    const el = porId(doc, id);
    ok(el && (nodos(doc, (n) => n.tagName === 'label' && attr(n, 'for') === id).length || nodos(doc, (n) => n.tagName === 'label' && nodos(n, (x) => x === el).length).length), `Campo ${id} con su etiqueta`);
  }
  const mas = porId(doc, 'p_mas');
  ok(mas?.tagName === 'details' && /Más opciones/.test(texto(nodos(mas, (n) => n.tagName === 'summary')[0])), 'Hay «Más opciones»');
  ok(nodos(mas, (n) => ['p_actuar', 'p_escalar'].includes(attr(n, 'id'))).length === 2, 'Con los minutos para actuar y escalar');
  ok(nodos(porId(doc, 'p_sistema'), (n) => n.tagName === 'option').length === 9, 'Las ocho familias para elegir');
  ok(nodos(porId(doc, 'p_aop'), (n) => n.tagName === 'option' && /^AOP-/.test(texto(n))).length > 0, 'Los AOP para elegir');
  ok(/si no se puede verificar, se avisa a la jefatura/.test(p.html), 'Crítica dice lo que hace de verdad');

  // Cada fila: sus datos para editar, subir y bajar; ninguna se borra
  const filas = nodos(doc, (n) => n.tagName === 'tr' && attr(n, 'data-parada'));
  ok(filas.length === 23 && filas.every((tr) => { const d = JSON.parse(attr(tr, 'data-parada')); return d.id && 'minutosEscalar' in d && 'fuente' in d && 'lineaSop' in d; }), 'Cada fila lleva lo que la ventana edita');
  const boton = (tr, a) => nodos(tr, (n) => n.tagName === 'button' && attr(n, 'data-accion') === a)[0];
  ok(filas.every((tr) => boton(tr, 'subir') && boton(tr, 'bajar') && boton(tr, 'editar')), 'Subir, Bajar y Editar en cada fila');
  ok(attr(boton(filas[0], 'subir'), 'disabled') !== undefined && attr(boton(filas.at(-1), 'bajar'), 'disabled') !== undefined && attr(boton(filas[1], 'subir'), 'disabled') === undefined, 'La primera no sube y la última no baja');
  ok(!/data-guardar|Eliminar|Borrar parada/.test(p.html), 'Sin Guardar por fila ni botón de borrar');
  ok(/Una parada no se borra: se desactiva/.test(p.html), 'Y se dice por qué');

  // Una sede con recorrido propio y otra que no hace ronda
  const llamar = async (method, data) => { const r = await f.app.puntos[method](f.ctx('/api/ronda-turno/puntos', { method, data, rol: 'admin' })); return r.json(); };
  const propia = (await llamar('PUT', { accion: 'crear_propio', sucursalId: 2 })).ronda;
  const pp = await render('ronda/puntos.astro.mjs', `/ronda/puntos?ronda=${propia.id}`, 'jefe', 2);
  doc = parseHtml(pp.html);
  ok(pp.status === 200 && texto(porId(doc, 'recorrido-actual')) === 'Recorrido propio de Sede Dos: ya no recibe cambios del modelo', 'El recorrido propio dice que ya no recibe cambios del modelo');
  ok(texto(porId(doc, 'parada-recorrido')) === 'Recorrido propio de Sede Dos', 'Y la ventana también');
  ok(nodos(doc, (n) => n.tagName === 'a' && attr(n, 'aria-current') === 'page').map(texto).includes('Recorrido propio de Sede Dos'), 'Marcado entre los recorridos');
  ok(/Solo para esta sede\./.test(texto(porId(doc, 'r_turnos_ayuda'))), 'Sus turnos son solo de esta sede');
  sqlite.exec('UPDATE sucursales SET hace_ronda=0 WHERE id=2');
  const pm = parseHtml((await render('ronda/puntos.astro.mjs', '/ronda/puntos', 'admin', 1)).html);
  const sedeDos = nodos(pm, (n) => attr(n, 'data-sede-fila') === '2')[0];
  ok(/Recorrido propio · No hace ronda/.test(texto(sedeDos)) && /Esta sede sí hace ronda/.test(texto(sedeDos)), 'La sede que no hace ronda lo dice y tiene su botón');
  ok(/Esta sede no hace ronda/.test(texto(nodos(pm, (n) => attr(n, 'data-sede-fila') === '1')[0])), 'La que sí hace ronda tiene el botón para marcar que no');
  ok(/Hoy lo usan: Sede Uno\./.test(texto(porId(pm, 'recorrido-resumen'))), 'El modelo ya no lo usa la sede con recorrido propio');
  const tab = await render('ronda.astro.mjs', '/ronda', 'jefe', 2);
  ok(/No hace ronda/.test(tab.html), 'El tablero dice que la sede no hace ronda, no «No aplica»');
  const sem = await render('ronda/semana.astro.mjs', '/ronda/semana', 'jefe', 2);
  ok(/Hoy esta sede no hace ronda/.test(sem.html), 'La revisión semanal también lo dice');
  sqlite.exec('UPDATE sucursales SET hace_ronda=1 WHERE id=2');

  // La pantalla de verdad, con su script, en jsdom: guarda sin recargar y sin perder nada
  const { JSDOM, VirtualConsole } = createRequire(import.meta.url)('jsdom');
  const url = `https://local.test/ronda/puntos?ronda=${propia.id}`;
  const inicial = await render('ronda/puntos.astro.mjs', `/ronda/puntos?ronda=${propia.id}`, 'admin', 1);
  const pedidos = [], erroresScript = [];
  const consola = new VirtualConsole();
  consola.on('jsdomError', (e) => erroresScript.push(String(e?.message ?? e)));
  const fetchFalso = async (destino, init = {}) => {
    const u = new URL(destino, url);
    if (u.pathname === '/ronda/puntos') {
      const r = await render('ronda/puntos.astro.mjs', u.pathname + u.search, 'admin', 1);
      return new Response(r.html, { status: r.status, headers: { 'content-type': 'text/html' } });
    }
    // Lo demás del menú (avisos, búsqueda) no es de esta prueba.
    if (u.pathname !== '/api/ronda-turno/puntos') return new Response('{}', { status: 404 });
    const data = init.body ? JSON.parse(init.body) : undefined;
    pedidos.push({ method: init.method, data });
    return f.app.puntos[init.method](f.ctx(u.pathname, { method: init.method, data, rol: 'admin' }));
  };
  const dom = new JSDOM(inicial.html, { url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: consola, beforeParse: (win) => { win.fetch = fetchFalso; } });
  const w = dom.window, d = w.document;
  const espera = (ms = 15) => new Promise((r) => setTimeout(r, ms));
  const hasta = async (fn, msg) => { for (let i = 0; i < 200; i++) { if (fn()) return; await espera(); } assert.fail('No llegó: ' + msg); };
  const $ = (sel) => d.querySelector(sel);
  const fila = (etiqueta) => [...d.querySelectorAll('tr[data-parada]')].find((tr) => JSON.parse(tr.dataset.parada).etiqueta === etiqueta);
  const escribir = (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const abierta = () => !$('#modal-parada').classList.contains('hidden');
  const guardar = () => $('#form-parada').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));

  escribir('#r_turnos', '06:00, 14:00, 20:00');
  fila('Quirófanos · temperatura').querySelector('[data-accion="editar"]').click();
  ok(abierta() && $('#p_etiqueta').value === 'Quirófanos · temperatura' && $('#p_min').value === '20' && $('#p_max').value === '22' && $('#p_tipo_numero').checked, 'Editar abre la ventana con la parada cargada');
  ok(!$('#caja-numero').classList.contains('hidden') && $('#caja-texto').classList.contains('hidden'), 'Muestra el rango, no el texto esperado');
  escribir('#p_etiqueta', 'Quirófanos · temperatura de sala');
  escribir('#p_max', '21');
  guardar();
  await hasta(() => !abierta() && fila('Quirófanos · temperatura de sala'), 'la fila editada');
  const enviado = pedidos.at(-1);
  ok(enviado.method === 'PATCH' && JSON.stringify(Object.keys(enviado.data).sort()) === JSON.stringify(['etiqueta', 'id', 'maxEsperado']), `Solo se manda lo que cambió (${JSON.stringify(enviado.data)})`);
  ok(sqlite.prepare('SELECT max_esperado m FROM ronda_puntos WHERE id=?').get(enviado.data.id).m === 21, 'Y quedó guardado');
  ok($('#r_turnos').value === '06:00, 14:00, 20:00', 'Guardar una parada no borra lo que se estaba escribiendo en otra parte');
  ok(/21/.test(fila('Quirófanos · temperatura de sala').textContent), 'La tabla se actualiza sin recargar la página');

  fila('Quirófanos · temperatura de sala').querySelector('[data-accion="editar"]').click();
  escribir('#p_min', '30');
  guardar();
  await espera();
  ok(abierta() && $('#parada-error').textContent === 'El mínimo no puede ser mayor que el máximo.' && pedidos.at(-1) === enviado, 'Un rango al revés se avisa antes de enviar');
  escribir('#p_min', '20');
  $('#p_mas').open = true;
  escribir('#p_actuar', '120');
  escribir('#p_escalar', '60');
  guardar();
  await hasta(() => $('#parada-error').textContent, 'el error del servidor');
  ok($('#parada-error').textContent === 'Los minutos para escalar no pueden ser menos que los minutos para actuar.' && !$('#parada-error').classList.contains('hidden'), 'El error del servidor se muestra tal cual');
  ok(abierta() && $('#p_actuar').value === '120', 'Y la ventana sigue abierta con lo escrito');
  $('#parada-cancelar').click();
  await espera();
  ok(!$('#confirmModal').classList.contains('hidden') && abierta(), 'Cerrar con cambios sin guardar pregunta antes');
  $('#confirmCancel').click();
  await espera();
  ok(abierta() && $('#p_escalar').value === '60', 'Si no se descarta, nada se pierde');
  $('#parada-cancelar').click();
  await espera();
  $('#confirmOk').click();
  await espera();
  ok(!abierta(), 'Descartar cierra la ventana');

  const primera = d.querySelector('tr[data-parada]');
  const idPrimera = JSON.parse(primera.dataset.parada).id;
  primera.querySelector('[data-accion="bajar"]').click();
  await hasta(() => JSON.parse(d.querySelectorAll('tr[data-parada]')[1].dataset.parada).id === idPrimera, 'la parada bajó');
  ok(pedidos.at(-1).data.mover === 'bajar' && d.querySelector('tr[data-parada] [data-accion="subir"]').disabled, 'Bajar mueve la fila y la nueva primera no sube');

  d.querySelector('[data-accion="nueva"]').click();
  ok(abierta() && $('#parada-titulo').textContent === 'Agregar una parada' && $('#p_activo').checked, 'Agregar usa la misma ventana');
  escribir('#p_etiqueta', 'Tanque de agua caliente · temperatura');
  $('#p_sistema').value = 'agua';
  $('#p_tipo_numero').checked = true; $('#p_tipo_numero').dispatchEvent(new w.Event('change', { bubbles: true }));
  escribir('#p_min', '55'); escribir('#p_unidad', '°C');
  guardar();
  await hasta(() => fila('Tanque de agua caliente · temperatura'), 'la parada nueva');
  const filasAhora = d.querySelectorAll('tr[data-parada]');
  ok(filasAhora[filasAhora.length - 1] === fila('Tanque de agua caliente · temperatura') && pedidos.at(-1).method === 'POST', 'La parada nueva queda al final');

  d.querySelector('#form-turnos').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await hasta(() => /Entran desde el turno/.test($('#turnos-estado').textContent), 'los turnos guardados');
  ok(sqlite.prepare('SELECT turnos FROM rondas WHERE id=?').get(propia.id).turnos === '["06:00","14:00","20:00"]', 'Los turnos escritos antes se guardan después');
  escribir('#r_turnos', '06:00, 25:00');
  d.querySelector('#form-turnos').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await hasta(() => !$('#aviso-pagina').classList.contains('hidden'), 'el aviso');
  ok($('#aviso-pagina').textContent === 'Hora inválida: «25:00». Usa HH:MM, por ejemplo 06:00.', 'Una hora inválida llega a la pantalla tal cual');

  d.querySelector('[data-accion="hace-ronda"][data-sede="1"]').click();
  await hasta(() => !$('#confirmModal').classList.contains('hidden'), 'la confirmación');
  ok(/no hace ronda/.test($('#confirmTitle').textContent) && /No se copia ni se borra nada/.test($('#confirmMsg').textContent), 'Marcar que no hace ronda explica lo que hace');
  $('#confirmOk').click();
  await hasta(() => /No hace ronda/.test(d.querySelector('[data-sede-fila="1"]')?.textContent ?? ''), 'la sede marcada');
  ok(sqlite.prepare('SELECT hace_ronda h FROM sucursales WHERE id=1').get().h === 0 && /Esta sede sí hace ronda/.test(d.querySelector('[data-sede-fila="1"]').textContent), 'Un botón por sede lo cambia');
  ok(d.querySelector('[data-accion="crear-propio"][data-sede="1"]'), 'Sin copiar el modelo');
  ok(erroresScript.filter((m) => !/Not implemented/.test(m)).length === 0, `Sin errores de script: ${erroresScript.join(' | ')}`);
  w.close();
  const rd = await render('rondas.astro.mjs', '/rondas?execution=9', 'admin', 1);
  ok(rd.status === 301 && rd.location === '/ronda', 'Los enlaces viejos llegan al tablero');
} finally { await f.close(); }

// ── Un cambio de turnos a media mañana: entra con el primer turno de la lista nueva ──
// Base nueva y reloj fijo: martes 10/11/2026. A las 10:40 el modelo pasa de 06:00, 14:00 y 22:00
// a 07:00 y 19:00: el de las 06:00 sigue hasta las 14:00, el de las 14:00 hasta las 19:00.
{
  const D = '2026-11-10';
  const en = (hhmm) => new Date(Date.parse(`${D}T${hhmm}:00-06:00`)).toISOString();
  fijarReloj(en('10:30'));
  const g = await setupConjuntos({ beforeMigration, modules: { hoy: 'pages/api/campo/hoy', sync: 'pages/api/campo/sync', puntos: 'pages/api/ronda-turno/puntos' } });
  try {
    g.sqlite.exec("INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede Uno',1),(2,'Sede Dos',1)");
    g.sqlite.exec("UPDATE rondas SET vigente_desde='2020-01-01'");
    const contenedor = await experimental_AstroContainer.create();
    const ver = async (rel, url) => {
      const res = await contenedor.renderToResponse(await cargar(rel), { partial: false, request: new Request(`https://local.test${url}`), locals: { user: { id: 2, nombre: 'Cuenta jefe', rol: 'jefe' }, runtime: { env: { DB: g.DB } } } });
      return parseHtml(await res.text());
    };
    const pedir = async (data) => (await g.app.puntos.PUT(g.ctx('/api/ronda-turno/puntos', { method: 'PUT', data, rol: 'jefe' }))).json();
    const ronda = (await g.call(g.app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' })).body.ronda;
    const clave = { sucursalId: 1, fecha: D, turno: '06:00' };
    await g.call(g.app.sync.POST, '/api/campo/sync', { method: 'POST', rol: 'tecnico', data: { ops: [{ opId: 'paginas-linea-1', tipo: 'ronda.lectura', at: en('10:30'), ...clave, puntoId: ronda.puntos[0].id, resultado: 'ok', ...(ronda.puntos[0].pideValor ? { valor: ronda.puntos[0].min ?? 1 } : {}) }] } });
    const modelo = g.sqlite.prepare('SELECT id FROM rondas WHERE sucursal_id IS NULL').get().id;
    fijarReloj(en('10:40'));
    ok((await pedir({ accion: 'turnos', rondaId: modelo, turnos: ['07:00', '19:00'] })).aplicaDesde?.turno === '19:00', 'Los turnos nuevos entran a las 19:00');
    fijarReloj(en('10:50'));
    ok((await pedir({ accion: 'hace_ronda', sucursalId: 2, haceRonda: false })).aplicaDesde?.turno === '14:00', 'La marca entra en el siguiente turno que de verdad empieza');
    fijarReloj(en('10:55'));
    let doc = await ver('ronda/puntos.astro.mjs', '/ronda/puntos');
    ok(texto(porId(doc, 'turnos-estado')) === 'El turno de ahora sigue con 06:00, 14:00, 22:00. Estos turnos entran desde el turno 19:00 del 10/11/2026.', `La pantalla dice qué turnos rigen y desde cuándo entran los nuevos: «${texto(porId(doc, 'turnos-estado'))}»`);
    ok(attr(porId(doc, 'r_turnos'), 'value') === '07:00, 19:00', 'Y deja editar los que se guardaron');
    const sedeDos = texto(nodos(doc, (n) => attr(n, 'data-sede-fila') === '2')[0]);
    ok(/No hace ronda · desde el turno 14:00 del 10\/11\/2026; el turno de ahora sigue como estaba/.test(sedeDos), `La marca dice desde qué turno entra: «${sedeDos}»`);
    doc = await ver('ronda.astro.mjs', '/ronda');
    const filaSede = (nombre) => texto(nodos(doc, (n) => n.tagName === 'li' && /turno \d\d:\d\d/.test(texto(n)) && texto(n).includes(nombre))[0]);
    ok(/Sede Uno\s*turno 06:00/.test(filaSede('Sede Uno')) && /En curso/.test(filaSede('Sede Uno')), `El tablero sigue en la ronda de las 06:00, en curso: «${filaSede('Sede Uno')}»`);
    ok(/turno 06:00/.test(filaSede('Sede Dos')) && /Sin iniciar/.test(filaSede('Sede Dos')), 'La otra sede todavía hace ronda en este turno');
    fijarReloj(en('14:30'));
    doc = await ver('ronda.astro.mjs', '/ronda');
    ok(/Sede Uno\s*turno 14:00/.test(filaSede('Sede Uno')) && /Sin iniciar/.test(filaSede('Sede Uno')), `A las 14:30 corre el de las 14:00 y se exige: «${filaSede('Sede Uno')}»`);
    ok(/No hace ronda/.test(filaSede('Sede Dos')), 'Y la sede marcada ya no hace ronda');
    const opciones = nodos(porId(doc, 'f_turno'), (n) => n.tagName === 'option');
    ok(['06:00', '07:00', '14:00', '19:00', '22:00'].every((tt) => opciones.some((o) => attr(o, 'value') === tt)), 'El filtro ofrece los turnos de antes y los nuevos');
    ok(attr(opciones.find((o) => attr(o, 'selected') !== undefined), 'value') === '14:00', 'Y de entrada, el que corre');
    doc = await ver('ronda.astro.mjs', `/ronda?fecha=${D}&turno=07:00`);
    ok(/No aplica/.test(filaSede('Sede Uno')), 'El de las 07:00 de hoy no se exige');
    fijarReloj(en('19:30'));
    doc = await ver('ronda/puntos.astro.mjs', '/ronda/puntos');
    ok(texto(porId(doc, 'turnos-estado')) === '', 'Ya entraron: la pantalla no anuncia nada pendiente');
  } finally { await g.close(); }
}
console.log(`PASS test-ronda-paginas: ${checks} verificaciones; pantallas construidas, migraciones reales.`);
