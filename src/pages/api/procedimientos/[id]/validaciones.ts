import type { APIContext, APIRoute } from "astro";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { procedimientos, procedimientoValidaciones, procedimientoVersiones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { hoyISO, puedeAdministrarProcedimientos } from "@/lib/procedimientos";

export const prerender = false;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  area: z.string().min(1, "El área validadora es obligatoria"),
  queConfirma: z.string().nullable().optional(),
  fechaProgramada: z.string().regex(FECHA, "El área necesita fecha programada (YYYY-MM-DD)"),
  metodoVerificacion: z.string().nullable().optional(),
});

const patchSchema = z.object({
  id: z.number().int().positive(),
  estado: z.enum(["pendiente", "validado", "observado"]).optional(),
  queConfirma: z.string().nullable().optional(),
  fechaProgramada: z.string().regex(FECHA).optional(),
  metodoVerificacion: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
});

async function cargarProc(ctx: APIContext, id: number) {
  const db = getDb(ctx);
  const [proc] = await db.select().from(procedimientos).where(eq(procedimientos.id, id)).limit(1);
  return { db, proc };
}

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const procId = Number(ctx.params.id);
  if (!Number.isInteger(procId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join(" · ") }, { status: 400 });
  }

  const { db, proc } = await cargarProc(ctx, procId);
  if (!proc) return Response.json({ error: "Procedimiento no encontrado" }, { status: 404 });

  const area = parsed.data.area.trim();
  const [dup] = await db
    .select({ id: procedimientoValidaciones.id })
    .from(procedimientoValidaciones)
    .where(
      and(
        eq(procedimientoValidaciones.procedimientoId, procId),
        eq(procedimientoValidaciones.area, area),
      ),
    )
    .limit(1);
  if (dup) return Response.json({ error: `${area} ya tiene renglón en esta matriz.` }, { status: 409 });

  const [row] = await db
    .insert(procedimientoValidaciones)
    .values({
      procedimientoId: procId,
      area,
      queConfirma: parsed.data.queConfirma ?? null,
      fechaProgramada: parsed.data.fechaProgramada,
      metodoVerificacion: parsed.data.metodoVerificacion ?? null,
      estado: "pendiente",
    })
    .returning();

  // Un área nueva sin confirmar deja al documento sin la unanimidad que exige
  // el 8.1: si estaba vigente, vuelve a revisión.
  let aviso: string | null = null;
  if (proc.estado === "vigente") {
    await db
      .update(procedimientos)
      .set({ estado: "en_revision", aprobadoPor: null, aprobadoEn: null })
      .where(eq(procedimientos.id, procId));
    aviso = `Se agregó ${area} sin confirmar: el documento pasó a "En revisión".`;
    await db.insert(procedimientoVersiones).values({
      procedimientoId: procId,
      version: proc.version,
      fecha: hoyISO(),
      cambio: `Nueva área validadora (${area}); estado vigente → en_revision.`,
      responsableId: user.id,
    });
  }

  return Response.json({ validacion: row, aviso }, { status: 201 });
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const procId = Number(ctx.params.id);
  if (!Number.isInteger(procId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join(" · ") }, { status: 400 });
  }
  const { id: valId, estado, ...resto } = parsed.data;

  const { db, proc } = await cargarProc(ctx, procId);
  if (!proc) return Response.json({ error: "Procedimiento no encontrado" }, { status: 404 });

  const [previa] = await db
    .select()
    .from(procedimientoValidaciones)
    .where(and(eq(procedimientoValidaciones.id, valId), eq(procedimientoValidaciones.procedimientoId, procId)))
    .limit(1);
  if (!previa) return Response.json({ error: "Renglón de validación no encontrado" }, { status: 404 });

  // El 8.1 pide fecha, responsable y método de verificación por documento: una
  // confirmación sin método no es una confirmación.
  const metodo = resto.metodoVerificacion ?? previa.metodoVerificacion;
  if (estado === "validado" && (!metodo || metodo.trim() === "")) {
    return Response.json(
      { error: "Para confirmar hay que decir con qué método se verificó (cap. 8.1: fecha, responsable y método)." },
      { status: 400 },
    );
  }
  if (estado === "observado" && !(resto.observaciones ?? previa.observaciones)) {
    return Response.json({ error: "Una observación necesita texto: qué falta y para quién." }, { status: 400 });
  }

  const firma =
    estado === undefined
      ? {}
      : estado === "validado"
        ? { validadoPor: user.id, validadoEn: new Date().toISOString() }
        : { validadoPor: null, validadoEn: null };

  const [row] = await db
    .update(procedimientoValidaciones)
    .set({ ...resto, ...(estado ? { estado } : {}), ...firma })
    .where(eq(procedimientoValidaciones.id, valId))
    .returning();

  // Si el documento estaba vigente y un área retira su confirmación, deja de
  // cumplir la regla dura: vuelve a revisión en lugar de quedar incoherente.
  let aviso: string | null = null;
  if (proc.estado === "vigente" && estado && estado !== "validado" && previa.estado === "validado") {
    await db
      .update(procedimientos)
      .set({ estado: "en_revision", aprobadoPor: null, aprobadoEn: null })
      .where(eq(procedimientos.id, procId));
    aviso = `${previa.area} retiró su confirmación: el documento pasó a "En revisión".`;
    await db.insert(procedimientoVersiones).values({
      procedimientoId: procId,
      version: proc.version,
      fecha: hoyISO(),
      cambio: `${previa.area} retiró su confirmación; estado vigente → en_revision.`,
      responsableId: user.id,
    });
  }

  return Response.json({ validacion: row, aviso });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const procId = Number(ctx.params.id);
  if (!Number.isInteger(procId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const url = new URL(ctx.request.url);
  const valId = Number(url.searchParams.get("vid"));
  if (!Number.isInteger(valId)) return Response.json({ error: "Falta ?vid=" }, { status: 400 });

  const db = getDb(ctx);
  // Nunca se queda sin matriz: el documento necesita al menos un área.
  const todas = await db
    .select({ id: procedimientoValidaciones.id })
    .from(procedimientoValidaciones)
    .where(eq(procedimientoValidaciones.procedimientoId, procId));
  if (todas.length <= 1) {
    return Response.json(
      { error: "Un documento necesita al menos un área validadora con fecha programada (cap. 08)." },
      { status: 409 },
    );
  }

  const [row] = await db
    .delete(procedimientoValidaciones)
    .where(and(eq(procedimientoValidaciones.id, valId), eq(procedimientoValidaciones.procedimientoId, procId)))
    .returning();
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ ok: true });
};
