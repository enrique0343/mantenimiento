// Fase 59 · WP-G (ronda 2): el «Reporte de mantenimiento» impreso de la orden.
// Requisito 12: si la orden está en orden_incidentes, bajo el encabezado sale
// «Relacionada con un incidente · reporte de Calidad {N.º o pendiente} · aviso DD/MM/AAAA».
// Requisito 7: si la orden tiene prerrequisitos, una tabla de solo lectura con tipo,
// descripción, referencia, quién lo cumplió y cuándo (hora de El Salvador).
// Reglas puras, reporteDeOrden sobre SQLite con todas las migraciones y la página real
// pintada con AstroContainer (compilada con @astrojs/compiler y empaquetada con esbuild;
// no hace falta astro build). Sin red.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { transform } from '@astrojs/compiler';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// El runtime de Astro queda fuera del paquete y se carga del mismo lugar que AstroContainer.
const astroDir = path.dirname(createRequire(path.join(raiz, 'package.json')).resolve('astro/package.json'));
const { experimental_AstroContainer } = await import(pathToFileURL(path.join(astroDir, 'dist/container/index.js')).href);
const compilarAstro = { name: 'paginas-astro', setup(b) {
  b.onResolve({ filter: /^astro\/compiler-runtime$/ }, () => ({ path: path.join(astroDir, 'dist/runtime/compiler/index.js'), external: true }));
  b.onResolve({ filter: /^astro\/runtime\// }, (a) => ({ path: path.join(astroDir, 'dist/runtime', a.path.slice('astro/runtime/'.length)), external: true }));
  b.onLoad({ filter: /\.astro$/ }, async (a) => {
    const r = await transform(await fs.readFile(a.path, 'utf8'), {
      filename: a.path, internalURL: 'astro/compiler-runtime', renderScript: true, resultScopedSlot: true, resolvePath: async (s) => s,
    });
    assert.equal(r.diagnostics.filter((d) => d.severity === 1).length, 0, JSON.stringify(r.diagnostics));
    return { contents: r.code, loader: 'ts', resolveDir: path.dirname(a.path) };
  });
} };

const temporal = await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-bio-reporte-'));
const salida = path.join(temporal, 'reporte.mjs');
await build({
  stdin: {
    contents: [
      "export { default as Reporte } from './src/pages/ordenes/[id]/reporte.astro';",
      "export * as R from './src/lib/reporte-mantenimiento';",
      "export { getDb } from './src/lib/db';",
    ].join('\n'),
    resolveDir: raiz, loader: 'ts',
  },
  outfile: salida, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  loader: { '.css': 'empty' }, plugins: [compilarAstro],
});
const M = await import(pathToFileURL(salida).href);
const { R } = M;

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };

// ═══ Reglas puras ════════════════════════════════════════════════════════════
es(R.lineaIncidente({ numeroReporte: 'RC-2026-0148', fechaNotificacion: '2026-11-10' }),
  'Relacionada con un incidente · reporte de Calidad RC-2026-0148 · aviso 10/11/2026', 'con número de reporte');
es(R.lineaIncidente({ numeroReporte: null, fechaNotificacion: '2026-11-10' }),
  'Relacionada con un incidente · reporte de Calidad pendiente · aviso 10/11/2026', 'sin número: «pendiente»');
es([R.lineaIncidente(null), R.lineaIncidente(undefined)], [null, null], 'sin marca no hay línea');

const fila = { tipo: 'instrumento', texto: 'Analizador calibrado', obligatorio: true, cumplido: true, referencia: '  Fluke ESA615 S/N 4471023 · vigente hasta 31/01/2027 ', cumplidoPor: 'Prueba tecnico', cumplidoEn: '2026-11-12T15:30:00.000Z' };
es(R.filasPrerrequisitos([fila]), [{
  tipo: 'Instrumento calibrado', texto: 'Analizador calibrado', opcional: false,
  referencia: 'Fluke ESA615 S/N 4471023 · vigente hasta 31/01/2027', cumplio: 'Prueba tecnico', cuando: '12/11/2026 09:30',
}], 'cumplido: referencia, quién y cuándo en hora de El Salvador');
es(R.filasPrerrequisitos([{ ...fila, cumplidoEn: '2026-11-12 14:05:00' }])[0].cuando, '12/11/2026 08:05', 'marca de SQLite (UTC) a la hora de El Salvador');
es(R.filasPrerrequisitos([{ ...fila, tipo: 'notificacion', obligatorio: false, cumplido: false, referencia: '   ', cumplidoPor: null, cumplidoEn: null }])[0],
  { tipo: 'Notificación a servicios', texto: 'Analizador calibrado', opcional: true, referencia: '—', cumplio: 'Pendiente', cuando: '—' }, 'pendiente y opcional');
es(R.filasPrerrequisitos([{ ...fila, cumplido: false, cumplidoPor: 'Prueba tecnico', cumplidoEn: '2026-11-12T15:30:00.000Z' }])[0].cumplio, 'Pendiente',
  'revertido a pendiente: no dice quién lo cumplió');
es(R.filasPrerrequisitos([{ ...fila, cumplidoPor: null, cumplidoEn: null }])[0], { ...R.filasPrerrequisitos([fila])[0], cumplio: 'Cumplido', cuando: '—' },
  'cargado como cumplido sin quién ni cuándo');
es(['constructor', 'xyz', null].map((tipo) => R.filasPrerrequisitos([{ ...fila, tipo }])[0].tipo), ['Otro', 'Otro', 'Otro'], 'tipo desconocido: «Otro»');
es(R.filasPrerrequisitos([]), [], 'sin prerrequisitos');

// ═══ reporteDeOrden y la página, sobre las migraciones reales ════════════════
const h = await setupConjuntos({});
const { sqlite, faults } = h;
const IDS = { admin: 1, jefe: 2, tecnico: 3, visualizador: 4, solicitante: 5, motorista: 6 };
const LINEA = 'Relacionada con un incidente · reporte de Calidad RC-2026-0148 · aviso 10/11/2026';
const REF_INSTRUMENTO = 'Fluke ESA615 S/N 4471023 · calibración vigente hasta 31/01/2027';

try {
  sqlite.exec(`
    INSERT INTO sucursales (id, nombre) VALUES (1, 'Central');
    INSERT INTO ubicaciones (id, sucursal_id, nombre, tipo) VALUES (10, 1, 'UCI adultos', 'area');
    INSERT INTO activos (id, codigo, nombre, tipo, rubro, ubicacion_id, marca, modelo, serial)
      VALUES (100, 'BIO-100', 'MONITOR DE SIGNOS VITALES', 'biomedico', 'biomedico', 10, 'Mindray', 'uMEC10', 'SN-100');
  `);
  const orden = (id, campos) => {
    const base = { rubro: 'biomedico', creado_por: 1, titulo: `Orden ${id}`, prioridad: 'alta', activo_id: 100, asignado_a: 3, ...campos };
    const k = Object.keys(base);
    sqlite.prepare(`INSERT INTO ordenes(id,${k.join(',')}) VALUES(?,${k.map(() => '?').join(',')})`).run(id, ...k.map((c) => base[c]));
  };
  const PASOS = JSON.stringify([{ texto: 'Medir la corriente de fuga', estado: 'ok', minutos: 10 }]);
  // 501: intervención marcada como incidente, con prerrequisitos y un paso.
  orden(501, { tipo: 'intervencion', estado: 'completada', iniciada_en: '2026-11-12T16:00:00.000Z', completada_en: '2026-11-12T18:00:00.000Z',
    trabajos_realizados: 'Se cambió la tarjeta de potencia y se midió la fuga.', checklist_ejecucion: PASOS });
  sqlite.exec(`INSERT INTO orden_incidentes (orden_id, numero_reporte, fecha_notificacion, nota, marcado_por, marcado_en)
    VALUES (501, 'RC-2026-0148', '2026-11-10', 'Equipo retirado de uso', 2, '2026-11-10 20:15:00')`);
  const prerreq = sqlite.prepare('INSERT INTO orden_prerrequisitos (orden_id, texto, tipo, obligatorio, cumplido, cumplido_por, cumplido_en, referencia, orden) VALUES (?,?,?,?,?,?,?,?,?)');
  // Se insertan fuera de orden: el reporte sigue el orden de la ficha (orden, id).
  prerreq.run(501, 'Analizador de seguridad eléctrica calibrado', 'instrumento', 1, 1, 3, '2026-11-12T15:30:00.000Z', REF_INSTRUMENTO, 1);
  prerreq.run(501, 'Aviso a Enfermería de la UCI', 'notificacion', 0, 0, null, null, null, 2);
  prerreq.run(501, 'Permiso de trabajo emitido en el punto', 'permiso_trabajo', 1, 1, 2, '2026-11-12 14:05:00', 'PT-0099 · emitió Ing. Ruiz', 0);
  // 502: correctivo sin marca ni prerrequisitos. 503: marcado sin número de reporte.
  orden(502, { tipo: 'correctivo', estado: 'completada', iniciada_en: '2026-11-12T16:00:00.000Z', completada_en: '2026-11-12T17:00:00.000Z', trabajos_realizados: 'Se cambió el cable de poder.' });
  orden(503, { tipo: 'correctivo', estado: 'completada', iniciada_en: '2026-11-12T16:00:00.000Z', completada_en: '2026-11-12T17:00:00.000Z', trabajos_realizados: 'Se cambió el sensor.' });
  sqlite.exec("INSERT INTO orden_incidentes (orden_id, fecha_notificacion, marcado_por) VALUES (503, '2026-11-11', 1)");
  // 504: un prerrequisito cargado a mano como cumplido, sin quién ni cuándo.
  orden(504, { tipo: 'correctivo', estado: 'abierta' });
  prerreq.run(504, 'Respaldo disponible en la UCI', 'reserva', 1, 1, null, null, 'Monitor de transporte BIO-220', 0);

  const PRERREQ_501 = [
    { tipo: 'Permiso de trabajo', texto: 'Permiso de trabajo emitido en el punto', opcional: false, referencia: 'PT-0099 · emitió Ing. Ruiz', cumplio: 'Prueba jefe', cuando: '12/11/2026 08:05' },
    { tipo: 'Instrumento calibrado', texto: 'Analizador de seguridad eléctrica calibrado', opcional: false, referencia: REF_INSTRUMENTO, cumplio: 'Prueba tecnico', cuando: '12/11/2026 09:30' },
    { tipo: 'Notificación a servicios', texto: 'Aviso a Enfermería de la UCI', opcional: true, referencia: '—', cumplio: 'Pendiente', cuando: '—' },
  ];

  // ── reporteDeOrden: una lectura para la marca y otra para los prerrequisitos ──
  faults.enforceColumnLimit = true;
  const db = M.getDb({ locals: { runtime: { env: { DB: h.DB } } } });
  const desde = h.queries.length;
  const r501 = await R.reporteDeOrden(db, 501);
  const consultas = h.queries.slice(desde);
  es(consultas.filter((q) => /"orden_incidentes"/.test(q.sql)).length, 1, 'una sola consulta de lectura para la marca de incidente');
  es(consultas.filter((q) => /"orden_prerrequisitos"/.test(q.sql)).length, 1, 'una sola consulta para los prerrequisitos');
  es(consultas.every((q) => q.columns.length <= 100), true, `ninguna consulta pasa de 100 columnas (máximo ${Math.max(...consultas.map((q) => q.columns.length))})`);
  es([r501.incidente, r501.lineaIncidente], [{ numeroReporte: 'RC-2026-0148', fechaNotificacion: '2026-11-10' }, LINEA], 'la marca y su línea');
  es(r501.prerrequisitos, PRERREQ_501, 'prerrequisitos en el orden de la ficha, con referencia, quién y cuándo');
  const r502 = await R.reporteDeOrden(db, 502);
  es([r502.incidente, r502.lineaIncidente, r502.prerrequisitos], [null, null, []], 'sin marca ni prerrequisitos');
  es((await R.reporteDeOrden(db, 503)).lineaIncidente, 'Relacionada con un incidente · reporte de Calidad pendiente · aviso 11/11/2026', 'marca sin número de reporte');
  es((await R.reporteDeOrden(db, 504)).prerrequisitos.map((p) => [p.cumplio, p.cuando]), [['Cumplido', '—']], 'cumplido sin quién ni cuándo');
  es(await R.reporteDeOrden(db, 99999), null, 'orden inexistente');
  // La marca y los prerrequisitos se leen; el reporte no escribe nada.
  es(consultas.every((q) => /^select\b/i.test(q.sql.trim())), true, 'solo lectura');

  // ── La página pintada ────────────────────────────────────────────────────
  const container = await experimental_AstroContainer.create();
  const pintar = (id, rol) => container.renderToResponse(M.Reporte, {
    partial: false, request: new Request(`https://local.test/ordenes/${id}/reporte`), params: { id: String(id) },
    locals: { user: { id: IDS[rol], nombre: `Prueba ${rol}`, rol }, runtime: { env: { DB: h.DB } } },
  });
  const hoja = async (id, rol) => {
    const res = await pintar(id, rol);
    assert.equal(res.status, 200, `/ordenes/${id}/reporte como ${rol}`);
    const doc = new JSDOM(await res.text()).window.document;
    const article = doc.querySelector('article.print-doc');
    const tabla = article.querySelector('#reportePrerrequisitos table');
    return {
      article,
      secciones: [...article.querySelectorAll('h2.doc-h')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
      incidente: article.querySelector('#reporteIncidente'),
      // Lo que sigue al encabezado del documento.
      trasCabecera: article.querySelector('header.doc-cab')?.nextElementSibling ?? null,
      columnas: tabla ? [...tabla.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : null,
      filas: tabla ? [...tabla.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((td) => {
        const nota = td.querySelector('.doc-nota-celda');
        const texto = [...td.childNodes].filter((c) => c !== nota).map((c) => c.textContent).join('').trim();
        return nota ? `${texto} (${nota.textContent.trim()})` : texto;
      })) : null,
      formularios: article.querySelectorAll('form, input, textarea, select, button').length,
    };
  };

  for (const rol of ['admin', 'jefe', 'tecnico', 'visualizador']) {
    const x = await hoja(501, rol);
    es([x.trasCabecera?.id, x.incidente?.textContent.trim()], ['reporteIncidente', LINEA], `${rol}: la línea del incidente va bajo el encabezado`);
    es(x.columnas, ['Tipo', 'Descripción', 'Referencia', 'Cumplió', 'Cuándo'], `${rol}: columnas de los prerrequisitos`);
    es(x.filas, [
      ['Permiso de trabajo', 'Permiso de trabajo emitido en el punto', 'PT-0099 · emitió Ing. Ruiz', 'Prueba jefe', '12/11/2026 08:05'],
      ['Instrumento calibrado', 'Analizador de seguridad eléctrica calibrado', REF_INSTRUMENTO, 'Prueba tecnico', '12/11/2026 09:30'],
      ['Notificación a servicios (Opcional)', 'Aviso a Enfermería de la UCI', '—', 'Pendiente', '—'],
    ], `${rol}: cada prerrequisito con su referencia, quién y cuándo`);
    es(x.formularios, 0, `${rol}: el reporte es de solo lectura`);
    es(x.secciones, rol === 'tecnico'
      ? ['1. Prerrequisitos', '2. Pasos', '3. Trabajos realizados']
      : ['1. Tiempos', '2. Prerrequisitos', '3. Pasos', '4. Trabajos realizados'], `${rol}: secciones numeradas sin huecos`);
  }
  for (const rol of ['jefe', 'tecnico']) {
    const x = await hoja(502, rol);
    es([x.incidente, x.columnas, x.trasCabecera?.tagName], [null, null, 'SECTION'], `${rol}: sin marca ni prerrequisitos, el reporte sigue como antes`);
    es(x.secciones, rol === 'tecnico' ? ['1. Trabajos realizados'] : ['1. Tiempos', '2. Trabajos realizados'], `${rol}: numeración de siempre`);
  }
  const x503 = await hoja(503, 'visualizador');
  es([x503.incidente?.textContent.trim(), x503.columnas], ['Relacionada con un incidente · reporte de Calidad pendiente · aviso 11/11/2026', null], 'marca sin número: «pendiente»');
  es((await hoja(504, 'jefe')).filas, [['Reserva / respaldo disponible', 'Respaldo disponible en la UCI', 'Monitor de transporte BIO-220', 'Cumplido', '—']], 'cumplido sin quién ni cuándo');
  for (const rol of ['solicitante', 'motorista']) es((await pintar(501, rol)).status, 302, `${rol} no abre el reporte`);
  es(h.queries.slice(desde).every((q) => q.columns.length <= 100), true, 'la página tampoco pasa de 100 columnas');
} finally {
  faults.enforceColumnLimit = false;
  await h.close();
  await fs.rm(temporal, { recursive: true, force: true });
}

console.log(`PASS test-bio-reporte-orden: ${n} casos`);
