import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { alertasEquipo, alertasEquipoActivos } from "@/lib/schema";
import { bloqueoEspacio, espacioDeActivoId } from "@/lib/espacio-db";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, ROLES_BIO_VER, esFechaISO, hoySV } from "@/lib/biomedico";
import { FUENTES_ALERTA, MENSAJE_ALERTA, TIPOS_ALERTA, limpiarTexto } from "@/lib/alertas";
import { equiposExistentes, equiposNoBiomedicos, MENSAJE_ALERTA_SOLO_BIO } from "@/lib/alertas-datos";
import { enTandas, errorMapEs, respuestaZod } from "@/lib/validacion-api";

export const prerender = false;

/**
 * K-E2: alertas de la institución o de un equipo (?activoId=), por emisión, las más
 * recientes primero (máx. 500). Lo usa la ficha del equipo.
 */
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const db = getDb(ctx);
  const param = ctx.url.searchParams.get("activoId");
  const activoId = param === null ? null : Number(param);
  if (activoId !== null && !(Number.isInteger(activoId) && activoId > 0)) return Response.json({ error: "Equipo no válido." }, { status: 400 });
  if (activoId !== null) {
    const fuera = bloqueoEspacio(user, await espacioDeActivoId(db, activoId));
    if (fuera) return fuera;
  }
  const campos = {
    id: alertasEquipo.id, tipo: alertasEquipo.tipo, fuente: alertasEquipo.fuente, titulo: alertasEquipo.titulo,
    referencia: alertasEquipo.referencia, fechaAlerta: alertasEquipo.fechaAlerta, aplicabilidad: alertasEquipo.aplicabilidad,
    estado: alertasEquipo.estado, fechaCierre: alertasEquipo.fechaCierre,
  };
  const alertas = activoId === null
    ? await db.select(campos).from(alertasEquipo).orderBy(desc(alertasEquipo.fechaAlerta), desc(alertasEquipo.id)).limit(500)
    : await db.select(campos).from(alertasEquipo)
      .innerJoin(alertasEquipoActivos, eq(alertasEquipoActivos.alertaId, alertasEquipo.id))
      .where(eq(alertasEquipoActivos.activoId, activoId))
      .orderBy(desc(alertasEquipo.fechaAlerta), desc(alertasEquipo.id)).limit(500);
  return Response.json({ alertas });
};

const createSchema = z.object({
  tipo: z.enum(TIPOS_ALERTA, { errorMap: () => ({ message: "Elige el tipo de alerta." }) }),
  fuente: z.enum(FUENTES_ALERTA, { errorMap: () => ({ message: "Elige la fuente de la alerta." }) }),
  titulo: z.string({ errorMap: () => ({ message: MENSAJE_ALERTA.titulo }) }).trim().min(3, MENSAJE_ALERTA.titulo).max(200, MENSAJE_ALERTA.titulo),
  descripcion: z.string().max(4000, "La descripción es muy larga.").nullable().optional(),
  referencia: z.string().max(120, "La referencia es muy larga.").nullable().optional(),
  fechaAlerta: z.string({ errorMap: () => ({ message: MENSAJE_ALERTA.emisionInvalida }) }).refine((v) => esFechaISO(v), MENSAJE_ALERTA.emisionInvalida),
  activoIds: z.array(z.number().int().positive()).max(2000, "Demasiados equipos en una sola alerta.").default([]),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body, { errorMap: errorMapEs });
  if (!parsed.success) return respuestaZod(parsed.error);
  const d = parsed.data;
  if (d.fechaAlerta > hoySV()) return Response.json({ error: MENSAJE_ALERTA.emisionFutura }, { status: 400 });

  const db = getDb(ctx);
  const ids = [...new Set(d.activoIds)];
  if (ids.length && (await equiposExistentes(db, ids)) !== ids.length) {
    return Response.json({ error: "Uno de los equipos no existe." }, { status: 400 });
  }
  if (await equiposNoBiomedicos(db, ids)) return Response.json({ error: MENSAJE_ALERTA_SOLO_BIO }, { status: 400 });
  const [alerta] = await db.insert(alertasEquipo).values({
    tipo: d.tipo, fuente: d.fuente, titulo: d.titulo,
    descripcion: limpiarTexto(d.descripcion), referencia: limpiarTexto(d.referencia),
    fechaAlerta: d.fechaAlerta, creadoPor: user.id,
  }).returning();
  try {
    // 2 parámetros por fila: 45 filas por INSERT.
    for (const tanda of enTandas(ids, 45)) {
      await db.insert(alertasEquipoActivos).values(tanda.map((activoId) => ({ alertaId: alerta.id, activoId })));
    }
  } catch (e) {
    console.error("alerta: equipos", e);
    await db.delete(alertasEquipoActivos).where(eq(alertasEquipoActivos.alertaId, alerta.id)).catch(() => {});
    await db.delete(alertasEquipo).where(eq(alertasEquipo.id, alerta.id)).catch(() => {});
    return Response.json({ error: "No se pudo registrar la alerta con sus equipos. Intenta de nuevo." }, { status: 500 });
  }

  await logAudit(ctx, {
    entidad: "alerta", entidadId: alerta.id, accion: "create",
    resumen: `Alerta registrada: "${alerta.titulo}" (${ids.length} ${ids.length === 1 ? "equipo" : "equipos"})`,
  });
  return Response.json({ alerta }, { status: 201 });
};
