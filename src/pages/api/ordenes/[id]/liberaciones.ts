import type { APIRoute } from "astro";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenLiberaciones, ordenes, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { evaluarConformeLiberacion } from "@/lib/ordenes";
import { logAudit } from "@/lib/audit";

export const prerender = false;

// Lecturas de liberación del MOP (cap. 02 y 05): «una sección de cierre con
// las lecturas de liberación. La orden no cierra sin la lectura de
// liberación.» Al escribir el valor medido se calcula "conforme" contra el
// rango min/max tomado del SCP. La regla que impide cerrar vive en el PATCH de
// /api/ordenes/[id]; el único escape es el cierre sin lectura con motivo
// escrito, que solo puede usar admin o jefe.

async function cargar(ctx: Parameters<APIRoute>[0], ordenId: number) {
  const db = getDb(ctx);
  const rows = await db
    .select({ l: ordenLiberaciones, u: usuarios })
    .from(ordenLiberaciones)
    .leftJoin(usuarios, eq(usuarios.id, ordenLiberaciones.medidoPor))
    .where(eq(ordenLiberaciones.ordenId, ordenId))
    .orderBy(asc(ordenLiberaciones.orden), asc(ordenLiberaciones.id));
  return rows.map((r) => ({ ...r.l, medidoNombre: r.u?.nombre ?? null }));
}

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const ordenId = Number(ctx.params.id);
  if (!Number.isFinite(ordenId)) return Response.json({ error: "Orden inválida" }, { status: 400 });
  return Response.json({ liberaciones: await cargar(ctx, ordenId) });
};

const createSchema = z.object({
  etiqueta: z.string().min(1).max(300),
  unidad: z.string().max(40).nullable().optional(),
  valorEsperado: z.string().max(200).nullable().optional(),
  minAceptable: z.number().nullable().optional(),
  maxAceptable: z.number().nullable().optional(),
  obligatoria: z.boolean().default(true),
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

  const { minAceptable, maxAceptable } = parsed.data;
  if (minAceptable != null && maxAceptable != null && minAceptable > maxAceptable) {
    return Response.json({ error: "El mínimo aceptable no puede ser mayor que el máximo" }, { status: 400 });
  }

  const db = getDb(ctx);
  const [orden] = await db.select({ estado: ordenes.estado }).from(ordenes).where(eq(ordenes.id, ordenId)).limit(1);
  if (!orden) return Response.json({ error: "La orden no existe" }, { status: 404 });
  if (orden.estado === "cerrada" || orden.estado === "cancelada") {
    return Response.json({ error: "La orden ya está cerrada: no se pueden agregar lecturas de liberación" }, { status: 400 });
  }

  const existentes = await db
    .select({ orden: ordenLiberaciones.orden })
    .from(ordenLiberaciones)
    .where(eq(ordenLiberaciones.ordenId, ordenId));
  const siguienteOrden =
    parsed.data.orden ?? existentes.reduce((m, r) => Math.max(m, r.orden ?? 0), 0) + 1;

  const [row] = await db
    .insert(ordenLiberaciones)
    .values({
      ordenId,
      etiqueta: parsed.data.etiqueta.trim(),
      unidad: parsed.data.unidad?.trim() || null,
      valorEsperado: parsed.data.valorEsperado?.trim() || null,
      minAceptable: minAceptable ?? null,
      maxAceptable: maxAceptable ?? null,
      obligatoria: parsed.data.obligatoria,
      orden: siguienteOrden,
    })
    .returning();

  await logAudit(ctx, {
    entidad: "orden",
    entidadId: ordenId,
    accion: "update",
    resumen: `Lectura de liberación agregada: ${row.etiqueta}`,
  });

  return Response.json({ liberacion: row }, { status: 201 });
};

const patchSchema = z.object({
  itemId: z.number().int().positive(),
  valorMedido: z.number().nullable().optional(),
  valorMedidoTexto: z.string().max(300).nullable().optional(),
  obligatoria: z.boolean().optional(),
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
  const [orden] = await db.select({ estado: ordenes.estado }).from(ordenes).where(eq(ordenes.id, ordenId)).limit(1);
  if (!orden) return Response.json({ error: "La orden no existe" }, { status: 404 });
  if (orden.estado === "cerrada" || orden.estado === "cancelada") {
    return Response.json({ error: "La orden ya está cerrada: las lecturas de liberación quedan como evidencia y no se editan" }, { status: 400 });
  }

  const [actual] = await db
    .select()
    .from(ordenLiberaciones)
    .where(and(eq(ordenLiberaciones.id, parsed.data.itemId), eq(ordenLiberaciones.ordenId, ordenId)))
    .limit(1);
  if (!actual) return Response.json({ error: "Lectura no encontrada en esta orden" }, { status: 404 });

  if (parsed.data.obligatoria !== undefined && user.rol !== "admin" && user.rol !== "jefe") {
    return Response.json({ error: "Solo la jefatura puede cambiar si una lectura de liberación es obligatoria" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.obligatoria !== undefined) data.obligatoria = parsed.data.obligatoria;

  const tocaValor = parsed.data.valorMedido !== undefined || parsed.data.valorMedidoTexto !== undefined;
  if (tocaValor) {
    const valor = parsed.data.valorMedido !== undefined ? parsed.data.valorMedido : actual.valorMedido;
    const texto =
      parsed.data.valorMedidoTexto !== undefined
        ? parsed.data.valorMedidoTexto?.trim() || null
        : actual.valorMedidoTexto;
    data.valorMedido = valor ?? null;
    data.valorMedidoTexto = texto;
    // "conforme" se calcula del valor medido contra el rango; sin rango que
    // comparar queda null y lo juzga quien libera.
    data.conforme = evaluarConformeLiberacion(actual.minAceptable, actual.maxAceptable, valor ?? null);
    const hayLectura = (valor != null && Number.isFinite(Number(valor))) || !!texto;
    data.medidoPor = hayLectura ? user.id : null;
    data.medidoEn = hayLectura ? new Date().toISOString() : null;
  }

  if (Object.keys(data).length === 0) return Response.json({ error: "Nada que actualizar" }, { status: 400 });

  const [row] = await db
    .update(ordenLiberaciones)
    .set(data)
    .where(eq(ordenLiberaciones.id, parsed.data.itemId))
    .returning();

  if (tocaValor) {
    const leido = row.valorMedido != null ? `${row.valorMedido}${row.unidad ? ` ${row.unidad}` : ""}` : row.valorMedidoTexto ?? "—";
    await logAudit(ctx, {
      entidad: "orden",
      entidadId: ordenId,
      accion: "update",
      resumen: `Liberación «${row.etiqueta}»: ${leido}${row.conforme === false ? " — FUERA DE RANGO" : row.conforme === true ? " — conforme" : ""}`,
      cambios: {
        [`liberacion:${row.etiqueta}`]: {
          antes: actual.valorMedido ?? actual.valorMedidoTexto,
          despues: row.valorMedido ?? row.valorMedidoTexto,
        },
        conforme: { antes: actual.conforme, despues: row.conforme },
      },
    });
  }

  return Response.json({ liberacion: row });
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
    .from(ordenLiberaciones)
    .where(and(eq(ordenLiberaciones.id, parsed.data.itemId), eq(ordenLiberaciones.ordenId, ordenId)))
    .limit(1);
  if (!actual) return Response.json({ error: "Lectura no encontrada en esta orden" }, { status: 404 });

  const [orden] = await db.select({ estado: ordenes.estado }).from(ordenes).where(eq(ordenes.id, ordenId)).limit(1);
  if (orden?.estado === "cerrada" || orden?.estado === "cancelada") {
    return Response.json({ error: "La orden ya está cerrada: las lecturas quedan como evidencia" }, { status: 400 });
  }

  await db.delete(ordenLiberaciones).where(eq(ordenLiberaciones.id, parsed.data.itemId));
  await logAudit(ctx, {
    entidad: "orden",
    entidadId: ordenId,
    accion: "update",
    resumen: `Lectura de liberación eliminada: ${actual.etiqueta}`,
  });
  return Response.json({ ok: true });
};
