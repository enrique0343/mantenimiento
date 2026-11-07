import type { APIRoute } from "astro";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenPrerrequisitos, ordenes, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { PRERREQ_TIPOS } from "@/lib/ordenes";
import { logAudit } from "@/lib/audit";

export const prerender = false;

// Prerrequisitos bloqueantes del MOP (cap. 02 y 05 de GO-GUI-011-2026):
// permiso de trabajo, ICRA, notificación a servicios, bloqueo y etiquetado,
// espacio confinado, ventana pactada, instrumento calibrado. Cada uno se marca
// cumplido CON su referencia verificable. La regla que impide iniciar la OT
// vive en el PATCH de /api/ordenes/[id].

async function cargar(ctx: Parameters<APIRoute>[0], ordenId: number) {
  const db = getDb(ctx);
  const rows = await db
    .select({ p: ordenPrerrequisitos, u: usuarios })
    .from(ordenPrerrequisitos)
    .leftJoin(usuarios, eq(usuarios.id, ordenPrerrequisitos.cumplidoPor))
    .where(eq(ordenPrerrequisitos.ordenId, ordenId))
    .orderBy(asc(ordenPrerrequisitos.orden), asc(ordenPrerrequisitos.id));
  return rows.map((r) => ({
    ...r.p,
    cumplidoNombre: r.u?.nombre ?? null,
  }));
}

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const ordenId = Number(ctx.params.id);
  if (!Number.isFinite(ordenId)) return Response.json({ error: "Orden inválida" }, { status: 400 });
  return Response.json({ prerrequisitos: await cargar(ctx, ordenId) });
};

const createSchema = z.object({
  texto: z.string().min(1).max(400),
  tipo: z.enum(PRERREQ_TIPOS).default("otro"),
  obligatorio: z.boolean().default(true),
  cargoResponsable: z.string().max(200).nullable().optional(),
  orden: z.number().int().min(0).max(999).optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const ordenId = Number(ctx.params.id);
  if (!Number.isFinite(ordenId)) return Response.json({ error: "Orden inválida" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [orden] = await db.select({ id: ordenes.id, estado: ordenes.estado }).from(ordenes).where(eq(ordenes.id, ordenId)).limit(1);
  if (!orden) return Response.json({ error: "La orden no existe" }, { status: 404 });
  if (orden.estado === "cerrada" || orden.estado === "cancelada") {
    return Response.json({ error: "La orden ya está cerrada: no se pueden agregar prerrequisitos" }, { status: 400 });
  }

  const existentes = await db
    .select({ orden: ordenPrerrequisitos.orden })
    .from(ordenPrerrequisitos)
    .where(eq(ordenPrerrequisitos.ordenId, ordenId));
  const siguienteOrden =
    parsed.data.orden ?? existentes.reduce((m, r) => Math.max(m, r.orden ?? 0), 0) + 1;

  const [row] = await db
    .insert(ordenPrerrequisitos)
    .values({
      ordenId,
      texto: parsed.data.texto.trim(),
      tipo: parsed.data.tipo,
      obligatorio: parsed.data.obligatorio,
      cargoResponsable: parsed.data.cargoResponsable?.trim() || null,
      orden: siguienteOrden,
    })
    .returning();

  await logAudit(ctx, {
    entidad: "orden",
    entidadId: ordenId,
    accion: "update",
    resumen: `Prerrequisito agregado: ${row.texto}`,
  });

  return Response.json({ prerrequisito: row }, { status: 201 });
};

const patchSchema = z.object({
  itemId: z.number().int().positive(),
  cumplido: z.boolean().optional(),
  referencia: z.string().max(400).nullable().optional(),
  obligatorio: z.boolean().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const ordenId = Number(ctx.params.id);
  if (!Number.isFinite(ordenId)) return Response.json({ error: "Orden inválida" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [orden] = await db.select({ id: ordenes.id, estado: ordenes.estado }).from(ordenes).where(eq(ordenes.id, ordenId)).limit(1);
  if (!orden) return Response.json({ error: "La orden no existe" }, { status: 404 });
  if (orden.estado === "cerrada" || orden.estado === "cancelada") {
    return Response.json({ error: "La orden ya está cerrada: los prerrequisitos quedan como evidencia y no se editan" }, { status: 400 });
  }

  const [actual] = await db
    .select()
    .from(ordenPrerrequisitos)
    .where(and(eq(ordenPrerrequisitos.id, parsed.data.itemId), eq(ordenPrerrequisitos.ordenId, ordenId)))
    .limit(1);
  if (!actual) return Response.json({ error: "Prerrequisito no encontrado en esta orden" }, { status: 404 });

  // Solo admin o jefe cambian si un prerrequisito es obligatorio.
  if (parsed.data.obligatorio !== undefined && user.rol !== "admin" && user.rol !== "jefe") {
    return Response.json({ error: "Solo la jefatura puede cambiar si un prerrequisito es obligatorio" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.referencia !== undefined) data.referencia = parsed.data.referencia?.trim() || null;
  if (parsed.data.obligatorio !== undefined) data.obligatorio = parsed.data.obligatorio;

  if (parsed.data.cumplido !== undefined) {
    data.cumplido = parsed.data.cumplido;
    if (parsed.data.cumplido) {
      // La referencia es lo que vuelve verificable el prerrequisito: el n.º de
      // permiso, la clase de la ICRA, el id del candado. Sin ella no hay
      // evidencia, así que no dejamos marcarlo cumplido "a secas".
      const ref = (parsed.data.referencia ?? actual.referencia ?? "").trim();
      if (ref.length < 2) {
        return Response.json(
          { error: "Escribe la referencia antes de marcarlo cumplido (n.º de permiso, clase de la ICRA, id del candado, hora del aviso…)." },
          { status: 400 }
        );
      }
      data.referencia = ref;
      data.cumplidoPor = user.id;
      data.cumplidoEn = new Date().toISOString();
    } else {
      data.cumplidoPor = null;
      data.cumplidoEn = null;
    }
  }

  if (Object.keys(data).length === 0) return Response.json({ error: "Nada que actualizar" }, { status: 400 });

  const [row] = await db
    .update(ordenPrerrequisitos)
    .set(data)
    .where(eq(ordenPrerrequisitos.id, parsed.data.itemId))
    .returning();

  if (parsed.data.cumplido !== undefined && parsed.data.cumplido !== actual.cumplido) {
    await logAudit(ctx, {
      entidad: "orden",
      entidadId: ordenId,
      accion: "update",
      resumen: parsed.data.cumplido
        ? `Prerrequisito cumplido: ${actual.texto} (ref. ${row.referencia ?? "—"})`
        : `Prerrequisito revertido a pendiente: ${actual.texto}`,
      cambios: {
        cumplido: { antes: actual.cumplido, despues: parsed.data.cumplido },
        referencia: { antes: actual.referencia, despues: row.referencia },
      },
    });
  }

  return Response.json({ prerrequisito: row });
};

const deleteSchema = z.object({ itemId: z.number().int().positive() });

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const ordenId = Number(ctx.params.id);
  if (!Number.isFinite(ordenId)) return Response.json({ error: "Orden inválida" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [actual] = await db
    .select()
    .from(ordenPrerrequisitos)
    .where(and(eq(ordenPrerrequisitos.id, parsed.data.itemId), eq(ordenPrerrequisitos.ordenId, ordenId)))
    .limit(1);
  if (!actual) return Response.json({ error: "Prerrequisito no encontrado en esta orden" }, { status: 404 });

  const [orden] = await db.select({ estado: ordenes.estado }).from(ordenes).where(eq(ordenes.id, ordenId)).limit(1);
  if (orden?.estado === "cerrada" || orden?.estado === "cancelada") {
    return Response.json({ error: "La orden ya está cerrada: los prerrequisitos quedan como evidencia" }, { status: 400 });
  }

  await db.delete(ordenPrerrequisitos).where(eq(ordenPrerrequisitos.id, parsed.data.itemId));
  await logAudit(ctx, {
    entidad: "orden",
    entidadId: ordenId,
    accion: "update",
    resumen: `Prerrequisito eliminado: ${actual.texto}`,
  });
  return Response.json({ ok: true });
};
