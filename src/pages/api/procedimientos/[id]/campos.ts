import type { APIContext, APIRoute } from "astro";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  procedimientos,
  procedimientoCampos,
  procedimientoValidaciones,
  procedimientoVersiones,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { hoyISO, progresoValidacion, puedeAdministrarProcedimientos } from "@/lib/procedimientos";

export const prerender = false;

// Campos "en azul" (cap. 2.4 y 8.2): los números son de las normas, estos
// valores son de Avante. Una celda vacía es un documento sin aprobar.
const createSchema = z.object({
  etiqueta: z.string().min(1, "La etiqueta del campo es obligatoria"),
  valor: z.string().nullable().optional(),
  unidad: z.string().nullable().optional(),
  decideArea: z.string().nullable().optional(),
  orden: z.number().int().min(0).optional(),
});

const patchSchema = z.object({
  id: z.number().int().positive(),
  etiqueta: z.string().min(1).optional(),
  // "" se guarda como NULL: así vuelve a contar como celda pendiente.
  valor: z.string().nullable().optional(),
  unidad: z.string().nullable().optional(),
  decideArea: z.string().nullable().optional(),
  orden: z.number().int().min(0).optional(),
});

async function progreso(ctx: APIContext, procId: number) {
  const db = getDb(ctx);
  const [campos, validaciones] = await Promise.all([
    db.select().from(procedimientoCampos).where(eq(procedimientoCampos.procedimientoId, procId)),
    db.select().from(procedimientoValidaciones).where(eq(procedimientoValidaciones.procedimientoId, procId)),
  ]);
  return progresoValidacion(campos, validaciones);
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

  const db = getDb(ctx);
  const [proc] = await db.select().from(procedimientos).where(eq(procedimientos.id, procId)).limit(1);
  if (!proc) return Response.json({ error: "Procedimiento no encontrado" }, { status: 404 });

  const existentes = await db
    .select({ id: procedimientoCampos.id })
    .from(procedimientoCampos)
    .where(eq(procedimientoCampos.procedimientoId, procId));

  const valor = parsed.data.valor?.trim() || null;
  const [row] = await db
    .insert(procedimientoCampos)
    .values({
      procedimientoId: procId,
      etiqueta: parsed.data.etiqueta.trim(),
      valor,
      unidad: parsed.data.unidad ?? null,
      decideArea: parsed.data.decideArea ?? null,
      orden: parsed.data.orden ?? existentes.length,
    })
    .returning();

  // Un campo nuevo sin valor rompe la regla dura: si estaba vigente, a revisión.
  let aviso: string | null = null;
  if (proc.estado === "vigente" && !valor) {
    await db
      .update(procedimientos)
      .set({ estado: "en_revision", aprobadoPor: null, aprobadoEn: null })
      .where(eq(procedimientos.id, procId));
    aviso = `Se agregó "${row.etiqueta}" sin valor: el documento pasó a "En revisión".`;
    await db.insert(procedimientoVersiones).values({
      procedimientoId: procId,
      version: proc.version,
      fecha: hoyISO(),
      cambio: `Campo en azul nuevo sin valor (${row.etiqueta}); estado vigente → en_revision.`,
      responsableId: user.id,
    });
  }

  return Response.json({ campo: row, progreso: await progreso(ctx, procId), aviso }, { status: 201 });
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
  const { id: campoId, ...resto } = parsed.data;

  const db = getDb(ctx);
  const [proc] = await db.select().from(procedimientos).where(eq(procedimientos.id, procId)).limit(1);
  if (!proc) return Response.json({ error: "Procedimiento no encontrado" }, { status: 404 });

  const [previo] = await db
    .select()
    .from(procedimientoCampos)
    .where(and(eq(procedimientoCampos.id, campoId), eq(procedimientoCampos.procedimientoId, procId)))
    .limit(1);
  if (!previo) return Response.json({ error: "Campo no encontrado" }, { status: 404 });

  const datos: Record<string, unknown> = { ...resto };
  if ("valor" in resto) datos.valor = resto.valor?.trim() || null;
  if ("etiqueta" in resto && resto.etiqueta) datos.etiqueta = resto.etiqueta.trim();

  const [row] = await db
    .update(procedimientoCampos)
    .set(datos)
    .where(eq(procedimientoCampos.id, campoId))
    .returning();

  // Vaciar una celda de un documento vigente lo devuelve a revisión: el 8.1 no
  // admite un documento en vigor con un campo en azul abierto.
  let aviso: string | null = null;
  if (proc.estado === "vigente" && "valor" in resto && !row.valor && previo.valor) {
    await db
      .update(procedimientos)
      .set({ estado: "en_revision", aprobadoPor: null, aprobadoEn: null })
      .where(eq(procedimientos.id, procId));
    aviso = `Se vació "${row.etiqueta}": el documento pasó a "En revisión".`;
    await db.insert(procedimientoVersiones).values({
      procedimientoId: procId,
      version: proc.version,
      fecha: hoyISO(),
      cambio: `Campo en azul vaciado (${row.etiqueta}); estado vigente → en_revision.`,
      responsableId: user.id,
    });
  }

  return Response.json({ campo: row, progreso: await progreso(ctx, procId), aviso });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarProcedimientos(user.rol)) return new Response("Sin permisos", { status: 403 });

  const procId = Number(ctx.params.id);
  if (!Number.isInteger(procId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const url = new URL(ctx.request.url);
  const campoId = Number(url.searchParams.get("cid"));
  if (!Number.isInteger(campoId)) return Response.json({ error: "Falta ?cid=" }, { status: 400 });

  const db = getDb(ctx);
  const [row] = await db
    .delete(procedimientoCampos)
    .where(and(eq(procedimientoCampos.id, campoId), eq(procedimientoCampos.procedimientoId, procId)))
    .returning();
  if (!row) return Response.json({ error: "Campo no encontrado" }, { status: 404 });

  return Response.json({ ok: true, progreso: await progreso(ctx, procId) });
};
