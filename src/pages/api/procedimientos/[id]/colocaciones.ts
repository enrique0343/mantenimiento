import type { APIRoute } from "astro";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { eopColocaciones, procedimientos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { hoyISO, puedeAdministrarProcedimientos, puedeVerProcedimientos } from "@/lib/procedimientos";

export const prerender = false;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Cap. 02: «El EOP no se ejecuta desde una pantalla: se imprime y se coloca en
// el cuarto técnico y en el servicio clínico.»  Esta tabla es la constancia de
// que el papel está donde tiene que estar y de qué versión es el que cuelga.
const createSchema = z.object({
  sucursalId: z.number().int().positive().nullable().optional(),
  ubicacionId: z.number().int().positive().nullable().optional(),
  lugarDetalle: z.string().min(3, "Di dónde quedó colocado (cuarto técnico, estación de enfermería…)"),
  versionColocada: z.string().nullable().optional(),
  colocadoEn: z.string().regex(FECHA).nullable().optional(),
});

const patchSchema = z.object({
  id: z.number().int().positive(),
  verificadoEn: z.string().regex(FECHA).nullable().optional(),
  lugarDetalle: z.string().min(3).optional(),
  versionColocada: z.string().nullable().optional(),
});

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const db = getDb(ctx);
  const rows = await db
    .select()
    .from(eopColocaciones)
    .where(eq(eopColocaciones.procedimientoId, id))
    .orderBy(asc(eopColocaciones.id));
  return Response.json({ colocaciones: rows });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join(" · ") }, { status: 400 });
  }

  const db = getDb(ctx);
  const [proc] = await db.select().from(procedimientos).where(eq(procedimientos.id, id)).limit(1);
  if (!proc) return Response.json({ error: "Procedimiento no encontrado" }, { status: 404 });
  if (proc.tipo !== "eop") {
    return Response.json({ error: "Sólo el EOP se imprime y se coloca en sitio." }, { status: 400 });
  }

  const [row] = await db
    .insert(eopColocaciones)
    .values({
      procedimientoId: id,
      sucursalId: parsed.data.sucursalId ?? proc.sucursalId ?? null,
      ubicacionId: parsed.data.ubicacionId ?? null,
      lugarDetalle: parsed.data.lugarDetalle.trim(),
      colocadoPor: user.id,
      colocadoEn: parsed.data.colocadoEn ?? hoyISO(),
      // La versión que cuelga en la pared: si cambia el documento, esta copia
      // queda desactualizada y la pantalla lo avisa.
      versionColocada: parsed.data.versionColocada?.trim() || proc.version,
    })
    .returning();

  return Response.json({ colocacion: row }, { status: 201 });
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join(" · ") }, { status: 400 });
  }
  const { id: rowId, ...datos } = parsed.data;

  const db = getDb(ctx);
  const [row] = await db
    .update(eopColocaciones)
    .set(datos)
    .where(and(eq(eopColocaciones.id, rowId), eq(eopColocaciones.procedimientoId, id)))
    .returning();
  if (!row) return Response.json({ error: "Constancia no encontrada" }, { status: 404 });
  return Response.json({ colocacion: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  const rowId = Number(new URL(ctx.request.url).searchParams.get("rowId"));
  if (!Number.isInteger(id) || !Number.isInteger(rowId)) {
    return Response.json({ error: "ID inválido" }, { status: 400 });
  }

  const db = getDb(ctx);
  await db
    .delete(eopColocaciones)
    .where(and(eq(eopColocaciones.id, rowId), eq(eopColocaciones.procedimientoId, id)));
  return Response.json({ ok: true });
};
