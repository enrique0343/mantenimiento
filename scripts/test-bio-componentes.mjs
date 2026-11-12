// Fase 59 · WP-D: los componentes de documentos, licencias y capacitaciones pintados de verdad,
// en la ficha y en la hoja de vida. Se compilan con @astrojs/compiler, se empaquetan con esbuild y
// se pintan con AstroContainer sobre las migraciones reales (setupConjuntos). Sin red ni base real.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { transform } from '@astrojs/compiler';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// El runtime de Astro queda fuera del paquete y se carga del mismo lugar que AstroContainer.
const astroDir = path.dirname(createRequire(path.join(raiz, 'package.json')).resolve('astro/package.json'));
const { experimental_AstroContainer } = await import(pathToFileURL(path.join(astroDir, 'dist/container/index.js')).href);
const compilarAstro = { name: 'componentes-astro', setup(b) {
  b.onResolve({ filter: /^astro\/compiler-runtime$/ }, () => ({ path: path.join(astroDir, 'dist/runtime/compiler/index.js'), external: true }));
  b.onResolve({ filter: /^astro\/runtime\// }, (a) => ({ path: path.join(astroDir, 'dist/runtime', a.path.slice('astro/runtime/'.length)), external: true }));
  b.onLoad({ filter: /\.astro$/ }, async (a) => {
    // Con resolvePath (como lo llama Astro) el compilador no pide $$createMetadata.
    const r = await transform(await fs.readFile(a.path, 'utf8'), {
      filename: a.path, internalURL: 'astro/compiler-runtime', renderScript: true, resultScopedSlot: true, resolvePath: async (s) => s,
    });
    assert.equal(r.diagnostics.filter((d) => d.severity === 1).length, 0, JSON.stringify(r.diagnostics));
    return { contents: r.code, loader: 'ts', resolveDir: path.dirname(a.path) };
  });
} };

const temporal = await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-bio-componentes-'));
const salida = path.join(temporal, 'componentes.mjs');
await build({
  stdin: {
    contents: [
      "export { default as Documentos } from './src/components/bio/DocumentosEquipo.astro';",
      "export { default as Licencias } from './src/components/bio/LicenciasEquipo.astro';",
      "export { default as Capacitaciones } from './src/components/bio/CapacitacionesEquipo.astro';",
      "export { partirTitulo } from './src/components/bio/hoja';",
    ].join('\n'),
    resolveDir: raiz, loader: 'ts',
  },
  outfile: salida, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [compilarAstro],
});
const C = await import(pathToFileURL(salida).href);
const h = await setupConjuntos({});

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const si = (cond, nota) => es(!!cond, true, nota);
const no = (cond, nota) => es(!!cond, false, nota);

// ── partirTitulo ─────────────────────────────────────────────────────────────
es(C.partirTitulo('6. Expediente técnico', 'X'), { numero: '6.', texto: 'Expediente técnico' }, 'título con número');
es(C.partirTitulo('  12.  Licencias   y permisos ', 'X'), { numero: '12.', texto: 'Licencias y permisos' }, 'espacios de más');
es(C.partirTitulo('Expediente técnico', 'X'), { numero: '', texto: 'Expediente técnico' }, 'sin número');
es(C.partirTitulo(undefined, 'Documentos del equipo'), { numero: '', texto: 'Documentos del equipo' }, 'sin título: el de siempre');
es(C.partirTitulo('2026 Plan', 'X'), { numero: '', texto: '2026 Plan' }, 'un año no es número de sección');

const container = await experimental_AstroContainer.create();
const IDS = { admin: 1, jefe: 2, tecnico: 3, visualizador: 4, solicitante: 5, motorista: 6 };
const pintar = (Comp, props, rol = 'admin') => container.renderToString(Comp, {
  props, locals: { user: { id: IDS[rol], nombre: `Prueba ${rol}`, rol }, runtime: { env: { DB: h.DB } } },
});
const seccion = (html, id) => new RegExp(`<section id="${id}"`).test(html);

try {
  const sq = h.sqlite;
  sq.exec("INSERT INTO sucursales (id, nombre) VALUES (1, 'Central')");
  sq.exec("INSERT INTO ubicaciones (id, sucursal_id, nombre, tipo) VALUES (10, 1, 'UCI adultos', 'area')");
  sq.exec(`INSERT INTO activos (id, codigo, nombre, tipo, rubro, ubicacion_id) VALUES
    (100, 'BIO-100', 'MONITOR', 'biomedico', 'biomedico', 10),
    (101, 'BIO-101', 'VENTILADOR', 'biomedico', 'biomedico', 10),
    (200, 'EQ-200', 'BOMBA DE AGUA', 'general', 'equipo_general', 10)`);
  sq.exec(`INSERT INTO activo_documentos (activo_id, nombre, content_type, tamano, r2_key, categoria, usuario_id, fecha_vencimiento) VALUES
    (100, 'Registro sanitario.pdf', 'application/pdf', 2048, 'activos/100/docs/rs.pdf', 'registro_sanitario', 1, '2026-01-01'),
    (100, 'Manual de operación.pdf', 'application/pdf', 4096, 'activos/100/docs/mo.pdf', 'manual_operacion', 1, NULL)`);
  // Un equipo que pasó a «Equipos generales» después de su capacitación.
  sq.exec("INSERT INTO capacitaciones (id, fecha, tema, tipo, instructor_tipo, instructor_nombre, usuario_id) VALUES (1, '2026-01-10', 'Uso seguro de la bomba', 'uso_seguro', 'interno', 'Ing. Ruiz', 1)");
  sq.exec("INSERT INTO capacitacion_equipos (capacitacion_id, activo_id) VALUES (1, 200)");

  // ── Hoja de vida: clases del documento controlado, número en <span>, sin botones ni scripts ──
  const hojaDoc = await pintar(C.Documentos, { activoId: 100, variante: 'hoja', titulo: '6. Expediente técnico' });
  si(/<section id="documentos" class="doc-seccion">/.test(hojaDoc), 'hoja: sección de documentos con doc-seccion');
  si(hojaDoc.includes('<h2 class="doc-h"><span>6.</span> Expediente técnico</h2>'), 'hoja: título con el número en <span>');
  si(hojaDoc.includes('class="doc-tabla"') && hojaDoc.includes('Expediente técnico: 1 de 5 requisitos'), 'hoja: checklist y tabla del expediente');
  si(hojaDoc.includes('Vencido el 01/01/2026'), 'hoja: el registro sanitario vencido');
  no(/<button|<form|<script|text-base font-bold/.test(hojaDoc), 'hoja: sin botones, formularios, scripts ni el estilo viejo');

  const hojaLicVacia = await pintar(C.Licencias, { activoId: 200, variante: 'hoja', titulo: '7. Licencias y permisos' });
  si(seccion(hojaLicVacia, 'licencias') && hojaLicVacia.includes('<p class="doc-nota">Sin licencias registradas.</p>'),
    'hoja: la sección de licencias sale aunque el equipo no sea biomédico ni tenga licencias');
  const hojaCapOtraArea = await pintar(C.Capacitaciones, { activoId: 200, variante: 'hoja', titulo: '8. Capacitaciones al personal' });
  si(seccion(hojaCapOtraArea, 'capacitaciones') && hojaCapOtraArea.includes('CAP-0001') && hojaCapOtraArea.includes('<span>8.</span> Capacitaciones al personal'),
    'hoja: un equipo de otra área con capacitaciones las muestra (la hoja numera la sección)');
  const hojaCapVacia = await pintar(C.Capacitaciones, { activoId: 101, variante: 'hoja', titulo: '8. Capacitaciones al personal' });
  si(hojaCapVacia.includes('<p class="doc-nota">Sin capacitaciones registradas.</p>'), 'hoja: biomédico sin capacitaciones');
  const hojaDocVacia = await pintar(C.Documentos, { activoId: 200, variante: 'hoja', titulo: '5. Expediente técnico' });
  si(hojaDocVacia.includes('<p class="doc-nota">Sin documentos cargados.</p>') && !hojaDocVacia.includes('requisitos'),
    'hoja: equipo de otra área sin documentos (sin checklist del expediente)');
  for (const [nombre, Comp] of [['documentos', C.Documentos], ['licencias', C.Licencias], ['capacitaciones', C.Capacitaciones]]) {
    es((await pintar(Comp, { activoId: 100, variante: 'hoja', titulo: '9. X' }, 'motorista')).trim(), '', `hoja: el motorista no ve ${nombre}`);
    es((await pintar(Comp, { activoId: 999, variante: 'hoja', titulo: '9. X' })).trim(), '', `hoja: equipo inexistente sin ${nombre}`);
  }

  // ── Ficha: botones según el rol ──
  const fichaJefe = await pintar(C.Documentos, { activoId: 100 }, 'jefe');
  si(/<section id="documentos" class="card/.test(fichaJefe), 'ficha: sección #documentos');
  si(fichaJefe.includes('data-doc-abrir') && fichaJefe.includes('data-na-abrir') && fichaJefe.includes('data-doc-eliminar') && fichaJefe.includes('<script'),
    'ficha del jefe: subir, «No aplica», eliminar y su script');
  const fichaTecnico = await pintar(C.Documentos, { activoId: 100 }, 'tecnico');
  si(fichaTecnico.includes('data-doc-abrir') && fichaTecnico.includes('data-doc-editar'), 'ficha del técnico: sube y corrige datos');
  no(fichaTecnico.includes('data-na-abrir') || fichaTecnico.includes('data-doc-eliminar') || fichaTecnico.includes('data-na-form'),
    'ficha del técnico: sin «No aplica» ni eliminar');
  const fichaVisual = await pintar(C.Documentos, { activoId: 100 }, 'visualizador');
  si(fichaVisual.includes('/api/activos/documento/'), 'ficha del visualizador: enlaces de descarga');
  no(/<button|<form|<script/.test(fichaVisual), 'ficha del visualizador: sin botones, formularios ni script');
  es((await pintar(C.Documentos, { activoId: 100 }, 'solicitante')).trim(), '', 'ficha: el solicitante no ve documentos');

  es((await pintar(C.Capacitaciones, { activoId: 200 })).trim(), '', 'ficha: capacitaciones solo en biomédicos');
  si(seccion(await pintar(C.Capacitaciones, { activoId: 101 }, 'tecnico'), 'capacitaciones'), 'ficha: biomédico sin capacitaciones también la muestra');
  es((await pintar(C.Licencias, { activoId: 200 })).trim(), '', 'ficha: otra área sin licencias no muestra la sección');
  sq.exec(`INSERT INTO licencias (id, entidad, tipo, nombre, numero, ambito, activo_id, fecha_vencimiento, estado, creado_por)
    VALUES (1, 'srs', 'funcionamiento', 'Permiso de la bomba', 'P-1', 'equipo', 200, '2025-01-01', 'activa', 1)`);
  const fichaLic = await pintar(C.Licencias, { activoId: 200 }, 'jefe');
  si(seccion(fichaLic, 'licencias') && fichaLic.includes('Permiso de la bomba') && fichaLic.includes('/licencias/nueva?activo=200'),
    'ficha: otra área con licencias las muestra; el jefe registra');
  no((await pintar(C.Licencias, { activoId: 200 }, 'tecnico')).includes('/licencias/nueva'), 'ficha: el técnico no registra licencias');
  const hojaLic = await pintar(C.Licencias, { activoId: 200, variante: 'hoja', titulo: '7. Licencias y permisos' });
  si(hojaLic.includes('LIC-0001') && hojaLic.includes('<td class="doc-critico">'), 'hoja: la licencia vencida en rojo');
} finally {
  await h.close();
  await fs.rm(temporal, { recursive: true, force: true });
}

console.log(`PASS test-bio-componentes: ${n} casos; ficha y hoja de vida pintadas de verdad, roles y secciones que la hoja numera.`);
