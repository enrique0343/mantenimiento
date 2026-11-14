// Páginas construidas de la revisión de los espacios (14/11/2026): lo que los dos
// revisores vieron mezclado en pantalla, ahora separado.
//  - /contingencia y /proyectos: solo lo del espacio; /cobertura solo con equipos de
//    General (es del espacio General) y la ficha biomédica sin «Cobertura del sistema».
//  - Panorama de General: la tarjeta SCP no cuenta equipos biomédicos.
//  - Ficha: jerarquía (activo padre) del mismo espacio; «Área» con tilde y «Según
//    inventario: …» con su rótulo; asignar la ubicación ofrece los componentes.
//  - Ventana de asignar ubicación: dice qué sedes no aparecen y no deja confirmar sin ubicación.
//  - Selectores: alertas (Biomédico) sin aires; contratos solo con los equipos del espacio.
//  - Solicitante: sus solicitudes de los dos espacios en /tickets, sin interruptor.
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
  jefeGeneral: { id: 2, rol: 'jefe', especialidad: 'general' },
  jefeBio: { id: 2, rol: 'jefe', especialidad: 'biomedico' },
  solicitante: { id: 5, rol: 'solicitante', especialidad: null },
};
const EN_BIO = { espacio: 'biomedico', espaciosPermitidos: ['general', 'biomedico'] };
const EN_GEN = { espacio: 'general', espaciosPermitidos: ['general', 'biomedico'] };

try {
  sqlite.exec(`
    INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede con salas',1),(2,'Sede sin salas',1);
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,activa) VALUES(1,1,'Rayos X','area',1);
    INSERT INTO proveedores(id,nombre,activo) VALUES(1,'Empresa revisión',1);
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id,ubicacion,estado,criticidad_operacional,padre_id) VALUES
      (101,'RVG-AIRE','Aire RVGMARCA','aires','general',1,NULL,'averiado','alta',NULL),
      (102,'RVG-AIRE2','Aire dos RVGMARCA','aires','general',1,NULL,'operativo','media',NULL),
      (104,'RVB-MON','Monitor RVBMARCA','biomedico','biomedico',1,'RAYOS X','averiado','alta',NULL),
      (105,'RVB-TAC','Tomógrafo RVBMARCA','biomedico','biomedico',NULL,'Quirófano Sky','operativo','alta',NULL),
      (106,'RVB-PIEZA','Pieza del tomógrafo RVBMARCA','biomedico','biomedico',NULL,'Quirófano Sky','operativo','baja',105),
      (107,'RVG-SALA','Aire de sala RVGMARCA','aires','general',1,'Azotea','operativo','media',NULL);
    INSERT INTO proyectos(id,codigo,titulo,creado_por,activo_id) VALUES (1,'PRY-9001','Proyecto RVBMARCA',1,104),(2,'PRY-9002','Proyecto RVGMARCA',1,101);
    INSERT INTO contratos_mantenimiento(id,codigo,nombre,proveedor_id,fecha_inicio,fecha_fin,creado_por) VALUES (1,'C-RV','Contrato común',1,'2026-01-01','2027-01-01',1);
    INSERT INTO contrato_equipos(contrato_id,activo_id) VALUES (1,101),(1,104);
    INSERT INTO tickets(id,tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,rubro,activo_id,estado) VALUES
      (301,'tk-rv-a','Persona','p@example.invalid','Aire RVGMARCA no enfría','x','aires',101,'nuevo'),
      (304,'tk-rv-b','Persona','p@example.invalid','Monitor RVBMARCA sin señal','x','biomedico',104,'nuevo');
  `);
  const container = await experimental_AstroContainer.create();
  const ver = async (componente, ruta, cuenta, { params = {}, locals = {} } = {}) => {
    const res = await container.renderToResponse(componente, {
      partial: false, request: new Request(`https://local.test${ruta}`), params,
      locals: { user: { ...CUENTAS[cuenta], nombre: `Cuenta ${cuenta}`, email: `${cuenta}@example.invalid` }, runtime: { env: { DB } }, ...locals },
    });
    const html = await res.text();
    const doc = new JSDOM(html).window.document;
    doc.querySelectorAll('script').forEach((s) => s.remove());
    return { status: res.status, doc, html, texto: doc.querySelector('main')?.textContent.replace(/\s+/g, ' ') ?? '' };
  };
  const marcas = (texto, marca) => texto.includes(marca);

  // ── /contingencia y /proyectos: solo el espacio ─────────────────────────────
  for (const [pagina, ruta] of [['contingencia.astro.mjs', '/contingencia'], ['proyectos.astro.mjs', '/proyectos']]) {
    const m = await modulo(pagina);
    for (const [cuenta, locals, propia, ajena] of [
      ['jefeGeneral', {}, 'RVGMARCA', 'RVBMARCA'], ['jefeBio', {}, 'RVBMARCA', 'RVGMARCA'],
      ['admin', EN_GEN, 'RVGMARCA', 'RVBMARCA'], ['admin', EN_BIO, 'RVBMARCA', 'RVGMARCA'],
    ]) {
      const v = await ver(m, ruta, cuenta, { locals });
      es(v.status, 200, `${ruta} [${cuenta} ${locals.espacio ?? ''}]: 200`);
      ok(marcas(v.texto, propia) && !marcas(v.texto, ajena), `${ruta} [${cuenta} ${locals.espacio ?? ''}]: ve ${propia} y no ${ajena}`);
    }
  }

  // ── /cobertura: es de General y solo cuenta sus equipos ─────────────────────
  {
    const m = await modulo('cobertura.astro.mjs');
    const v = await ver(m, '/cobertura', 'admin', { locals: EN_GEN });
    es(v.status, 200, '/cobertura en General');
    ok(v.html.includes('RVG-AIRE') && !v.html.includes('RVB-'), '/cobertura lista los aires y ningún biomédico');
  }

  // ── Panorama de General: el SCP no cuenta biomédicos ────────────────────────
  {
    const panel = await modulo('index.astro.mjs');
    const scp = async () => {
      const v = await ver(panel, '/', 'admin', { locals: EN_GEN });
      const tarjeta = [...v.doc.querySelectorAll('main *')].find((e) => /Equipos gobernados/.test(e.textContent) && e.children.length < 40 && /\d/.test(e.textContent));
      return v.texto.match(/(\d+) equipo\(s\) crítico\(s\) sin familia declarada/)?.[1] ?? (tarjeta ? 'sin-criticos' : 'sin-tarjeta');
    };
    const antes = await scp();
    es(antes, '1', `General: un aire crítico sin familia (${antes}), no los biomédicos`);
    sqlite.exec("INSERT INTO activos(id,codigo,nombre,rubro,tipo,estado,criticidad_operacional) VALUES (190,'RVB-MAS','Desfibrilador más','biomedico','biomedico','operativo','alta')");
    es(await scp(), antes, 'un biomédico crítico más no cambia la cifra de General');
    sqlite.exec('DELETE FROM activos WHERE id=190');
  }

  // ── La ficha ────────────────────────────────────────────────────────────────
  const ficha = await modulo('activos/_id_.astro.mjs');
  {
    const bio = await ver(ficha, '/activos/104?area=biomedico', 'admin', { params: { id: '104' }, locals: EN_BIO });
    es(bio.status, 200, 'ficha del monitor');
    const padres = [...bio.doc.querySelectorAll('option')].map((o) => o.textContent);
    ok(padres.some((t) => t.includes('RVB-TAC')), 'la jerarquía ofrece equipos biomédicos');
    ok(!padres.some((t) => t.includes('RVG-')), 'y ningún aire como padre ni como respaldo');
    ok(!bio.doc.querySelector('a[href^="/cobertura"]'), 'la ficha biomédica no lleva a «Cobertura del sistema» (es de General)');
    ok(bio.texto.includes('Rayos X (Área)') && !bio.texto.includes('(Area)') && !bio.texto.includes('(area)'), '«Área» con tilde');
    es(bio.doc.querySelector('[data-segun-inventario]')?.textContent.trim(), 'Según inventario: RAYOS X', 'el texto viejo con su rótulo');
    const gen = await ver(ficha, '/activos/107?area=aires', 'admin', { params: { id: '107' }, locals: EN_GEN });
    es(gen.doc.querySelector('[data-segun-inventario]')?.textContent.trim(), 'Detalle: Azotea', 'en General es el detalle de siempre');
    const tac = await ver(ficha, '/activos/105?area=biomedico', 'admin', { params: { id: '105' }, locals: EN_BIO });
    es(tac.doc.querySelector('[data-asignar-ubicacion]')?.getAttribute('data-componentes'), '106', 'asignar la ubicación del tomógrafo ofrece su pieza');
    ok(tac.doc.querySelector('#ubicConfirmar')?.hasAttribute('disabled'), 'sin ubicación elegida, el botón está apagado');
    ok(tac.doc.querySelector('[data-sedes-sin-ubicaciones]')?.textContent.includes('Sede sin salas'), 'dice qué sede no aparece y dónde crear sus ubicaciones');
    ok(tac.doc.querySelector('[data-sedes-sin-ubicaciones] a[href="/ubicaciones"]'), 'con el enlace a Ubicaciones');
  }

  // ── El tablero biomédico: los pendientes saben de quién son pieza ───────────
  {
    const tablero = await modulo('preventivos.astro.mjs');
    const v = await ver(tablero, '/preventivos', 'jefeBio');
    es(v.doc.querySelector('.sel-pendiente[data-activo="106"]')?.getAttribute('data-padre'), '105', 'la pieza pendiente lleva su padre');
    ok(!v.doc.querySelector('.sel-pendiente[data-activo="105"]')?.hasAttribute('data-padre'), 'el tomógrafo no');
  }

  // ── Selectores: alertas sin aires; contratos del espacio ────────────────────
  {
    const alertas = await modulo('alertas.astro.mjs');
    const v = await ver(alertas, '/alertas', 'jefeBio');
    const opciones = v.html.match(/RV[GB]-[A-Z0-9]+/g) ?? [];
    ok(opciones.includes('RVB-MON') && !opciones.some((c) => c.startsWith('RVG-')), `alertas: solo equipos biomédicos (${[...new Set(opciones)].join(', ')})`);
    const nuevo = await modulo('contratos/nuevo.astro.mjs');
    const g = await ver(nuevo, '/contratos/nuevo', 'jefeGeneral');
    ok(g.html.includes('RVG-AIRE') && !g.html.includes('RVB-'), 'contrato nuevo en General: solo sus equipos');
    const b = await ver(nuevo, '/contratos/nuevo', 'jefeBio');
    ok(b.html.includes('RVB-MON') && !b.html.includes('RVG-'), 'en Biomédico: solo los biomédicos');
    const det = await modulo('contratos/_id_.astro.mjs');
    const dg = await ver(det, '/contratos/1', 'jefeGeneral', { params: { id: '1' } });
    ok(dg.html.includes('RVG-AIRE') && !dg.html.includes('RVB-'), 'el contrato común en General: su aire, sin el monitor');
    ok(dg.doc.querySelector('[data-equipos-otro-espacio]')?.textContent.includes('1 equipo(s) del espacio Biomédico'), 'y cuenta el del otro espacio sin mostrarlo');
  }

  // ── El solicitante: sus solicitudes de los dos espacios, sin interruptor ────
  {
    const lista = await modulo('tickets.astro.mjs');
    const v = await ver(lista, '/tickets', 'solicitante');
    es(v.status, 200, '/tickets del solicitante');
    ok(v.texto.includes('Aire RVGMARCA') && v.texto.includes('Monitor RVBMARCA'), 've sus dos solicitudes en una sola lista');
    ok(!v.doc.querySelector('#espacioSwitch'), 'sin interruptor');
    const j = await ver(lista, '/tickets', 'jefeGeneral');
    ok(j.texto.includes('Aire RVGMARCA') && !j.texto.includes('Monitor RVBMARCA'), 'el jefe de General sigue viendo solo General');
    const a = await ver(lista, '/tickets', 'admin', { locals: EN_GEN });
    ok(a.doc.querySelector('#espacioSwitch'), 'el admin sí tiene interruptor');
  }

  es(red, 0, 'sin red');
  console.log(`PASS test-espacios-revision-paginas: ${checks} verificaciones; contingencia, proyectos y cobertura por espacio, SCP de General, ficha (jerarquía, «Área», «Según inventario», componentes y sedes sin ubicaciones), tablero, alertas, contratos y solicitante. Páginas construidas, migraciones reales, sin red.`);
} finally { globalThis.fetch = fetchOriginal; await close(); }
