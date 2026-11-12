// Fase 59 · seguridad eléctrica: el formulario de la prueba en el navegador.
// La lista de analizadores dice hasta cuándo valía la calibración en la fecha de
// la prueba (`hasta` de K-B4, no la próxima de hoy) y cambiar la orden, que recarga
// la página, no borra lo escrito sin preguntar. Reglas puras de
// src/lib/seguridad-electrica-formulario.ts y el script real de la página en jsdom
// (sin build: se toma el <script> de nueva.astro y se empaqueta con esbuild).
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
const lib = await build({ entryPoints: [path.join(raiz, 'src/lib/seguridad-electrica-formulario.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
const F = await import(`data:text/javascript;base64,${Buffer.from(lib.outputFiles[0].text).toString('base64')}`);
const patron = (o = {}) => ({ id: 1006, codigo: 'PAT-1', nombre: 'ANALIZADOR', marca: 'Fluke', modelo: 'ESA615', serial: 'SN-1', estado: 'vigente', proxima: '2027-11-01', vigenteEnFecha: true, hasta: '2027-03-01', ...o });
es(F.opcionAnalizador(patron(), '2026-11-12'), { texto: 'Fluke ESA615 · S/N SN-1 · cal. vence 01/03/2027', habilitado: true }, 'vigente en la fecha: vence = hasta');
es(F.opcionAnalizador(patron({ vigenteEnFecha: false, hasta: null }), '2026-10-20'),
  { texto: 'Fluke ESA615 · S/N SN-1 · sin calibración a esa fecha', habilitado: false }, 'calibrado después de la prueba: no muestra la próxima de hoy (01/11/2027)');
es(F.opcionAnalizador(patron({ vigenteEnFecha: false, hasta: '2026-10-01' }), '2026-11-12'),
  { texto: 'Fluke ESA615 · S/N SN-1 · cal. vence 01/10/2026 · calibración vencida', habilitado: false }, 'vencida en la fecha');
es(F.opcionAnalizador(patron({ vigenteEnFecha: false }), '2026-11-12'),
  { texto: 'Fluke ESA615 · S/N SN-1 · cal. vence 01/03/2027 · calibración no conforme o sin certificado', habilitado: false }, 'con fecha vigente pero sin certificado o no conforme');
es(F.opcionAnalizador(patron({ serial: '  ' }), '2026-11-12'), { texto: 'Fluke ESA615 · S/N — · cal. vence 01/03/2027 · sin número de serie', habilitado: false }, 'sin número de serie');
es(F.opcionAnalizador(patron({ marca: ' ', modelo: null }), '2026-11-12').texto, 'ANALIZADOR · S/N SN-1 · cal. vence 01/03/2027', 'sin marca ni modelo: el nombre');
si(F.MENSAJE_CAMBIAR_ORDEN.includes('se pierde lo que escribiste'), 'el aviso dice qué se pierde');

// ── El script de la página, en jsdom ───────────────────────────────────────
const pagina = fs.readFileSync(path.join(raiz, 'src/pages/activos/[id]/seguridad-electrica/nueva.astro'), 'utf8');
for (const id of ['se-form', 'se-orden', 'se-fecha', 'se-analizador', 'se-analizador-aviso', 'se-analizador-manual', 'se-notas', 'se-an-desc']) {
  si(pagina.includes(`id="${id}"`), `la página tiene #${id}`);
}
const codigo = pagina.slice(pagina.lastIndexOf('<script>') + '<script>'.length, pagina.lastIndexOf('</script>'));
const script = (await build({ stdin: { contents: codigo, resolveDir: path.join(raiz, 'src/pages'), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' })).outputFiles[0].text;

const HTML = `<!doctype html><html><body>
  <div id="se-error" role="alert" class="hidden"></div>
  <form id="se-form" novalidate data-activo-id="1001" data-hoy="2026-11-12" data-meses="12" data-puede-proxima="0" data-analizador-previo="">
    <input id="se-fecha" name="fecha" type="date" value="2026-10-20">
    <select id="se-orden" name="ordenId"><option value="">— Sin orden —</option><option value="3001">OT-1</option><option value="3002">OT-2</option></select>
    <label><input type="radio" name="tipo" value="periodica" checked> Periódica</label>
    <label><input type="radio" name="tipo" value="post_reparacion"> Después de reparación</label>
    <select id="se-analizador"><option value="">Cargando analizadores…</option></select>
    <p id="se-analizador-aviso"></p>
    <div id="se-analizador-manual" class="hidden"><input id="se-an-desc" name="analizadorDescripcion"></div>
    <textarea id="se-notas" name="notas"></textarea>
    <p id="se-proxima-texto"></p>
  </form>
</body></html>`;

async function abrir() {
  const navegaciones = [];
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => (/navigation/i.test(e.message) ? navegaciones : errores).push(e.message));
  const dom = new JSDOM(HTML, { url: 'https://local.test/activos/1001/seguridad-electrica/nueva', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  const preguntas = [];
  let respuesta = true;
  w.confirm = (texto) => { preguntas.push(texto); return respuesta; };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  const pedidos = [];
  w.fetch = async (url) => {
    pedidos.push(String(url));
    // Un patrón calibrado el 01/11/2026 (después de la prueba del 20/10) y otro vigente.
    return new Response(JSON.stringify({ patrones: [
      { id: 1006, codigo: 'PAT-1', nombre: 'ANALIZADOR', marca: 'Fluke', modelo: 'ESA615', serial: 'SN-1', estado: 'vigente', proxima: '2027-11-01', vigenteEnFecha: false, hasta: null },
      { id: 1009, codigo: 'PAT-2', nombre: 'ANALIZADOR 2', marca: 'Rigel', modelo: '288', serial: 'RG-2', estado: 'vigente', proxima: '2027-01-15', vigenteEnFecha: true, hasta: '2027-01-15' },
      // El mismo equipo de la prueba (un patrón que se prueba): no se ofrece como su analizador.
      { id: 1001, codigo: 'BIO-1001', nombre: 'MONITOR', marca: 'Mindray', modelo: 'uMEC10', serial: 'M-1', estado: 'vigente', proxima: '2027-02-01', vigenteEnFecha: true, hasta: '2027-02-01' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  w.eval(script);
  await new Promise((r) => setTimeout(r, 30));
  const d = w.document;
  const cambiar = (el, valor, evento = 'change') => { el.value = valor; el.dispatchEvent(new w.Event(evento, { bubbles: true })); };
  return { w, d, navegaciones, errores, preguntas, pedidos, cambiar, responder: (v) => { respuesta = v; } };
}

{
  const f = await abrir();
  const sel = f.d.getElementById('se-analizador');
  es(f.pedidos, ['/api/calibraciones/patrones?fecha=2026-10-20'], 'pide los patrones con la fecha de la prueba');
  es([...sel.options].map((o) => [o.value, o.textContent, o.disabled]), [
    ['', '— Elige el analizador —', false],
    ['1006', 'Fluke ESA615 · S/N SN-1 · sin calibración a esa fecha', true],
    ['1009', 'Rigel 288 · S/N RG-2 · cal. vence 15/01/2027', false],
    ['otro', 'Otro analizador (escribir datos)', false],
  ], 'la lista usa `hasta` (el patrón calibrado después de la prueba no muestra la próxima de hoy) y no ofrece el mismo equipo');

  // Sin nada escrito: cambiar la orden recarga sin preguntar.
  const orden = f.d.getElementById('se-orden');
  f.cambiar(orden, '3001');
  es([f.preguntas.length, f.navegaciones.length], [0, 1], 'sin nada escrito: recarga sin preguntar');
  // Cambiar el tipo no cuenta: viaja en la URL.
  const tipo = f.d.querySelector('input[name="tipo"][value="post_reparacion"]');
  tipo.checked = true;
  tipo.dispatchEvent(new f.w.Event('change', { bubbles: true }));
  f.cambiar(orden, '3002');
  es([f.preguntas.length, f.navegaciones.length], [0, 2], 'el tipo de prueba no se pierde: no pregunta');

  // Con algo escrito: pregunta; si dice que no, la orden vuelve y no recarga.
  f.cambiar(f.d.getElementById('se-notas'), 'Equipo con la carcasa rota', 'input');
  f.responder(false);
  f.cambiar(orden, '');
  es([f.preguntas, f.navegaciones.length, orden.value], [[F.MENSAJE_CAMBIAR_ORDEN], 2, '3002'], 'con algo escrito pregunta; «Cancelar» deja la orden y lo escrito');
  es(f.d.getElementById('se-notas').value, 'Equipo con la carcasa rota', 'lo escrito sigue ahí');
  f.responder(true);
  f.cambiar(orden, '3001');
  es([f.preguntas.length, f.navegaciones.length], [2, 3], '«Aceptar» recarga con la orden nueva');
  es(f.errores, [], 'sin errores de script');
}

console.log(`PASS test-bio-seguridad-electrica-formulario: ${n} casos; analizadores con la calibración de la fecha y cambiar la orden sin perder lo escrito.`);
