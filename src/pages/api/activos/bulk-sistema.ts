// Declarar la familia (sistema crítico) de muchos equipos de una sola vez.
//
// El juego de documentos no se arma equipo por equipo: se define una vez por
// familia y todos sus equipos lo heredan —«todos los aires acondicionados
// deben aplicarse los mismos 5 documentos»—. Para que esa herencia funcione,
// cada equipo tiene que saber a qué familia pertenece, y hacerlo de uno en uno
// con cientos de equipos no es viable. Este endpoint escribe activos.sistema en
// lote; a partir de ahí queRigeEsteActivo() responde con origen «declarado» y
// juegoDeFamilia() alcanza al equipo sin suponer nada.
import type { APIRoute } from "astro";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { SISTEMAS_PROC } from "@/lib/procedimientos";
import { SISTEMA_LABEL, type Sistema } from "@/lib/resolver";

export const prerender = false;

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  sistema: z.enum(SISTEMAS_PROC),
});

// D1 limita los placeholders por query, así que los IN van en tandas cortas.
const CHUNK = 40;

function tandas<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

// POST /api/activos/bulk-sistema { ids:number[], sistema:string }
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;

  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const sistema = parsed.data.sistema as Sistema;
  const ids = [...new Set(parsed.data.ids)];

  // Solo escribimos lo que de verdad cambia: así el contador que devolvemos
  // ("actualicé 40") es el número real y no el tamaño de la selección.
  const actuales: Array<{ id: number; sistema: string | null }> = [];
  for (const t of tandas(ids)) {
    const filas = await db
      .select({ id: activos.id, sistema: activos.sistema })
      .from(activos)
      .where(inArray(activos.id, t));
    actuales.push(...filas);
  }

  const noEncontrados = ids.length - actuales.length;
  const aCambiar = actuales.filter((a) => (a.sistema ?? null) !== sistema).map((a) => a.id);
  const label = SISTEMA_LABEL[sistema];

  if (aCambiar.length === 0) {
    return Response.json({
      ok: true,
      actualizados: 0,
      sinCambios: actuales.length,
      noEncontrados,
      sistema,
      label,
      mensaje: `Los ${actuales.length} equipos ya estaban declarados en ${label}.`,
    });
  }

  let actualizados = 0;
  for (const t of tandas(aCambiar)) {
    const filas = await db
      .update(activos)
      .set({ sistema })
      .where(inArray(activos.id, t))
      .returning({ id: activos.id });
    actualizados += filas.length;
  }

  await logAudit(ctx, {
    entidad: "activo",
    // Afecta a muchos equipos, no a uno: el detalle va en el resumen.
    entidadId: 0,
    accion: "update",
    resumen: `Familia declarada en lote: ${actualizados} equipos → ${label} (${sistema})`,
    cambios: { sistema: { antes: "varios", despues: sistema } },
  });

  return Response.json({
    ok: true,
    actualizados,
    sinCambios: actuales.length - aCambiar.length,
    noEncontrados,
    sistema,
    label,
    mensaje: `${actualizados} equipos declarados en ${label}.`,
  });
};
