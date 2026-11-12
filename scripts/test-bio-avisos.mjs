// Fase 59 · WP-E: avisos de vencimiento del equipo biomédico (src/lib/daily-digest.ts)
// sobre una base con todas las migraciones reales (incluida la 0059): la sección del
// resumen diario, el correo a la jefatura biomédica (destinatarios y una vez al día) y
// las consultas de cumplimiento-bio.ts dentro del límite de 100 columnas de D1.
// El correo se reemplaza por uno de memoria: sin red ni envíos.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const si = (r, nota) => { n++; assert.ok(r, nota); };

const h = await setupConjuntos();
const enviados = [];
globalThis.__correosPrueba = enviados;
const out = await build({
  entryPoints: ['src/lib/daily-digest.ts'], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  plugins: [{ name: 'correo-de-memoria', setup(b) {
    b.onResolve({ filter: /^\.\/(email|contratos-alertas)$/ }, (a) => ({ path: a.path.slice(2), namespace: 'memoria' }));
    b.onLoad({ filter: /.*/, namespace: 'memoria' }, ({ path }) => ({ loader: 'js', contents: path === 'email' ? `
      export const emailLayout = (titulo, cuerpo) => '<h1>' + titulo + '</h1>' + cuerpo;
      export async function sendMail(ctx, p) {
        globalThis.__correosPrueba.push(p);
        await ctx.locals.runtime.env.DB.prepare('INSERT INTO email_log (destinatario, asunto, tipo, referencia, estado) VALUES (?, ?, ?, ?, ?)')
          .bind(p.to, p.subject, p.tipo, p.referencia, 'enviado').run();
        return { ok: true };
      }` : 'export async function procesarContratosVencimiento() { return { porVencer: [] }; }' }));
  } }],
});
const D = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const ctx = { locals: { runtime: { env: { DB: h.DB, APP_URL: 'https://app.test' } } } };

try {
  h.faults.enforceColumnLimit = true; // una consulta de más de 100 columnas falla como en D1
  // Las funciones toman «hoy» de El Salvador: los datos se arman alrededor de ese día.
  const { hoySV, sumarDias } = await (async () => {
    const o = await build({ entryPoints: ['src/lib/biomedico.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
    return import(`data:text/javascript;base64,${Buffer.from(o.outputFiles[0].text).toString('base64')}`);
  })();
  const dia = hoySV();
  const en = (d) => sumarDias(dia, d);

  // ── Sin nada que venza: sección vacía y sin correo ──
  es(await D.seccionVencimientosBio(ctx, dia), '', 'sin vencimientos: la sección no aparece');
  let r = await D.enviarAvisoVencimientosBio(ctx);
  es([r.enviados, r.razon], [0, 'Sin vencimientos'], 'sin vencimientos no se envía');

  // ── Datos: jefes y equipos con vencimientos dentro y fuera de su ventana ──
  h.sqlite.exec(`
    UPDATE usuarios SET especialidad = 'general' WHERE id = 2;
    INSERT INTO usuarios (id, nombre, email, password_hash, rol, especialidad, activo) VALUES
      (20, 'Jefa biomédica', 'jefa.bio@example.invalid', 'x', 'jefe', 'biomedico', 1),
      (21, 'Jefe de ambas', 'jefe.ambos@example.invalid', 'x', 'jefe', 'ambos', 1),
      (22, 'Jefe sin especialidad', 'jefe.sin@example.invalid', 'x', 'jefe', NULL, 1),
      (23, 'Jefe inactivo', 'jefe.inactivo@example.invalid', 'x', 'jefe', 'biomedico', 0);
    INSERT INTO sucursales (id, nombre) VALUES (1, 'Sede Central');
    INSERT INTO ubicaciones (id, sucursal_id, nombre, tipo) VALUES (1, 1, 'UCI', 'area');
    INSERT INTO proveedores (id, nombre, activo, es_laboratorio_acreditado, acreditacion_organo, acreditacion_numero, acreditacion_vigencia) VALUES
      (1, 'Lab <Metro> & Cía', 1, 1, 'OSA', 'LC-1', '${en(45)}'),
      (2, 'Lab vencido', 1, 1, 'OSA', 'LC-2', '${en(-3)}');
    INSERT INTO activos (id, codigo, nombre, rubro, tipo, estado, ubicacion_id, clase_riesgo, registro_sanitario, registro_sanitario_vencimiento) VALUES
      (1, 'BIO-1', 'Ventilador', 'biomedico', 'biomedico', 'operativo', 1, 'III', 'RS-1', '${en(90)}'),
      (2, 'BIO-2', 'Monitor', 'biomedico', 'biomedico', 'operativo', 1, 'IIb', 'RS-2', '${en(-1)}'),
      (3, 'BIO-3', 'Bomba de baja', 'biomedico', 'biomedico', 'baja', 1, 'IIb', 'RS-3', '${en(10)}'),
      (4, 'GEN-1', 'Balanza', 'equipo_general', 'general', 'operativo', 1, NULL, NULL, NULL);
    UPDATE activos SET requiere_calibracion = 1 WHERE id = 4;
    INSERT INTO calibraciones (activo_id, fecha_calibracion, proxima_calibracion, resultado, certificado_r2_key, usuario_id) VALUES
      (1, '${en(-300)}', '${en(5)}', 'conforme', 'k', 1),
      (4, '${en(-400)}', '${en(-35)}', 'conforme', 'k', 1),
      (3, '${en(-300)}', '${en(2)}', 'conforme', 'k', 1);
    INSERT INTO licencias (entidad, tipo, nombre, numero, ambito, sucursal_id, fecha_vencimiento, estado, creado_por) VALUES
      ('srs', 'funcionamiento', 'Permiso de funcionamiento', 'PF-1', 'establecimiento', 1, '${en(80)}', 'activa', 1),
      ('srs', 'funcionamiento', 'Permiso viejo', 'PF-0', 'establecimiento', 1, '${en(-200)}', 'reemplazada', 1);
    INSERT INTO pruebas_seguridad_electrica (activo_id, fecha, tipo, clase_proteccion, inspeccion_visual, prueba_funcional, resultado_calculado, resultado, analizador_descripcion, analizador_serie, analizador_cal_vence, realizado_por, proxima_fecha, registrado_por, estado) VALUES
      (1, '${en(-360)}', 'periodica', 'I', 'conforme', 'conforme', 'pasa', 'pasa', 'ESA620', 'S-1', '${en(100)}', 'Técnico', '${en(0)}', 1, 'valida'),
      (2, '${en(-400)}', 'periodica', 'I', 'conforme', 'conforme', 'pasa', 'pasa', 'ESA620', 'S-1', '${en(100)}', 'Técnico', '${en(-30)}', 1, 'valida'),
      (2, '${en(-10)}', 'periodica', 'I', 'conforme', 'conforme', 'pasa', 'pasa', 'ESA620', 'S-1', '${en(100)}', 'Técnico', '${en(355)}', 1, 'anulada');
  `);

  // ── Datos de cumplimiento con la migración real ──
  const seccion = await D.seccionVencimientosBio(ctx, dia);
  si(seccion.includes('Equipo biomédico: vencimientos'), 'título de la sección');
  for (const titulo of ['Calibraciones (próximos 30 días)', 'Seguridad eléctrica (30 días)', 'Licencias y permisos (90 días)', 'Registros sanitarios (90 días)', 'Acreditación de laboratorios (60 días)']) {
    si(seccion.includes(titulo), `bloque «${titulo}»`);
  }
  si(seccion.includes('BIO-1 — Ventilador'), 'el equipo que vence aparece');
  si(!seccion.includes('BIO-3'), 'los equipos dados de baja no avisan');
  si(seccion.includes('(hoy)'), 'la prueba que vence hoy dice «hoy»');
  si(seccion.includes('https://app.test/activos/1#calibraciones'), 'cada línea enlaza a la ficha');
  si(seccion.includes('Lab &lt;Metro&gt; &amp; Cía'), 'el texto de la base va escapado');
  const textoSeccion = seccion.replace(/<[^>]+>/g, '');
  si(textoSeccion.includes('Ya vencidos: 1 calibración · 1 prueba · 0 licencias · 1 registro · 1 acreditación.'), 'cierre con los ya vencidos por tipo');
  si(seccion.includes('https://app.test/cumplimiento'), 'enlace al panel de cumplimiento');
  si(!seccion.includes('Permiso viejo'), 'la licencia reemplazada no cuenta');

  // ── Correo a la jefatura biomédica ──
  r = await D.enviarAvisoVencimientosBio(ctx);
  es(r.enviados, 3, 'tres jefes: biomédico, ambos y sin especialidad');
  es(enviados.map((c) => c.to).sort(), ['jefa.bio@example.invalid', 'jefe.ambos@example.invalid', 'jefe.sin@example.invalid'], 'ni el jefe general ni el inactivo');
  const [d, m, a] = [dia.slice(8, 10), dia.slice(5, 7), dia.slice(0, 4)];
  es(enviados[0].subject, `Vencimientos de equipo biomédico — ${d}/${m}/${a}`, 'asunto con la fecha de hoy');
  es([enviados[0].tipo, enviados[0].referencia], ['aviso_vencimientos_bio', `venc-bio:${dia}`], 'tipo y referencia del registro diario');
  r = await D.enviarAvisoVencimientosBio(ctx);
  es([r.enviados, r.razon], [0, `Ya se envió el aviso de hoy (${dia}).`], 'una sola vez al día');
  h.sqlite.exec("INSERT INTO usuarios (id, nombre, email, password_hash, rol, especialidad, activo) VALUES (24, 'Jefe nuevo', 'jefe.nuevo@example.invalid', 'x', 'jefe', 'biomedico', 1)");
  r = await D.enviarAvisoVencimientosBio(ctx);
  es([r.enviados, enviados.at(-1).to], [1, 'jefe.nuevo@example.invalid'], 'quien no lo recibió hoy lo recibe');
  r = await D.enviarAvisoVencimientosBio(ctx, { force: true });
  es(r.enviados, 4, 'force reenvía a todos');

  // ── Resumen diario de los admins con más de 100 órdenes cerradas en el mes ──
  // D1 acepta hasta 100 parámetros por consulta: los repuestos del mes no pueden
  // pedirse con la lista de ids de las órdenes (antes el resumen entero fallaba y
  // los admins no recibían tampoco la sección de vencimientos biomédicos).
  const limitar = (st) => ({ ...st, bind(...v) { if (v.length > 100) throw new Error(`D1: too many SQL variables (${v.length})`); return limitar(st.bind(...v)); } });
  const ctxD1 = { locals: { runtime: { env: { DB: { ...h.DB, prepare: (sql) => limitar(h.DB.prepare(sql)) }, APP_URL: 'https://app.test' } } } };
  const ahora = new Date();
  const inicioMes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1, 6, 0, 0)).toISOString();
  const orden = h.sqlite.prepare("INSERT INTO ordenes (id, titulo, estado, creado_por, created_at, cerrado_en) VALUES (?, ?, 'cerrada', 1, ?, ?)");
  for (let i = 0; i < 101; i++) orden.run(500 + i, `OT cerrada ${i}`, inicioMes, inicioMes);
  h.sqlite.exec(`
    INSERT INTO ordenes (id, titulo, estado, creado_por, created_at) VALUES (700, 'OT abierta', 'abierta', 1, '${inicioMes}');
    INSERT INTO items (id, codigo, nombre) VALUES (1, 'REP-1', 'Sensor');
    INSERT INTO orden_repuestos (orden_id, item_id, cantidad, precio_unitario) VALUES (550, 1, 2, 7.5), (700, 1, 1, 100);
  `);
  const antes = enviados.length;
  r = await D.enviarDigestDiario(ctxD1, { force: true });
  es(r.enviados, 1, 'el resumen sale con 101 órdenes cerradas en el mes (el admin)');
  const resumen = enviados.slice(antes).find((c) => c.tipo === 'digest_diario')?.html ?? '';
  si(resumen.includes('Repuestos: <strong>$15.00</strong>'), 'repuestos del mes: solo las órdenes cerradas, sin lista de ids');
  si(resumen.includes('Equipo biomédico: vencimientos'), 'y lleva la sección de vencimientos biomédicos');
  es(h.queries.filter((q) => q.columns.length > 100).length, 0, 'ninguna consulta pasa de 100 columnas');
} finally {
  await h.close();
}

console.log(`PASS test-bio-avisos: ${n} casos; sección de vencimientos, correo a la jefatura biomédica una vez al día y consultas con la migración real.`);
