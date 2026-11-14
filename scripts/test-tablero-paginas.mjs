// Las páginas construidas del tablero de preventivos, contra migraciones reales: qué ve la
// jefatura en /preventivos, que el técnico no entra, que el visualizador solo mira, el
// aviso del panel principal y la ficha del equipo, que pide el motivo antes de mover la
// fecha y muestra el historial junto al preventivo. Y el tablero por espacio (14/11/2026):
// General sin nada biomédico; Biomédico con «Lo realiza», calibraciones y pendientes de
// ubicación, que se asignan desde el tablero y desde la ficha. Correr después de npm run
// build. Sin red.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { experimental_AstroContainer } from 'astro/container';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';

fijarReloj();
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const f = await setupConjuntos({ modules: { plan: 'pages/api/planes/[id]', asignar: 'pages/api/preventivos/asignar', ubicar: 'pages/api/activos/asignar-ubicacion' } });
const { app, sqlite, call, DB, close } = f;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
const modulo = async (ruta) => (await import(pathToFileURL(path.join(process.cwd(), 'dist/_worker.js/pages', ruta)).href)).page().default;
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const HOY = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const dia = (n) => new Date(Date.parse(`${HOY}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const ddmm = (x) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}`;
const USUARIO = { admin: 1, jefe: 2, tecnico: 3, visualizador: 4 };
const MOTIVO = 'El quirófano está ocupado toda la semana por cirugías';

try {
  sqlite.exec(`
    INSERT INTO usuarios(id,nombre,email,password_hash,rol,activo) VALUES(20,'Técnico Uno','tecnico.uno@prueba.local','x','tecnico',1),(30,'Técnico Retirado','tecnico.retirado@prueba.local','x','tecnico',0);
    INSERT INTO sucursales(id,nombre) VALUES(7,'Sede de prueba');
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,padre_id) VALUES(70,7,'Nivel 2','piso',NULL),(71,7,'Bloque quirúrgico','area',70),(72,7,'Quirófano 1','sala',71);
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id) VALUES(1,'AA-001','Aire del quirófano','aires','general',72),(2,'AA-002','Aire de recuperación','aires','general',72);
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,asignado_a) VALUES(1,1,'Preventivo mensual HEPA','mensual','${dia(3)}',NULL),(2,2,'Preventivo trimestral','trimestral','${dia(-2)}',30);
  `);
  const container = await experimental_AstroContainer.create();
  const respuesta = async (componente, ruta, rol, params = {}) => container.renderToResponse(componente, {
    partial: false, request: new Request(`https://local.test${ruta}`), params,
    locals: { user: { id: USUARIO[rol], nombre: `Cuenta ${rol}`, rol }, runtime: { env: { DB } } },
  });
  const ver = async (componente, ruta, rol, params) => {
    const res = await respuesta(componente, ruta, rol, params);
    assert.equal(res.status, 200, `${ruta} como ${rol}`);
    const doc = new JSDOM(await res.text()).window.document;
    doc.querySelectorAll('script').forEach((s) => s.remove());
    return { doc, texto: doc.body.textContent.replace(/\s+/g, ' ') };
  };

  // ── /preventivos ──
  const tablero = await modulo('preventivos.astro.mjs');
  for (const rol of ['admin', 'jefe']) {
    const { doc, texto } = await ver(tablero, '/preventivos', rol);
    ok(texto.includes('Tablero de preventivos'), rol);
    const fila1 = doc.querySelector('#programados tr[data-fila="1"]');
    ok(fila1, `${rol}: el programado`);
    ok(fila1.textContent.includes(ddmm(dia(3))) && fila1.textContent.includes('en 3 días'), 'Fecha DD/MM/AAAA y cuánto falta');
    ok(fila1.textContent.includes('Nivel 2 · Bloque quirúrgico · Quirófano 1'), 'Ruta de la ubicación');
    const opciones = [...fila1.querySelectorAll('select.tecnico-sel option')].map((o) => o.textContent.trim());
    ok(opciones.includes('Sin asignar') && opciones.some((o) => o.startsWith('Técnico Uno · 0 OT abiertas')), `Técnicos con su carga: ${opciones}`);
    const fila2 = doc.querySelector('#atrasados-con tr[data-fila="2"]');
    ok(fila2 && fila2.textContent.includes('2 días de atraso'), 'Atrasado con su técnico (aunque ya no esté activo)');
    ok(fila2.querySelector('[data-generar="2"]'), 'Puede generar la OT que falta');
    ok(texto.includes('Cómo se cuenta un atraso') && texto.includes('Fecha programada:') && texto.includes('Pendiente de verificación'), 'Las definiciones en la página');
    ok(doc.querySelector('#loteBar select#loteTecnico'), 'Asignación en lote');
    ok(doc.querySelector('a[href="/preventivos"].app-nav-link'), 'En el menú');
  }
  {
    const res = await respuesta(tablero, '/preventivos', 'tecnico');
    ok(res.status >= 300 && res.status < 400 && res.headers.get('location') === '/campo', `El técnico no ve el tablero (${res.status} ${res.headers.get('location')})`);
    for (const rol of ['solicitante', 'motorista']) {
      const r = await respuesta(tablero, '/preventivos', rol);
      ok(r.status >= 300 && r.status < 400 && r.headers.get('location') === '/', `${rol} tampoco (${r.status})`);
    }
  }
  { // El visualizador lo ve sin cambiar nada: sin selector de técnico, sin marcar, sin lote ni «Generar OT».
    const { doc, texto } = await ver(tablero, '/preventivos', 'visualizador');
    ok(texto.includes('Tablero de preventivos') && texto.includes('Vista de consulta'), 'El visualizador entra en modo consulta');
    const fila1 = doc.querySelector('#programados tr[data-fila="1"]');
    ok(fila1 && fila1.querySelector('[data-tecnico]').textContent.includes('Sin asignar'), 'Ve quién lo tiene');
    ok(!doc.querySelector('select.tecnico-sel') && !doc.querySelector('.sel-plan') && !doc.querySelector('.sel-todos'), 'Sin selector ni casillas');
    ok(!doc.querySelector('#loteBar') && !doc.querySelector('[data-generar]'), 'Sin lote ni «Generar OT»');
    ok(doc.querySelector('#atrasados-con tr[data-fila="2"] [data-tecnico]').textContent.includes('Técnico Retirado'), 'El técnico del atrasado');
    ok(doc.querySelector('[data-historial="1"]'), 'El historial sí');
  }
  { // el técnico no ve el enlace en el menú
    const { doc } = await ver(await modulo('activos/_id_.astro.mjs'), '/activos/1?area=aires', 'tecnico', { id: '1' });
    ok(!doc.querySelector('a[href="/preventivos"]'), 'Sin enlace para el técnico');
  }

  // ── Panel principal ──
  const panel = await modulo('index.astro.mjs');
  {
    const { doc } = await ver(panel, '/', 'jefe');
    const aviso = doc.querySelector('a[href="/preventivos"].card');
    ok(aviso && /1 atrasados de 1 día o más \(0 sin asignar\)/.test(aviso.textContent), `Aviso en el panel: ${aviso?.textContent}`);
    const { doc: v } = await ver(panel, '/', 'visualizador');
    ok(!v.querySelector('a[href="/preventivos"].card'), 'El visualizador no lo ve');
  }

  // ── Ficha del equipo: motivo antes de mover la fecha, e historial junto al preventivo ──
  const ficha = await modulo('activos/_id_.astro.mjs');
  const enviados = [], errores = [], recargas = [];
  // Cada guardado bueno recarga la página: se abre de nuevo, como en el navegador.
  const abrirFicha = async (activo = '1', rol = 'jefe') => {
    const html = await (await respuesta(ficha, `/activos/${activo}?area=aires`, rol, { id: activo })).text();
    const consola = new VirtualConsole();
    consola.on('jsdomError', (e) => { const m = e.detail?.message ?? e.message; if (/navigation/i.test(m)) recargas.push(m); else if (!/Not implemented/.test(e.message)) errores.push(m); });
    const dom = new JSDOM(html, {
      url: `https://local.test/activos/${activo}?area=aires`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: consola,
      beforeParse(w) {
        w.prompt = () => null; w.alert = () => {}; w.confirm = () => true;
        w.fetch = async (url, init = {}) => {
          const u = new URL(url, 'https://local.test');
          const data = init.body ? JSON.parse(init.body) : undefined;
          enviados.push({ metodo: init.method ?? 'GET', ruta: u.pathname, data });
          const m = u.pathname.match(/^\/api\/planes\/(\d+)$/);
          const r = m && init.method === 'PATCH' ? await call(app.plan.PATCH, u.pathname, { method: 'PATCH', id: Number(m[1]), data, rol }) : { status: 200, body: {} };
          return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
        };
      },
    });
    await pausa(30);
    return dom.window;
  };
  let w = await abrirFicha(), d = w.document;
  ok(typeof w.pedirMotivo === 'function', 'El Layout ofrece pedirMotivo');
  ok(d.querySelector('#plan-1').textContent.includes(`Próxima: ${ddmm(dia(3))}`), 'Próxima fecha sin correr el día');
  d.querySelector('[data-edit][data-id="1"]').click();
  // Cambia solo el título: no pide motivo.
  d.querySelector('.edit-titulo[data-id="1"]').value = 'Preventivo mensual de filtros HEPA';
  d.querySelector('[data-save][data-id="1"]').click();
  await pausa(50);
  ok(d.querySelector('#motivoModal').classList.contains('hidden'), 'Sin cambio de fecha no hay motivo');
  ok(enviados.some((e) => e.metodo === 'PATCH' && !e.data.motivo), 'Guardó sin motivo');
  ok(one('SELECT titulo FROM planes_mantenimiento WHERE id=1').titulo === 'Preventivo mensual de filtros HEPA');
  // Cambia la fecha: pide motivo; cancelar no envía nada.
  w = await abrirFicha(); d = w.document;
  const antes = enviados.length;
  d.querySelector('[data-edit][data-id="1"]').click();
  d.querySelector('.edit-proxima[data-id="1"]').value = dia(10);
  d.querySelector('[data-save][data-id="1"]').click();
  await pausa(20);
  ok(!d.querySelector('#motivoModal').classList.contains('hidden'), 'Pide el motivo');
  d.querySelector('#motivoCancel').click();
  await pausa(20);
  ok(enviados.length === antes, 'Cancelar no envía');
  d.querySelector('[data-save][data-id="1"]').click();
  await pausa(20);
  d.querySelector('#motivoInput').value = 'corto';
  d.querySelector('#motivoOk').click();
  await pausa(20);
  ok(!d.querySelector('#motivoErr').classList.contains('hidden') && enviados.length === antes, 'Un motivo corto no sale');
  d.querySelector('#motivoInput').value = MOTIVO;
  const recargasAntes = recargas.length;
  d.querySelector('#motivoOk').click();
  for (let i = 0; i < 100 && recargas.length === recargasAntes; i++) await pausa(10);
  const ultimo = enviados.at(-1);
  ok(ultimo.metodo === 'PATCH' && ultimo.data.motivo === MOTIVO && ultimo.data.proximaFecha === dia(10), `Envía la fecha con su motivo: ${JSON.stringify(ultimo)}`);
  ok(one('SELECT proxima_fecha f FROM planes_mantenimiento WHERE id=1').f === dia(10), 'La fecha cambió');
  // Pausar también pide motivo.
  w = await abrirFicha(); d = w.document;
  const antesPausa = enviados.length;
  d.querySelector('[data-pause][data-id="1"]').click();
  await pausa(20);
  ok(!d.querySelector('#motivoModal').classList.contains('hidden') && enviados.length === antesPausa, 'Pausar pide el motivo');
  d.querySelector('#motivoCancel').click();
  ok(errores.length === 0, `Sin errores de la página: ${errores.join(' | ')}`);

  const { doc: despues, texto } = await ver(ficha, '/activos/1?area=aires', 'jefe', { id: '1' });
  const hist = despues.querySelector('#plan-1 details');
  ok(hist && hist.textContent.includes('Reprogramación') && hist.textContent.includes(MOTIVO) && hist.textContent.includes(`${ddmm(dia(3))} → ${ddmm(dia(10))}`), `Historial junto al preventivo: ${hist?.textContent.replace(/\s+/g, ' ')}`);
  ok(hist.textContent.includes('Cuenta jefe') || hist.textContent.includes('Prueba jefe'), 'Con la persona');
  ok(texto.includes(`Motivo: ${MOTIVO}`), 'También en el historial del equipo');
  const historialEquipo = (doc) => [...doc.querySelectorAll('h2')].find((h) => h.textContent.includes('Historial de cambios')).closest('.card').textContent.replace(/\s+/g, ' ');
  ok(!/\d{4}-\d{2}-\d{2}/.test(historialEquipo(despues)) && historialEquipo(despues).includes(`Próxima fecha: ${ddmm(dia(3))} → ${ddmm(dia(10))}`), `La fecha en DD/MM/AAAA en el historial del equipo: ${historialEquipo(despues).slice(0, 300)}`);
  // Una asignación se lee con el nombre del técnico, no con su número.
  ok((await call(app.plan.PATCH, '/api/planes/1', { method: 'PATCH', id: 1, data: { asignadoA: 20 }, rol: 'jefe' })).status === 200);
  {
    const { doc } = await ver(ficha, '/activos/1?area=aires', 'jefe', { id: '1' });
    ok(/Técnico asignado: Sin asignar → Técnico Uno/.test(historialEquipo(doc)), `El técnico por su nombre: ${historialEquipo(doc).slice(0, 300)}`);
  }

  // ── Ficha: el responsable que ya no está en la lista no se pierde al guardar otra cosa ──
  {
    w = await abrirFicha('2'); d = w.document;
    const sel = d.querySelector('.edit-asignado[data-id="2"]');
    ok(sel && sel.value === '30' && sel.selectedOptions[0].textContent.includes('Técnico Retirado'), `Sigue elegido: ${sel?.value}`);
    d.querySelector('[data-edit][data-id="2"]').click();
    d.querySelector('.edit-titulo[data-id="2"]').value = 'Preventivo trimestral del compresor';
    const recargasAntes = recargas.length;
    d.querySelector('[data-save][data-id="2"]').click();
    for (let i = 0; i < 100 && recargas.length === recargasAntes; i++) await pausa(10);
    const envio = enviados.at(-1);
    ok(envio.ruta === '/api/planes/2' && !('asignadoA' in envio.data) && !('proximaFecha' in envio.data), `Solo lo que cambió: ${JSON.stringify(envio.data)}`);
    ok(one('SELECT asignado_a, titulo FROM planes_mantenimiento WHERE id=2').asignado_a === 30, 'El responsable sigue');
  }

  // ── Ficha del técnico: edita el contenido, no la fecha, la frecuencia, el técnico ni la pausa ──
  {
    const { doc, texto: t } = await ver(ficha, '/activos/1?area=aires', 'tecnico', { id: '1' });
    ok(doc.querySelector('[data-edit][data-id="1"]'), 'Puede editar el contenido');
    ok(!doc.querySelector('[data-pause]') && !doc.querySelector('[data-del]'), 'Sin pausar ni eliminar');
    ok(!doc.querySelector('.edit-proxima') && !doc.querySelector('.edit-frecuencia') && !doc.querySelector('.edit-asignado'), 'Sin fecha, frecuencia ni técnico');
    ok(t.includes('La fecha, la frecuencia y el técnico los cambia la jefatura'), 'Se lo dice');
    w = await abrirFicha('1', 'tecnico'); d = w.document;
    d.querySelector('[data-edit][data-id="1"]').click();
    d.querySelector('.edit-titulo[data-id="1"]').value = 'Preventivo mensual de filtros HEPA y serpentín';
    const recargasAntes = recargas.length;
    d.querySelector('[data-save][data-id="1"]').click();
    for (let i = 0; i < 100 && recargas.length === recargasAntes; i++) await pausa(10);
    const envio = enviados.at(-1);
    ok(!('asignadoA' in envio.data) && !('proximaFecha' in envio.data) && !('frecuencia' in envio.data) && !envio.data.motivo, `El técnico guarda sin tocar la programación: ${JSON.stringify(envio.data)}`);
    ok(one('SELECT titulo FROM planes_mantenimiento WHERE id=1').titulo === 'Preventivo mensual de filtros HEPA y serpentín', 'Y se guarda');
  }

  // ── Tablero por espacio: General sin lo biomédico, Biomédico con lo suyo ──
  sqlite.exec(`
    INSERT INTO usuarios(id,nombre,email,password_hash,rol,activo,especialidad) VALUES(21,'Técnico Bio','tecnico.bio@prueba.local','x','tecnico',1,'biomedico');
    INSERT INTO proveedores(id,nombre,activo) VALUES(1,'Empresa Uno',1);
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,padre_id) VALUES(73,7,'Sunshine','sala',71);
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id,ubicacion,proveedor_id) VALUES
      (10,'BIO-010','Monitor de signos vitales','biomedico','biomedico',72,NULL,1),
      (11,'BIO-011','Máquina de anestesia','biomedico','biomedico',NULL,'Quirófano Azul C. M.',NULL),
      (12,'BIO-012','Desfibrilador','biomedico','biomedico',72,NULL,NULL);
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha) VALUES(10,10,'Preventivo semestral','semestral','${dia(4)}'),(11,11,'Preventivo semestral','semestral','${dia(6)}');
    INSERT INTO calibraciones(activo_id,fecha_calibracion,proxima_calibracion,resultado,certificado_r2_key,usuario_id) VALUES(12,'${dia(-370)}','${dia(-5)}','conforme','c/x.pdf',1),(10,'${dia(-340)}','${dia(20)}','conforme','c/y.pdf',1);
  `);
  {
    const { doc, texto } = await ver(tablero, '/preventivos', 'jefe');
    ok(texto.includes('Tablero de preventivos') && !texto.includes('Tablero biomédico'), 'General');
    ok(!doc.querySelector('tr[data-fila="10"]') && !doc.querySelector('tr[data-fila="11"]'), 'General no muestra lo biomédico');
    ok(![...doc.querySelectorAll('thead th')].some((th) => th.textContent.includes('Lo realiza')), 'Ni la columna de la empresa');
    ok(!doc.querySelector('#calibraciones') && !doc.querySelector('#pendientes-ubicacion') && !doc.querySelector('#f-empresa'), 'Ni las secciones biomédicas');
    const areas = [...doc.querySelectorAll('#f-area option')].map((o) => o.value).filter(Boolean);
    ok(areas.length === 3 && !areas.includes('biomedico'), `Áreas de General: ${areas}`);
    const tecnicos = [...doc.querySelectorAll('#loteTecnico option')].map((o) => o.textContent);
    ok(!tecnicos.some((x) => x.includes('Técnico Bio')), 'El técnico de biomédico no sale en General');
  }
  {
    const { doc, texto } = await ver(tablero, '/preventivos?espacio=biomedico', 'jefe');
    ok(doc.querySelector('h1').textContent.trim() === 'Tablero biomédico' && texto.includes('Ingeniería biomédica'), 'El título del espacio');
    ok(!doc.querySelector('tr[data-fila="1"]') && !doc.querySelector('tr[data-fila="2"]'), 'Biomédico no muestra los aires');
    ok([...doc.querySelectorAll('#programados thead th')].some((th) => th.textContent.includes('Lo realiza')), 'Columna «Lo realiza»');
    ok(doc.querySelector('tr[data-fila="10"] [data-lo-realiza]').textContent.includes('Empresa Uno'), 'Con la empresa del equipo');
    ok(doc.querySelector('tr[data-fila="11"] [data-lo-realiza]').textContent.includes('Personal propio'), 'O el personal propio');
    ok(doc.querySelector('tr[data-fila="11"]').textContent.includes('Pendiente de ubicación') && doc.querySelector('tr[data-fila="11"]').textContent.includes('Inventario: Quirófano Azul C. M.'), 'La fila dice que falta la ubicación');
    const empresas = [...doc.querySelectorAll('#f-empresa option')].map((o) => o.textContent.trim());
    ok(empresas.includes('Personal propio') && empresas.includes('Empresa Uno'), `Filtro por empresa: ${empresas}`);
    ok(!doc.querySelector('#f-area'), 'Sin filtro de área: es una sola');
    const tarjeta = (k) => doc.querySelector(`[data-tarjeta="${k}"]`)?.textContent.replace(/\s+/g, ' ');
    ok(/Calibraciones vencidas 1/.test(tarjeta('cal-vencidas')) && /por vencer \(30 días\) 1/.test(tarjeta('cal-por-vencer')), `Tarjetas de calibración: ${tarjeta('cal-vencidas')} | ${tarjeta('cal-por-vencer')}`);
    ok(/Pendientes de ubicación 1/.test(tarjeta('pendientes')) && /Con empresa externa \(equipos\) 1/.test(tarjeta('con-empresa')), `Tarjetas: ${tarjeta('pendientes')} | ${tarjeta('con-empresa')}`);
    const cal = doc.querySelector('#calibraciones');
    ok(cal.querySelector('tr[data-calibracion="12"]').textContent.includes(ddmm(dia(-5))) && cal.querySelector('tr[data-calibracion="12"]').textContent.includes('Vencida'), 'La vencida, en DD/MM/AAAA');
    ok(cal.querySelector('tr[data-calibracion="10"]').textContent.includes('vence en 20 días'), 'La que vence en 20 días');
    const pend = doc.querySelector('#pendientes-ubicacion tr[data-pendiente="11"]');
    ok(pend && pend.textContent.includes('según inventario: Quirófano Azul C. M.'), 'Pendiente con el texto del inventario');
    ok(pend.querySelector('[data-asignar-ubicacion][data-activos="11"]') && doc.querySelector('#pendientes-ubicacion button[data-asignar-ubicacion]:not([data-activos])'), 'Asignar uno o los marcados');
    const opciones = [...doc.querySelectorAll('#ubicLugar option[data-sede]')].map((o) => o.textContent);
    ok(opciones.includes('Nivel 2 · Bloque quirúrgico · Sunshine'), `El árbol con su ruta: ${opciones}`);
    const tecnicos = [...doc.querySelectorAll('#loteTecnico option')].map((o) => o.textContent);
    ok(tecnicos.some((x) => x.includes('Técnico Bio')), 'El técnico de biomédico sí sale');
  }
  { // El visualizador ve el tablero biomédico sin asignar ubicaciones.
    const { doc } = await ver(tablero, '/preventivos?espacio=biomedico', 'visualizador');
    ok(doc.querySelector('#pendientes-ubicacion tr[data-pendiente="11"]') && !doc.querySelector('[data-asignar-ubicacion]') && !doc.querySelector('#ubicDialog') && !doc.querySelector('.sel-pendiente'), 'Solo lectura');
  }
  { // El script del diálogo de ubicación: Astro lo deja en línea (es corto); se toma del manifiesto construido.
    const manifiesto = fs.readdirSync('dist/_worker.js').find((x) => /^manifest_.*\.mjs$/.test(x));
    const fuente = fs.readFileSync(path.join('dist/_worker.js', manifiesto), 'utf8');
    const m = fuente.match(/AsignarUbicacion\.astro\?astro&type=script&index=0&lang\.ts","((?:[^"\\]|\\.)*)"/);
    ok(m, 'El script del diálogo');
    const codigo = JSON.parse(`"${m[1]}"`);
    const abrir = async (ruta, params) => {
      const html = (await (await respuesta(params ? ficha0 : tablero, ruta, 'jefe', params)).text()).replace('</body>', () => `<script>${codigo}</script></body>`);
      const consola = new VirtualConsole();
      const avisos = [];
      consola.on('jsdomError', (e) => { const msg = e.detail?.message ?? e.message; if (/navigation/i.test(msg)) avisos.push('recarga'); else if (!/Not implemented/.test(e.message)) errores.push(msg); });
      const dom = new JSDOM(html, {
        url: `https://local.test${ruta}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: consola,
        beforeParse(w) {
          w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
          w.HTMLDialogElement.prototype.close = function () { this.open = false; };
          w.fetch = async (url, init = {}) => {
            const data = init.body ? JSON.parse(init.body) : undefined;
            const r = new URL(url, 'https://local.test').pathname === '/api/activos/asignar-ubicacion' ? await call(app.ubicar.POST, '/api/activos/asignar-ubicacion', { method: 'POST', data, rol: 'jefe' }) : { status: 200, body: {} };
            return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
          };
        },
      });
      await pausa(30);
      return { w: dom.window, avisos };
    };
    const ficha0 = await modulo('activos/_id_.astro.mjs');
    // Desde la ficha: la sede deja solo sus ubicaciones; sin elegir, no se envía.
    const { w, avisos } = await abrir('/activos/11?area=biomedico', { id: '11' });
    const d = w.document;
    d.querySelector('[data-asignar-ubicacion][data-activos="11"]').click();
    ok(d.querySelector('#ubicDialog').open, 'Abre el diálogo');
    ok(d.querySelector('#ubicLugar').disabled, 'Primero la sede');
    d.querySelector('#ubicConfirmar').click();
    await pausa(20);
    ok(!d.querySelector('#ubicErr').classList.contains('hidden') && one('SELECT ubicacion_id u FROM activos WHERE id=11').u === null, 'Sin ubicación no envía');
    const sede = d.querySelector('#ubicSede'); sede.value = '7'; sede.dispatchEvent(new w.Event('change'));
    const lugares = [...d.querySelectorAll('#ubicLugar option')].map((o) => o.value).filter(Boolean);
    ok(!d.querySelector('#ubicLugar').disabled && lugares.includes('73') && lugares.every((v) => ['70', '71', '72', '73'].includes(v)), `Solo las de la sede: ${lugares}`);
    d.querySelector('#ubicLugar').value = '73';
    d.querySelector('#ubicConfirmar').click();
    for (let i = 0; i < 200 && !avisos.length; i++) await pausa(10);
    ok(one('SELECT ubicacion_id u FROM activos WHERE id=11').u === 73, 'Asignada desde la ficha');
    ok(avisos.length > 0, 'Y la página se recarga');
    ok(one("SELECT count(*) n FROM audit_log WHERE entidad='activo' AND entidad_id=11 AND accion='ubicacion'").n === 1, 'Con su registro');
  }

  // ── Ficha: empresa que da mantenimiento y ubicación pendiente ──
  {
    sqlite.exec("INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id,ubicacion) VALUES(13,'BIO-013','Electrocauterio','biomedico','biomedico',NULL,'Arsenal H. E.')");
    const ficha = await modulo('activos/_id_.astro.mjs');
    let { doc, texto } = await ver(ficha, '/activos/13?area=biomedico', 'jefe', { id: '13' });
    ok(doc.querySelector('[data-ubicacion-pendiente]').textContent.includes('Pendiente de asignar · según inventario: Arsenal H. E.'), 'Pendiente en la ficha');
    ok(doc.querySelector('[data-asignar-ubicacion][data-activos="13"]') && doc.querySelector('#ubicDialog'), 'La jefatura la asigna desde la ficha');
    ok(doc.querySelector('[data-empresa-mantenimiento]').textContent.includes('Personal propio') && texto.includes('Vacío = lo hace el personal propio'), 'Sin empresa: personal propio');
    ({ doc } = await ver(ficha, '/activos/13?area=biomedico', 'tecnico', { id: '13' }));
    ok(doc.querySelector('[data-ubicacion-pendiente]') && !doc.querySelector('[data-asignar-ubicacion]') && !doc.querySelector('#ubicDialog'), 'El técnico la ve, no la asigna');
    ({ doc } = await ver(ficha, '/activos/10?area=biomedico', 'jefe', { id: '10' }));
    ok(doc.querySelector('[data-empresa-mantenimiento]').textContent.includes('Empresa Uno'), 'La empresa en la ficha');
    ok(doc.querySelector('#plan-10 [data-lo-realiza]').textContent.includes('Lo realiza: Empresa Uno'), 'Y en su preventivo');
    ok(!doc.querySelector('[data-ubicacion-pendiente]') && !doc.querySelector('#ubicDialog'), 'Con ubicación no hay nada que asignar');
    // Nuevo y editar: el campo se llama como lo pidió la gerencia; el técnico no lo cambia.
    const editar = await modulo('activos/_id_/editar.astro.mjs');
    ({ doc, texto } = await ver(editar, '/activos/10/editar?area=biomedico', 'jefe', { id: '10' }));
    ok(doc.querySelector('label[for="proveedorSel"]').textContent.includes('Empresa que da mantenimiento (opcional)') && texto.includes('Vacío = lo hace el personal propio'), 'Editar: la etiqueta y su ayuda');
    ok(doc.querySelector('#proveedorSel option[value=""]').textContent.includes('Personal propio') && doc.querySelector('#proveedorSel').value === '1' && !doc.querySelector('#proveedorSel').disabled, 'Con la empresa elegida');
    sqlite.exec('UPDATE proveedores SET activo=0 WHERE id=1');
    ({ doc } = await ver(editar, '/activos/10/editar?area=biomedico', 'jefe', { id: '10' }));
    ok(doc.querySelector('#proveedorSel').value === '1' && doc.querySelector('#proveedorSel option[value="1"]').textContent.includes('(desactivada)'), 'Una empresa desactivada no se pierde al editar');
    sqlite.exec('UPDATE proveedores SET activo=1 WHERE id=1');
    ({ doc } = await ver(editar, '/activos/10/editar?area=biomedico', 'tecnico', { id: '10' }));
    ok(doc.querySelector('#proveedorSel').disabled, 'El técnico no la cambia');
    const nuevo = await modulo('activos/nuevo.astro.mjs');
    ({ doc } = await ver(nuevo, '/activos/nuevo?area=biomedico', 'jefe'));
    ok(doc.querySelector('label[for="proveedorSel"]').textContent.includes('Empresa que da mantenimiento (opcional)') && !doc.querySelector('#proveedorSel').disabled, 'Nuevo: la etiqueta');
  }

  // ── La OT de un equipo con empresa dice quién la realiza ──
  {
    sqlite.exec(`INSERT INTO ordenes(id,titulo,tipo,estado,activo_id,rubro,plan_id,creado_por) VALUES(500,'[Preventivo] Monitor','preventivo','abierta',10,'biomedico',10,1),(501,'Falla del desfibrilador','correctivo','abierta',12,'biomedico',NULL,1)`);
    const orden = await modulo('ordenes/_id_.astro.mjs');
    let { doc } = await ver(orden, '/ordenes/500?area=biomedico', 'jefe', { id: '500' });
    ok(doc.querySelector('[data-lo-realiza]')?.textContent.includes('Empresa Uno'), `La OT preventiva: ${doc.querySelector('[data-lo-realiza]')?.textContent}`);
    ({ doc } = await ver(orden, '/ordenes/501?area=biomedico', 'jefe', { id: '501' }));
    ok(!doc.querySelector('[data-lo-realiza]'), 'Sin empresa no se muestra');
    sqlite.exec('UPDATE activos SET proveedor_id=1 WHERE id=12');
    ({ doc } = await ver(orden, '/ordenes/501?area=biomedico', 'jefe', { id: '501' }));
    ok(doc.querySelector('[data-lo-realiza]')?.textContent.includes('Empresa Uno'), 'La correctiva también');
  }

  // ── Tablero: asignar desde una fila recarga la vista (contadores, grupo y carga) ──
  {
    const html = await (await respuesta(tablero, '/preventivos', 'jefe')).text();
    // El contenedor no enlaza los scripts construidos y JSDOM no corre módulos: el
    // script del tablero (no importa nada) va en línea al final de la página.
    const archivo = fs.readdirSync('dist/_astro').find((x) => /^preventivos\.astro_astro_type_script_index_0_lang\..*\.js$/.test(x));
    ok(archivo, 'El script del tablero');
    const conScript = html.replace('</body>', () => `<script>${fs.readFileSync(path.join('dist/_astro', archivo), 'utf8')}</script></body>`);
    const consola = new VirtualConsole();
    const recargasTablero = [];
    consola.on('jsdomError', (e) => { const m = e.detail?.message ?? e.message; if (/navigation/i.test(m)) recargasTablero.push(m); else if (!/Not implemented/.test(e.message)) errores.push(m); });
    const dom = new JSDOM(conScript, {
      url: 'https://local.test/preventivos', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: consola,
      beforeParse(win) {
        win.fetch = async (url, init = {}) => {
          const data = init.body ? JSON.parse(init.body) : undefined;
          const r = new URL(url, 'https://local.test').pathname === '/api/preventivos/asignar' ? await call(app.asignar.POST, '/api/preventivos/asignar', { method: 'POST', data, rol: 'jefe' }) : { status: 200, body: {} };
          return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
        };
      },
    });
    await pausa(30);
    const sel = dom.window.document.querySelector('#atrasados-con select.tecnico-sel[data-plan="2"]');
    sel.value = '20';
    sel.dispatchEvent(new dom.window.Event('change'));
    for (let i = 0; i < 200 && !recargasTablero.length; i++) await pausa(10);
    ok(one('SELECT asignado_a FROM planes_mantenimiento WHERE id=2').asignado_a === 20, 'Asignado desde la fila');
    ok(recargasTablero.length > 0, 'Y la vista se recarga');
  }
  ok(errores.length === 0, `Sin errores de la página: ${errores.join(' | ')}`);

  console.log(`PASS test-tablero-paginas: ${checks} verificaciones; páginas construidas, migraciones reales, sin red.`);
} finally {
  await close();
}
// Las ventanas de JSDOM dejan temporizadores del Layout (avisos): la prueba termina aquí.
process.exit(0);
