// Las páginas construidas del tablero de preventivos, contra migraciones reales: qué ve la
// jefatura en /preventivos, que el técnico no entra, el aviso del panel principal y la ficha
// del equipo, que pide el motivo antes de mover la fecha y muestra el historial junto al
// preventivo. Correr después de npm run build. Sin red.
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
const f = await setupConjuntos({ modules: { plan: 'pages/api/planes/[id]', asignar: 'pages/api/preventivos/asignar' } });
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
  for (const [rol, destino] of [['tecnico', '/campo'], ['visualizador', '/']]) {
    const res = await respuesta(tablero, '/preventivos', rol);
    ok(res.status >= 300 && res.status < 400 && res.headers.get('location') === destino, `${rol} no ve el tablero (${res.status} ${res.headers.get('location')})`);
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
