// Fase 59 · WP-A: filtros del inventario (src/lib/inventario-filtros.ts), sin base de
// datos. Los usan igual la lista, la impresión y la descarga (contrato K-A2), además
// de los ayudantes de código y serie de src/lib/registro-activos.ts.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const cargar = async (archivo) => {
  const out = await build({ entryPoints: [archivo], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};
const F = await cargar('src/lib/inventario-filtros.ts');
const R = await cargar('src/lib/registro-activos.ts');

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const p = (q) => new URLSearchParams(q);

// ── leerFiltrosInventario ───────────────────────────────────────────────────
const vacios = { area: null, sucursal: null, ubicacion: null, criticidad: null, categoria: null, tipo: null, clase: null, centro: null, registro: null, q: null };
es(F.leerFiltrosInventario(p(''), { estadoPorDefecto: 'vigentes' }), { ...vacios, estado: 'vigentes' }, 'por defecto vigentes (lista)');
es(F.leerFiltrosInventario(p(''), { estadoPorDefecto: 'todos' }), { ...vacios, estado: 'todos' }, 'por defecto todos (descarga)');
es(F.leerFiltrosInventario(p('area=biomedico&estado=baja&clase=III&centro=4&registro=vencido&sucursal=2&ubicacion=9&criticidad=alta&categoria=Desfibriladores&tipo=biomedico&q=sn%20123'), { estadoPorDefecto: 'vigentes' }),
  { area: 'biomedico', estado: 'baja', clase: 'III', centro: 4, registro: 'vencido', sucursal: 2, ubicacion: 9, criticidad: 'alta', categoria: 'Desfibriladores', tipo: 'biomedico', q: 'sn 123' },
  'todos los filtros');
es(F.leerFiltrosInventario(p('area=otra&estado=roto&clase=IV&centro=-1&registro=x&sucursal=abc&criticidad=urgente&tipo=x'), { estadoPorDefecto: 'vigentes' }),
  { ...vacios, estado: 'vigentes' }, 'valores desconocidos: como si no vinieran');
es(F.leerFiltrosInventario(p('clase=sin&centro=sin'), { estadoPorDefecto: 'todos' }).clase, 'sin', 'clase=sin');
es(F.leerFiltrosInventario(p('clase=sin&centro=sin'), { estadoPorDefecto: 'todos' }).centro, 'sin', 'centro=sin');
es(F.leerFiltrosInventario(p('estado=todos'), { estadoPorDefecto: 'vigentes' }).estado, 'todos', 'estado=todos explícito');

// ── filtrosAQuery: ida y vuelta ─────────────────────────────────────────────
const ida = F.leerFiltrosInventario(p('q=monitor&area=biomedico&clase=sin&centro=3&registro=sin_registro&sucursal=1'), { estadoPorDefecto: 'vigentes' });
const query = F.filtrosAQuery(ida);
es(query, 'area=biomedico&estado=vigentes&clase=sin&centro=3&registro=sin_registro&sucursal=1&q=monitor', 'sin «?», con estado y sin vacíos');
es(F.leerFiltrosInventario(p(query), { estadoPorDefecto: 'todos' }), ida, 'ida y vuelta');
es(F.filtrosAQuery(F.leerFiltrosInventario(p(''), { estadoPorDefecto: 'todos' })), 'estado=todos', 'siempre incluye el estado');

// ── pasaFiltros ─────────────────────────────────────────────────────────────
const hoy = '2026-11-12';
const fila = (a, extra = {}) => F.aFilaInventario({
  a: { id: 1, codigo: 'BIO-1', nombre: 'MONITOR', tipo: 'biomedico', rubro: 'biomedico', estado: 'operativo', claseRiesgo: 'III', centroCostoId: 5,
    serial: 'SN-123', numeroActivo: 'AF-77', registroSanitario: 'DNM-1', registroSanitarioVencimiento: '2026-11-11', criticidadOperacional: 'alta', ...a },
  ub: { id: 9, nombre: 'UCI' }, suc: { id: 2, nombre: 'Sede Norte' }, cc: { id: 5, codigo: 'CC-05', nombre: 'Intensivos' }, ...extra,
});
const filtros = (q, defecto = 'vigentes') => F.leerFiltrosInventario(p(q), { estadoPorDefecto: defecto });
const pasa = (f, q, defecto) => F.pasaFiltros(f, filtros(q, defecto), hoy);
const viva = fila({});
const baja = fila({ estado: 'baja' });
es([pasa(viva, ''), pasa(baja, '')], [true, false], 'vigentes deja fuera la baja');
es([pasa(viva, 'estado=baja'), pasa(baja, 'estado=baja')], [false, true], 'solo las bajas');
es([pasa(viva, '', 'todos'), pasa(baja, '', 'todos')], [true, true], 'todos');
es(pasa(viva, 'estado=averiado'), false, 'otro estado');
const sinClase = fila({ claseRiesgo: null });
const generalSinClase = fila({ claseRiesgo: null, tipo: 'general', rubro: 'equipo_general' });
es([pasa(sinClase, 'clase=sin'), pasa(viva, 'clase=sin'), pasa(generalSinClase, 'clase=sin')], [true, false, false], 'clase=sin = biomédico sin clase');
es([pasa(viva, 'clase=III'), pasa(viva, 'clase=I')], [true, false], 'clase exacta');
const sinCentro = fila({ centroCostoId: null }, { cc: null });
es([pasa(sinCentro, 'centro=sin'), pasa(viva, 'centro=sin'), pasa(viva, 'centro=5'), pasa(viva, 'centro=6')], [true, false, true, false], 'centro');
es(pasa(viva, 'registro=vencido'), true, 'registro vencido (venció ayer)');
es(pasa(fila({ registroSanitarioVencimiento: '2026-11-12' }), 'registro=por_vencer'), true, 'vence hoy: por vencer');
es(pasa(fila({ registroSanitario: null }), 'registro=sin_registro'), true, 'sin registro');
es(pasa(fila({ registroSanitarioNoRequiere: 1 }), 'registro=no_requiere'), true, 'no requiere');
es(pasa(fila({ tipo: 'general', rubro: 'equipo_general', registroSanitario: null }), 'registro=sin_registro'), false, 'el registro solo filtra biomédicos');
es([pasa(viva, 'q=sn 123'), pasa(viva, 'q=SN-123'), pasa(viva, 'q=af-77'), pasa(viva, 'q=intensivos'), pasa(viva, 'q=sede norte'), pasa(viva, 'q=bomba')],
  [false, true, true, true, true, false], 'q busca serie, número de activo, centro y sede');
es(pasa(fila({ nombre: 'MÓDULO DE CÁMARA' }), 'q=modulo de camara'), true, 'q sin tildes');
es([pasa(viva, 'area=biomedico'), pasa(viva, 'area=aires')], [true, false], 'área');
es(pasa(fila({ rubro: null, tipo: 'biomedico' }), 'area=biomedico'), true, 'área de un registro sin clasificar (por tipo)');
es([pasa(viva, 'sucursal=2'), pasa(viva, 'sucursal=3'), pasa(viva, 'ubicacion=9'), pasa(viva, 'ubicacion=8')], [true, false, true, false], 'sede y ubicación');
es([pasa(viva, 'criticidad=alta'), pasa(viva, 'criticidad=baja')], [true, false], 'criticidad');
es(pasa(fila({ categoria: 'Monitores de signos vitales' }), 'categoria=Monitores de signos vitales'), true, 'categoría normalizada');

// ── textoBusqueda y describirFiltros ────────────────────────────────────────
es(F.textoBusqueda(viva), 'bio-1 monitor sn-123 af-77 sede norte uci cc-05 intensivos', 'texto de búsqueda');
es(F.describirFiltros(filtros('clase=III&centro=5&sucursal=2'), { centro: 'CC-05', sucursal: 'Sede Central' }), 'Vigentes (sin bajas) · Clase III · Centro CC-05 · Sede Sede Central', 'describir filtros');
es(F.describirFiltros(filtros('estado=baja&clase=sin&centro=sin&registro=vencido&q=x')), 'Dados de baja · Sin clase de riesgo · Sin centro de costo · Registro sanitario: vencido · Búsqueda «x»', 'describir sin valores');
es(F.describirFiltros(filtros('', 'todos')), 'Todos', 'describir todos');

// ── Código y serie (registro-activos.ts) ────────────────────────────────────
es(R.errorCodigoActivo('BIO-001'), null, 'código válido');
es(R.errorCodigoActivo('X'.repeat(60)), null, '60 caracteres');
es(R.errorCodigoActivo('X'.repeat(61)), 'El código no puede tener más de 60 caracteres.', 'más de 60');
es(R.errorCodigoActivo('BIO\t001'), 'El código no puede tener tabuladores ni saltos de línea.', 'tabulador');
es(R.errorCodigoActivo('BIO\n001'), 'El código no puede tener tabuladores ni saltos de línea.', 'salto de línea');
es(R.mensajeCodigoDuplicado('BIO-1'), 'El código «BIO-1» ya está en uso en otro equipo.', 'mensaje de duplicado');
es(R.normalizarSerie(' sn-123 '), 'SN123', 'serie normalizada');
es(R.normalizarSerie('Ñandú-9á'), 'NANDU9A', 'sin acentos');
for (const s of ['', null, 'AB', '000', 'xxxx', 'S/N', 'N/A', 'sin serie', 'Sin número', 'no tiene', 'ilegible', 'PENDIENTE', 'desconocido', '0-0-0']) {
  es(R.normalizarSerie(s), null, `«${s}» no sirve para comparar`);
}

console.log(`PASS test-bio-inventario: ${n} casos`);
