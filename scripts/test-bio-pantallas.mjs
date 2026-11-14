// Fase 59 · WP-E: los scripts de las pantallas del plan anual, de la hoja de alerta y de
// Planes, en un navegador simulado (jsdom). Se empaqueta el <script> de cada página desde
// el fuente (no hace falta `astro build`) y se corre sobre una maqueta mínima con los
// elementos que usa. Sin red: fetch es de mentira.
//  · Registrar aprobación del plan: un segundo envío mientras sube el primero no manda
//    otra aprobación (antes quedaban dos vigentes de la misma versión).
//  · Hoja de alerta: «Quitar» un archivo sin conexión dice por qué y el botón vuelve a servir.
//  · Planes: un cambio de proveedor sin conexión no deja el select bloqueado.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const root = process.cwd();

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const pausa = () => new Promise((r) => setTimeout(r, 0));

/** El <script> de cliente de una página .astro, empaquetado para el navegador. */
async function scriptDe(pagina) {
  const fuente = await fs.readFile(path.join(root, 'src/pages', pagina), 'utf8');
  const bloques = [...fuente.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(bloques.length, 1, `${pagina}: un solo <script> de cliente`);
  const out = await build({
    stdin: { contents: bloques[0], loader: 'ts', resolveDir: path.join(root, 'src/pages'), sourcefile: pagina },
    bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent',
  });
  return out.outputFiles[0].text;
}

/** Una ventana con la maqueta, el script y un fetch que la prueba controla. */
function ventana(html, codigo, { fetch }) {
  const errores = [];
  const consola = new VirtualConsole();
  consola.on('jsdomError', (e) => errores.push(String(e?.message ?? e)));
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { runScripts: 'outside-only', url: 'https://local.test/', virtualConsole: consola });
  const w = dom.window;
  const llamadas = [];
  w.fetch = (...args) => { llamadas.push(args); return fetch(...args); };
  w.confirm = () => true;
  w.alert = () => {};
  const avisos = [];
  w.showToast = (msg, tipo) => avisos.push([msg, tipo]);
  w.eval(codigo);
  return { w, d: w.document, llamadas, avisos, errores };
}
const respuesta = (status, cuerpo) => ({ ok: status < 300, status, json: async () => cuerpo });
const sinConexion = () => Promise.reject(new TypeError('Failed to fetch'));

// ── Plan anual: registrar aprobación una sola vez ───────────────────────────
{
  const codigo = await scriptDe('plan-mantenimiento.astro');
  let soltar;
  const pendiente = new Promise((r) => { soltar = r; });
  const { w, d, llamadas } = ventana(`
    <div id="aprobaciones" data-anio="2026" data-area="biomedico"></div>
    <div id="aprobarModal"><form id="aprobarForm">
      <input id="ap_version" value="02"><input id="ap_fecha" value="2026-11-10"><input id="ap_aprobo" value="Dra. Ruiz, Directora">
      <input id="ap_archivo" type="file"><textarea id="ap_notas"></textarea>
      <p id="aprobarErr" class="hidden"></p><button type="submit">Registrar</button>
    </form></div>`, codigo, { fetch: () => pendiente });
  const archivo = new w.File(['%PDF-1.4'], 'plan.pdf', { type: 'application/pdf' });
  Object.defineProperty(d.getElementById('ap_archivo'), 'files', { value: [archivo] });
  const form = d.getElementById('aprobarForm');
  const enviar = () => form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  enviar();
  enviar(); // segundo clic mientras el PDF sube
  await pausa();
  es(llamadas.length, 1, 'un solo POST aunque se envíe dos veces');
  es(form.querySelector('button[type=submit]').disabled, true, 'el botón queda bloqueado mientras sube');
  es(String(llamadas[0][0]), '/api/planes/aprobaciones', 'a la API de aprobaciones');
  const enviado = llamadas[0][1].body;
  es([enviado.get('anio'), enviado.get('area'), enviado.get('version')], ['2026', 'biomedico', '02'], 'año, área y versión del formulario');
  soltar(respuesta(409, { error: 'Ya hay una aprobación vigente de la versión 02 para 2026. Anúlala o registra otra versión.' }));
  await pausa(); await pausa();
  const err = d.getElementById('aprobarErr');
  es([err.classList.contains('hidden'), err.textContent], [false, 'Ya hay una aprobación vigente de la versión 02 para 2026. Anúlala o registra otra versión.'], 'el error de la API a la vista');
  es(form.querySelector('button[type=submit]').disabled, false, 'y el botón vuelve a servir');
  enviar();
  await pausa();
  es(llamadas.length, 2, 'después del error se puede volver a enviar');
}

// ── Hoja de alerta: quitar un archivo sin conexión ──────────────────────────
{
  const codigo = await scriptDe('alertas/[id].astro');
  const { d, llamadas, errores } = ventana(`
    <p id="hojaError" class="hidden"></p>
    <article id="hoja" data-alerta-id="5"></article>
    <button type="button" class="quitar-adjunto" data-adjunto-id="9" data-nombre="boletin.pdf">Quitar</button>`, codigo, { fetch: sinConexion });
  const boton = d.querySelector('.quitar-adjunto');
  boton.click();
  await pausa(); await pausa(); await pausa();
  es(String(llamadas[0]?.[0]), '/api/alertas/5/adjuntos?adjuntoId=9', 'pide quitar el archivo de esa alerta');
  const aviso = d.getElementById('hojaError');
  es([aviso.classList.contains('hidden'), aviso.textContent], [false, 'No hay conexión. Intenta de nuevo.'], 'sin conexión: la hoja lo dice');
  es(boton.disabled, false, 'el botón vuelve a servir');
  es(errores, [], 'sin errores sin atrapar en la página');
}

// ── Planes: proveedor sin conexión ──────────────────────────────────────────
{
  const codigo = await scriptDe('planes/index.astro');
  const { w, d, avisos } = ventana(`
    <input id="selAll" type="checkbox"><div id="bulkBar" class="hidden"><span id="bulkCount"></span></div>
    <select class="proveedor-sel" data-id="7"><option value="">—</option><option value="3">Biomédica SA</option></select>`, codigo, { fetch: sinConexion });
  const sel = d.querySelector('.proveedor-sel');
  sel.value = '3';
  sel.dispatchEvent(new w.Event('change'));
  await pausa(); await pausa();
  es([sel.disabled, sel.value], [false, ''], 'el select vuelve a su valor y no queda bloqueado');
  es(avisos.at(-1), ['No hay conexión. Intenta de nuevo.', 'error'], 'y avisa por qué');
}

console.log(`PASS test-bio-pantallas: ${n} casos; aprobación del plan sin doble envío, hoja de alerta y Planes sin conexión.`);
