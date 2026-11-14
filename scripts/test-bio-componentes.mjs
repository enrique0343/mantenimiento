// Fase 59 · WP-D: los componentes de documentos, licencias y capacitaciones pintados de verdad,
// en la ficha y en la hoja de vida, y las páginas de alta de licencias y capacitaciones y la de
// una licencia (con Layout). Se compilan con @astrojs/compiler, se empaquetan con esbuild y se
// pintan con AstroContainer sobre las migraciones reales (setupConjuntos). Sin red ni base real.
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
      "export { default as LicenciaNueva } from './src/pages/licencias/nueva.astro';",
      "export { default as LicenciaVer } from './src/pages/licencias/[id].astro';",
      "export { default as CapacitacionNueva } from './src/pages/capacitaciones/nueva.astro';",
      "export { default as CapacitacionesLista } from './src/pages/capacitaciones/index.astro';",
    ].join('\n'),
    resolveDir: raiz, loader: 'ts',
  },
  // Layout importa globals.css: aquí no hace falta.
  outfile: salida, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [compilarAstro], loader: { '.css': 'empty' },
});
const C = await import(pathToFileURL(salida).href);
// El script de la sección de documentos, como lo carga el navegador, para correrlo en jsdom.
const scriptDocumentos = path.join(temporal, 'documentos-equipo.js');
await build({
  stdin: { contents: "import { instalarDocumentosEquipo } from './src/components/bio/documentos-equipo'; instalarDocumentosEquipo();", resolveDir: raiz, loader: 'ts' },
  outfile: scriptDocumentos, bundle: true, platform: 'browser', format: 'iife', logLevel: 'silent',
});
const { JSDOM } = createRequire(path.join(raiz, 'package.json'))('jsdom');
/** Pulsa «Quitar «No aplica»» en la ficha pintada y devuelve lo que pregunta el diálogo (sin confirmar). */
async function preguntaAlQuitar(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://test.invalid/activos/1', runScripts: 'outside-only' });
  const w = dom.window;
  const preguntas = [];
  w.confirmAction = async (titulo, mensaje) => { preguntas.push([titulo, mensaje]); return false; };
  w.fetch = async () => { throw new Error('No debía llamar al servidor.'); };
  w.eval(await fs.readFile(scriptDocumentos, 'utf8'));
  w.document.querySelector('[data-na-quitar]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  w.close();
  return preguntas;
}
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
/** Una página entera (con Layout) en `url`: estado, a dónde redirige y el HTML. */
const pagina = async (Pagina, url, { params = {}, rol = 'jefe' } = {}) => {
  const res = await container.renderToResponse(Pagina, {
    request: new Request(`https://test.invalid${url}`), params,
    locals: { user: { id: IDS[rol], nombre: `Prueba ${rol}`, rol }, runtime: { env: { DB: h.DB } } },
  });
  return { status: res.status, destino: res.headers.get('location'), html: await res.text() };
};
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

  // ── Ronda 2 · D1: el inventario marca «No requiere registro sanitario» ──
  const MOTIVO = 'No aplica: El inventario marca que el equipo no requiere registro sanitario.';
  sq.exec(`INSERT INTO activos (id, codigo, nombre, tipo, rubro, ubicacion_id, registro_sanitario_no_requiere) VALUES
    (102, 'BIO-102', 'NEGATOSCOPIO', 'biomedico', 'biomedico', 10, 1),
    (103, 'BIO-103', 'LÁMPARA DE FOTOTERAPIA', 'biomedico', 'biomedico', 10, 1)`);
  sq.exec("INSERT INTO activo_expediente_na (activo_id, requisito, motivo, usuario_id) VALUES (103, 'registro_sanitario', 'Marcado en el expediente', 2)");
  const editar102 = /<a href="\/activos\/102\/editar\?area=biomedico"[^>]*>Editar el equipo<\/a>/;
  const fichaSinReg = await pintar(C.Documentos, { activoId: 102 }, 'jefe');
  si(fichaSinReg.includes(MOTIVO) && fichaSinReg.includes('Expediente técnico: 1 de 5'), 'ficha: el registro sanitario sale «No aplica» con el motivo del inventario y cuenta');
  si(editar102.test(fichaSinReg), 'ficha del jefe: «Editar el equipo» a /activos/102/editar');
  no(fichaSinReg.includes('data-na-quitar') || fichaSinReg.includes('data-requisito="registro_sanitario"'), 'sin «Quitar «No aplica»» ni «No aplica» para ese requisito (no hay fila que quitar)');
  si(editar102.test(await pintar(C.Documentos, { activoId: 102 }, 'tecnico')), 'el técnico también puede editar el equipo: ve el enlace');
  const fichaSinRegVis = await pintar(C.Documentos, { activoId: 102 }, 'visualizador');
  si(fichaSinRegVis.includes(MOTIVO) && !fichaSinRegVis.includes('Editar el equipo'), 'el visualizador ve el motivo, sin el enlace');
  const hojaSinReg = await pintar(C.Documentos, { activoId: 102, variante: 'hoja', titulo: '6. Expediente técnico' });
  si(hojaSinReg.includes('Expediente técnico: 1 de 5 requisitos') && hojaSinReg.includes(`<td>${MOTIVO}</td>`) && !hojaSinReg.includes('Editar el equipo'),
    'hoja: cuenta como cumplido, con el motivo y sin enlace');
  const fichaAmbos = await pintar(C.Documentos, { activoId: 103 }, 'jefe');
  si(fichaAmbos.includes('No aplica: Marcado en el expediente') && fichaAmbos.includes('data-na-quitar'), 'con «No aplica» propio: su motivo y «Quitar «No aplica»»');
  si(fichaAmbos.includes('data-aviso="«Registro sanitario» seguirá como «No aplica»: el inventario marca que el equipo no requiere registro sanitario."'),
    'al quitarlo, avisa que el inventario lo deja en «No aplica»');
  no(fichaAmbos.includes('Editar el equipo'), 'sin «Editar el equipo» mientras haya un «No aplica» propio');
  no(fichaJefe.includes('data-aviso') || fichaJefe.includes('Editar el equipo'), 'un equipo que sí requiere registro no cambia');
  es(await preguntaAlQuitar(fichaAmbos),
    [['¿Quitar «No aplica»?', '«Registro sanitario» seguirá como «No aplica»: el inventario marca que el equipo no requiere registro sanitario.']],
    'script de la ficha: al quitarlo, el diálogo avisa que el inventario lo deja en «No aplica»');
  sq.exec("INSERT INTO activo_expediente_na (activo_id, requisito, motivo, usuario_id) VALUES (101, 'manual_operacion', 'El fabricante no lo entrega', 2)");
  es(await preguntaAlQuitar(await pintar(C.Documentos, { activoId: 101 }, 'jefe')),
    [['¿Quitar «No aplica»?', '«Manual de operación» vuelve a ser requerido en el expediente.']], 'los demás «No aplica» preguntan lo de siempre');

  // ── Ronda 2 · D2: un equipo dado de baja no recibe licencias ni capacitaciones nuevas ──
  sq.exec("INSERT INTO activos (id, codigo, nombre, tipo, rubro, ubicacion_id, estado) VALUES (104, 'BIO-104', 'ARCO EN C', 'biomedico', 'biomedico', 10, 'baja')");
  sq.exec(`INSERT INTO licencias (id, entidad, tipo, nombre, numero, ambito, activo_id, fecha_vencimiento, estado, creado_por)
    VALUES (2, 'srs', 'radiacion_equipo', 'Licencia del arco en C', 'RX-1', 'equipo', 104, '2027-06-30', 'activa', 1)`);
  sq.exec("INSERT INTO capacitaciones (id, fecha, tema, tipo, instructor_tipo, instructor_nombre, usuario_id) VALUES (2, '2026-02-10', 'Protección radiológica', 'uso_seguro', 'interno', 'Ing. Ruiz', 1)");
  sq.exec("INSERT INTO capacitacion_equipos (capacitacion_id, activo_id) VALUES (2, 104)");
  const licBaja = await pintar(C.Licencias, { activoId: 104 }, 'jefe');
  // Astro escribe «&» como &#38; en los atributos.
  si(licBaja.includes('Licencia del arco en C') && /\/licencias\?activo=104(&#38;|&amp;|&)situacion=todas/.test(licBaja), 'ficha de un equipo de baja: sus licencias y «Ver historial» siguen');
  no(licBaja.includes('/licencias/nueva'), 'sin «+ Registrar licencia»');
  si((await pintar(C.Licencias, { activoId: 100 }, 'jefe')).includes('/licencias/nueva?activo=100'), 'un equipo en servicio sí lo tiene');
  const capBaja = await pintar(C.Capacitaciones, { activoId: 104 }, 'tecnico');
  si(capBaja.includes('Protección radiológica') && /\/capacitaciones\?activo=104(&#38;|&amp;|&)desde=2000-01-01/.test(capBaja), 'sus capacitaciones y «Ver todas» siguen');
  no(capBaja.includes('/capacitaciones/nueva'), 'sin «+ Registrar capacitación»');
  si((await pintar(C.Capacitaciones, { activoId: 101 }, 'tecnico')).includes('/capacitaciones/nueva?activo=101'), 'un biomédico en servicio sí lo tiene');
  si((await pintar(C.Licencias, { activoId: 104, variante: 'hoja', titulo: '7. Licencias y permisos' })).includes('Licencia del arco en C'), 'la hoja de vida sigue mostrando su historial');

  // Páginas: alta de licencia y de capacitación, y la licencia de un equipo de baja.
  let p = await pagina(C.LicenciaNueva, '/licencias/nueva?activo=104');
  si(p.status === 200 && p.html.includes('El equipo BIO-104 — ARCO EN C está dado de baja: no se le registran licencias nuevas.'), 'nueva licencia con ?activo= de un equipo de baja: avisa');
  no(p.html.includes('value="BIO-104'), 'y no lo deja elegido ni lo ofrece');
  p = await pagina(C.LicenciaNueva, '/licencias/nueva?activo=100');
  si(!p.html.includes('data-aviso-baja') && /name="equipoTexto"[^>]*value="BIO-100 — MONITOR"/.test(p.html), 'con un equipo en servicio lo deja elegido, sin aviso');
  p = await pagina(C.LicenciaNueva, '/licencias/nueva?renueva=2');
  es([p.status, p.destino], [302, '/licencias/2'], 'renovar la licencia de un equipo de baja lleva a la licencia');
  p = await pagina(C.LicenciaVer, '/licencias/2', { params: { id: '2' } });
  si(p.status === 200 && p.html.includes('Equipo dado de baja: no se registran renovaciones.') && !p.html.includes('Registrar renovación'),
    'la licencia de un equipo de baja: sin «Registrar renovación» y dice por qué');
  si(p.html.includes('data-editar') && p.html.includes('data-anular'), 'pero se puede editar y anular');
  p = await pagina(C.LicenciaVer, '/licencias/1', { params: { id: '1' } });
  si(p.html.includes('Registrar renovación') && !p.html.includes('data-equipo-baja'), 'la de un equipo en servicio sí se renueva');
  p = await pagina(C.CapacitacionNueva, '/capacitaciones/nueva?activo=104', { rol: 'tecnico' });
  si(p.status === 200 && p.html.includes('El equipo BIO-104 — ARCO EN C está dado de baja: no se le registran capacitaciones nuevas.'), 'nueva capacitación con ?activo= de un equipo de baja: avisa');
  no(p.html.includes('data-codigo="BIO-104"'), 'y no lo ofrece');
  p = await pagina(C.CapacitacionNueva, '/capacitaciones/nueva?activo=101', { rol: 'tecnico' });
  si(!p.html.includes('data-aviso-baja') && /value="101" checked/.test(p.html), 'con un biomédico en servicio lo deja marcado, sin aviso');
  p = await pagina(C.CapacitacionesLista, '/capacitaciones?activo=104&desde=2000-01-01', { rol: 'tecnico' });
  si(p.html.includes('Protección radiológica') && p.html.includes('(dado de baja: no recibe capacitaciones nuevas)') && p.html.includes('href="/capacitaciones/nueva"'),
    'lista filtrada por un equipo de baja: lo dice y «+ Registrar capacitación» no lo deja marcado');
  p = await pagina(C.CapacitacionesLista, '/capacitaciones?activo=101&desde=2000-01-01', { rol: 'tecnico' });
  si(p.html.includes('href="/capacitaciones/nueva?activo=101"') && !p.html.includes('dado de baja: no recibe'), 'filtrada por un equipo en servicio: lo deja marcado');
} finally {
  await h.close();
  await fs.rm(temporal, { recursive: true, force: true });
}

console.log(`PASS test-bio-componentes: ${n} casos; ficha, hoja de vida y páginas de alta pintadas de verdad, roles, secciones que la hoja numera, «No aplica» del inventario y equipos de baja.`);
