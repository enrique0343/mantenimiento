import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb, getEnv } from "@/lib/db";
import { alertaAdjuntos, alertasEquipo, alertasEquipoActivos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { calcularDiff, logAudit, resumenCambios } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, ROLES_BIO_VER, fechaCorta, hoySV } from "@/lib/biomedico";
import {
  APLICABILIDADES, ESTADOS_ALERTA, FUENTES_ALERTA, MENSAJE_ALERTA, TIPOS_ALERTA, planearCambioAlerta,
} from "@/lib/alertas";
import { camposAlerta, cargarHojaAlerta, equiposDeAlerta, equiposExistentes, equiposNoBiomedicos, MENSAJE_ALERTA_SOLO_BIO } from "@/lib/alertas-datos";
import { enTandas, errorMapEs, respuestaZod } from "@/lib/validacion-api";

export const prerender = false;

const idDe = (v: string | undefined) => {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** La alerta con sus equipos, archivos e historial (lo mismo que muestra la hoja). */
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const id = idDe(ctx.params.id);
  if (!id) return Response.json({ error: "Alerta no válida." }, { status: 400 });
  const hoja = await cargarHojaAlerta(getDb(ctx), id);
  if (!hoja) return Response.json({ error: "Alerta no encontrada." }, { status: 404 });
  return Response.json(hoja);
};

const patchSchema = z.object({
  tipo: z.enum(TIPOS_ALERTA, { errorMap: () => ({ message: "Elige el tipo de alerta." }) }).optional(),
  fuente: z.enum(FUENTES_ALERTA, { errorMap: () => ({ message: "Elige la fuente de la alerta." }) }).optional(),
  titulo: z.string().max(200, MENSAJE_ALERTA.titulo).optional(),
  descripcion: z.string().max(4000, "La descripción es muy larga.").nullable().optional(),
  referencia: z.string().max(120, "La referencia es muy larga.").nullable().optional(),
  fechaAlerta: z.string().optional(),
  estado: z.enum(ESTADOS_ALERTA, { errorMap: () => ({ message: "Estado no válido." }) }).optional(),
  accionTomada: z.string().max(4000, "La acción tomada es muy larga.").nullable().optional(),
  aplicabilidad: z.enum(APLICABILIDADES, { errorMap: () => ({ message: "Elige si la alerta aplica o no." }) }).optional(),
  aplicabilidadAnalisis: z.string().max(4000, "El análisis es muy largo.").nullable().optional(),
  aplicabilidadFecha: z.string().nullable().optional(),
  fechaCierre: z.string().nullable().optional(),
  motivoReapertura: z.string().max(1000, "El motivo es muy largo.").nullable().optional(),
  activoIds: z.array(z.number().int().positive()).max(2000, "Demasiados equipos en una sola alerta.").optional(),
});

/** Campos que entran en la bitácora de una edición. */
const CAMPOS_BITACORA = [
  "tipo", "fuente", "titulo", "descripcion", "referencia", "fechaAlerta", "estado", "accionTomada",
  "aplicabilidad", "aplicabilidadAnalisis", "aplicabilidadFecha",
];

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const id = idDe(ctx.params.id);
  if (!id) return Response.json({ error: "Alerta no válida." }, { status: 400 });
  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body, { errorMap: errorMapEs });
  if (!parsed.success) return respuestaZod(parsed.error);

  const db = getDb(ctx);
  const [actual] = await db.select(camposAlerta).from(alertasEquipo).where(eq(alertasEquipo.id, id)).limit(1);
  if (!actual) return Response.json({ error: "Alerta no encontrada." }, { status: 404 });
  const equiposAntes = await equiposDeAlerta(db, id);

  const plan = planearCambioAlerta(actual, parsed.data, {
    hoy: hoySV(), ahoraISO: new Date().toISOString(), usuarioId: user.id, equiposActuales: equiposAntes.length,
  });
  if (!plan.ok) return Response.json({ error: plan.error }, { status: plan.status });
  if (plan.equipos?.length && (await equiposExistentes(db, plan.equipos)) !== plan.equipos.length) {
    return Response.json({ error: "Uno de los equipos no existe." }, { status: 400 });
  }
  // Solo los que se agregan: una alerta vieja con un equipo de General se sigue editando.
  const agregados = (plan.equipos ?? []).filter((x) => !equiposAntes.includes(x));
  if (await equiposNoBiomedicos(db, agregados)) return Response.json({ error: MENSAJE_ALERTA_SOLO_BIO }, { status: 400 });

  // El cambio y los equipos van juntos: si algo falla, no queda a medias.
  const sentencias: BatchItem<"sqlite">[] = [db.update(alertasEquipo).set(plan.set).where(eq(alertasEquipo.id, id))];
  if (plan.equipos) {
    sentencias.push(db.delete(alertasEquipoActivos).where(eq(alertasEquipoActivos.alertaId, id)));
    for (const tanda of enTandas(plan.equipos, 45)) {
      sentencias.push(db.insert(alertasEquipoActivos).values(tanda.map((activoId) => ({ alertaId: id, activoId }))));
    }
  }
  await db.batch(sentencias as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

  const diff = calcularDiff(actual as Record<string, unknown>, plan.set, plan.evento === "edicion" ? CAMPOS_BITACORA : [...CAMPOS_BITACORA, "fechaCierre"]);
  const antesSet = new Set(equiposAntes);
  const cambianEquipos = !!plan.equipos && (plan.equipos.length !== antesSet.size || plan.equipos.some((e) => !antesSet.has(e)));
  const textoEquipos = cambianEquipos ? `Equipos afectados: ${equiposAntes.length} → ${plan.equipos!.length}` : "";
  if (plan.evento === "reapertura") {
    await logAudit(ctx, {
      entidad: "alerta", entidadId: id, accion: "estado",
      cambios: {
        estado: { antes: actual.estado, despues: plan.set.estado },
        fechaCierre: { antes: actual.fechaCierre, despues: null },
      },
      resumen: `Alerta reabierta · motivo: ${plan.set.motivoReapertura}`,
    });
  } else if (plan.evento === "cierre") {
    await logAudit(ctx, {
      entidad: "alerta", entidadId: id, accion: "estado", cambios: diff,
      resumen: `Alerta cerrada · fecha de cierre ${fechaCorta(String(plan.set.fechaCierre))}${textoEquipos ? ` · ${textoEquipos}` : ""}`,
    });
  } else if (Object.keys(diff).length > 0 || textoEquipos) {
    const partes = [Object.keys(diff).length ? resumenCambios(diff) : "", textoEquipos].filter(Boolean);
    await logAudit(ctx, { entidad: "alerta", entidadId: id, accion: "update", cambios: diff, resumen: partes.join(" · ") });
  }

  const [alerta] = await db.select(camposAlerta).from(alertasEquipo).where(eq(alertasEquipo.id, id)).limit(1);
  return Response.json({ alerta });
};

/** Solo admin, y nunca una cerrada (es evidencia). Borra los archivos de R2 sin fallar si falta alguno. */
export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = idDe(ctx.params.id);
  if (!id) return Response.json({ error: "Alerta no válida." }, { status: 400 });
  const db = getDb(ctx);
  const [actual] = await db.select({ id: alertasEquipo.id, titulo: alertasEquipo.titulo, estado: alertasEquipo.estado })
    .from(alertasEquipo).where(eq(alertasEquipo.id, id)).limit(1);
  if (!actual) return Response.json({ error: "Alerta no encontrada." }, { status: 404 });
  if (actual.estado === "cerrada") return Response.json({ error: "Una alerta cerrada no se borra: es evidencia." }, { status: 409 });
  const archivos = await db.select({ r2Key: alertaAdjuntos.r2Key }).from(alertaAdjuntos).where(eq(alertaAdjuntos.alertaId, id));
  await db.batch([
    db.delete(alertaAdjuntos).where(eq(alertaAdjuntos.alertaId, id)),
    db.delete(alertasEquipoActivos).where(eq(alertasEquipoActivos.alertaId, id)),
    db.delete(alertasEquipo).where(eq(alertasEquipo.id, id)),
  ]);
  const env = getEnv(ctx);
  for (const a of archivos) {
    try { await env.R2.delete(a.r2Key); } catch (e) { console.error("alerta: R2", a.r2Key, e); }
  }
  await logAudit(ctx, { entidad: "alerta", entidadId: id, accion: "delete", resumen: `Alerta borrada: "${actual.titulo}" (${archivos.length} archivo(s))` });
  return Response.json({ ok: true });
};
