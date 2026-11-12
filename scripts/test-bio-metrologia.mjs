// Fase 59 · WP-B · Metrología: reglas de src/lib/metrologia.ts (filtros, resumen,
// validación, advertencias, acreditación, viñetas, CSV) y las APIs de Calibraciones y
// Proveedores contra una base con todas las migraciones reales (sin red, sin R2 real).
// Lo de biomedico.ts (estado de calibración, patrón vigente, acreditación) lo prueba BASE.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const empaquetar = async (archivo) => {
  const out = await build({ entryPoints: [archivo], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};
const B = await empaquetar('src/lib/biomedico.ts');
const M = await empaquetar('src/lib/metrologia.ts');

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const si = (r, nota) => { n++; assert.equal(r, true, nota); };
const no = (r, nota) => { n++; assert.equal(r, false, nota); };

// ── 8. Filtros de la URL ─────────────────────────────────────────────────────
const qs = (s) => new URLSearchParams(s);
const completo = { sede: 3, area: 'biomedico', subcategoria: 'soporte_vida', criticidad: 'alta', clase: 'III', estado: 'vencida', criticos: true };
es(M.leerFiltrosCal(qs('sede=3&area=biomedico&subcategoria=soporte_vida&criticidad=alta&clase=III&estado=vencida&criticos=1')), completo, 'filtros válidos');
es(M.leerFiltrosCal(qs('sede=abc&area=otras&subcategoria=x&criticidad=extrema&clase=IV&estado=raro&criticos=si')), M.FILTROS_CAL_VACIOS, 'desconocidos → null');
es(M.leerFiltrosCal(qs('')), M.FILTROS_CAL_VACIOS, 'sin filtros');
es(M.leerFiltrosCal(qs('sede=0')).sede, null, 'sede 0');
es(M.leerFiltrosCal(qs('sede=-2')).sede, null, 'sede negativa');
es(M.leerFiltrosCal(qs('area=general')).area, null, '«general» no es un área de la URL');
es(M.leerFiltrosCal(qs('area=equipo_general')).area, 'equipo_general', 'otra área');
const sinSin = M.leerFiltrosCal(qs('subcategoria=sin&clase=sin&estado=al_dia'));
es([sinSin.subcategoria, sinSin.clase, sinSin.estado], ['sin', 'sin', 'al_dia'], '«sin» y al día');
es(M.leerFiltrosCal(qs('estado=pendientes')).estado, 'pendientes', 'pendientes');
es(M.leerFiltrosCal(qs('estado=no_aplica')).estado, 'no_aplica', 'no requiere');
es(M.leerFiltrosCal(qs(M.queryFiltrosCal(completo))), completo, 'ida y vuelta');
es(M.leerFiltrosCal(qs(M.queryFiltrosCal(sinSin))), sinSin, 'ida y vuelta con «sin»');
es(M.queryFiltrosCal(M.FILTROS_CAL_VACIOS), '', 'vacío sin parámetros');
es(M.queryFiltrosCal({ ...M.FILTROS_CAL_VACIOS, criticos: true }), 'criticos=1', 'solo críticos');
es(M.describirFiltrosCal(M.FILTROS_CAL_VACIOS, null), 'Todos los equipos que requieren calibración', 'sin filtros');
es(M.describirFiltrosCal(completo, 'Central'), 'Sede: Central · Área: Equipos biomédicos · Subcategoría: Soporte de vida · Criticidad: Alta · Clase: III · Estado: Vencida · Solo críticos', 'todos los filtros');
es(M.describirFiltrosCal(sinSin, null), 'Subcategoría: Sin segmentar · Clase: Sin clasificar · Estado: Al día', '«sin» en palabras');
es(M.AREAS_CAL.map((a) => a.etiqueta), ['Equipos biomédicos', 'Equipos generales', 'Aire acondicionado', 'Infraestructura'], 'áreas del select');

// ── 9. pasaFiltrosCal ────────────────────────────────────────────────────────
const fila = (o = {}) => ({ sedeId: 1, area: 'biomedico', subcategoria: 'soporte_vida', criticidad: 'alta', clase: 'III', motivos: ['soporte_vida'], estado: 'vigente', ...o });
const F = (o = {}) => ({ ...M.FILTROS_CAL_VACIOS, ...o });
si(M.pasaFiltrosCal(fila(), F()), 'sin filtros pasa');
no(M.pasaFiltrosCal(fila({ estado: 'no_aplica' }), F()), 'estado nulo oculta «No requiere»');
si(M.pasaFiltrosCal(fila({ estado: 'no_aplica' }), F(), true), 'ignorarEstado deja «No requiere» (para contarlo)');
si(M.pasaFiltrosCal(fila({ estado: 'no_aplica' }), F({ estado: 'no_aplica' })), 'filtro «No requiere»');
no(M.pasaFiltrosCal(fila(), F({ sede: 2 })), 'otra sede');
no(M.pasaFiltrosCal(fila({ sedeId: null }), F({ sede: 1 })), 'sin sede no pasa una sede');
no(M.pasaFiltrosCal(fila({ area: 'aires' }), F({ area: 'biomedico' })), 'otra área');
si(M.pasaFiltrosCal(fila({ subcategoria: null }), F({ subcategoria: 'sin' })), 'sin segmentar');
no(M.pasaFiltrosCal(fila(), F({ subcategoria: 'sin' })), 'segmentado no pasa «sin»');
no(M.pasaFiltrosCal(fila(), F({ subcategoria: 'diagnostico' })), 'otra subcategoría');
no(M.pasaFiltrosCal(fila({ criticidad: 'media' }), F({ criticidad: 'alta' })), 'otra criticidad');
si(M.pasaFiltrosCal(fila({ clase: null }), F({ clase: 'sin' })), 'sin clase');
no(M.pasaFiltrosCal(fila({ clase: 'IIa' }), F({ clase: 'III' })), 'otra clase');
no(M.pasaFiltrosCal(fila({ motivos: [] }), F({ criticos: true })), 'no crítico');
si(M.pasaFiltrosCal(fila(), F({ criticos: true })), 'crítico');
si(M.pasaFiltrosCal(fila({ estado: 'por_vencer' }), F({ estado: 'al_dia' })), 'por vencer está al día');
no(M.pasaFiltrosCal(fila({ estado: 'sin_certificado' }), F({ estado: 'al_dia' })), 'sin certificado no está al día');
si(M.pasaFiltrosCal(fila({ estado: 'sin_certificado' }), F({ estado: 'pendientes' })), 'sin certificado está pendiente');
no(M.pasaFiltrosCal(fila({ estado: 'no_aplica' }), F({ estado: 'pendientes' })), '«No requiere» no está pendiente');
no(M.pasaFiltrosCal(fila({ estado: 'vigente' }), F({ estado: 'pendientes' })), 'vigente no está pendiente');
no(M.pasaFiltrosCal(fila({ estado: 'vigente' }), F({ estado: 'vencida' })), 'estado exacto');
si(M.pasaFiltrosCal(fila({ estado: 'vigente' }), F({ estado: 'vencida' }), true), 'ignorarEstado');

// ── 10. Orden y resumen ──────────────────────────────────────────────────────
const orden = M.ordenarFilasCal([
  { codigo: 'BIO-10', estado: 'vigente', proxima: '2027-05-01' },
  { codigo: 'BIO-3', estado: 'por_vencer', proxima: '2026-12-01' },
  { codigo: 'BIO-2', estado: 'por_vencer', proxima: '2026-12-01' },
  { codigo: 'BIO-1', estado: 'por_vencer', proxima: '2026-11-20' },
  { codigo: 'BIO-7', estado: 'sin_calibracion', proxima: null },
  { codigo: 'BIO-5', estado: 'vencida', proxima: null },
  { codigo: 'BIO-6', estado: 'vencida', proxima: '2026-10-01' },
  { codigo: 'BIO-8', estado: 'no_aplica', proxima: null },
  { codigo: 'BIO-9', estado: 'no_conforme', proxima: null },
  { codigo: 'BIO-4', estado: 'sin_certificado', proxima: '2027-01-01' },
]).map((f) => f.codigo);
es(orden, ['BIO-6', 'BIO-5', 'BIO-9', 'BIO-4', 'BIO-7', 'BIO-1', 'BIO-2', 'BIO-3', 'BIO-10', 'BIO-8'], 'gravedad, próxima (vacías al final), código natural');
const r0 = M.resumenCal([]);
es([r0.total, r0.alDia, r0.pct, r0.noAplica], [0, 0, 0, 0], 'sin equipos: 0 %');
const r1 = M.resumenCal(['vigente', 'por_vencer', 'vencida', 'no_aplica', 'sin_certificado', 'no_aplica'].map((estado) => ({ estado })));
es([r1.total, r1.alDia, r1.pct, r1.noAplica, r1.porEstado.vencida, r1.porEstado.sin_certificado], [4, 2, 50, 2, 1, 1], '«No requiere» fuera del total');
es(M.resumenCal(['vigente', 'vencida', 'vencida'].map((estado) => ({ estado }))).pct, 33, 'redondeo');

// ── 11. leerDatosCalibracion ─────────────────────────────────────────────────
const camposVacios = { fechaCalibracion: null, proximaCalibracion: null, laboratorioId: null, laboratorioExterno: null, numeroCertificado: null, patronActivoId: null, patronReferencia: null, resultado: 'conforme', incertidumbre: null, realizadoPor: null, notas: null };
es(M.leerDatosCalibracion({
  fechaCalibracion: ' 2026-05-10 ', proximaCalibracion: '', laboratorioId: '3', laboratorioExterno: '   ', numeroCertificado: 'C-1',
  patronActivoId: 7, patronReferencia: null, incertidumbre: '±0,5 °C', realizadoPor: 'Lab', notas: '',
}), { ...camposVacios, fechaCalibracion: '2026-05-10', laboratorioId: 3, numeroCertificado: 'C-1', patronActivoId: 7, incertidumbre: '±0,5 °C', realizadoPor: 'Lab' }, 'objeto: recorta, vacíos a null, ids a número, resultado por defecto');
es(M.leerDatosCalibracion({}), camposVacios, 'objeto vacío');
es(M.leerDatosCalibracion({ fechaCalibracion: '10/05/2026', proximaCalibracion: '9/5/2027' }).proximaCalibracion, '2027-05-09', 'DD/MM/AAAA a AAAA-MM-DD');
es(M.leerDatosCalibracion({ fechaCalibracion: '31/02/2026' }).fechaCalibracion, '31/02/2026', 'fecha imposible queda tal cual (la rechaza la validación)');
es([M.leerDatosCalibracion({ laboratorioId: 'abc' }).laboratorioId, M.leerDatosCalibracion({ laboratorioId: '0' }).laboratorioId, M.leerDatosCalibracion({ laboratorioId: -1 }).laboratorioId, M.leerDatosCalibracion({ laboratorioId: 2.5 }).laboratorioId], [null, null, null, null], 'ids no válidos');
es(M.leerDatosCalibracion({ resultado: 'no_conforme', notas: ' falla ' }).notas, 'falla', 'notas recortadas');
const fd = new FormData();
fd.set('fechaCalibracion', '2026-05-10'); fd.set('proximaCalibracion', '2027-05-10'); fd.set('laboratorioId', '');
fd.set('laboratorioExterno', ' Lab externo '); fd.set('patronActivoId', '12'); fd.set('resultado', 'conforme_con_ajuste');
fd.set('notas', 'Se ajustó el cero'); fd.set('file', new File([new Uint8Array([1])], 'cert.pdf'));
es(M.leerDatosCalibracion(fd), { ...camposVacios, fechaCalibracion: '2026-05-10', proximaCalibracion: '2027-05-10', laboratorioExterno: 'Lab externo', patronActivoId: 12, resultado: 'conforme_con_ajuste', notas: 'Se ajustó el cero' }, 'FormData');
es(M.leerDatosCalibracion({ numeroCertificado: 'X-2', motivo: '  corrige el número  ' }, true), { numeroCertificado: 'X-2', motivo: 'corrige el número' }, 'parcial: solo lo que vino');
const fdParcial = new FormData();
fdParcial.set('notas', ''); fdParcial.set('motivo', 'Cambio de notas pedido');
es(M.leerDatosCalibracion(fdParcial, true), { notas: null, motivo: 'Cambio de notas pedido' }, 'parcial con FormData: vacío presente → null');
es(M.leerDatosCalibracion({ resultado: '' }, true), { resultado: '' }, 'parcial: resultado vacío se rechaza después');

// ── 12. validarCalibracion ───────────────────────────────────────────────────
const HOY = '2026-11-12';
const dv = { ...camposVacios, fechaCalibracion: '2026-05-10', proximaCalibracion: '2027-05-10', laboratorioId: 3, numeroCertificado: 'C-1' };
const cv = { hoy: HOY, equipo: { id: 1, estado: 'operativo', calibracionNoAplica: false }, patronValido: null };
const val = (d = {}, c = {}) => M.validarCalibracion({ ...dv, ...d }, { ...cv, ...c, equipo: { ...cv.equipo, ...(c.equipo ?? {}) } });
const MC = M.MENSAJES_CAL;
es(val(), null, 'calibración válida');
es(val({}, { equipo: { estado: 'baja' } }), 'El equipo está dado de baja: no se registran calibraciones.', '1 baja');
es(val({}, { equipo: { calibracionNoAplica: true } }), 'Este equipo está marcado «No requiere calibración». Quita la marca en Calibraciones antes de registrar.', '2 no requiere');
es(val({}, { equipo: { estado: 'baja', calibracionNoAplica: true }, correccion: true }), null, 'al corregir no se revisan baja ni «no requiere»');
es(val({ resultado: 'regular' }), MC.resultado, 'resultado fuera de la lista');
es(val({ fechaCalibracion: null }), 'Escribe la fecha de calibración.', '3 sin fecha');
es(val({ fechaCalibracion: '31/02/2026' }), MC.fecha, '3 fecha imposible');
es(val({ fechaCalibracion: '2026-11-13' }), 'La fecha de calibración no puede ser posterior a hoy.', '4 fecha futura');
es(val({ fechaCalibracion: HOY, proximaCalibracion: '2027-11-12' }), null, 'hoy vale');
es(val({ proximaCalibracion: null }), 'Escribe la fecha de la próxima calibración.', '5 sin próxima');
es(val({ proximaCalibracion: 'pronto', resultado: 'no_conforme', notas: 'x' }), MC.proxima, '5 próxima ilegible aunque sea no conforme');
es(val({ proximaCalibracion: '2026-05-10' }), 'La próxima calibración debe ser posterior a la fecha de calibración.', '6 próxima igual a la fecha');
es(val({ proximaCalibracion: '2026-05-01' }), MC.proximaAntes, '6 próxima antes');
es(val({ proximaCalibracion: '2031-05-11' }), 'La próxima calibración no puede pasar de 5 años después de la calibración.', '7 más de 5 años');
es(val({ proximaCalibracion: '2031-05-10' }), null, '7 cinco años justos');
es(val({ laboratorioId: null }), 'Elige el laboratorio de la lista o escribe su nombre.', '8 sin laboratorio');
es(val({ laboratorioId: null, laboratorioExterno: 'Lab X' }), null, '8 laboratorio escrito');
es(val({ resultado: 'no_conforme', proximaCalibracion: null }), 'Describe en las notas el ajuste o la falla.', '9 no conforme sin notas');
es(val({ resultado: 'conforme_con_ajuste' }), MC.notas, '9 conforme con ajuste sin notas');
es(val({ patronActivoId: 1 }, { patronValido: false }), 'Un equipo no puede ser su propio patrón.', '10 su propio patrón');
es(val({ patronActivoId: 9 }, { patronValido: false }), 'El patrón elegido no está en la lista de equipos patrón.', '11 patrón fuera de la lista');
es(val({ patronActivoId: 9 }, { patronValido: true }), null, 'patrón de la lista');
es(val({ resultado: 'no_conforme', proximaCalibracion: null, notas: 'Error fuera de tolerancia' }), null, 'no conforme sin próxima, con nota');
es(M.errorMotivo('', 'Falta'), 'Falta', 'motivo vacío');
es(M.errorMotivo('corto', 'Falta'), 'Falta', 'motivo corto');
es(M.errorMotivo('  diez letras  ', 'Falta'), null, '10 letras');
es(M.errorMotivo('x'.repeat(501), 'Falta'), 'El motivo es muy largo (máx. 500 caracteres).', 'motivo largo');
es(M.errorMotivo('x'.repeat(301), 'Falta', 300), 'El motivo es muy largo (máx. 300 caracteres).', 'máximo propio');

// ── 13. Laboratorio: copia de la acreditación y advertencias ─────────────────
const labOk = { nombre: 'Lab Ávila', esLaboratorioAcreditado: true, acreditacionOrgano: 'OSA', acreditacionNumero: 'LC-012', acreditacionVigencia: '2027-01-31' };
const labNo = { nombre: 'Beta', esLaboratorioAcreditado: false, acreditacionOrgano: null, acreditacionNumero: null, acreditacionVigencia: null };
es(M.snapshotLaboratorio(null, '2026-05-10'), { labAcreditado: null, labAcreditacionRef: null }, 'escrito a mano: no consta');
es(M.snapshotLaboratorio(labOk, '2026-05-10'), { labAcreditado: true, labAcreditacionRef: 'OSA · N.º LC-012 · vigente hasta 31/01/2027' }, 'acreditado en la fecha');
es(M.snapshotLaboratorio(labOk, '2027-02-01'), { labAcreditado: false, labAcreditacionRef: 'OSA · N.º LC-012 · vigente hasta 31/01/2027' }, 'vencido en la fecha');
es(M.snapshotLaboratorio(labNo, '2026-05-10'), { labAcreditado: false, labAcreditacionRef: 'No acreditado' }, 'no acreditado');
const patronOk = { codigo: 'ANA-1', calibs: [{ id: 1, fechaCalibracion: '2026-01-10', proximaCalibracion: '2027-01-10', resultado: 'conforme', certificadoR2Key: 'k' }] };
const adv = (o = {}) => M.advertenciasCalibracion({ fecha: '2026-05-10', lab: labOk, externo: null, patron: patronOk, patronTexto: null, tieneArchivo: true, numeroCertificado: 'C-1', ...o });
es(adv(), [], 'todo en orden: sin avisos');
es(adv({ lab: labNo }), ['El laboratorio elegido no está acreditado. La calibración queda como «laboratorio no acreditado».'], 'laboratorio no acreditado');
es(adv({ fecha: '2027-02-01' }), ['La acreditación del laboratorio no estaba vigente el 01/02/2027.', 'El patrón ANA-1 no tenía calibración vigente el 01/02/2027.'], 'acreditación y patrón vencidos en la fecha');
es(adv({ lab: { ...labOk, acreditacionVigencia: null } }), ['La acreditación del laboratorio no estaba vigente el 10/05/2026.'], 'acreditado sin vigencia');
es(adv({ lab: null, externo: 'Lab X' }), ['Laboratorio escrito a mano: no se puede comprobar su acreditación.'], 'externo');
es(adv({ patron: { codigo: 'ANA-1', calibs: [] } }), ['El patrón ANA-1 no tenía calibración vigente el 10/05/2026.'], 'patrón sin calibración');
es(adv({ patron: null, patronTexto: 'Trazable a CENAM' }), [], 'patrón escrito');
es(adv({ patron: null }), ['No se indicó el patrón usado.'], 'sin patrón');
es(adv({ tieneArchivo: false }), ['Falta adjuntar el certificado: el equipo quedará «Sin certificado» hasta que se suba.'], 'sin archivo');
es(adv({ numeroCertificado: null }), ['Falta el número de certificado.'], 'sin número');
es(adv({ lab: null, externo: 'X', patron: null, tieneArchivo: false, numeroCertificado: null }).length, 4, 'varios avisos juntos');

// ── Acreditación y datos del proveedor ───────────────────────────────────────
const acr = (o = {}) => M.validarAcreditacion({ esLaboratorioAcreditado: true, acreditacionOrgano: 'OSA', acreditacionNumero: 'LC-1', acreditacionVigencia: '2027-01-31', ...o });
es(acr(), null, 'acreditación completa');
es(acr({ acreditacionNumero: ' ' }), 'Para un laboratorio acreditado escribe el órgano, el número y la vigencia.', 'sin número');
es(acr({ acreditacionOrgano: null }), 'Para un laboratorio acreditado escribe el órgano, el número y la vigencia.', 'sin órgano');
es(acr({ acreditacionVigencia: null }), 'Para un laboratorio acreditado escribe el órgano, el número y la vigencia.', 'sin vigencia');
es(acr({ acreditacionVigencia: '2027-02-30' }), 'La vigencia de la acreditación no es una fecha válida.', 'vigencia imposible');
es(M.validarAcreditacion({ esLaboratorioAcreditado: false, acreditacionOrgano: null, acreditacionNumero: null, acreditacionVigencia: null }), null, 'no acreditado no pide nada');
const prov = (b, p = false) => M.leerDatosProveedor(b, p);
es(prov({}), { ok: false, error: 'Escribe el nombre del proveedor.' }, 'sin nombre');
es(prov({ nombre: '  Lab Ávila  ', nit: '', email: 'lab@avila.com.sv', acreditacionVigencia: '31/01/2027', esLaboratorioAcreditado: true }), {
  ok: true, datos: { nombre: 'Lab Ávila', nit: null, contacto: null, telefono: null, notas: null, acreditacionOrgano: null, acreditacionNumero: null, acreditacionAlcance: null, email: 'lab@avila.com.sv', esLaboratorioAcreditado: true, acreditacionVigencia: '2027-01-31' },
}, 'alta con vigencia DD/MM/AAAA');
es(prov({ nombre: 'X', email: 'no-es-correo' }), { ok: false, error: 'El email no es válido.' }, 'email');
es(prov({ nombre: 'X', nit: '1'.repeat(41) }), { ok: false, error: 'El NIT es muy largo (máx. 40 caracteres).' }, 'NIT largo');
es(prov({ nombre: 'X', acreditacionVigencia: '2027-13-01' }), { ok: false, error: 'La vigencia de la acreditación no es una fecha válida.' }, 'vigencia mala');
es(prov({ activo: false }, true), { ok: true, datos: { activo: false } }, 'parcial: solo activo');
es(prov({ esLaboratorioAcreditado: 'tal vez' }, true), { ok: false, error: 'Datos no válidos.' }, 'booleano raro');
es(prov({ nombre: '' }, true), { ok: false, error: 'Escribe el nombre del proveedor.' }, 'parcial no deja nombre vacío');

// ── 14. Viñetas ──────────────────────────────────────────────────────────────
const items = Array.from({ length: 20 }, (_, i) => i + 1);
es(M.paginarVinetas(items).map((h) => h.length), [18, 2], '20 → 18 + 2');
const conHuecos = M.paginarVinetas(items, 18, 5);
es(conHuecos[0].slice(0, 5), [null, null, null, null, null], 'saltar 5: cinco huecos');
es(conHuecos[0].slice(5), items.slice(0, 13), '… y 13 viñetas');
es(conHuecos[1], items.slice(13), 'la segunda hoja sigue sin rellenar');
es(M.paginarVinetas(items, 18, 40).map((h) => h.length), [18, 18, 1], 'saltar 40 se recorta a 17 (17 huecos + 20 = 37)');
es(M.paginarVinetas(items, 18, 40)[0].filter((x) => x === null).length, 17, '17 huecos');
es(M.paginarVinetas(items, 18, -3).map((h) => h.length), [18, 2], 'saltar negativo = 0');
es(M.paginarVinetas([], 18, 5), [], 'sin viñetas no hay hojas');
es(['vigente', 'por_vencer', 'vencida', 'no_conforme', 'sin_certificado', 'sin_calibracion', 'no_aplica'].map(M.tituloVineta),
  ['Calibrado', 'Calibrado', 'Calibración vencida', 'No conforme', 'Certificado pendiente', '', ''], 'título por estado');

// ── Textos ───────────────────────────────────────────────────────────────────
es([M.siNo(true), M.siNo(false), M.siNo(null), M.siNo(undefined), M.siNo(null, '')], ['Sí', 'No', 'No consta', 'No consta', ''], 'siNo');
es([true, false, null].map(M.etiquetaLabAcreditado), ['Acreditado', 'No acreditado', 'No consta'], 'copia de la acreditación');
es(M.marcaSV('2026-11-12 15:30:00'), '2026-11-12 09:30', 'marca SQLite en hora de SV');
es(M.marcaSV('2026-11-12T03:10:00.000Z'), '2026-11-11 21:10', 'ISO de la noche anterior en SV');
es([M.marcaSV('2026-05-10'), M.marcaSV(null), M.marcaSV('x')], ['2026-05-10', '', ''], 'fecha sola, vacío, ilegible');
es(['vigente', 'por_vencer', 'vencida', 'sin_vigencia', 'no_acreditado'].map((e) => M.textoVigenciaAcreditacion(e, '2027-01-31')),
  ['Acreditado hasta 31/01/2027', 'Vence el 31/01/2027', 'Vencida el 31/01/2027', 'Acreditado sin vigencia', '—'], 'vigencia en Proveedores');
es(M.acreditacionHoy(labOk, '2027-01-01'), { estado: 'por_vencer', dias: 30 }, 'acreditación por vencer');
es(M.acreditacionHoy(labNo, '2027-01-01'), { estado: 'no_acreditado', dias: null }, 'no acreditado sin días');

// ── 15. CSV ──────────────────────────────────────────────────────────────────
es([M.COLUMNAS_CSV_EQUIPOS.length, M.COLUMNAS_CSV_REGISTROS.length, M.COLUMNAS_CSV_PATRONES.length, M.COLUMNAS_CSV_LABS.length], [29, 21, 15, 15], 'columnas de cada CSV');
const filaEq = {
  activoId: 1, codigo: 'BIO-1', nombre: 'MONITOR', marca: 'Mindray', modelo: 'iMEC', serial: 'S1', area: 'biomedico', esBio: true, esPatron: false,
  sedeId: 1, sede: 'Central', ubicacionId: 1, ubicacion: 'UCI', subcategoria: 'soporte_vida', criticidad: 'alta', clase: 'III',
  motivos: ['soporte_vida', 'criticidad_alta', 'clase_iii'], estado: 'vigente', ultima: '2026-05-10', proxima: '2027-05-10', dias: 179, noAplicaMotivo: null,
  cal: { id: 9, fecha: '2026-05-10', proxima: '2027-05-10', numeroCertificado: 'C-9', tieneArchivo: true, laboratorio: 'Lab Ávila', labAcreditado: null,
    labAcreditacionRef: null, resultado: 'conforme', patronActivoId: 3, patronCodigo: 'ANA-1', patronVigente: false, patronTexto: 'CENAM', incertidumbre: '±1', notas: null },
};
const csvEq = M.filaCsvEquipo(filaEq);
es([csvEq.ultima, csvEq.proxima, csvEq.dias, csvEq.adjunto, csvEq.labAcreditado, csvEq.patronVigente, csvEq.critico, csvEq.patron], ['2026-05-10', '2027-05-10', 179, 'Sí', 'No consta', 'No', 'Sí', 'No'], 'equipo: fechas ISO y Sí/No/No consta');
es([csvEq.area, csvEq.subcategoria, csvEq.criticidad, csvEq.motivoCritico, csvEq.estado, csvEq.resultado], ['Equipos biomédicos', 'Soporte de vida', 'Alta', 'Soporte de vida · Criticidad alta · Clase III', 'Vigente', 'Conforme'], 'equipo: etiquetas');
es(Object.keys(csvEq).sort(), M.COLUMNAS_CSV_EQUIPOS.map((c) => c.key).sort(), 'una clave por columna');
const csvSinCal = M.filaCsvEquipo({ ...filaEq, estado: 'no_aplica', ultima: null, proxima: null, dias: null, noAplicaMotivo: 'Sin función de medición', cal: null, subcategoria: null, motivos: [] });
es([csvSinCal.ultima, csvSinCal.dias, csvSinCal.adjunto, csvSinCal.labAcreditado, csvSinCal.patronVigente, csvSinCal.noAplica, csvSinCal.critico, csvSinCal.subcategoria], ['', '', '', '', '', 'Sin función de medición', 'No', ''], 'equipo sin calibración');
const sinBooleanos = (o) => Object.values(o).every((v) => v !== true && v !== false && v !== 'true' && v !== 'false' && v !== null && v !== undefined);
si(sinBooleanos(csvEq) && sinBooleanos(csvSinCal), 'sin true/false ni null');
const reg = {
  id: 9, activoId: 1, codigo: 'BIO-1', equipo: 'MONITOR', sede: null, fecha: '2026-05-10', proxima: null, resultado: 'no_conforme', numeroCertificado: null,
  tieneArchivo: false, laboratorio: 'Lab X', labAcreditado: null, labAcreditacionRef: null, patronActivoId: null, patronCodigo: null, patronVigente: null,
  patronTexto: null, incertidumbre: null, realizadoPor: 'Técnico', notas: 'Falla', registradoPor: 'Jefe', registradoEn: '2026-05-10 22:30:00', corregidaEn: '2026-05-11T03:00:00.000Z', corregidaPor: 'Admin',
};
const csvReg = M.filaCsvRegistro(reg);
es([csvReg.fecha, csvReg.proxima, csvReg.resultado, csvReg.adjunto, csvReg.labAcreditado, csvReg.patronVigente, csvReg.registradoEn, csvReg.corregidaEn], ['2026-05-10', '', 'No conforme', 'No', 'No consta', '', '2026-05-10 16:30', '2026-05-10 21:00'], 'registro: marcas en hora de SV');
si(sinBooleanos(csvReg), 'registro sin true/false');
es(Object.keys(csvReg).sort(), M.COLUMNAS_CSV_REGISTROS.map((c) => c.key).sort(), 'registro: una clave por columna');
const csvPat = M.filaCsvPatron({ ...filaEq, esPatron: true, usos: 4, calibs: [] });
es([csvPat.instrumento, csvPat.usos, csvPat.adjunto, csvPat.labAcreditado], ['MONITOR', 4, 'Sí', 'No consta'], 'patrón');
es(Object.keys(csvPat).sort(), M.COLUMNAS_CSV_PATRONES.map((c) => c.key).sort(), 'patrón: una clave por columna');
const filaLab = { id: 1, nombre: 'Lab Ávila', nit: null, contacto: null, telefono: null, email: null, notas: null, activo: true, esLaboratorioAcreditado: true, acreditacionOrgano: 'OSA', acreditacionNumero: 'LC-1', acreditacionAlcance: 'Presión', acreditacionVigencia: '2027-01-31', tieneCertificado: false, estado: 'vigente', dias: 80, calibraciones: 3, ultimaCalibracion: '2026-05-10' };
const csvLab = M.filaCsvLab(filaLab);
es([csvLab.acreditado, csvLab.vigencia, csvLab.estado, csvLab.certificado, csvLab.calibraciones, csvLab.activo], ['Sí', '2027-01-31', 'Acreditado', 'No', 3, 'Sí'], 'laboratorio');
es(M.filaCsvLab({ ...filaLab, esLaboratorioAcreditado: false, estado: 'no_acreditado' }).certificado, '', 'sin acreditación no se pide certificado');
es(Object.keys(csvLab).sort(), M.COLUMNAS_CSV_LABS.map((c) => c.key).sort(), 'laboratorio: una clave por columna');

// ── APIs contra la base con todas las migraciones ───────────────────────────
const h = await setupConjuntos({
  modules: {
    calEquipo: 'pages/api/activos/[id]/calibraciones',
    calId: 'pages/api/calibraciones/[id]',
    calCert: 'pages/api/calibraciones/certificado/[id]',
    calPatrones: 'pages/api/calibraciones/patrones',
    calMarca: 'pages/api/calibraciones/equipo/[id]',
    calExportar: 'pages/api/calibraciones/exportar',
    prov: 'pages/api/proveedores/index',
    provId: 'pages/api/proveedores/[id]',
    provAcred: 'pages/api/proveedores/[id]/acreditacion',
    metroDb: 'lib/metrologia-db',
    dbLib: 'lib/db',
  },
});
try {
  h.faults.enforceColumnLimit = true; // D1 rechaza resultados de más de 100 columnas
  const db = h.sqlite;
  const hoy = B.hoySV();
  const una = (sql, ...p) => ({ ...db.prepare(sql).get(...p) }); // sin prototipo nulo, para deepEqual
  const dia = (d) => B.sumarDias(hoy, d);
  const objetos = new Map();
  let borradosR2 = 0;
  const R2 = {
    async put(key, valor, opciones) { objetos.set(key, { bytes: new Uint8Array(valor instanceof ArrayBuffer ? valor : await new Response(valor).arrayBuffer()), tipo: opciones?.httpMetadata?.contentType }); return {}; },
    async get(key) { const o = objetos.get(key); return o ? { httpMetadata: { contentType: o.tipo }, async arrayBuffer() { return o.bytes.slice().buffer; } } : null; },
    async delete(key) { borradosR2++; objetos.delete(key); },
  };
  async function llamar(ruta, url, { method = 'GET', rol = 'admin', id, data, form } = {}) {
    const c = h.ctx(url, { method, id, rol, data });
    c.locals.runtime.env.R2 = R2;
    if (form) c.request = new Request(c.url, { method, headers: rol ? { cookie: c.request.headers.get('cookie') } : {}, body: form });
    const res = await ruta(c);
    const tipo = res.headers.get('content-type') ?? '';
    const body = tipo.includes('json') ? await res.json() : tipo.startsWith('text/') ? await res.text() : new Uint8Array(await res.arrayBuffer());
    return { status: res.status, body, headers: res.headers };
  }
  const multipart = (campos, archivo) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(campos)) f.set(k, v == null ? '' : String(v));
    if (archivo) f.set('file', archivo);
    return f;
  };
  const PDF = new File([new TextEncoder().encode('%PDF-1.7\n%prueba\n')], 'certificado.pdf', { type: 'application/pdf' });
  const PNG = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], 'foto.png', { type: 'image/png' });
  const EXE = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0])], 'certificado.pdf', { type: 'application/pdf' });

  db.exec(`INSERT INTO sucursales (id, nombre) VALUES (1, 'Central');
    INSERT INTO ubicaciones (id, sucursal_id, nombre) VALUES (1, 1, 'UCI');
    INSERT INTO activos (id, codigo, nombre, tipo, rubro, ubicacion_id, subcategoria, criticidad_operacional, clase_riesgo) VALUES
      (101, 'BIO-101', 'MONITOR DE SIGNOS VITALES', 'biomedico', 'biomedico', 1, 'soporte_vida', 'alta', 'III');
    INSERT INTO activos (id, codigo, nombre, tipo, rubro, requiere_calibracion) VALUES (102, 'GEN-102', 'BALANZA', 'general', 'equipo_general', 1);
    INSERT INTO activos (id, codigo, nombre, tipo, rubro, requiere_calibracion, es_patron, marca, modelo, serial) VALUES (103, 'ANA-103', 'ANALIZADOR DE SEGURIDAD ELÉCTRICA', 'general', 'equipo_general', 1, 1, 'Fluke', 'ESA615', 'F-1');
    INSERT INTO activos (id, codigo, nombre, tipo, rubro) VALUES (104, 'BIO-104', 'CAMA ELÉCTRICA', 'biomedico', 'biomedico');
    INSERT INTO activos (id, codigo, nombre, tipo, rubro, estado) VALUES (105, 'BIO-105', 'DESFIBRILADOR', 'biomedico', 'biomedico', 'baja');
    INSERT INTO activos (id, codigo, nombre, tipo, rubro) VALUES (106, 'GEN-106', 'BOMBA DE AGUA', 'general', 'equipo_general');
    INSERT INTO activos (id, codigo, nombre, tipo, rubro) VALUES (107, 'AIR-107', 'MINISPLIT', 'biomedico', 'aires');`);
  db.prepare(`INSERT INTO proveedores (id, nombre, es_laboratorio_acreditado, acreditacion_organo, acreditacion_numero, acreditacion_vigencia) VALUES (201, 'LABORATORIO ÁVILA', 1, 'OSA', 'LC-001', ?)`).run(dia(200));
  db.exec(`INSERT INTO proveedores (id, nombre) VALUES (202, 'METROLOGÍA BETA');`);
  db.prepare(`INSERT INTO proveedores (id, nombre, es_laboratorio_acreditado, acreditacion_organo, acreditacion_numero, acreditacion_vigencia) VALUES (203, 'CALIBRA VENCIDA', 1, 'OSA', 'LC-009', ?)`).run(dia(-10));

  const A = h.app;
  const calUrl = (id) => `/api/activos/${id}/calibraciones`;
  let r = await llamar(A.calEquipo.GET, calUrl(101), { rol: 'visualizador', id: 101 });
  es([r.status, r.body.calibraciones, r.body.estado.estado], [200, [], 'sin_calibracion'], 'GET: el visualizador ve; sin calibraciones');
  r = await llamar(A.calEquipo.GET, calUrl(101), { rol: 'solicitante', id: 101 });
  es([r.status, typeof r.body.error], [403, 'string'], 'GET: el solicitante no ve (error en texto)');
  r = await llamar(A.calEquipo.GET, calUrl(999), { id: 999 });
  es(r.status, 404, 'GET: equipo que no existe');

  const base = { fechaCalibracion: dia(-30), proximaCalibracion: dia(335), laboratorioId: 201, numeroCertificado: 'C-1', resultado: 'conforme' };
  r = await llamar(A.calEquipo.POST, calUrl(101), { method: 'POST', rol: 'visualizador', id: 101, data: base });
  es(r.status, 403, 'POST: el visualizador no registra');
  r = await llamar(A.calEquipo.POST, calUrl(105), { method: 'POST', id: 105, data: base });
  es([r.status, r.body.error], [409, MC.baja], 'POST: equipo de baja → 409');
  r = await llamar(A.calEquipo.POST, calUrl(101), { method: 'POST', id: 101, data: { ...base, fechaCalibracion: '' } });
  es([r.status, r.body.error], [400, MC.fecha], 'POST: sin fecha → 400 con texto');
  r = await llamar(A.calEquipo.POST, calUrl(101), { method: 'POST', id: 101, data: { ...base, patronActivoId: 102 } });
  es([r.status, r.body.error], [400, MC.patronInvalido], 'POST: el patrón no está marcado');
  r = await llamar(A.calEquipo.POST, calUrl(103), { method: 'POST', id: 103, data: { ...base, patronActivoId: 103 } });
  es([r.status, r.body.error], [400, MC.propioPatron], 'POST: su propio patrón');
  r = await llamar(A.calEquipo.POST, calUrl(101), { method: 'POST', id: 101, data: { ...base, laboratorioId: 999 } });
  es([r.status, r.body.error], [400, MC.laboratorio], 'POST: laboratorio que no existe');

  // Registro sin archivo con un patrón que nunca se calibró: se guarda con avisos.
  r = await llamar(A.calEquipo.POST, calUrl(101), { method: 'POST', rol: 'jefe', id: 101, data: { ...base, patronActivoId: 103 } });
  es([r.status, r.body.estado.estado], [201, 'sin_certificado'], 'POST JSON: 201 y «Sin certificado»');
  es(r.body.advertencias, [`El patrón ANA-103 no tenía calibración vigente el ${B.fechaCorta(dia(-30))}.`, 'Falta adjuntar el certificado: el equipo quedará «Sin certificado» hasta que se suba.'], 'POST: avisos del patrón y del archivo');
  const cal1 = r.body.calibracion.id;
  const fila1 = db.prepare('SELECT lab_acreditado, lab_acreditacion_ref, patron_activo_id, usuario_id FROM calibraciones WHERE id = ?').get(cal1);
  es([fila1.lab_acreditado, fila1.lab_acreditacion_ref, fila1.patron_activo_id, fila1.usuario_id], [1, `OSA · N.º LC-001 · vigente hasta ${B.fechaCorta(dia(200))}`, 103, 2], 'copia de la acreditación y patrón guardados');
  es(una('SELECT ultima_calibracion AS u, proxima_calibracion AS p FROM activos WHERE id = 101'), { u: dia(-30), p: dia(335) }, 'copia de las fechas en el equipo');

  // Calibración del patrón, con PDF, como técnico.
  r = await llamar(A.calEquipo.POST, calUrl(103), { method: 'POST', rol: 'tecnico', id: 103, form: multipart({ ...base, fechaCalibracion: dia(-60), proximaCalibracion: dia(300), numeroCertificado: 'P-1' }, PDF) });
  es([r.status, r.body.estado.estado, r.body.advertencias], [201, 'vigente', ['No se indicó el patrón usado.']], 'POST multipart del técnico con PDF');
  const calPatron = r.body.calibracion.id;
  const clavePatron = db.prepare('SELECT certificado_r2_key AS k FROM calibraciones WHERE id = ?').get(calPatron).k;
  si(clavePatron.startsWith('calibraciones/103/') && clavePatron.endsWith('-certificado.pdf'), 'clave de R2 con prefijo y nombre seguro');
  es(objetos.get(clavePatron)?.tipo, 'application/pdf', 'R2 guarda el tipo detectado');
  r = await llamar(A.calEquipo.POST, calUrl(103), { method: 'POST', id: 103, form: multipart(base, EXE) });
  es([r.status, r.body.error], [415, 'Solo se aceptan archivos PDF o fotos (JPG, PNG o WEBP).'], 'un ejecutable con nombre .pdf → 415');
  r = await llamar(A.calEquipo.POST, calUrl(103), { method: 'POST', id: 103, form: multipart(base, new File([new Uint8Array(0)], 'vacio.pdf')) });
  es([r.status, r.body.error], [400, 'El archivo está vacío.'], 'archivo vacío → 400');
  es(db.prepare('SELECT COUNT(*) AS n FROM calibraciones WHERE activo_id = 103').get().n, 1, 'los rechazados no guardan nada');

  // Laboratorio no acreditado y escrito a mano.
  r = await llamar(A.calEquipo.POST, calUrl(102), { method: 'POST', id: 102, data: { ...base, laboratorioId: 202, patronReferencia: 'Pesas clase F1' } });
  es([r.status, r.body.advertencias[0]], [201, 'El laboratorio elegido no está acreditado. La calibración queda como «laboratorio no acreditado».'], 'laboratorio no acreditado: aviso');
  es(una('SELECT lab_acreditado AS a, lab_acreditacion_ref AS r FROM calibraciones WHERE id = ?', r.body.calibracion.id), { a: 0, r: 'No acreditado' }, 'copia: no acreditado');
  r = await llamar(A.calEquipo.POST, calUrl(102), { method: 'POST', id: 102, data: { ...base, fechaCalibracion: dia(-400), proximaCalibracion: dia(-35), laboratorioId: '', laboratorioExterno: 'Taller externo', patronReferencia: 'x' } });
  es([r.status, r.body.advertencias[0]], [201, 'Laboratorio escrito a mano: no se puede comprobar su acreditación.'], 'laboratorio escrito: aviso');
  es(db.prepare('SELECT lab_acreditado AS a FROM calibraciones WHERE id = ?').get(r.body.calibracion.id).a, null, 'copia: no consta');
  r = await llamar(A.calEquipo.GET, calUrl(102), { rol: 'tecnico', id: 102 });
  es([r.body.calibraciones.length, r.body.estado.estado, r.body.estado.ultima], [2, 'sin_certificado', dia(-30)], 'GET: la última manda (no la más antigua)');

  // Corregir: solo jefe y administrador, con motivo.
  r = await llamar(A.calId.PATCH, `/api/calibraciones/${cal1}`, { method: 'PATCH', rol: 'tecnico', id: cal1, data: { numeroCertificado: 'C-1B', motivo: 'Número mal escrito' } });
  es([r.status, r.body.error], [403, 'Solo el jefe o el administrador corrigen calibraciones.'], 'PATCH: el técnico no corrige');
  r = await llamar(A.calId.PATCH, `/api/calibraciones/${cal1}`, { method: 'PATCH', rol: 'jefe', id: cal1, data: { numeroCertificado: 'C-1B' } });
  es([r.status, r.body.error], [400, 'Escribe el motivo de la corrección (al menos 10 letras).'], 'PATCH: sin motivo');
  r = await llamar(A.calId.PATCH, `/api/calibraciones/${cal1}`, { method: 'PATCH', rol: 'jefe', id: cal1, data: { numeroCertificado: 'C-1', motivo: 'Sin cambios reales' } });
  es([r.status, r.body.error], [400, 'No hay cambios que guardar.'], 'PATCH: nada cambia');
  r = await llamar(A.calId.PATCH, `/api/calibraciones/${cal1}`, { method: 'PATCH', rol: 'jefe', id: cal1, data: { proximaCalibracion: dia(-40), motivo: 'Fecha mal escrita' } });
  es([r.status, r.body.error], [400, MC.proximaAntes], 'PATCH: valida la mezcla con lo guardado');
  r = await llamar(A.calId.PATCH, `/api/calibraciones/${cal1}`, { method: 'PATCH', rol: 'jefe', id: cal1, data: { numeroCertificado: 'C-1B', laboratorioId: 203, fechaCalibracion: dia(-5), motivo: 'Número, fecha y laboratorio mal escritos' } });
  es([r.status, r.body.calibracion.numeroCertificado], [200, 'C-1B'], 'PATCH: el jefe corrige');
  const corregida = db.prepare('SELECT corregida_en AS en, corregida_por AS por, lab_acreditado AS a FROM calibraciones WHERE id = ?').get(cal1);
  es([typeof corregida.en, corregida.por, corregida.a], ['string', 2, 0], 'marca «corregida» y copia de la acreditación recalculada (vencida en la fecha)');
  si(r.body.advertencias.includes(`La acreditación del laboratorio no estaba vigente el ${B.fechaCorta(dia(-5))}.`), 'PATCH: avisa la acreditación vencida');
  es(una('SELECT ultima_calibracion AS u FROM activos WHERE id = 101'), { u: dia(-5) }, 'PATCH: la copia del equipo sigue a la corrección');

  // Adjuntar el certificado que falta: también el técnico; uno existente no se reemplaza.
  r = await llamar(A.calCert.POST, `/api/calibraciones/certificado/${cal1}`, { method: 'POST', rol: 'visualizador', id: cal1, form: multipart({}, PNG) });
  es(r.status, 403, 'adjuntar: el visualizador no');
  r = await llamar(A.calCert.POST, `/api/calibraciones/certificado/${cal1}`, { method: 'POST', rol: 'tecnico', id: cal1, form: multipart({}) });
  es([r.status, r.body.error], [400, 'Elige el archivo del certificado (PDF o foto).'], 'adjuntar sin archivo');
  r = await llamar(A.calCert.POST, `/api/calibraciones/certificado/${cal1}`, { method: 'POST', rol: 'tecnico', id: cal1, form: multipart({}, PNG) });
  es([r.status, r.body.estado.estado], [201, 'vigente'], 'adjuntar: el técnico sube la foto y queda vigente');
  r = await llamar(A.calCert.POST, `/api/calibraciones/certificado/${cal1}`, { method: 'POST', rol: 'jefe', id: cal1, form: multipart({}, PDF) });
  es([r.status, r.body.error], [409, 'Esta calibración ya tiene certificado. Para cambiarlo, el jefe usa «Corregir».'], 'adjuntar: ya tiene → 409');
  r = await llamar(A.calCert.GET, `/api/calibraciones/certificado/${cal1}`, { rol: 'solicitante', id: cal1 });
  es(r.status, 403, 'descargar: el solicitante no');
  r = await llamar(A.calCert.GET, `/api/calibraciones/certificado/${cal1}`, { rol: 'visualizador', id: cal1 });
  es([r.status, r.headers.get('content-type'), r.headers.get('x-content-type-options'), r.headers.get('content-disposition').startsWith('inline; filename="certificado-calibracion-C-1B.png"')], [200, 'image/png', 'nosniff', true], 'descargar: en línea, tipo guardado y nosniff');
  es(Array.from(r.body.slice(0, 4)), [0x89, 0x50, 0x4e, 0x47], 'los bytes del archivo');

  // Corregir con archivo nuevo: el anterior queda en R2.
  const claveAntes = db.prepare('SELECT certificado_r2_key AS k FROM calibraciones WHERE id = ?').get(cal1).k;
  r = await llamar(A.calId.PATCH, `/api/calibraciones/${cal1}`, { method: 'PATCH', rol: 'admin', id: cal1, form: multipart({ motivo: 'El certificado correcto es el PDF' }, PDF) });
  es(r.status, 200, 'PATCH multipart con archivo nuevo');
  si(objetos.has(claveAntes) && db.prepare('SELECT certificado_r2_key AS k FROM calibraciones WHERE id = ?').get(cal1).k !== claveAntes, 'el archivo reemplazado sigue en R2');

  // Eliminar: solo jefe y administrador, con motivo; el archivo no se borra.
  r = await llamar(A.calId.DELETE, `/api/calibraciones/${cal1}`, { method: 'DELETE', rol: 'tecnico', id: cal1, data: { motivo: 'Registro duplicado' } });
  es(r.status, 403, 'DELETE: el técnico no');
  r = await llamar(A.calId.DELETE, `/api/calibraciones/${cal1}`, { method: 'DELETE', rol: 'jefe', id: cal1 });
  es([r.status, r.body.error], [400, 'Escribe el motivo para eliminar la calibración (al menos 10 letras).'], 'DELETE: sin motivo');
  const claveFinal = db.prepare('SELECT certificado_r2_key AS k FROM calibraciones WHERE id = ?').get(cal1).k;
  r = await llamar(A.calId.DELETE, `/api/calibraciones/${cal1}`, { method: 'DELETE', rol: 'jefe', id: cal1, data: { motivo: 'Registro duplicado por error' } });
  es([r.status, r.body.ok, r.body.estado.estado], [200, true, 'sin_calibracion'], 'DELETE: el jefe elimina');
  si(objetos.has(claveFinal), 'el certificado de la calibración borrada sigue en R2');
  es(una('SELECT ultima_calibracion AS u, proxima_calibracion AS p FROM activos WHERE id = 101'), { u: null, p: null }, 'la copia del equipo se vacía');
  es(borradosR2, 0, 'corregir y eliminar nunca borran archivos de R2');

  // Patrones (K-B4).
  r = await llamar(A.calPatrones.GET, '/api/calibraciones/patrones?fecha=12/11/2026', { rol: 'tecnico' });
  es([r.status, r.body.error], [400, 'Fecha no válida.'], 'patrones: fecha mal escrita');
  r = await llamar(A.calPatrones.GET, `/api/calibraciones/patrones?fecha=${hoy}`, { rol: 'visualizador' });
  es(r.body.patrones, [{ id: 103, codigo: 'ANA-103', nombre: 'ANALIZADOR DE SEGURIDAD ELÉCTRICA', marca: 'Fluke', modelo: 'ESA615', serial: 'F-1', estado: 'vigente', proxima: dia(300), vigenteEnFecha: true, hasta: dia(300) }], 'patrones con su vigencia en la fecha');
  r = await llamar(A.calPatrones.GET, `/api/calibraciones/patrones?fecha=${dia(-61)}`, { rol: 'visualizador' });
  es([r.body.patrones[0].vigenteEnFecha, r.body.patrones[0].hasta], [false, null], 'antes de su primera calibración no estaba vigente');
  r = await llamar(A.calPatrones.GET, '/api/calibraciones/patrones', { rol: 'jefe' });
  es([r.body.patrones[0].vigenteEnFecha, r.body.patrones[0].hasta], [null, null], 'sin fecha: null');

  // Marcas de patrón y «No requiere» (solo jefe y administrador).
  const marca = (id, data, rol = 'jefe') => llamar(A.calMarca.PATCH, `/api/calibraciones/equipo/${id}`, { method: 'PATCH', rol, id, data });
  r = await marca(104, { calibracionNoAplica: true, motivo: 'Cama sin función de medición' }, 'tecnico');
  es(r.status, 403, 'marca: el técnico no');
  r = await marca(104, {});
  es([r.status, r.body.error], [400, 'Nada que cambiar.'], 'marca: nada');
  r = await marca(104, { calibracionNoAplica: true, motivo: 'corto' });
  es([r.status, r.body.error], [400, 'Escribe por qué no requiere calibración (al menos 10 letras).'], 'marca: motivo corto');
  r = await marca(104, { calibracionNoAplica: true, motivo: 'Cama sin función de medición' });
  es([r.status, r.body.activo], [200, { id: 104, esPatron: false, requiereCalibracion: false, calibracionNoAplica: true, calibracionNoAplicaMotivo: 'Cama sin función de medición' }], 'marca: «No requiere» con motivo');
  r = await llamar(A.calEquipo.POST, calUrl(104), { method: 'POST', id: 104, data: base });
  es([r.status, r.body.error], [409, MC.noRequiere], 'POST: «No requiere» → 409');
  r = await marca(103, { calibracionNoAplica: true, motivo: 'Probando si se puede marcar' });
  es([r.status, r.body.error], [400, 'Un equipo patrón siempre requiere calibración.'], 'marca: un patrón no lleva «No requiere»');
  r = await marca(105, { esPatron: true });
  es([r.status, r.body.error], [409, 'El equipo está dado de baja.'], 'marca: equipo de baja');
  r = await marca(106, { esPatron: true });
  es(r.body.activo, { id: 106, esPatron: true, requiereCalibracion: true, calibracionNoAplica: false, calibracionNoAplicaMotivo: null }, 'marca patrón: pone «Requiere calibración»');
  r = await marca(106, { esPatron: false });
  es([r.body.activo.esPatron, r.body.activo.requiereCalibracion], [false, true], 'quitar la marca no toca la casilla');

  // Población de Calibraciones (misma regla que Cumplimiento) y CSV.
  const filas = await A.metroDb.cargarFilasCal(A.dbLib.getDb({ locals: { runtime: { env: { DB: h.DB } } } }), { hoy });
  es(filas.map((f) => f.codigo).sort(), ['ANA-103', 'BIO-101', 'BIO-104', 'GEN-102', 'GEN-106'], 'sin bajas, sin generales sin casilla y con el área que manda');
  es(Object.fromEntries(filas.map((f) => [f.codigo, f.estado])), { 'ANA-103': 'vigente', 'BIO-101': 'sin_calibracion', 'BIO-104': 'no_aplica', 'GEN-102': 'sin_certificado', 'GEN-106': 'sin_calibracion' }, 'estado de cada uno');
  const monitor = filas.find((f) => f.codigo === 'BIO-101');
  es([monitor.motivos, monitor.sede, monitor.ubicacion, monitor.area], [['soporte_vida', 'criticidad_alta', 'clase_iii'], 'Central', 'UCI', 'biomedico'], 'motivos de crítico, sede y área');
  es(filas.find((f) => f.codigo === 'GEN-102').cal.laboratorio, 'METROLOGÍA BETA', 'la última calibración con el nombre del laboratorio');

  r = await llamar(A.calExportar.GET, '/api/calibraciones/exportar?vista=nada', { rol: 'visualizador' });
  es([r.status, r.body.error], [400, 'Vista no válida.'], 'exportar: vista desconocida');
  r = await llamar(A.calExportar.GET, '/api/calibraciones/exportar?vista=equipos', { rol: 'solicitante' });
  es(r.status, 403, 'exportar: el solicitante no');
  r = await llamar(A.calExportar.GET, '/api/calibraciones/exportar?vista=equipos', { rol: 'visualizador' });
  const lineas = r.body.replace(/^﻿/, '').split('\r\n');
  es([r.status, lineas[0].split(',').length, lineas.length - 1], [200, 29, 4], 'CSV de equipos: 29 columnas y 4 equipos (sin el «No requiere»)');
  si(r.headers.get('content-disposition').includes(`calibraciones_equipos_${hoy.replaceAll('-', '')}.csv`), 'nombre del archivo con la fecha de SV');
  no(/(^|,)(true|false)(,|$)/m.test(r.body), 'CSV sin true/false');
  si(r.body.includes(`ANA-103,ANALIZADOR DE SEGURIDAD ELÉCTRICA,Fluke,ESA615,F-1,Equipos generales,Sí,`), 'fila del patrón');
  r = await llamar(A.calExportar.GET, '/api/calibraciones/exportar?vista=equipos&area=biomedico&criticos=1', { rol: 'visualizador' });
  es(r.body.replace(/^﻿/, '').split('\r\n').length - 1, 1, 'CSV con los filtros de la pantalla');
  r = await llamar(A.calExportar.GET, '/api/calibraciones/exportar?vista=registros&area=equipo_general', { rol: 'jefe' });
  es(r.body.replace(/^﻿/, '').split('\r\n').length - 1, 3, 'historial: las calibraciones de esos equipos');
  r = await llamar(A.calExportar.GET, `/api/calibraciones/exportar?vista=registros&area=equipo_general&desde=${dia(-100)}`, { rol: 'jefe' });
  es(r.body.replace(/^﻿/, '').split('\r\n').length - 1, 2, 'historial: desde');
  r = await llamar(A.calExportar.GET, '/api/calibraciones/exportar?vista=registros&desde=ayer', { rol: 'jefe' });
  es([r.status, r.body.error], [400, 'Fecha no válida.'], 'historial: fecha mal escrita');
  r = await llamar(A.calExportar.GET, '/api/calibraciones/exportar?vista=patrones', { rol: 'jefe' });
  si(r.body.includes(',vigente,') === false && r.body.includes('Vigente') && r.body.split('\r\n').length === 2, 'CSV de patrones');
  r = await llamar(A.calExportar.GET, '/api/calibraciones/exportar?vista=laboratorios', { rol: 'jefe' });
  es(r.body.replace(/^﻿/, '').split('\r\n').map((l) => l.split(',')[0]).slice(1), ['CALIBRA VENCIDA', 'LABORATORIO ÁVILA', 'METROLOGÍA BETA'], 'CSV de laboratorios: acreditados o citados');

  // Proveedores y certificado de acreditación.
  r = await llamar(A.prov.GET, '/api/proveedores', { rol: 'tecnico' });
  es([r.status, r.body.proveedores.length], [200, 3], 'proveedores: el técnico los lee');
  r = await llamar(A.prov.GET, '/api/proveedores', { rol: 'solicitante' });
  es(r.status, 403, 'proveedores: el solicitante no');
  r = await llamar(A.prov.POST, '/api/proveedores', { method: 'POST', rol: 'tecnico', data: { nombre: 'X' } });
  es(r.status, 403, 'proveedores: el técnico no crea');
  r = await llamar(A.prov.POST, '/api/proveedores', { method: 'POST', rol: 'jefe', data: { nombre: 'Lab Nuevo', esLaboratorioAcreditado: true, acreditacionOrgano: 'OSA', acreditacionVigencia: dia(400) } });
  es([r.status, r.body.error], [400, 'Para un laboratorio acreditado escribe el órgano, el número y la vigencia.'], 'proveedores: acreditado sin número');
  r = await llamar(A.prov.POST, '/api/proveedores', { method: 'POST', rol: 'jefe', data: { nombre: 'Lab Nuevo', esLaboratorioAcreditado: true, acreditacionOrgano: 'OSA', acreditacionNumero: 'LC-77', acreditacionAlcance: 'Temperatura', acreditacionVigencia: dia(400), email: '' } });
  es([r.status, r.body.proveedor.acreditacionNumero, r.body.proveedor.email], [201, 'LC-77', null], 'proveedores: alta de laboratorio');
  const nuevo = r.body.proveedor.id;
  r = await llamar(A.provId.PATCH, `/api/proveedores/${nuevo}`, { method: 'PATCH', rol: 'jefe', id: nuevo, data: { acreditacionNumero: '' } });
  es([r.status, r.body.error], [400, 'Para un laboratorio acreditado escribe el órgano, el número y la vigencia.'], 'PATCH: revisa lo guardado más lo nuevo');
  r = await llamar(A.provId.PATCH, `/api/proveedores/${nuevo}`, { method: 'PATCH', rol: 'admin', id: nuevo, data: { telefono: '2222-0000' } });
  es([r.status, r.body.proveedor.telefono, r.body.proveedor.acreditacionNumero], [200, '2222-0000', 'LC-77'], 'PATCH parcial');
  r = await llamar(A.provId.GET, '/api/proveedores/9999', { rol: 'visualizador', id: 9999 });
  es([r.status, r.body.error], [404, 'Proveedor no encontrado'], 'GET: no existe');
  r = await llamar(A.provAcred.POST, '/api/proveedores/202/acreditacion', { method: 'POST', rol: 'jefe', id: 202, form: multipart({}, PDF) });
  es([r.status, r.body.error], [409, 'Marca primero el proveedor como laboratorio acreditado.'], 'certificado de acreditación: no acreditado');
  r = await llamar(A.provAcred.POST, `/api/proveedores/${nuevo}/acreditacion`, { method: 'POST', rol: 'tecnico', id: nuevo, form: multipart({}, PDF) });
  es(r.status, 403, 'certificado de acreditación: el técnico no');
  r = await llamar(A.provAcred.GET, `/api/proveedores/${nuevo}/acreditacion`, { rol: 'visualizador', id: nuevo });
  es([r.status, r.body.error], [404, 'Sin certificado de acreditación'], 'sin certificado todavía');
  r = await llamar(A.provAcred.POST, `/api/proveedores/${nuevo}/acreditacion`, { method: 'POST', rol: 'jefe', id: nuevo, form: multipart({}, PDF) });
  es([r.status, r.body.nombre], [201, 'certificado.pdf'], 'certificado de acreditación cargado');
  r = await llamar(A.provAcred.GET, `/api/proveedores/${nuevo}/acreditacion`, { rol: 'visualizador', id: nuevo });
  es([r.status, r.headers.get('content-type'), r.headers.get('content-disposition').startsWith('inline; filename="acreditacion-Lab_Nuevo.pdf"')], [200, 'application/pdf', true], 'certificado de acreditación en línea');
  r = await llamar(A.provId.DELETE, `/api/proveedores/${nuevo}`, { method: 'DELETE', rol: 'jefe', id: nuevo });
  es(r.status, 403, 'desactivar: solo el administrador');
  r = await llamar(A.provId.DELETE, `/api/proveedores/${nuevo}`, { method: 'DELETE', rol: 'admin', id: nuevo });
  es([r.status, db.prepare('SELECT activo FROM proveedores WHERE id = ?').get(nuevo).activo], [200, 0], 'desactivar: no borra');

  const anchas = h.queries.filter((q) => q.columns.length > 100);
  es(anchas.length, 0, 'ninguna consulta pasa de 100 columnas');
} finally {
  await h.close();
}

console.log(`PASS test-bio-metrologia: ${n} casos`);
