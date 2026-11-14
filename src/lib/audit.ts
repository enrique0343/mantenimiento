// Audit log helpers: registra cambios en entidades importantes para trazabilidad.
import type { APIContext } from "astro";
import { getDb } from "./db";
import { auditLog } from "./schema";

export type Accion = "create" | "update" | "delete" | "estado" | "asignacion";
export type Entidad =
  | "activo" | "plan" | "orden" | "extintor" | "actividad" | "vehiculo" | "proyecto" | "contrato"
  // Fase 52: las paradas de la ronda de turno también se auditan, porque
  // cambiar el valor normal de un punto cambia cuándo el sistema avisa.
  | "ronda_punto" | "ronda"
  // Fase 59: equipos biomédicos y evaluación JCI.
  | "centro_costo" | "proveedor" | "licencia" | "capacitacion" | "alerta" | "plan_aprobacion"
  | "prueba_electrica" | "checklist_plantilla" | "configuracion" | "procedimiento";

export interface DiffEntry {
  antes: unknown;
  despues: unknown;
}

// Genera un diff de los campos que cambiaron entre dos objetos.
// Solo considera campos en el segundo objeto (los actualizables).
export function calcularDiff(
  antes: Record<string, unknown>,
  despues: Record<string, unknown>,
  campos?: string[]
): Record<string, DiffEntry> {
  const diff: Record<string, DiffEntry> = {};
  const keys = campos ?? Object.keys(despues);
  for (const k of keys) {
    if (despues[k] === undefined) continue; // si no se mandó, no se cambió
    const a = antes[k] ?? null;
    const b = despues[k] ?? null;
    // Comparación simple para tipos primitivos
    if (a !== b) diff[k] = { antes: a, despues: b };
  }
  return diff;
}

// Etiquetas legibles para campos comunes
const CAMPO_LABEL: Record<string, string> = {
  codigo: "Código",
  nombre: "Nombre",
  descripcion: "Descripción",
  ubicacion: "Ubicación",
  ubicacionId: "Ubicación",
  estado: "Estado",
  marca: "Marca",
  modelo: "Modelo",
  serial: "Serie",
  anio: "Año",
  categoria: "Categoría",
  tipo: "Tipo",
  proveedorId: "Empresa que da mantenimiento",
  fechaAdquisicion: "Fecha de adquisición",
  vidaUtilAnios: "Vida útil (años)",
  valorAdquisicion: "Valor de adquisición",
  responsableId: "Responsable",
  criticidadOperacional: "Criticidad operacional",
  requiereCalibracion: "Requiere calibración",
  registroSanitario: "Registro sanitario",
  claseRiesgo: "Clase de riesgo",
  ultimaCalibracion: "Última calibración",
  proximaCalibracion: "Próxima calibración",
  // Plan
  titulo: "Título",
  frecuencia: "Frecuencia",
  proximaFecha: "Próxima fecha",
  alertaDiasAntes: "Alerta días antes",
  prioridad: "Prioridad",
  asignadoA: "Técnico asignado",
  horasEstimadas: "Horas estimadas",
  activo: "Activo",
  // Orden
  vencimiento: "Vencimiento",
  trabajosRealizados: "Trabajos realizados",
  // ── Fase 59 · Equipo e inventario ──
  numeroActivo: "Número de activo",
  centroCostoId: "Centro de costo",
  subcategoria: "Subcategoría",
  registroSanitarioEntidad: "Entidad del registro sanitario",
  registroSanitarioEmision: "Emisión del registro sanitario",
  registroSanitarioVencimiento: "Vencimiento del registro sanitario",
  registroSanitarioNoRequiere: "No requiere registro sanitario",
  qrCode: "Código de etiqueta",
  rubro: "Área",
  datosTecnicos: "Datos técnicos",
  // ── Calibración, patrón y acreditación ──
  fechaCalibracion: "Fecha de calibración",
  laboratorioId: "Laboratorio",
  laboratorioExterno: "Laboratorio (texto)",
  numeroCertificado: "N.º de certificado",
  patronActivoId: "Patrón (lista)",
  patronReferencia: "Patrón (texto)",
  resultado: "Resultado",
  incertidumbre: "Incertidumbre",
  realizadoPor: "Realizado por",
  notas: "Notas",
  certificadoR2Key: "Certificado (archivo)",
  labAcreditado: "Laboratorio acreditado",
  labAcreditacionRef: "Acreditación del laboratorio",
  esPatron: "Equipo patrón",
  calibracionNoAplica: "No requiere calibración",
  calibracionNoAplicaMotivo: "Motivo: no requiere calibración",
  esLaboratorioAcreditado: "Laboratorio acreditado",
  acreditacionOrgano: "Órgano acreditador",
  acreditacionNumero: "N.º de acreditación",
  acreditacionAlcance: "Alcance de la acreditación",
  acreditacionVigencia: "Vigencia de la acreditación",
  acreditacionR2Key: "Certificado de acreditación",
  nit: "NIT",
  contacto: "Contacto",
  telefono: "Teléfono",
  email: "Email",
  // ── Documentos, licencias y capacitaciones ──
  version: "Versión",
  fechaVersion: "Fecha del documento",
  fechaVencimiento: "Vence",
  nota: "Nota",
  entidad: "Entidad emisora",
  entidadOtra: "Otra entidad",
  numero: "Número",
  ambito: "Ámbito",
  sucursalId: "Sede",
  servicio: "Servicio",
  activoId: "Equipo",
  titular: "Titular",
  fechaEmision: "Fecha de emisión",
  reemplazaAId: "Renueva a",
  tema: "Tema",
  fecha: "Fecha",
  instructorTipo: "Instructor interno o externo",
  instructorNombre: "Instructor",
  instructorEntidad: "Empresa del instructor",
  modeloCubierto: "Modelo cubierto",
  duracionMinutos: "Duración (min)",
  lugar: "Lugar",
  // ── Alertas y plan anual ──
  aplicabilidad: "Aplicabilidad",
  aplicabilidadAnalisis: "Análisis",
  aplicabilidadFecha: "Fecha del análisis",
  fechaCierre: "Fecha de cierre",
  accionTomada: "Acción tomada",
  fechaAlerta: "Fecha de emisión",
  referencia: "Referencia",
  fuente: "Fuente",
  modalidad: "Modalidad",
  contratoId: "Contrato",
};

export function labelCampo(campo: string): string {
  return CAMPO_LABEL[campo] ?? campo;
}

// Genera resumen legible del cambio
export function resumenCambios(diff: Record<string, DiffEntry>): string {
  const partes = Object.keys(diff).map((k) => labelCampo(k));
  if (partes.length === 0) return "Sin cambios";
  if (partes.length === 1) return `Modificó ${partes[0]}`;
  if (partes.length <= 3) return `Modificó ${partes.join(", ")}`;
  return `Modificó ${partes.slice(0, 3).join(", ")} y ${partes.length - 3} más`;
}

// Registra un evento en audit_log (best-effort: si falla, no rompe la operación)
export async function logAudit(
  ctx: APIContext,
  args: {
    entidad: Entidad;
    entidadId: number;
    accion: Accion;
    cambios?: Record<string, DiffEntry>;
    resumen?: string;
  }
): Promise<void> {
  try {
    const user = ctx.locals.user;
    const db = getDb(ctx);
    const cambiosJson = args.cambios && Object.keys(args.cambios).length > 0
      ? JSON.stringify(args.cambios)
      : null;
    const resumen = args.resumen ?? (args.cambios ? resumenCambios(args.cambios) : null);
    await db.insert(auditLog).values({
      entidad: args.entidad,
      entidadId: args.entidadId,
      accion: args.accion,
      usuarioId: user?.id ?? null,
      cambios: cambiosJson,
      resumen,
    });
  } catch {
    // No bloqueamos la operación principal si falla el log
  }
}

// Fase 59: varias líneas de bitácora en una sola ida a la base (p. ej. una por
// orden en el borrado en lote). Mismas reglas que logAudit; con 0 entradas no
// consulta. Cada INSERT lleva 15 filas: 6 parámetros por fila = 90, y D1 acepta
// hasta 100 por consulta. Si falla, no corta la operación principal.
export async function logAuditLote(
  ctx: APIContext,
  entradas: Array<{
    entidad: Entidad;
    entidadId: number;
    accion: Accion;
    cambios?: Record<string, DiffEntry>;
    resumen?: string;
  }>
): Promise<void> {
  if (entradas.length === 0) return;
  try {
    const usuarioId = ctx.locals.user?.id ?? null;
    const db = getDb(ctx);
    const filas = entradas.map((e) => ({
      entidad: e.entidad,
      entidadId: e.entidadId,
      accion: e.accion,
      usuarioId,
      cambios: e.cambios && Object.keys(e.cambios).length > 0 ? JSON.stringify(e.cambios) : null,
      resumen: e.resumen ?? (e.cambios ? resumenCambios(e.cambios) : null),
    }));
    const TANDA = 15;
    const inserts = [];
    for (let i = 0; i < filas.length; i += TANDA) inserts.push(db.insert(auditLog).values(filas.slice(i, i + TANDA)));
    await db.batch(inserts as [(typeof inserts)[number], ...(typeof inserts)[number][]]);
  } catch {
    // No bloqueamos la operación principal si falla el log
  }
}
