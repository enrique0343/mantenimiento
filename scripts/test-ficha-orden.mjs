// La ficha web de la orden, construida de verdad, contra migraciones reales: qué ve y qué
// no ve cada rol en una emergencia (EOP) y en una intervención (MOP), y qué manda la
// pantalla al guardar, con las rutas reales detrás. Correr después de npm run build.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { experimental_AstroContainer } from 'astro/container';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const beforeMigration = (db, n) => { if (n.startsWith('0049_fase49')) db.exec("INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin')"); };
const f = await setupConjuntos({ beforeMigration });
const { app, sqlite, call, DB } = f;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
const pagina = (await import(pathToFileURL(path.join(process.cwd(), 'dist/_worker.js/pages/ordenes/_id_.astro.mjs')).href)).page().default;
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const USUARIO = { admin: 1, jefe: 2, tecnico: 3, visualizador: 4 };
const AREA = 'infraestructura';

try {
  const eop = one("SELECT id FROM procedimientos WHERE codigo_corto='EOP-ELE-01'").id;
  sqlite.exec(`
    INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(8,'Otro Técnico','otro@example.invalid','x','tecnico');
    INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede Uno',1);
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo) VALUES(1,1,'Cuarto eléctrico','area');
    INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,criticidad_operacional) VALUES(1,'ELE-PLANTA-01','Planta de emergencia','general','${AREA}',1,'alta');
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha) VALUES(1,1,'PM mensual','mensual','2026-12-01');
    INSERT INTO items(id,codigo,nombre,unidad) VALUES(1,'REP-01','Fusible 10 A','unidad');
  `);
  const orden = (id, campos) => {
    const base = { rubro: AREA, creado_por: 1, titulo: `Orden ${id}`, prioridad: 'alta', ...campos };
    const k = Object.keys(base);
    sqlite.prepare(`INSERT INTO ordenes(id,${k.join(',')}) VALUES(?,${k.map(() => '?').join(',')})`).run(id, ...k.map((c) => base[c]));
  };
  const enviada = (id) => sqlite.prepare("INSERT INTO orden_verificacion(orden_id,version,ciclo,ejecutado_por,executores_json) VALUES(?,1,1,3,'[3]')").run(id);
  const hace = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const pasos = JSON.stringify([{ texto: 'Ir al cuarto de máquinas y verificar si la planta arrancó', estado: 'ok', minutos: 15 }]);
  const CAUSA = 'Sobrecarga del breaker principal al sumar dos manejadoras nuevas.';
  // EOP en proceso, del técnico, con dos de sus horas, un repuesto y la causa raíz de la jefatura.
  orden(101, { tipo: 'emergencia', estado: 'en_proceso', activo_id: 1, asignado_a: 3, procedimiento_id: eop, clase_prioridad: 'P1', vencimiento: '2026-12-24',
    iniciada_en: hace(2), hora_alarma: hace(2.5), hora_llegada: hace(2.2), causa_raiz_vencimiento: hace(-69.5), checklist_ejecucion: pasos, causa_raiz: CAUSA });
  sqlite.exec('INSERT INTO orden_repuestos(orden_id,item_id,cantidad,precio_unitario,registrado_por) VALUES(101,1,1,2.5,3)');
  // EOP enviada a verificación sin causa raíz: la escribe la jefatura después.
  orden(102, { tipo: 'emergencia', estado: 'completada', activo_id: 1, asignado_a: 3, iniciada_en: hace(5), completada_en: hace(1), horas_trabajadas: 4,
    hora_alarma: hace(5), causa_raiz_vencimiento: hace(-67), trabajos_realizados: 'Planta en manual y transferencia operada con dos técnicos.' });
  enviada(102);
  const reqs = (id) => sqlite.prepare("INSERT INTO orden_prerrequisitos(orden_id,texto,tipo,obligatorio,cumplido,referencia) VALUES(?,'Permiso firmado','permiso_trabajo',1,1,'PT-0099')").run(id);
  const lectura = (id) => sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,obligatoria) VALUES(?,'Corriente de fase','A',8,12,1)").run(id);
  // MOP en proceso con la lectura de liberación sin medir.
  orden(103, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(3), plan_reversa: 'Volver al tablero anterior y avisar.',
    trabajos_realizados: 'Cambio del interruptor del tablero de la rama crítica.' });
  reqs(103); lectura(103);
  // MOP enviado a verificación sin lectura, con el motivo de la jefatura.
  orden(104, { tipo: 'intervencion', estado: 'completada', activo_id: 1, asignado_a: 3, iniciada_en: hace(6), completada_en: hace(1), horas_trabajadas: 5,
    trabajos_realizados: 'Cambio del interruptor del tablero de la rama crítica.', cierre_sin_lectura_por: 1, cierre_sin_lectura_en: hace(1),
    cierre_sin_lectura_motivo: 'La pinza amperimétrica calibrada se dañó en sitio; se mide el lunes con la de respaldo.' });
  reqs(104); lectura(104); enviada(104);
  orden(105, { tipo: 'emergencia', estado: 'abierta', activo_id: 1, hora_alarma: hace(0.2) });
  orden(106, { tipo: 'correctivo', estado: 'abierta', activo_id: 1, asignado_a: 8 });
  orden(107, { tipo: 'correctivo', estado: 'en_proceso', asignado_a: 3, iniciada_en: hace(1), sucursal_id: 1, ubicacion_id: 1, ubicacion_detalle: 'Junto al tablero B' });
  orden(108, { tipo: 'preventivo', estado: 'en_proceso', activo_id: 1, plan_id: 1, asignado_a: 3, iniciada_en: hace(1) });

  const container = await experimental_AstroContainer.create();
  const html = async (id, rol) => {
    const res = await container.renderToResponse(pagina, { partial: false, request: new Request(`https://local.test/ordenes/${id}?area=${AREA}`), params: { id: String(id) },
      locals: { user: { id: USUARIO[rol], nombre: `Cuenta ${rol}`, rol }, runtime: { env: { DB } } } });
    assert.equal(res.status, 200, `orden ${id} como ${rol}`);
    return res.text();
  };
  // Lo que se ve: la página sin sus scripts.
  const ver = async (id, rol) => {
    const doc = new JSDOM(await html(id, rol)).window.document;
    doc.querySelectorAll('script').forEach((s) => s.remove());
    const texto = doc.body.textContent.replace(/\s+/g, ' ');
    return { doc, texto, hay: (sel) => !!doc.querySelector(sel), boton: (s) => doc.querySelector(`[data-transition="${s}"]`) };
  };
  const tiemposDeMedicion = /Iniciada|Completada|cronómetro|Duración real|Tiempo de respuesta|Hasta la mitigación|Tiempo de reparación|Horas trabajadas|15 min/;

  // ── Emergencia en proceso ──────────────────────────────────────────────
  for (const rol of ['admin', 'jefe', 'visualizador']) {
    const v = await ver(101, rol);
    ok(/Tiempos/.test(v.texto) && /Iniciada/.test(v.texto) && /el cronómetro corre/.test(v.texto), `${rol} ve cuándo inició y el cronómetro`);
    ok(/Tiempo de respuesta/.test(v.texto) && /Hasta la mitigación/.test(v.texto) && /Tiempo de reparación/.test(v.texto), `${rol} ve las tres duraciones del EOP`);
    ok(/Horas trabajadas/.test(v.texto) && /15 min/.test(v.texto), `${rol} ve horas trabajadas y minutos estimados`);
    ok(v.hay('#horaLlegada') && v.hay('#causaRaiz'), `${rol} ve las horas del EOP y la causa raíz`);
    ok(/Causa raíz · la escribe la jefatura/.test(v.texto) && /Obligatoria para verificar y cerrar/.test(v.texto) && /Plazo: 72 h desde la alarma/.test(v.texto), `${rol}: rótulo, obligación y plazo de la causa raíz`);
    ok(!/OBLIGATORIA PARA CERRAR/.test(v.texto), `${rol}: ya no dice «obligatoria para cerrar»`);
    ok(/Vence 24\/12\/2026/.test(v.texto) && !/23\/12\/2026/.test(v.texto), `${rol}: un vencimiento solo con fecha no se corre al día anterior`);
    const jefatura = rol !== 'visualizador';
    ok(v.doc.querySelector('#causaRaiz').disabled === !jefatura, `${rol}: la causa raíz ${jefatura ? 'se escribe' : 'solo se lee'}`);
    ok(/Cambiar equipo/.test(v.texto) === jefatura && v.hay('#asignarBtn') === jefatura, `${rol}: cambiar equipo y asignación solo la jefatura`);
    ok(v.hay('.rep-del-btn') === jefatura, `${rol}: revertir repuesto solo la jefatura`);
    ok(v.hay('a[href$="/reporte"]'), `${rol} abre el reporte con sus tiempos`);
  }
  {
    const v = await ver(101, 'tecnico');
    ok(!tiemposDeMedicion.test(v.texto), `El técnico no ve tiempos de medición: ${v.texto.match(tiemposDeMedicion)?.[0]}`);
    ok(/Asignación y plazo/.test(v.texto) && /Vence 24\/12\/2026/.test(v.texto), 'El técnico sí ve el plazo');
    ok(/P1 · Emergencia · Atención inmediata/.test(v.texto), 'El técnico sí ve el plazo de la clase P1');
    ok(!v.hay('#horaAlarma') && !v.hay('#horaLlegada') && !v.hay('#horasTrabajadas') && !v.hay('#eopSave'), 'Al técnico no se le muestran las horas del EOP');
    ok(/Emergencia · pasos registrados/.test(v.texto) && /Energía de emergencia en servicio/.test(v.texto), 'El técnico ve los pasos con el rótulo de su EOP');
    const pasosEop = [...v.doc.querySelectorAll('[aria-label="Pasos de la emergencia"] li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
    ok(pasosEop.length === 3 && /Llegada al sitio Registrado/.test(pasosEop[0]) && /Pendiente/.test(pasosEop[1]) && /Pendiente/.test(pasosEop[2]), `Pasos sin horas: ${pasosEop.join(' | ')}`);
    ok(!v.hay('#causaRaiz') && /La causa raíz la escribe tu jefatura\./.test(v.texto) && !v.texto.includes(CAUSA), 'Al técnico no se le muestra el campo de causa raíz');
    ok(!/OBLIGATORIA PARA CERRAR|Obligatoria para verificar/.test(v.texto), 'Al técnico no se le exige la causa raíz');
    ok(!/Cambiar equipo/.test(v.texto) && !v.hay('#editActivoBtn') && !v.hay('#asignarBtn') && !/Guardar asignación/.test(v.texto), 'El técnico no ve cambiar equipo ni guardar asignación');
    ok(!v.hay('.rep-del-btn') && !v.hay('.firma-add-btn[data-rol="jefe"]') && v.hay('.firma-add-btn[data-rol="tecnico"]'), 'El técnico no ve lo que el servidor le rechaza: revertir repuesto, firmar como jefe');
    ok(v.hay('#trabajosRealizados') && !v.doc.querySelector('#trabajosRealizados').disabled && v.boton('completada'), 'El técnico escribe qué encontró y qué hizo y envía');
    ok(!v.hay('a[href$="/reporte"]') && !v.hay('#verifModal'), 'Sin enlace al reporte de tiempos ni verificación que no le toca');
  }

  // ── Emergencia enviada a verificación, sin causa raíz ──────────────────
  for (const rol of ['admin', 'jefe']) {
    const v = await ver(102, rol);
    const causa = v.doc.querySelector('#causaRaiz');
    ok(causa && !causa.disabled && /aunque la orden ya esté enviada o cerrada/.test(v.texto), `${rol} escribe la causa raíz con la orden enviada`);
    ok(!v.hay('#asignarBtn') && !/Cambiar equipo/.test(v.texto), `${rol}: enviada, ya no se cambia equipo ni asignación`);
  }
  {
    const v = await ver(102, 'tecnico');
    ok(!v.hay('#causaRaiz') && !tiemposDeMedicion.test(v.texto) && !/4\.00 h|Registradas/.test(v.texto), 'Enviada, el técnico tampoco ve causa raíz ni tiempos');
  }

  // ── Intervención en proceso con la lectura sin medir ───────────────────
  {
    const v = await ver(103, 'jefe');
    ok(v.hay('#sinLecturaBtn') && /Enviar a verificación sin lectura/.test(v.doc.querySelector('#sinLecturaBtn').textContent), 'La jefatura ve «Enviar a verificación sin lectura»');
    ok(!/Cerrar sin lectura|Cerrada sin lectura|Cerrar la OT sin lectura/.test(v.texto), 'Nadie le dice que la cierra');
    ok(/La orden no se cierra: queda pendiente de verificación/.test(v.doc.querySelector('#sinLecturaModal').textContent.replace(/\s+/g, ' ')), 'El aviso dice que queda pendiente de verificación');
    ok(v.boton('completada')?.disabled === true && /faltan lecturas de liberación/.test(v.texto), 'Enviar sin la lectura va bloqueado y dice por qué');
  }
  {
    const v = await ver(103, 'tecnico');
    ok(!v.hay('#sinLecturaBtn') && /pide a tu jefatura que la envíe a verificación sin lectura/.test(v.texto), 'El técnico no ve el escape: se lo pide a la jefatura');
    ok(!v.doc.querySelector('.liber-valor').disabled && !v.doc.querySelector('#reversaEjecutada').disabled, 'El técnico asignado registra la lectura y la reversa');
  }

  // ── Intervención enviada sin lectura ───────────────────────────────────
  {
    const v = await ver(104, 'jefe');
    ok(/Enviada a verificación sin lectura de liberación\.[^.]*· Pendiente de verificación\./.test(v.texto), 'La tarjeta dice la verdad: enviada, no cerrada');
    ok(v.hay('#verifSinLecturaRegistrado') && !v.hay('#verifSinLecturaMotivo'), 'La verificación no vuelve a pedir el motivo');
    ok(v.boton('verificada') && !v.doc.querySelector('#verifConfirm').disabled, 'La jefatura puede verificarla');
    const t = await ver(104, 'tecnico');
    ok(t.hay('.liber-valor') && t.doc.querySelector('.liber-valor').disabled, 'Enviada, el técnico ya no registra lecturas');
  }

  // ── Abierta sin asignar, ajena y sin equipo ────────────────────────────
  {
    const t = await ver(105, 'tecnico');
    ok(/pulsa «Iniciar» para desbloquear/.test(t.texto) && !/cronómetro/.test(t.texto), 'Al técnico no se le habla del cronómetro');
    ok(t.hay('#tomarOrdenBtn') && !t.hay('#asignarBtn'), 'Sin asignar, el técnico puede tomarla, nada más');
    const a = await ver(105, 'admin');
    ok(/para activar el cronómetro/.test(a.texto) && !a.hay('#tomarOrdenBtn'), 'La jefatura sigue viendo el aviso del cronómetro');
    const otra = await ver(106, 'tecnico');
    ok(!otra.hay('[data-transition]') && /Está asignada a Otro Técnico/.test(otra.texto) && !otra.hay('#asignarBtn') && !otra.hay('#tomarOrdenBtn') && !/Cambiar equipo/.test(otra.texto), 'Orden de otro técnico: nada que el servidor le rechace');
    const sinEq = await ver(107, 'tecnico');
    ok(/Lugar a intervenir \(sin equipo\)/.test(sinEq.texto) && /Sede Uno/.test(sinEq.texto) && /Junto al tablero B/.test(sinEq.texto) && !sinEq.hay('#editActivoBtn'), 'Sin equipo, el técnico ve dónde es, sin «Asignar equipo»');
    ok((await ver(107, 'admin')).hay('#editActivoBtn'), 'La jefatura asigna equipo a una orden sin equipo');
    ok(!/Cambiar equipo/.test((await ver(108, 'admin')).texto), 'Una orden de PM no ofrece cambiar el equipo');
  }

  // ── Lo que manda la pantalla, con las rutas reales detrás ──────────────
  const abrir = async (id, rol) => {
    const enviados = [], avisos = [], errores = [];
    const consola = new VirtualConsole();
    consola.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message) && !/getContext|fillStyle/.test(String(e.detail?.stack ?? e.stack ?? e.message))) errores.push(e.detail?.message ?? e.message); });
    const dom = new JSDOM(await html(id, rol), {
      url: `https://local.test/ordenes/${id}?area=${AREA}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: consola,
      beforeParse(w) {
        w.alert = (m) => avisos.push(m); w.confirm = () => true; w.prompt = () => null;
        w.fetch = async (url, init = {}) => {
          const u = new URL(url, 'https://local.test');
          const data = init.body ? JSON.parse(init.body) : undefined;
          enviados.push({ metodo: init.method ?? 'GET', ruta: u.pathname, data, keepalive: !!init.keepalive });
          const m = u.pathname.match(/^\/api\/ordenes\/(\d+)$/);
          const r = m && init.method === 'PATCH' ? await call(app.order.PATCH, u.pathname, { method: 'PATCH', id: Number(m[1]), data, rol }) : { status: 200, body: {} };
          return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
        };
      },
    });
    const w = dom.window;
    const hasta = async (fn, msg) => { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)); } assert.fail(`${msg} · enviados: ${JSON.stringify(enviados)} · avisos: ${avisos.join(' | ')}`); };
    const escribir = (sel, valor) => { const el = w.document.querySelector(sel); el.value = valor; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
    return { w, doc: w.document, enviados, avisos, errores, hasta, escribir };
  };

  { // Lo que guarda el técnico nunca borra la causa raíz de la jefatura.
    const p = await abrir(101, 'tecnico');
    p.escribir('#trabajosRealizados', 'Planta en manual; transferencia operada con un segundo técnico.');
    p.doc.querySelector('#ejecSave').click();
    await p.hasta(() => p.enviados.some((e) => e.metodo === 'PATCH'), 'el técnico guarda');
    const envio = p.enviados.find((e) => e.metodo === 'PATCH').data;
    ok(envio.trabajosRealizados && !('causaRaiz' in envio), `El guardado del técnico no lleva causa raíz: ${JSON.stringify(envio)}`);
    await p.hasta(() => /Guardado/.test(p.doc.querySelector('#autosaveIndicador').textContent), 'el servidor acepta lo del técnico');
    ok(one('SELECT causa_raiz FROM ordenes WHERE id=101').causa_raiz === CAUSA, 'La causa raíz de la jefatura sigue intacta');
    ok(p.errores.length === 0, `Sin errores de script: ${p.errores.join(' | ')}`);
    p.w.close();
  }
  { // Lo pendiente sale al servidor aunque el técnico se vaya de la página antes de tiempo.
    const p = await abrir(101, 'tecnico');
    p.escribir('#trabajosRealizados', 'Transferencia en manual; queda pendiente el ajuste del retardo.');
    p.doc.querySelector('.ck-estado-btn[data-estado="na"]').click();
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await p.hasta(() => p.enviados.some((e) => e.metodo === 'PATCH'), 'sale al servidor al irse');
    const envio = p.enviados.find((e) => e.metodo === 'PATCH');
    ok(envio.keepalive && /retardo/.test(envio.data.trabajosRealizados) && JSON.parse(envio.data.checklistEjecucion)[0].estado === 'na' && !('causaRaiz' in envio.data), `Al irse manda lo escrito y lo marcado: ${JSON.stringify(envio)}`);
    await p.hasta(() => /retardo/.test(one('SELECT trabajos_realizados t FROM ordenes WHERE id=101').t ?? ''), 'el servidor lo guarda');
    ok(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=101').c)[0].estado === 'na' && one('SELECT causa_raiz FROM ordenes WHERE id=101').causa_raiz === CAUSA, 'Queda guardado y la causa raíz sigue intacta');
    p.w.close();
  }
  { // Verificar exige la causa raíz; la jefatura la escribe con la orden enviada.
    const p = await abrir(102, 'jefe');
    p.doc.querySelector('[data-transition="verificada"]').click();
    await p.hasta(() => /Falta la causa raíz/.test(p.doc.querySelector('#causaMsg').textContent), 'pide la causa antes de verificar');
    ok(p.doc.querySelector('#verifModal').classList.contains('hidden'), 'Sin causa raíz no se abre la verificación');
    p.escribir('#causaRaiz', 'La transferencia automática quedó en manual tras el último mantenimiento.');
    p.doc.querySelector('#causaSave').click();
    await p.hasta(() => /Guardada/.test(p.doc.querySelector('#causaMsg').textContent), 'la causa raíz se guarda');
    const envio = p.enviados.filter((e) => e.metodo === 'PATCH');
    ok(envio.length === 1 && JSON.stringify(Object.keys(envio[0].data)) === '["causaRaiz"]', `La causa raíz viaja sola: ${JSON.stringify(envio)}`);
    const o = one('SELECT estado, causa_raiz FROM ordenes WHERE id=102');
    ok(o.estado === 'completada' && /transferencia automática/.test(o.causa_raiz), 'Queda escrita y la orden sigue pendiente de verificación');
    p.doc.querySelector('[data-transition="verificada"]').click();
    await p.hasta(() => !p.doc.querySelector('#verifModal').classList.contains('hidden'), 'con causa raíz se abre la verificación');
    ok(p.errores.length === 0, `Sin errores de script: ${p.errores.join(' | ')}`);
    p.w.close();
  }
  { // La jefatura envía el MOP sin lectura: queda pendiente de verificación, no cerrado.
    const p = await abrir(103, 'jefe');
    p.doc.querySelector('#sinLecturaBtn').click();
    p.doc.querySelector('#sinLecturaMotivo').value = 'La pinza calibrada no estaba disponible; se mide el lunes.';
    p.doc.querySelector('#sinLecturaConfirm').click();
    await p.hasta(() => p.enviados.some((e) => e.metodo === 'PATCH'), 'envía sin lectura');
    const envio = p.enviados.find((e) => e.metodo === 'PATCH').data;
    ok(envio.estado === 'completada' && /pinza calibrada/.test(envio.cierreSinLecturaMotivo) && 'trabajosRealizados' in envio, `Envío con motivo y lo escrito: ${JSON.stringify(envio)}`);
    await p.hasta(() => one('SELECT estado FROM ordenes WHERE id=103').estado === 'completada', 'el servidor la deja pendiente de verificación');
    ok(one('SELECT cierre_sin_lectura_motivo m FROM ordenes WHERE id=103').m.includes('pinza calibrada') && !p.avisos.length, 'Queda el motivo, sin errores');
    p.w.close();
  }
  { // Verificar un MOP enviado sin lectura no vuelve a pedir ni mandar el motivo.
    const p = await abrir(104, 'jefe');
    p.doc.querySelector('[data-transition="verificada"]').click();
    await p.hasta(() => !p.doc.querySelector('#verifModal').classList.contains('hidden'), 'abre la verificación');
    p.doc.querySelector('#verifNotas').value = 'Revisé el cambio del interruptor y el motivo de la lectura pendiente.';
    p.doc.querySelector('#verifConfirm').click();
    await p.hasta(() => p.enviados.some((e) => e.metodo === 'PATCH'), 'verifica');
    const envio = p.enviados.find((e) => e.metodo === 'PATCH').data;
    ok(envio.estado === 'verificada' && !('cierreSinLecturaMotivo' in envio), `La verificación no reenvía el motivo: ${JSON.stringify(envio)}`);
    await p.hasta(() => one('SELECT estado FROM ordenes WHERE id=104').estado === 'cerrada', `el servidor la cierra (avisos: ${p.avisos.join(' | ')})`);
    ok(one('SELECT cierre_sin_lectura_por p FROM ordenes WHERE id=104').p === 1, 'El motivo sigue firmado por quien lo escribió, no por quien verifica');
    p.w.close();
  }
  { // Cerrada, la jefatura aún escribe la causa raíz; el técnico sigue sin verla.
    const v = await ver(104, 'admin');
    ok(v.hay('#causaRaiz') && !v.doc.querySelector('#causaRaiz').disabled, 'Con la orden cerrada la causa raíz se sigue escribiendo');
    ok(!(await ver(104, 'tecnico')).hay('#causaRaiz'), 'Cerrada, el técnico tampoco ve la causa raíz');
  }
  console.log(`PASS test-ficha-orden: ${checks} verificaciones; ficha construida, migraciones reales, admin, jefe, técnico y visualizador.`);
} finally { await f.close(); }
