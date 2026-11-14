// Páginas construidas de los dos espacios, contra migraciones reales: el menú, el color,
// el rótulo y el interruptor de cada espacio; que cada lista muestre solo lo suyo (las
// cuatro áreas y los casos viejos); el aviso «Este registro es del espacio …»; /campo
// del técnico sin cambios; y 150 equipos por espacio sin pasar los límites de D1.
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
const { sqlite, DB, close, faults } = f;
const modulo = async (ruta) => (await import(pathToFileURL(path.join(process.cwd(), 'dist/_worker.js/pages', ruta)).href)).page().default;
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const es = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
let red = 0;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async () => { red++; throw new Error('Sin red en esta prueba'); };

// Cuentas: admin y visualizador ven los dos; el jefe y el técnico según su especialidad.
const CUENTAS = {
  admin: { id: 1, rol: 'admin', especialidad: null },
  visualizador: { id: 4, rol: 'visualizador', especialidad: null },
  jefeAmbos: { id: 2, rol: 'jefe', especialidad: 'ambos' },
  jefeGeneral: { id: 2, rol: 'jefe', especialidad: 'general' },
  jefeBio: { id: 2, rol: 'jefe', especialidad: 'biomedico' },
  tecnicoBio: { id: 3, rol: 'tecnico', especialidad: 'biomedico' },
};

try {
  sqlite.exec(`
    INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede prueba',1);
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,activa) VALUES(1,1,'Sala','area',1);
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id,ubicacion) VALUES
      (101,'PAG-AIRES','Aire de prueba','aires','general',1,NULL),
      (102,'PAG-INFRA','Techo de prueba','infraestructura','general',1,NULL),
      (103,'PAG-EQG','Bomba de prueba','equipo_general','general',1,NULL),
      (104,'PAG-BIO','Monitor de prueba','biomedico','biomedico',NULL,'Quirófano Azul C. M.'),
      (105,'PAG-LEGBIO','Desfibrilador viejo',NULL,'biomedico',1,NULL);
    INSERT INTO ordenes(id,creado_por,titulo,rubro,tipo,estado,activo_id,asignado_a,vencimiento) VALUES
      (201,1,'Trabajo PAGOT-AIRES','aires','correctivo','abierta',101,2,'2026-11-20T12:00:00Z'),
      (202,1,'Trabajo PAGOT-INFRA','infraestructura','correctivo','abierta',102,2,'2026-11-20T12:00:00Z'),
      (204,1,'Trabajo PAGOT-BIO','biomedico','correctivo','abierta',104,2,'2026-11-20T12:00:00Z'),
      (205,1,'Trabajo PAGOT-LEGBIO',NULL,'correctivo','abierta',105,2,'2026-11-20T12:00:00Z');
    INSERT INTO tickets(id,tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,rubro,activo_id) VALUES
      (301,'tk-a','P','p@example.invalid','Solicitud PAGTK-AIRES','x','aires',101),
      (304,'tk-b','P','p@example.invalid','Solicitud PAGTK-BIO','x','biomedico',104);
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,asignado_a) VALUES
      (401,101,'Rutina PAGPL-AIRES','mensual','2026-11-25',2),(404,104,'Rutina PAGPL-BIO','semestral','2026-11-26',2),
      (405,105,'Rutina PAGPL-LEGBIO','anual','2026-11-27',2);
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
  const menu = (doc) => [...doc.querySelectorAll('#sidebar a.app-nav-link')].map((a) => a.getAttribute('href'));
  const etiquetas = (doc) => [...doc.querySelectorAll('#sidebar a.app-nav-link span')].map((s) => s.textContent.trim());

  // ── Menú, color, rótulo e interruptor de cada espacio ──────────────────────
  const ordenesPag = await modulo('ordenes.astro.mjs');
  const SOLO_GENERAL = ['/ronda', '/aop', '/eop', '/electrico', '/areas/aires', '/areas/infraestructura', '/areas/equipo_general'];
  const SOLO_BIO = ['/calibraciones?area=biomedico', '/seguridad-electrica?area=biomedico', '/expedientes?area=biomedico', '/licencias', '/capacitaciones?area=biomedico', '/alertas', '/cumplimiento', '/centros-costo'];
  const COMUNES = ['/preventivos', '/indicadores', '/recursos', '/administracion', '/mi-panel', '/campo', '/manual'];
  for (const [cuenta, ruta, espacio, interruptor] of [
    ['admin', '/ordenes', 'general', true], ['admin', '/ordenes?espacio=biomedico', 'biomedico', true],
    ['jefeAmbos', '/ordenes', 'general', true], ['jefeAmbos', '/ordenes?espacio=biomedico', 'biomedico', true],
    ['jefeGeneral', '/ordenes', 'general', false], ['jefeGeneral', '/ordenes?espacio=biomedico', 'general', false],
    ['jefeBio', '/ordenes', 'biomedico', false], ['jefeBio', '/ordenes?espacio=general', 'biomedico', false],
  ]) {
    const { status, doc, texto } = await ver(ordenesPag, ruta, cuenta);
    const quien = `${cuenta} en ${ruta}`;
    es(status, 200, quien);
    const barra = doc.querySelector('#sidebar');
    es(barra.getAttribute('style'), `background:${espacio === 'general' ? '#1E2142' : '#23417D'}`, `${quien}: color de la barra`);
    es(barra.getAttribute('data-espacio'), espacio, `${quien}: espacio`);
    const franja = doc.querySelector('.franja-espacio');
    es(franja ? franja.getAttribute('style') : null, espacio === 'general' ? null : 'background:#23417D', `${quien}: franja superior`);
    es(doc.querySelector('[data-rotulo-espacio]').textContent.trim(), espacio === 'general' ? 'Mantenimiento general' : 'Ingeniería biomédica', `${quien}: rótulo junto al logo`);
    const m = menu(doc);
    for (const h of espacio === 'general' ? SOLO_GENERAL : SOLO_BIO) ok(m.includes(h), `${quien}: el menú tiene ${h}`);
    for (const h of espacio === 'general' ? SOLO_BIO : SOLO_GENERAL) ok(!m.includes(h), `${quien}: el menú no tiene ${h}`);
    for (const h of COMUNES) ok(m.includes(h), `${quien}: lo común (${h})`);
    ok(etiquetas(doc).includes(espacio === 'general' ? 'Tablero de preventivos' : 'Tablero biomédico'), `${quien}: el tablero se llama según el espacio`);
    ok(!etiquetas(doc).includes(espacio === 'general' ? 'Tablero biomédico' : 'Tablero de preventivos'), `${quien}: y no con el nombre del otro`);
    ok(m.includes('/administracion'), `${quien}: Administración en los dos`);
    const sw = doc.querySelector('form#espacioSwitch');
    es(!!sw, interruptor, `${quien}: interruptor`);
    if (sw) {
      es(sw.getAttribute('action'), '/api/espacio', 'el interruptor guarda en /api/espacio');
      es([...sw.querySelectorAll('button[name="espacio"]')].map((b) => [b.value, b.textContent.trim(), b.getAttribute('aria-pressed')]),
        [['general', 'General', String(espacio === 'general')], ['biomedico', 'Biomédico', String(espacio === 'biomedico')]], `${quien}: General | Biomédico`);
      es(sw.querySelector('input[name="volver"]').value, ruta, 'vuelve a la misma dirección');
    }
    ok(texto.includes(espacio === 'general' ? 'Buscar en general' : 'Buscar en biomédico'), `${quien}: la búsqueda dice su espacio`);
    // La lista: solo las órdenes de su espacio (la vieja sin rubro de un biomédico es de Biomédico).
    const deGeneral = ['PAGOT-AIRES', 'PAGOT-INFRA'], deBio = ['PAGOT-BIO', 'PAGOT-LEGBIO'];
    for (const c of espacio === 'general' ? deGeneral : deBio) ok(texto.includes(c), `${quien}: ve ${c}`);
    for (const c of espacio === 'general' ? deBio : deGeneral) ok(!texto.includes(c), `${quien}: no ve ${c}`);
  }

  // ── Cada lista y cada tablero, solo con lo suyo ───────────────────────────
  const GEN = ['PAG-AIRES', 'PAG-INFRA', 'PAGOT-AIRES', 'PAGOT-INFRA', 'PAGTK-AIRES', 'PAGPL-AIRES'];
  const BIO = ['PAG-BIO', 'PAG-LEGBIO', 'PAGOT-BIO', 'PAGOT-LEGBIO', 'PAGTK-BIO', 'PAGPL-BIO', 'PAGPL-LEGBIO'];
  const paginas = [
    ['activos.astro.mjs', '/activos', ['PAG-AIRES', 'PAG-INFRA', 'PAG-EQG'], ['PAG-BIO', 'PAG-LEGBIO']],
    ['tickets.astro.mjs', '/tickets', ['PAGTK-AIRES'], ['PAGTK-BIO']],
    ['planes.astro.mjs', '/planes', ['PAGPL-AIRES'], ['PAGPL-BIO', 'PAGPL-LEGBIO']],
    ['cronograma.astro.mjs', '/cronograma', ['PAGPL-AIRES'], ['PAGPL-BIO', 'PAGPL-LEGBIO']],
    ['gantt.astro.mjs', '/gantt', ['PAGPL-AIRES'], ['PAGPL-BIO', 'PAGPL-LEGBIO']],
    ['planificador.astro.mjs', '/planificador?m=2026-11', ['PAGOT-AIRES', 'PAGPL-AIRES'], ['PAGOT-BIO', 'PAGPL-BIO']],
    ['plan-mantenimiento.astro.mjs', '/plan-mantenimiento?anio=2026', ['PAG-AIRES'], ['PAG-BIO', 'PAG-LEGBIO']],
    ['mi-panel.astro.mjs', '/mi-panel', ['PAGOT-AIRES'], ['PAGOT-BIO', 'PAGOT-LEGBIO']],
    ['taller.astro.mjs', '/taller', ['PAGOT-AIRES'], ['PAGOT-BIO', 'PAGOT-LEGBIO']],
    ['resumen.astro.mjs', '/resumen', ['PAGPL-AIRES'], ['PAGPL-BIO']],
    ['kpis.astro.mjs', '/kpis', [], []],
    ['index.astro.mjs', '/', [], []],
  ];
  for (const [mod, ruta, propios, ajenos] of paginas) {
    const pag = await modulo(mod);
    for (const [cuenta, espacio] of [['jefeGeneral', 'general'], ['jefeBio', 'biomedico'], ['admin', 'general']]) {
      if (ruta === '/mi-panel' && cuenta === 'admin') continue; // Mi trabajo es personal: lo asignado al jefe.
      const { status, texto } = await ver(pag, ruta, cuenta);
      es(status, 200, `${ruta} como ${cuenta}`);
      const ve = espacio === 'general' ? propios : ajenos, noVe = espacio === 'general' ? ajenos : propios;
      for (const c of ve) ok(texto.includes(c), `${ruta} (${cuenta}): ve ${c}`);
      for (const c of noVe) ok(!texto.includes(c), `${ruta} (${cuenta}): no ve ${c}`);
    }
  }
  {
    // Panel principal: las áreas del espacio y, en Biomédico, nada de la ronda.
    const panel = await modulo('index.astro.mjs');
    const g = await ver(panel, '/', 'jefeGeneral');
    es([...g.doc.querySelectorAll('a.workspace-card')].map((a) => a.getAttribute('href')), ['/areas/aires', '/areas/infraestructura', '/areas/equipo_general'], 'panel de General');
    const b = await ver(panel, '/', 'jefeBio');
    es([...b.doc.querySelectorAll('a.workspace-card')].map((a) => a.getAttribute('href')), ['/areas/biomedico'], 'panel de Biomédico');
    ok(b.texto.includes('Panorama biomédico') && !b.texto.includes('¿Se hizo la ronda'), 'Biomédico sin la cadena de la ronda');
    // El equipo pendiente de ubicación se ve con el texto del inventario.
    const eqs = await ver(await modulo('activos.astro.mjs'), '/activos', 'jefeBio');
    ok(eqs.texto.includes('Pendiente de asignar · según inventario: Quirófano Azul C. M.'), 'pendiente de asignar ubicación, con el texto del inventario');
    // Indicadores: solo la serie del espacio.
    const k = await ver(await modulo('kpis.astro.mjs'), '/kpis', 'jefeBio');
    ok(k.texto.includes('Indicadores · Ingeniería biomédica') && !k.texto.includes('horas fuera de rango por sala'), 'KPI de Biomédico sin lo de las salas (AOP)');
    const kg = await ver(await modulo('kpis.astro.mjs'), '/kpis', 'jefeGeneral');
    ok(kg.texto.includes('horas fuera de rango por sala'), 'KPI de General con lo de las salas');
    // Recursos y administración: lo biomédico solo en Biomédico.
    const rg = await ver(await modulo('recursos.astro.mjs'), '/recursos', 'jefeGeneral');
    ok(!rg.doc.querySelector('main a[href="/calibraciones"]') && rg.doc.querySelector('main a[href="/inventario"]'), 'Recursos en General: sin calibraciones, con el almacén');
    const rb = await ver(await modulo('recursos.astro.mjs'), '/recursos', 'jefeBio');
    ok(rb.doc.querySelector('main a[href="/calibraciones"]') && rb.doc.querySelector('main a[href="/inventario"]'), 'Recursos en Biomédico: calibraciones y el almacén común');
    const ag = await ver(await modulo('administracion.astro.mjs'), '/administracion', 'jefeGeneral');
    const ab = await ver(await modulo('administracion.astro.mjs'), '/administracion', 'jefeBio');
    ok(ag.doc.querySelector('main a[href="/raci"]') && !ag.doc.querySelector('main a[href="/centros-costo"]'), 'Administración en General');
    ok(ab.doc.querySelector('main a[href="/raci"]') && ab.doc.querySelector('main a[href="/centros-costo"]'), 'Administración en Biomédico');
    // Una lista con ?area= de un espacio al que no entra: 403 sin datos.
    const cruz = await ver(ordenesPag, '/ordenes?area=aires', 'jefeBio');
    ok(cruz.status === 403 && !cruz.html.includes('PAGOT'), 'el biomédico no lista las órdenes de aires');
    // Una ficha del otro espacio, sin el middleware: 403 sin datos.
    const ficha = await respuesta(await modulo('ordenes/_id_.astro.mjs'), '/ordenes/201', 'jefeBio', { params: { id: '201' } });
    const fichaTexto = await ficha.text();
    ok(ficha.status === 403 && !fichaTexto.includes('PAGOT-AIRES'), 'ficha de una OT de aire para el biomédico: 403');
    const fichaEq = await respuesta(await modulo('activos/_id_.astro.mjs'), '/activos/101?area=aires', 'jefeBio', { params: { id: '101' } });
    ok(fichaEq.status === 403 && !(await fichaEq.text()).includes('Aire de prueba'), 'ficha de un aire para el biomédico: 403');
    const area = await respuesta(await modulo('areas/_area_.astro.mjs'), '/areas/aires', 'jefeBio', { params: { area: 'aires' } });
    es(area.status, 403, '/areas/aires para el biomédico');
  }

  // ── El aviso «Este registro es del espacio …» ─────────────────────────────
  const aviso = await modulo('otro-espacio.astro.mjs');
  {
    const r = await ver(aviso, '/otro-espacio', 'jefeAmbos', { locals: { avisoEspacio: { espacio: 'biomedico', puedeCambiar: true, volver: '/activos/104?area=biomedico' } } });
    es(r.status, 200, 'con los dos espacios: 200');
    es(r.doc.querySelector('h1').textContent.trim(), 'Este registro es del espacio Biomédico.', 'el aviso');
    const boton = r.doc.querySelector('[data-cambiar-espacio]');
    es([boton?.textContent.trim(), boton?.getAttribute('href')], ['Cambiar a Biomédico', '/activos/104?area=biomedico&espacio=biomedico'], 'botón para cambiar y volver al registro');
    ok(!r.texto.includes('Monitor de prueba') && !r.texto.includes('PAG-BIO'), 'sin datos del registro');
    ok(!r.doc.querySelector('.area-context'), 'sin las pestañas del área del otro espacio');
    const b = await ver(aviso, '/otro-espacio', 'jefeGeneral', { locals: { avisoEspacio: { espacio: 'biomedico', puedeCambiar: false, volver: '/activos/104' } } });
    es(b.status, 403, 'atado a General: 403');
    ok(!b.doc.querySelector('[data-cambiar-espacio]') && b.texto.includes('Este registro es del espacio Biomédico.'), 'sin botón');
    const g = await ver(aviso, '/otro-espacio', 'jefeBio', { locals: { avisoEspacio: { espacio: 'general', puedeCambiar: false, volver: '/ronda' } } });
    ok(g.status === 403 && g.texto.includes('Este registro es del espacio General.'), 'atado a Biomédico: el aviso de General');
    const directo = await respuesta(aviso, '/otro-espacio', 'admin');
    es([directo.status, directo.headers.get('location')], [302, '/'], 'sin aviso pendiente, al inicio');
  }

  // ── /campo del técnico: el mismo en los dos espacios, sin interruptor ni franja ──
  {
    const campo = await modulo('campo.astro.mjs');
    const a = await respuesta(campo, '/campo', 'tecnicoBio', { locals: { espacio: 'biomedico', espaciosPermitidos: ['biomedico'] } });
    const b = await respuesta(campo, '/campo', 'tecnicoBio');
    const ha = await a.text(), hb = await b.text();
    es([a.status, b.status], [200, 200], '/campo responde');
    ok(!ha.includes('espacioSwitch') && !ha.includes('franja-espacio') && !ha.includes('data-rotulo-espacio'), '/campo no trae el interruptor ni la franja');
    es(ha, hb, '/campo es el mismo con o sin espacio');
  }

  // ── 150 equipos por espacio: las páginas no pasan de 100 parámetros ni columnas ──
  const filas = [];
  for (let i = 0; i < 150; i++) for (const [base, rubro, tipo] of [[1000, 'aires', 'general'], [2000, 'biomedico', 'biomedico']]) filas.push(`(${base + i},'MASA-${base + i}','Masivo ${i}','${rubro}','${tipo}',1)`);
  sqlite.exec(`INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id) VALUES ${filas.join(',')};`);
  sqlite.exec(`INSERT INTO ordenes(creado_por,titulo,rubro,tipo,estado,activo_id,asignado_a) SELECT 1,'Masivo '||codigo,rubro,'preventivo','abierta',id,2 FROM activos WHERE codigo LIKE 'MASA-%';`);
  sqlite.exec(`INSERT INTO planes_mantenimiento(activo_id,titulo,frecuencia,proxima_fecha,asignado_a) SELECT id,'Masivo '||codigo,'mensual','2026-11-28',2 FROM activos WHERE codigo LIKE 'MASA-%';`);
  faults.enforceParameterLimit = true;
  faults.enforceColumnLimit = true;
  try {
    for (const [mod, ruta] of [['ordenes.astro.mjs', '/ordenes'], ['activos.astro.mjs', '/activos'], ['planes.astro.mjs', '/planes'], ['cronograma.astro.mjs', '/cronograma'], ['gantt.astro.mjs', '/gantt'], ['planificador.astro.mjs', '/planificador?m=2026-11'], ['mi-panel.astro.mjs', '/mi-panel'], ['index.astro.mjs', '/']]) {
      for (const cuenta of ['jefeGeneral', 'jefeBio']) {
        const r = await ver(await modulo(mod), ruta, cuenta);
        es(r.status, 200, `${ruta} con 150 equipos por espacio (${cuenta})`);
        ok(!r.texto.includes('too many SQL variables') && !r.texto.includes('more than 100 parameters') && !r.texto.includes('exceeds 100 columns'), `${ruta} (${cuenta}): sin errores de D1`);
      }
    }
    const lista = await ver(ordenesPag, '/ordenes', 'jefeBio');
    ok(lista.texto.includes('MASA-2000') || lista.texto.includes('Masivo MASA-2'), 'la lista del biomédico trae sus 150');
    ok(!lista.texto.includes('MASA-1000'), 'y ninguna de aires');
  } finally { faults.enforceParameterLimit = false; faults.enforceColumnLimit = false; }

  es(red, 0, 'sin red');
  console.log(`PASS test-espacios-paginas: ${checks} verificaciones; menú, color, rótulo e interruptor de cada espacio, listas y tableros solo con lo suyo, aviso del otro espacio, /campo sin cambios y 150 equipos por espacio. Páginas construidas, migraciones reales, sin red.`);
} finally { globalThis.fetch = fetchOriginal; await close(); }
