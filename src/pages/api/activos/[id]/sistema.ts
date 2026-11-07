// Declarar en firme a qué sistema crítico pertenece un equipo.
//
// El resolver (src/lib/resolver.ts) sabe responder «qué rige este equipo»
// incluso sin que nadie lo haya declarado: hereda del activo padre o lo infiere
// por el nombre. Pero una inferencia es una suposición, y un documento que
// gobierna una emergencia no puede depender de una suposición. Este endpoint
// convierte la suposición en un dato: escribe activos.sistema y a partir de ahí
// queRigeEsteActivo() responde con origen «declarado».
import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { SISTEMAS_PROC } from "@/lib/procedimientos";
import { SISTEMA_LABEL, sistemaDeActivo, type Sistema } from "@/lib/resolver";

export const prerender = false;

const schema = z.object({
  // null borra la declaración: el equipo vuelve a heredar o a inferir.
  sistema: z.enum(SISTEMAS_PROC).nullable(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;

  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return Response.json({ error: "Equipo inválido" }, { status: 400 });
  }

  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [actual] = await db
    .select({
      id: activos.id,
      codigo: activos.codigo,
      nombre: activos.nombre,
      categoria: activos.categoria,
      rubro: activos.rubro,
      sistema: activos.sistema,
      padreId: activos.padreId,
      scpProcedimientoId: activos.scpProcedimientoId,
    })
    .from(activos)
    .where(eq(activos.id, id))
    .limit(1);
  if (!actual) return Response.json({ error: "Equipo no encontrado" }, { status: 404 });

  const nuevo = parsed.data.sistema;
  if ((actual.sistema ?? null) === (nuevo ?? null)) {
    // Nada que escribir: devolvemos igual cómo queda resuelto, para que la UI
    // no tenga que adivinar.
    const resuelto = await sistemaDeActivo(db, actual as any);
    return Response.json({ ok: true, sistema: nuevo, resuelto, sinCambios: true });
  }

  const [row] = await db.update(activos).set({ sistema: nuevo }).where(eq(activos.id, id)).returning({
    id: activos.id,
    sistema: activos.sistema,
  });

  const antes = actual.sistema ? SISTEMA_LABEL[actual.sistema as Sistema] : "sin declarar";
  const despues = nuevo ? SISTEMA_LABEL[nuevo as Sistema] : "sin declarar";
  await logAudit(ctx, {
    entidad: "activo",
    entidadId: id,
    accion: "update",
    resumen: `Sistema crítico declarado: ${antes} → ${despues}`,
    cambios: { sistema: { antes: actual.sistema ?? null, despues: nuevo ?? null } },
  });

  // Cómo queda resuelto después del cambio: si se borró la declaración, vuelve
  // a heredar o a inferirse y la ficha debe decirlo.
  const resuelto = await sistemaDeActivo(db, { ...(actual as any), sistema: nuevo });

  return Response.json({ ok: true, sistema: row?.sistema ?? nuevo, resuelto });
};
