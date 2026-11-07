import type { APIRoute } from "astro";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { eopFicha, eopSimulacros, procedimientos, procedimientoVersiones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import {
  hoyISO,
  puedeAdministrarProcedimientos,
  puedeVerProcedimientos,
  revisionAnual,
} from "@/lib/procedimientos";

export const prerender = false;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Cap. 06 del volumen: «Cada EOP se ensaya antes de aprobarse: simulacro de
// mesa para la versión nueva y simulacro funcional en sitio al menos una vez
// al año, con análisis posterior y actualización. Un EOP sin simulacro es una
// hipótesis.»  Aquí se registra el ensayo; la regla que impide poner un EOP
// vigente sin simulacro de mesa vive en PATCH /api/procedimientos/[id].
const createSchema = z.object({
  tipo: z.enum(["mesa", "funcional"]),
  fecha: z.string().regex(FECHA, "El simulacro necesita fecha (YYYY-MM-DD)"),
  versionEnsayada: z.string().nullable().optional(),
  sucursalId: z.number().int().positive().nullable().optional(),
  participantes: z.string().nullable().optional(),
  hallazgos: z.string().nullable().optional(),
  requiereActualizacion: z.boolean().optional(),
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
    .from(eopSimulacros)
    .where(eq(eopSimulacros.procedimientoId, id))
    .orderBy(desc(eopSimulacros.fecha), desc(eopSimulacros.id));
  return Response.json({ simulacros: rows });
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
    return Response.json({ error: "Sólo los EOP se ensayan en simulacro." }, { status: 400 });
  }

  const hoy = hoyISO();
  if (parsed.data.fecha > hoy) {
    return Response.json({ error: "El simulacro se registra después de hacerlo: la fecha no puede ser futura." }, { status: 400 });
  }

  const [row] = await db
    .insert(eopSimulacros)
    .values({
      procedimientoId: id,
      tipo: parsed.data.tipo,
      fecha: parsed.data.fecha,
      // Si no se dice qué versión se ensayó, se ensayó la que está cargada.
      versionEnsayada: parsed.data.versionEnsayada?.trim() || proc.version,
      sucursalId: parsed.data.sucursalId ?? proc.sucursalId ?? null,
      conducidoPor: user.id,
      participantes: parsed.data.participantes ?? null,
      hallazgos: parsed.data.hallazgos ?? null,
      requiereActualizacion: parsed.data.requiereActualizacion ?? false,
    })
    .returning();

  // El simulacro funcional mueve el reloj anual de la ficha.
  if (parsed.data.tipo === "funcional") {
    const [ficha] = await db.select().from(eopFicha).where(eq(eopFicha.procedimientoId, id)).limit(1);
    const valores = {
      ultimoSimulacroFuncional: parsed.data.fecha,
      proximoSimulacroFuncional: revisionAnual(parsed.data.fecha),
    };
    if (!ficha) {
      await db.insert(eopFicha).values({ procedimientoId: id, ...valores });
    } else if (!ficha.ultimoSimulacroFuncional || parsed.data.fecha >= ficha.ultimoSimulacroFuncional) {
      await db.update(eopFicha).set(valores).where(eq(eopFicha.procedimientoId, id));
    }
  }

  // Un hallazgo que exige actualizar el documento lo saca de vigencia: el
  // ensayo demostró que el papel no corresponde a la realidad.
  if (parsed.data.requiereActualizacion && proc.estado === "vigente") {
    await db.update(procedimientos).set({ estado: "en_revision" }).where(eq(procedimientos.id, id));
    await db.insert(procedimientoVersiones).values({
      procedimientoId: id,
      version: proc.version,
      fecha: hoy,
      cambio: `Simulacro ${parsed.data.tipo} del ${parsed.data.fecha} con hallazgos que exigen actualización; estado vigente → en_revision.`,
      responsableId: user.id,
    });
  }

  return Response.json({ simulacro: row }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (user.rol !== "admin") {
    return new Response("Sólo un administrador borra una constancia de simulacro", { status: 403 });
  }

  const id = Number(ctx.params.id);
  const rowId = Number(new URL(ctx.request.url).searchParams.get("rowId"));
  if (!Number.isInteger(id) || !Number.isInteger(rowId)) {
    return Response.json({ error: "ID inválido" }, { status: 400 });
  }

  const db = getDb(ctx);
  await db
    .delete(eopSimulacros)
    .where(and(eq(eopSimulacros.id, rowId), eq(eopSimulacros.procedimientoId, id)));
  return Response.json({ ok: true });
};
