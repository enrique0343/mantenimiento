// Fase 59 · ronda 2 (WP-F): el editor de plantillas de checklist (/configuracion/plantillas)
// en el navegador. Reglas puras de src/lib/plantillas-checklist-editor.ts y el <script> real
// de la página, empaquetado con esbuild y corrido en jsdom (sin build) contra una API de
// mentira que guarda en memoria. Cubre: la plantilla sugerida se crea una sola vez, lo que
// se manda al guardar (solo lo que cambió, cada campo explícito), los errores por paso, el
// j.error de la API, la falta de red, el doble envío, activar o desactivar y los pasos ligados.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const si = (r, nota) => { n++; assert.equal(r, true, nota); };

// ── Reglas puras ────────────────────────────────────────────────────────────
const lib = await build({ entryPoints: [path.join(raiz, 'src/lib/plantillas-checklist-editor.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
const E = await import(`data:text/javascript;base64,${Buffer.from(lib.outputFiles[0].text).toString('base64')}`);

const S = E.PLANTILLA_SUGERIDA;
es(S.nombre, 'Preventivo biomédico general', 'nombre de la plantilla sugerida');
es(S.items.map((p) => p.texto), [
  'Inspección física del equipo, cables y accesorios',
  'Limpieza y desinfección según el protocolo del fabricante y el de Control de Infecciones',
  'Prueba de alarmas audibles y visuales',
  'Prueba funcional según el manual del fabricante',
  'Seguridad eléctrica (IEC 62353) cuando aplique',
], 'los cinco pasos de partida, en orden (requisitos 17 y 18: alarmas, limpieza y desinfección)');
es(S.items.map((p) => p.bloqueante), [true, true, false, true, false], 'críticos: inspección, limpieza y funcional; alarmas y seguridad eléctrica admiten «No aplica»');
si(S.items.every((p) => p.criterioAceptacion.length > 10), 'cada paso trae su criterio de aceptación');
si(/punto de partida/i.test(S.descripcion), 'la descripción dice que es un punto de partida');
const envio = E.envioSugerida();
es(Object.keys(envio.items[0]).sort(), ['bloqueante', 'criterioAceptacion', 'materiales', 'minutosEstimados', 'requiereValor', 'texto', 'unidad', 'valorEsperadoMax', 'valorEsperadoMin'],
  'el envío de la sugerida lleva cada campo explícito (nada se hereda de otro paso)');
si(envio.items.every((p) => p.requiereValor === false && p.unidad === null && p.minutosEstimados === null), 'sin lecturas ni tiempos inventados');
si(E.esSugerida('  preventivo   biomedico GENERAL ') && !E.esSugerida('Preventivo biomédico'), 'la sugerida se reconoce sin tildes ni mayúsculas');

const vacio = E.pasoVacio();
const paso = (o) => ({ ...vacio, texto: 'Medir', ...o });
const leer = (pasos) => E.leerPasos(pasos);
es(leer([paso({ criterio: '  Bien  ', minutos: '10', materiales: ' ', critico: true })]).items[0],
  { texto: 'Medir', criterioAceptacion: 'Bien', bloqueante: true, minutosEstimados: 10, materiales: null, requiereValor: false, unidad: null, valorEsperadoMin: null, valorEsperadoMax: null },
  'un paso sin lectura: unidad y rango en null');
es(leer([paso({ pideLectura: true, unidad: ' °C ', minimo: '8', maximo: '14,5' })]).items[0].valorEsperadoMax, 14.5, 'coma decimal');
es(leer([paso({ pideLectura: false, unidad: 'V', minimo: 'x', maximo: '1' })]), { items: [{ ...leer([paso({})]).items[0] }], errores: [] }, 'sin «Pide lectura» no se revisan ni se mandan la unidad y el rango');
es(leer([paso({ texto: '  ' })]).errores, [{ indice: 0, campo: 'texto', mensaje: 'Escribe qué se hace en este paso.' }], 'paso sin texto');
es(leer([paso({ texto: 'A', minutos: '1.5' }), paso({ texto: 'B', minutos: '0' }), paso({ texto: 'C', minutos: 'diez' })]).errores.map((e) => [e.indice, e.campo]), [[0, 'minutos'], [1, 'minutos'], [2, 'minutos']], 'minutos: enteros mayores que cero');
es(leer([paso({ pideLectura: true, unidad: 'microamperios' })]).errores[0].mensaje, 'La unidad tiene como máximo 12 letras.', 'unidad larga');
es(leer([paso({ pideLectura: true, minimo: 'abc' })]).errores[0].mensaje, 'Mínimo: Escribe solo el número, por ejemplo 0.3.', 'mínimo que no es número');
es(leer([paso({ pideLectura: true, maximo: '1,200' })]).errores[0].mensaje, 'Máximo: ¿1200 o 1,2? Escribe el número sin separador de miles.', 'número ambiguo');
es(leer([paso({ pideLectura: true, minimo: '5', maximo: '1' })]).errores, [{ indice: 0, campo: 'maximo', mensaje: 'El mínimo no puede ser mayor que el máximo.' }], 'rango al revés');
es(leer([paso({ pideLectura: true, minimo: '-10', maximo: '-2' })]).errores, [], 'temperaturas bajo cero');
es(leer([paso({ texto: 'Medir voltaje' }), paso({ texto: 'Revisar bornes' }), paso({ texto: ' medir  VOLTAJE ' })]).errores,
  [{ indice: 2, campo: 'texto', mensaje: 'Ya hay un paso 1 con este texto: escribe uno distinto (por ejemplo, «Medir voltaje L1» y «Medir voltaje L2»).' }],
  'dos pasos con el mismo texto: la rutina de la ficha los confundiría');

const guardado = { texto: 'Medir tierra', criterioAceptacion: '≤ 0.3 Ω', bloqueante: 0, minutosEstimados: 10, materiales: null, requiereValor: 1, unidad: 'Ω', valorEsperadoMin: null, valorEsperadoMax: 12.345 };
es(E.pasoEditorDesdeApi(guardado), { texto: 'Medir tierra', criterio: '≤ 0.3 Ω', critico: false, minutos: '10', materiales: '', pideLectura: true, unidad: 'Ω', minimo: '', maximo: '12.3450' },
  'un paso guardado en los campos (12.345 se escribe 12.3450 para no leerse como miles)');
es(E.pasosEnvioDesdeApi([guardado])[0].valorEsperadoMax, 12.345, 'ida y vuelta sin cambiar el número');
si(E.mismosPasos(E.pasosEnvioDesdeApi([guardado]), E.leerPasos([E.pasoEditorDesdeApi(guardado)]).items), 'sin tocar nada no hay cambios');

const lista = [{ id: 1, nombre: 'Seguridad eléctrica IEC 62353' }, { id: 2, nombre: 'Preventivo biomédico general' }];
es(E.errorNombre('  ', lista), 'Escribe el nombre de la plantilla.', 'nombre vacío');
es(E.errorNombre('seguridad electrica iec 62353', lista), 'Ya existe una plantilla llamada «Seguridad eléctrica IEC 62353». Usa otro nombre o abre esa plantilla.', 'nombre repetido sin tildes ni mayúsculas');
es(E.errorNombre('Seguridad Eléctrica IEC 62353', lista, 1), null, 'corregir mayúsculas del propio nombre');
es(E.resumenPasos([{ texto: 'a', requiereValor: true, bloqueante: true }, { texto: 'b', requiereValor: 0, bloqueante: 1 }]), { pasos: 2, conLectura: 1, criticos: 2 }, 'resumen de la lista');
es([E.mensajeDeRespuesta(401, { error: 'No autenticado' }), E.mensajeDeRespuesta(409, { error: 'Ya existe…' }), E.mensajeDeRespuesta(403, 'Sin permisos'), E.mensajeDeRespuesta(500, null)],
  [E.MSG_EDITOR.sesion, 'Ya existe…', 'No tienes permiso para cambiar plantillas.', 'No se pudo guardar la plantilla. Intenta de nuevo.'], 'mensajes: el j.error de la API cuando lo trae');
si(E.confirmacionDesactivar('mop').includes('prerrequisitos') && !E.confirmacionDesactivar('sop').includes('prerrequisitos'), 'desactivar un MOP avisa que sus órdenes dejan de copiar prerrequisitos');
si(E.MENSAJE_PASOS_LIGADOS.includes('«Plantillas de checklist» (/configuracion/plantillas)') && E.MENSAJE_PASOS_LIGADOS.includes('vínculos'), 'el 409 de pasos ligados lleva al editor');
si(E.puedeEditarPlantillas('jefe') && E.puedeEditarPlantillas('admin') && !E.puedeEditarPlantillas('tecnico') && !E.puedeEditarPlantillas(undefined), 'editan admin y jefe');

// ── El script de la página, en jsdom ───────────────────────────────────────
const pagina = fs.readFileSync(path.join(raiz, 'src/pages/configuracion/plantillas.astro'), 'utf8');
const IDS = ['pl-app', 'pl-nueva', 'pl-aviso', 'pl-error', 'pl-sugerida-caja', 'pl-sugerida', 'pl-sugerida-estado', 'pl-vista-lista', 'pl-lista', 'pl-vacia',
  'pl-editor', 'pl-editor-titulo', 'pl-editor-notas', 'pl-form', 'pl-campos', 'pl-nombre', 'pl-nombre-error', 'pl-descripcion', 'pl-pasos', 'pl-agregar-paso',
  'pl-editor-error', 'pl-guardar', 'pl-cancelar'];
for (const id of IDS) si(pagina.includes(`id="${id}"`), `la página tiene #${id}`);
es((pagina.match(/<script[\s>]/g) ?? []).length, 1, 'un solo <script>, sin define:vars: los datos van en data-*');
si(pagina.includes('data-plantillas={JSON.stringify(plantillas)}') && !pagina.includes('set:html'), 'datos en data-plantillas (Astro los escapa)');
const codigo = pagina.slice(pagina.lastIndexOf('<script>') + '<script>'.length, pagina.lastIndexOf('</script>'));
const script = (await build({ stdin: { contents: codigo, resolveDir: path.join(raiz, 'src/pages/configuracion'), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' })).outputFiles[0].text;

const HTML = `<!doctype html><html><body>
  <div id="pl-app">
    <button type="button" id="pl-nueva">Nueva plantilla</button>
    <div id="pl-aviso" role="status" class="hidden"></div>
    <div id="pl-error" role="alert" class="hidden"></div>
    <section id="pl-sugerida-caja"><button type="button" id="pl-sugerida">Crear plantilla sugerida</button><span id="pl-sugerida-estado"></span></section>
    <section id="pl-vista-lista"><table><tbody id="pl-lista"></tbody></table><p id="pl-vacia" class="hidden">Todavía no hay plantillas.</p></section>
    <section id="pl-editor" class="hidden">
      <h2 id="pl-editor-titulo"></h2><div id="pl-editor-notas"></div>
      <form id="pl-form" novalidate>
        <fieldset id="pl-campos">
          <input id="pl-nombre"><p id="pl-nombre-error" class="hidden"></p>
          <textarea id="pl-descripcion"></textarea>
          <ol id="pl-pasos"></ol>
          <button type="button" id="pl-agregar-paso">Agregar paso</button>
        </fieldset>
        <div id="pl-editor-error" role="alert" class="hidden"></div>
        <button type="submit" id="pl-guardar">Guardar cambios</button>
        <button type="button" id="pl-cancelar">Cancelar</button>
      </form>
    </section>
  </div>
</body></html>`;

const IEC = {
  id: 4, nombre: 'Seguridad eléctrica IEC 62353', descripcion: 'Prueba de seguridad eléctrica', activa: true, tipo: 'sop', documento: null, conVinculos: false,
  items: [
    { texto: 'Inspección visual', criterioAceptacion: 'Sin daños', bloqueante: true, minutosEstimados: 5, materiales: null, requiereValor: false, unidad: null, valorEsperadoMin: null, valorEsperadoMax: null },
    { texto: 'Medir resistencia de tierra de protección', criterioAceptacion: '≤ 0.3 Ω', bloqueante: false, minutosEstimados: 10, materiales: null, requiereValor: true, unidad: 'Ω', valorEsperadoMin: null, valorEsperadoMax: 0.3 },
    { texto: 'Prueba funcional', criterioAceptacion: null, bloqueante: true, minutosEstimados: 10, materiales: null, requiereValor: false, unidad: null, valorEsperadoMin: null, valorEsperadoMax: null },
  ],
};
const MOP = { id: 7, nombre: 'MOP-MSP-01 · Cambio de compresor', descripcion: '', activa: true, tipo: 'mop', documento: { id: 31, codigo: 'MOP-MSP-01', version: '1.0' }, conVinculos: false, items: [] };
const LIGADA = {
  id: 9, nombre: 'Ronda de gases', descripcion: '', activa: false, tipo: 'sop', documento: null, conVinculos: true,
  items: [{ texto: 'Leer presión', criterioAceptacion: null, bloqueante: true, minutosEstimados: null, materiales: null, requiereValor: true, unidad: 'psi', valorEsperadoMin: 50, valorEsperadoMax: 55 }],
};

const json = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

/** La API en memoria, con lo que responde GET, POST y PATCH de /api/checklist-plantillas. */
function api(iniciales) {
  const base = new Map(iniciales.map((p) => [p.id, { id: p.id, nombre: p.nombre, descripcion: p.descripcion || null, activa: p.activa, tipoDocumento: p.tipo, procedimientoId: p.documento?.id ?? null, procedimientoVersion: p.documento?.version ?? null, items: structuredClone(p.items) }]));
  let siguiente = 100;
  const llamadas = [];
  const control = { llamadas, base, espera: null, respuesta: null };
  const cabecera = (p) => { const { items, ...resto } = p; return resto; };
  control.fetch = async (url, init = {}) => {
    const metodo = init.method ?? 'GET';
    const cuerpo = init.body ? JSON.parse(init.body) : undefined;
    llamadas.push({ url: String(url), metodo, cuerpo });
    if (control.espera) await control.espera;
    const forzada = control.respuesta?.(String(url), metodo, cuerpo);
    if (forzada === 'sin red') throw new TypeError('Failed to fetch');
    if (forzada) return forzada;
    const m = /^\/api\/checklist-plantillas(?:\/(\d+))?$/.exec(String(url));
    const id = m?.[1] ? Number(m[1]) : null;
    if (metodo === 'GET' && id) return base.has(id) ? json(200, { plantilla: base.get(id) }) : json(404, { error: 'Plantilla no encontrada' });
    if (metodo === 'POST' && !id) {
      const nueva = { id: siguiente++, nombre: cuerpo.nombre, descripcion: cuerpo.descripcion ?? null, activa: true, tipoDocumento: 'sop', procedimientoId: null, procedimientoVersion: null, items: cuerpo.items ?? [] };
      base.set(nueva.id, nueva);
      return json(201, { plantilla: cabecera(nueva) });
    }
    if (metodo === 'PATCH' && id && base.has(id)) {
      const p = base.get(id);
      for (const k of ['nombre', 'descripcion', 'activa']) if (cuerpo[k] !== undefined) p[k] = cuerpo[k];
      if (cuerpo.items) p.items = cuerpo.items;
      return json(200, { plantilla: cabecera(p) });
    }
    return json(500, { error: 'Ruta no prevista en la prueba' });
  };
  return control;
}

async function abrir({ plantillas = [IEC, MOP, LIGADA], abrirId = '' } = {}) {
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errores.push(e.message));
  const dom = new JSDOM(HTML, { url: 'https://local.test/configuracion/plantillas', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  const d = w.document;
  d.getElementById('pl-app').dataset.plantillas = JSON.stringify(plantillas);
  d.getElementById('pl-app').dataset.abrir = String(abrirId);
  const preguntas = [];
  let respuesta = true;
  w.confirm = (texto) => { preguntas.push(texto); return respuesta; };
  const servidor = api(plantillas);
  w.fetch = servidor.fetch;
  w.eval(script);
  const $ = (id) => d.getElementById(id);
  const visible = (id) => !$(id).classList.contains('hidden');
  const filas = () => [...d.querySelectorAll('#pl-lista tr')].map((tr) => [...tr.children].map((td) => [...td.childNodes].map((x) => x.textContent).join(' ').replace(/\s+/g, ' ').trim()));
  const tarjetas = () => [...d.querySelectorAll('#pl-pasos li[data-paso]')];
  const campo = (i, c) => tarjetas()[i].querySelector(`[data-campo="${c}"]`);
  const escribir = (el, valor) => { el.value = valor; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const marcar = (el, valor) => { el.checked = valor; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const boton = (i, accion) => tarjetas()[i].querySelector(`[data-accion="${accion}"]`);
  const guardar = () => $('pl-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const listo = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { w, d, $, visible, filas, tarjetas, campo, escribir, marcar, boton, guardar, listo, servidor, errores, preguntas, responder: (v) => { respuesta = v; } };
}
const pausa = () => { let soltar; const p = new Promise((r) => { soltar = r; }); return { p, soltar }; };

// La lista
{
  const f = await abrir();
  es(f.filas().map((c) => c.slice(0, 6)), [
    ['MOP-MSP-01 · Cambio de compresor', 'mop', '0', '0', '0', 'MOP-MSP-01 v1.0'],
    ['Ronda de gases Inactiva', 'sop', '1', '1', '1', '—'],
    ['Seguridad eléctrica IEC 62353 Prueba de seguridad eléctrica', 'sop', '3', '1', '2', '—'],
  ], 'lista ordenada: tipo, pasos, con lectura, críticos y documento');
  es(f.filas().map((c) => c[6]), ['EditarDesactivar', 'EditarActivar', 'EditarDesactivar'], 'acciones según el estado');
  es([f.$('pl-sugerida').textContent, f.visible('pl-editor'), f.servidor.llamadas.length], ['Crear plantilla sugerida', false, 0], 'sin la sugerida; nada se pide a la API al abrir');
  es(f.errores, [], 'sin errores de script');
}

// La plantilla sugerida se crea una sola vez
{
  const f = await abrir();
  const espera = pausa();
  f.servidor.espera = espera.p;
  f.$('pl-sugerida').click();
  es([f.$('pl-sugerida').disabled, f.$('pl-sugerida').textContent], [true, 'Creando…'], 'mientras responde, el botón queda deshabilitado');
  f.$('pl-sugerida').click();
  f.$('pl-sugerida').disabled = false; // aunque el botón se habilitara, no sale otro envío
  f.$('pl-sugerida').click();
  es(f.servidor.llamadas.filter((l) => l.metodo === 'POST').length, 1, 'doble clic: un solo POST');
  f.servidor.espera = null;
  espera.soltar();
  await f.listo();
  const posts = f.servidor.llamadas.filter((l) => l.metodo === 'POST');
  es(posts.map((l) => [l.url, l.cuerpo]), [['/api/checklist-plantillas', E.envioSugerida()]], 'manda la plantilla sugerida completa');
  es(f.servidor.llamadas.map((l) => `${l.metodo} ${l.url}`), ['POST /api/checklist-plantillas', 'GET /api/checklist-plantillas/100'], 'después la vuelve a leer con sus pasos');
  es([f.visible('pl-editor'), f.$('pl-editor-titulo').textContent, f.tarjetas().length], [true, 'Editar «Preventivo biomédico general»', 5], 'se abre en el editor con sus cinco pasos');
  si(f.$('pl-editor-notas').textContent.includes('Es un punto de partida'), 'el editor dice que es un punto de partida');
  si(f.$('pl-aviso').textContent.includes('creada') && f.visible('pl-aviso'), 'aviso de creada');
  es([f.campo(0, 'critico').checked, f.campo(2, 'critico').checked, f.campo(4, 'critico').checked], [true, false, false], 'con sus puntos críticos');
  f.$('pl-cancelar').click();
  es([f.preguntas.length, f.visible('pl-editor'), f.$('pl-sugerida').textContent], [0, false, 'Abrir plantilla sugerida'], 'sin cambios se cierra sin preguntar; el botón ya dice «Abrir»');
  si(f.filas().some((c) => c[0] === 'Preventivo biomédico general Punto de partida Punto de partida para el preventivo de los equipos biomédicos. Ingeniería Biomédica ajusta los pasos, los criterios, los tiempos y las lecturas a cada familia de equipos y a su manual.'),
    'en la lista, con la marca «Punto de partida»');
  const antes = f.servidor.llamadas.length;
  f.$('pl-sugerida').click();
  await f.listo();
  es([f.servidor.llamadas.length - antes, f.visible('pl-editor'), f.$('pl-editor-titulo').textContent], [0, true, 'Editar «Preventivo biomédico general»'], 'otro clic no crea otra: abre la que ya existe');
  es(f.errores, [], 'sin errores de script');
}
{
  // Ya existe con otra escritura (sin tildes): no se manda nada.
  const f = await abrir({ plantillas: [IEC, { ...MOP, id: 12, nombre: 'preventivo biomedico general', tipo: 'sop', documento: null }] });
  es([f.$('pl-sugerida').textContent, f.$('pl-sugerida-estado').textContent], ['Abrir plantilla sugerida', 'Ya está creada: ábrela para revisarla.'], 'reconoce la que ya existe');
  f.$('pl-sugerida').click();
  await f.listo();
  es([f.servidor.llamadas.length, f.$('pl-editor-titulo').textContent], [0, 'Editar «preventivo biomedico general»'], 'abre esa sin POST');
}
{
  // Otra pestaña la creó mientras tanto: la API responde 409 con su id y se abre esa.
  const f = await abrir({ plantillas: [IEC] });
  f.servidor.base.set(55, { id: 55, nombre: 'Preventivo biomédico general', descripcion: null, activa: true, tipoDocumento: 'sop', procedimientoId: null, procedimientoVersion: null, items: E.envioSugerida().items });
  f.servidor.respuesta = (url, metodo) => (metodo === 'POST' ? json(409, { error: 'Ya existe una plantilla llamada «Preventivo biomédico general». Usa otro nombre o abre esa plantilla.', id: 55 }) : null);
  f.$('pl-sugerida').click();
  await f.listo();
  es([f.$('pl-editor-titulo').textContent, f.tarjetas().length], ['Editar «Preventivo biomédico general»', 5], 'abre la que creó la otra pestaña');
  si(f.$('pl-aviso').textContent.includes('ya existía'), 'y lo dice');
  es(f.servidor.llamadas.filter((l) => l.metodo === 'POST').length, 1, 'un solo intento de crear');
}
{
  // Sin red: no se crea y el botón vuelve a servir.
  const f = await abrir({ plantillas: [IEC] });
  f.servidor.respuesta = () => 'sin red';
  f.$('pl-sugerida').click();
  await f.listo();
  es([f.$('pl-error').textContent, f.$('pl-sugerida').disabled, f.$('pl-sugerida').textContent], ['Sin conexión. La plantilla sugerida no se creó: intenta de nuevo.', false, 'Crear plantilla sugerida'], 'sin red: aviso y el botón vuelve');
}

// Editar: lectura con unidad y rango, orden, solo lo que cambió
{
  const f = await abrir();
  f.d.querySelector('[data-editar="4"]').click();
  es([f.$('pl-nombre').value, f.tarjetas().length, f.campo(1, 'maximo').value, f.campo(1, 'unidad').value], ['Seguridad eléctrica IEC 62353', 3, '0.3', 'Ω'], 'abre con sus pasos y su lectura');
  si(f.$('pl-editor-notas').textContent.includes('trae las lecturas de la orden por el texto de sus pasos'), 'avisa que el registro eléctrico lee los textos de sus pasos');
  es([f.boton(0, 'subir').disabled, f.boton(2, 'bajar').disabled], [true, true], 'el primero no sube y el último no baja');
  const lectura0 = () => f.tarjetas()[0].querySelector('[data-lectura]');
  es(lectura0().classList.contains('hidden'), true, 'sin «Pide lectura» no se ven unidad ni rango');
  f.marcar(f.campo(0, 'pideLectura'), true);
  es(lectura0().classList.contains('hidden'), false, 'al marcar «Pide lectura» aparecen');
  f.escribir(f.campo(0, 'unidad'), '°C');
  f.escribir(f.campo(0, 'minimo'), '8');
  f.escribir(f.campo(0, 'maximo'), '14');
  f.boton(2, 'subir').click();
  es(f.tarjetas().map((li) => li.querySelector('[data-numero]').textContent + ' ' + li.querySelector('[data-campo="texto"]').value),
    ['Paso 1 Inspección visual', 'Paso 2 Prueba funcional', 'Paso 3 Medir resistencia de tierra de protección'], 'subir un paso lo cambia de lugar y renumera');
  f.guardar();
  await f.listo();
  const patch = f.servidor.llamadas.find((l) => l.metodo === 'PATCH');
  es(Object.keys(patch.cuerpo), ['items'], 'sin cambiar nombre ni descripción solo viajan los pasos');
  es(patch.cuerpo.items.map((p) => [p.texto, p.requiereValor, p.unidad, p.valorEsperadoMin, p.valorEsperadoMax, p.bloqueante]), [
    ['Inspección visual', true, '°C', 8, 14, true],
    ['Prueba funcional', false, null, null, null, true],
    ['Medir resistencia de tierra de protección', true, 'Ω', null, 0.3, false],
  ], 'cada paso con su lectura, unidad, rango y punto crítico, en el orden nuevo');
  es([f.visible('pl-editor'), f.$('pl-aviso').textContent], [false, 'Plantilla «Seguridad eléctrica IEC 62353» guardada.'], 'guardada: vuelve a la lista con el aviso');
  es(f.filas().find((c) => c[0].startsWith('Seguridad'))?.slice(2, 5), ['3', '2', '2'], 'la lista cuenta la lectura nueva');
  es(f.errores, [], 'sin errores de script');
}

// Errores por paso: no se manda nada
{
  const f = await abrir({ abrirId: 4 });
  es([f.visible('pl-editor'), f.$('pl-editor-titulo').textContent], [true, 'Editar «Seguridad eléctrica IEC 62353»'], '?plantilla=4 abre su editor');
  f.escribir(f.campo(0, 'texto'), '  ');
  f.escribir(f.campo(1, 'minimo'), 'abc');
  f.escribir(f.campo(1, 'maximo'), '1,200');
  f.escribir(f.campo(2, 'minutos'), '2.5');
  f.guardar();
  await f.listo();
  es(f.servidor.llamadas.length, 0, 'con errores no se llama a la API');
  es(f.$('pl-editor-error').textContent, 'Revisa los pasos marcados.', 'aviso general');
  es(f.tarjetas().map((li) => li.querySelector('[data-error-paso]').textContent), [
    'Escribe qué se hace en este paso.',
    'Mínimo: Escribe solo el número, por ejemplo 0.3. · Máximo: ¿1200 o 1,2? Escribe el número sin separador de miles.',
    'Los minutos son un número entero mayor que cero.',
  ], 'el error, debajo de cada paso');
  es([f.campo(0, 'texto').getAttribute('aria-invalid'), f.d.activeElement === f.campo(0, 'texto')], ['true', true], 'marca y enfoca el primer campo con error');
  f.escribir(f.campo(0, 'texto'), 'Inspección visual');
  f.escribir(f.campo(1, 'minimo'), '5');
  f.escribir(f.campo(1, 'maximo'), '1');
  f.escribir(f.campo(2, 'minutos'), '');
  f.guardar();
  await f.listo();
  es([f.servidor.llamadas.length, f.tarjetas()[1].querySelector('[data-error-paso]').textContent], [0, 'El mínimo no puede ser mayor que el máximo.'], 'rango al revés');
}

// El j.error de la API, la falta de red y el doble envío
{
  const f = await abrir({ abrirId: 4 });
  f.escribir(f.$('pl-descripcion'), 'Referencia IEC 62353');
  f.servidor.respuesta = (url, metodo) => (metodo === 'PATCH' ? json(409, { error: E.MENSAJE_PASOS_LIGADOS }) : null);
  f.escribir(f.campo(0, 'texto'), 'Inspección visual del equipo');
  f.guardar();
  await f.listo();
  es([f.$('pl-editor-error').textContent, f.visible('pl-editor'), f.campo(0, 'texto').value, f.$('pl-guardar').disabled, f.$('pl-guardar').textContent, f.$('pl-campos').disabled],
    [E.MENSAJE_PASOS_LIGADOS, true, 'Inspección visual del equipo', false, 'Guardar cambios', false], '409: muestra el j.error y no pierde lo escrito');
  f.servidor.respuesta = () => json(401, { error: 'No autenticado' });
  f.guardar();
  await f.listo();
  es(f.$('pl-editor-error').textContent, E.MSG_EDITOR.sesion, '401: la sesión terminó, lo escrito sigue');
  f.servidor.respuesta = () => 'sin red';
  f.guardar();
  await f.listo();
  es([f.$('pl-editor-error').textContent, f.$('pl-descripcion').value, f.$('pl-guardar').disabled], [E.MSG_EDITOR.sinConexion, 'Referencia IEC 62353', false], 'sin red: aviso y lo escrito queda');

  f.servidor.respuesta = null;
  const espera = pausa();
  f.servidor.espera = espera.p;
  const antes = f.servidor.llamadas.length;
  f.$('pl-guardar').click();
  es([f.$('pl-guardar').disabled, f.$('pl-guardar').textContent, f.$('pl-campos').disabled, f.$('pl-cancelar').disabled], [true, 'Guardando…', true, true], 'mientras guarda: botones y campos bloqueados');
  f.$('pl-guardar').click();
  f.guardar();
  es(f.servidor.llamadas.length - antes, 1, 'doble envío: un solo PATCH');
  f.servidor.espera = null;
  espera.soltar();
  await f.listo();
  const patch = f.servidor.llamadas.filter((l) => l.metodo === 'PATCH').at(-1);
  es([patch.cuerpo.descripcion, patch.cuerpo.items[0].texto, f.visible('pl-editor')], ['Referencia IEC 62353', 'Inspección visual del equipo', false], 'el envío que salió se guarda');
  es(f.errores, [], 'sin errores de script');
}

// Activar y desactivar
{
  const f = await abrir();
  f.responder(false);
  f.d.querySelector('[data-estado="4"]').click();
  await f.listo();
  es([f.preguntas.length, f.servidor.llamadas.length], [1, 0], '«Cancelar» en la confirmación no desactiva');
  si(f.preguntas[0].startsWith('¿Desactivar esta plantilla?') && !f.preguntas[0].includes('prerrequisitos'), 'confirmación de un SOP');
  f.responder(true);
  f.d.querySelector('[data-estado="4"]').click();
  await f.listo();
  es(f.servidor.llamadas.map((l) => [l.metodo, l.url, l.cuerpo]), [['PATCH', '/api/checklist-plantillas/4', { activa: false }]], 'desactivar = PATCH { activa: false }');
  es([f.filas().find((c) => c[0].startsWith('Seguridad'))[0].includes('Inactiva'), f.d.querySelector('[data-estado="4"]').textContent], [true, 'Activar'], 'queda inactiva y ofrece «Activar»');
  si(f.$('pl-aviso').textContent.includes('desactivada'), 'aviso de desactivada');
  f.d.querySelector('[data-estado="7"]').click();
  await f.listo();
  si(f.preguntas.at(-1).includes('prerrequisitos y sus lecturas de liberación'), 'desactivar un MOP explica qué deja de copiar');
  f.d.querySelector('[data-estado="9"]').click();
  await f.listo();
  es([f.preguntas.length, f.servidor.llamadas.at(-1).cuerpo], [3, { activa: true }], 'activar no pregunta');
  f.servidor.respuesta = () => json(403, { error: 'No tienes permiso para esto.' });
  f.d.querySelector('[data-estado="9"]').click();
  await f.listo();
  es([f.$('pl-error').textContent, f.d.querySelector('[data-estado="9"]').disabled], ['No tienes permiso para esto.', false], 'el j.error del 403 y el botón vuelve');
  f.servidor.respuesta = () => 'sin red';
  f.d.querySelector('[data-estado="9"]').click();
  await f.listo();
  es(f.$('pl-error').textContent, 'Sin conexión. La plantilla quedó como estaba: intenta de nuevo.', 'sin red al cambiar el estado');
}

// Pasos ligados: solo nombre y descripción
{
  const f = await abrir({ abrirId: 9 });
  si(f.$('pl-editor-notas').textContent.includes('sus pasos no se cambian aquí'), 'explica por qué no se editan sus pasos');
  es([f.campo(0, 'texto').disabled, f.boton(0, 'quitar'), f.$('pl-agregar-paso').classList.contains('hidden')], [true, null, true], 'pasos de solo lectura');
  f.escribir(f.$('pl-nombre'), 'Ronda de gases medicinales');
  f.guardar();
  await f.listo();
  es(f.servidor.llamadas[0].cuerpo, { nombre: 'Ronda de gases medicinales' }, 'manda solo el nombre: los pasos ligados no viajan');
}

// Una plantilla vieja con dos pasos de igual texto: renombrarla no se traba; cambiar sus pasos pide distinguirlos
{
  const doble = { texto: 'Medir voltaje', criterioAceptacion: null, bloqueante: false, minutosEstimados: null, materiales: null, requiereValor: true, unidad: 'V', valorEsperadoMin: 110, valorEsperadoMax: 130 };
  const TABLERO = { id: 15, nombre: 'Tablero eléctrico', descripcion: '', activa: true, tipo: 'sop', documento: null, conVinculos: false, items: [doble, { ...doble, valorEsperadoMin: 200, valorEsperadoMax: 240 }] };
  const f = await abrir({ plantillas: [TABLERO], abrirId: 15 });
  f.escribir(f.$('pl-nombre'), 'Tablero eléctrico principal');
  f.guardar();
  await f.listo();
  es(f.servidor.llamadas.map((l) => l.cuerpo), [{ nombre: 'Tablero eléctrico principal' }, undefined], 'solo el nombre: los pasos que nadie tocó no se revisan ni viajan');
  f.d.querySelector('[data-editar="15"]').click();
  f.escribir(f.campo(0, 'criterio'), 'Fase L1');
  f.guardar();
  await f.listo();
  es([f.servidor.llamadas.length, f.tarjetas()[1].querySelector('[data-error-paso]').textContent], [2, E.MSG_EDITOR.repetido(1)], 'al cambiar los pasos pide distinguir el repetido');
  f.escribir(f.campo(1, 'texto'), 'Medir voltaje L2');
  f.guardar();
  await f.listo();
  es(f.servidor.llamadas.at(-2).cuerpo.items.map((p) => [p.texto, p.valorEsperadoMin]), [['Medir voltaje', 110], ['Medir voltaje L2', 200]], 'distinguidos, se guardan con su rango');
}

// Nueva plantilla, nombre repetido, sin cambios y salir sin guardar
{
  const f = await abrir();
  f.$('pl-nueva').click();
  es([f.$('pl-editor-titulo').textContent, f.tarjetas().length, f.$('pl-guardar').textContent], ['Nueva plantilla', 1, 'Crear plantilla'], 'plantilla nueva con un paso vacío');
  f.$('pl-cancelar').click();
  es([f.preguntas.length, f.visible('pl-editor')], [0, false], 'sin escribir nada se cierra sin preguntar');
  f.$('pl-nueva').click();
  f.guardar();
  await f.listo();
  es([f.servidor.llamadas.length, f.$('pl-nombre-error').textContent, f.$('pl-editor-error').textContent], [0, 'Escribe el nombre de la plantilla.', 'Escribe el nombre de la plantilla.'], 'sin nombre no se manda');
  f.escribir(f.$('pl-nombre'), 'seguridad electrica iec 62353');
  f.escribir(f.campo(0, 'texto'), 'Desinfectar la cúpula');
  f.guardar();
  await f.listo();
  es([f.servidor.llamadas.length, f.$('pl-nombre-error').textContent], [0, 'Ya existe una plantilla llamada «Seguridad eléctrica IEC 62353». Usa otro nombre o abre esa plantilla.'], 'nombre repetido sin tildes: no se manda');
  f.escribir(f.$('pl-nombre'), 'Limpieza de incubadora');
  f.boton(0, 'quitar').click();
  f.guardar();
  await f.listo();
  es([f.servidor.llamadas.length, f.$('pl-editor-error').textContent], [0, 'Agrega al menos un paso.'], 'sin pasos no se crea');
  f.$('pl-agregar-paso').click();
  es(f.d.activeElement, f.campo(0, 'texto'), '«Agregar paso» enfoca el texto del paso nuevo');
  f.escribir(f.campo(0, 'texto'), 'Desinfectar la cúpula');
  f.marcar(f.campo(0, 'critico'), true);
  f.guardar();
  await f.listo();
  const post = f.servidor.llamadas.find((l) => l.metodo === 'POST');
  es(post.cuerpo, { nombre: 'Limpieza de incubadora', descripcion: null, items: [{ texto: 'Desinfectar la cúpula', criterioAceptacion: null, bloqueante: true, minutosEstimados: null, materiales: null, requiereValor: false, unidad: null, valorEsperadoMin: null, valorEsperadoMax: null }] }, 'crea con todo explícito');
  es([f.visible('pl-editor'), f.$('pl-aviso').textContent, f.filas().some((c) => c[0] === 'Limpieza de incubadora')], [false, 'Plantilla «Limpieza de incubadora» creada.', true], 'creada y en la lista');

  f.d.querySelector('[data-editar="4"]').click();
  f.guardar();
  await f.listo();
  es([f.$('pl-editor-error').textContent, f.servidor.llamadas.length], [E.MSG_EDITOR.sinCambios, 2], 'sin cambios no se manda nada');
  for (let i = f.tarjetas().length - 1; i >= 0; i--) f.boton(i, 'quitar').click();
  f.guardar();
  await f.listo();
  es([f.$('pl-editor-error').textContent, f.servidor.llamadas.length], [E.MSG_EDITOR.quitarTodos, 2], 'no deja una plantilla sin pasos');
  f.responder(false);
  f.$('pl-cancelar').click();
  es([f.preguntas.at(-1), f.visible('pl-editor')], [E.MSG_EDITOR.salir, true], 'con cambios pregunta antes de salir; «Cancelar» se queda');
  f.responder(true);
  f.$('pl-cancelar').click();
  es([f.visible('pl-editor'), f.filas().find((c) => c[0].startsWith('Seguridad'))[2]], [false, '3'], '«Aceptar» sale sin guardar: la plantilla sigue con sus pasos');
  const salir = new f.w.Event('beforeunload', { cancelable: true });
  f.w.dispatchEvent(salir);
  es(salir.defaultPrevented, false, 'sin editor abierto, salir de la página no pregunta');
  f.d.querySelector('[data-editar="4"]').click();
  f.escribir(f.$('pl-nombre'), 'Otro nombre');
  const salir2 = new f.w.Event('beforeunload', { cancelable: true });
  f.w.dispatchEvent(salir2);
  es(salir2.defaultPrevented, true, 'con cambios sin guardar, el navegador pregunta antes de salir');
  es(f.errores, [], 'sin errores de script');
}

console.log(`PASS test-bio-seguridad-electrica-plantillas-editor: ${n} casos; editor de plantillas con la sugerida una sola vez, errores por paso, j.error, sin red y sin doble envío.`);
