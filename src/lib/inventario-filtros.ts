// Fase 59 · Filtros del inventario. Los entienden igual la lista (/activos), la
// impresión (/activos/imprimir) y la descarga (GET /api/reportes/equipos): lo que
// se ve en pantalla es lo que se imprime y lo que se descarga.
//
// Puro: sin base de datos. Parámetros por URL (contrato K-A2): area, estado,
// clase, centro, registro, sucursal, ubicacion, criticidad, categoria, tipo y q.
import {
  CLASES_RIESGO_VALORES, ESTADOS_ACTIVO, ESTADO_ACTIVO_LABEL, ESTADO_REGISTRO_LABEL,
  estadoRegistroSanitario, etiquetaCentroCosto, normalizarTexto,
  type ClaseRiesgo, type EstadoActivo, type EstadoRegistro,
} from "./biomedico";
import { RUBROS, rubroDeActivo, type RubroKey } from "./rubros";
import { normalizarCategoria } from "./categorias-equipos";

export type FiltroEstado = "vigentes" | "todos" | EstadoActivo;
export type Criticidad = "alta" | "media" | "baja";

export interface FiltrosInventario {
  area: RubroKey | null;
  sucursal: number | null;
  ubicacion: number | null;
  criticidad: Criticidad | null;
  categoria: string | null;
  tipo: "general" | "biomedico" | null;
  estado: FiltroEstado;
  clase: ClaseRiesgo | "sin" | null;
  centro: number | "sin" | null;
  registro: EstadoRegistro | null;
  q: string | null;
}

export const ESTADOS_REGISTRO: readonly EstadoRegistro[] = ["vigente", "por_vencer", "vencido", "sin_vencimiento", "sin_registro", "no_requiere"];
const CRITICIDADES: readonly Criticidad[] = ["alta", "media", "baja"];

/** Etiquetas del select «Estado» (la de «vigentes» es la opción por defecto de la lista). */
export const FILTRO_ESTADO_LABEL: Record<FiltroEstado, string> = {
  vigentes: "Vigentes (sin bajas)",
  todos: "Todos",
  operativo: "Operativo",
  averiado: "Averiado",
  mantenimiento: "En mantenimiento",
  baja: "Dados de baja",
};

const entero = (v: string | null): number | null => {
  if (!v || !/^\d{1,9}$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return n > 0 ? n : null;
};

/** Lee los filtros de la URL. Un valor desconocido se trata como ausente. */
export function leerFiltrosInventario(p: URLSearchParams, opciones: { estadoPorDefecto: "vigentes" | "todos" }): FiltrosInventario {
  const texto = (k: string) => {
    const v = p.get(k);
    return v && v.trim() ? v.trim() : null;
  };
  const area = texto("area");
  const estado = texto("estado");
  const clase = texto("clase");
  const centro = texto("centro");
  const registro = texto("registro");
  const criticidad = texto("criticidad");
  const tipo = texto("tipo");
  const q = texto("q");
  return {
    area: area && area in RUBROS ? (area as RubroKey) : null,
    sucursal: entero(texto("sucursal")),
    ubicacion: entero(texto("ubicacion")),
    criticidad: criticidad && (CRITICIDADES as readonly string[]).includes(criticidad) ? (criticidad as Criticidad) : null,
    categoria: texto("categoria")?.slice(0, 200) ?? null,
    tipo: tipo === "general" || tipo === "biomedico" ? tipo : null,
    estado: estado === "vigentes" || estado === "todos" || (ESTADOS_ACTIVO as readonly string[]).includes(estado ?? "")
      ? (estado as FiltroEstado) : opciones.estadoPorDefecto,
    clase: clase === "sin" ? "sin" : clase && (CLASES_RIESGO_VALORES as readonly string[]).includes(clase) ? (clase as ClaseRiesgo) : null,
    centro: centro === "sin" ? "sin" : entero(centro),
    registro: registro && (ESTADOS_REGISTRO as readonly string[]).includes(registro) ? (registro as EstadoRegistro) : null,
    q: q ? q.slice(0, 200) : null,
  };
}

/** Los filtros como query string, sin «?». Omite lo vacío y siempre incluye el estado. */
export function filtrosAQuery(f: FiltrosInventario): string {
  const p = new URLSearchParams();
  if (f.area) p.set("area", f.area);
  p.set("estado", f.estado);
  if (f.clase) p.set("clase", f.clase);
  if (f.centro != null) p.set("centro", String(f.centro));
  if (f.registro) p.set("registro", f.registro);
  if (f.sucursal != null) p.set("sucursal", String(f.sucursal));
  if (f.ubicacion != null) p.set("ubicacion", String(f.ubicacion));
  if (f.criticidad) p.set("criticidad", f.criticidad);
  if (f.categoria) p.set("categoria", f.categoria);
  if (f.tipo) p.set("tipo", f.tipo);
  if (f.q) p.set("q", f.q);
  return p.toString();
}

/** Lo mínimo del equipo que usan los filtros (sirve una fila completa de activos). */
export interface ActivoParaFiltro {
  id: number;
  codigo: string;
  nombre: string;
  numeroActivo?: string | null;
  marca?: string | null;
  modelo?: string | null;
  serial?: string | null;
  categoria?: string | null;
  tipo: string;
  rubro?: string | null;
  estado: string;
  criticidadOperacional?: string | null;
  claseRiesgo?: string | null;
  ubicacion?: string | null;
  ubicacionId?: number | null;
  centroCostoId?: number | null;
  registroSanitario?: string | null;
  registroSanitarioNoRequiere?: boolean | number | null;
  registroSanitarioVencimiento?: string | null;
}

export interface FilaInventario {
  id: number;
  codigo: string;
  nombre: string;
  numeroActivo: string | null;
  marca: string | null;
  modelo: string | null;
  serial: string | null;
  categoria: string;
  tipo: string;
  area: RubroKey;
  estado: string;
  criticidad: string | null;
  claseRiesgo: string | null;
  detalleUbicacion: string | null;
  ubicacionId: number | null;
  ubicacionNombre: string | null;
  sucursalId: number | null;
  sucursalNombre: string | null;
  centroCostoId: number | null;
  centroCodigo: string | null;
  centroNombre: string | null;
  registroSanitario: string | null;
  registroSanitarioNoRequiere: boolean;
  registroSanitarioVencimiento: string | null;
}

export function aFilaInventario(r: {
  a: ActivoParaFiltro;
  ub?: { id: number; nombre: string } | null;
  suc?: { id: number; nombre: string } | null;
  cc?: { id: number; codigo: string; nombre: string } | null;
}): FilaInventario {
  const a = r.a;
  return {
    id: a.id,
    codigo: a.codigo,
    nombre: a.nombre,
    numeroActivo: a.numeroActivo ?? null,
    marca: a.marca ?? null,
    modelo: a.modelo ?? null,
    serial: a.serial ?? null,
    categoria: normalizarCategoria(a.categoria, a.tipo, a.rubro),
    tipo: a.tipo,
    area: rubroDeActivo(a.rubro, a.tipo),
    estado: a.estado,
    criticidad: a.criticidadOperacional ?? null,
    claseRiesgo: a.claseRiesgo ?? null,
    detalleUbicacion: a.ubicacion ?? null,
    ubicacionId: r.ub?.id ?? a.ubicacionId ?? null,
    ubicacionNombre: r.ub?.nombre ?? null,
    sucursalId: r.suc?.id ?? null,
    sucursalNombre: r.suc?.nombre ?? null,
    centroCostoId: a.centroCostoId ?? r.cc?.id ?? null,
    centroCodigo: r.cc?.codigo ?? null,
    centroNombre: r.cc?.nombre ?? null,
    registroSanitario: a.registroSanitario ?? null,
    registroSanitarioNoRequiere: !!a.registroSanitarioNoRequiere,
    registroSanitarioVencimiento: a.registroSanitarioVencimiento ?? null,
  };
}

/** Texto donde busca «q»: minúsculas, sin tildes y con un solo espacio. */
export function textoBusqueda(f: FilaInventario): string {
  return normalizarTexto([
    f.codigo, f.nombre, f.marca, f.modelo, f.serial, f.numeroActivo,
    f.sucursalNombre, f.ubicacionNombre, f.detalleUbicacion, f.centroCodigo, f.centroNombre,
  ].filter(Boolean).join(" "));
}

/** Estado del registro sanitario de la fila (solo tiene sentido en biomédicos). */
export const estadoRegistroDeFila = (f: FilaInventario, hoy: string): EstadoRegistro => estadoRegistroSanitario(f, hoy);

export function pasaFiltros(f: FilaInventario, filtros: FiltrosInventario, hoy: string): boolean {
  if (filtros.estado === "vigentes" ? f.estado === "baja" : filtros.estado !== "todos" && f.estado !== filtros.estado) return false;
  if (filtros.area && f.area !== filtros.area) return false;
  if (filtros.tipo && f.tipo !== filtros.tipo) return false;
  if (filtros.clase === "sin" ? f.area !== "biomedico" || !!f.claseRiesgo : filtros.clase && f.claseRiesgo !== filtros.clase) return false;
  if (filtros.centro === "sin" ? f.centroCostoId != null : filtros.centro != null && f.centroCostoId !== filtros.centro) return false;
  if (filtros.registro && (f.area !== "biomedico" || estadoRegistroDeFila(f, hoy) !== filtros.registro)) return false;
  if (filtros.sucursal != null && f.sucursalId !== filtros.sucursal) return false;
  if (filtros.ubicacion != null && f.ubicacionId !== filtros.ubicacion) return false;
  if (filtros.criticidad && f.criticidad !== filtros.criticidad) return false;
  if (filtros.categoria && f.categoria !== filtros.categoria) return false;
  if (filtros.q) {
    const q = normalizarTexto(filtros.q);
    if (q && !textoBusqueda(f).includes(q)) return false;
  }
  return true;
}

// ── Inventario desglosado por centro de costo (requisito 1) ──────────────────

/** Cómo se agrupa la impresión: /activos/imprimir?agrupar=centro. Otro valor = sin agrupar. */
export type Agrupacion = "centro";
export const leerAgrupacion = (p: URLSearchParams): Agrupacion | null => (p.get("agrupar") === "centro" ? "centro" : null);

export interface GrupoCentro<T> {
  centroId: number | null;
  /** «CC-01 · UCI ADULTOS» o «Sin centro de costo». */
  etiqueta: string;
  filas: T[];
}

/**
 * Un grupo por centro de costo, ordenados por el código del centro (CC-2 antes que CC-10),
 * con «Sin centro de costo» al final. Dentro de cada grupo se conserva el orden recibido
 * (la impresión llega ordenada por sede, ubicación y código).
 */
export function agruparPorCentro<T extends { fila: FilaInventario }>(items: readonly T[]): GrupoCentro<T>[] {
  const grupos = new Map<number | null, { codigo: string; grupo: GrupoCentro<T> }>();
  for (const x of items) {
    const id = x.fila.centroCostoId ?? null;
    let g = grupos.get(id);
    if (!g) {
      const cc = id != null && x.fila.centroCodigo ? { codigo: x.fila.centroCodigo, nombre: x.fila.centroNombre ?? "" } : null;
      g = { codigo: cc?.codigo ?? "", grupo: { centroId: id, etiqueta: etiquetaCentroCosto(cc), filas: [] } };
      grupos.set(id, g);
    }
    g.grupo.filas.push(x);
  }
  return [...grupos.values()]
    .sort((a, b) => Number(a.grupo.centroId == null) - Number(b.grupo.centroId == null)
      || a.codigo.localeCompare(b.codigo, "es", { numeric: true }))
    .map((g) => g.grupo);
}

/** «Vigentes (sin bajas) · Clase III · Centro CC-01 · Sede Central». */
export function describirFiltros(
  f: FiltrosInventario,
  nombres: { sucursal?: string | null; ubicacion?: string | null; centro?: string | null } = {},
): string {
  const partes: string[] = [FILTRO_ESTADO_LABEL[f.estado] ?? ESTADO_ACTIVO_LABEL[f.estado as EstadoActivo] ?? f.estado];
  if (f.clase) partes.push(f.clase === "sin" ? "Sin clase de riesgo" : `Clase ${f.clase}`);
  if (f.centro === "sin") partes.push("Sin centro de costo");
  else if (f.centro != null) partes.push(`Centro ${nombres.centro ?? f.centro}`);
  if (f.registro) partes.push(`Registro sanitario: ${ESTADO_REGISTRO_LABEL[f.registro].toLowerCase()}`);
  if (f.sucursal != null) partes.push(`Sede ${nombres.sucursal ?? f.sucursal}`);
  if (f.ubicacion != null) partes.push(`Ubicación ${nombres.ubicacion ?? f.ubicacion}`);
  if (f.criticidad) partes.push(`Criticidad ${f.criticidad}`);
  if (f.categoria) partes.push(`Categoría ${f.categoria}`);
  if (f.tipo) partes.push(f.tipo === "biomedico" ? "Tipo biomédico" : "Tipo general");
  if (f.q) partes.push(`Búsqueda «${f.q}»`);
  return partes.join(" · ");
}
