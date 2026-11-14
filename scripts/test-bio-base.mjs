// Fase 59 · BASE: reglas comunes de src/lib/biomedico.ts, la migración 0059 frente a
// schema.ts y la bitácora en lote (logAuditLote). Sin red ni base real.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unstable_splitSqlQuery } from 'wrangler';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const out = await build({ entryPoints: ['src/lib/biomedico.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
const B = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const si = (r, nota) => { n++; assert.equal(r, true, nota); };
const no = (r, nota) => { n++; assert.equal(r, false, nota); };

// ── Fechas ──────────────────────────────────────────────────────────────────
es(B.hoySV(new Date('2026-11-13T03:00:00Z')), '2026-11-12', '21:00 del 12 en El Salvador');
es(B.hoySV(Date.UTC(2026, 10, 13, 5, 59)), '2026-11-12', 'milisegundos: 23:59 del 12');
es(B.hoySV(Date.UTC(2026, 10, 13, 6, 0)), '2026-11-13', 'medianoche en El Salvador');
es(B.hoySV(new Date('2026-05-11T05:00:00Z')), '2026-05-10', 'Date');
si(B.esFechaISO('2026-11-12'), 'fecha válida');
si(B.esFechaISO('2028-02-29'), 'bisiesto');
no(B.esFechaISO('2026-02-29'), 'no bisiesto');
no(B.esFechaISO('2026-02-30'), '30 de febrero');
no(B.esFechaISO('2026-13-01'), 'mes 13');
no(B.esFechaISO('2026-1-01'), 'sin ceros');
no(B.esFechaISO('12/11/2026'), 'otro formato');
no(B.esFechaISO('2026-11-12T00:00'), 'con hora');
no(B.esFechaISO(null), 'null');
no(B.esFechaISO(''), 'vacío');
es(B.fechaCorta('2026-05-10'), '10/05/2026', 'el 10 de mayo no sale 9 de mayo');
es(B.fechaCorta('2026-05-10 14:00:00'), '10/05/2026', 'marca de SQLite de la mañana en SV');
es(B.fechaCorta('2026-05-11 01:30:00'), '10/05/2026', 'marca UTC de la noche anterior en SV');
es(B.fechaCorta('2026-05-11T05:59:59.000Z'), '10/05/2026', 'ISO un segundo antes de medianoche SV');
es(B.fechaCorta('2026-05-11T06:00:00.000Z'), '11/05/2026', 'ISO a medianoche SV');
es(B.fechaCorta('2026-05-10T23:00:00Z'), '10/05/2026', 'ISO de la tarde');
es(B.fechaCorta(null), '—', 'null');
es(B.fechaCorta(''), '—', 'vacío');
es(B.fechaCorta('x'), '—', 'ilegible');
es(B.fechaCorta('10/05/2026'), '—', 'ya formateada no se adivina');
es(B.fechaCorta('2026-13-01'), '—', 'fecha inválida');
es(B.fechaCorta(null, ''), '', 'texto de vacío configurable');
es(B.diaSV('2026-05-11 01:30:00'), '2026-05-10', 'día SV de una marca');
es(B.diaSV('2026-11-13 03:00:00'), '2026-11-12', 'día SV de una marca (2)');
es(B.diaSV('2026-05-10'), '2026-05-10', 'fecha sola');
es(B.diaSV('x'), null, 'ilegible');
es(B.horaSV('2026-05-11 01:30:00'), '19:30', 'hora SV');
es(B.horaSV('2026-05-10'), '', 'fecha sola no tiene hora');
es(B.horaSV(null), '', 'null');
es(B.fechaHoraSV('2026-11-12 15:30:00'), '12/11/2026 09:30', 'marca SQLite');
es(B.fechaHoraSV('2026-11-12T03:10:00.000Z'), '11/11/2026 21:10', 'ISO con Z');
es(B.fechaHoraSV('2026-11-12T03:10:00-06:00'), '12/11/2026 03:10', 'ISO con desfase');
es(B.fechaHoraSV('2026-11-12'), '12/11/2026', 'fecha sola sin hora');
es(B.fechaHoraSV(null), '—', 'null');
es(B.fechaHoraSV('basura'), '—', 'ilegible');
es(B.leerFechaEntrada('1/5/2026'), { valor: '2026-05-01' }, 'D/M/AAAA');
es(B.leerFechaEntrada('10/05/2026'), { valor: '2026-05-10' }, 'DD/MM/AAAA');
es(B.leerFechaEntrada('2026-05-10'), { valor: '2026-05-10' }, 'AAAA-MM-DD');
es(B.leerFechaEntrada('2026/05/10'), { valor: '2026-05-10' }, 'AAAA/MM/DD');
es(B.leerFechaEntrada('10-05-2026'), { valor: '2026-05-10' }, 'DD-MM-AAAA');
es(B.leerFechaEntrada('10.05.2026'), { valor: '2026-05-10' }, 'DD.MM.AAAA');
es(B.leerFechaEntrada(' 10/05/2026 '), { valor: '2026-05-10' }, 'con espacios');
es(B.leerFechaEntrada(''), { valor: null }, 'vacío');
es(B.leerFechaEntrada(null), { valor: null }, 'null');
es(B.leerFechaEntrada('31/02/2026'), { error: 'Fecha «31/02/2026» no válida. Usa DD/MM/AAAA.' }, 'no existe');
es(B.leerFechaEntrada('10/05/26'), { error: 'Fecha «10/05/26» no válida. Usa DD/MM/AAAA.' }, 'año de dos cifras');
es(B.leerFechaEntrada('10/05.2026'), { error: 'Fecha «10/05.2026» no válida. Usa DD/MM/AAAA.' }, 'separadores mezclados');
es(B.sumarDias('2026-12-25', 10), '2027-01-04', 'cambio de año');
es(B.sumarDias('2026-12-31', 1), '2027-01-01', 'fin de año');
es(B.sumarDias('2026-11-12', -365), '2025-11-12', 'hacia atrás');
es(B.sumarDias('2026-03-01', -1), '2026-02-28', 'fin de febrero');
es(B.sumarDias('x', 1), '', 'fecha inválida');
es(B.sumarMeses('2026-01-31', 1), '2026-02-28', 'recorta al fin de mes');
es(B.sumarMeses('2024-01-31', 1), '2024-02-29', 'bisiesto');
es(B.sumarMeses('2026-05-10', 12), '2027-05-10', 'un año');
es(B.sumarMeses('2028-02-29', 12), '2029-02-28', '29 de febrero + 1 año');
es(B.sumarMeses('2024-02-29', 12), '2025-02-28', '29 de febrero + 12 meses');
es(B.sumarMeses('2026-11-12', -24), '2024-11-12', 'hacia atrás');
es(B.sumarMeses('2026-01-15', -1), '2025-12-15', 'año anterior');
es(B.diasEntre('2026-11-12', '2026-12-12'), 30, '30 días');
es(B.diasEntre('2026-11-12', '2026-11-10'), -2, 'negativo');
es(B.diasEntre('2026-12-31', '2027-01-01'), 1, 'cambio de año');
es(B.diasEntre('2024-02-28', '2024-03-01'), 2, 'bisiesto');
si(Number.isNaN(B.diasEntre('x', '2026-01-01')), 'fecha inválida → NaN');
es([0, 1, 30, -1, -3, null].map(B.textoVence), ['vence hoy', 'vence mañana', 'vence en 30 días', 'venció ayer', 'venció hace 3 días', ''], 'textoVence');
es(B.normalizarTexto('  Radiología  UCI '), 'radiologia uci', 'normalizarTexto');

// ── Roles ───────────────────────────────────────────────────────────────────
es(B.ROLES_BIO_VER, ['admin', 'jefe', 'tecnico', 'visualizador'], 'ven');
es(B.ROLES_BIO_REGISTRAR, ['admin', 'jefe', 'tecnico'], 'registran');
es(B.ROLES_BIO_GESTIONAR, ['admin', 'jefe'], 'gestionan');
si(B.puedeVerBio('visualizador'), 'visualizador ve');
es(['proveedor', 'solicitante', 'motorista', undefined, null].map(B.puedeVerBio), [false, false, false, false, false], 'otros no ven');
no(B.puedeRegistrarBio('visualizador'), 'visualizador no registra');
si(B.puedeRegistrarBio('tecnico'), 'técnico registra');
no(B.puedeGestionarBio('tecnico'), 'técnico no autoriza');
si(B.puedeGestionarBio('jefe'), 'jefe autoriza');

// ── Vigencias ───────────────────────────────────────────────────────────────
es(['2026-05-09', '2026-05-10', '2026-06-09', '2026-06-10', null, 'x'].map((v) => B.estadoVigencia(v, '2026-05-10')),
  ['vencido', 'por_vencer', 'por_vencer', 'vigente', 'sin_fecha', 'sin_fecha'], 'estadoVigencia a 30 días');
es(B.estadoVigencia('2026-05-20', '2026-05-10', 5), 'vigente', 'aviso de 5 días');
es(['2027-01-11', '2027-01-12'].map((v) => B.estadoVigencia(v, '2026-11-12', 60)), ['por_vencer', 'vigente'], 'aviso de 60 días');
es(B.DIAS_AVISO, { calibracion: 30, seguridadElectrica: 30, documento: 30, acreditacion: 60, registroSanitario: 90, licencia: 90 }, 'ventanas de aviso');
const hoy = '2026-11-12';
es(B.vigenciaDe(null, hoy), { tramo: 'sin_fecha', dias: null, texto: 'Sin vencimiento' }, 'sin fecha');
es(B.vigenciaDe('2026-02-30', hoy), { tramo: 'sin_fecha', dias: null, texto: 'Fecha no válida' }, 'fecha inválida');
es(B.vigenciaDe('2026-11-12', hoy), { tramo: 'vence_30', dias: 0, texto: 'Vence hoy' }, 'vence hoy');
es(B.vigenciaDe('2026-11-13', hoy), { tramo: 'vence_30', dias: 1, texto: 'Vence mañana' }, 'vence mañana');
es(B.vigenciaDe('2026-12-12', hoy), { tramo: 'vence_30', dias: 30, texto: 'Vence en 30 días' }, '30 días');
es(['2026-12-13', '2027-01-11', '2027-01-12', '2027-02-10'].map((v) => B.vigenciaDe(v, hoy).tramo), ['vence_60', 'vence_60', 'vence_90', 'vence_90'], 'tramos 60 y 90');
es(B.vigenciaDe('2027-02-11', hoy), { tramo: 'vigente', dias: 91, texto: 'Vigente hasta 11/02/2027' }, 'vigente');
es(B.vigenciaDe('2026-11-11', hoy), { tramo: 'vencida', dias: -1, texto: 'Venció ayer' }, 'venció ayer');
es(B.vigenciaDe('2026-10-13', hoy).texto, 'Venció hace 30 días', 'venció hace 30 días');
es([null, -1, 0, 30, 31, 60, 61, 90, 91].map(B.umbralAviso), [null, 0, 30, 30, 60, 60, 90, 90, null], 'umbralAviso');

// ── Clase de riesgo ─────────────────────────────────────────────────────────
es(B.CLASES_RIESGO_VALORES, ['I', 'IIa', 'IIb', 'III'], 'escala');
for (const t of ['IIa', 'iia', '2a', ' Clase IIa ', 'clase-IIa']) es(B.leerClaseRiesgo(t), { valor: 'IIa' }, `«${t}» es IIa`);
es(B.leerClaseRiesgo('2B'), { valor: 'IIb' }, '2B');
es(B.leerClaseRiesgo('1'), { valor: 'I' }, '1');
es(B.leerClaseRiesgo('3'), { valor: 'III' }, '3');
es(B.leerClaseRiesgo(''), { valor: null }, 'vacía');
es(B.leerClaseRiesgo('IV'), { error: 'Clase de riesgo «IV» no válida. Usa I, IIa, IIb o III.' }, 'IV');
es(B.leerClaseRiesgo('II'), { error: 'Clase de riesgo «II» no válida. Usa I, IIa, IIb o III.' }, 'II sin letra es ambigua');
es(B.etiquetaClaseRiesgo('IIa'), 'Clase IIa (riesgo moderado)', 'etiqueta');
es(B.etiquetaClaseRiesgo(null), 'Sin clasificar', 'sin clase');
es(B.etiquetaClaseRiesgo('X'), 'X', 'desconocida');

// ── Registro sanitario ──────────────────────────────────────────────────────
const reg = (o) => B.estadoRegistroSanitario({ registroSanitario: 'RS-123', registroSanitarioNoRequiere: false, registroSanitarioVencimiento: null, ...o }, hoy);
es(reg({ registroSanitarioNoRequiere: true }), 'no_requiere', 'no requiere aunque haya número');
es(reg({ registroSanitarioNoRequiere: 1 }), 'no_requiere', 'no requiere en 1');
es(reg({ registroSanitario: '  ' }), 'sin_registro', 'solo espacios');
es(reg({ registroSanitario: null }), 'sin_registro', 'sin número');
es(reg({}), 'sin_vencimiento', 'sin vencimiento');
es(['2026-11-11', '2026-11-12', '2027-02-10', '2027-02-11'].map((v) => reg({ registroSanitarioVencimiento: v })), ['vencido', 'por_vencer', 'por_vencer', 'vigente'], 'aviso a 90 días');
es(Object.keys(B.ESTADO_REGISTRO_LABEL).sort(), Object.keys(B.ESTADO_REGISTRO_COLOR).sort(), 'etiquetas y colores del registro');
es(B.ENTIDADES_REGISTRO, ['CSSP', 'SRS', 'DNM'], 'entidades');

// ── Estado, baja, centro de costo, historial ────────────────────────────────
es(B.ESTADOS_ACTIVO, ['operativo', 'averiado', 'mantenimiento', 'baja'], 'estados');
es(B.ESTADO_ACTIVO_LABEL.baja, 'Dado de baja', 'etiqueta de baja');
es(Object.keys(B.ESTADO_ACTIVO_COLOR), [...B.ESTADOS_ACTIVO], 'color por estado');
es(B.folioActaBaja(7), 'BAJA-0007', 'folio');
es(B.folioActaBaja(12), 'BAJA-0012', 'folio 2');
es(B.DESTINOS_CON_DETALLE, ['donacion', 'venta', 'otro'], 'destinos con detalle');
es(Object.keys(B.MOTIVOS_BAJA), ['falla_irreparable', 'obsolescencia', 'costo_reparacion', 'fin_vida_util', 'siniestro', 'retiro_sanitario', 'otro'], 'motivos');
es(B.etiquetaCentroCosto({ codigo: 'CC-01', nombre: 'UCI ADULTOS' }), 'CC-01 · UCI ADULTOS', 'centro de costo');
es(B.etiquetaCentroCosto(null), 'Sin centro de costo', 'sin centro');
const completo = { nombre: 'MONITOR', marca: 'MINDRAY', modelo: 'X', serial: 'S1', ubicacionId: 1, centroCostoId: 2, claseRiesgo: 'IIb', registroSanitario: 'RS', registroSanitarioNoRequiere: false };
es(B.faltantesInventarioBiomedico(completo), [], 'completo');
es(B.faltantesInventarioBiomedico({ ...completo, registroSanitario: null, registroSanitarioNoRequiere: 1 }), [], 'no requiere registro');
es(B.faltantesInventarioBiomedico({ nombre: 'EQUIPO BIOMÉDICO PENDIENTE DE IDENTIFICAR', marca: '', modelo: null, serial: ' ', ubicacionId: null, centroCostoId: null, claseRiesgo: null, registroSanitario: null, registroSanitarioNoRequiere: 0 }),
  ['identificación', 'marca', 'modelo', 'serie', 'ubicación', 'centro de costo', 'clase de riesgo', 'registro sanitario'], 'todo falta, en orden');

// ── Equipo crítico ──────────────────────────────────────────────────────────
es(B.motivosCritico({ subcategoria: 'soporte_vida' }), ['soporte_vida'], 'soporte de vida');
es(B.motivosCritico({ criticidadOperacional: 'alta', claseRiesgo: 'III' }), ['criticidad_alta', 'clase_iii'], 'dos motivos');
es(B.motivosCritico({ criticidadOperacional: 'media', claseRiesgo: 'IIb' }), [], 'no crítico');
si(B.esCritico({ claseRiesgo: 'III' }), 'clase III es crítico');

// ── Calibración ─────────────────────────────────────────────────────────────
const bio = { tipo: 'biomedico', rubro: 'biomedico', estado: 'operativo', requiereCalibracion: false };
es([
  bio, { ...bio, estado: 'baja' }, { tipo: 'general', rubro: 'equipo_general', estado: 'operativo', requiereCalibracion: false },
  { tipo: 'general', rubro: 'equipo_general', estado: 'operativo', requiereCalibracion: true },
  { tipo: 'general', rubro: 'equipo_general', estado: 'operativo', requiereCalibracion: false, esPatron: true },
  { ...bio, calibracionNoAplica: true },
].map(B.aplicaCalibracion), [true, false, false, true, true, false], 'aplicaCalibracion');
const cal = (id, fecha, proxima, resultado = 'conforme', cert = 'r2/cert.pdf') => ({ id, fechaCalibracion: fecha, proximaCalibracion: proxima, resultado, certificadoR2Key: cert });
es(B.infoCalibracion(bio, [], hoy), { estado: 'sin_calibracion', ultima: null, proxima: null, dias: null, calibracionId: null }, 'sin registros');
es(B.infoCalibracion(bio, [cal(1, '2026-05-10', '2027-05-10')], hoy), { estado: 'vigente', ultima: '2026-05-10', proxima: '2027-05-10', dias: 179, calibracionId: 1 }, 'vigente, 179 días');
es(['2026-12-12', '2026-12-13', '2026-11-12', '2026-11-11'].map((p) => B.estadoCalibracion(bio, [cal(1, '2026-05-10', p)], hoy)), ['por_vencer', 'vigente', 'por_vencer', 'vencida'], 'bordes de 30 días');
es(B.estadoCalibracion(bio, [cal(1, '2026-05-10', '2027-05-10', 'conforme', null)], hoy), 'sin_certificado', 'sin certificado');
es(B.estadoCalibracion(bio, [cal(1, '2025-11-01', '2026-11-01', 'conforme', null)], hoy), 'vencida', 'vencida gana a sin certificado');
const nc = B.infoCalibracion(bio, [cal(1, '2026-05-10', '2027-05-10', 'no_conforme')], hoy);
es([nc.estado, nc.proxima], ['no_conforme', null], 'no conforme no tiene próxima');
es(B.estadoCalibracion(bio, [cal(1, '2025-05-10', '2027-05-10'), cal(2, '2026-05-10', '2027-05-10', 'no_conforme')], hoy), 'no_conforme', 'la última manda');
es(B.estadoCalibracion(bio, [cal(1, '2026-05-01', null, 'no_conforme'), cal(2, '2026-05-02', '2027-05-02', 'conforme_con_ajuste')], hoy), 'vigente', 'ajustado después');
es(B.estadoCalibracion(bio, [cal(2, '2026-05-10', '2027-05-10'), cal(1, '2026-05-10', '2027-05-10', 'no_conforme')], hoy), 'vigente', 'empate: id mayor');
es(B.estadoCalibracion(bio, [cal(1, '2026-05-10', null)], hoy), 'vencida', 'conforme sin próxima');
es(B.estadoCalibracion({ ...bio, estado: 'baja' }, [cal(1, '2026-05-10', '2027-05-10')], hoy), 'no_aplica', 'de baja');
es(B.fechasEquipoDesdeCalibraciones([]), { ultimaCalibracion: null, proximaCalibracion: null }, 'copia vacía');
es(B.fechasEquipoDesdeCalibraciones([cal(1, '2026-05-10', '2027-05-10', 'no_conforme')]), { ultimaCalibracion: '2026-05-10', proximaCalibracion: null }, 'copia no conforme');
es(B.fechasEquipoDesdeCalibraciones([cal(1, '2026-05-10', '2027-05-10')]), { ultimaCalibracion: '2026-05-10', proximaCalibracion: '2027-05-10' }, 'copia conforme');
si(B.estaAlDia('por_vencer') && B.estaAlDia('vigente') && !B.estaAlDia('sin_certificado'), 'al día');
es(B.ESTADOS_CALIBRACION, ['vencida', 'no_conforme', 'sin_certificado', 'sin_calibracion', 'por_vencer', 'vigente', 'no_aplica'], 'gravedad');
es(B.ESTADO_CALIBRACION_LABEL.no_aplica, 'No requiere', 'etiqueta no aplica');
const patron = [cal(1, '2026-01-10', '2027-01-10')];
es(['2026-06-01', '2027-01-10', '2027-01-11', '2026-01-09'].map((f) => B.patronVigenteEn(patron, f)),
  [{ vigente: true, hasta: '2027-01-10' }, { vigente: true, hasta: '2027-01-10' }, { vigente: false, hasta: '2027-01-10' }, { vigente: false, hasta: null }], 'patrón en el tiempo');
const patronNc = [...patron, cal(2, '2026-06-01', null, 'no_conforme')];
es(B.patronVigenteEn(patronNc, '2026-07-01'), { vigente: false, hasta: null }, 'no conforme posterior');
es(B.patronVigenteEn(patronNc, '2026-05-31'), { vigente: true, hasta: '2027-01-10' }, 'antes del no conforme');
es(B.patronVigenteEn([cal(1, '2026-01-10', '2027-01-10', 'conforme', null)], '2026-06-01'), { vigente: false, hasta: '2027-01-10' }, 'patrón sin certificado');
const ult = B.ultimaPorEquipo([{ activoId: 1, fecha: '2026-01-01', id: 5 }, { activoId: 1, fecha: '2026-01-01', id: 9 }, { activoId: 1, fecha: '2025-12-31', id: 20 }, { activoId: 2, fecha: '2026-02-01', id: 1 }]);
es([ult.get(1).id, ult.get(2).id], [9, 1], 'ultimaPorEquipo');

// ── Acreditación ────────────────────────────────────────────────────────────
const lab = (o = {}) => ({ esLaboratorioAcreditado: true, acreditacionVigencia: '2027-01-31', acreditacionOrgano: 'OSA', acreditacionNumero: 'LC-012', ...o });
es([lab({ esLaboratorioAcreditado: false }), lab({ acreditacionVigencia: null }), lab({ acreditacionVigencia: '2026-11-11' }), lab({ acreditacionVigencia: '2026-11-12' }), lab({ acreditacionVigencia: '2027-01-11' }), lab({ acreditacionVigencia: '2027-01-12' })]
  .map((p) => B.estadoAcreditacion(p, hoy)), ['no_acreditado', 'sin_vigencia', 'vencida', 'por_vencer', 'por_vencer', 'vigente'], 'estadoAcreditacion 0/60/61');
si(B.acreditadoEn(lab(), hoy), 'acreditado');
no(B.acreditadoEn(lab({ acreditacionVigencia: '2026-11-11' }), hoy), 'vencido no acredita');
es(B.textoAcreditacion(lab()), 'OSA · N.º LC-012 · vigente hasta 31/01/2027', 'texto');
es(B.textoAcreditacion(lab({ acreditacionVigencia: null, acreditacionOrgano: null, acreditacionNumero: null })), 'Órgano sin indicar · sin número · sin vigencia', 'sin datos');
es(B.textoAcreditacion(lab({ esLaboratorioAcreditado: false })), 'No acreditado', 'no acreditado');
const grupos = B.opcionesLaboratorio([
  { id: 1, nombre: 'Beta', ...lab() }, { id: 2, nombre: 'Ávila', ...lab() },
  { id: 3, nombre: 'Gama', ...lab({ acreditacionVigencia: '2026-01-01' }) }, { id: 4, nombre: 'Delta', ...lab({ acreditacionVigencia: null }) },
  { id: 5, nombre: 'Omega', ...lab({ esLaboratorioAcreditado: false }) },
], hoy);
es(grupos.acreditados.map((o) => o.etiqueta), ['Ávila — acreditado hasta 31/01/2027', 'Beta — acreditado hasta 31/01/2027'], 'acreditados por nombre');
es(grupos.vencidos.map((o) => o.etiqueta), ['Delta — acreditación sin vigencia', 'Gama — acreditación vencida el 01/01/2026'], 'vencidos');
es(grupos.otros.map((o) => o.etiqueta), ['Omega'], 'otros');

// ── Documentos y expediente ─────────────────────────────────────────────────
es(B.categoriasDocumentoPara('biomedico').length, 14, 'biomédico ofrece 14');
es(B.categoriasDocumentoPara('equipo_general').length, 10, 'otra área ofrece 10');
no(B.categoriasDocumentoPara('biomedico').some((c) => c.clave === 'manual'), 'la heredada no se ofrece');
for (const vieja of ['ficha_tecnica', 'manual', 'garantia', 'instalacion', 'otro']) si(B.esCategoriaDocumento(vieja), `la categoría anterior «${vieja}» se acepta`);
si(B.esCategoriaDocumento('acta_baja'), 'acta de baja firmada');
no(B.esCategoriaDocumento('pdf'), 'desconocida');
es(B.etiquetaCategoriaDocumento(null), 'Otro', 'null');
es(B.etiquetaCategoriaDocumento('manual'), 'Manual (sin clasificar)', 'heredada');
es(B.etiquetaCategoriaDocumento('instalacion'), 'Acta de instalación o aceptación', 'instalación');
es(B.etiquetaCategoriaDocumento('xyz'), 'xyz', 'desconocida');
const exp = (documentos, extra = {}) => B.completitudExpediente({ documentos, hoy, ...extra });
const vacio = exp([]);
es([vacio.cumplidos, vacio.total, vacio.completo, vacio.faltan.length], [0, 5, false, 5], 'sin nada');
const cinco = [{ categoria: 'manual_operacion' }, { categoria: 'manual_servicio' }, { categoria: 'especificaciones' }, { categoria: 'registro_sanitario', fechaVencimiento: '2027-01-01' }, { categoria: 'instalacion' }];
es([exp(cinco).completo, exp(cinco).porcentaje], [true, 100], 'completo');
const regVencido = exp([...cinco.slice(0, 3), { categoria: 'registro_sanitario', fechaVencimiento: '2026-11-11' }, cinco[4]]);
es([regVencido.cumplidos, regVencido.requisitos[3].estado, regVencido.documentosVencidos, regVencido.faltan], [4, 'vencido', 1, ['Registro sanitario']], 'registro vencido ayer');
si(exp([...cinco.slice(0, 3), { categoria: 'registro_sanitario', fechaVencimiento: '2026-11-12' }, cinco[4]]).completo, 'vence hoy todavía vale');
es(exp(cinco.slice(0, 4), { aceptacionFecha: '2025-03-01' }).requisitos[4].estado, 'aceptacion_registrada', 'aceptación en la ficha');
const na = exp(cinco.filter((d) => d.categoria !== 'registro_sanitario'), { noAplica: [{ requisito: 'registro_sanitario', motivo: 'No es dispositivo médico' }, { requisito: 'xyz' }] });
es([na.completo, na.requisitos[3].estado, na.requisitos[3].motivoNoAplica], [true, 'no_aplica', 'No es dispositivo médico'], 'no aplica');
const soloManual = exp([{ categoria: 'manual' }]);
es([soloManual.requisitos[0].estado, soloManual.sinClasificar], ['falta', 1], 'manual sin clasificar no cuenta');
es(exp([{ categoria: 'ficha_tecnica' }]).requisitos[2].estado, 'con_documento', 'ficha técnica cumple especificaciones');
es(exp([{ categoria: 'registro_sanitario' }], { noAplica: [{ requisito: 'registro_sanitario', motivo: 'x' }] }).requisitos[3].estado, 'con_documento', 'documento gana a no aplica');
// «No requiere registro sanitario» en el inventario: el requisito queda «No aplica» sin marcarlo aparte.
const sinReg = exp(cinco.filter((d) => d.categoria !== 'registro_sanitario'), { registroSanitarioNoRequiere: 1 });
es([sinReg.completo, sinReg.requisitos[3].estado, sinReg.requisitos[3].motivoNoAplica, sinReg.faltan], [true, 'no_aplica', B.MOTIVO_SIN_REGISTRO, []], 'no requiere registro: no aplica');
es(exp([], { registroSanitarioNoRequiere: true }).requisitos.map((r) => r.estado), ['falta', 'falta', 'falta', 'no_aplica', 'falta'], 'solo toca el registro sanitario');
es(exp([], { registroSanitarioNoRequiere: 0 }).requisitos[3].estado, 'falta', '0 = sí requiere');
es(exp([], { registroSanitarioNoRequiere: true, noAplica: [{ requisito: 'registro_sanitario', motivo: 'Marcado a mano' }] }).requisitos[3].motivoNoAplica, 'Marcado a mano', 'el «No aplica» del expediente conserva su motivo');
es(exp([{ categoria: 'registro_sanitario', fechaVencimiento: '2026-01-01' }], { registroSanitarioNoRequiere: true }).requisitos[3].estado, 'no_aplica', 'registro vencido de un equipo que ya no lo requiere');
es(exp([{ categoria: 'registro_sanitario' }], { registroSanitarioNoRequiere: true }).requisitos[3].estado, 'con_documento', 'el documento sigue ganando');
es(exp([{ categoria: 'garantia', fechaVencimiento: '2026-01-01' }, { categoria: 'limpieza_desinfeccion' }]).recomendados.map((r) => r.tiene), [true, false], 'recomendados');

// ── Archivos ────────────────────────────────────────────────────────────────
const bytes = (...xs) => new Uint8Array(xs.flatMap((x) => (typeof x === 'string' ? [...Buffer.from(x, 'latin1')] : [x])));
es(B.detectarTipoArchivo(bytes('%PDF-1.7\n')), 'application/pdf', 'pdf');
es(B.detectarTipoArchivo(bytes('basura antes ', '%PDF-1.4')), 'application/pdf', 'pdf con basura delante');
es(B.detectarTipoArchivo(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg', 'jpg');
es(B.detectarTipoArchivo(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png', 'png');
es(B.detectarTipoArchivo(bytes('RIFF', 0, 0, 0, 0, 'WEBP')), 'image/webp', 'webp');
for (const [nombre, b] of [['html', bytes('<html><script>')], ['gif', bytes('GIF89a')], ['zip', bytes('PK', 3, 4)], ['vacío', bytes()], ['wav', bytes('RIFF', 0, 0, 0, 0, 'WAVE')], ['%PD', bytes('%PD')]]) es(B.detectarTipoArchivo(b), null, nombre);
es(B.validarArchivo({ tamano: 0, cabecera: bytes('%PDF-') }), { ok: false, status: 400, error: 'El archivo está vacío.' }, 'vacío');
es(B.validarArchivo({ tamano: 15 * 1024 * 1024 + 1, cabecera: bytes('%PDF-') }).status, 413, 'más de 15 MB');
es(B.validarArchivo({ tamano: 15 * 1024 * 1024, cabecera: bytes('%PDF-') }), { ok: true, contentType: 'application/pdf', extension: 'pdf' }, '15 MB exactos');
es(B.validarArchivo({ tamano: 10, cabecera: bytes('<html>') }), { ok: false, status: 415, error: 'Solo se aceptan archivos PDF o fotos (JPG, PNG o WEBP).' }, 'html renombrado');
es(['application/pdf', 'image/jpeg; charset=x', 'text/html', null].map(B.esTipoArchivoPermitido), [true, true, false, false], 'tipos permitidos');
es(B.nombreSeguroR2('Manual de servicio (v2).pdf'), 'Manual_de_servicio_v2_.pdf', 'paréntesis');
es(B.nombreSeguroR2('Protocolo de limpieza (v2).pdf'), 'Protocolo_de_limpieza_v2_.pdf', 'protocolo');
es(B.nombreSeguroR2('Baja de equipos – versión 1.pdf'), 'Baja_de_equipos_version_1.pdf', 'tildes y raya');
es(B.nombreSeguroR2('Boletín FSN 12/2026.pdf'), 'Boletin_FSN_12_2026.pdf', 'barra');
es(B.nombreSeguroR2('%%%'), 'archivo', 'nada útil');
es(B.nombreSeguroR2(''), 'archivo', 'vacío');
es(B.nombreSeguroR2('a'.repeat(100) + '.pdf'), 'a'.repeat(76) + '.pdf', 'largo conserva la extensión');
es(B.contentDisposition('Manual ñ.pdf'), `inline; filename="Manual _.pdf"; filename*=UTF-8''Manual%20%C3%B1.pdf`, 'disposition');
es(B.contentDisposition(`O'Brien "1".pdf`, 'attachment'), `attachment; filename="O'Brien _1_.pdf"; filename*=UTF-8''O%27Brien%20%221%22.pdf`, 'comillas');
es(B.ARCHIVO_ACCEPT, '.pdf,.jpg,.jpeg,.png,.webp', 'accept');

// ── Licencias ───────────────────────────────────────────────────────────────
const lic = (estado, fechaVencimiento, op) => B.situacionLicencia({ estado, fechaVencimiento }, hoy, op);
es(lic('activa', '2027-06-30').clave, 'vigente', 'vigente');
es(lic('activa', '2026-12-01'), { clave: 'vence_30', etiqueta: 'Vence en ≤ 30 días', color: 'bg-red-100 text-red-700', dias: 19, texto: 'Vence en 19 días', vigente: true }, 'vence en 19 días');
es([lic('activa', '2026-11-01').clave, lic('activa', '2026-11-01').texto, lic('activa', '2026-11-01').vigente], ['vencida', 'Venció hace 11 días', false], 'vencida');
es([lic('activa', null).clave, lic('activa', null).texto, lic('activa', null).vigente], ['sin_fecha', 'No vence', true], 'no vence');
es(['en_tramite', 'reemplazada', 'anulada'].map((e) => [lic(e, '2027-01-01').clave, lic(e, '2027-01-01').vigente]), [['en_tramite', false], ['reemplazada', false], ['anulada', false]], 'estados fijos');
es(lic('activa', '2026-11-01', { renovacionEnTramite: true }).texto, 'Venció hace 11 días · renovación en trámite', 'renovación en trámite');
es(Object.entries(B.SITUACION_LICENCIA).sort((a, b) => a[1].orden - b[1].orden).map(([k]) => k), ['vencida', 'vence_30', 'vence_60', 'vence_90', 'vigente', 'sin_fecha', 'en_tramite', 'reemplazada', 'anulada'], 'orden');

// ── Seguridad eléctrica ─────────────────────────────────────────────────────
const lim = (c, p, m) => Object.values(B.limitesIec62353(c, p, m));
es(lim('I', 'BF'), [0.3, 2, 500, 5000], 'I/BF');
es(lim('I', 'CF', 'alternativo'), [0.3, 2, 1000, 50], 'I/CF alternativo');
es(lim('II', 'B'), [null, 7, 100, null], 'II/B');
es(lim('II', 'CF', 'alternativo'), [null, 7, 500, 50], 'II/CF alternativo');
es(lim('interna', 'CF'), [null, null, null, 50], 'interna/CF');
es(lim('interna', 'ninguna'), [null, null, null, null], 'interna/ninguna');
const med = (o) => ({ inspeccionVisual: 'conforme', pruebaFuncional: 'conforme', tierraOhm: 0.12, aislamientoMohm: 50, fugaEquipoUa: 120, fugaParteUa: 15, ...o });
const ev = (o, c = 'I', p = 'BF', m) => B.evaluarPruebaIec62353(med(o), c, p, m);
es([ev({}).resultado, ev({}).faltan, ev({}).fuera], ['pasa', [], []], 'I/BF bien');
es(ev({ tierraOhm: 0.3 }).resultado, 'pasa', 'borde de tierra');
es([ev({ tierraOhm: 0.31 }).resultado, ev({ tierraOhm: 0.31 }).fuera], ['no_pasa', ['Resistencia de tierra (Ω)']], 'tierra alta');
es(ev({ fugaParteUa: 60 }, 'I', 'CF').fuera, ['Fuga de parte aplicada (µA)'], 'CF 60 µA');
es([ev({ fugaEquipoUa: 150, fugaParteUa: 20 }, 'II', 'BF').resultado, ev({ fugaEquipoUa: 150, fugaParteUa: 20 }, 'II', 'BF', 'alternativo').resultado], ['no_pasa', 'pasa'], 'II/BF directo y alternativo');
es([ev({ tierraOhm: null, fugaParteUa: null }, 'I', 'B').resultado, ev({ tierraOhm: null, fugaParteUa: null }, 'I', 'B').faltan], [null, ['Resistencia de tierra (Ω)']], 'falta la tierra');
const iiB = ev({ tierraOhm: 5, fugaEquipoUa: 40, fugaParteUa: null }, 'II', 'B');
es([iiB.resultado, iiB.aplica.tierra], ['pasa', false], 'tierra que no aplica se ignora');
es(B.evaluarPruebaIec62353({ inspeccionVisual: 'conforme', pruebaFuncional: 'conforme', tierraOhm: null, aislamientoMohm: null, fugaEquipoUa: null, fugaParteUa: null }, 'interna', 'ninguna').resultado, 'pasa', 'batería sin parte aplicada');
es(ev({ inspeccionVisual: 'no_conforme' }).fuera, ['Inspección visual'], 'inspección no conforme');
es([ev({ aislamientoMohm: 1.5 }).resultado, ev({ aislamientoMohm: null }).faltan], ['no_pasa', []], 'aislamiento opcional');
es(B.validarResultadoConfirmado('pasa', 'no_pasa', 'Cable con aislamiento dañado'), { ok: true }, 'no pasa con motivo');
es(B.validarResultadoConfirmado('no_pasa', 'pasa'), { ok: false, error: 'Hay valores fuera de límite: la prueba no puede quedar como «Pasa».' }, 'no se fuerza pasa');
es(B.validarResultadoConfirmado('pasa', 'no_pasa', ' corto '), { ok: false, error: 'Explica por qué no pasa (al menos 10 letras).' }, 'motivo corto');
const se = (proximaFecha, resultado = 'pasa') => B.estadoSeguridadElectrica({ resultado, proximaFecha }, hoy);
es(['2027-11-12', '2026-12-12', '2026-12-13', '2026-11-12', '2026-11-11'].map((p) => se(p)), ['vigente', 'por_vencer', 'vigente', 'por_vencer', 'vencida'], 'vigencia de la prueba');
es([se('2027-11-12', 'no_pasa'), B.estadoSeguridadElectrica(null, hoy)], ['no_pasa', 'sin_prueba'], 'no pasa y sin prueba');
es(['vigente', 'por_vencer', 'vencida', 'no_pasa', 'sin_prueba'].map(B.cumpleSeguridadElectrica), [true, true, false, false, false], 'cumple');
for (const [lista, etiquetas] of [[B.TIPOS_PRUEBA_ELECTRICA, B.TIPO_PRUEBA_ELECTRICA_LABEL], [B.CLASES_PROTECCION, B.CLASE_PROTECCION_LABEL], [B.PARTES_APLICADAS, B.PARTE_APLICADA_LABEL], [B.METODOS_FUGA, B.METODO_FUGA_LABEL]]) es(Object.keys(etiquetas), [...lista], 'etiquetas completas');
es(B.lecturasDesdeChecklist([{ texto: 'Medir resistencia de tierra de protección', estado: 'ok', valorMedido: '0,12' }]), { tierraOhm: 0.12 }, 'tierra con coma');
es(B.lecturasDesdeChecklist([{ texto: 'Medir corriente de fuga del equipo', estado: 'ok', valorMedido: '120' }, { texto: 'Medir corriente de fuga de partes aplicadas (si aplica)', estado: 'ok', valorMedido: '1,200' }]), { fugaEquipoUa: 120 }, 'lo ambiguo no se copia');
es(B.lecturasDesdeChecklist([{ texto: 'Medir resistencia de tierra de protección', estado: 'na', valorMedido: '0,1' }]), {}, 'no aplica');
es(B.lecturasDesdeChecklist([{ texto: 'Inspección visual: carcasa, cable de alimentación, conectores y accesorios sin daños', estado: 'desviacion' }]), { inspeccionVisual: 'no_conforme' }, 'inspección con desviación');
es(B.lecturasDesdeChecklist([{ texto: 'Prueba funcional del equipo posterior a las mediciones', estado: 'ok' }, { texto: 'Medir resistencia de aislamiento', estado: 'ok', valorMedido: '-3' }]), { pruebaFuncional: 'conforme' }, 'negativo no se copia');

// ── Capacitaciones, alertas y frecuencias ───────────────────────────────────
es([B.capacitacionVigente(['2024-11-12'], hoy), B.capacitacionVigente(['2024-11-11'], hoy), B.capacitacionVigente([], hoy)], [true, false, false], '24 meses');
es(B.TIPO_ALERTA_LABEL.retiro, 'Retiro (recall)', 'tipo de alerta');
es(B.APLICABILIDAD_LABEL, { pendiente: 'Sin análisis', aplica: 'Aplica', no_aplica: 'No aplica' }, 'aplicabilidad');
si(B.ALERTA_BADGE.aplica.includes('red') && B.ALERTA_BADGE.pendiente.includes('slate'), 'insignias');
es(B.FRECUENCIAS_RUTINA_EQUIPO.length, 9, 'nueve frecuencias');
no(B.FRECUENCIAS_RUTINA_EQUIPO.includes('turno'), 'sin «Por turno»');
si(B.FRECUENCIAS_RUTINA_EQUIPO.includes('cuatrimestral'), 'con cuatrimestral');
es(['turno', 'cuatrimestral', null, 'xyz'].map(B.etiquetaFrecuencia), ['Por turno', 'Cuatrimestral', '—', 'xyz'], 'etiquetaFrecuencia');

// ── Migración 0059, schema.ts y bitácora en lote ────────────────────────────
// La 0059 se aplica como la recibe D1: dividida por Wrangler, una sentencia a la vez.
const h = await setupConjuntos({
  modules: { auditoria: 'lib/audit' },
  migrationStatements: (nombre, source) => {
    if (!nombre.startsWith('0059_')) return [source];
    const sentencias = unstable_splitSqlQuery(source);
    es(sentencias.length, 76, 'Wrangler divide la 0059 en 76 sentencias completas');
    return sentencias;
  },
});
try {
  const db = h.sqlite;
  // schema.ts y el SQL dicen lo mismo en las tablas que toca la fase.
  const sch = await build({ stdin: { contents: `export * as schema from './src/lib/schema';\nexport { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';\nexport { is } from 'drizzle-orm';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  const S = await import(`data:text/javascript;base64,${Buffer.from(sch.outputFiles[0].text).toString('base64')}`);
  const fase59 = ['centros_costo', 'activos', 'proveedores', 'calibraciones', 'activo_documentos', 'alertas_equipo', 'alertas_equipo_activos', 'planes_mantenimiento', 'procedimientos',
    'activo_bajas', 'activo_expediente_na', 'licencias', 'licencia_archivos', 'capacitaciones', 'capacitacion_equipos', 'capacitacion_asistentes', 'capacitacion_archivos',
    'alerta_adjuntos', 'plan_aprobaciones', 'pruebas_seguridad_electrica', 'orden_incidentes'];
  const configs = new Map(Object.values(S.schema).filter((t) => S.is(t, S.SQLiteTable)).map((t) => { const c = S.getTableConfig(t); return [c.name, c]; }));
  for (const tabla of fase59) {
    const cfg = configs.get(tabla);
    assert(cfg, `schema.ts define ${tabla}`);
    const sql = new Map(db.prepare(`PRAGMA table_info("${tabla}")`).all().map((c) => [c.name, c]));
    es([...sql.keys()].sort(), cfg.columns.map((c) => c.name).sort(), `${tabla}: mismas columnas`);
    for (const c of cfg.columns) {
      const s = sql.get(c.name);
      if (!c.primary) es([c.notNull, c.default !== undefined], [!!s.notnull, s.dflt_value !== null], `${tabla}.${c.name}: NOT NULL y DEFAULT`);
    }
  }
  es(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('activos')").get().n, 53, 'activos queda con 53 columnas (D1 corta en 100)');

  // Índice parcial: una sola baja vigente por equipo; revertida permite otra.
  db.prepare("INSERT INTO activos (id, codigo, nombre, tipo, rubro) VALUES (900, 'BIO-900', 'MONITOR', 'biomedico', 'biomedico')").run();
  const baja = (estado) => db.prepare(`INSERT INTO activo_bajas (activo_id, estado, fecha_baja, motivo, motivo_detalle, evaluacion_tecnica, evaluado_por, autoriza_nombre, autoriza_cargo, destino_final, residuos_baterias, estado_anterior, registrado_por, registrado_por_nombre)
    VALUES (900, ?, '2026-11-12', 'obsolescencia', 'detalle', 'evaluación', 'X', 'Y', 'Z', 'descarte', 'No aplica', 'operativo', 1, 'Prueba')`).run(estado);
  baja('vigente');
  n++; assert.throws(() => baja('vigente'), /UNIQUE/, 'dos bajas vigentes');
  db.prepare("UPDATE activo_bajas SET estado = 'revertida' WHERE activo_id = 900").run();
  baja('vigente');
  n++; assert.throws(() => db.prepare("INSERT INTO activo_bajas (activo_id, estado, fecha_baja, motivo, motivo_detalle, evaluacion_tecnica, evaluado_por, autoriza_nombre, autoriza_cargo, destino_final, residuos_baterias, estado_anterior, registrado_por, registrado_por_nombre) VALUES (900, 'otra', '2026-11-12', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 1, 'x')").run(), /CHECK/, 'estado de baja fuera de la lista');
  n++; assert.throws(() => db.prepare('DELETE FROM activos WHERE id = 900').run(), /FOREIGN KEY/, 'un equipo con baja no se borra');

  // Cada vínculo de HISTORIAL_ACTIVO existe y se puede consultar por activo_id.
  for (const v of B.HISTORIAL_ACTIVO) {
    const fila = db.prepare(`SELECT EXISTS(SELECT 1 FROM ${v.tabla} WHERE ${v.columna} = ?) AS hay`).get(900);
    es(typeof fila.hay, 'number', `${v.tabla}.${v.columna}`);
  }
  es(db.prepare(`SELECT ${B.HISTORIAL_ACTIVO.map((v, i) => `EXISTS(SELECT 1 FROM ${v.tabla} WHERE ${v.columna} = ?1) AS h${i}`).join(', ')}`).get(900).h5, 1, 'una sola consulta con todos los vínculos');

  // Plantilla IEC 62353: en una base nueva la 0046 ya la creó; la 0059 completa las lecturas.
  const plantillas = db.prepare("SELECT id FROM checklist_plantillas WHERE nombre = 'Seguridad eléctrica IEC 62353'").all();
  es(plantillas.length, 1, 'una sola plantilla IEC 62353');
  const pasos = db.prepare('SELECT orden, bloqueante, requiere_valor, unidad, valor_esperado_max FROM checklist_plantilla_items WHERE plantilla_id = ? ORDER BY orden').all(plantillas[0].id);
  es(pasos.map((p) => [p.orden, p.bloqueante, p.requiere_valor, p.unidad, p.valor_esperado_max]), [
    [1, 1, 0, null, null], [2, 0, 0, null, null], [3, 0, 1, 'Ω', 0.3], [4, 0, 1, 'MΩ', null],
    [5, 0, 1, 'µA', null], [6, 0, 1, 'µA', null], [7, 1, 0, null, null], [8, 0, 0, null, null],
  ], 'pasos con lectura, rango y críticos');
  es(db.prepare("SELECT valor FROM app_config WHERE clave = 'bio.seguridad_electrica.meses'").get().valor, '12', 'periodicidad');

  // Bitácora en lote: 31 líneas en 3 INSERT de un solo lote; 0 entradas no consultan.
  const ctx = h.ctx('/prueba');
  const antes = h.queries.length, lotes = h.faults.batchCount;
  await h.app.auditoria.logAuditLote(ctx, Array.from({ length: 31 }, (_, i) => ({ entidad: 'orden', entidadId: i + 1, accion: 'delete', resumen: `Borrado de prueba ${i + 1}`, cambios: i === 0 ? { estado: { antes: 'abierta', despues: null } } : undefined })));
  es(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE resumen LIKE 'Borrado de prueba %'").get().n, 31, '31 líneas');
  es(h.queries.slice(antes).filter((q) => /insert into "audit_log"/i.test(q.sql)).length, 3, 'tres INSERT de hasta 15 filas');
  es(h.faults.batchCount - lotes, 1, 'un solo lote');
  es(JSON.parse(db.prepare("SELECT cambios FROM audit_log WHERE resumen = 'Borrado de prueba 1'").get().cambios), { estado: { antes: 'abierta', despues: null } }, 'cambios en JSON');
  const antes2 = h.queries.length;
  await h.app.auditoria.logAuditLote(ctx, []);
  es(h.queries.length, antes2, 'sin entradas no consulta');
  await h.app.auditoria.logAuditLote({ locals: {} }, [{ entidad: 'orden', entidadId: 1, accion: 'delete' }]);
  n++; // sin base no corta la operación
} finally {
  await h.close();
}

console.log(`PASS test-bio-base: ${n} casos; fechas en El Salvador, reglas comunes, migración 0059 = schema.ts y bitácora en lote.`);
