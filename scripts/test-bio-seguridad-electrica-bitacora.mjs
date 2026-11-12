// Fase 59 · seguridad eléctrica: lo que cada ruta deja en la bitácora (§f.7).
// Los arneses comunes cambian @/lib/audit por funciones vacías; aquí las rutas se
// empaquetan con una bitácora que anota cada línea, sobre la base de prueba de
// setupConjuntos (migraciones reales, incluida la 0059). Registrar, anular, adjuntar
// el informe, cambiar la periodicidad y crear, editar o desactivar una plantilla
// dejan su línea; un error no deja ninguna.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };

const BITACORA = `
  export const registro = [];
  const linea = (e) => ({ entidad: e.entidad, entidadId: e.entidadId, accion: e.accion, cambios: e.cambios ?? null, resumen: e.resumen ?? null });
  export async function logAudit(ctx, e) { registro.push(linea(e)); }
  export async function logAuditLote(ctx, lista) { for (const e of lista) registro.push(linea(e)); }
  export function calcularDiff(antes, despues, campos) {
    const d = {};
    for (const k of campos ?? Object.keys(despues)) {
      if (despues[k] === undefined) continue;
      const a = antes[k] ?? null, b = despues[k] ?? null;
      if (a !== b) d[k] = { antes: a, despues: b };
    }
    return d;
  }
  export const labelCampo = (c) => c;
  export const resumenCambios = () => '';
`;
const carpeta = await fs.mkdtemp(path.join(os.tmpdir(), 'bio-se-bitacora-'));
const archivo = path.join(carpeta, 'rutas.mjs');
await build({
  stdin: { contents: `
    export * as se from './src/pages/api/activos/[id]/seguridad-electrica';
    export * as anular from './src/pages/api/seguridad-electrica/[id]/anular';
    export * as informe from './src/pages/api/seguridad-electrica/[id]/informe';
    export * as config from './src/pages/api/seguridad-electrica/config';
    export * as lista from './src/pages/api/checklist-plantillas/index';
    export * as una from './src/pages/api/checklist-plantillas/[id]';
    export { registro } from '@/lib/audit';
  `, resolveDir: raiz, loader: 'ts' },
  outfile: archivo, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'bitacora', setup(b) {
    b.onResolve({ filter: /^@\/lib\/audit$/ }, () => ({ path: 'audit', namespace: 'bitacora' }));
    b.onLoad({ filter: /.*/, namespace: 'bitacora' }, () => ({ contents: BITACORA, loader: 'js' }));
  } }],
});
const R = await import(pathToFileURL(archivo).href);
const h = await setupConjuntos({ modules: { bio: 'lib/biomedico' } });
const B = h.app.bio;
const sql = h.sqlite;
const hoy = B.hoySV();
const dias = (d) => B.sumarDias(hoy, d);

const r2 = new Map();
const R2 = {
  async put(k, v) { r2.set(k, v); },
  async get(k) { return r2.has(k) ? { async arrayBuffer() { return r2.get(k); } } : null; },
  async delete(k) { r2.delete(k); },
};
async function llamar(ruta, url, { method = 'POST', rol = 'admin', id, form, json } = {}) {
  const c = h.ctx(url, { method, id, rol });
  const headers = new Headers({ cookie: c.request.headers.get('cookie') });
  let body;
  if (form) { body = new FormData(); for (const [k, v] of Object.entries(form)) if (v !== undefined) body.append(k, v); }
  else if (json !== undefined) { headers.set('content-type', 'application/json'); body = JSON.stringify(json); }
  c.request = new Request(`https://test.invalid${url}`, { method, headers, body });
  c.locals.runtime.env.R2 = R2;
  const res = await ruta(c);
  const texto = await res.text();
  let cuerpo = texto; try { cuerpo = JSON.parse(texto); } catch { /* texto */ }
  return { status: res.status, body: cuerpo };
}
/** Las líneas que dejó la llamada (y vacía la lista). */
const lineas = () => R.registro.splice(0);

sql.exec("INSERT INTO activos (id, codigo, nombre, tipo, rubro, clase_riesgo, serial, estado) VALUES (1001, 'BIO-1001', 'MONITOR', 'biomedico', 'biomedico', 'III', 'M-1', 'operativo')");
const PDF = new TextEncoder().encode('%PDF-1.4\n% informe\n');
const prueba = (o = {}) => ({
  confirmado: '1', fecha: dias(-2), tipo: 'periodica', claseProteccion: 'II', parteAplicada: 'ninguna', metodoFuga: 'directo',
  inspeccionVisual: 'conforme', pruebaFuncional: 'conforme', fugaEquipoUa: '40', resultado: 'pasa',
  analizadorDescripcion: 'Rigel 288', analizadorSerie: 'RG-1', analizadorCalVence: dias(100), realizadoPorId: '3', ...o,
});
const registrar = (o, rol = 'tecnico') => llamar(R.se.POST, '/api/activos/1001/seguridad-electrica', { id: 1001, rol, form: prueba(o) });

try {
  // Registrar: la constancia en la prueba y en el equipo.
  const acep = await registrar({ tipo: 'aceptacion', informe: new File([PDF], 'informe.pdf', { type: 'application/pdf' }) });
  es(acep.status, 201, 'aceptación registrada');
  const idAcep = acep.body.prueba.id;
  const textoAcep = 'Prueba de seguridad eléctrica «Aceptación (equipo nuevo)» registrada en BIO-1001: Pasa';
  es(lineas(), [
    { entidad: 'prueba_electrica', entidadId: idAcep, accion: 'create', cambios: null, resumen: textoAcep },
    { entidad: 'activo', entidadId: 1001, accion: 'update', cambios: null, resumen: textoAcep },
  ], 'registrar deja la línea de la prueba y la del equipo (sin paréntesis dentro de paréntesis)');
  es((await registrar({ confirmado: undefined })).status, 400, 'un error…');
  es(lineas(), [], '…no deja línea');

  // Adjuntar el informe que faltaba y anular.
  const per = await registrar({ fecha: dias(-1) });
  const idPer = per.body.prueba.id;
  lineas();
  es((await llamar(R.informe.POST, `/api/seguridad-electrica/${idPer}/informe`, { id: idPer, rol: 'tecnico', form: { informe: new File([PDF], 'reporte.pdf', { type: 'application/pdf' }) } })).body, { ok: true }, 'informe adjuntado');
  const textoInforme = `Informe adjuntado a la prueba de seguridad eléctrica del ${B.fechaCorta(dias(-1))} (BIO-1001): reporte.pdf`;
  es(lineas(), [
    { entidad: 'prueba_electrica', entidadId: idPer, accion: 'update', cambios: null, resumen: textoInforme },
    { entidad: 'activo', entidadId: 1001, accion: 'update', cambios: null, resumen: textoInforme },
  ], 'adjuntar el informe deja su línea');
  es((await llamar(R.anular.POST, `/api/seguridad-electrica/${idPer}/anular`, { id: idPer, rol: 'jefe', json: { motivo: 'Se registró en el equipo equivocado' } })).body, { ok: true }, 'anulada');
  const textoAnula = `Prueba de seguridad eléctrica del ${B.fechaCorta(dias(-1))} anulada en BIO-1001. Motivo: Se registró en el equipo equivocado`;
  es(lineas(), [
    { entidad: 'prueba_electrica', entidadId: idPer, accion: 'estado', cambios: { estado: { antes: 'valida', despues: 'anulada' } }, resumen: textoAnula },
    { entidad: 'activo', entidadId: 1001, accion: 'update', cambios: null, resumen: textoAnula },
  ], 'anular deja el cambio de estado con su motivo');
  es((await llamar(R.anular.POST, `/api/seguridad-electrica/${idPer}/anular`, { id: idPer, rol: 'jefe', json: { motivo: 'Se registró en el equipo equivocado' } })).status, 409, 'anular otra vez…');
  es(lineas(), [], '…no deja línea');

  // Periodicidad: solo si cambia.
  es((await llamar(R.config.POST, '/api/seguridad-electrica/config', { rol: 'jefe', json: { meses: 6 } })).body, { ok: true, meses: 6 }, 'periodicidad cambiada');
  es(lineas(), [{ entidad: 'configuracion', entidadId: 0, accion: 'update', cambios: { 'bio.seguridad_electrica.meses': { antes: 12, despues: 6 } }, resumen: 'Periodicidad de seguridad eléctrica: 12 → 6 meses' }], 'la periodicidad deja «antes → después»');
  await llamar(R.config.POST, '/api/seguridad-electrica/config', { rol: 'jefe', json: { meses: 6 } });
  es(lineas(), [], 'guardar el mismo valor no deja línea');

  // Plantillas: crear, editar, desactivar.
  const creada = await llamar(R.lista.POST, '/api/checklist-plantillas', { rol: 'jefe', json: { nombre: 'Revisión de cama', items: ['Frenos', 'Barandas'] } });
  const idP = creada.body.plantilla.id;
  es(lineas(), [{ entidad: 'checklist_plantilla', entidadId: idP, accion: 'create', cambios: null, resumen: 'Plantilla «Revisión de cama» creada con 2 pasos' }], 'crear plantilla');
  await llamar(R.una.PATCH, `/api/checklist-plantillas/${idP}`, { method: 'PATCH', id: idP, rol: 'admin', json: { nombre: 'Revisión de cama eléctrica', items: ['Frenos'] } });
  es(lineas(), [{ entidad: 'checklist_plantilla', entidadId: idP, accion: 'update', cambios: { nombre: { antes: 'Revisión de cama', despues: 'Revisión de cama eléctrica' } },
    resumen: 'Plantilla «Revisión de cama eléctrica»: nombre «Revisión de cama» → «Revisión de cama eléctrica» · pasos reemplazados (1)' }], 'editar plantilla');
  await llamar(R.una.DELETE, `/api/checklist-plantillas/${idP}`, { method: 'DELETE', id: idP, rol: 'jefe' });
  es(lineas(), [{ entidad: 'checklist_plantilla', entidadId: idP, accion: 'estado', cambios: { activa: { antes: true, despues: false } }, resumen: 'Plantilla «Revisión de cama eléctrica» desactivada' }], 'borrar = desactivar, con su línea');
  await llamar(R.una.DELETE, `/api/checklist-plantillas/${idP}`, { method: 'DELETE', id: idP, rol: 'jefe' });
  es(lineas(), [], 'desactivar una inactiva no deja línea');
  es((await llamar(R.una.PATCH, `/api/checklist-plantillas/${idP}`, { method: 'PATCH', id: idP, rol: 'admin', json: { items: [{ texto: 'Frenos', valorEsperadoMin: 3, valorEsperadoMax: 1 }] } })).status, 400, 'una edición rechazada…');
  es(lineas(), [], '…no deja línea');
} finally {
  await h.close();
  await fs.rm(carpeta, { recursive: true, force: true });
}

console.log(`PASS test-bio-seguridad-electrica-bitacora: ${n} casos; registrar, anular, adjuntar, periodicidad y plantillas dejan su línea en la bitácora.`);
