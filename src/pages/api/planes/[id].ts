import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesMantenimiento, activos, proveedores } from "@/lib/schema";
import { requireUserJson } from "@/lib/auth";
import {
  cambioPideMotivo, diffDePlan, eliminarPlanes, escribirCambioDePlan, esJefatura, motivoValido, mensajeOtPendiente,
  otQueBloqueaLaFecha, reasignarOrdenesAbiertas, CAMPOS_DE_JEFATURA, MENSAJE_MOTIVO, MENSAJE_SOLO_JEFATURA,
} from "@/lib/preventivos";

import { parseArea } from "@/lib/areas";
import { rubroDeActivo } from "@/lib/rubros";
import { espacioDeActivo, type Espacio } from "@/lib/espacio";
import { asignadoFueraDeEspacio, mensajeAsignadoFuera } from "@/lib/espacio-db";
import { errorMapEs, fechaIsoSchema, frecuenciaRutinaSchema, respuestaZod } from "@/lib/validacion-api";
export const prerender = false;

// K-E1: las nueve frecuencias de biomedico.ts; «turno» con su propio mensaje.
const updateSchema = z.object({
  titulo: z.string().trim().min(1, "Escribe el nombre de la rutina.").optional(),
  descripcion: z.string().nullable().optional(),
  frecuencia: frecuenciaRutinaSchema.optional(),
  proximaFecha: fechaIsoSchema("Fecha no válida.").optional(),
  alertaDiasAntes: z.number().int().min(0).max(90).optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  horasEstimadas: z.number().positive().nullable().optional(),
  checklist: z.array(z.object({
    texto: z.string(),
    criterio: z.string().nullable().optional(),
    bloqueante: z.boolean().optional(),
    minutos: z.number().nullable().optional(),
    materiales: z.string().nullable().optional(),
    requiereValor: z.boolean().optional(),
    unidad: z.string().nullable().optional(),
    esperadoMin: z.number().nullable().optional(),
    esperadoMax: z.number().nullable().optional(),
  })).optional(),
  asignadoA: z.number().int().positive().nullable().optional(),
  activo: z.boolean().optional(),
  modalidad: z.enum(["interno", "contratado", "mixto"]).optional(),
  contratoId: z.number().int().positive().nullable().optional(),
  // Fase 59: proveedor del servicio externo (plan anual), aunque no haya contrato.
  proveedorId: z.number({ errorMap: () => ({ message: "Proveedor no válido." }) }).int().positive().nullable().optional(),
  // Obligatorio (mínimo 10 caracteres) si cambia la fecha programada o la
  // frecuencia, o si se desactiva el preventivo. No se guarda en el plan: va al registro.
  motivo: z.string().max(1000).nullable().optional(),
});

type Cargado =
  | { ok: false; error: Response }
  | { ok: true; db: ReturnType<typeof getDb>; actual: typeof planesMantenimiento.$inferSelect; estadoActivo: string | null; espacio: Espacio };

async function cargar(ctx: Parameters<APIRoute>[0], id: number): Promise<Cargado> {
  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return { ok: false, error: Response.json({ error: "Área no válida" }, { status: 400 }) };
  const db = getDb(ctx);
  const [actual] = await db.select().from(planesMantenimiento).where(eq(planesMantenimiento.id, id)).limit(1);
  if (!actual) return { ok: false, error: Response.json({ error: "No encontrado" }, { status: 404 }) };
  const [activo] = await db.select({ rubro: activos.rubro, tipo: activos.tipo, estado: activos.estado }).from(activos).where(eq(activos.id, actual.activoId)).limit(1);
  if (area && (!activo || rubroDeActivo(activo.rubro, activo.tipo) !== area)) return { ok: false, error: Response.json({ error: "Plan no encontrado en esta área" }, { status: 404 }) };
  return { ok: true, db, actual, estadoActivo: activo?.estado ?? null, espacio: espacioDeActivo(activo ?? {}) };
}

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUserJson(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const parsed = updateSchema.safeParse(await ctx.request.json().catch(() => null), { errorMap: errorMapEs });
  if (!parsed.success) return respuestaZod(parsed.error);
  const { motivo = null, ...entrada } = parsed.data;
  if (!esJefatura(user.rol) && (entrada.modalidad !== undefined || entrada.contratoId !== undefined || entrada.proveedorId !== undefined)) {
    return Response.json({ error: "Solo la jefatura define modalidad, contrato y proveedor." }, { status: 403 });
  }
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(entrada).filter(([, v]) => v !== undefined));
  if (entrada.checklist) data.checklist = JSON.stringify(entrada.checklist);
  const cargado = await cargar(ctx, id);
  if (!cargado.ok) return cargado.error;
  const { db, actual, estadoActivo, espacio } = cargado;

  if (entrada.proveedorId) {
    const [prov] = await db.select({ id: proveedores.id }).from(proveedores)
      .where(and(eq(proveedores.id, entrada.proveedorId), eq(proveedores.activo, true))).limit(1);
    if (!prov) return Response.json({ error: "Proveedor no válido." }, { status: 400 });
  }

  // Solo cuenta lo que cambia: la ficha manda todos los campos en cada guardado.
  const diff = diffDePlan(actual as any, data);
  if (Object.keys(diff).length === 0) return Response.json({ plan: actual });
  // Equipo dado de baja: sus rutinas no se activan ni se cambian; solo se desactivan.
  if (estadoActivo === "baja") {
    if (diff.activo?.despues) return Response.json({ error: "El equipo está dado de baja: la rutina no se puede activar." }, { status: 409 });
    if (Object.keys(diff).some((k) => k !== "activo")) {
      return Response.json({ error: "El equipo está dado de baja: sus rutinas no se cambian, solo se desactivan." }, { status: 409 });
    }
  }
  // El técnico edita el contenido del preventivo (título, pasos), pero no quién lo
  // tiene ni cuándo toca: eso es de la jefatura.
  if (!esJefatura(user.rol) && CAMPOS_DE_JEFATURA.some((c) => c in diff)) return Response.json({ error: MENSAJE_SOLO_JEFATURA }, { status: 403 });
  if (cambioPideMotivo(diff) && !motivoValido(motivo)) return Response.json({ error: MENSAJE_MOTIVO }, { status: 400 });
  // Como en el tablero: a quien no ve el espacio del equipo no se le deja este preventivo.
  if ("asignadoA" in diff && entrada.asignadoA) {
    const fuera = await asignadoFueraDeEspacio(db, entrada.asignadoA, [espacio]);
    if (fuera) return Response.json({ error: mensajeAsignadoFuera(fuera, { biomedico: "los preventivos biomédicos", general: "los preventivos de mantenimiento general" }) }, { status: 400 });
  }
  // Con la OT del ciclo sin verificar la fecha no se mueve: su atraso se perdería de
  // vista y el cron generaría otra OT del mismo plan en la fecha nueva.
  if ("proximaFecha" in diff) {
    const ot = await otQueBloqueaLaFecha(db, id);
    if (ot) return Response.json({ error: mensajeOtPendiente(ot) }, { status: 409 });
  }

  const row = await escribirCambioDePlan(db, actual, data, diff, user, motivo);
  if (!row) return Response.json({ error: "El preventivo cambió mientras lo editabas (o se generó su OT). Actualiza la página y vuelve a intentarlo." }, { status: 409 });

  // El técnico nuevo también toma la OT abierta del preventivo, por el camino de
  // siempre de la orden.
  let ordenes: Awaited<ReturnType<typeof reasignarOrdenesAbiertas>> | null = null;
  if ("asignadoA" in diff) {
    ordenes = await reasignarOrdenesAbiertas(ctx, user, [id], row.asignadoA ?? null, motivo);
  }
  return Response.json({ plan: row, ...(ordenes ? { ordenes: ordenes.cambiadas, errores: ordenes.errores } : {}) });
};

// DELETE /api/planes/[id] { motivo } — pide motivo y deja registro, igual que desactivar.
export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUserJson(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body: any = await ctx.request.json().catch(() => null);
  const motivo = body?.motivo;
  if (!motivoValido(motivo)) return Response.json({ error: MENSAJE_MOTIVO }, { status: 400 });
  const cargado = await cargar(ctx, id);
  if (!cargado.ok) return cargado.error;
  const r = await eliminarPlanes(cargado.db, [id], user, motivo);
  if (!r.ok) return Response.json({ error: r.error }, { status: 409 });
  return Response.json({ ok: true });
};
