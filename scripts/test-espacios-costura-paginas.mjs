// Páginas construidas de la costura entre los espacios y el tablero biomédico
// (14/11/2026): /preventivos se llama y se arma según el espacio que dejó el
// middleware (y no según uno que el usuario no tiene); en General no hay pendientes
// de ubicación ni calibraciones; el menú enlaza el tablero de cada espacio también
// para el visualizador; el aviso del panel principal cuenta solo lo del espacio; y la
// ficha de un equipo general no pinta licencias ni capacitaciones (son de Biomédico).
// Correr después de npm run build. Sin red.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { experimental_AstroContainer } from 'astro/container';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';

fijarReloj();
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const f = await setupConjuntos({});
const { sqlite, DB, close } = f;
const modulo = async (ruta) => (await import(pathToFileURL(path.join(process.cwd(), 'dist/_worker.js/pages', ruta)).href)).page().default;
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const es = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
let red = 0;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async () => { red++; throw new Error('Sin red en esta prueba'); };

const CUENTAS = {
  admin: { id: 1, rol: 'admin', especialidad: null },
  visualizador: { id: 4, rol: 'visualizador', especialidad: null },
  jefeAmbos: { id: 2, rol: 'jefe', especialidad: 'ambos' },
  jefeGeneral: { id: 2, rol: 'jefe', especialidad: 'general' },
  jefeBio: { id: 2, rol: 'jefe', especialidad: 'biomedico' },
};
const HOY = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const dia = (k) => new Date(Date.parse(`${HOY}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);

try {
  sqlite.exec(`
    INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede costura',1);
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,activa) VALUES(1,1,'Sala costura','area',1);
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id,ubicacion,requiere_calibracion) VALUES
      (701,'CSP-AIRE','Aire costura','aires','general',1,NULL,0),
      (702,'CSP-AIRE-PEND','Aire sin ubicación','aires','general',NULL,'Azotea norte',0),
      (703,'CSP-BIO','Monitor costura','biomedico','biomedico',1,NULL,1),
      (704,'CSP-BIO-PEND','Bomba sin ubicación','biomedico','biomedico',NULL,'Quirófano Azul C. M.',0);
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha) VALUES
      (801,701,'Rutina CSPPL-AIRE','mensual','${dia(-2)}'),
      (802,703,'Rutina CSPPL-BIO','semestral','${dia(-3)}'),
      (803,704,'Rutina CSPPL-BIOPEND','anual','${dia(-4)}'),
      (804,703,'Rutina CSPPL-BIO2','anual','${dia(5)}');
    INSERT INTO calibraciones(activo_id,fecha_calibracion,proxima_calibracion,resultado,certificado_r2_key,usuario_id) VALUES
      (703,'${dia(-400)}','${dia(-5)}','conforme','cert/b.pdf',1);
  `);
  const container = await experimental_AstroContainer.create();
  const respuesta = async (componente, ruta, cuenta, { params = {}, locals = {} } = {}) => container.renderToResponse(componente, {
    partial: false, request: new Request(`https://local.test${ruta}`), params,
    locals: { user: { ...CUENTAS[cuenta], nombre: `Cuenta ${cuenta}`, email: `${cuenta}@example.invalid` }, runtime: { env: { DB } }, ...locals },
  });
  const ver = async (componente, ruta, cuenta, opciones) => {
    const res = await respuesta(componente, ruta, cuenta, opciones);
    const html = await res.text();
    const doc = new JSDOM(html).window.document;
    doc.querySelectorAll('script').forEach((s) => s.remove());
    return { status: res.status, doc, html, texto: doc.body.textContent.replace(/\s+/g, ' ') };
  };
  const enlaceTablero = (doc) => [...doc.querySelectorAll('#sidebar a.app-nav-link')].filter((a) => a.getAttribute('href') === '/preventivos').map((a) => a.textContent.trim());
  const DE_BIO = ['CSPPL-BIO', 'CSP-BIO-PEND', 'CSP-BIO '];

  // ── /preventivos con el espacio del middleware ──────────────────────────────
  const tablero = await modulo('preventivos.astro.mjs');
  for (const [cuenta, locals, espacio] of [
    ['admin', { espacio: 'biomedico', espaciosPermitidos: ['general', 'biomedico'] }, 'biomedico'],
    ['admin', { espacio: 'general', espaciosPermitidos: ['general', 'biomedico'] }, 'general'],
    ['jefeAmbos', { espacio: 'biomedico', espaciosPermitidos: ['general', 'biomedico'] }, 'biomedico'],
    ['jefeGeneral', { espacio: 'biomedico' }, 'general'], // un locals que no le corresponde no abre Biomédico
    ['jefeBio', {}, 'biomedico'],
    ['jefeGeneral', {}, 'general'],
    ['visualizador', { espacio: 'biomedico', espaciosPermitidos: ['general', 'biomedico'] }, 'biomedico'],
  ]) {
    const quien = `${cuenta} con locals ${locals.espacio ?? '(sin)'}`;
    const { status, doc, texto } = await ver(tablero, '/preventivos', cuenta, { locals });
    es(status, 200, `${quien}: 200`);
    const titulo = espacio === 'biomedico' ? 'Tablero biomédico' : 'Tablero de preventivos';
    es(doc.querySelector('main h1')?.textContent.trim(), titulo, `${quien}: el título`);
    es(doc.querySelector('#sidebar')?.getAttribute('data-espacio'), espacio, `${quien}: el menú es del mismo espacio que el tablero`);
    es(enlaceTablero(doc), [titulo], `${quien}: el menú enlaza «${titulo}» y no el del otro espacio`);
    ok(doc.querySelector('#sidebar a.app-nav-link[href="/preventivos"]')?.getAttribute('aria-current') === 'page' || doc.querySelector('#sidebar a.app-nav-link[href="/preventivos"]')?.className.includes('active'), `${quien}: el enlace del tablero queda marcado`);
    if (espacio === 'general') {
      ok(!doc.querySelector('#pendientes-ubicacion') && !doc.querySelector('#calibraciones'), `${quien}: General sin pendientes de ubicación ni calibraciones`);
      ok(!doc.querySelector('[data-tarjeta="pendientes"]') && !doc.querySelector('[data-tarjeta="cal-vencidas"]'), `${quien}: ni sus tarjetas`);
      for (const c of DE_BIO) ok(!texto.includes(c), `${quien}: no ve ${c.trim()}`);
      ok(!texto.includes('Azotea norte') && !texto.includes('Quirófano Azul'), `${quien}: ningún texto de inventario de pendientes`);
      ok(texto.includes('CSPPL-AIRE'), `${quien}: ve el preventivo del aire`);
    } else {
      const pend = doc.querySelector('#pendientes-ubicacion');
      ok(pend && pend.textContent.includes('CSP-BIO-PEND') && pend.textContent.includes('según inventario: Quirófano Azul C. M.'), `${quien}: pendiente biomédico con el texto del inventario`);
      ok(!pend.textContent.includes('CSP-AIRE-PEND') && !texto.includes('Azotea norte'), `${quien}: el aire sin ubicación no sale en Biomédico`);
      ok(doc.querySelector('#calibraciones')?.textContent.includes('CSP-BIO'), `${quien}: la calibración vencida`);
      ok(!texto.includes('CSPPL-AIRE'), `${quien}: no ve el preventivo del aire`);
    }
  }
  // La búsqueda del tablero se queda en el espacio.
  {
    const g = await ver(tablero, '/preventivos?q=CSP', 'jefeGeneral');
    ok(g.texto.includes('CSPPL-AIRE') && !g.texto.includes('CSPPL-BIO'), 'buscar «CSP» en General: solo el aire');
    const b = await ver(tablero, '/preventivos?q=CSP', 'jefeBio');
    ok(b.texto.includes('CSPPL-BIO') && !b.texto.includes('CSPPL-AIRE'), 'buscar «CSP» en Biomédico: solo lo biomédico');
  }

  // ── El panel principal: el aviso del tablero cuenta solo lo del espacio ─────
  {
    const panel = await modulo('index.astro.mjs');
    const aviso = (doc) => doc.querySelector('main a[href="/preventivos"]')?.textContent.replace(/\s+/g, ' ').trim() ?? null;
    const g = aviso((await ver(panel, '/', 'jefeGeneral')).doc);
    ok(g?.includes('Tablero de preventivos') && g.includes('1 atrasados de 1 día o más (1 sin asignar)') && g.includes(' 0 programados'), `General: solo el atraso del aire (${g})`);
    const b = aviso((await ver(panel, '/', 'jefeBio')).doc);
    ok(b?.includes('Tablero biomédico') && b.includes('2 atrasados de 1 día o más (2 sin asignar)') && b.includes(' 1 programados'), `Biomédico: sus dos atrasos y su programado (${b})`);
    const a = aviso((await ver(panel, '/', 'admin', { locals: { espacio: 'general', espaciosPermitidos: ['general', 'biomedico'] } })).doc);
    ok(a?.includes('1 atrasados'), `admin en General: lo de General (${a})`);
  }

  // ── El menú: el visualizador también llega a su tablero ─────────────────────
  {
    const ordenes = await modulo('ordenes.astro.mjs');
    const g = await ver(ordenes, '/ordenes', 'visualizador');
    es(enlaceTablero(g.doc), ['Tablero de preventivos'], 'visualizador en General: el tablero de General');
    const b = await ver(ordenes, '/ordenes', 'visualizador', { locals: { espacio: 'biomedico', espaciosPermitidos: ['general', 'biomedico'] } });
    es(enlaceTablero(b.doc), ['Tablero biomédico'], 'visualizador en Biomédico: el tablero biomédico');
    const v = await ver(tablero, '/preventivos', 'visualizador');
    ok(v.status === 200 && v.texto.includes('Vista de consulta') && !v.doc.querySelector('[data-asignar-ubicacion]'), 'el visualizador consulta el tablero sin asignar');
  }

  // ── La ficha: lo de Biomédico solo en equipos biomédicos ────────────────────
  {
    const ficha = await modulo('activos/_id_.astro.mjs');
    const gen = await ver(ficha, '/activos/701?area=aires', 'admin', { params: { id: '701' } });
    es(gen.status, 200, 'ficha del aire');
    ok(!gen.doc.querySelector('#licencias') && !gen.doc.querySelector('#capacitaciones'), 'el aire no pinta licencias ni capacitaciones (llevarían a Biomédico)');
    const bio = await ver(ficha, '/activos/704?area=biomedico', 'admin', { params: { id: '704' }, locals: { espacio: 'biomedico', espaciosPermitidos: ['general', 'biomedico'] } });
    es(bio.status, 200, 'ficha del biomédico pendiente');
    ok(bio.doc.querySelector('#licencias') && bio.doc.querySelector('#capacitaciones'), 'el biomédico sí pinta licencias y capacitaciones');
    ok(bio.doc.querySelector('[data-ubicacion-pendiente]')?.textContent.trim() === 'Pendiente de asignar · según inventario: Quirófano Azul C. M.', 'la ficha dice «Pendiente de asignar · según inventario: …»');
    const ajena = await respuesta(ficha, '/activos/704?area=biomedico', 'jefeGeneral', { params: { id: '704' } });
    const textoAjena = await ajena.text();
    ok(ajena.status === 403 && !textoAjena.includes('Quirófano Azul') && !textoAjena.includes('CSP-BIO-PEND'), 'el jefe de General: 403 sin el texto del inventario');
  }

  es(red, 0, 'sin red');
  console.log(`PASS test-espacios-costura-paginas: ${checks} verificaciones; /preventivos con el espacio del middleware, General sin pendientes ni calibraciones, búsqueda dentro del espacio, aviso del panel por espacio, menú del tablero también para el visualizador y la ficha sin lo biomédico en equipos generales. Páginas construidas, migraciones reales, sin red.`);
} finally { globalThis.fetch = fetchOriginal; await close(); }
