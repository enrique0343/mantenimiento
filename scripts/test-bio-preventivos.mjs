// Fase 59 · WP-E: parte automática del requisito 13. El cron de preventivos y «Generar OT
// ahora» no crean órdenes para equipos dados de baja; el cron lo anota en `omitidas` y no
// desactiva la rutina (eso lo hace la baja). Solo memoria: sin red ni correo (el arnés
// reemplaza el resumen diario y el aviso biomédico).
import assert from 'node:assert/strict';
import { setup } from './test-support/sqlite-app.mjs';

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };

const { api, sqlite, call, close } = await setup({ modules: {
  cron: 'api/cron/generar-preventivos.ts',
  generarOt: 'api/planes/[id]/generar-ot.ts',
} });
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Sin red en la prueba de preventivos'); };
try {
  sqlite.exec(`
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,estado) VALUES
      (1,'BIO-OK','Monitor','biomedico','biomedico','operativo'),
      (2,'BIO-BAJA','Bomba dada de baja','biomedico','biomedico','baja');
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,prioridad) VALUES
      (1,1,'Preventivo monitor','cuatrimestral','2000-01-01','media'),
      (2,2,'Preventivo bomba','mensual','2000-01-01','alta');
  `);
  const opciones = { method: 'POST', headers: { 'x-cron-secret': 'solo-prueba' }, env: { CRON_SECRET: 'solo-prueba' } };
  let r = await call(api.cron.POST, '/api/cron/generar-preventivos', opciones);
  es(r.status, 200, 'el cron corre');
  es(r.body.creadas, 1, 'solo la rutina del equipo vigente genera orden');
  es(r.body.omitidas, [{ origen: 'equipo', refId: 2, motivo: 'Equipo dado de baja' }], 'la del equipo de baja queda anotada');
  es(sqlite.prepare('SELECT plan_id FROM ordenes ORDER BY id').all().map((o) => o.plan_id), [1], 'ninguna orden para el equipo de baja');
  es({ ...sqlite.prepare('SELECT activo, ultima_generacion FROM planes_mantenimiento WHERE id = 2').get() }, { activo: 1, ultima_generacion: null }, 'la rutina no se desactiva ni se marca como generada');
  es(r.body.fecha, new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10), '«hoy» es el de El Salvador');
  es(r.body.avisoBioEnviados, 0, 'la respuesta trae el aviso biomédico');

  r = await call(api.generarOt.POST, '/api/planes/2/generar-ot', { method: 'POST', id: 2, rol: 'jefe' });
  es([r.status, r.body.error], [409, 'El equipo está dado de baja: no se generan órdenes.'], '«Generar OT ahora» con equipo de baja → 409');
  r = await call(api.generarOt.POST, '/api/planes/2/generar-ot', { method: 'POST', id: 2, rol: 'tecnico' });
  es(r.status, 403, 'el técnico no genera órdenes a mano');
  es(sqlite.prepare('SELECT count(*) AS n FROM ordenes').get().n, 1, 'sin órdenes nuevas');
} finally {
  globalThis.fetch = fetchOriginal;
  await close();
}

console.log(`PASS test-bio-preventivos: ${n} casos; el cron y «Generar OT ahora» no crean órdenes para equipos dados de baja.`);
